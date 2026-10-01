/**
 * `pnpm eval:record` — refresh what N0 replays (02-mj-ia.md section 8.5).
 *
 * ── TWO HALVES, AND ONLY ONE OF THEM COSTS ANYTHING ─────────────────────────
 * `--requests-only` rewrites the `*.request.json` snapshots and TOUCHES NO
 * NETWORK: they are built by the context builder from the cases, so refreshing
 * them needs no key and no provider. That is the half a developer runs after
 * an intentional change to a prompt template, before reading the diff.
 *
 * The other half calls the configured provider once per sample and rewrites
 * `*.recorded.json`. It is the ONLY file of this package that holds a port,
 * and `run-offline.ts` never imports it — which is what makes « zéro appel
 * réseau » a property of the module graph rather than a promise.
 *
 * ── WHY REFRESHING RECORDINGS IS NOT A FORMALITY ────────────────────────────
 * Section 8.5: N0 fails when the recorded `prompt_version` differs from the
 * current one. So changing a prompt means passing once through here, which
 * means once through a real model. That is deliberate: it is the only thing
 * that stops a prompt being changed on the strength of a reading.
 *
 * ── THE RECORDINGS SHIPPED WITH M0 WERE WRITTEN BY HAND ─────────────────────
 * Said plainly rather than implied. M0 has no key in CI and no game has been
 * played, so the twelve corpora are AUTHORED samples that exercise the rules —
 * including the two that M0-32 measured as the normal case on free models: a
 * malformed `<scene_apres>` and no block at all. They are what N0 replays
 * today; the first `eval:record` against a real provider replaces them.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  CONTEUR_PROMPT_VERSION,
  TOOLS_VERSION,
  selectNarrator,
  type SelectNarratorDeps,
} from '@for/ai';
import {
  NARRATOR_PROVIDER_IDS,
  NarratorError,
  type NarrateRequest,
  type NarratorConfig,
  type NarratorPort,
  type NarratorProviderId,
} from '@for/contracts';
import { stableStringify } from '@for/testkit';

import { CASES_DIR, EvalCaseError, loadCases } from './cases.js';
import { CHRONICLE_DIR, FIXTURES_DIR, fixtureLoader } from './fixtures.js';
import { SAMPLES_PER_CASE } from './recorded.js';
import { requestOf, serialiseRequest } from './request.js';

/** 02-mj-ia.md §0.6, `NARRATOR_TIMEOUT_MS`. A cold local model is slow, not broken. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Raised when the command cannot run at all. One line on stderr, exit 1. */
export class RecordError extends Error {}

/** What each provider needs before a call is worth attempting (§0.6). */
export const RECORD_REQUIRED_ENV: Readonly<Record<NarratorProviderId, readonly string[]>> =
  Object.freeze({
    stub: [],
    anthropic: ['NARRATOR_API_KEY', 'NARRATOR_MODEL'],
    'openai-compatible': ['NARRATOR_BASE_URL', 'NARRATOR_API_KEY', 'NARRATOR_MODEL'],
    ollama: ['NARRATOR_BASE_URL', 'NARRATOR_MODEL'],
  });

export function buildConfig(
  provider: NarratorProviderId,
  env: Readonly<Record<string, string | undefined>>,
): NarratorConfig {
  const missing = RECORD_REQUIRED_ENV[provider].filter((name) => {
    const value = env[name];
    return value === undefined || value.length === 0;
  });
  if (missing.length > 0) {
    throw new RecordError(
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

export interface RecordIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Rewrite every `<id>.request.json`. Pure: no clock, no network, no key. */
export function recordRequests(casesDir: string, io: RecordIo): number {
  const cases = loadCases(casesDir);
  const fixtureOf = fixtureLoader(FIXTURES_DIR, CHRONICLE_DIR);
  for (const evalCase of cases) {
    const bytes = serialiseRequest(requestOf(evalCase, fixtureOf(evalCase.fixture)));
    writeFileSync(join(casesDir, `${evalCase.id}.request.json`), bytes, 'utf8');
    io.out(`· ${evalCase.id}.request.json`);
  }
  return cases.length;
}

async function collect(port: NarratorPort, request: NarrateRequest): Promise<string> {
  let text = '';
  for await (const event of port.narrer(request)) {
    if (event.type === 'end') text = event.result.text;
  }
  return text;
}

export interface RecordOutputsOptions {
  readonly casesDir: string;
  readonly port: NarratorPort;
  readonly model: string;
  /** Injected so a test can pin the instant. The recording is a dated artefact. */
  readonly now: () => Date;
  readonly samplesPerCase?: number;
}

/** Call the provider once per sample and rewrite every `<id>.recorded.json`. */
export async function recordOutputs(options: RecordOutputsOptions, io: RecordIo): Promise<number> {
  const samplesPerCase = options.samplesPerCase ?? SAMPLES_PER_CASE;
  const cases = loadCases(options.casesDir);
  const fixtureOf = fixtureLoader(FIXTURES_DIR, CHRONICLE_DIR);
  let calls = 0;
  for (const evalCase of cases) {
    const request = requestOf(evalCase, fixtureOf(evalCase.fixture));
    const samples: { response: string; tool_calls: string[] }[] = [];
    for (let index = 0; index < samplesPerCase; index += 1) {
      io.out(`· ${evalCase.id} échantillon ${String(index + 1)}/${String(samplesPerCase)}`);
      samples.push({ response: await collect(options.port, request), tool_calls: [] });
      calls += 1;
    }
    writeFileSync(
      join(options.casesDir, `${evalCase.id}.recorded.json`),
      stableStringify({
        case_id: evalCase.id,
        provider: options.port.providerId,
        model: options.model,
        prompt_version: CONTEUR_PROMPT_VERSION,
        tools_version: TOOLS_VERSION,
        recorded_at: options.now().toISOString(),
        samples,
      }),
      'utf8',
    );
  }
  return calls;
}

const readFlag = (argv: readonly string[], name: string): string | null => {
  const prefix = `--${name}=`;
  const found = argv.find((one) => one.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
};

const isProviderId = (value: string): value is NarratorProviderId =>
  (NARRATOR_PROVIDER_IDS as readonly string[]).includes(value);

export interface RecordDeps {
  readonly selectPort?: (config: NarratorConfig, deps?: SelectNarratorDeps) => NarratorPort;
  readonly now?: () => Date;
}

export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: RecordIo,
  deps: RecordDeps = {},
  casesDir: string = CASES_DIR,
): Promise<number> {
  try {
    const count = recordRequests(casesDir, io);
    io.out(`${String(count)} instantané(s) de requête réécrits, zéro appel réseau.`);
    if (argv.includes('--requests-only')) return 0;

    const requested = readFlag(argv, 'provider');
    if (requested === null || !isProviderId(requested)) {
      throw new RecordError(
        `--provider=<${NARRATOR_PROVIDER_IDS.join('|')}> est requis pour enregistrer les sorties` +
          ` (ou --requests-only pour s'arrêter aux requêtes)${requested === null ? '' : ` ; reçu « ${requested} »`}`,
      );
    }
    const config = buildConfig(requested, env);
    const port = (deps.selectPort ?? selectNarrator)(config);
    const calls = await recordOutputs(
      {
        casesDir,
        port,
        model: config.model ?? requested,
        now: deps.now ?? ((): Date => new Date()),
      },
      io,
    );
    io.out(`${String(calls)} appel(s) au fournisseur, enregistrements réécrits.`);
    return 0;
  } catch (cause) {
    if (cause instanceof NarratorError) {
      io.err(`échec fournisseur (${cause.providerId}) : ${cause.code} — ${cause.message}`);
      return 1;
    }
    if (cause instanceof RecordError || cause instanceof EvalCaseError) {
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
