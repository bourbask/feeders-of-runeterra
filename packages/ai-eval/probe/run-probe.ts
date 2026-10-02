/**
 * `pnpm eval:probe --provider=<id>` — the full provider measurement of M0-31.
 *
 * ── WHAT IT ADDS TO THE SMOKE PROBE, AND WHY BOTH EXIST ─────────────────────
 * M0-32 asks « does a free provider hold the constrained prompt? » with seven
 * hand-written checks, a minimal request, and no dependency on the corpus. It
 * is the EARLY signal and it is deliberately cheap. This one asks « WHICH ONE
 * DO WE TAKE? », and to answer that it needs three things the smoke probe
 * cannot have: the SIXTEEN HARD RULES OF PRODUCTION, imported from
 * `@for/ai/src/assertions`; the request production actually sends, built by
 * `buildNarrateRequest` of `@for/ai` — chronicle, state, rolling window,
 * truncation ladder and all; and several providers folded onto the SAME
 * corpus so the numbers can be put side by side. Neither replaces the other.
 *
 * ── NOT ONE RULE IS DECLARED IN THIS DIRECTORY ──────────────────────────────
 * The acceptance criterion is a grep that must print zero, and `check(1)`
 * below is its runtime half: every identifier the report will carry is looked
 * up in `Object.keys(ASSERTIONS)` BEFORE the first call, and an identifier
 * that is not there stops the run with exit 1. On the production table that
 * check can never fail — `HARD_ASSERTIONS` is built from the same array as
 * `ASSERTIONS` — and saying so is the point: what gives it teeth is the
 * injection point, `ProbeCliDeps.rules`, which `run-probe.test.ts` uses to
 * hand `main` a rule the barrel does not know and require the 1.
 *
 * ── THE KEY NEVER CROSSES THE COMMAND LINE ──────────────────────────────────
 * There is a `--model` and a `--base-url` flag; there is deliberately no
 * `--api-key`. A key in `argv` lands in the shell history, in `ps`, and in
 * every CI log that echoes its command. It comes from the environment or it
 * does not come at all. This repository is public.
 *
 * ── EXIT CODES ──────────────────────────────────────────────────────────────
 * 0 = the probe ran and produced a report, FAVOURABLE OR NOT. A measurement
 * is information, not a gate, and nothing in the CI calls this command.
 * 1 = it could not run: unknown provider, missing environment variable, fewer
 * cases than the sheet's floor, an uncovered premise, a rule the barrel does
 * not know, an unreadable merge. One line on stderr, never a stack trace.
 */

import {
  ASSERTIONS,
  CONTEUR_PROMPT_VERSION,
  CONTEUR_SYSTEM_PROMPT,
  HARD_ASSERTIONS,
  buildCampaignBlock,
  buildNarrateRequest,
  estimateTokens,
  selectNarrator,
} from '@for/ai';
import {
  NARRATOR_PROVIDER_IDS,
  NarratorError,
  type NarrateFinish,
  type NarrateRequest,
  type NarratorConfig,
  type NarratorPort,
  type NarratorProviderId,
} from '@for/contracts';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { ProbeCaseError, loadProbeCases, type ProbeCase } from './cases.js';
import { PREMISES, gradeSample, missingPremises, readAnswer, type SampleGrade } from './grading.js';
import {
  formatProbeReport,
  median,
  type ProbeCallFailure,
  type ProbeReport,
  type ProviderReport,
  type RuleRate,
} from './report.js';
import { probeTools, type ToolProbeOutcome } from './tool-probe.js';

import type { Assertion } from '@for/ai';

/** M0-31 sheet, « n = 2 échantillons par cas ». */
export const SAMPLES_PER_CASE = 2;

/**
 * M0-31 sheet, « 6 cas au minimum ». Written in full letters here because it
 * is a criterion's number and not a number read back from the fixtures
 * (ADR 0007, « aucun chiffre ne se compare à lui-même »).
 */
export const PROBE_CASES_MIN = 6;

/** A cold local model on CPU is slow, not broken (M0-32, §3 of its runbook). */
const DEFAULT_TIMEOUT_MS = 900_000;

/** Raised when the probe cannot run at all. Becomes one line and exit 1. */
export class ProbeRunError extends Error {}

/**
 * What each provider needs before a call is worth attempting, per
 * 02-mj-ia.md §0.6. `ollama` ignores the key on purpose: a local server has
 * nothing to authenticate.
 */
export const PROBE_REQUIRED_ENV: Readonly<Record<NarratorProviderId, readonly string[]>> =
  Object.freeze({
    stub: [],
    anthropic: ['NARRATOR_API_KEY', 'NARRATOR_MODEL'],
    'openai-compatible': ['NARRATOR_BASE_URL', 'NARRATOR_API_KEY', 'NARRATOR_MODEL'],
    ollama: ['NARRATOR_BASE_URL', 'NARRATOR_MODEL'],
  });

/** Twelve hex characters of SHA-256: enough to see a one-character edit. */
export const fingerprint = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);

// --------------------------------------------------------- the request built

/**
 * The turn, assembled by the PRODUCTION builder.
 *
 * `buildNarrateRequest` is `@for/ai`'s — the same function `server/src/ai/
 * turn.ts` calls, with the same five inputs. Nothing about the shape of the
 * prompt is decided here; the only thing this file chooses is `requestId`,
 * which production takes from its identifier factory. That is what « la même
 * `NarrateRequest` que la production » means, and it is also what makes the
 * truncation ladder — and therefore the trim level this report prints — the
 * real one.
 */
export function buildTurn(
  probeCase: ProbeCase,
  sample: number,
  contextWindowTokens: number,
): ReturnType<typeof buildNarrateRequest> {
  return buildNarrateRequest({
    requestId: `probe-${probeCase.id}-${String(sample + 1)}`,
    brief: probeCase.brief,
    systemPrompt: CONTEUR_SYSTEM_PROMPT,
    campaignBlock: buildCampaignBlock(probeCase.campaign),
    actorLabel: probeCase.actorLabel,
    vocabulary: probeCase.vocabulary,
    trimmable: probeCase.trimmable,
    contextWindowTokens,
  });
}

/** Every byte that leaves for the provider, for the estimator's numerator. */
export function requestText(request: NarrateRequest): string {
  return [
    ...request.system.map((block) => block.text),
    ...request.messages.flatMap((message) =>
      message.content.map((block) => (block.type === 'text' ? block.text : '')),
    ),
  ].join('\n');
}

// ------------------------------------------------------------------ one run

interface Answer {
  readonly text: string;
  readonly providerModel: string;
  readonly inputTokens: number;
  readonly latencyMs: number;
  readonly finish: NarrateFinish | null;
}

async function collect(port: NarratorPort, request: NarrateRequest): Promise<Answer> {
  let text = '';
  let providerModel = '';
  let inputTokens = 0;
  let latencyMs = 0;
  let finish: NarrateFinish | null = null;
  for await (const event of port.narrer(request)) {
    if (event.type === 'end') {
      text = event.result.text;
      providerModel = event.result.providerModel;
      inputTokens = event.result.usage.inputTokens;
      latencyMs = event.result.latencyMs;
      finish = event.result.finish;
    }
  }
  return { text, providerModel, inputTokens, latencyMs, finish };
}

export interface MeasureOptions {
  readonly port: NarratorPort;
  readonly cases: readonly ProbeCase[];
  readonly label: string;
  readonly toolProbe: ToolProbeOutcome;
  readonly rules?: readonly Assertion[];
  readonly samplesPerCase?: number;
  readonly timeoutMs?: number;
  readonly progress?: (line: string) => void;
}

/**
 * Measure one provider over the whole corpus and fold it into one row set.
 *
 * A call that FAILS is counted, named and NOT scored: grading an empty string
 * would hand ten rules a free pass for a provider that answered nothing. Held
 * by `run-probe.test.ts` « un appel en échec est compté, nommé, et jamais
 * noté ».
 */
export async function measureProvider(options: MeasureOptions): Promise<ProviderReport> {
  const rules = options.rules ?? HARD_ASSERTIONS;
  const samplesPerCase = options.samplesPerCase ?? SAMPLES_PER_CASE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const windowTokens = options.port.capabilities.contextWindowTokens;

  const tally = new Map<string, { passed: number; failed: number; na: number; first: string }>();
  for (const rule of rules) tally.set(rule.id, { passed: 0, failed: 0, na: 0, first: '' });

  const failures: ProbeCallFailure[] = [];
  const estimates: number[] = [];
  const measured: number[] = [];
  const charsPerToken: number[] = [];
  const latencies: number[] = [];
  const overflowCases: string[] = [];
  let worstTrimLevel = 0;
  let providerModel = '';
  let calls = 0;
  let answered = 0;
  let sceneBlockPresent = 0;
  let proseEmpty = 0;
  let proseTruncated = 0;
  let finishTruncated = 0;

  for (const probeCase of options.cases) {
    for (let sample = 0; sample < samplesPerCase; sample += 1) {
      const built = buildTurn(probeCase, sample, windowTokens);
      const bytes = requestText(built.request);
      estimates.push(estimateTokens(bytes));
      worstTrimLevel = Math.max(worstTrimLevel, built.trim.trimLevel);
      if (built.trim.overflow && !overflowCases.includes(probeCase.id)) {
        overflowCases.push(probeCase.id);
      }
      const request: NarrateRequest = {
        ...built.request,
        abortSignal: AbortSignal.timeout(timeoutMs),
      };
      options.progress?.(
        `· ${options.label} — ${probeCase.id} échantillon ${String(sample + 1)}/${String(samplesPerCase)}`,
      );
      calls += 1;
      let answer: Answer;
      try {
        answer = await collect(options.port, request);
      } catch (cause) {
        failures.push({
          caseId: probeCase.id,
          sample: sample + 1,
          code: cause instanceof NarratorError ? cause.code : 'internal',
          message: cause instanceof Error ? cause.message : String(cause),
        });
        continue;
      }
      answered += 1;
      if (answer.providerModel.length > 0) providerModel = answer.providerModel;
      if (answer.inputTokens > 0) {
        measured.push(answer.inputTokens);
        charsPerToken.push(bytes.length / answer.inputTokens);
      }
      if (answer.latencyMs > 0) latencies.push(answer.latencyMs);

      const reading = readAnswer(answer.text, probeCase);
      if (reading.sceneBlock !== null) sceneBlockPresent += 1;
      if (reading.prose.trim().length === 0) proseEmpty += 1;
      if (reading.proseTruncated) proseTruncated += 1;
      if (answer.finish === 'truncated') finishTruncated += 1;

      for (const grade of gradeSample(probeCase, reading, rules, PREMISES)) {
        fold(tally, grade);
      }
    }
  }

  const estimatedInput = median(estimates) ?? 0;
  const measuredInput = median(measured);
  return {
    providerId: options.port.providerId,
    label: options.label,
    model: providerModel,
    capabilities: options.port.capabilities,
    toolProbe: options.toolProbe,
    calls,
    answered,
    failures,
    readingFacts: {
      samples: answered,
      sceneBlockPresent,
      proseEmpty,
      proseTruncated,
      finishTruncated,
    },
    tokens: {
      estimatedInput,
      measuredInput,
      driftPct:
        measuredInput === null || measuredInput === 0
          ? null
          : ((estimatedInput - measuredInput) / measuredInput) * 100,
      charsPerToken: median(charsPerToken),
      worstTrimLevel,
      overflowCases,
    },
    medianLatencyMs: median(latencies),
    rates: rules.map((rule) => rateOf(rule.id, tally)),
  };
}

function fold(
  tally: Map<string, { passed: number; failed: number; na: number; first: string }>,
  grade: SampleGrade,
): void {
  const row = tally.get(grade.id);
  if (row === undefined) return;
  if (grade.state === 'passed') row.passed += 1;
  else if (grade.state === 'failed') {
    row.failed += 1;
    if (row.first.length === 0) row.first = grade.detail;
  } else row.na += 1;
}

function rateOf(
  id: string,
  tally: Map<string, { passed: number; failed: number; na: number; first: string }>,
): RuleRate {
  const row = tally.get(id) ?? { passed: 0, failed: 0, na: 0, first: '' };
  const applicable = row.passed + row.failed;
  return {
    id,
    applicable,
    passed: row.passed,
    failed: row.failed,
    notApplicable: row.na,
    rate: applicable === 0 ? null : row.passed / applicable,
    firstFailure: row.first,
  };
}

// ------------------------------------------------------------------- the CLI

const flags = (argv: readonly string[], name: string): readonly string[] => {
  const prefix = `--${name}=`;
  return argv.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length));
};

const firstFlag = (argv: readonly string[], name: string): string | null =>
  flags(argv, name)[0] ?? null;

const isProviderId = (value: string): value is NarratorProviderId =>
  (NARRATOR_PROVIDER_IDS as readonly string[]).includes(value);

export function buildConfig(
  provider: NarratorProviderId,
  env: Readonly<Record<string, string | undefined>>,
  overrides: { readonly model?: string | undefined; readonly baseUrl?: string | undefined } = {},
): NarratorConfig {
  const value = (name: string): string | undefined => {
    if (name === 'NARRATOR_MODEL' && overrides.model !== undefined) return overrides.model;
    if (name === 'NARRATOR_BASE_URL' && overrides.baseUrl !== undefined) return overrides.baseUrl;
    return env[name];
  };
  const missing = PROBE_REQUIRED_ENV[provider].filter((name) => {
    const found = value(name);
    return found === undefined || found.length === 0;
  });
  if (missing.length > 0) {
    throw new ProbeRunError(
      `fournisseur « ${provider} » : variable(s) d'environnement manquante(s) : ${missing.join(', ')}`,
    );
  }
  const timeout = Number(env['NARRATOR_TIMEOUT_MS'] ?? DEFAULT_TIMEOUT_MS);
  return {
    provider,
    baseUrl: value('NARRATOR_BASE_URL') ?? null,
    apiKey: value('NARRATOR_API_KEY') ?? null,
    model: value('NARRATOR_MODEL') ?? null,
    modelStructured: env['NARRATOR_MODEL_STRUCTURED'] ?? null,
    // Issue #95. La mesure se fait dans le mode de production : raisonnement
    // éteint. `NARRATOR_REASONING=on` le rallume — c'est ainsi qu'on MESURE
    // si un modèle écrit mieux en réfléchissant, au lieu de le supposer.
    reasoning: env['NARRATOR_REASONING'] === 'on' ? 'on' : 'off',
    tools: toolsMode(env['NARRATOR_TOOLS']),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    contextWindowTokens:
      env['NARRATOR_CONTEXT_WINDOW'] === undefined ? null : Number(env['NARRATOR_CONTEXT_WINDOW']),
  };
}

const toolsMode = (value: string | undefined): NarratorConfig['tools'] =>
  value === 'on' ? 'on' : value === 'probe' ? 'probe' : 'off';

export interface ProbeCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly write: (path: string, body: string) => void;
}

export interface ProbeCliDeps {
  /**
   * `typeof selectNarrator`, WRITTEN AS SUCH and never retyped by hand: the
   * real one takes `(config, deps)`, and a hand-written `(config) =>
   * NarratorPort` would compile while silently dropping the second parameter
   * — mode 8 of `docs/RECETTE.md`. Held by `run-probe.test.ts` « le double du
   * sélecteur reçoit tout ce que le vrai reçoit ».
   */
  readonly selectPort?: typeof selectNarrator;
  /** `typeof probeTools`, for the same reason. */
  readonly toolProbe?: typeof probeTools;
  /**
   * The rule table. Production never passes it; a test passes one carrying an
   * identifier the barrel does not know, to prove the check is WIRED INTO
   * `main` rather than merely testable as a pure function.
   */
  readonly rules?: readonly Assertion[];
  readonly cases?: readonly ProbeCase[];
}

/**
 * Every rule identifier the report would carry that `@for/ai` does not export.
 *
 * The sheet: « un identifiant absent de `Object.keys(ASSERTIONS)` fait sortir
 * la sonde en 1 ». On the production table the answer is always empty, and
 * that is said out loud in this file's header rather than dressed up as a
 * guarantee.
 */
export function unknownRuleIds(
  rules: readonly Assertion[],
  known: Readonly<Record<string, unknown>> = ASSERTIONS,
): readonly string[] {
  return rules.filter((rule) => !(rule.id in known)).map((rule) => rule.id);
}

/** An earlier report to fold in, so two runs compare on the SAME corpus. */
export function readMerge(path: string, current: ProbeReport): readonly ProviderReport[] {
  let previous: ProbeReport;
  try {
    previous = JSON.parse(readFileSync(path, 'utf8')) as ProbeReport;
  } catch (cause) {
    throw new ProbeRunError(
      `rapport à fusionner illisible (${path}) : ${cause instanceof Error ? cause.message : 'inconnu'}`,
    );
  }
  if (
    previous.promptFingerprint !== current.promptFingerprint ||
    previous.samplesPerCase !== current.samplesPerCase ||
    previous.caseIds.join(',') !== current.caseIds.join(',')
  ) {
    throw new ProbeRunError(
      'rapport à fusionner mesuré sur un autre corpus ou un autre prompt : la comparaison serait fausse',
    );
  }
  return previous.providers;
}

export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: ProbeCliIo,
  deps: ProbeCliDeps = {},
): Promise<number> {
  try {
    const requested = flags(argv, 'provider');
    if (requested.length === 0) {
      throw new ProbeRunError(
        `--provider=<${NARRATOR_PROVIDER_IDS.join('|')}> est requis (répétable)`,
      );
    }
    for (const id of requested) {
      if (!isProviderId(id)) {
        throw new ProbeRunError(
          `fournisseur inconnu « ${id} » : attendu ${NARRATOR_PROVIDER_IDS.join(', ')}`,
        );
      }
    }

    const rules = deps.rules ?? HARD_ASSERTIONS;
    io.out(`assertions dures importées de @for/ai : ${String(rules.length)}`);
    const unknown = unknownRuleIds(rules);
    if (unknown.length > 0) {
      throw new ProbeRunError(
        `identifiant(s) absent(s) de @for/ai : ${unknown.join(', ')} — la sonde ne note qu'avec les assertions de production`,
      );
    }
    const uncovered = missingPremises(rules, PREMISES);
    if (uncovered.length > 0) {
      throw new ProbeRunError(
        `prémisse non déclarée pour : ${uncovered.join(', ')} — une règle dont on ignore quand elle s'applique ne peut pas être notée`,
      );
    }

    const cases = deps.cases ?? loadProbeCases();
    if (cases.length < PROBE_CASES_MIN) {
      throw new ProbeRunError(
        `corpus trop court : ${String(cases.length)} cas, le minimum de la fiche est ${String(PROBE_CASES_MIN)}`,
      );
    }

    const models = flags(argv, 'model');
    const baseUrls = flags(argv, 'base-url');
    const noToolProbe = argv.includes('--no-tool-probe');
    const providers: ProviderReport[] = [];

    for (const [index, id] of requested.entries()) {
      if (!isProviderId(id)) continue;
      const config = buildConfig(id, env, {
        model: models[index],
        baseUrl: baseUrls[index],
      });
      const select = deps.selectPort ?? selectNarrator;
      const port = select(config);
      /**
       * THE TOOL PROBE GETS ITS OWN PORT, FORCED TO `tools: 'on'`.
       *
       * The measurement runs in production's prose-only mode (ADR 0011), where
       * the adapter does not even transmit a tool table — so probing the
       * MEASURING port would measure the adapter's switch and tell us nothing
       * about the model. `--no-tool-probe` skips it. Held by
       * `run-probe.test.ts` « sonde les outils sur un port force a tools: on,
       * jamais sur le port de mesure ».
       */
      const toolProbe: ToolProbeOutcome = noToolProbe
        ? { ran: false, toolCallSeen: false, detail: '--no-tool-probe' }
        : await (deps.toolProbe ?? probeTools)(select({ ...config, tools: 'on' }));
      const label = `${id} · ${config.model ?? '(sans modèle)'}`;
      providers.push(
        await measureProvider({
          port,
          cases,
          label,
          toolProbe,
          rules,
          timeoutMs: config.timeoutMs,
          progress: (line) => {
            io.err(line);
          },
        }),
      );
    }

    const report: ProbeReport = {
      promptVersion: CONTEUR_PROMPT_VERSION,
      promptFingerprint: fingerprint(CONTEUR_SYSTEM_PROMPT),
      promptEstimatedTokens: estimateTokens(CONTEUR_SYSTEM_PROMPT),
      caseIds: cases.map((probeCase) => probeCase.id),
      samplesPerCase: SAMPLES_PER_CASE,
      hardRuleIds: rules.map((rule) => rule.id),
      providers,
    };
    const mergePath = firstFlag(argv, 'merge');
    const merged: ProbeReport =
      mergePath === null
        ? report
        : { ...report, providers: [...readMerge(mergePath, report), ...providers] };

    const out = firstFlag(argv, 'out') ?? 'probe-report.json';
    io.write(out, `${JSON.stringify(merged, null, 2)}\n`);
    io.out(formatProbeReport(merged));
    io.out(`\nrapport écrit : ${out}`);
    return 0;
  } catch (cause) {
    if (cause instanceof NarratorError) {
      io.err(`échec fournisseur (${cause.providerId}) : ${cause.code} — ${cause.message}`);
      return 1;
    }
    if (cause instanceof ProbeRunError || cause instanceof ProbeCaseError) {
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
    write: (path, body) => {
      writeFileSync(path, body, 'utf8');
    },
  });
}
