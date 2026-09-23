/**
 * The golden corpus runner.
 *
 * `expectGolden('challenge-matrix', rows)` compares the serialised value with
 * `tests/golden/challenge-matrix.golden.json`. Its whole job is to make a
 * change of rule VISIBLE in a diff instead of silent.
 *
 * Which is why it refuses three things, all three of them ways a corpus can
 * stop proving anything while still going green:
 *
 * 1. **Drift** — the value differs from the file. Obvious, and the easy case.
 * 2. **A MISSING file** — this one is the trap. A runner that treats "no file
 *    yet" as "nothing to compare, fine" turns a corpus deleted by mistake, or
 *    a renamed test, into a suite that passes forever over an empty oracle.
 *    A missing corpus is a failure, and the message says how to create it on
 *    purpose.
 * 3. **`GOLDEN_UPDATE` by accident** — rewriting is opt-in, never the default,
 *    and only the exact value `1` turns it on. Anything else (`true`, `yes`,
 *    `0`) is refused OUT LOUD rather than ignored: someone who typed
 *    `GOLDEN_UPDATE=true` believes their corpus was regenerated, and a silent
 *    no-op would let them commit a stale file thinking otherwise. CI refuses
 *    the variable's mere presence (job 7 of `ci.yml`, delivered by M0-03);
 *    this is the same door, on the runner side.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import { stableStringify } from './stable-stringify.js';

/** The environment variable that turns rewriting on. Exported so tests name it once. */
export const GOLDEN_UPDATE_ENV = 'GOLDEN_UPDATE';

/** The only value that enables rewriting. */
const GOLDEN_UPDATE_ON = '1';

const SUFFIX = '.golden.json';

/** A corpus name: `challenge-matrix`, or `dice/challenge-matrix`. No escaping upwards. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Thrown when the value drifted away from the corpus. */
export class GoldenMismatch extends Error {
  readonly file: string;

  constructor(file: string, report: string) {
    super(`${file}\n${report}`);
    this.name = 'GoldenMismatch';
    this.file = file;
  }
}

/** Thrown when the corpus file does not exist. Never a silent pass. */
export class GoldenMissing extends Error {
  readonly file: string;

  constructor(file: string) {
    super(
      `${file} does not exist. A missing corpus is a failure, not an empty ` +
        `comparison: a corpus deleted by mistake would otherwise keep the suite green ` +
        `forever. Create it on purpose with \`${GOLDEN_UPDATE_ENV}=${GOLDEN_UPDATE_ON} ` +
        `pnpm test:golden\`, then READ the file before committing it.`,
    );
    this.name = 'GoldenMissing';
    this.file = file;
  }
}

/** Thrown when `GOLDEN_UPDATE` holds something other than `1`. */
export class GoldenUpdateMisused extends Error {
  constructor(value: string) {
    super(
      `${GOLDEN_UPDATE_ENV}=${JSON.stringify(value)}. Only ` +
        `${GOLDEN_UPDATE_ENV}=${GOLDEN_UPDATE_ON} rewrites the corpora. Any other value is ` +
        `refused rather than ignored, because ignoring it would let you believe a corpus ` +
        `was regenerated when it was not.`,
    );
    this.name = 'GoldenUpdateMisused';
  }
}

export interface GoldenOptions {
  /**
   * Where the corpora live. Defaults to `<cwd>/tests/golden`, and under Vitest
   * the working directory is the package root, so each package keeps its own.
   */
  readonly dir?: string;
}

/**
 * Whether rewriting is on. Reads the environment on every call — no module-level
 * snapshot, so a test can set the variable and see it take effect.
 *
 * @throws GoldenUpdateMisused when the variable holds anything but `1`.
 */
export function goldenUpdateRequested(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = env[GOLDEN_UPDATE_ENV];
  if (raw === undefined || raw === '') return false;
  if (raw !== GOLDEN_UPDATE_ON) throw new GoldenUpdateMisused(raw);
  return true;
}

function goldenPath(name: string, options: GoldenOptions | undefined): string {
  if (!NAME.test(name)) {
    throw new RangeError(
      `expectGolden: ${JSON.stringify(name)} is not a corpus name. Expected something like ` +
        `"challenge-matrix" or "dice/challenge-matrix" — no leading slash, no "..".`,
    );
  }
  const dir = options?.dir ?? join(process.cwd(), 'tests', 'golden');
  const file = name.endsWith(SUFFIX) ? name : `${name}${SUFFIX}`;
  return resolve(dir, file);
}

/**
 * First divergence, with its neighbours. A 300-line corpus whose report is
 * "not equal" is a report nobody can act on.
 */
function report(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const height = Math.max(expectedLines.length, actualLines.length);

  let first = -1;
  for (let i = 0; i < height; i += 1) {
    if (expectedLines[i] !== actualLines[i]) {
      first = i;
      break;
    }
  }
  if (first === -1) {
    // Unreachable: `report` is only called on two different strings, and two
    // strings with the same lines are the same string. Defensive, so that an
    // impossible case says so instead of pointing at line 0.
    return (
      `the two differ, but not on any line (corpus ${String(expected.length)} bytes, ` +
      `value ${String(actual.length)} bytes).`
    );
  }

  const from = Math.max(0, first - 2);
  const to = Math.min(height, first + 3);
  const excerpt: string[] = [];
  for (let i = from; i < to; i += 1) {
    const mark = i === first ? '>' : ' ';
    excerpt.push(
      `${mark} ${String(i + 1).padStart(5)} corpus: ${expectedLines[i] ?? '(end of file)'}`,
      `${mark} ${String(i + 1).padStart(5)} value : ${actualLines[i] ?? '(end of value)'}`,
    );
  }
  return (
    `first difference at line ${String(first + 1)}:\n${excerpt.join('\n')}\n` +
    `If the change is intended, regenerate with \`${GOLDEN_UPDATE_ENV}=${GOLDEN_UPDATE_ON}\` ` +
    `and READ the diff.`
  );
}

/**
 * Compare `value` with its corpus — or rewrite the corpus when
 * `GOLDEN_UPDATE=1`.
 *
 * Returns nothing and throws on failure, so it works under any runner: it needs
 * no `expect`, and therefore no assertion library to be honest.
 */
export function expectGolden(name: string, value: unknown, options?: GoldenOptions): void {
  const file = goldenPath(name, options);
  const serialised = stableStringify(value);

  if (goldenUpdateRequested()) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serialised, 'utf8');
    return;
  }

  if (!existsSync(file)) {
    throw new GoldenMissing(file);
  }

  const corpus = readFileSync(file, 'utf8');
  if (corpus !== serialised) {
    throw new GoldenMismatch(file, report(corpus, serialised));
  }
}
