/**
 * `GameEvent` — the closed catalogue of the 71 journal event types.
 *
 * This union is CANONICAL: `@for/contracts` mirrors it as `GameEventSchema`
 * with `satisfies z.ZodType<GameEvent>`, importing it with `import type` so
 * that no runtime edge `engine -> contracts` appears (ARCHITECTURE.md section
 * 4.3). Declaring `type GameEvent = z.infer<...>` would kill the purity of this
 * package.
 *
 * The reducer takes a `GameEvent`, so TypeScript forces its switch to be
 * exhaustive: adding an event type without implementing it does not compile.
 * That is the central mechanism that lets an agent know in seconds whether it
 * broke something.
 *
 * Catalogue of record: 03-donnees.md section 3.4, in this order.
 */

import type {
  AiCallId,
  CampaignId,
  CharacterId,
  ChronicleId,
  ClockId,
  EntityId,
  EventId,
  PlayerId,
  PlaySessionId,
  ProposalId,
  RollId,
  SceneId,
  TrackId,
} from '../ids.js';
import type { RngStream } from '../rng.js';
import type { AttributeId } from './attributes.js';
import type { CampaignSettings, CampaignStatus, ChampionLockKind, PartyRole } from './campaign.js';
import type { SheetSource } from './character.js';
import type { ClockSegmentCount } from './clock.js';
import type { EngineEffect } from './effects.js';
import type { EntityDisposition, EntityKind, EntityStatus } from './entity.js';
import type { GaugeId } from './gauges.js';
import type { Likelihood, MoveId, Outcome } from './moves.js';
import type { ProgressRank, ProgressTrackKind, Visibility } from './progress.js';
import type { SceneAbsence, ScenePresence } from './scene.js';

// ---------------------------------------------------------------- envelope

/**
 * Who an event is addressed to (ADR 0008).
 *
 * NOT to be confused with `Visibility` on progress tracks, which answers a
 * different question ('public' | 'gm'). Two concepts, two names, on purpose:
 * `EventScope` is about RECIPIENTS, `Visibility` about whether a track is shown.
 *
 * `table` is the default and covers a party that stays together. `subset` and
 * `private` exist because a scouting group must not read the camp's journal,
 * and because replaying the log from one player's point of view has to return
 * exactly what they saw — invariant 4.
 */
export const EVENT_SCOPES = ['table', 'subset', 'private'] as const;

export type EventScope = (typeof EVENT_SCOPES)[number];

export const ACTOR_KINDS = ['player', 'engine', 'gm_ai', 'system'] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface EventEnvelope {
  readonly id: EventId;
  readonly campaignId: CampaignId;
  /** Dense, strictly increasing within a campaign, starting at 1. */
  readonly seq: number;
  readonly playSessionId: PlaySessionId | null;
  readonly payloadVersion: number;
  readonly actorKind: ActorKind;
  readonly actorPlayerId: PlayerId | null;
  readonly subjectCharacterId: CharacterId | null;
  /** Groups every event of one turn. The proof view keys on it. */
  readonly correlationId: string | null;
  readonly causationId: EventId | null;
  readonly rngStream: RngStream | null;
  readonly rngDrawIndex: number | null;
  readonly createdAt: number;
  /** ADR 0008. `table` unless the party has split or the fact is one player's alone. */
  readonly scope: EventScope;
  /** Non-empty only when `scope` is `subset` or `private`. Never trusted from a client. */
  readonly recipients: readonly PlayerId[] | null;
}

/**
 * Short machine string that makes the journal readable: `move:strike/weak`,
 * `price:d12=7`, `gm:proposal`. Never a sentence, never shown as is.
 */
export type EventCause = string;

// --------------------------------------------------------------- campaign.*

export interface CampaignCreatedPayload {
  readonly name: string;
  readonly slug: string;
  readonly pitch: string;
  readonly ownerPlayerId: PlayerId;
  readonly contentPackVersion: string;
  readonly contentPackHash: string;
  readonly rulesVersion: number;
  readonly rngSeed: string;
}

export interface CampaignTruthSetPayload {
  readonly truthId: string;
  readonly optionId: string;
  readonly customText?: string | undefined;
}

/**
 * Every field optional, `undefined` included.
 *
 * `Partial<T>` CANNOT BE MIRRORED BY A ZOD SCHEMA here.
 * `exactOptionalPropertyTypes` is on, so `Partial<T>` produces `k?: V` — a key
 * that may be ABSENT but never `undefined` — while `z.object(...).partial()`
 * produces `k?: V | undefined`. The second is not assignable to the first, so
 * `zCampaignSettingsUpdatedPayload satisfies z.ZodType<...>` refuses to
 * compile. Measured, not guessed.
 *
 * Any future payload with an optional-everything shape uses this alias rather
 * than `Partial`.
 */
export type PartialPayload<T> = { readonly [K in keyof T]?: T[K] | undefined };

export interface CampaignSettingsUpdatedPayload {
  readonly patch: PartialPayload<CampaignSettings>;
  readonly before: PartialPayload<CampaignSettings>;
}

export interface CampaignStatusChangedPayload {
  readonly from: CampaignStatus;
  readonly to: CampaignStatus;
  readonly reason?: string | undefined;
}

export interface CampaignContentPackChangedPayload {
  readonly fromVersion: string;
  readonly fromHash: string;
  readonly toVersion: string;
  readonly toHash: string;
  readonly note: string;
}

// ------------------------------------------------------------------ party.*

export interface PartyMemberJoinedPayload {
  readonly playerId: PlayerId;
  readonly role: PartyRole;
  readonly displayName: string;
}

export interface PartyMemberLeftPayload {
  readonly playerId: PlayerId;
  readonly reason: 'left' | 'kicked' | 'inactive';
}

export interface PartyMemberRoleChangedPayload {
  readonly playerId: PlayerId;
  readonly from: PartyRole;
  readonly to: PartyRole;
}

export interface PartyChampionLockedPayload {
  readonly championId: string;
  readonly lockKind: ChampionLockKind;
  readonly reason: string;
}

export interface PartyChampionUnlockedPayload {
  readonly championId: string;
  readonly reason: string;
}

// -------------------------------------------------------------- character.*

/**
 * The frozen champion sheet. Its shape is a CONTENT schema (`ChampionSchema`,
 * 03-donnees.md section 4.5) and lives in `@for/contracts`; importing it here
 * would create the runtime edge `engine -> contracts` that the mirror rule
 * exists to prevent. The engine carries the snapshot opaquely: it freezes it,
 * it never reads inside it.
 */
export type ChampionSheetSnapshot = Readonly<Record<string, unknown>>;

export interface CharacterCreatedPayload {
  readonly characterId: CharacterId;
  readonly playerId: PlayerId;
  readonly championId: string;
  readonly displayName: string;
  readonly sheetSource: SheetSource;
  readonly sheetRef: string;
  readonly sheetSnapshot: ChampionSheetSnapshot;
  readonly attributes: Readonly<Record<AttributeId, number>>;
  readonly gauges: Readonly<Record<GaugeId, number>>;
  readonly momentum: number;
}

export interface CharacterRenamedPayload {
  readonly characterId: CharacterId;
  readonly from: string;
  readonly to: string;
}

export interface CharacterGaugeChangedPayload {
  readonly characterId: CharacterId;
  readonly gauge: GaugeId;
  readonly delta: number;
  readonly from: number;
  readonly to: number;
  readonly clamped: boolean;
  readonly cause: EventCause;
}

export interface CharacterMomentumChangedPayload {
  readonly characterId: CharacterId;
  readonly delta: number;
  readonly from: number;
  readonly to: number;
  readonly clamped: boolean;
  readonly cause: EventCause;
}

export interface CharacterMomentumBurnedPayload {
  readonly characterId: CharacterId;
  readonly spent: number;
  readonly resetTo: number;
  readonly appliedToRollSeq: number;
}

export interface CharacterMomentumNegatedPayload {
  readonly characterId: CharacterId;
  readonly actionDie: number;
  readonly momentumValue: number;
  readonly rollSeq: number;
}

export interface CharacterConditionAddedPayload {
  readonly characterId: CharacterId;
  readonly conditionId: string;
  readonly label: string;
  readonly source: string;
}

export interface CharacterConditionRemovedPayload {
  readonly characterId: CharacterId;
  readonly conditionId: string;
  readonly cause: EventCause;
}

export interface CharacterAssetAddedPayload {
  readonly characterId: CharacterId;
  readonly assetId: string;
  readonly options?: Readonly<Record<string, string>> | undefined;
}

export interface CharacterAssetUpgradedPayload {
  readonly characterId: CharacterId;
  readonly assetId: string;
  readonly abilityIndex: number;
  readonly xpCost: number;
}

export interface CharacterAssetRemovedPayload {
  readonly characterId: CharacterId;
  readonly assetId: string;
  readonly cause: EventCause;
}

export interface CharacterXpEarnedPayload {
  readonly characterId: CharacterId;
  readonly amount: number;
  readonly reason: string;
  readonly trackId?: TrackId | undefined;
}

export interface CharacterXpSpentPayload {
  readonly characterId: CharacterId;
  readonly amount: number;
  readonly target: string;
}

/** Admin only. */
export interface CharacterAttributesCorrectedPayload {
  readonly characterId: CharacterId;
  readonly from: Readonly<Record<AttributeId, number>>;
  readonly to: Readonly<Record<AttributeId, number>>;
  readonly reason: string;
}

export interface CharacterDiedPayload {
  readonly characterId: CharacterId;
  readonly cause: EventCause;
  readonly finalSceneId?: SceneId | undefined;
}

export interface CharacterRetiredPayload {
  readonly characterId: CharacterId;
  readonly reason: string;
}

export interface CharacterSheetReboundPayload {
  readonly characterId: CharacterId;
  readonly fromSheetRef: string;
  readonly toSheetRef: string;
  readonly reason: string;
}

// ------------------------------------------------------------------- roll.*
// The heart of invariant 1. These events are written BEFORE any AI call.

export interface RollAdd {
  readonly source: string;
  readonly value: number;
}

export interface RollActionResolvedPayload {
  readonly rollId: RollId;
  readonly characterId: CharacterId;
  readonly moveId: MoveId;
  readonly attribute: AttributeId;
  readonly attributeValue: number;
  readonly actionDie: number;
  readonly adds: readonly RollAdd[];
  /** Unclamped, kept so the journal reads without recomputing. */
  readonly rawTotal: number;
  /** Clamped to ACTION_SCORE_CAP. */
  readonly total: number;
  readonly cappedAtTen: boolean;
  readonly challengeDice: readonly [number, number];
  readonly outcome: Outcome;
  readonly isPresage: boolean;
  readonly momentumBefore: number;
  readonly momentumNegated: boolean;
  /** `true` while burning momentum on this roll is still legal. */
  readonly burnWindow: boolean;
  readonly rngStream: 'action';
  readonly rngDrawIndex: number;
}

/** The ONLY consequence of a momentum burn on an already written roll. */
export interface RollActionRevisedPayload {
  readonly rollId: RollId;
  readonly revisedFromSeq: number;
  readonly total: number;
  readonly outcome: Outcome;
  readonly isPresage: boolean;
}

export interface RollProgressResolvedPayload {
  readonly rollId: RollId;
  readonly trackId: TrackId;
  readonly ticks: number;
  readonly filledBoxes: number;
  readonly challengeDice: readonly [number, number];
  readonly outcome: Outcome;
  readonly isPresage: boolean;
}

export interface RollOracleResolvedPayload {
  readonly rollId: RollId;
  readonly tableId: string;
  readonly tableVersion: string;
  readonly dieSize: number;
  readonly value: number;
  readonly entryId: string;
  /** Content text, copied verbatim. */
  readonly text: string;
  readonly tags: readonly string[];
  readonly question?: string | undefined;
}

export interface RollYesNoResolvedPayload {
  readonly rollId: RollId;
  readonly question: string;
  readonly likelihood: Likelihood;
  readonly threshold: number;
  readonly value: number;
  readonly answer: 'oui' | 'non';
  readonly isExtreme: boolean;
}

/**
 * The engine rolled a d12 on `pay-the-price`, applied the entry and wrote this
 * BEFORE the storyteller spoke. NO choice field: not the model's, not the
 * player's. When the entry carries several `suggestedEffects`, a second draw
 * on the `price` stream picks one and `effectIndex` records it, so the whole
 * thing replays identically.
 */
export interface RollPricePaidPayload {
  readonly rollId: RollId;
  readonly value: number;
  readonly entryId: string;
  readonly text: string;
  readonly severity: string;
  readonly effectIndex: number;
  readonly targetCharacterId?: CharacterId | undefined;
}

export interface RollPresageDrawnPayload {
  readonly rollId: RollId;
  readonly tableId: string;
  readonly value: number;
  readonly entryId: string;
  readonly text: string;
  readonly triggeredByRollSeq: number;
}

export interface RollDie {
  readonly sides: number;
  readonly value: number;
}

export interface RollRawPayload {
  readonly rollId: RollId;
  readonly label: string;
  readonly dice: readonly RollDie[];
  readonly reason: string;
}

// ------------------------------------------------------------------- move.*

export interface MoveDeclaredPayload {
  readonly moveId: MoveId;
  readonly characterId: CharacterId;
  readonly narrativeInput: string;
  readonly chosenAttribute?: AttributeId | undefined;
  readonly declaredAdds?: readonly RollAdd[] | undefined;
}

/**
 * `effectsApplied` is the ALREADY EXECUTED list; each effect also produced its
 * own `character.*` or `track.*` event. It is a summary view for the UI and
 * the prompt, never a source of truth. No `playerChoices`: no price
 * consequence is chosen by anyone.
 */
export interface MoveResolvedPayload {
  readonly moveId: MoveId;
  readonly characterId: CharacterId;
  readonly rollSeq: number;
  readonly outcome: Outcome;
  readonly effectsApplied: readonly EngineEffect[];
}

export interface MoveAbortedPayload {
  readonly moveId: MoveId;
  readonly characterId: CharacterId;
  readonly reason: string;
}

// ---------------------------------------------------------- track.* clock.*

export interface TrackCreatedPayload {
  readonly trackId: TrackId;
  readonly kind: ProgressTrackKind;
  readonly rank: ProgressRank;
  readonly title: string;
  readonly description: string;
  readonly ownerCharacterId?: CharacterId | undefined;
  readonly visibility: Visibility;
  readonly initialTicks: number;
}

export interface TrackTickedPayload {
  readonly trackId: TrackId;
  readonly ticks: number;
  readonly from: number;
  readonly to: number;
  readonly cause: EventCause;
  readonly milestones: number;
}

export interface TrackRankChangedPayload {
  readonly trackId: TrackId;
  readonly from: ProgressRank;
  readonly to: ProgressRank;
  readonly reason: string;
}

export interface TrackResolvedPayload {
  readonly trackId: TrackId;
  readonly outcome: 'fulfilled' | 'failed';
  readonly rollSeq: number;
  readonly xpAwarded: number;
}

export interface TrackForsakenPayload {
  readonly trackId: TrackId;
  readonly reason: string;
  readonly xpLost: number;
}

/** Out of fiction: housekeeping. */
export interface TrackAbandonedPayload {
  readonly trackId: TrackId;
  readonly reason: string;
}

export interface ClockCreatedPayload {
  readonly clockId: ClockId;
  readonly title: string;
  readonly description: string;
  readonly segments: ClockSegmentCount;
  readonly visibility: Visibility;
  readonly consequence: string;
}

export interface ClockAdvancedPayload {
  readonly clockId: ClockId;
  readonly delta: number;
  readonly from: number;
  readonly to: number;
  readonly cause: EventCause;
}

export interface ClockFilledPayload {
  readonly clockId: ClockId;
  readonly consequence: string;
}

export interface ClockResolvedPayload {
  readonly clockId: ClockId;
  readonly resolution: string;
}

export interface ClockCancelledPayload {
  readonly clockId: ClockId;
  readonly reason: string;
}

// ------------------------------------------------------ scene.* narration.*

export interface SceneStartedPayload {
  readonly sceneId: SceneId;
  readonly title: string;
  readonly regionId?: string | undefined;
  readonly entityIds: readonly string[];
  readonly presentCharacterIds: readonly string[];
}

export interface SceneEndedPayload {
  readonly sceneId: SceneId;
  readonly outcome?: string | undefined;
}

/**
 * A COMPLETE, BOUNDED snapshot of the scene (8 + 8), never a delta: a delta
 * would force the reducer to reason about application order, and the reducer
 * must stay total and judgement-free. Emitted only when the merge changes
 * something.
 */
export interface SceneFactsUpdatedPayload {
  readonly sceneId: SceneId;
  readonly placeId?: string | undefined;
  readonly placeName?: string | undefined;
  readonly timeOfDay?: string | undefined;
  readonly present: readonly ScenePresence[];
  readonly absent: readonly SceneAbsence[];
  readonly source: 'gm_ai' | 'engine' | 'player';
  readonly aiCallId?: AiCallId | undefined;
}

export interface NarrationPlayerMessagePayload {
  readonly text: string;
  readonly kind: 'ic' | 'ooc';
  readonly characterId?: CharacterId | undefined;
}

export interface NarrationGmMessagePayload {
  readonly text: string;
  readonly aiCallId: AiCallId;
  readonly model: string;
  readonly promptVersion: string;
  readonly source: 'ai' | 'engine';
  readonly respondsToSeq?: number | undefined;
  readonly citedEventSeqs: readonly number[];
}

export interface NarrationGmFailedPayload {
  readonly aiCallId?: AiCallId | undefined;
  readonly errorKind:
    'api_error' | 'refused' | 'invalid_output' | 'rejected_by_postfilter' | 'aborted';
  readonly fallbackText: string;
}

export const GM_PROPOSAL_KINDS = [
  'entity',
  'clock',
  'thread',
  'lore_fact',
  'scene',
  'scene_facts',
  'refusal',
] as const;

export type GmProposalKind = (typeof GM_PROPOSAL_KINDS)[number];

/** There is NO `price_choice` kind, and there never will be without an ADR. */
export interface NarrationGmProposalPayload {
  readonly proposalId: ProposalId;
  readonly kind: GmProposalKind;
  readonly payload: unknown;
}

export interface NarrationProposalAcceptedPayload {
  readonly proposalId: ProposalId;
  readonly resultingEventSeqs: readonly number[];
}

/**
 * First-class event, not a log line: the rejection rate per `reasonCode` is a
 * quality metric of the AI GM, and an imbalance of refusal codes across turn
 * outcomes is exactly the abuse signal of 02-mj-ia.md section 4.8.5.
 */
export interface NarrationProposalRejectedPayload {
  readonly proposalId: ProposalId;
  readonly reasonCode: string;
  readonly validationErrors: readonly string[];
}

export interface NarrationSafetyFlagPayload {
  readonly kind: 'pause' | 'rewind' | 'veil';
  readonly note?: string | undefined;
}

// ----------------------------------------------------------------- entity.*

export interface EntityIntroducedPayload {
  readonly entityId: EntityId;
  readonly kind: EntityKind;
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly regionId?: string | undefined;
  readonly championId?: string | undefined;
  readonly disposition?: EntityDisposition | undefined;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface EntityUpdatedPayload {
  readonly entityId: EntityId;
  readonly patch: Readonly<Record<string, unknown>>;
  readonly before: Readonly<Record<string, unknown>>;
}

export interface EntityStatusChangedPayload {
  readonly entityId: EntityId;
  readonly from: EntityStatus;
  readonly to: EntityStatus;
  readonly cause: EventCause;
}

/** Lightweight: refreshes `last_seen_seq`. */
export interface EntityMentionedPayload {
  readonly entityId: EntityId;
}

// ------------------------------------------------- session.* chronicle.*

export interface SessionOpenedPayload {
  readonly playSessionId: PlaySessionId;
  readonly ordinal: number;
  readonly title?: string | undefined;
  readonly presentPlayerIds: readonly PlayerId[];
}

export interface SessionClosedPayload {
  readonly playSessionId: PlaySessionId;
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly recapChronicleId?: ChronicleId | undefined;
}

export interface ChronicleCompactedPayload {
  readonly chronicleId: ChronicleId;
  readonly version: number;
  readonly kind: 'incremental' | 'rebuild';
  readonly sourceEventSeq: number;
  readonly aiCallId: AiCallId;
  readonly tokenCount: number;
}

// ----------------------------------------------------------------- system.*

/**
 * Cancellation. `byPlayerId` is `null` when the emitter is not human: that is
 * the storyteller's right of refusal, which carries `actorKind: 'system'` and
 * `reason: 'gm_refusal:<cause>'`.
 */
export interface SystemRevertedPayload {
  readonly targetSeqs: readonly number[];
  readonly reason: string;
  readonly byPlayerId: PlayerId | null;
}

export interface SystemCorrectionPayload {
  readonly targetSeq: number;
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
  readonly reason: string;
}

export interface SystemRulesVersionMigratedPayload {
  readonly from: number;
  readonly to: number;
  readonly note: string;
}

export interface SystemPayloadUpcastPayload {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly affectedTypes: readonly string[];
}

/** A free bookmark in the journal. */
export interface SystemNotePayload {
  readonly text: string;
  readonly byPlayerId: PlayerId;
}

// ------------------------------------------------------------ the catalogue

/**
 * Type -> payload. This map is the single place that pairs the two, so a new
 * event cannot be half-declared.
 */
export interface GameEventPayloads {
  'campaign.created': CampaignCreatedPayload;
  'campaign.truth_set': CampaignTruthSetPayload;
  'campaign.settings_updated': CampaignSettingsUpdatedPayload;
  'campaign.status_changed': CampaignStatusChangedPayload;
  'campaign.content_pack_changed': CampaignContentPackChangedPayload;

  'party.member_joined': PartyMemberJoinedPayload;
  'party.member_left': PartyMemberLeftPayload;
  'party.member_role_changed': PartyMemberRoleChangedPayload;
  'party.champion_locked': PartyChampionLockedPayload;
  'party.champion_unlocked': PartyChampionUnlockedPayload;

  'character.created': CharacterCreatedPayload;
  'character.renamed': CharacterRenamedPayload;
  'character.gauge_changed': CharacterGaugeChangedPayload;
  'character.momentum_changed': CharacterMomentumChangedPayload;
  'character.momentum_burned': CharacterMomentumBurnedPayload;
  'character.momentum_negated': CharacterMomentumNegatedPayload;
  'character.condition_added': CharacterConditionAddedPayload;
  'character.condition_removed': CharacterConditionRemovedPayload;
  'character.asset_added': CharacterAssetAddedPayload;
  'character.asset_upgraded': CharacterAssetUpgradedPayload;
  'character.asset_removed': CharacterAssetRemovedPayload;
  'character.xp_earned': CharacterXpEarnedPayload;
  'character.xp_spent': CharacterXpSpentPayload;
  'character.attributes_corrected': CharacterAttributesCorrectedPayload;
  'character.died': CharacterDiedPayload;
  'character.retired': CharacterRetiredPayload;
  'character.sheet_rebound': CharacterSheetReboundPayload;

  'roll.action_resolved': RollActionResolvedPayload;
  'roll.action_revised': RollActionRevisedPayload;
  'roll.progress_resolved': RollProgressResolvedPayload;
  'roll.oracle_resolved': RollOracleResolvedPayload;
  'roll.yes_no_resolved': RollYesNoResolvedPayload;
  'roll.price_paid': RollPricePaidPayload;
  'roll.presage_drawn': RollPresageDrawnPayload;
  'roll.raw': RollRawPayload;

  'move.declared': MoveDeclaredPayload;
  'move.resolved': MoveResolvedPayload;
  'move.aborted': MoveAbortedPayload;

  'track.created': TrackCreatedPayload;
  'track.ticked': TrackTickedPayload;
  'track.rank_changed': TrackRankChangedPayload;
  'track.resolved': TrackResolvedPayload;
  'track.forsaken': TrackForsakenPayload;
  'track.abandoned': TrackAbandonedPayload;
  'clock.created': ClockCreatedPayload;
  'clock.advanced': ClockAdvancedPayload;
  'clock.filled': ClockFilledPayload;
  'clock.resolved': ClockResolvedPayload;
  'clock.cancelled': ClockCancelledPayload;

  'scene.started': SceneStartedPayload;
  'scene.ended': SceneEndedPayload;
  'scene.facts_updated': SceneFactsUpdatedPayload;
  'narration.player_message': NarrationPlayerMessagePayload;
  'narration.gm_message': NarrationGmMessagePayload;
  'narration.gm_failed': NarrationGmFailedPayload;
  'narration.gm_proposal': NarrationGmProposalPayload;
  'narration.proposal_accepted': NarrationProposalAcceptedPayload;
  'narration.proposal_rejected': NarrationProposalRejectedPayload;
  'narration.safety_flag': NarrationSafetyFlagPayload;

  'entity.introduced': EntityIntroducedPayload;
  'entity.updated': EntityUpdatedPayload;
  'entity.status_changed': EntityStatusChangedPayload;
  'entity.mentioned': EntityMentionedPayload;

  'session.opened': SessionOpenedPayload;
  'session.closed': SessionClosedPayload;
  'chronicle.compacted': ChronicleCompactedPayload;

  'system.reverted': SystemRevertedPayload;
  'system.correction': SystemCorrectionPayload;
  'system.rules_version_migrated': SystemRulesVersionMigratedPayload;
  'system.payload_upcast': SystemPayloadUpcastPayload;
  'system.note': SystemNotePayload;
}

/** One journal entry: the envelope, its discriminant, and its payload. */
export type GameEventOf<TType extends keyof GameEventPayloads> = EventEnvelope & {
  readonly type: TType;
  readonly payload: GameEventPayloads[TType];
};

export type GameEvent = {
  [TType in keyof GameEventPayloads]: GameEventOf<TType>;
}[keyof GameEventPayloads];

/**
 * The 71 type strings, in catalogue order.
 *
 * A TypeScript union cannot be counted at runtime: without this constant the
 * "there are exactly 71 of them" criterion is untestable. `satisfies` makes a
 * string that is not an event type a compile error.
 */
export const GAME_EVENT_TYPES = [
  'campaign.created',
  'campaign.truth_set',
  'campaign.settings_updated',
  'campaign.status_changed',
  'campaign.content_pack_changed',
  'party.member_joined',
  'party.member_left',
  'party.member_role_changed',
  'party.champion_locked',
  'party.champion_unlocked',
  'character.created',
  'character.renamed',
  'character.gauge_changed',
  'character.momentum_changed',
  'character.momentum_burned',
  'character.momentum_negated',
  'character.condition_added',
  'character.condition_removed',
  'character.asset_added',
  'character.asset_upgraded',
  'character.asset_removed',
  'character.xp_earned',
  'character.xp_spent',
  'character.attributes_corrected',
  'character.died',
  'character.retired',
  'character.sheet_rebound',
  'roll.action_resolved',
  'roll.action_revised',
  'roll.progress_resolved',
  'roll.oracle_resolved',
  'roll.yes_no_resolved',
  'roll.price_paid',
  'roll.presage_drawn',
  'roll.raw',
  'move.declared',
  'move.resolved',
  'move.aborted',
  'track.created',
  'track.ticked',
  'track.rank_changed',
  'track.resolved',
  'track.forsaken',
  'track.abandoned',
  'clock.created',
  'clock.advanced',
  'clock.filled',
  'clock.resolved',
  'clock.cancelled',
  'scene.started',
  'scene.ended',
  'scene.facts_updated',
  'narration.player_message',
  'narration.gm_message',
  'narration.gm_failed',
  'narration.gm_proposal',
  'narration.proposal_accepted',
  'narration.proposal_rejected',
  'narration.safety_flag',
  'entity.introduced',
  'entity.updated',
  'entity.status_changed',
  'entity.mentioned',
  'session.opened',
  'session.closed',
  'chronicle.compacted',
  'system.reverted',
  'system.correction',
  'system.rules_version_migrated',
  'system.payload_upcast',
  'system.note',
] as const satisfies readonly GameEvent['type'][];

export type GameEventType = (typeof GAME_EVENT_TYPES)[number];

/**
 * The other direction, which `satisfies` does NOT cover: a variant present in
 * the union but missing from the constant. `Exclude<...>` must be `never`, and
 * `AssertNever` turns anything else into a compile error.
 *
 * This is a compile guard, not a test: removing a line from
 * `GAME_EVENT_TYPES` must fail `pnpm --filter @for/engine typecheck`.
 */
type AssertNever<T extends never> = T;
export type GameEventCatalogIsExhaustive = AssertNever<Exclude<GameEvent['type'], GameEventType>>;

/**
 * Event types that mutate a gauge, a track or a clock. None of them is ever
 * emissible by the model: the input validator rejects any of these carrying
 * `actorKind: 'gm_ai'` (03-donnees.md section 3.4, invariant 1).
 */
export const ENGINE_ONLY_EVENT_TYPES = [
  'character.gauge_changed',
  'character.momentum_changed',
  'character.momentum_burned',
  'character.momentum_negated',
  'character.condition_added',
  'character.condition_removed',
  'character.asset_removed',
  'character.xp_earned',
  'character.died',
  'roll.action_resolved',
  'roll.action_revised',
  'roll.progress_resolved',
  'roll.oracle_resolved',
  'roll.yes_no_resolved',
  'roll.price_paid',
  'roll.presage_drawn',
  'roll.raw',
  'move.resolved',
  'track.ticked',
  'track.rank_changed',
  'track.resolved',
  'clock.advanced',
  'clock.filled',
] as const satisfies readonly GameEventType[];
