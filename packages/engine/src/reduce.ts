/**
 * `reduce()` — the journal, played back.
 *
 * THE GOLDEN RULE: `decide` draws the dice, `reduce` NEVER does. There is no
 * `Rng` in this file, no clock, no identifier minting and no judgement. Every
 * value that varies is already in the payload, which is what makes a replay
 * give back the same bytes (invariant 4, 03-donnees.md section 3.3).
 *
 * WHY THE SWITCH HAS SEVENTY-ONE BRANCHES AND NO `default`.
 * Two nets, and they do not have the same mesh:
 *
 *   - `@typescript-eslint/switch-exhaustiveness-check` is on and does NOT
 *     accept a `default` as coverage, so a missing case is a lint error;
 *   - `applyEvent` declares a return type and every branch returns, so with
 *     `noImplicitReturns` a missing case makes the end of the function
 *     REACHABLE and `tsc` fails (TS2366 / TS7030). That is the acceptance
 *     criterion of this task, and it is the type system that enforces it.
 *
 * There is deliberately NO `assertNever(event)` at the bottom: with the switch
 * exhaustive, that line is unreachable, and `allowUnreachableCode: false`
 * refuses it. Measured, not assumed.
 *
 * A seventy-second event type added tomorrow therefore breaks the build here,
 * loudly, rather than falling into a `default: return state` that drops it in
 * silence. Half the branches below do return the state untouched — but each
 * one SAYS SO, on its own line, which is the difference between a decision and
 * an oversight.
 *
 * FOUR REVIEW CONSTRAINTS (03-donnees.md section 3.3), all met here:
 *   1. total purity — nothing ambient;
 *   2. totality — an event that has passed its schema never throws, even when
 *      it disagrees with the state; it saturates instead;
 *   3. replay idempotence — the same journal gives the same state, from a
 *      snapshot or from zero;
 *   4. no information from outside the journal.
 */

import { clampGauge } from './gauges.js';
import type { CampaignId, CharacterId, ClockId, EntityId, PlayerId, TrackId } from './ids.js';
import { clampMomentum } from './momentum.js';
import { clampTicks } from './progress-track.js';
import type { CampaignSettings, CampaignState, CampaignTruth, RngState } from './types/campaign.js';
import type { CharacterState } from './types/character.js';
import type { ClockState } from './types/clock.js';
import type { EntityState } from './types/entity.js';
import type { EventEnvelope, GameEvent, PartialPayload } from './types/events.js';
import { DEFAULT_MOMENTUM_BOUNDS } from './types/gauges.js';
import type { TrackState } from './types/progress.js';
import type { SceneAbsence, ScenePresence, SceneRef } from './types/scene.js';

/**
 * Bump it and old snapshots stop being selected (`reducer_version = ?` in
 * `loadState`); they are purged, never migrated (03-donnees.md section 3.5).
 */
export const REDUCER_VERSION = 1;

/** Settings a campaign starts with when nobody has configured anything. */
export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettings = {
  schemaVersion: 1,
  models: { narration: null, structured: null },
  gmVerbosity: 'standard',
  oracleBias: 'neutre',
  safety: { lines: [], veils: [] },
  allowForgedChampions: false,
  requireForgeReview: true,
};

export interface CreateCampaignInput {
  readonly campaignId: CampaignId;
  readonly ownerPlayerId: PlayerId;
  /** Campaign seed. Every die of the campaign derives from it. */
  readonly seed?: string;
  readonly contentPackHash?: string;
  readonly settings?: CampaignSettings;
}

/**
 * The state before the first entry: `seq` at zero, every collection empty, no
 * scene open, no draw consumed.
 *
 * Empty rather than plausible, for the same reason `aTableState()` is empty:
 * a state that starts with a character would make every count in the
 * repository read "minus one".
 */
export function createInitialCampaignState(input: CreateCampaignInput): CampaignState {
  return {
    campaignId: input.campaignId,
    seq: 0,
    reducerVersion: REDUCER_VERSION,
    contentPackHash: input.contentPackHash ?? '',
    status: 'draft',
    settings: input.settings ?? DEFAULT_CAMPAIGN_SETTINGS,
    truths: [],
    characters: {},
    tracks: {},
    clocks: {},
    entities: {},
    championLocks: {},
    scene: null,
    party: { memberPlayerIds: [], ownerPlayerId: input.ownerPlayerId },
    rng: { seed: input.seed ?? '', draws: {} },
  };
}

// ------------------------------------------------------------------ plumbing

/** A collection keyed by identifier, with one member replaced. */
function withKey<TKey extends string, TValue>(
  record: Readonly<Record<TKey, TValue>>,
  key: TKey,
  value: TValue,
): Readonly<Record<TKey, TValue>> {
  return { ...record, [key]: value };
}

/** The same, with one member removed. */
function withoutKey<TKey extends string, TValue>(
  record: Readonly<Record<TKey, TValue>>,
  key: TKey,
): Readonly<Record<TKey, TValue>> {
  const rest: Record<string, TValue> = {};
  for (const [existing, value] of Object.entries<TValue>(record)) {
    if (existing !== key) rest[existing] = value;
  }
  return rest as Readonly<Record<TKey, TValue>>;
}

/**
 * Update one character, or leave the state alone.
 *
 * Totality (constraint 2): an event about someone who is not at the table is
 * applied to nobody rather than throwing. The inconsistency is caught upstream
 * by `decide`, which refuses `unknown_character` before a die is drawn.
 */
function withCharacter(
  state: CampaignState,
  id: CharacterId,
  seq: number,
  update: (character: CharacterState) => CharacterState,
): CampaignState {
  const character = state.characters[id];
  if (character === undefined) return state;
  return {
    ...state,
    characters: withKey(state.characters, id, { ...update(character), updatedSeq: seq }),
  };
}

function withTrack(
  state: CampaignState,
  id: TrackId,
  seq: number,
  update: (track: TrackState) => TrackState,
): CampaignState {
  const track = state.tracks[id];
  if (track === undefined) return state;
  return { ...state, tracks: withKey(state.tracks, id, { ...update(track), updatedSeq: seq }) };
}

function withClock(
  state: CampaignState,
  id: ClockId,
  seq: number,
  update: (clock: ClockState) => ClockState,
): CampaignState {
  const clock = state.clocks[id];
  if (clock === undefined) return state;
  return { ...state, clocks: withKey(state.clocks, id, { ...update(clock), updatedSeq: seq }) };
}

function withEntity(
  state: CampaignState,
  id: EntityId,
  seq: number,
  update: (entity: EntityState) => EntityState,
): CampaignState {
  const entity = state.entities[id];
  if (entity === undefined) return state;
  return {
    ...state,
    entities: withKey(state.entities, id, { ...update(entity), lastSeenSeq: seq }),
  };
}

/**
 * Both scene lists are SORTED BY `ref.id` and keyed by it.
 *
 * Sorted, because the `<scene>` block of the prompt must be byte-identical
 * from one call to the next at equal facts, or the prompt cache prefix changes
 * for nothing (03-donnees.md section 3.5, property 2). Keyed, because `absent`
 * is a set of people, not a log: the same character listed twice is the same
 * absence, and the last mention wins.
 */
function sortedByRef<T extends { readonly ref: SceneRef }>(entries: readonly T[]): readonly T[] {
  const byId = new Map<string, T>();
  for (const entry of entries) byId.set(entry.ref.id, entry);
  return [...byId.values()].sort((a, b) => a.ref.id.localeCompare(b.ref.id));
}

/**
 * Known top-level fields of an entity, the only ones an `entity.updated` patch
 * may move. Anything else the patch carries lands in `details`, which is the
 * field that exists for what the schema does not name.
 */
const ENTITY_TEXT_FIELDS = ['slug', 'name', 'summary'] as const;

type EntityTextField = (typeof ENTITY_TEXT_FIELDS)[number];

function isEntityTextField(key: string): key is EntityTextField {
  return (ENTITY_TEXT_FIELDS as readonly string[]).includes(key);
}

function applyEntityPatch(
  entity: EntityState,
  patch: Readonly<Record<string, unknown>>,
): EntityState {
  const text: Partial<Record<EntityTextField, string>> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (isEntityTextField(key) && typeof value === 'string') {
      text[key] = value;
      continue;
    }
    rest[key] = value;
  }
  const withText: EntityState = { ...entity, ...text };
  return Object.keys(rest).length === 0
    ? withText
    : { ...withText, details: { ...withText.details, ...rest } };
}

/**
 * `system.correction` applies to ONE named field, and the engine only knows how
 * to move the two a typo actually lands on: a character's display name and an
 * entity's name. Paths are `characters.<id>.displayName` and
 * `entities.<id>.name`.
 *
 * Anything else leaves the state untouched rather than being interpreted. A
 * generic field-path writer would be a second, unbounded way to change state,
 * which is exactly the door ARCHITECTURE.md section 6 says must stay shut.
 */
function applyCorrection(
  state: CampaignState,
  seq: number,
  field: string,
  to: unknown,
): CampaignState {
  if (typeof to !== 'string') return state;
  const parts = field.split('.');
  if (parts.length !== 3) return state;
  const [collection, id, property] = parts as [string, string, string];
  if (collection === 'characters' && property === 'displayName') {
    return withCharacter(state, id as CharacterId, seq, (character) => ({
      ...character,
      displayName: to,
    }));
  }
  if (collection === 'entities' && property === 'name') {
    return withEntity(state, id as EntityId, seq, (entity) => ({ ...entity, name: to }));
  }
  return state;
}

/**
 * Settings, patched.
 *
 * A key present with the value `undefined` means "not in this patch", not
 * "unset this": `PartialPayload` allows both the absent key and the explicit
 * `undefined` (`types/events.ts` explains why `Partial` could not be used),
 * and a plain spread would write `undefined` over a real setting.
 */
function mergeSettings(
  settings: CampaignSettings,
  patch: PartialPayload<CampaignSettings>,
): CampaignSettings {
  const next: Record<string, unknown> = { ...settings };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key] = value;
  }
  return next as unknown as CampaignSettings;
}

/** Upsert a truth by `truthId`: answering twice is answering once. */
function withTruth(
  truths: readonly CampaignTruth[],
  truth: CampaignTruth,
): readonly CampaignTruth[] {
  const others = truths.filter((existing) => existing.truthId !== truth.truthId);
  return [...others, truth].sort((a, b) => a.truthId.localeCompare(b.truthId));
}

/**
 * Draw bookkeeping, and the rule that makes a cancellation cost something.
 *
 * `draws[stream]` is the NEXT index of that stream and it only ever GROWS. A
 * reverted roll leaves its index consumed (03-donnees.md section 3.6), so
 * replaying the same intent after a cancellation does not give back the same
 * dice — which is what stops the right of refusal from becoming a re-roll
 * machine.
 */
export function advanceDraws(rng: RngState, envelope: EventEnvelope): RngState {
  const { rngStream, rngDrawIndex } = envelope;
  if (rngStream === null || rngDrawIndex === null) return rng;
  const current = rng.draws[rngStream] ?? 0;
  const next = Math.max(current, rngDrawIndex + 1);
  if (next === current) return rng;
  return { ...rng, draws: { ...rng.draws, [rngStream]: next } };
}

/** Envelope bookkeeping every entry does, whatever its type. */
function withEnvelope(state: CampaignState, event: GameEvent): CampaignState {
  const rng = advanceDraws(state.rng, event);
  const seq = Math.max(state.seq, event.seq);
  if (rng === state.rng && seq === state.seq) return state;
  return { ...state, seq, rng };
}

// -------------------------------------------------------------- the reducer

/**
 * One entry applied. Pure, total, and free of any draw.
 *
 * `reduce` never mutates what it is handed: every branch rebuilds the parts it
 * touches. A test can prove it by freezing the state first — see
 * `freezeState`, which exists because `__DEV__` does not (ADR 0005 dropped the
 * bundler that would have defined it, so the freeze is a caller-side tool
 * rather than a build-time one).
 */
export function reduce(state: CampaignState, event: GameEvent): CampaignState {
  return withEnvelope(applyEvent(state, event), event);
}

function applyEvent(state: CampaignState, event: GameEvent): CampaignState {
  const { seq } = event;
  switch (event.type) {
    // ------------------------------------------------------------ campaign.*
    case 'campaign.created':
      return {
        ...state,
        contentPackHash: event.payload.contentPackHash,
        party: { ...state.party, ownerPlayerId: event.payload.ownerPlayerId },
        rng: { ...state.rng, seed: event.payload.rngSeed },
      };
    case 'campaign.truth_set':
      return {
        ...state,
        truths: withTruth(state.truths, {
          truthId: event.payload.truthId,
          optionId: event.payload.optionId,
          customText: event.payload.customText ?? null,
        }),
      };
    case 'campaign.settings_updated':
      return { ...state, settings: mergeSettings(state.settings, event.payload.patch) };
    case 'campaign.status_changed':
      return { ...state, status: event.payload.to };
    case 'campaign.content_pack_changed':
      return { ...state, contentPackHash: event.payload.toHash };

    // --------------------------------------------------------------- party.*
    case 'party.member_joined':
      return state.party.memberPlayerIds.includes(event.payload.playerId)
        ? state
        : {
            ...state,
            party: {
              ...state.party,
              memberPlayerIds: [...state.party.memberPlayerIds, event.payload.playerId],
            },
          };
    case 'party.member_left':
      return {
        ...state,
        party: {
          ...state.party,
          memberPlayerIds: state.party.memberPlayerIds.filter(
            (playerId) => playerId !== event.payload.playerId,
          ),
        },
      };
    case 'party.member_role_changed':
      // Only one role is a STATE field: who owns the campaign. The rest lives
      // in `campaign_members`, which is platform data and not game state.
      return event.payload.to === 'owner'
        ? { ...state, party: { ...state.party, ownerPlayerId: event.payload.playerId } }
        : state;
    case 'party.champion_locked':
      return {
        ...state,
        championLocks: withKey(state.championLocks, event.payload.championId, {
          championId: event.payload.championId,
          lockKind: event.payload.lockKind,
          reason: event.payload.reason,
          setSeq: seq,
        }),
      };
    case 'party.champion_unlocked':
      return {
        ...state,
        championLocks: withoutKey(state.championLocks, event.payload.championId),
      };

    // ----------------------------------------------------------- character.*
    case 'character.created': {
      const created: CharacterState = {
        id: event.payload.characterId,
        playerId: event.payload.playerId,
        championId: event.payload.championId,
        displayName: event.payload.displayName,
        sheet: {
          championId: event.payload.championId,
          source: event.payload.sheetSource,
          ref: event.payload.sheetRef,
        },
        attributes: event.payload.attributes,
        gauges: event.payload.gauges,
        momentum: event.payload.momentum,
        momentumBounds: DEFAULT_MOMENTUM_BOUNDS,
        xpEarned: 0,
        xpSpent: 0,
        conditions: [],
        assets: [],
        status: 'active',
        createdSeq: seq,
        updatedSeq: seq,
      };
      return { ...state, characters: withKey(state.characters, created.id, created) };
    }
    case 'character.renamed':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        displayName: event.payload.to,
      }));
    case 'character.gauge_changed':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        gauges: { ...character.gauges, [event.payload.gauge]: clampGauge(event.payload.to) },
      }));
    case 'character.momentum_changed':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        momentum: clampMomentum(event.payload.to, character.momentumBounds),
      }));
    case 'character.momentum_burned':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        momentum: clampMomentum(event.payload.resetTo, character.momentumBounds),
      }));
    case 'character.momentum_negated':
      // A fact about a ROLL, not about the sheet: the action die counted as
      // zero, and nothing on the character moved. Recorded, not applied.
      return state;
    case 'character.condition_added':
      return withCharacter(state, event.payload.characterId, seq, (character) =>
        character.conditions.some(
          (condition) => condition.conditionId === event.payload.conditionId,
        )
          ? character
          : {
              ...character,
              conditions: [
                ...character.conditions,
                {
                  conditionId: event.payload.conditionId,
                  label: event.payload.label,
                  source: event.payload.source,
                  sinceSeq: seq,
                },
              ],
            },
      );
    case 'character.condition_removed':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        conditions: character.conditions.filter(
          (condition) => condition.conditionId !== event.payload.conditionId,
        ),
      }));
    case 'character.asset_added':
      return withCharacter(state, event.payload.characterId, seq, (character) =>
        character.assets.some((asset) => asset.assetId === event.payload.assetId)
          ? character
          : {
              ...character,
              assets: [
                ...character.assets,
                {
                  assetId: event.payload.assetId,
                  unlockedAbilities: [],
                  options: event.payload.options ?? {},
                },
              ],
            },
      );
    case 'character.asset_upgraded':
      // The experience it cost is `character.xp_spent`, written alongside. This
      // branch unlocks the ability and nothing else: counting the cost here too
      // would spend it twice.
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        assets: character.assets.map((asset) =>
          asset.assetId === event.payload.assetId
            ? {
                ...asset,
                unlockedAbilities: [
                  ...new Set([...asset.unlockedAbilities, event.payload.abilityIndex]),
                ].sort((a, b) => a - b),
              }
            : asset,
        ),
      }));
    case 'character.asset_removed':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        assets: character.assets.filter((asset) => asset.assetId !== event.payload.assetId),
      }));
    case 'character.xp_earned':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        xpEarned: character.xpEarned + event.payload.amount,
      }));
    case 'character.xp_spent':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        xpSpent: character.xpSpent + event.payload.amount,
      }));
    case 'character.attributes_corrected':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        attributes: event.payload.to,
      }));
    case 'character.died':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        status: 'dead',
      }));
    case 'character.retired':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        status: 'retired',
      }));
    case 'character.sheet_rebound':
      return withCharacter(state, event.payload.characterId, seq, (character) => ({
        ...character,
        sheet: { ...character.sheet, ref: event.payload.toSheetRef },
      }));

    // ---------------------------------------------------------------- roll.*
    // EIGHT BRANCHES THAT CHANGE NOTHING, and that is the point. A roll is a
    // fact the journal records; what it COSTS arrives as its own
    // `character.*` or `track.*` entry, written by `decide` in the same turn.
    // A reducer that applied a cost from a roll payload would apply it twice.
    case 'roll.action_resolved':
      return state;
    case 'roll.action_revised':
      return state;
    case 'roll.progress_resolved':
      return state;
    case 'roll.oracle_resolved':
      return state;
    case 'roll.yes_no_resolved':
      return state;
    case 'roll.price_paid':
      return state;
    case 'roll.presage_drawn':
      return state;
    case 'roll.raw':
      return state;

    // ---------------------------------------------------------------- move.*
    // The move family is narration bookkeeping over rolls and effects that
    // have already been applied one by one. `effectsApplied` is a summary view
    // for the UI and the prompt, never a source of truth (03-donnees.md 3.4).
    case 'move.declared':
      return state;
    case 'move.resolved':
      return state;
    case 'move.aborted':
      return state;

    // -------------------------------------------------------- track.* clock.*
    case 'track.created': {
      const track: TrackState = {
        id: event.payload.trackId,
        kind: event.payload.kind,
        rank: event.payload.rank,
        title: event.payload.title,
        description: event.payload.description,
        ownerCharacterId: event.payload.ownerCharacterId ?? null,
        ticks: clampTicks(event.payload.initialTicks),
        status: 'open',
        visibility: event.payload.visibility,
        tags: [],
        createdSeq: seq,
        updatedSeq: seq,
        resolvedSeq: null,
      };
      return { ...state, tracks: withKey(state.tracks, track.id, track) };
    }
    case 'track.ticked':
      return withTrack(state, event.payload.trackId, seq, (track) => ({
        ...track,
        ticks: clampTicks(event.payload.to),
      }));
    case 'track.rank_changed':
      return withTrack(state, event.payload.trackId, seq, (track) => ({
        ...track,
        rank: event.payload.to,
      }));
    case 'track.resolved':
      return withTrack(state, event.payload.trackId, seq, (track) => ({
        ...track,
        status: event.payload.outcome === 'fulfilled' ? 'fulfilled' : 'failed',
        resolvedSeq: seq,
      }));
    case 'track.forsaken':
      return withTrack(state, event.payload.trackId, seq, (track) => ({
        ...track,
        status: 'forsaken',
        resolvedSeq: seq,
      }));
    case 'track.abandoned':
      // Housekeeping, outside the fiction: not the same ending as `forsaken`,
      // which is a character breaking their word (types/progress.ts).
      return withTrack(state, event.payload.trackId, seq, (track) => ({
        ...track,
        status: 'abandoned',
        resolvedSeq: seq,
      }));
    case 'clock.created': {
      const clock: ClockState = {
        id: event.payload.clockId,
        title: event.payload.title,
        description: event.payload.description,
        segments: event.payload.segments,
        filled: 0,
        status: 'ticking',
        visibility: event.payload.visibility,
        consequence: event.payload.consequence,
        createdSeq: seq,
        updatedSeq: seq,
      };
      return { ...state, clocks: withKey(state.clocks, clock.id, clock) };
    }
    case 'clock.advanced':
      return withClock(state, event.payload.clockId, seq, (clock) => ({
        ...clock,
        filled: Math.min(Math.max(event.payload.to, 0), clock.segments),
      }));
    case 'clock.filled':
      return withClock(state, event.payload.clockId, seq, (clock) => ({
        ...clock,
        filled: clock.segments,
        status: 'filled',
      }));
    case 'clock.resolved':
      return withClock(state, event.payload.clockId, seq, (clock) => ({
        ...clock,
        status: 'resolved',
      }));
    case 'clock.cancelled':
      return withClock(state, event.payload.clockId, seq, (clock) => ({
        ...clock,
        status: 'cancelled',
      }));

    // ------------------------------------------------------ scene.* narration.*
    case 'scene.started': {
      // `absent` is EMPTIED and `present` rebuilt (02-mj-ia.md section 4.7.4):
      // someone who left a scene is not banished from the campaign, they were
      // absent from THAT scene.
      const present: readonly ScenePresence[] = [
        ...event.payload.presentCharacterIds.map((id) => ({
          ref: { kind: 'character', id } as const,
          name: state.characters[id as CharacterId]?.displayName ?? '',
          state: '',
          sinceSeq: seq,
        })),
        ...event.payload.entityIds.map((id) => ({
          ref: { kind: 'entity', id } as const,
          name: state.entities[id as EntityId]?.name ?? '',
          state: '',
          sinceSeq: seq,
        })),
      ];
      return {
        ...state,
        scene: {
          sceneId: event.payload.sceneId,
          // `SceneStartedPayload` carries a `title` and a `regionId` while
          // `SceneState` wants a `placeId` and a `placeName`. The mapping is the
          // only one available; the mismatch is reported with the task rather
          // than smoothed over. `scene.facts_updated` overwrites both.
          placeId: event.payload.regionId ?? '',
          placeName: event.payload.title,
          timeOfDay: '',
          present: sortedByRef(present),
          absent: [],
          updatedSeq: seq,
        },
      };
    }
    case 'scene.ended':
      return { ...state, scene: null };
    case 'scene.facts_updated': {
      // TOTAL REPLACEMENT by the payload's snapshot, never a delta: a delta
      // would force this function to reason about application order, and it
      // must stay total and judgement-free (02-mj-ia.md section 4.7.1).
      // The monotonicity of `absent` is guaranteed UPSTREAM, by the server
      // merge (section 4.7.3, rule S5). Nothing is judged here.
      const previous = state.scene;
      const absent: readonly SceneAbsence[] = event.payload.absent;
      return {
        ...state,
        scene: {
          sceneId: event.payload.sceneId,
          placeId: event.payload.placeId ?? previous?.placeId ?? '',
          placeName: event.payload.placeName ?? previous?.placeName ?? '',
          timeOfDay: event.payload.timeOfDay ?? previous?.timeOfDay ?? '',
          present: sortedByRef(event.payload.present),
          absent: sortedByRef(absent),
          updatedSeq: seq,
        },
      };
    }
    // THE SEVEN `narration.*` BRANCHES CHANGE NOTHING, by nature: they are the
    // trace of what the model said and of what the server did with it, without
    // game value and with no effect on the reducer (03-donnees.md section 0.5).
    // A proposal only becomes state once it has been through the same pipeline
    // as a player intent, as one of the events above.
    case 'narration.player_message':
      return state;
    case 'narration.gm_message':
      return state;
    case 'narration.gm_failed':
      return state;
    case 'narration.gm_proposal':
      return state;
    case 'narration.proposal_accepted':
      return state;
    case 'narration.proposal_rejected':
      return state;
    case 'narration.safety_flag':
      return state;

    // -------------------------------------------------------------- entity.*
    case 'entity.introduced': {
      const entity: EntityState = {
        id: event.payload.entityId,
        kind: event.payload.kind,
        slug: event.payload.slug,
        name: event.payload.name,
        summary: event.payload.summary,
        details: event.payload.details,
        championId: event.payload.championId ?? null,
        regionId: event.payload.regionId ?? null,
        status: 'active',
        disposition: event.payload.disposition ?? null,
        firstSeenSeq: seq,
        lastSeenSeq: seq,
      };
      return { ...state, entities: withKey(state.entities, entity.id, entity) };
    }
    case 'entity.updated':
      return withEntity(state, event.payload.entityId, seq, (entity) =>
        applyEntityPatch(entity, event.payload.patch),
      );
    case 'entity.status_changed':
      return withEntity(state, event.payload.entityId, seq, (entity) => ({
        ...entity,
        status: event.payload.to,
      }));
    case 'entity.mentioned':
      // Lightweight by design: it refreshes `lastSeenSeq`, which `withEntity`
      // does for every entity branch.
      return withEntity(state, event.payload.entityId, seq, (entity) => entity);

    // ----------------------------------------------- session.* chronicle.*
    // A play session is platform bookkeeping, a chronicle is long memory with
    // NO authority (02-mj-ia.md section 5.1). Neither is game state, so
    // neither moves `CampaignState`.
    case 'session.opened':
      return state;
    case 'session.closed':
      return state;
    case 'chronicle.compacted':
      return state;

    // -------------------------------------------------------------- system.*
    case 'system.reverted':
      // A cancellation is not applied HERE: `reduceAll` replays the journal
      // WITHOUT the cancelled sequences (03-donnees.md section 3.5, pre-pass).
      // That is what restores gauges, momentum, conditions, ticks and clock
      // segments exactly, with no list of fields to put back by hand. What the
      // cancellation does NOT give back is the draw indexes — see `reduceAll`.
      return state;
    case 'system.correction':
      return applyCorrection(state, seq, event.payload.field, event.payload.to);
    case 'system.rules_version_migrated':
      // `campaign.created` carries a `rulesVersion` that `CampaignState` has
      // nowhere to store. Reported with the task rather than invented here.
      return state;
    case 'system.payload_upcast':
      // Upcasting happens BEFORE the reducer, in `@for/contracts`; this entry
      // is the trace that it happened.
      return state;
    case 'system.note':
      return state;
  }
}

// ---------------------------------------------------------------- reduceAll

/** Sequences a `system.reverted` in this journal takes back out. */
export function collectRevertedSeqs(events: Iterable<GameEvent>): ReadonlySet<number> {
  const reverted = new Set<number>();
  for (const event of events) {
    if (event.type === 'system.reverted') {
      for (const seq of event.payload.targetSeqs) reverted.add(seq);
    }
  }
  return reverted;
}

/**
 * Replay a whole journal.
 *
 * TWO PASSES, exactly as `loadState` does it (03-donnees.md section 3.5): the
 * first collects the sequences a `system.reverted` takes back out, the second
 * replays and skips them.
 *
 * A SKIPPED ENTRY STILL ADVANCES ITS DRAW STREAM. That is the whole point of
 * section 3.6: a cancelled roll leaves its index consumed, so replaying the
 * same intent after a cancellation does not give back the same dice. Skipping
 * the draw bookkeeping along with the state change would turn the right of
 * refusal into a re-roll machine.
 */
export function reduceAll(state: CampaignState, events: Iterable<GameEvent>): CampaignState {
  const journal = [...events];
  const reverted = collectRevertedSeqs(journal);
  let next = state;
  for (const event of journal) {
    next = reverted.has(event.seq) ? withEnvelope(next, event) : reduce(next, event);
  }
  return next;
}

// ------------------------------------------------------------------- freezing

/**
 * Freeze a state, deeply, so that any write into it throws.
 *
 * WHY THIS IS A FUNCTION AND NOT A BUILD FLAG. 01-architecture.md section 2.3
 * plans `__DEV__` for exactly this, and ADR 0005 removed the bundler that
 * would have defined it: `tsc -b` builds this package and defines no global.
 * Freezing on every `reduce` would cost a deep walk of the whole state per
 * event, which a ten-thousand-entry replay cannot pay. So the freeze is a tool
 * the CALLER applies — in tests, in the simulator — and `reduce` stays fast.
 *
 * In an ES module, which is always strict, writing into a frozen object throws
 * a `TypeError`. That is what makes "the reducer never mutates its input"
 * provable rather than asserted.
 */
export function freezeState<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) freezeState(nested);
  return value;
}
