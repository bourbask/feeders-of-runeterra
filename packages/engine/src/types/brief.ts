/**
 * `NarrationBrief` — the settled fact handed to the model.
 *
 * This is where invariant 1 is made physical. Everything here is ALREADY
 * DECIDED and already written to the journal: the roll, the outcome, the
 * effects, the price drawn, the presage. The storyteller dresses it; it does
 * not negotiate it, and it is given no parameter the engine would later turn
 * into a cost. If you find yourself adding a field the model fills in, you are
 * opening the back door invariant 1 exists to close.
 *
 * NO RENDERED FRENCH PROSE is built here. The engine carries identifiers,
 * numbers and content strings it merely copies; the `<fait>` block of
 * 02-mj-ia.md section 4.5 is rendered in `@for/ai` from the content bundle.
 * That is the same rule as the deterministic fallback: templates come from
 * `content/fallbacks/narration.json`, never from this package.
 */

import type { CharacterId, RollId, SceneId, TrackId } from '../ids.js';
import type { AttributeId } from './attributes.js';
import type { EngineEffect } from './effects.js';
import type { RollAdd } from './events.js';
import type { MoveId, Outcome } from './moves.js';

/** The arithmetic of the action roll, so the prompt can spell it in words. */
export interface BriefRollDetail {
  readonly rollId: RollId;
  readonly attribute: AttributeId;
  readonly attributeValue: number;
  readonly actionDie: number;
  readonly adds: readonly RollAdd[];
  readonly rawTotal: number;
  readonly total: number;
  readonly cappedAtTen: boolean;
  readonly challengeDice: readonly [number, number];
  readonly momentumNegated: boolean;
  readonly burned: boolean;
}

/**
 * A price already rolled, already applied, already journalled. `entryId` and
 * `text` come from the content table `pay-the-price`, copied without edit.
 * There is no variant to pick: the engine picked, on the `price` stream.
 */
export interface BriefImposedPrice {
  readonly rollId: RollId;
  readonly tableId: string;
  readonly value: number;
  readonly entryId: string;
  readonly text: string;
  readonly severity: string;
  readonly effectIndex: number;
}

export interface BriefPresage {
  readonly tableId: string;
  readonly value: number;
  readonly entryId: string;
  readonly text: string;
}

/** One already-applied consequence, in the form the UI and prompt read. */
export interface BriefAppliedEffect {
  readonly effect: EngineEffect;
  readonly subjectCharacterId: CharacterId | null;
  readonly trackId: TrackId | null;
  /** Journal sequence of the event this effect produced. */
  readonly eventSeq: number;
}

export interface NarrationBrief {
  /** Groups every event of this turn; the proof view keys on it. */
  readonly correlationId: string;
  readonly sceneId: SceneId | null;
  readonly actorCharacterId: CharacterId;
  readonly moveId: MoveId | null;
  readonly outcome: Outcome | null;
  readonly isPresage: boolean;
  readonly roll: BriefRollDetail | null;
  readonly appliedEffects: readonly BriefAppliedEffect[];
  readonly imposedPrice: BriefImposedPrice | null;
  readonly presage: BriefPresage | null;
  /** What the player wrote, carried verbatim for the `<intention>` block. */
  readonly playerInput: string;
  /** Journal sequences this turn wrote, ascending. */
  readonly eventSeqs: readonly number[];
  /**
   * Identifier of the fallback template to use if the storyteller fails. The
   * template TEXT lives in the content bundle; the engine only picks, and it
   * picks on the `fallback` RNG stream so the choice replays identically.
   */
  readonly fallbackTemplateId: string;
}
