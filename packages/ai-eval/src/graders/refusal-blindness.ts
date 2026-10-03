/**
 * `refusal_is_outcome_blind` — the CORPUS grader of section 8.4.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 * It replays the WHOLE corpus twice: once as recorded, once with the outcomes
 * swapped (`franche` ↔ `echec`, the presage untouched), and compares the set
 * of samples whose refusal the server UPHELD. The proof reads the state at the
 * declaration and never the dice, so the two sets must be identical, to the
 * sample.
 *
 * ── WHY IT IS NOT AN ASSERTION ──────────────────────────────────────────────
 * It is not a `(output, ctx) => AssertionResult` and it cannot be one: it
 * needs the whole corpus and two passes over it. That is exactly why
 * `@for/ai` ships twenty-eight assertions and not twenty-nine, and says so in
 * `assertions/index.ts`. It lives here, runs in N0, and costs nothing: the
 * proof is a pure function of the state, the outputs are on disk, and
 * inverting the dice is a transformation of a fixture.
 *
 * ── THE EMPTY-PROBE GUARD ───────────────────────────────────────────────────
 * Two empty sets are equal. A corpus where no refusal is ever upheld would
 * make this grader green over nothing — the sixth failure mode of
 * `docs/RECETTE.md`, a list that is its own source. So an empty straight set
 * is a FAILURE, with that sentence as its detail. Held by
 * `refusal-blindness.test.ts` « un corpus sans aucun refus retenu est un
 * échec, pas un succès ».
 *
 * ── HOW IT REDDENS ──────────────────────────────────────────────────────────
 * Wire the dice into `proveRefusal` — by convenience, by optimisation or by
 * accident — and the two sets part company on the first case whose outcome the
 * inversion moves. There is no way to make it pass by cheating, because the
 * only input that differs between the two passes is the one the proof must not
 * read.
 */

import { readSceneBlock, type RefusalVerdict } from '@for/ai';
import type { SceneBlockRefusal } from '@for/contracts';

import type { EvalCase } from '../cases.js';
import { proveFor } from '../context.js';
import type { EvalFixture } from '../fixtures.js';
import type { RecordedCase } from '../recorded.js';

/**
 * The proof, as a parameter.
 *
 * The signature is `proveFor`'s, FIELD FOR FIELD — five parameters, the fifth
 * being the outcome. A double declared with four would compile without a word
 * and the outcome would stop existing for the whole suite, which is mode 8 of
 * `docs/RECETTE.md` and has already cost this project a wave. The seam exists
 * so that `refusal-blindness.test.ts` can hand in a prover that READS the
 * outcome and prove the grader goes red on it; `run-offline.ts` never passes
 * it, and the default is the production function.
 */
export type RefusalProver = (
  evalCase: EvalCase,
  fixture: EvalFixture,
  refusal: SceneBlockRefusal | null,
  declaredCount: number,
  outcome: string | null,
) => RefusalVerdict;

/** Section 8.4: `franche` ↔ `echec`, and nothing else moves. */
export function invertOutcome(outcome: string | null): string | null {
  if (outcome === 'franche') return 'echec';
  if (outcome === 'echec') return 'franche';
  return outcome;
}

export interface BlindnessEntry {
  readonly evalCase: EvalCase;
  readonly fixture: EvalFixture;
  readonly recorded: RecordedCase;
}

export interface BlindnessVerdict {
  readonly ok: boolean;
  /** `<id>#<échantillon>` of every sample whose refusal was upheld, as recorded. */
  readonly straight: readonly string[];
  /** The same, with the outcomes swapped. */
  readonly inverted: readonly string[];
  /** The samples the two passes disagree on. Empty when `ok`. */
  readonly diverged: readonly string[];
  readonly detail: string;
}

function upheldSamples(
  entries: readonly BlindnessEntry[],
  invert: boolean,
  prove: RefusalProver,
): readonly string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const outcome = invert
      ? invertOutcome(entry.evalCase.turn.fact.outcome)
      : entry.evalCase.turn.fact.outcome;
    for (const [index, sample] of entry.recorded.samples.entries()) {
      const declared =
        readSceneBlock(sample.response, entry.fixture.reservedChampions).block?.refus ?? null;
      if (declared === null) continue;
      const verdict = prove(entry.evalCase, entry.fixture, declared, 1, outcome);
      if (verdict === 'upheld') out.push(`${entry.evalCase.id}#${String(index)}`);
    }
  }
  return out;
}

export function refusalBlindness(
  entries: readonly BlindnessEntry[],
  prove: RefusalProver = proveFor,
): BlindnessVerdict {
  const straight = upheldSamples(entries, false, prove);
  const inverted = upheldSamples(entries, true, prove);
  const left = new Set(straight);
  const right = new Set(inverted);
  const diverged = [
    ...straight.filter((one) => !right.has(one)),
    ...inverted.filter((one) => !left.has(one)),
  ].sort();

  if (straight.length === 0) {
    return {
      ok: false,
      straight,
      inverted,
      diverged: [],
      detail:
        'aucun refus retenu dans le corpus : la sonde comparerait deux ensembles vides et ne garderait rien',
    };
  }
  return {
    ok: diverged.length === 0,
    straight,
    inverted,
    diverged,
    detail:
      diverged.length === 0
        ? `${String(straight.length)} refus retenus, identiques dés inversés`
        : `l'issue a bougé la décision sur : ${diverged.join(', ')}`,
  };
}
