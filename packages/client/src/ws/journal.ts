/**
 * The fiction feed: one line per received event, and NOT ONE MECHANICAL VALUE
 * IN IT (02-mj-ia.md section 4.8.6 (a), P22).
 *
 * THE SHAPE IS THE GUARD. `JournalLine` has no field a die, a total, an effect
 * name or a price could go into: `text` carries prose and nothing else, and a
 * mechanical event produces a line whose `text` is `null`. So "an unfolded
 * scene shows no number" is not a rendering rule someone has to remember — it
 * is a type with nowhere to put one. `journal.test.ts` freezes the key set for
 * exactly that reason: adding a `roll` field here turns it red.
 *
 * WHY MECHANICAL EVENTS STILL BECOME LINES. Because `system.reverted` marks by
 * `seq`, and a line that was never created cannot be marked. Keeping one entry
 * per event is what lets « annulé » cover the whole turn — including the parts
 * that only the proof shows.
 *
 * THE CLIENT FILTERS NOTHING FOR CONFIDENTIALITY. What arrives has already
 * been judged by the server (ADR 0008): every event it received is one it was
 * entitled to. Sorting prose from mechanics here is presentation, not privacy.
 *
 * WHAT UI-01 ADDED, AND WHY IT IS NOT A CRACK IN THE SHAPE. Three fields, none
 * of which can hold a die, a total, an effect or a price:
 *
 *   - `scope` and `recipients` are READ BACK off the envelope the server wrote
 *     (ADR 0008). The feed needs them to draw the rail of 05-interface.md §5.2,
 *     and reading them is not filtering: the server already decided who got
 *     this entry. `recipients` is a list of player ids and never a count of
 *     anything in the fiction.
 *   - `hasRoll` says « this entry IS a roll », nothing about its outcome. It is
 *     what brings « Pourquoi ? » back onto the JETS (05-interface.md §10) after
 *     M0-19 put it on every line of prose. The dice stay where they were: in
 *     `s2c.turn_proof`, behind the folded panel.
 *
 * `journal.test.ts` still spells the field list out in full letters, so a
 * fourth field cannot be slipped in beside these three.
 */

import type { EventScope, GameEvent, GameEventType } from '@for/engine';
import { GAME_EVENT_TYPES } from '@for/engine';

/** What a line is, for the reader. `mecanique` is displayed by nothing. */
export type JournalLineKind = 'scene' | 'conteur' | 'joueur' | 'systeme' | 'mecanique';

/** Why a line is struck, and by which journal entry. */
export interface RevokedMark {
  /** The `seq` of the `system.reverted` that struck it. */
  readonly bySeq: number;
  /** `gm_refusal:<cause>`, as the journal carries it. */
  readonly reason: string;
}

export interface JournalLine {
  /** Journal number. What `system.reverted.targetSeqs` names. */
  readonly seq: number;
  /** This player's dense delivery number (ADR 0010). Ordering key. */
  readonly deliverySeq: number;
  /** The turn this line belongs to. What « Pourquoi ? » asks about. */
  readonly correlationId: string | null;
  readonly kind: JournalLineKind;
  /** Prose, or `null`. NEVER a number, a total, an effect or a price. */
  readonly text: string | null;
  /** Who speaks, when someone does. */
  readonly speaker: string | null;
  /** `null` while the turn holds; set when a `system.reverted` names it. */
  readonly revoked: RevokedMark | null;
  /** Who this entry was addressed to (ADR 0008). Drawn as the rail, §5.2. */
  readonly scope: EventScope;
  /** Player ids, when the scope names some. `null` at table scope. */
  readonly recipients: readonly string[] | null;
  /** This entry IS a roll. Says nothing about its outcome. */
  readonly hasRoll: boolean;
}

/**
 * The event types that carry prose. Frozen, and checked against the engine's
 * own catalogue by `journal.test.ts`: a type renamed upstream turns that test
 * red rather than quietly dropping a line from the feed.
 */
export const NARRATIVE_EVENT_TYPES = [
  'scene.started',
  'scene.ended',
  'narration.gm_message',
  'narration.gm_failed',
  'narration.player_message',
  'system.note',
] as const satisfies readonly GameEventType[];

export type NarrativeEventType = (typeof NARRATIVE_EVENT_TYPES)[number];

/**
 * The prose of an event, or `null` when the event has none to show.
 *
 * A CHAIN OF TESTS RATHER THAN A `switch`, and the reason is worth a line: the
 * repository's `switch-exhaustiveness-check` demands a case for all 71 event
 * types, and 65 of them would be `return { text: null }`. The default branch
 * is the intended answer here, not an oversight — everything that is not prose
 * is mechanics. `journal.test.ts` checks the other direction instead: each
 * member of `NARRATIVE_EVENT_TYPES` must come back with a kind that is NOT
 * `mecanique`, so the list and this function cannot drift apart.
 */
function proseOf(event: GameEvent): { text: string | null; kind: JournalLineKind } {
  if (event.type === 'scene.started') return { text: event.payload.title, kind: 'scene' };
  if (event.type === 'scene.ended') return { text: event.payload.outcome ?? null, kind: 'scene' };
  if (event.type === 'narration.gm_message') return { text: event.payload.text, kind: 'conteur' };
  if (event.type === 'narration.gm_failed') {
    return { text: event.payload.fallbackText, kind: 'conteur' };
  }
  if (event.type === 'narration.player_message') {
    return { text: event.payload.text, kind: 'joueur' };
  }
  if (event.type === 'system.note') return { text: event.payload.text, kind: 'systeme' };

  // Everything else is mechanics. It belongs to « Pourquoi ? », and the line
  // keeps no room for it.
  return { text: null, kind: 'mecanique' };
}

/** Who said it, when the payload names someone. The conteur is not a speaker. */
function speakerOf(event: GameEvent): string | null {
  if (event.type === 'narration.player_message') {
    return event.payload.characterId ?? event.subjectCharacterId;
  }
  return null;
}

/**
 * The event types that ARE a roll.
 *
 * DERIVED FROM THE ENGINE'S OWN CATALOGUE, not retyped beside it: a list
 * written here would be a second place to forget `roll.presage_drawn`, and
 * nothing would say so. `journal.test.ts` holds the other end — it spells the
 * eight names out in full letters and compares them to what this derivation
 * finds, so a roll type renamed WITHOUT the prefix turns that test red instead
 * of silently dropping its « Pourquoi ? ».
 */
export const ROLL_EVENT_TYPES: readonly GameEventType[] = GAME_EVENT_TYPES.filter((type) =>
  type.startsWith('roll.'),
);

const ROLLS = new Set<string>(ROLL_EVENT_TYPES);

/** One received event, turned into one line. Pure, and total over the 71 types. */
export function lineOfEvent(event: GameEvent, deliverySeq: number): JournalLine {
  const { text, kind } = proseOf(event);
  return {
    seq: event.seq,
    deliverySeq,
    correlationId: event.correlationId,
    kind,
    text,
    speaker: speakerOf(event),
    revoked: null,
    scope: event.scope,
    recipients: event.recipients,
    hasRoll: ROLLS.has(event.type),
  };
}

/** Lines a reader sees in the fiction feed: the ones that carry prose. */
export function isReadable(line: JournalLine): boolean {
  return line.text !== null;
}
