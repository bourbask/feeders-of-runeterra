/**
 * `aTableState()` — the root of game state, complete and parseable, with no
 * argument at all.
 *
 * A table IS a campaign (`zTableId = zCampaignId`): the product word for the
 * same identifier, which is why this file builds a `CampaignState`.
 *
 * COLLECTIONS ARE PASSED AS ARRAYS, never as records:
 *
 *   aTableState({ characters: [aCharacter(), aCharacter({ id: anId('character', 2) })] })
 *
 * `CampaignState` stores them keyed by identifier, and the builder does the
 * keying. That is not sugar: a hand-written record can key a character under
 * an identifier that is not its own, `zCampaignState` accepts it without a
 * murmur — both sides are valid ULIDs — and the state then lies about who is
 * at the table. `expectValidState` refuses that state; this builder cannot
 * produce it.
 *
 * The sub-builders (`aTrack`, `aClock`, `anEntity`, `aScene`, …) exist for the
 * transverse rule of 01-architecture.md section 7.2: NO literal state object
 * in a test file. A builder for the root that forced literals for its contents
 * would only move the problem one level down.
 *
 * NOTE ON `vows`. Section 7.2 sketches `aTableState({ characters, clocks,
 * vows })`. There is no `vows` field in `CampaignState`: a vow is a track of
 * kind `vow`, so it goes through `tracks` — `aTrack({ kind: 'vow' })`, which
 * is what `aVow()` is for.
 */

import type {
  CampaignId,
  CampaignSettings,
  CampaignState,
  CampaignStatus,
  CampaignTruth,
  ChampionLock,
  CharacterState,
  ClockState,
  EntityState,
  PartyState,
  PlayerId,
  RngState,
  SceneAbsence,
  ScenePresence,
  SceneState,
  TrackState,
} from '@for/engine';

import { SEEDS } from '../rng/seeded.js';
import { aCharacter } from './characters.js';
import { anId } from './ids.js';

type Overrides<T> = { readonly [K in keyof T]?: T[K] };

/**
 * Keys a list by its members' own `id`. The one place the state's records are
 * built, so key and identifier can never drift apart.
 */
function keyById<TId extends string, TValue extends { readonly id: TId }>(
  values: readonly TValue[],
): Readonly<Record<TId, TValue>> {
  const keyed: Partial<Record<TId, TValue>> = {};
  for (const value of values) {
    keyed[value.id] = value;
  }
  return keyed as Readonly<Record<TId, TValue>>;
}

// --------------------------------------------------------------- settings

/** Every settings key, at a value that reads as "nothing special configured". */
export function aCampaignSettings(overrides: Overrides<CampaignSettings> = {}): CampaignSettings {
  const base: CampaignSettings = {
    schemaVersion: 1,
    models: { narration: null, structured: null },
    gmVerbosity: 'standard',
    oracleBias: 'neutre',
    safety: { lines: [], veils: [] },
    allowForgedChampions: false,
    requireForgeReview: true,
  };
  return { ...base, ...overrides };
}

// ------------------------------------------------------------------ parts

export function aTrack(overrides: Overrides<TrackState> = {}): TrackState {
  const base: TrackState = {
    id: anId('track'),
    kind: 'vow',
    rank: 'dangereux',
    title: 'Ramener la corne de Volibear',
    description: 'Un serment prêté au camp avarosan.',
    ownerCharacterId: null,
    ticks: 0,
    status: 'open',
    visibility: 'public',
    tags: [],
    createdSeq: 1,
    updatedSeq: 1,
    resolvedSeq: null,
  };
  return { ...base, ...overrides };
}

/** A track of kind `vow` — what section 7.2 calls a `vow`. */
export function aVow(overrides: Overrides<TrackState> = {}): TrackState {
  return aTrack({ ...overrides, kind: 'vow' });
}

export function aClock(overrides: Overrides<ClockState> = {}): ClockState {
  const base: ClockState = {
    id: anId('clock'),
    title: 'La tempête se lève',
    description: 'Le vent tourne au nord.',
    segments: 6,
    filled: 0,
    status: 'ticking',
    visibility: 'public',
    consequence: 'Le col se ferme pour la saison.',
    createdSeq: 1,
    updatedSeq: 1,
  };
  return { ...base, ...overrides };
}

export function anEntity(overrides: Overrides<EntityState> = {}): EntityState {
  const base: EntityState = {
    id: anId('entity'),
    kind: 'npc',
    slug: 'garde-du-col',
    name: 'Le garde du col',
    summary: 'Une silhouette emmitouflée qui surveille la passe.',
    details: {},
    championId: null,
    regionId: 'freljord',
    status: 'active',
    disposition: 'neutre',
    firstSeenSeq: 1,
    lastSeenSeq: 1,
  };
  return { ...base, ...overrides };
}

export function aChampionLock(overrides: Overrides<ChampionLock> = {}): ChampionLock {
  const base: ChampionLock = {
    championId: 'sejuani',
    lockKind: 'reserved_pc',
    reason: 'fixture',
    setSeq: 1,
  };
  return { ...base, ...overrides };
}

export function aTruth(overrides: Overrides<CampaignTruth> = {}): CampaignTruth {
  const base: CampaignTruth = {
    truthId: 'le-froid',
    optionId: 'le-froid-tue',
    customText: null,
  };
  return { ...base, ...overrides };
}

export function aScenePresence(overrides: Overrides<ScenePresence> = {}): ScenePresence {
  const base: ScenePresence = {
    ref: { kind: 'character', id: anId('character') },
    name: 'Braum',
    state: 'debout, appuyé sur sa porte',
    sinceSeq: 1,
  };
  return { ...base, ...overrides };
}

export function aSceneAbsence(overrides: Overrides<SceneAbsence> = {}): SceneAbsence {
  const base: SceneAbsence = {
    ref: { kind: 'entity', id: anId('entity') },
    name: 'Le garde du col',
    cause: 'parti',
    sinceSeq: 1,
  };
  return { ...base, ...overrides };
}

/**
 * Both lists come out SORTED BY `ref.id`: the `<scene>` prompt block has to be
 * byte-stable at equal facts, or the prompt cache prefix changes for nothing
 * (03-donnees.md section 3.5). A fixture that ignored the sort would hide a
 * reducer that ignores it too.
 */
export function aScene(overrides: Overrides<SceneState> = {}): SceneState {
  const base: SceneState = {
    sceneId: anId('scene'),
    placeId: 'col-de-rakelstake',
    placeName: 'Le col de Rakelstake',
    timeOfDay: 'fin de journée',
    present: [aScenePresence()],
    absent: [],
    updatedSeq: 1,
  };
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    present: [...merged.present].sort((a, b) => a.ref.id.localeCompare(b.ref.id)),
    absent: [...merged.absent].sort((a, b) => a.ref.id.localeCompare(b.ref.id)),
  };
}

// ------------------------------------------------------------------- root

/**
 * What `aTableState` accepts. The four collections are ARRAYS here and records
 * in `CampaignState`; everything else is the state's own field.
 */
export interface TableStateOverrides {
  readonly campaignId?: CampaignId;
  /** Last applied event. `0` on an initial state. */
  readonly seq?: number;
  readonly reducerVersion?: number;
  readonly contentPackHash?: string;
  readonly status?: CampaignStatus;
  readonly settings?: CampaignSettings;
  readonly truths?: readonly CampaignTruth[];
  readonly characters?: readonly CharacterState[];
  readonly tracks?: readonly TrackState[];
  readonly clocks?: readonly ClockState[];
  readonly entities?: readonly EntityState[];
  readonly championLocks?: readonly ChampionLock[];
  /** `null` when no scene is open. */
  readonly scene?: SceneState | null;
  readonly party?: PartyState;
  readonly rng?: RngState;
}

/**
 * @param overrides the parts this test actually cares about.
 *
 * The default table has ONE character, owned by ONE player who is also the
 * party owner, no track, no clock, no entity and no open scene. Every
 * collection is empty rather than plausibly populated: a fixture that came
 * with three clocks would make every count assertion in the repository read
 * `- 3`.
 */
export function aTableState(overrides: TableStateOverrides = {}): CampaignState {
  const characters = overrides.characters ?? [aCharacter()];
  const owner: PlayerId = characters[0]?.playerId ?? anId('player');

  return {
    campaignId: overrides.campaignId ?? anId('campaign'),
    seq: overrides.seq ?? 0,
    reducerVersion: overrides.reducerVersion ?? 1,
    contentPackHash: overrides.contentPackHash ?? 'sha256:fixture',
    status: overrides.status ?? 'active',
    settings: overrides.settings ?? aCampaignSettings(),
    truths: overrides.truths ?? [],
    characters: keyById(characters),
    tracks: keyById(overrides.tracks ?? []),
    clocks: keyById(overrides.clocks ?? []),
    entities: keyById(overrides.entities ?? []),
    championLocks: Object.fromEntries(
      (overrides.championLocks ?? []).map((lock) => [lock.championId, lock]),
    ),
    scene: overrides.scene ?? null,
    party: overrides.party ?? {
      memberPlayerIds: [...new Set(characters.map((character) => character.playerId))],
      ownerPlayerId: owner,
    },
    rng: overrides.rng ?? { seed: SEEDS.campaign, draws: {} },
  };
}
