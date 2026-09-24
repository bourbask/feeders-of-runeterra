/**
 * `zGameEvent` — the 71 journal variants, in the order of the catalogue of
 * record (03-donnees.md section 3.4).
 *
 * THE ORDER IS PART OF THE CONTRACT. `tests/event-catalog.test.ts` reads the
 * markdown tables of section 3.4, and `tests/exhaustive-union.test.ts` reads
 * the engine's `GAME_EVENT_TYPES`; all three lists must agree, member for
 * member and index for index. That is what makes "there are exactly 71 of
 * them" a checkable statement instead of a comment.
 *
 * `satisfies z.ZodType<GameEvent>` DOES NOT GUARD THIS LIST. Measured, after
 * assuming the opposite: delete `zRollPresageDrawn` from the union below and
 * `pnpm --filter @for/contracts typecheck` still exits 0. `ZodType` is
 * COVARIANT in its output (`out Output`), so a union with one member fewer is
 * still assignable to `GameEvent`, and a union with one member more is too.
 * What the `satisfies` catches is a missing FIELD inside a mirrored payload —
 * a different failure, and a real one, which is why it stays.
 *
 * THE ONLY NET UNDER THIS LIST IS THE RUNTIME COMPARISON in
 * `tests/event-catalog.test.ts` and `tests/exhaustive-union.test.ts`. Do not
 * weaken them on the assumption that the compiler has your back here: it does
 * not, and it fails silently.
 *
 * Each variant spreads `eventEnvelopeShape` rather than calling `.extend()`:
 * same schema, far cheaper for the compiler at this count.
 */

import { z } from 'zod';

import type { GameEvent } from '@for/engine';

import {
  zCampaignContentPackChangedPayload,
  zCampaignCreatedPayload,
  zCampaignSettingsUpdatedPayload,
  zCampaignStatusChangedPayload,
  zCampaignTruthSetPayload,
  zPartyChampionLockedPayload,
  zPartyChampionUnlockedPayload,
  zPartyMemberJoinedPayload,
  zPartyMemberLeftPayload,
  zPartyMemberRoleChangedPayload,
} from './campaign.js';
import {
  zCharacterAssetAddedPayload,
  zCharacterAssetRemovedPayload,
  zCharacterAssetUpgradedPayload,
  zCharacterAttributesCorrectedPayload,
  zCharacterConditionAddedPayload,
  zCharacterConditionRemovedPayload,
  zCharacterCreatedPayload,
  zCharacterDiedPayload,
  zCharacterGaugeChangedPayload,
  zCharacterMomentumBurnedPayload,
  zCharacterMomentumChangedPayload,
  zCharacterMomentumNegatedPayload,
  zCharacterRenamedPayload,
  zCharacterRetiredPayload,
  zCharacterSheetReboundPayload,
  zCharacterXpEarnedPayload,
  zCharacterXpSpentPayload,
} from './character.js';
import {
  zRollActionResolvedPayload,
  zRollActionRevisedPayload,
  zRollOracleResolvedPayload,
  zRollPresageDrawnPayload,
  zRollPricePaidPayload,
  zRollProgressResolvedPayload,
  zRollRawPayload,
  zRollYesNoResolvedPayload,
} from './dice.js';
import {
  zEntityIntroducedPayload,
  zEntityMentionedPayload,
  zEntityStatusChangedPayload,
  zEntityUpdatedPayload,
} from './entity.js';
import { eventEnvelopeShape } from './envelope.js';
import { zMoveAbortedPayload, zMoveDeclaredPayload, zMoveResolvedPayload } from './moves.js';
import {
  zNarrationGmFailedPayload,
  zNarrationGmMessagePayload,
  zNarrationGmProposalPayload,
  zNarrationPlayerMessagePayload,
  zNarrationProposalAcceptedPayload,
  zNarrationProposalRejectedPayload,
  zNarrationSafetyFlagPayload,
  zSceneEndedPayload,
  zSceneFactsUpdatedPayload,
  zSceneStartedPayload,
} from './narrative.js';
import {
  zClockAdvancedPayload,
  zClockCancelledPayload,
  zClockCreatedPayload,
  zClockFilledPayload,
  zClockResolvedPayload,
  zTrackAbandonedPayload,
  zTrackCreatedPayload,
  zTrackForsakenPayload,
  zTrackRankChangedPayload,
  zTrackResolvedPayload,
  zTrackTickedPayload,
} from './progress.js';
import {
  zChronicleCompactedPayload,
  zSessionClosedPayload,
  zSessionOpenedPayload,
  zSystemCorrectionPayload,
  zSystemNotePayload,
  zSystemPayloadUpcastPayload,
  zSystemRevertedPayload,
  zSystemRulesVersionMigratedPayload,
} from './session.js';

export * from './campaign.js';
export * from './character.js';
export * from './dice.js';
export * from './entity.js';
export * from './envelope.js';
export * from './moves.js';
export * from './narrative.js';
export * from './progress.js';
export * from './session.js';

// --------------------------------------------------------------- campaign.*

export const zCampaignCreated = z.object({
  ...eventEnvelopeShape,
  type: z.literal('campaign.created'),
  payload: zCampaignCreatedPayload,
});
export const zCampaignTruthSet = z.object({
  ...eventEnvelopeShape,
  type: z.literal('campaign.truth_set'),
  payload: zCampaignTruthSetPayload,
});
export const zCampaignSettingsUpdated = z.object({
  ...eventEnvelopeShape,
  type: z.literal('campaign.settings_updated'),
  payload: zCampaignSettingsUpdatedPayload,
});
export const zCampaignStatusChanged = z.object({
  ...eventEnvelopeShape,
  type: z.literal('campaign.status_changed'),
  payload: zCampaignStatusChangedPayload,
});
export const zCampaignContentPackChanged = z.object({
  ...eventEnvelopeShape,
  type: z.literal('campaign.content_pack_changed'),
  payload: zCampaignContentPackChangedPayload,
});

// ------------------------------------------------------------------ party.*

export const zPartyMemberJoined = z.object({
  ...eventEnvelopeShape,
  type: z.literal('party.member_joined'),
  payload: zPartyMemberJoinedPayload,
});
export const zPartyMemberLeft = z.object({
  ...eventEnvelopeShape,
  type: z.literal('party.member_left'),
  payload: zPartyMemberLeftPayload,
});
export const zPartyMemberRoleChanged = z.object({
  ...eventEnvelopeShape,
  type: z.literal('party.member_role_changed'),
  payload: zPartyMemberRoleChangedPayload,
});
export const zPartyChampionLocked = z.object({
  ...eventEnvelopeShape,
  type: z.literal('party.champion_locked'),
  payload: zPartyChampionLockedPayload,
});
export const zPartyChampionUnlocked = z.object({
  ...eventEnvelopeShape,
  type: z.literal('party.champion_unlocked'),
  payload: zPartyChampionUnlockedPayload,
});

// -------------------------------------------------------------- character.*

export const zCharacterCreated = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.created'),
  payload: zCharacterCreatedPayload,
});
export const zCharacterRenamed = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.renamed'),
  payload: zCharacterRenamedPayload,
});
export const zCharacterGaugeChanged = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.gauge_changed'),
  payload: zCharacterGaugeChangedPayload,
});
export const zCharacterMomentumChanged = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.momentum_changed'),
  payload: zCharacterMomentumChangedPayload,
});
export const zCharacterMomentumBurned = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.momentum_burned'),
  payload: zCharacterMomentumBurnedPayload,
});
export const zCharacterMomentumNegated = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.momentum_negated'),
  payload: zCharacterMomentumNegatedPayload,
});
export const zCharacterConditionAdded = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.condition_added'),
  payload: zCharacterConditionAddedPayload,
});
export const zCharacterConditionRemoved = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.condition_removed'),
  payload: zCharacterConditionRemovedPayload,
});
export const zCharacterAssetAdded = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.asset_added'),
  payload: zCharacterAssetAddedPayload,
});
export const zCharacterAssetUpgraded = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.asset_upgraded'),
  payload: zCharacterAssetUpgradedPayload,
});
export const zCharacterAssetRemoved = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.asset_removed'),
  payload: zCharacterAssetRemovedPayload,
});
export const zCharacterXpEarned = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.xp_earned'),
  payload: zCharacterXpEarnedPayload,
});
export const zCharacterXpSpent = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.xp_spent'),
  payload: zCharacterXpSpentPayload,
});
export const zCharacterAttributesCorrected = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.attributes_corrected'),
  payload: zCharacterAttributesCorrectedPayload,
});
export const zCharacterDied = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.died'),
  payload: zCharacterDiedPayload,
});
export const zCharacterRetired = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.retired'),
  payload: zCharacterRetiredPayload,
});
export const zCharacterSheetRebound = z.object({
  ...eventEnvelopeShape,
  type: z.literal('character.sheet_rebound'),
  payload: zCharacterSheetReboundPayload,
});

// ------------------------------------------------------------------- roll.*

export const zRollActionResolved = z.object({
  ...eventEnvelopeShape,
  type: z.literal('roll.action_resolved'),
  payload: zRollActionResolvedPayload,
});
export const zRollActionRevised = z.object({
  ...eventEnvelopeShape,
  type: z.literal('roll.action_revised'),
  payload: zRollActionRevisedPayload,
});
export const zRollProgressResolved = z.object({
  ...eventEnvelopeShape,
  type: z.literal('roll.progress_resolved'),
  payload: zRollProgressResolvedPayload,
});
export const zRollOracleResolved = z.object({
  ...eventEnvelopeShape,
  type: z.literal('roll.oracle_resolved'),
  payload: zRollOracleResolvedPayload,
});
export const zRollYesNoResolved = z.object({
  ...eventEnvelopeShape,
  type: z.literal('roll.yes_no_resolved'),
  payload: zRollYesNoResolvedPayload,
});
export const zRollPricePaid = z.object({
  ...eventEnvelopeShape,
  type: z.literal('roll.price_paid'),
  payload: zRollPricePaidPayload,
});
export const zRollPresageDrawn = z.object({
  ...eventEnvelopeShape,
  type: z.literal('roll.presage_drawn'),
  payload: zRollPresageDrawnPayload,
});
export const zRollRaw = z.object({
  ...eventEnvelopeShape,
  type: z.literal('roll.raw'),
  payload: zRollRawPayload,
});

// ------------------------------------------------------------------- move.*

export const zMoveDeclared = z.object({
  ...eventEnvelopeShape,
  type: z.literal('move.declared'),
  payload: zMoveDeclaredPayload,
});
export const zMoveResolved = z.object({
  ...eventEnvelopeShape,
  type: z.literal('move.resolved'),
  payload: zMoveResolvedPayload,
});
export const zMoveAborted = z.object({
  ...eventEnvelopeShape,
  type: z.literal('move.aborted'),
  payload: zMoveAbortedPayload,
});

// ---------------------------------------------------------- track.* clock.*

export const zTrackCreated = z.object({
  ...eventEnvelopeShape,
  type: z.literal('track.created'),
  payload: zTrackCreatedPayload,
});
export const zTrackTicked = z.object({
  ...eventEnvelopeShape,
  type: z.literal('track.ticked'),
  payload: zTrackTickedPayload,
});
export const zTrackRankChanged = z.object({
  ...eventEnvelopeShape,
  type: z.literal('track.rank_changed'),
  payload: zTrackRankChangedPayload,
});
export const zTrackResolved = z.object({
  ...eventEnvelopeShape,
  type: z.literal('track.resolved'),
  payload: zTrackResolvedPayload,
});
export const zTrackForsaken = z.object({
  ...eventEnvelopeShape,
  type: z.literal('track.forsaken'),
  payload: zTrackForsakenPayload,
});
export const zTrackAbandoned = z.object({
  ...eventEnvelopeShape,
  type: z.literal('track.abandoned'),
  payload: zTrackAbandonedPayload,
});
export const zClockCreated = z.object({
  ...eventEnvelopeShape,
  type: z.literal('clock.created'),
  payload: zClockCreatedPayload,
});
export const zClockAdvanced = z.object({
  ...eventEnvelopeShape,
  type: z.literal('clock.advanced'),
  payload: zClockAdvancedPayload,
});
export const zClockFilled = z.object({
  ...eventEnvelopeShape,
  type: z.literal('clock.filled'),
  payload: zClockFilledPayload,
});
export const zClockResolved = z.object({
  ...eventEnvelopeShape,
  type: z.literal('clock.resolved'),
  payload: zClockResolvedPayload,
});
export const zClockCancelled = z.object({
  ...eventEnvelopeShape,
  type: z.literal('clock.cancelled'),
  payload: zClockCancelledPayload,
});

// ------------------------------------------------------ scene.* narration.*

export const zSceneStarted = z.object({
  ...eventEnvelopeShape,
  type: z.literal('scene.started'),
  payload: zSceneStartedPayload,
});
export const zSceneEnded = z.object({
  ...eventEnvelopeShape,
  type: z.literal('scene.ended'),
  payload: zSceneEndedPayload,
});
export const zSceneFactsUpdated = z.object({
  ...eventEnvelopeShape,
  type: z.literal('scene.facts_updated'),
  payload: zSceneFactsUpdatedPayload,
});
export const zNarrationPlayerMessage = z.object({
  ...eventEnvelopeShape,
  type: z.literal('narration.player_message'),
  payload: zNarrationPlayerMessagePayload,
});
export const zNarrationGmMessage = z.object({
  ...eventEnvelopeShape,
  type: z.literal('narration.gm_message'),
  payload: zNarrationGmMessagePayload,
});
export const zNarrationGmFailed = z.object({
  ...eventEnvelopeShape,
  type: z.literal('narration.gm_failed'),
  payload: zNarrationGmFailedPayload,
});
export const zNarrationGmProposal = z.object({
  ...eventEnvelopeShape,
  type: z.literal('narration.gm_proposal'),
  payload: zNarrationGmProposalPayload,
});
export const zNarrationProposalAccepted = z.object({
  ...eventEnvelopeShape,
  type: z.literal('narration.proposal_accepted'),
  payload: zNarrationProposalAcceptedPayload,
});
export const zNarrationProposalRejected = z.object({
  ...eventEnvelopeShape,
  type: z.literal('narration.proposal_rejected'),
  payload: zNarrationProposalRejectedPayload,
});
export const zNarrationSafetyFlag = z.object({
  ...eventEnvelopeShape,
  type: z.literal('narration.safety_flag'),
  payload: zNarrationSafetyFlagPayload,
});

// ----------------------------------------------------------------- entity.*

export const zEntityIntroduced = z.object({
  ...eventEnvelopeShape,
  type: z.literal('entity.introduced'),
  payload: zEntityIntroducedPayload,
});
export const zEntityUpdated = z.object({
  ...eventEnvelopeShape,
  type: z.literal('entity.updated'),
  payload: zEntityUpdatedPayload,
});
export const zEntityStatusChanged = z.object({
  ...eventEnvelopeShape,
  type: z.literal('entity.status_changed'),
  payload: zEntityStatusChangedPayload,
});
export const zEntityMentioned = z.object({
  ...eventEnvelopeShape,
  type: z.literal('entity.mentioned'),
  payload: zEntityMentionedPayload,
});

// --------------------------------------------------- session.* chronicle.*

export const zSessionOpened = z.object({
  ...eventEnvelopeShape,
  type: z.literal('session.opened'),
  payload: zSessionOpenedPayload,
});
export const zSessionClosed = z.object({
  ...eventEnvelopeShape,
  type: z.literal('session.closed'),
  payload: zSessionClosedPayload,
});
export const zChronicleCompacted = z.object({
  ...eventEnvelopeShape,
  type: z.literal('chronicle.compacted'),
  payload: zChronicleCompactedPayload,
});

// ----------------------------------------------------------------- system.*

export const zSystemReverted = z.object({
  ...eventEnvelopeShape,
  type: z.literal('system.reverted'),
  payload: zSystemRevertedPayload,
});
export const zSystemCorrection = z.object({
  ...eventEnvelopeShape,
  type: z.literal('system.correction'),
  payload: zSystemCorrectionPayload,
});
export const zSystemRulesVersionMigrated = z.object({
  ...eventEnvelopeShape,
  type: z.literal('system.rules_version_migrated'),
  payload: zSystemRulesVersionMigratedPayload,
});
export const zSystemPayloadUpcast = z.object({
  ...eventEnvelopeShape,
  type: z.literal('system.payload_upcast'),
  payload: zSystemPayloadUpcastPayload,
});
export const zSystemNote = z.object({
  ...eventEnvelopeShape,
  type: z.literal('system.note'),
  payload: zSystemNotePayload,
});

// ------------------------------------------------------------- the catalogue

export const zGameEvent = z.discriminatedUnion('type', [
  zCampaignCreated,
  zCampaignTruthSet,
  zCampaignSettingsUpdated,
  zCampaignStatusChanged,
  zCampaignContentPackChanged,
  zPartyMemberJoined,
  zPartyMemberLeft,
  zPartyMemberRoleChanged,
  zPartyChampionLocked,
  zPartyChampionUnlocked,
  zCharacterCreated,
  zCharacterRenamed,
  zCharacterGaugeChanged,
  zCharacterMomentumChanged,
  zCharacterMomentumBurned,
  zCharacterMomentumNegated,
  zCharacterConditionAdded,
  zCharacterConditionRemoved,
  zCharacterAssetAdded,
  zCharacterAssetUpgraded,
  zCharacterAssetRemoved,
  zCharacterXpEarned,
  zCharacterXpSpent,
  zCharacterAttributesCorrected,
  zCharacterDied,
  zCharacterRetired,
  zCharacterSheetRebound,
  zRollActionResolved,
  zRollActionRevised,
  zRollProgressResolved,
  zRollOracleResolved,
  zRollYesNoResolved,
  zRollPricePaid,
  zRollPresageDrawn,
  zRollRaw,
  zMoveDeclared,
  zMoveResolved,
  zMoveAborted,
  zTrackCreated,
  zTrackTicked,
  zTrackRankChanged,
  zTrackResolved,
  zTrackForsaken,
  zTrackAbandoned,
  zClockCreated,
  zClockAdvanced,
  zClockFilled,
  zClockResolved,
  zClockCancelled,
  zSceneStarted,
  zSceneEnded,
  zSceneFactsUpdated,
  zNarrationPlayerMessage,
  zNarrationGmMessage,
  zNarrationGmFailed,
  zNarrationGmProposal,
  zNarrationProposalAccepted,
  zNarrationProposalRejected,
  zNarrationSafetyFlag,
  zEntityIntroduced,
  zEntityUpdated,
  zEntityStatusChanged,
  zEntityMentioned,
  zSessionOpened,
  zSessionClosed,
  zChronicleCompacted,
  zSystemReverted,
  zSystemCorrection,
  zSystemRulesVersionMigrated,
  zSystemPayloadUpcast,
  zSystemNote,
]) satisfies z.ZodType<GameEvent>;

export type GameEventDto = z.output<typeof zGameEvent>;

/**
 * The discriminants this schema actually carries, in declaration order.
 *
 * DERIVED, never hand-written. A fourth hand-kept list would be a fourth place
 * to forget, and the whole point of the catalogue tests is that there is no
 * such place.
 */
export function gameEventTypesOfSchema(): readonly string[] {
  return zGameEvent.options.map((option) => option.shape.type.value);
}
