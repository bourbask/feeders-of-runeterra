/**
 * The local token estimator (02-mj-ia.md section 4.3).
 *
 * An exact count is a NETWORK CALL, and no blocking pull-request test ever
 * calls a provider — that is a rule, not a convenience (section 4.2). So the
 * budget and `prompt-size.test.ts` both measure with this, and the nightly
 * workflow, which has a key, is what compares it to the real count and fails
 * past eight per cent of drift.
 *
 * Calibrated for FRENCH prose. `chars / 3.6` is the spec's figure, written
 * once here so that `src/context/budget.ts` (M0-22) reuses it instead of
 * declaring a second estimator — two estimators is how a budget and a size
 * test start disagreeing about the same prompt.
 */

/** Characters per token, French, per section 4.3. */
export const CHARS_PER_TOKEN = 3.6;

/** Section 4.3's estimator, rounded up: a budget is never optimistic. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
