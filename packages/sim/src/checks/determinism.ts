/**
 * Two runs, one seed, one hash — and the trap that sits right next to it.
 *
 * ── REJOUABILITÉ N'EST PAS RÉPÉTITION ────────────────────────────────────
 * Two properties live in this file and they pull in OPPOSITE directions.
 * Proving only the first is how a cancellation becomes a machine for
 * re-rolling until the result is good:
 *
 *   1. SAME SEED, SAME JOURNAL. Running a scenario twice from scratch gives
 *      byte-identical journals. That is invariant 4's promise.
 *   2. A CANCELLED TURN, REPLAYED, DOES NOT GIVE BACK THE SAME DICE.
 *      03-donnees.md §3.7: "l'index de tirage RNG n'est JAMAIS libéré".
 *      `system.reverted` is itself appended, so the campaign's `seq` has
 *      moved, and the draw of the next decision derives from `(seed,
 *      state.seq + 1, stream)`. Replaying the same intent must therefore
 *      produce a DIFFERENT action die — and if it does not, the right of
 *      refusal and the cancel button are an exploit.
 *
 * `checkDeterminism` holds the first. `checkRerollAfterRevert` holds the
 * second, and it is written as a REFUSAL: it fails when the dice come back
 * equal, which is the direction nobody thinks to test.
 */

import type { GameEvent } from '@for/engine';

export interface DeterminismIssue {
  readonly issue: string;
}

/** Two hashes of the same seed must be equal. */
export function checkDeterminism(first: string, second: string): readonly DeterminismIssue[] {
  if (first === second) return [];
  return [
    {
      issue: `deux exécutions de la même graine donnent deux journaux : ${first.slice(0, 16)}… et ${second.slice(0, 16)}…`,
    },
  ];
}

/** The action dice of a journal, in order, with the sequence that drew them. */
export function actionDraws(
  journal: readonly GameEvent[],
): readonly { readonly seq: number; readonly actionDie: number; readonly index: number }[] {
  const draws: { seq: number; actionDie: number; index: number }[] = [];
  for (const event of journal) {
    if (event.type !== 'roll.action_resolved') continue;
    draws.push({
      seq: event.seq,
      actionDie: event.payload.actionDie,
      index: event.rngDrawIndex ?? -1,
    });
  }
  return draws;
}

/**
 * The cancelled turn, and the one that replaced it, must not draw from the
 * same place.
 *
 * ── WHY THIS COMPARES INDICES AND NOT DICE ──────────────────────────────
 * The obvious assertion — "the action die changed" — IS WRONG, and measured
 * wrong: on `04-momentum-edge-cases` the cancelled roll and its replay both
 * showed a 3, at draw indices 2 and 3. A six-sided die repeats one time in
 * six, so that assertion fails one seed in six for a system that is behaving
 * perfectly, and passes five times in six for a system that has rewound its
 * counter and drawn the same value again. It measures luck.
 *
 * WHAT THE RULE ACTUALLY SAYS is 03-donnees.md §3.7: "l'index de tirage RNG
 * n'est JAMAIS libéré". So the assertion is on the INDEX: the replayed roll
 * must sit STRICTLY PAST the cancelled one on its stream. That is true or
 * false regardless of what the dice showed, and it is the property that makes
 * cancelling useless as a re-roll button.
 *
 * @param before the action roll of the turn that was cancelled.
 * @param after the action roll of the SAME intent, replayed afterwards.
 */
export function checkRerollAfterRevert(
  before: { readonly seq: number; readonly index: number } | undefined,
  after: { readonly seq: number; readonly index: number } | undefined,
): readonly DeterminismIssue[] {
  if (before === undefined || after === undefined) {
    return [
      {
        issue:
          'le contrôle « annuler puis rejouer » n’a pas trouvé ses deux jets : il ne prouve ' +
          'rien et ne doit pas passer pour vert',
      },
    ];
  }
  if (before.seq === after.seq) {
    return [{ issue: 'le jet rejoué porte le même `seq` que le jet annulé : rien n’a été rejoué' }];
  }
  if (after.index <= before.index) {
    return [
      {
        issue:
          `l'index de tirage est passé de ${String(before.index)} (seq ${String(before.seq)}) à ` +
          `${String(after.index)} (seq ${String(after.seq)}) : il a reculé ou stagné, et annuler ` +
          `devient une machine à relancer jusqu'au bon résultat`,
      },
    ];
  }
  return [];
}

/**
 * The stream counter of the replayed state must still count the cancelled
 * draw.
 *
 * TWO ORIGINS: the number of `roll.action_resolved` entries in the journal —
 * the cancelled one INCLUDED, because the journal is append-only and it is
 * still there — against `CampaignState.rng.draws.action`, which `reduceAll`
 * advances even for an entry it skips. Equal means nothing was given back.
 */
export function checkDrawCounter(
  journal: readonly GameEvent[],
  draws: Readonly<Record<string, number>>,
): readonly DeterminismIssue[] {
  const rolled = journal.filter((event) => event.rngStream === 'action').length;
  const counted = draws['action'] ?? 0;
  if (counted === rolled) return [];
  return [
    {
      issue:
        `le journal porte ${String(rolled)} tirages sur le flux « action » et l'état en compte ` +
        `${String(counted)} : un index a été rendu`,
    },
  ];
}
