/**
 * THE UNFINISHED TURNS, read back from the journal. Plural, and that plural is
 * the whole correction of this file.
 *
 * M0-34 hands the server a `Decision.pending: BurnWindow | null` and says:
 * persist it, hand it back on the closing intent, and do not call the
 * storyteller while it is open. This file answers the "persist it" half, and
 * it answers it by NOT STORING ANYTHING.
 *
 * ── WHY THERE IS A LIST AND NOT A WINDOW ─────────────────────────────────
 * ARCHITECTURE.md section 4.4, first row: "Ordre du tour : AUCUN. La table est
 * libre." Two players may therefore be waiting on a burn decision at the same
 * moment, and that is the NORMAL state of a table, not an edge case: the
 * window opens whenever the momentum beats the score. Answering "the last
 * window of the journal" made the second roll hide the first — the first
 * player's `momentum.burn` AND `momentum.keep` were both refused
 * `no_burn_window`, their `move.resolved` was never written, their
 * consequences were never applied, and `move_in_progress` stopped refusing
 * their next move. A turn lost in silence.
 *
 * So the reader answers EVERY open window, and the caller picks the one it
 * means: the ACTOR's, for the safety net and for `move_in_progress`, or the
 * one the closing intent NAMES, through `windowTargetedBy`. A window per
 * character is the most there can be — any later entry about that character
 * shuts theirs (`burnWindowClosedBy`).
 *
 * ── WHY THERE IS NO TABLE, AND WHY THAT IS THE STRONGER ANSWER ───────────
 * Invariant 4: every bit of game state replays from an append-only journal.
 * 03-donnees.md section 3.7, point 1 spells out the consequence for this very
 * object — "jauges, souffle, conditions, crans de progression, segments
 * d'horloge, bonus en attente ET FENETRE DE BRULURE reviennent a l'etat
 * d'avant la declaration, PARCE QU'ILS SONT TOUS DERIVES DU JOURNAL ET DE RIEN
 * D'AUTRE. Aucune liste de champs a restaurer a la main." A row in a table
 * would be a field to restore by hand, and `revertTurn` would have to remember
 * it. A process-memory map would be worse: the window would not survive a
 * restart, and the turn would hang with its consequences never applied.
 *
 * So the window is DERIVED, and three properties fall out for free rather than
 * being tested for:
 *
 *   - cancelling the turn brings the window back exactly, because the journal
 *     is what came back;
 *   - a restart mid-window loses nothing;
 *   - `db:rebuild` needs no extra step.
 *
 * ── WHAT IS READ FROM WHERE ──────────────────────────────────────────────
 * Most of `BurnWindow` comes from the `roll.action_resolved` payload, which
 * carries the whole arithmetic on purpose (03-donnees.md section 3.4: "un
 * journal qui se lit sans recalculer vaut cher"). Three fields come from
 * elsewhere, and each has a reason:
 *
 *   - `correlationId` and `declarationId` are the journal's own envelope: the
 *     group the turn is already written under, and the `move.declared` every
 *     entry of it hangs from. The engine mints a placeholder group per call
 *     (`toAppendable` replaces it), so the JOURNAL is the authority here, not
 *     `Decision.pending`;
 *   - `intent` is the move as the player ASKED for it: `move.declared` keeps
 *     only `narrativeInput`, the attribute and the declared adds, so a
 *     `strike` would lose its target and a `swear_a_vow` its rank. It is read
 *     from the `intents` table, which stores the payload the client sent
 *     (03-donnees.md section 1.6) and links it to the entries it produced
 *     through `first_event_seq .. last_event_seq`;
 *   - `plan` is what the engine made of that intent AT DECLARATION TIME, and
 *     the word that matters is `TIME`. 03-donnees.md section 3.4: "le plan du
 *     mouvement est porte par la fenetre, jamais recalcule a la fermeture". It
 *     is rebuilt by replaying the journal up to the declaration and planning
 *     against THAT state — a pure function of a prefix of an append-only log,
 *     so it gives the same plan the engine gave, and a scene closed between
 *     the dice and the decision cannot strand the window.
 */

import { burnWindowClosedBy, collectRevertedSeqs, NO_RESOLUTION } from '@for/engine';

import type {
  BriefRollDetail,
  BurnWindow,
  CharacterId,
  GameEvent,
  Intent,
  MoveIntent,
  MovePlan,
  RollId,
} from '@for/engine';

/**
 * Raised when a window is open and what opened it cannot be read back.
 *
 * It is a broken installation, not a player error: the pipeline writes the
 * `intents` row in the SAME transaction as the entries, and stamps every entry
 * with a group and a causation. The parts exist together or not at all.
 * Refusing loudly beats answering "no window", which would leave a turn whose
 * consequences are never applied and whose player is told nothing.
 */
export class BurnWindowUnreadable extends Error {
  constructor(
    readonly campaignId: string,
    readonly rollSeq: number,
    readonly reason: 'group' | 'declaration' | 'intent' | 'plan',
  ) {
    super(`fenêtre de brûlure illisible (${reason}) : ${campaignId} au seq ${String(rollSeq)}`);
    this.name = 'BurnWindowUnreadable';
  }
}

/** `true` for the eleven `move.*` intents, which are the only ones that roll. */
export function isMoveIntent(intent: Intent): intent is MoveIntent {
  return intent.type.startsWith('move.');
}

/** What the reader cannot get from the journal alone. */
export interface BurnWindowSources {
  /** The move that produced the roll at `rollSeq`, from the `intents` table. */
  intentFor(rollSeq: number): Intent | null;
  /** The plan the engine made when the move was declared at `declarationSeq`. */
  planFor(declarationSeq: number, intent: MoveIntent, characterId: CharacterId): MovePlan | null;
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
 * EVERY roll still waiting for a burn decision, oldest first.
 *
 * `events` is the campaign's journal in `seq` order. There is at most one per
 * character, and there is no upper bound on how many characters a table has,
 * so the answer is a list.
 *
 * CLOSING IS `burnWindowClosedBy` AND NOTHING ELSE. The predicate is exported
 * by `@for/engine` precisely so the caller does not retype the rule — "la
 * fenetre se ferme au premier evenement suivant du meme personnage" — at the
 * one place that sees the next entry. Rewriting it here as
 * `event.subjectCharacterId === window.characterId` would be a second copy of
 * a rule that has to have one.
 */
export function findOpenBurnWindows(
  events: readonly GameEvent[],
  sources: BurnWindowSources,
): readonly BurnWindow[] {
  const reverted = collectRevertedSeqs(events);
  const live = events.filter((event) => !reverted.has(event.seq));
  const open: BurnWindow[] = [];

  for (let index = 0; index < live.length; index += 1) {
    const event = live[index];
    if (event === undefined) continue;
    if (event.type !== 'roll.action_resolved' || !event.payload.burnWindow) continue;

    const probe: BurnWindow = {
      ...PROBE_REST,
      rollSeq: event.seq,
      characterId: event.payload.characterId,
      outcome: event.payload.outcome,
      isPresage: event.payload.isPresage,
      roll: rollDetail(event),
    };
    if (isClosed(probe, event.correlationId, live.slice(index + 1))) continue;

    open.push(complete(event, probe, live, sources));
  }
  return open;
}

/**
 * Has anything after the roll shut this window?
 *
 * TWO QUESTIONS, AND THEY ARE NOT THE SAME ONE, which is what a single call to
 * `burnWindowClosedBy` over the whole tail got wrong.
 *
 *   - AN ENTRY OF ANOTHER TURN about that character: the safety net of
 *     03-donnees.md section 3.4, and it is asked of `burnWindowClosedBy`,
 *     never of a copy of the rule written here;
 *   - AN ENTRY OF THIS TURN'S OWN GROUP: only `move.resolved` closes it,
 *     because `move.resolved` IS the consequences being applied — M0-34:
 *     while the window is open `decide()` emits "ni effet ni `move.resolved`".
 *
 * WHY THE SECOND QUESTION EXISTS. The turn that opens the window keeps writing
 * about its own character AFTER the roll: `roll.presage_drawn` on twin
 * challenge dice, `character.momentum_negated` when the action die is
 * cancelled. Both carry `subject_character_id` and both sit at a higher `seq`,
 * so the net read them as "the next entry about that character" and shut the
 * window AT THE INSTANT IT OPENED. Measured: a roll with a presage could
 * never be burned — `momentum.burn` and `momentum.keep` both refused
 * `no_burn_window`, and the turn was stranded with no `move.resolved`, no
 * effects and no price. Roughly one burnable roll in ten, since a presage is a
 * pair of matching challenge dice.
 *
 * A turn cannot close its own window before it has decided anything. The group
 * is what says "this is the same turn" — the window carries it for exactly
 * that reason.
 */
function isClosed(
  probe: BurnWindow,
  correlationId: string | null,
  after: readonly GameEvent[],
): boolean {
  return after.some((later) =>
    later.correlationId !== null && later.correlationId === correlationId
      ? later.type === 'move.resolved'
      : burnWindowClosedBy(probe, later),
  );
}

/** The three fields the journal does not carry on the roll line itself. */
function complete(
  event: Extract<GameEvent, { type: 'roll.action_resolved' }>,
  probe: BurnWindow,
  live: readonly GameEvent[],
  sources: BurnWindowSources,
): BurnWindow {
  // The group the turn is ALREADY written under — the server's own, never the
  // placeholder `decide()` minted. See `toAppendable`.
  const correlationId = event.correlationId;
  if (correlationId === null) {
    throw new BurnWindowUnreadable(event.campaignId, event.seq, 'group');
  }

  const declaration = live.find(
    (other) =>
      other.type === 'move.declared' &&
      other.correlationId === correlationId &&
      other.seq < event.seq,
  );
  if (declaration === undefined) {
    throw new BurnWindowUnreadable(event.campaignId, event.seq, 'declaration');
  }

  const intent = sources.intentFor(event.seq);
  if (intent === null || !isMoveIntent(intent)) {
    throw new BurnWindowUnreadable(event.campaignId, event.seq, 'intent');
  }

  const plan = sources.planFor(declaration.seq, intent, probe.characterId);
  if (plan === null) {
    throw new BurnWindowUnreadable(event.campaignId, event.seq, 'plan');
  }

  return { ...probe, correlationId, declarationId: declaration.id, intent, plan };
}

/**
 * The fields `burnWindowClosedBy` does not read, for the probe above.
 *
 * The predicate reads `characterId` and `rollSeq`; `BurnWindow` requires the
 * rest to be a `BurnWindow`. Reading the real `intent` and replaying for the
 * real `plan` before knowing whether the window is even open would hit the
 * database, and the reducer, once per closed roll of the whole journal. Named
 * and commented rather than inlined, because a placeholder that travels is how
 * a placeholder ends up in a payload — every one of these fields is overwritten
 * by `complete`, on the one path that returns a window.
 */
const PROBE_REST: Pick<BurnWindow, 'intent' | 'correlationId' | 'declarationId' | 'plan'> = {
  intent: { type: 'move.endure_cold' },
  correlationId: '',
  declarationId: '' as BurnWindow['declarationId'],
  plan: {
    roll: { kind: 'none', outcome: 'franche' },
    narrativeInput: '',
    trackId: null,
    playerRank: null,
    trackTitle: '',
    upfrontEffects: [],
    resolution: NO_RESOLUTION,
  },
};

/** The roll a closing intent names, for the window it means and nothing else. */
export function targetedRollId(intent: Intent): RollId | null {
  return intent.type === 'momentum.burn' || intent.type === 'momentum.keep' ? intent.rollId : null;
}

/**
 * The open window this closing intent AIMS AT, or `null`.
 *
 * The identity of a window is the roll it holds open, and the intent names it.
 * Matching on anything else — "the last one", "the only one" — is what let one
 * player's roll answer for another's.
 *
 * It does NOT check that the window belongs to the actor: `decide()` already
 * refuses `no_burn_window` when `window.characterId !== ctx.actorId`, and a
 * second copy of that check here would be a second place to keep it right.
 */
export function windowTargetedBy(
  windows: readonly BurnWindow[],
  intent: Intent,
): BurnWindow | null {
  const rollId = targetedRollId(intent);
  if (rollId === null) return null;
  return windows.find((window) => window.roll.rollId === rollId) ?? null;
}

/** `true` when this intent is one of the two that close a window explicitly. */
export function isBurnClosingIntent(intent: Intent): boolean {
  return targetedRollId(intent) !== null;
}
