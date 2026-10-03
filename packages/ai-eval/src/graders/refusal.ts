/**
 * `refusal` — the right of refusal, case by case.
 *
 * ── THE LIMIT THIS EXISTS TO HOLD ───────────────────────────────────────────
 * The right of refusal covers the IMPOSSIBLE, never the ridiculous. Braiding
 * a dead man's beard is absurd and materially possible: it is played. A case
 * tagged `refusal: none` therefore fails the moment a refusal is UPHELD on it,
 * and that is what stops anybody building a storyteller that refuses
 * everything — the failure mode section 4.8.5 names.
 *
 * A refusal the server REJECTED is not a failure: the model pointed at a fact,
 * the server re-checked it and said no, the turn played normally. That is the
 * mechanism working.
 *
 * ── THE EXPECTED REJECTION REASON ───────────────────────────────────────────
 * `refusal_matches` compares verdict, cause and target. It does NOT compare
 * the rejection reason (R1 → R7), because `RefusalObservation` does not carry
 * one. A case that expects `rejected` with a named `reason` would therefore be
 * graded on three fields out of four — so this grader checks the fourth
 * itself, from the proof's own view. Reported here rather than left implied.
 */

import { proveFor } from '../context.js';
import { runFamily, type Check, type Grader, type GraderInput } from './kit.js';

export const REFUSAL_IDS: readonly string[] = ['no_refusal', 'refusal_matches'];

function reasonCheck(input: GraderInput): Check {
  const expected = input.evalCase.refusal?.reason ?? null;
  if (expected === null) {
    return { id: 'refusal_reason', passed: true, detail: 'aucune raison attendue', gating: false };
  }
  const declared = input.view.reading.block?.refus ?? null;
  const verdict =
    declared === null
      ? null
      : proveFor(input.evalCase, input.fixture, declared, 1, input.evalCase.turn.fact.outcome);
  const actual = verdict === null || verdict === 'upheld' ? null : verdict.rejected;
  return {
    id: 'refusal_reason',
    passed: actual === expected,
    detail:
      actual === expected ? expected : `attendu ${expected}, obtenu ${actual ?? 'aucun rejet'}`,
    gating: true,
  };
}

/**
 * `no_refusal` gates on every case EXCEPT one that expects an upheld refusal.
 *
 * Section 8.4 defines it as « un refus est retenu sur un cas marqué possible » —
 * it is the check for a case that must be PLAYED. `@for/ai` cannot know that:
 * its implementation fails on any upheld refusal, which is right for the ten
 * cases that expect none and wrong for the one that expects one. So the
 * verdict is still computed and still printed — the identifier stays exercised
 * — and it stops counting towards the exit code on a case whose `expect.refusal`
 * says `upheld`. The downgrade is NARROW on purpose: `rejected` and `none` both
 * keep the gate. Held by `refusal.test.ts` « no_refusal ne bloque pas un cas
 * qui attend un refus retenu, et bloque partout ailleurs ».
 */
const downgrade = (check: Check, input: GraderInput): Check =>
  check.id === 'no_refusal' && input.evalCase.refusal?.verdict === 'upheld'
    ? { ...check, gating: false }
    : check;

export const refusalGrader: Grader = {
  name: 'refusal',
  ids: REFUSAL_IDS,
  run: (input) => [
    ...runFamily(REFUSAL_IDS, input).map((check) => downgrade(check, input)),
    reasonCheck(input),
  ],
};
