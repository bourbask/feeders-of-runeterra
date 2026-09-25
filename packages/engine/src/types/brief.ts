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

import type { CharacterId, PlayerId, RollId, SceneId, TrackId } from '../ids.js';
import type { AttributeId } from './attributes.js';
import type { EngineEffect } from './effects.js';
import type { EventScope, RollAdd } from './events.js';
import type { MoveId, Outcome } from './moves.js';
import type { SceneRef } from './scene.js';
import { SCENE_PRESENCE_MAX } from './scene.js';

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

// ------------------------------------------------------------- who it is for

/**
 * WHO this brief is addressed to — ADR 0008 decision 1, on the brief instead
 * of on the event envelope.
 *
 * The envelope answers "who receives this journal line". This answers "who is
 * the storyteller writing for", and they are the same pair for the same
 * reason: a party that has split is TWO narrations for one turn, not one
 * narration truncated (ADR 0008, "Consequence a connaitre, cote cout").
 *
 * THE RULE THIS TYPE CARRIES: `recipients` is `null` EXACTLY WHEN `scope` is
 * `'table'`. At table scope there is nobody to enumerate; at any other scope
 * the list IS the scope. `briefAudience()` in `decide.ts` is the only place
 * that builds the pair, so the two fields cannot drift apart, and the Zod
 * mirror refines the same equivalence at runtime.
 *
 * NOT CARRIED HERE, and said rather than implied: that a non-table list be
 * NON-EMPTY. The event envelope does not enforce it either, and one of the two
 * mirrors stricter than the other is how they start disagreeing. It belongs
 * with the rule that produces a non-table scope, which is M1.
 */
export interface BriefAudience {
  readonly scope: EventScope;
  /** Non-null exactly when `scope` is not `'table'`. */
  readonly recipients: readonly PlayerId[] | null;
}

/**
 * The two shapes a perceptible fact takes, mirroring the two lists of
 * `SceneState`.
 *
 * In ENGLISH, unlike `SCENE_ABSENCE_CAUSES`: these are not mechanic values a
 * player ever reads, they are the names of `SceneState.present` and
 * `SceneState.absent` (ARCHITECTURE.md section 4.2 keeps French for mechanic
 * VALUES only). The French rendering of the `<scene>` block is built in
 * `@for/ai` from the content bundle, like every other string the player sees.
 */
export const PERCEIVABLE_FACT_KINDS = ['present', 'absent'] as const;

export type PerceivableFactKind = (typeof PERCEIVABLE_FACT_KINDS)[number];

/**
 * ONE fact the recipient of this brief can perceive — ADR 0008 decision 3.
 *
 * "Le moteur calcule, pour chaque destinataire, la liste des faits
 * perceptibles, et le conteur n'a le droit d'utiliser que celle-la." That
 * sentence is a TYPE here rather than a style note, and M0-18 makes it a
 * channel: `@for/ai` builds its `<scene>` block from this list and from
 * nothing else. Filtering the storyteller's OUTPUT would be too late — the
 * information would already be in its context window.
 *
 * NO GAME NUMBER, exactly as `SceneState` carries none (03-donnees.md section
 * 3.5, property 1): no gauge, no segment, no rank. `sinceSeq` is a journal
 * sequence, not a game number — the same one `ScenePresence` already carries.
 */
export interface BriefPerceivableFact {
  readonly kind: PerceivableFactKind;
  readonly ref: SceneRef;
  /** The projection's name, copied. Never the model's. */
  readonly name: string;
  /**
   * `ScenePresence.state` for a presence, `SceneAbsence.cause` for an
   * absence. Text, never a number.
   */
  readonly detail: string;
  readonly sinceSeq: number;
}

/**
 * Hard cap on `NarrationBrief.perceivableFacts`.
 *
 * DERIVED, not chosen: the list is the concatenation of the two `SceneState`
 * lists, each capped at `SCENE_PRESENCE_MAX`. Written as the product so that
 * moving the scene cap moves this one, and so that nothing has to remember a
 * second number.
 */
export const BRIEF_PERCEIVABLE_FACTS_MAX = SCENE_PRESENCE_MAX * 2;

export interface NarrationBrief {
  /** Groups every event of this turn; the proof view keys on it. */
  readonly correlationId: string;
  readonly sceneId: SceneId | null;
  /** Who this narration is for. ADR 0008 decision 1. */
  readonly audience: BriefAudience;
  /**
   * Everything the audience can perceive, and the ONLY thing the storyteller
   * is allowed to use. Sorted by `ref.id` then `kind`, at most
   * `BRIEF_PERCEIVABLE_FACTS_MAX` entries. ADR 0008 decision 3.
   */
  readonly perceivableFacts: readonly BriefPerceivableFact[];
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
