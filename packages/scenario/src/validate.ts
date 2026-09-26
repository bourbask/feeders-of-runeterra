/**
 * What makes an answer legal, and what happens when it is not.
 *
 * ── AN INVENTED IDENTIFIER IS REFUSED, AND THE QUESTION IS ASKED AGAIN ───
 * The whole of decision 1 is in `verifyChoice`: the answer must BE one of the
 * candidates we handed over. Nothing is repaired, nothing is guessed, no
 * nearest-neighbour is accepted — a model that answers
 * `figure-qui-nexiste-pas` gets the same question a second time. Held by
 * `build.test.ts` « un identifiant inventé est refusé et l'étape est reposée ».
 *
 * ── THREE FAILURES LAND ON THE DEFAULT, NEVER ON AN EXCEPTION ────────────
 * A build that throws half-way leaves a campaign nobody can play and nobody
 * is there to repair on a Saturday night. So the third refusal takes
 * `candidates[0]` — the first candidate AFTER the shuffle, therefore a
 * function of the seed and reproducible — and the build carries on, marked
 * `viaDefault`. That is a DEGRADATION, and the build says so in its report
 * rather than hiding it.
 *
 * ── WHAT IS NOT VALIDATED, ON PURPOSE ────────────────────────────────────
 * `why` is trimmed, recorded and never interpreted. Refusing an empty
 * justification would spend attempts — and eventually a default — on the one
 * part of the answer that changes nothing in the scenario. The identifier is
 * the contract; the sentence is for the reader.
 */

import type { ScenarioCandidate, ScenarioDecision } from './types.js';

/**
 * How many times a step is asked before it falls on its default.
 *
 * FOR THE CODE, NOT FOR THE ASSERTIONS. The acceptance criterion says three,
 * so the test that proves it writes `3` in full letters rather than importing
 * this constant — a number compared to itself proves nothing (ADR 0007).
 */
export const ATTEMPTS_BEFORE_DEFAULT = 3;

/** Recorded when the model gave no reason, or when the default was taken. */
export const NO_REASON_GIVEN = '(aucune raison donnée)';
export const DEFAULT_TAKEN_REASON =
  'aucune réponse recevable après trois questions : candidat par défaut';

/**
 * A DISCRIMINATED union, not a boolean plus two nullable fields.
 *
 * The shape matters: with `{ accepted: boolean; chosenId: string | null }` the
 * caller has to write `verdict.accepted && verdict.chosenId !== null`, and the
 * second half of that test is a branch no input can ever falsify — an
 * uncoverable line that hides whether the first half was ever exercised.
 */
export type ChoiceVerdict =
  | { readonly accepted: true; readonly chosenId: string; readonly why: string }
  | {
      readonly accepted: false;
      readonly why: string;
      /** French, says what was wrong. */
      readonly reason: string;
    };

/**
 * The default answer of a step: the first candidate after the shuffle.
 *
 * `undefined` only when there is no candidate at all, which is a content
 * problem the build reports as a refusal BEFORE it asks anything.
 */
export function defaultCandidate(
  candidates: readonly ScenarioCandidate[],
): ScenarioCandidate | undefined {
  return candidates[0];
}

export function verifyChoice(
  decision: ScenarioDecision,
  candidates: readonly ScenarioCandidate[],
): ChoiceVerdict {
  const chosenId = decision.choiceId.trim();
  const why = decision.why.trim() === '' ? NO_REASON_GIVEN : decision.why.trim();

  if (chosenId === '') {
    return { accepted: false, why, reason: 'réponse vide : aucun identifiant' };
  }

  const match = candidates.find((candidate) => candidate.id === chosenId);
  if (match === undefined) {
    return {
      accepted: false,
      why,
      reason:
        `identifiant « ${chosenId} » hors de la liste : ` +
        `${String(candidates.length)} candidat(s) étaient proposés`,
    };
  }

  return { accepted: true, chosenId: match.id, why };
}
