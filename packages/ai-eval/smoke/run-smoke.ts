/**
 * `pnpm eval:smoke --provider=<id>` — the smoke probe of M0-32.
 *
 * ONE QUESTION, AS EARLY AS POSSIBLE: does a free provider hold the
 * constrained prompt? Not "is the prose good" — that is M0-27 and M0-31, with
 * the full corpus and the production checks. This file builds the SMALLEST
 * request that still carries the real constraint, calls the real port, and
 * scores with the seven frozen checks of `assertions.ts`.
 *
 * ── WHAT IT DELIBERATELY DOES NOT USE ───────────────────────────────────────
 * The context builder of M0-22, shipped in the same wave. That is what makes
 * the probe early, and it is the line that separates it from M0-31, which
 * replays the whole production request. So the last `user` message is
 * assembled HERE, from the case, and carries four blocks: `<scene>`,
 * `<fait>`, `<intention>`, `<consignes_du_tour>`. No `<etat>`, no `<lore>`, no
 * `<chronique>`: none of them exists yet, and a probe that waited for them
 * would land in wave 8 with nothing left to inform.
 *
 * ── PROSE-ONLY, AND IT IS A DECISION, NOT AN OVERSIGHT ──────────────────────
 * `tools: []` and `toolPolicy: 'none'`. ADR 0011 takes the tool table from
 * 2 112 measured tokens to 0 and says why: the free tiers cap PER DAY, the
 * fixed block multiplies by every turn, and tool calling is what small models
 * get wrong most often. The engine decides everything already; the storyteller
 * dresses an acquired fact. This probe therefore measures the mode the product
 * will actually run in.
 *
 * ── THE PROMPT IS THE REAL ONE ──────────────────────────────────────────────
 * `system[0]` is `CONTEUR_SYSTEM_PROMPT`, IMPORTED, never recopied, and the
 * report carries its version and a fingerprint computed on the bytes of the
 * built request — so changing one character of the prompt changes the report.
 * Held by `run-smoke.test.ts` « porte le prompt de production en system[0], à
 * l'octet près », « arrive telle quelle jusqu'au port, pas seulement jusqu'au
 * constructeur » and « est celle du prompt réellement envoyé, et le rapport
 * porte la version ».
 *
 * ── EXIT CODES ──────────────────────────────────────────────────────────────
 * 0 = the probe ran and produced a verdict, FAVOURABLE OR NOT. A verdict is
 * information, not a gate, and nothing in the CI calls this command.
 * 1 = the probe could not run: unknown provider, missing environment
 * variable, no case, check count out of bounds, provider unreachable. One
 * line on stderr, never a stack trace.
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  CONTEUR_PROMPT_VERSION,
  CONTEUR_SYSTEM_PROMPT,
  estimateTokens,
  SCENE_BLOCK_ABSENT_HEADER,
  SCENE_BLOCK_HEADER,
  SCENE_BLOCK_NONE,
  SCENE_BLOCK_PRESENT_HEADER,
  selectNarrator,
} from '@for/ai';
import {
  NARRATOR_PROVIDER_IDS,
  NarratorError,
  type NarrateRequest,
  type NarratorConfig,
  type NarratorPort,
  type NarratorProviderId,
} from '@for/contracts';

import {
  SMOKE_ASSERTIONS,
  SMOKE_ASSERTIONS_MAX,
  SMOKE_ASSERTIONS_MIN,
  type SmokeCheck,
  type SmokeCheckResult,
} from './assertions.js';
import { loadCases, SmokeCaseError, type SmokeCase } from './cases.js';
import { formatReport, type SmokeFallenCheck, type SmokeSummary } from './report.js';

/** M0-32 sheet: two samples per case. Fixed, so that two runs give one verdict. */
export const SAMPLES_PER_CASE = 2;

/** 02-mj-ia.md §4.1: three to five sentences plus the `<scene_apres>` block. */
const MAX_OUTPUT_TOKENS = 800;

/** 02-mj-ia.md §0.6, `NARRATOR_TIMEOUT_MS`. A cold local model is slow, not broken. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Raised when the probe cannot run at all. Becomes one line and exit 1. */
export class SmokeRunError extends Error {}

/**
 * What each provider needs before a call is even worth attempting, per
 * 02-mj-ia.md §0.6. `ollama` ignores the key on purpose: a local server has
 * nothing to authenticate.
 */
export const SMOKE_REQUIRED_ENV: Readonly<Record<NarratorProviderId, readonly string[]>> =
  Object.freeze({
    stub: [],
    anthropic: ['NARRATOR_API_KEY', 'NARRATOR_MODEL'],
    'openai-compatible': ['NARRATOR_BASE_URL', 'NARRATOR_API_KEY', 'NARRATOR_MODEL'],
    ollama: ['NARRATOR_BASE_URL', 'NARRATOR_MODEL'],
  });

// ------------------------------------------------------- building a request

const sceneSection = (
  header: string,
  rows: readonly { readonly name: string; readonly detail: string }[],
): readonly string[] =>
  rows.length === 0
    ? [header, SCENE_BLOCK_NONE]
    : [header, ...rows.map((r) => `- ${r.name} (${r.detail})`)];

/** The `<scene>` block of §4.5, rendered from the case and from nothing else. */
export function buildSceneBlock(smokeCase: SmokeCase): string {
  return [
    '<scene>',
    SCENE_BLOCK_HEADER,
    `Lieu : ${smokeCase.sceneIn.place}`,
    `Heure : ${smokeCase.sceneIn.time}`,
    ...sceneSection(SCENE_BLOCK_PRESENT_HEADER, smokeCase.sceneIn.present),
    ...sceneSection(SCENE_BLOCK_ABSENT_HEADER, smokeCase.sceneIn.absent),
    '</scene>',
  ].join('\n');
}

/**
 * `<consignes_du_tour>` of §4.5, repeated at the very end of the context where
 * attention is best.
 *
 * THE LOCKED LIST TRAVELS HERE, not in a `system[1]` campaign block: the M0-32
 * sheet fixes `system[]` to the production prompt alone, and a
 * `no_locked_champion` check run against a model that was never told the list
 * would measure luck. This is the probe's one departure from §4.1's request
 * shape, and it is written down rather than hidden.
 */
export function buildTurnInstructions(smokeCase: SmokeCase): string {
  const forbidden = smokeCase.lockedChampions
    .flatMap((champion) => [champion.name, ...champion.aliases])
    .join(', ');
  const absent = smokeCase.sceneIn.absent.map((entry) => entry.name).join(', ');
  const price = smokeCase.imposedPrice
    ? ' Mets en scène le prix imposé tel qu’il est écrit, sans le remplacer par autre chose.'
    : '';
  return [
    '<consignes_du_tour>',
    `Écris maintenant. Trois à cinq phrases, prose seule, deuxième personne du singulier adressée à ${smokeCase.actor}. N’écris aucun chiffre. N’écris aucun nom de mécanique. Ne fais ni parler ni décider ${smokeCase.actor}.`,
    `Champions interdits, eux et leurs surnoms : ${forbidden}. Tu ne les cites pas et tu ne les évoques pas.`,
    `Ne fais revenir personne de la liste des partis : ${absent}.${price} Ne fais pas passer le temps. Termine sur un fait, pas sur une atmosphère, et jamais sur une question adressée au joueur.`,
    'Puis écris le bloc <scene_apres> : qui est encore là, qui est parti, et refus à null sauf si un fait ci-dessus rend l’action matériellement impossible.',
    '</consignes_du_tour>',
  ].join('\n');
}

/** The last `user` message, in the order §4.1 fixes for the blocks it keeps. */
export function buildUserMessage(smokeCase: SmokeCase): string {
  return [
    buildSceneBlock(smokeCase),
    `<fait>\n${smokeCase.fact}\n</fait>`,
    `<intention>\n${smokeCase.intent}\n</intention>`,
    buildTurnInstructions(smokeCase),
  ].join('\n\n');
}

export function buildNarrateRequest(smokeCase: SmokeCase, sampleIndex: number): NarrateRequest {
  return {
    purpose: 'narration',
    requestId: `smoke-${smokeCase.id}-${String(sampleIndex + 1)}`,
    system: [{ type: 'text', text: CONTEUR_SYSTEM_PROMPT, cacheHint: 'stable' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: buildUserMessage(smokeCase) }] }],
    tools: [],
    toolPolicy: 'none',
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    effort: 'low',
  };
}

/** Twelve hex characters of SHA-256: enough to see a one-character edit. */
export const fingerprint = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);

// ---------------------------------------------------------------- the run

export interface SmokeRunOptions {
  readonly port: NarratorPort;
  readonly cases: readonly SmokeCase[];
  /**
   * The table to score with. Defaults to the frozen seven. `main` passes the
   * SAME table it bounds-checked, so the count printed, the count bounded and
   * the count scored can never be three different numbers.
   */
  readonly checks?: readonly SmokeCheck[];
  readonly samplesPerCase?: number;
  readonly timeoutMs?: number;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

async function collect(
  port: NarratorPort,
  req: NarrateRequest,
): Promise<{
  readonly text: string;
  readonly providerModel: string;
  readonly inputTokens: number;
}> {
  let text = '';
  let providerModel = '';
  let inputTokens = 0;
  for await (const event of port.narrer(req)) {
    if (event.type === 'end') {
      text = event.result.text;
      providerModel = event.result.providerModel;
      inputTokens = event.result.usage.inputTokens;
    }
  }
  return { text, providerModel, inputTokens };
}

/**
 * Run every case `samplesPerCase` times and fold the results.
 *
 * A check counts as PASSED only when it passed on EVERY sample: the question
 * is whether a provider holds the prompt, and one sample out of six that drops
 * the `<scene_apres>` block is a provider that does not hold it. Held by
 * `run-smoke.test.ts` « ne compte une règle passée que si elle passe sur TOUS
 * les échantillons », which hands a port whose FIRST sample fails and whose
 * second one passes: a double answering one constant text cannot tell "every"
 * from "at least one".
 */
export async function runSmoke(options: SmokeRunOptions): Promise<SmokeSummary> {
  const samplesPerCase = options.samplesPerCase ?? SAMPLES_PER_CASE;
  const checks = options.checks ?? SMOKE_ASSERTIONS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (options.cases.length === 0) {
    throw new SmokeRunError('aucun cas chargé : le répertoire cases/ est vide');
  }

  const failures = new Map<string, { count: number; detail: string }>();
  const measured: number[] = [];
  const estimates: number[] = [];
  let providerModel = '';
  let promptBytes = '';
  let calls = 0;

  for (const smokeCase of options.cases) {
    for (let sample = 0; sample < samplesPerCase; sample += 1) {
      const req = buildNarrateRequest(smokeCase, sample);
      promptBytes = req.system[0]?.text ?? '';
      // What is actually sent: the system prompt plus the single user message.
      // `tools` is empty (ADR 0011, prose-only), so there is nothing else.
      estimates.push(estimateTokens(promptBytes) + estimateTokens(buildUserMessage(smokeCase)));
      const timed: NarrateRequest = { ...req, abortSignal: AbortSignal.timeout(timeoutMs) };
      process.stderr.write(
        `· ${smokeCase.id} échantillon ${String(sample + 1)}/${String(samplesPerCase)}\n`,
      );
      const answer = await collect(options.port, timed);
      calls += 1;
      if (answer.providerModel.length > 0) providerModel = answer.providerModel;
      if (answer.inputTokens > 0) measured.push(answer.inputTokens);
      for (const check of checks) {
        const result: SmokeCheckResult = check.run(answer.text, smokeCase);
        if (result.passed) continue;
        const previous = failures.get(check.id);
        failures.set(check.id, {
          count: (previous?.count ?? 0) + 1,
          detail: previous?.detail ?? result.detail,
        });
      }
    }
  }

  const fallen: SmokeFallenCheck[] = checks
    .filter((check) => failures.has(check.id))
    .map((check) => {
      const entry = failures.get(check.id);
      return { id: check.id, failedSamples: entry?.count ?? 0, detail: entry?.detail ?? '' };
    });

  return {
    promptVersion: CONTEUR_PROMPT_VERSION,
    promptFingerprint: fingerprint(promptBytes),
    promptEstimatedTokens: estimateTokens(promptBytes),
    providerId: options.port.providerId,
    model: providerModel,
    caseCount: options.cases.length,
    samplesPerCase,
    callCount: calls,
    checkTotal: checks.length,
    fallen,
    estimatedInputTokens: median(estimates),
    measuredInputTokens: measured.length === 0 ? null : median(measured),
  };
}

// ------------------------------------------------------------------- CLI

const readFlag = (argv: readonly string[], name: string): string | null => {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
};

const isProviderId = (value: string): value is NarratorProviderId =>
  (NARRATOR_PROVIDER_IDS as readonly string[]).includes(value);

export function buildConfig(
  provider: NarratorProviderId,
  env: Readonly<Record<string, string | undefined>>,
): NarratorConfig {
  const missing = SMOKE_REQUIRED_ENV[provider].filter((name) => {
    const value = env[name];
    return value === undefined || value.length === 0;
  });
  if (missing.length > 0) {
    throw new SmokeRunError(
      `fournisseur « ${provider} » : variable(s) d'environnement manquante(s) : ${missing.join(', ')}`,
    );
  }
  const timeout = Number(env['NARRATOR_TIMEOUT_MS'] ?? DEFAULT_TIMEOUT_MS);
  return {
    provider,
    baseUrl: env['NARRATOR_BASE_URL'] ?? null,
    apiKey: env['NARRATOR_API_KEY'] ?? null,
    model: env['NARRATOR_MODEL'] ?? null,
    modelStructured: env['NARRATOR_MODEL_STRUCTURED'] ?? null,
    tools: 'off',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    contextWindowTokens:
      env['NARRATOR_CONTEXT_WINDOW'] === undefined ? null : Number(env['NARRATOR_CONTEXT_WINDOW']),
  };
}

export interface SmokeCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface SmokeCliDeps {
  /**
   * `typeof selectNarrator`, WRITTEN AS SUCH and not recopied: the real one
   * takes `(config, deps)`, and a hand-written `(config) => NarratorPort` would
   * have been accepted by TypeScript while silently dropping the second
   * parameter — mode 8 of `docs/RECETTE.md`. Held by `run-smoke.test.ts`
   * « le double du sélecteur reçoit tout ce que le vrai reçoit ».
   */
  readonly selectPort?: typeof selectNarrator;
  /**
   * The check table. Production never passes it; a test passes an out-of-bounds
   * one to prove that the bound is WIRED INTO `main`, not merely testable as a
   * pure function. Held by `run-smoke.test.ts` « le compte hors bornes fait
   * sortir en 1 ».
   */
  readonly checks?: readonly SmokeCheck[];
}

/**
 * The bound of the M0-32 sheet, as a pure function: returns the message to
 * print, or null when the table is the right size.
 *
 * Out of bounds is a HARNESS CONFIGURATION ERROR, not a verdict, which is why
 * it is the one non-network reason for exit 1 alongside the missing variables.
 * The function alone proves nothing: what proves the bound is
 * `run-smoke.test.ts` « le compte hors bornes fait sortir en 1 », which calls
 * `main` with a nine-check table and requires the code 1.
 */
export function assertCountWithinBounds(count: number): string | null {
  if (count >= SMOKE_ASSERTIONS_MIN && count <= SMOKE_ASSERTIONS_MAX) return null;
  return `compte d'assertions hors bornes : ${String(count)} n'est pas dans l'intervalle ${String(SMOKE_ASSERTIONS_MIN)}–${String(SMOKE_ASSERTIONS_MAX)}`;
}

/**
 * The whole command, argv and environment in, exit code out.
 *
 * THE COUNT LINE IS WRITTEN FIRST, before any call, because the M0-32 sheet
 * asks the probe to check its own table at start-up and to say what it loaded.
 * The verdict itself is built entirely in memory and printed in one go, so a
 * provider that dies mid-run leaves no half-written report behind it.
 */
export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: SmokeCliIo,
  deps: SmokeCliDeps = {},
): Promise<number> {
  try {
    const requested = readFlag(argv, 'provider');
    if (requested === null || !isProviderId(requested)) {
      throw new SmokeRunError(
        `--provider=<${NARRATOR_PROVIDER_IDS.join('|')}> est requis${requested === null ? '' : ` (reçu « ${requested} »)`}`,
      );
    }
    const checks = deps.checks ?? SMOKE_ASSERTIONS;
    io.out(`assertions: ${String(checks.length)}`);
    const outOfBounds = assertCountWithinBounds(checks.length);
    if (outOfBounds !== null) throw new SmokeRunError(outOfBounds);
    const config = buildConfig(requested, env);
    const port = (deps.selectPort ?? selectNarrator)(config);
    const summary = await runSmoke({
      port,
      cases: loadCases(),
      checks,
      timeoutMs: config.timeoutMs,
    });
    io.out(formatReport(summary));
    return 0;
  } catch (cause) {
    if (cause instanceof NarratorError) {
      io.err(`échec fournisseur (${cause.providerId}) : ${cause.code} — ${cause.message}`);
      return 1;
    }
    if (cause instanceof SmokeRunError || cause instanceof SmokeCaseError) {
      io.err(cause.message);
      return 1;
    }
    io.err(`échec inattendu : ${cause instanceof Error ? cause.message : String(cause)}`);
    return 1;
  }
}

/** Only when invoked as the command, so the tests can import the pieces. */
const invokedAs = process.argv[1];
if (invokedAs !== undefined && resolve(invokedAs) === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2), process.env, {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
}
