/**
 * What a grader is, and which of its verdicts close the door.
 *
 * ── THE FAMILIES PARTITION `ASSERTIONS`, AND A TEST SAYS SO ─────────────────
 * Each grader owns a list of identifiers; the six lists are disjoint and their
 * union is exactly `Object.keys(ASSERTIONS)`, imported from `@for/ai`. That is
 * the M0-27 criterion « l'ensemble des identifiants exercés par `eval:offline`
 * est exactement `Object.keys(ASSERTIONS)` », and it is what makes a local
 * copy of an assertion impossible to hide: a copy would leave the two sets
 * disagreeing and the test names the gap. Held by `graders/index.test.ts`
 * « les six familles partitionnent ASSERTIONS, sans trou ni recouvrement ».
 *
 * A list here is TRAVERSED, never pinned: emptying one makes the partition
 * test fall, and makes the checks it carried stop being reported.
 *
 * ── WHAT GATES ──────────────────────────────────────────────────────────────
 * `hard: true` — the set section 8.6 feeds to the production post-filter —
 * plus `no_refusal` and `refusal_matches`. Those two are soft in `@for/ai`
 * because the post-filter runs on PROSE and they read the refusal proof, not
 * the text; in N0 the proof is available and both are deterministic, and the
 * acceptance criteria make them gates in as many words: « un refus retenu sur
 * ce cas fait sortir en 1 ». Everything else — the three register heuristics
 * and `ends_concrete` — is reported and never blocks, exactly as section 8.4
 * asks: « on ne construit pas de porte bloquante » sur une heuristique de
 * morphologie française.
 */

import { ASSERTIONS, type Assertion } from '@for/ai';

import type { EvalCase } from '../cases.js';
import type { SampleView } from '../context.js';
import type { EvalFixture } from '../fixtures.js';
import type { RecordedCase, RecordedSample } from '../recorded.js';

/**
 * The two identifiers that gate although `@for/ai` marks them soft.
 *
 * Spelled out rather than derived: a derived list would be a list that reads
 * its own answer from the thing it checks.
 */
export const GATING_BEYOND_HARD: readonly string[] = ['no_refusal', 'refusal_matches'];

export interface Check {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
  /** False ⇒ reported in the report, never in the exit code. */
  readonly gating: boolean;
}

export interface GraderInput {
  readonly evalCase: EvalCase;
  readonly fixture: EvalFixture;
  readonly recorded: RecordedCase;
  readonly sample: RecordedSample;
  readonly sampleIndex: number;
  readonly view: SampleView;
  /** F2: everything before `<scene_apres>`, the only text players ever see. */
  readonly prose: string;
}

export interface Grader {
  readonly name: string;
  /** The family's share of `ASSERTIONS`. Traversed, never pinned. */
  readonly ids: readonly string[];
  readonly run: (input: GraderInput) => readonly Check[];
}

export const gates = (assertion: Assertion): boolean =>
  assertion.hard || GATING_BEYOND_HARD.includes(assertion.id);

/** Raised when a family names an identifier `@for/ai` does not export. */
export class UnknownCheckError extends Error {}

/**
 * Run a family's identifiers on the prose.
 *
 * The prose, not the whole answer: section 8.6 says the filter reads the text
 * before `<scene_apres>`, and the eval must grade what the player will see.
 * `scene_block_consistent` is the exception the spec names, and it reads
 * `ctx.sceneBlock` rather than its first argument, so it works either way.
 */
export function runFamily(ids: readonly string[], input: GraderInput): readonly Check[] {
  return ids.map((id) => {
    const found = ASSERTIONS[id];
    if (found === undefined) throw new UnknownCheckError(`« ${id} » n'existe pas dans @for/ai`);
    const result = found.run(input.prose, input.view.context);
    return { id: result.id, passed: result.passed, detail: result.detail, gating: gates(found) };
  });
}
