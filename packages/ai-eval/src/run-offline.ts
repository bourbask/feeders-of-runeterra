/**
 * `pnpm eval:offline` — niveau N0 (02-mj-ia.md section 8.5).
 *
 * ── THE ONE QUESTION ────────────────────────────────────────────────────────
 * « Ai-je cassé le conteur ? », answered in seconds, WITHOUT A KEY AND WITHOUT
 * SPENDING A CENTIME. Two checks and no third:
 *
 *  1. the SNAPSHOT of the built `NarrateRequest` — the port's request, so that
 *     changing `NARRATOR_PROVIDER` moves nothing — which also protects the
 *     cacheable prompt prefix;
 *  2. the twenty-eight ASSERTIONS replayed on RECORDED outputs, plus the
 *     corpus grader `refusal_is_outcome_blind` and the chronicle's nine
 *     checks.
 *
 * ── ZERO NETWORK CALLS, AND IT IS STRUCTURAL ────────────────────────────────
 * Nothing on this file's import graph can reach a provider. The recording
 * command is the single module of this package that holds a port, and it is
 * imported by nothing here. Held by `run-offline.test.ts` « le runner hors
 * ligne n'atteint ni record.ts ni le port du conteur », which walks the
 * sources rather than trusting this paragraph — and the two names it greps
 * for are ELIDED in this comment, because spelling them here is what made
 * that test red the first time it ran. Measured, not guessed.
 *
 * ── WHAT N0 DOES NOT DO ─────────────────────────────────────────────────────
 * N1 (`eval:live`), N2 (`eval:judge`) and `forge/` are NOT here. They consume
 * a key, they gate nothing in M0, and their value is nil until a game has been
 * played. Their root scripts already exist and exit 1 saying which milestone
 * fills them.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import { CONTEUR_PROMPT_VERSION } from '@for/ai';
import { stableStringify } from '@for/testkit';

import { CASES_DIR, CASES_MIN, EvalCaseError, loadCases, type EvalCase } from './cases.js';
import { checkChronicle, type ChronicleVerdict } from './chronicle.js';
import { viewSample } from './context.js';
import { CHRONICLE_DIR, FIXTURES_DIR, fixtureLoader, type EvalFixture } from './fixtures.js';
import { GRADERS } from './graders/index.js';
import type { Check } from './graders/kit.js';
import { refusalBlindness, type BlindnessEntry } from './graders/refusal-blindness.js';
import { loadRecorded, type RecordedCase } from './recorded.js';
import {
  advisoriesOf,
  failuresOf,
  formatReport,
  ratesOf,
  reportJson,
  type CaseReport,
  type OfflineReport,
  type SampleReport,
} from './report.js';
import { diffRequests, requestOf, serialiseRequest } from './request.js';

/** Where the JSON artefact lands. The CI job of `ai-eval.yml` uploads this folder. */
export const DEFAULT_REPORT_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'reports',
  'ai-eval',
  'eval-report.json',
);

export interface OfflineOptions {
  readonly casesDir?: string;
  readonly fixturesDir?: string;
  readonly chronicleDir?: string;
  /** Injected so the tests can run a corpus of their own making. */
  readonly cases?: readonly EvalCase[];
}

const graderChecks = (
  evalCase: EvalCase,
  fixture: EvalFixture,
  recorded: RecordedCase,
): readonly SampleReport[] =>
  recorded.samples.map((sample, index) => {
    const view = viewSample(evalCase, fixture, sample);
    const input = {
      evalCase,
      fixture,
      recorded,
      sample,
      sampleIndex: index,
      view,
      prose: view.reading.prose,
    };
    const checks: Check[] = [];
    for (const grader of GRADERS) checks.push(...grader.run(input));
    return { index, checks };
  });

/**
 * Aggregate the chronicle verdict over EVERY case's scene.
 *
 * C9 — « la chronique contredit l'état de scène sur un mort » — only bites on
 * a scene that holds a dead NPC, and T4/T7 group the document differently per
 * scene. Validating against one arbitrary scene would leave C9 asleep on the
 * eleven others; validating against all of them costs nothing offline.
 */
function chronicleOver(
  cases: readonly EvalCase[],
  fixtureOf: (name: string) => EvalFixture,
): ChronicleVerdict {
  const violations: { check: string; detail: string }[] = [];
  let tokenCount = 0;
  let renderedChars = 0;
  for (const one of cases) {
    const verdict = checkChronicle(fixtureOf(one.fixture), one.turn.sceneIn);
    tokenCount = Math.max(tokenCount, verdict.tokenCount);
    renderedChars = Math.max(renderedChars, verdict.renderedChars);
    for (const violation of verdict.violations) {
      violations.push({ check: violation.check, detail: `${one.id} — ${violation.detail}` });
    }
  }
  return { ok: violations.length === 0, violations, tokenCount, renderedChars };
}

export function runOffline(options: OfflineOptions = {}): OfflineReport {
  const started = Date.now();
  const casesDir = options.casesDir ?? CASES_DIR;
  const cases = options.cases ?? loadCases(casesDir);
  if (cases.length < CASES_MIN) {
    throw new EvalCaseError(
      `${String(cases.length)} cas dans ${casesDir} : la fiche M0-27 en exige au moins ${String(CASES_MIN)}`,
    );
  }

  const fixtureOf = fixtureLoader(
    options.fixturesDir ?? FIXTURES_DIR,
    options.chronicleDir ?? CHRONICLE_DIR,
  );

  const reports: CaseReport[] = [];
  const blindnessEntries: BlindnessEntry[] = [];

  for (const evalCase of cases) {
    const fixture = fixtureOf(evalCase.fixture);
    const built = serialiseRequest(requestOf(evalCase, fixture));
    const snapshotPath = join(casesDir, `${evalCase.id}.request.json`);
    let snapshot: string;
    try {
      snapshot = readFileSync(snapshotPath, 'utf8');
    } catch {
      throw new EvalCaseError(
        `${evalCase.id}.request.json manquant : lancer « pnpm eval:record --requests-only »`,
      );
    }
    const recorded = loadRecorded(evalCase.id, casesDir);
    blindnessEntries.push({ evalCase, fixture, recorded });

    reports.push({
      id: evalCase.id,
      title: evalCase.title,
      tags: evalCase.tags,
      requestMatches: snapshot === built,
      requestDiff: snapshot === built ? [] : diffRequests(snapshot, built),
      samples: graderChecks(evalCase, fixture, recorded),
    });
  }

  const chronicle = chronicleOver(cases, fixtureOf);
  const blindness = refusalBlindness(blindnessEntries);
  const failures = failuresOf(reports, chronicle, blindness);

  return {
    ok: failures.length === 0,
    promptVersion: CONTEUR_PROMPT_VERSION,
    caseCount: reports.length,
    sampleCount: reports.reduce((sum, one) => sum + one.samples.length, 0),
    cases: reports,
    chronicle,
    blindness,
    rates: ratesOf(reports),
    failures,
    advisories: advisoriesOf(reports),
    durationMs: Date.now() - started,
  };
}

export interface OfflineIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const readFlag = (argv: readonly string[], name: string): string | null => {
  const prefix = `--${name}=`;
  const found = argv.find((one) => one.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
};

/** The whole command: argv in, exit code out. */
export function main(argv: readonly string[], io: OfflineIo, options: OfflineOptions = {}): number {
  try {
    const report = runOffline(options);
    const path = readFlag(argv, 'out') ?? DEFAULT_REPORT_PATH;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stableStringify(reportJson(report)), 'utf8');
    io.out(formatReport(report));
    io.out(`Rapport : ${path}`);
    return report.ok ? 0 : 1;
  } catch (cause) {
    io.err(cause instanceof EvalCaseError ? cause.message : `échec inattendu : ${String(cause)}`);
    return 1;
  }
}

/** Only when invoked as the command, so the tests can import the pieces. */
const invokedAs = process.argv[1];
if (invokedAs !== undefined && resolve(invokedAs) === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
}
