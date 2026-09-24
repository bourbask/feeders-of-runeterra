/**
 * Every closed union the engine declares, retyped as a Zod enum.
 *
 * WHY RETYPED AND NOT IMPORTED. The engine exports each of these as an
 * `as const` tuple, and reusing it would be one line. It is forbidden:
 * `contracts-ne-depend-que-de-zod` (`.dependency-cruiser.cjs`) lets `src/`
 * reach `zod` and TYPE-ONLY imports, nothing else. A value import of
 * `ATTRIBUTES` puts a runtime edge `contracts -> engine` in the graph.
 *
 * So each tuple is written twice, and the copy is nailed down from both sides:
 *
 *   const T = [...] as const satisfies readonly Engine[];   // no extra member
 *   export type TComplete = AssertNever<Exclude<Engine, (typeof T)[number]>>;
 *                                                          // no missing one
 *
 * Only the pair is a guard. `satisfies` alone would accept an EMPTY tuple, and
 * `Exclude` alone would accept a misspelled member. Both have to be there.
 */

import { z } from 'zod';

import type {
  ActorKind,
  AttributeId,
  CampaignStatus,
  ChampionLockKind,
  CharacterStatus,
  ClockSegmentCount,
  ClockStatus,
  CreatableTrackKind,
  EffectTarget,
  EntityDisposition,
  EntityKind,
  EntityStatus,
  GaugeId,
  GmProposalKind,
  Likelihood,
  MoveId,
  Outcome,
  PartyRole,
  ProgressRank,
  ProgressTrackKind,
  ProgressTrackStatus,
  RngStream,
  RuleViolationCode,
  SceneAbsenceCause,
  SheetSource,
  Visibility,
} from '@for/engine';

import type { AssertNever } from '../primitives.js';

// ------------------------------------------------------------------ journal

const ACTOR_KINDS = ['player', 'engine', 'gm_ai', 'system'] as const satisfies readonly ActorKind[];
export type ActorKindsAreComplete = AssertNever<Exclude<ActorKind, (typeof ACTOR_KINDS)[number]>>;
export const zActorKind = z.enum(ACTOR_KINDS);

/**
 * 03-donnees.md section 3.1 writes `rngStream: z.string().nullable()`. The
 * engine restricts it to the closed `RngStream` union, and the mirror rule
 * makes the engine canonical: a free string would not satisfy
 * `z.ZodType<GameEvent>`. Reported rather than relaxed on the engine side.
 */
const RNG_STREAMS = [
  'action',
  'challenge-a',
  'challenge-b',
  'oracle',
  'price',
  'presage',
  'fallback',
] as const satisfies readonly RngStream[];
export type RngStreamsAreComplete = AssertNever<Exclude<RngStream, (typeof RNG_STREAMS)[number]>>;
export const zRngStream = z.enum(RNG_STREAMS);

// --------------------------------------------------------------- characters

const ATTRIBUTES = [
  'vif',
  'coeur',
  'fer',
  'ombre',
  'esprit',
] as const satisfies readonly AttributeId[];
export type AttributesAreComplete = AssertNever<Exclude<AttributeId, (typeof ATTRIBUTES)[number]>>;
export const zAttributeId = z.enum(ATTRIBUTES);

const GAUGES = ['vigueur', 'ame', 'vivres'] as const satisfies readonly GaugeId[];
export type GaugesAreComplete = AssertNever<Exclude<GaugeId, (typeof GAUGES)[number]>>;
export const zGaugeId = z.enum(GAUGES);

const CHARACTER_STATUSES = [
  'draft',
  'active',
  'retired',
  'dead',
] as const satisfies readonly CharacterStatus[];
export type CharacterStatusesAreComplete = AssertNever<
  Exclude<CharacterStatus, (typeof CHARACTER_STATUSES)[number]>
>;
export const zCharacterStatus = z.enum(CHARACTER_STATUSES);

const SHEET_SOURCES = ['handwritten', 'forged'] as const satisfies readonly SheetSource[];
export type SheetSourcesAreComplete = AssertNever<
  Exclude<SheetSource, (typeof SHEET_SOURCES)[number]>
>;
export const zSheetSource = z.enum(SHEET_SOURCES);

// ----------------------------------------------------------------- campaign

const CAMPAIGN_STATUSES = [
  'draft',
  'active',
  'paused',
  'archived',
] as const satisfies readonly CampaignStatus[];
export type CampaignStatusesAreComplete = AssertNever<
  Exclude<CampaignStatus, (typeof CAMPAIGN_STATUSES)[number]>
>;
export const zCampaignStatus = z.enum(CAMPAIGN_STATUSES);

const PARTY_ROLES = ['owner', 'player', 'spectator'] as const satisfies readonly PartyRole[];
export type PartyRolesAreComplete = AssertNever<Exclude<PartyRole, (typeof PARTY_ROLES)[number]>>;
export const zPartyRole = z.enum(PARTY_ROLES);

const CHAMPION_LOCK_KINDS = [
  'reserved_pc',
  'allowed_npc',
  'banned',
] as const satisfies readonly ChampionLockKind[];
export type ChampionLockKindsAreComplete = AssertNever<
  Exclude<ChampionLockKind, (typeof CHAMPION_LOCK_KINDS)[number]>
>;
export const zChampionLockKind = z.enum(CHAMPION_LOCK_KINDS);

// ----------------------------------------------------------------- progress

const PROGRESS_RANKS = [
  'genant',
  'dangereux',
  'redoutable',
  'extreme',
  'epique',
] as const satisfies readonly ProgressRank[];
export type ProgressRanksAreComplete = AssertNever<
  Exclude<ProgressRank, (typeof PROGRESS_RANKS)[number]>
>;
export const zProgressRank = z.enum(PROGRESS_RANKS);

const PROGRESS_TRACK_KINDS = [
  'vow',
  'combat',
  'journey',
  'scene_challenge',
  'bond',
] as const satisfies readonly ProgressTrackKind[];
export type ProgressTrackKindsAreComplete = AssertNever<
  Exclude<ProgressTrackKind, (typeof PROGRESS_TRACK_KINDS)[number]>
>;
export const zProgressTrackKind = z.enum(PROGRESS_TRACK_KINDS);

const PROGRESS_TRACK_STATUSES = [
  'open',
  'fulfilled',
  'forsaken',
  'failed',
  'abandoned',
] as const satisfies readonly ProgressTrackStatus[];
export type ProgressTrackStatusesAreComplete = AssertNever<
  Exclude<ProgressTrackStatus, (typeof PROGRESS_TRACK_STATUSES)[number]>
>;
export const zProgressTrackStatus = z.enum(PROGRESS_TRACK_STATUSES);

const VISIBILITIES = ['public', 'gm'] as const satisfies readonly Visibility[];
export type VisibilitiesAreComplete = AssertNever<
  Exclude<Visibility, (typeof VISIBILITIES)[number]>
>;
export const zVisibility = z.enum(VISIBILITIES);

// ------------------------------------------------------------------- clocks

const CLOCK_SEGMENT_COUNTS = [4, 6, 8, 10] as const satisfies readonly ClockSegmentCount[];
export type ClockSegmentCountsAreComplete = AssertNever<
  Exclude<ClockSegmentCount, (typeof CLOCK_SEGMENT_COUNTS)[number]>
>;
export const zClockSegmentCount = z.literal(CLOCK_SEGMENT_COUNTS);

const CLOCK_STATUSES = [
  'ticking',
  'filled',
  'resolved',
  'cancelled',
] as const satisfies readonly ClockStatus[];
export type ClockStatusesAreComplete = AssertNever<
  Exclude<ClockStatus, (typeof CLOCK_STATUSES)[number]>
>;
export const zClockStatus = z.enum(CLOCK_STATUSES);

// ----------------------------------------------------------------- entities

const ENTITY_KINDS = [
  'npc',
  'place',
  'faction',
  'item',
  'beast',
  'thread',
  'presage',
] as const satisfies readonly EntityKind[];
export type EntityKindsAreComplete = AssertNever<
  Exclude<EntityKind, (typeof ENTITY_KINDS)[number]>
>;
export const zEntityKind = z.enum(ENTITY_KINDS);

const ENTITY_STATUSES = [
  'active',
  'dormant',
  'dead',
  'destroyed',
  'resolved',
] as const satisfies readonly EntityStatus[];
export type EntityStatusesAreComplete = AssertNever<
  Exclude<EntityStatus, (typeof ENTITY_STATUSES)[number]>
>;
export const zEntityStatus = z.enum(ENTITY_STATUSES);

const ENTITY_DISPOSITIONS = [
  'allie',
  'neutre',
  'hostile',
  'inconnu',
] as const satisfies readonly EntityDisposition[];
export type EntityDispositionsAreComplete = AssertNever<
  Exclude<EntityDisposition, (typeof ENTITY_DISPOSITIONS)[number]>
>;
export const zEntityDisposition = z.enum(ENTITY_DISPOSITIONS);

// -------------------------------------------------------------------- moves

const MOVE_IDS = [
  'face-danger',
  'secure-advantage',
  'gather-information',
  'probe-a-soul',
  'strike',
  'endure-harm',
  'endure-cold',
  'swear-a-vow',
  'fulfill-your-vow',
  'reach-a-milestone',
  'forsake-your-vow',
] as const satisfies readonly MoveId[];
export type MoveIdsAreComplete = AssertNever<Exclude<MoveId, (typeof MOVE_IDS)[number]>>;
export const zMoveId = z.enum(MOVE_IDS);

const OUTCOMES = ['franche', 'partielle', 'echec'] as const satisfies readonly Outcome[];
export type OutcomesAreComplete = AssertNever<Exclude<Outcome, (typeof OUTCOMES)[number]>>;
export const zOutcome = z.enum(OUTCOMES);

const LIKELIHOODS = [
  'quasi-certain',
  'probable',
  'incertain',
  'peu-probable',
  'improbable',
] as const satisfies readonly Likelihood[];
export type LikelihoodsAreComplete = AssertNever<Exclude<Likelihood, (typeof LIKELIHOODS)[number]>>;
export const zLikelihood = z.enum(LIKELIHOODS);

// -------------------------------------------------------------------- scene

const SCENE_ABSENCE_CAUSES = [
  'parti',
  'mort',
  'hors_de_portee',
] as const satisfies readonly SceneAbsenceCause[];
export type SceneAbsenceCausesAreComplete = AssertNever<
  Exclude<SceneAbsenceCause, (typeof SCENE_ABSENCE_CAUSES)[number]>
>;
export const zSceneAbsenceCause = z.enum(SCENE_ABSENCE_CAUSES);

// ------------------------------------------------------------------ effects

const EFFECT_TARGETS = [
  'self',
  'chosen-ally',
  'all-allies',
] as const satisfies readonly EffectTarget[];
export type EffectTargetsAreComplete = AssertNever<
  Exclude<EffectTarget, (typeof EFFECT_TARGETS)[number]>
>;
export const zEffectTarget = z.enum(EFFECT_TARGETS);

const CREATABLE_TRACK_KINDS = [
  'vow',
  'combat',
  'journey',
  'scene_challenge',
] as const satisfies readonly CreatableTrackKind[];
export type CreatableTrackKindsAreComplete = AssertNever<
  Exclude<CreatableTrackKind, (typeof CREATABLE_TRACK_KINDS)[number]>
>;
export const zCreatableTrackKind = z.enum(CREATABLE_TRACK_KINDS);

// ---------------------------------------------------------------- narration

/** There is NO `price_choice`, and there never will be without an ADR. */
const GM_PROPOSAL_KINDS = [
  'entity',
  'clock',
  'thread',
  'lore_fact',
  'scene',
  'scene_facts',
  'refusal',
] as const satisfies readonly GmProposalKind[];
export type GmProposalKindsAreComplete = AssertNever<
  Exclude<GmProposalKind, (typeof GM_PROPOSAL_KINDS)[number]>
>;
export const zGmProposalKind = z.enum(GM_PROPOSAL_KINDS);

// --------------------------------------------------------------- violations

/**
 * The engine's closed refusal vocabulary. It carries NO human text: the client
 * maps a code to a French sentence (01-architecture.md section 3.3).
 */
const RULE_VIOLATION_CODES = [
  'move_in_progress',
  'gauge_out_of_range',
  'unknown_move',
  'character_dead',
  'character_retired',
  'character_not_in_campaign',
  'unknown_character',
  'unknown_track',
  'unknown_clock',
  'unknown_entity',
  'unknown_oracle_table',
  'campaign_not_active',
  'not_a_member',
  'attribute_spread_illegal',
  'attribute_not_allowed',
  'champion_locked',
  'track_already_resolved',
  'track_wrong_kind',
  'no_burn_window',
  'momentum_too_low',
  'insufficient_xp',
  'no_active_scene',
  'scene_capacity_exceeded',
  'target_not_present',
] as const satisfies readonly RuleViolationCode[];
export type RuleViolationCodesAreComplete = AssertNever<
  Exclude<RuleViolationCode, (typeof RULE_VIOLATION_CODES)[number]>
>;
export const zRuleViolationCode = z.enum(RULE_VIOLATION_CODES);
