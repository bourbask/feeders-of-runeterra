/**
 * THE UNFINISHED TURN, read back from the journal.
 *
 * M0-34 hands the server a `Decision.pending: BurnWindow | null` and says:
 * persist it, hand it back on the closing intent, and do not call the
 * storyteller while it is open. This file answers the "persist it" half, and
 * it answers it by NOT STORING ANYTHING.
 *
 * WHY THERE IS NO TABLE, AND WHY THAT IS THE STRONGER ANSWER. Invariant 4:
 * every bit of game state replays from an append-only journal. 03-donnees.md
 * section 3.7, point 1 spells out the consequence for this very object —
 * "jauges, souffle, conditions, crans de progression, segments d'horloge,
 * bonus en attente ET FENETRE DE BRULURE reviennent a l'etat d'avant la
 * declaration, PARCE QU'ILS SONT TOUS DERIVES DU JOURNAL ET DE RIEN D'AUTRE.
 * Aucune liste de champs a restaurer a la main." A row in a table would be a
 * field to restore by hand, and `revertTurn` would have to remember it. A
 * process-memory map would be worse: the window would not survive a restart,
 * and the turn would hang with its consequences never applied.
 *
 * So the window is DERIVED, and three properties fall out for free rather than
 * being tested for:
 *
 *   - cancelling the turn brings the window back exactly, because the journal
 *     is what came back;
 *   - a restart mid-window loses nothing;
 *   - `db:rebuild` needs no extra step.
 *
 * WHAT IS READ FROM WHERE. Everything on `BurnWindow` except one field comes
 * from the `roll.action_resolved` payload, which carries the whole arithmetic
 * on purpose (03-donnees.md section 3.4: "un journal qui se lit sans
 * recalculer vaut cher"). The exception is `intent`, the move as the player
 * ASKED for it: `move.declared` keeps only `narrativeInput`, the attribute and
 * the declared adds, so a `strike` would lose its target and a `swear_a_vow`
 * its rank. It is read instead from the `intents` table, which stores the
 * payload the client sent (03-donnees.md section 1.6) and links it to the
 * entries it produced through `first_event_seq .. last_event_seq`.
 */

import { burnWindowClosedBy, collectRevertedSeqs } from '@for/engine';

import type {
  BriefRollDetail,
  BurnWindow,
  GameEvent,
  Intent,
  MoveIntent,
  RollId,
} from '@for/engine';

/**
 * Raised when a window is open and the move that opened it cannot be read back.
 *
 * It is a broken installation, not a player error: the pipeline writes the
 * `intents` row in the SAME transaction as the entries, so the two exist
 * together or not at all. Refusing loudly beats answering "no window", which
 * would leave a turn whose consequences are never applied and whose player is
 * told nothing.
 */
export class BurnWindowIntentMissing extends Error {
  constructor(
    readonly campaignId: string,
    readonly rollSeq: number,
  ) {
    super(
      `fenêtre de brûlure sans intention retrouvable : ${campaignId} au seq ${String(rollSeq)}`,
    );
    this.name = 'BurnWindowIntentMissing';
  }
}

/** `true` for the eleven `move.*` intents, which are the only ones that roll. */
export function isMoveIntent(intent: Intent): intent is MoveIntent {
  return intent.type.startsWith('move.');
}

/** The arithmetic of `roll.action_resolved`, in the shape the brief carries. */
function rollDetail(event: Extract<GameEvent, { type: 'roll.action_resolved' }>): BriefRollDetail {
  const { payload } = event;
  return {
    rollId: payload.rollId,
    attribute: payload.attribute,
    attributeValue: payload.attributeValue,
    actionDie: payload.actionDie,
    adds: payload.adds,
    rawTotal: payload.rawTotal,
    total: payload.total,
    cappedAtTen: payload.cappedAtTen,
    challengeDice: payload.challengeDice,
    momentumNegated: payload.momentumNegated,
    // FALSE, and it has to be: this is the roll BEFORE any burn. M0-34 sets it
    // to `true` on the revised detail, which is a different value of a
    // different turn.
    burned: false,
  };
}

/**
 * The roll still waiting for a burn decision, or `null`.
 *
 * `events` is the campaign's journal in `seq` order. `intentFor` is handed the
 * roll's sequence and answers the move that produced it.
 *
 * CLOSING IS `burnWindowClosedBy` AND NOTHING ELSE. The predicate is exported
 * by `@for/engine` precisely so the caller does not retype the rule — "la
 * fenetre se ferme au premier evenement suivant du meme personnage" — at the
 * one place that sees the next entry. Rewriting it here as
 * `event.subjectCharacterId === window.characterId` would be a second copy of
 * a rule that has to have one.
 */
export function findOpenBurnWindow(
  events: readonly GameEvent[],
  intentFor: (rollSeq: number) => Intent | null,
): BurnWindow | null {
  const reverted = collectRevertedSeqs(events);
  const live = events.filter((event) => !reverted.has(event.seq));

  for (let index = live.length - 1; index >= 0; index -= 1) {
    const event = live[index];
    if (event === undefined) continue;
    if (event.type !== 'roll.action_resolved' || !event.payload.burnWindow) continue;

    const roll = rollDetail(event);
    const candidate = {
      rollSeq: event.seq,
      characterId: event.payload.characterId,
      outcome: event.payload.outcome,
      isPresage: event.payload.isPresage,
      roll,
    };
    // Anything after it about the same character has already shut it.
    const closed = live
      .slice(index + 1)
      .some((later) => burnWindowClosedBy({ ...candidate, intent: PROBE_INTENT }, later));
    if (closed) return null;

    const intent = intentFor(event.seq);
    if (intent === null || !isMoveIntent(intent)) {
      throw new BurnWindowIntentMissing(event.campaignId, event.seq);
    }
    return { ...candidate, intent };
  }
  return null;
}

/**
 * A stand-in `intent` for the `burnWindowClosedBy` call above, and nothing else.
 *
 * The predicate reads `characterId` and `rollSeq`; `BurnWindow` requires an
 * `intent` to be a `BurnWindow`. Reading the real one before knowing whether
 * the window is even open would hit the database for a window that is closed.
 * Named and commented rather than inlined, because a placeholder that travels
 * is how a placeholder ends up in a payload — this one is out of scope one
 * line after it is used.
 */
const PROBE_INTENT: MoveIntent = { type: 'move.endure_cold' };

/** The roll a closing intent names, for the refusal message when it is stale. */
export function targetedRollId(intent: Intent): RollId | null {
  return intent.type === 'momentum.burn' || intent.type === 'momentum.keep' ? intent.rollId : null;
}

/** `true` when this intent is one of the two that close a window explicitly. */
export function isBurnClosingIntent(intent: Intent): boolean {
  return targetedRollId(intent) !== null;
}
