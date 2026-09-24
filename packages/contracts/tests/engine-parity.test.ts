/**
 * THE MIRROR INVARIANT, measured at runtime.
 *
 * `satisfies z.ZodType<CampaignState>` in `src/core/campaign-state.ts` breaks
 * the BUILD when the engine grows a field the schema does not have. That is
 * the first net, and it is the one the acceptance criterion exercises.
 *
 * This file is the second net, and it catches what the first cannot express:
 * a schema field that exists but is WIDER than the engine's, and a schema
 * field that silently drops data. The method is blunt on purpose — build a
 * value typed by the ENGINE, parse it, and compare the keys that came back.
 * A key the schema does not declare is stripped by `parse`, so it disappears
 * from the result and the comparison fails. No cleverness, no mocks.
 *
 * The values themselves are literal here rather than built by `@for/testkit`:
 * the fixtures arrive with M0-10, and this test must not wait for them.
 *
 * KNOW THE SCOPE BEFORE YOU RELY ON IT. The key comparison runs on FOUR shapes
 * — `CampaignState`, `CharacterState`, `SceneState`, and ONE event payload out
 * of 71 (`character.gauge_changed`). The MISSING-field direction is covered
 * everywhere by the `satisfies` clauses; the too-wide and silently-dropped
 * directions are covered only on those four.
 *
 * FOR M0-10: once `@for/testkit` ships one exemplar per payload, widen this
 * loop to all 71 instead of the single one below. The comparison itself needs
 * no change — only the corpus it runs on.
 */
import type {
  CampaignId,
  CampaignState,
  CharacterId,
  ClockId,
  EntityId,
  EventId,
  GameEvent,
  PlayerId,
  SceneId,
  TrackId,
} from '@for/engine';
import { describe, expect, it } from 'vitest';

import { zCampaignState } from '../src/core/campaign-state.js';
import { zGameEvent } from '../src/events/index.js';

/** A syntactically valid ULID: `0` then 25 digits. */
function ulid(n: number): string {
  return `0${String(n).padStart(25, '0')}`;
}

const CHARACTER_ID = ulid(1) as CharacterId;
const PLAYER_ID = ulid(2) as PlayerId;
const TRACK_ID = ulid(3) as TrackId;
const CLOCK_ID = ulid(4) as ClockId;
const ENTITY_ID = ulid(5) as EntityId;
const CORRELATION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

/**
 * Every field of `CampaignState`, populated. Typed as the ENGINE's type, so
 * adding a field to the engine makes this literal fail to compile too — the
 * test cannot drift away from the type it is guarding.
 */
const STATE: CampaignState = {
  campaignId: ulid(6) as CampaignId,
  seq: 12,
  reducerVersion: 1,
  contentPackHash: 'sha256:0000',
  status: 'active',
  settings: {
    schemaVersion: 1,
    models: { narration: null, structured: null },
    gmVerbosity: 'standard',
    oracleBias: 'neutre',
    safety: { lines: ['torture'], veils: ['deuil'] },
    allowForgedChampions: true,
    requireForgeReview: false,
  },
  truths: [{ truthId: 'le-froid', optionId: 'ancien', customText: null }],
  characters: {
    [CHARACTER_ID]: {
      id: CHARACTER_ID,
      playerId: PLAYER_ID,
      championId: 'braum',
      displayName: 'Braum',
      sheet: { championId: 'braum', source: 'handwritten', ref: 'content:champions/braum@1.0.0' },
      attributes: { vif: 2, coeur: 3, fer: 2, ombre: 1, esprit: 1 },
      gauges: { vigueur: 5, ame: 4, vivres: 3 },
      momentum: 2,
      momentumBounds: { min: -6, max: 10, reset: 2 },
      xpEarned: 3,
      xpSpent: 1,
      conditions: [{ conditionId: 'blesse', label: 'Blessé', source: 'move:strike', sinceSeq: 4 }],
      assets: [{ assetId: 'porte-bouclier', unlockedAbilities: [0], options: { nom: 'Poro' } }],
      status: 'active',
      createdSeq: 2,
      updatedSeq: 11,
    },
  },
  tracks: {
    [TRACK_ID]: {
      id: TRACK_ID,
      kind: 'vow',
      rank: 'dangereux',
      title: 'Retrouver la caravane',
      description: 'Jurée au feu.',
      ownerCharacterId: CHARACTER_ID,
      ticks: 8,
      status: 'open',
      visibility: 'public',
      tags: ['freljord'],
      createdSeq: 5,
      updatedSeq: 9,
      resolvedSeq: null,
    },
  },
  clocks: {
    [CLOCK_ID]: {
      id: CLOCK_ID,
      title: 'La tempête monte',
      description: 'Trois jours.',
      segments: 6,
      filled: 2,
      status: 'ticking',
      visibility: 'gm',
      consequence: 'Le col se ferme.',
      createdSeq: 6,
      updatedSeq: 10,
    },
  },
  entities: {
    [ENTITY_ID]: {
      id: ENTITY_ID,
      kind: 'npc',
      slug: 'keld',
      name: 'Keld',
      summary: 'Un guide taciturne.',
      details: { arme: 'hache' },
      championId: null,
      regionId: 'freljord',
      status: 'active',
      disposition: 'neutre',
      firstSeenSeq: 3,
      lastSeenSeq: 11,
    },
  },
  championLocks: {
    braum: { championId: 'braum', lockKind: 'reserved_pc', reason: 'joueur 1', setSeq: 2 },
  },
  scene: {
    sceneId: ulid(7) as SceneId,
    placeId: 'col-de-givre',
    placeName: 'Le col de givre',
    timeOfDay: 'crépuscule',
    present: [
      {
        ref: { kind: 'character', id: CHARACTER_ID },
        name: 'Braum',
        state: 'debout, le bouclier levé',
        sinceSeq: 8,
      },
    ],
    absent: [
      { ref: { kind: 'entity', id: ENTITY_ID }, name: 'Keld', cause: 'parti', sinceSeq: 10 },
    ],
    updatedSeq: 11,
  },
  party: { memberPlayerIds: [PLAYER_ID], ownerPlayerId: PLAYER_ID },
  rng: { seed: 'graine-de-test', draws: { action: 4, price: 1 } },
};

const GAUGE_EVENT: GameEvent = {
  id: ulid(20) as EventId,
  campaignId: ulid(6) as CampaignId,
  seq: 12,
  playSessionId: null,
  payloadVersion: 1,
  scope: 'table',
  recipients: null,
  actorKind: 'engine',
  actorPlayerId: null,
  subjectCharacterId: CHARACTER_ID,
  correlationId: CORRELATION_ID,
  causationId: null,
  rngStream: 'price',
  rngDrawIndex: 0,
  createdAt: 1_758_000_000_000,
  type: 'character.gauge_changed',
  payload: {
    characterId: CHARACTER_ID,
    gauge: 'vivres',
    delta: -1,
    from: 3,
    to: 2,
    clamped: false,
    cause: 'price:d12=7',
  },
};

describe('parité moteur ↔ contrats', () => {
  it('zCampaignState accepte un état moteur complet', () => {
    expect(zCampaignState.safeParse(STATE).success).toBe(true);
  });

  it('zCampaignState ne perd aucune clé de CampaignState', () => {
    const parsed = zCampaignState.parse(STATE);
    expect(Object.keys(parsed).sort()).toStrictEqual(Object.keys(STATE).sort());
  });

  it('zCampaignState ne perd aucune clé de CharacterState', () => {
    const parsed = zCampaignState.parse(STATE);
    const source = STATE.characters[CHARACTER_ID];
    const roundTripped = parsed.characters[CHARACTER_ID];
    expect(source).toBeDefined();
    expect(roundTripped).toBeDefined();
    expect(Object.keys(roundTripped ?? {}).sort()).toStrictEqual(Object.keys(source ?? {}).sort());
  });

  it('zCampaignState ne perd aucune clé de SceneState', () => {
    const parsed = zCampaignState.parse(STATE);
    expect(Object.keys(parsed.scene ?? {}).sort()).toStrictEqual(
      Object.keys(STATE.scene ?? {}).sort(),
    );
  });

  it('zGameEvent accepte un événement moteur complet et n’en perd aucune clé', () => {
    const parsed = zGameEvent.parse(GAUGE_EVENT);
    expect(Object.keys(parsed).sort()).toStrictEqual(Object.keys(GAUGE_EVENT).sort());
    expect(Object.keys(parsed.payload).sort()).toStrictEqual(
      Object.keys(GAUGE_EVENT.payload).sort(),
    );
  });

  it('zGameEvent refuse un rngStream qui n’est pas un flux du moteur', () => {
    const result = zGameEvent.safeParse({ ...GAUGE_EVENT, rngStream: 'prix' });
    expect(result.success).toBe(false);
  });

  it('zGameEvent refuse un identifiant qui n’est pas un ULID', () => {
    expect(zGameEvent.safeParse({ ...GAUGE_EVENT, campaignId: 'pas-un-ulid' }).success).toBe(false);
  });
});
