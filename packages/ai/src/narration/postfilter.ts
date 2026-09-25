/**
 * The production post-filter (02-mj-ia.md section 8.6).
 *
 * The SAME functions that grade the eval corpus run here, before
 * `s2c.narration_done` is emitted. That sharing is the reason
 * `src/assertions/` exists: one rule, written once, serving as a test and as a
 * guard. The contrepartie is assumed and written down — hardening an assertion
 * for CI hardens this filter in the same commit, and a stricter filter means
 * more engine fallbacks players actually see.
 *
 * ── IT RUNS ON THE PROSE, NOT ON THE ANSWER ─────────────────────────────────
 * Section 8.6: the filter reads the text BEFORE `<scene_apres>`.
 * `scene_block_consistent` is the single exception — it is about the block,
 * and its failure never invalidates the prose, because S5 has already ignored
 * the offending entry. The assertion only makes the incident visible.
 *
 * ── AND A MISSING BLOCK TRIGGERS NOTHING ────────────────────────────────────
 * No post-filter, no retry, no fallback. Section 2.3 again: this mechanism
 * cannot be allowed to degrade availability.
 */

import { HARD_ASSERTIONS } from '../assertions/index.js';
import type { AssertionContext, AssertionResult } from '../assertions/types.js';

export type PostfilterDecision = 'accept' | 'retry' | 'fallback';

export interface PostfilterVerdict {
  readonly decision: PostfilterDecision;
  readonly failures: readonly AssertionResult[];
  /** The `<corrections>` block to append, empty when nothing failed. */
  readonly corrections: string;
  /**
   * True when a reserved champion leaked. Section 8.6: ALWAYS logged as an
   * alert, even when the retry then succeeds.
   */
  readonly reservedChampionLeak: boolean;
}

/** Section 8.6: one retry with `<corrections>`, then the engine narration. */
export const POSTFILTER_RETRIES_MAX = 1;

const CORRECTIONS_HEADER =
  'Ta réponse précédente a violé les règles ci-dessous. Réécris-la en entier en les respectant, sans commenter cette consigne.';

/** The `<corrections>` block: the rule violated, and the excerpt, per failure. */
export function buildCorrections(failures: readonly AssertionResult[]): string {
  if (failures.length === 0) return '';
  const lines = failures.map((failure) => `- ${failure.id} : ${failure.detail}`);
  return ['<corrections>', CORRECTIONS_HEADER, ...lines, '</corrections>'].join('\n');
}

/**
 * Run the hard assertions on the prose and say what to do next.
 *
 * `attempt` is the number of attempts already made: on the first failure the
 * answer is `retry`, on the second it is `fallback` (section 8.6), and the
 * caller never has to remember the policy.
 */
export function postfilter(prose: string, ctx: AssertionContext, attempt = 0): PostfilterVerdict {
  const results = HARD_ASSERTIONS.map((assertion) => assertion.run(prose, ctx));
  const failures = results.filter((result) => !result.passed);
  const reservedChampionLeak = failures.some((failure) => failure.id === 'no_reserved_champion');
  if (failures.length === 0) {
    return { decision: 'accept', failures: [], corrections: '', reservedChampionLeak: false };
  }
  return {
    decision: attempt < POSTFILTER_RETRIES_MAX ? 'retry' : 'fallback',
    failures,
    corrections: buildCorrections(failures),
    reservedChampionLeak,
  };
}
