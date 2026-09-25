/**
 * The journal both suites replay, and the base they replay it into.
 *
 * A THIRD TEST FILE BEYOND THE TWO THE SHEET NAMES, and it is a `.test.ts` on
 * purpose. `src/testing.ts` explains the constraint: the flat ESLint config
 * maps `**\/*.test.ts` to `tsconfig.test.json` and everything else to the
 * project service, which only sees `src/**`, so a plain support file under
 * `tests/` belongs to no TypeScript program and `pnpm lint` stops on it. The
 * engine solved it the same way in `tests/support/every-event.test.ts`, which
 * is the precedent followed here. It carries its own test, at the foot: the
 * fixture must touch all six projection tables, or the suites that use it
 * would be proving the rebuild of an empty base.
 *
 * THE JOURNAL IS BUILT THROUGH THE ONLY WRITE PATH — `appendEvents` — so `seq`
 * is allocated by the allocator and the three triggers see every row. A
 * fixture that inserted straight into `events` would be testing a journal
 * production never produces.
 *
 * EVERY IDENTIFIER IS ULID-SHAPED, through `anId`. Not cosmetic: `zGameEvent`
 * refuses `c1` on the envelope, so control 10 would go red on the fixture
 * itself and the suite would be measuring its own identifiers.
 */

import { describe, expect, it } from 'vitest';

import type { SqliteConnection } from '../../src/client.js';
import { PROJECTION_TABLES, rebuildCampaign } from '../../src/rebuild.js';
import type { AppendableEvent } from '../../src/repositories/events.js';
import { appendEvents } from '../../src/repositories/events.js';
import type { TempDb } from '../../src/testing.js';
import { migratedTempDb, seedCampaign } from '../../src/testing.js';

import type { CampaignId, GameEvent } from '@for/engine';
import { anEvent, anId } from '@for/testkit';

export const CAMPAIGN: CampaignId = anId('campaign', 1);
export const OTHER_CAMPAIGN: CampaignId = anId('campaign', 2);
export const PLAYER = anId('player', 1);

/**
 * The identifiers ONE campaign's journal mints.
 *
 * Indexed by campaign, because `characters.id`, `entities.id` and the rest are
 * primary keys over the WHOLE table: two campaigns replaying the same fixture
 * with the same character would collide on the insert instead of proving
 * anything about the rebuild.
 */
export function journalIds(campaignIndex: number): {
  readonly hero: ReturnType<typeof anId<'character'>>;
  readonly olaf: ReturnType<typeof anId<'entity'>>;
  readonly vow: ReturnType<typeof anId<'track'>>;
  readonly storm: ReturnType<typeof anId<'clock'>>;
  readonly scene: ReturnType<typeof anId<'scene'>>;
} {
  const n = campaignIndex + 1;
  return {
    hero: anId('character', n),
    olaf: anId('entity', n),
    vow: anId('track', n),
    storm: anId('clock', n),
    scene: anId('scene', n),
  };
}

export const HERO = journalIds(0).hero;
export const OLAF = journalIds(0).olaf;
export const VOW = journalIds(0).vow;
export const STORM = journalIds(0).storm;
export const SCENE = journalIds(0).scene;
/** The hash `seedCampaign` writes on the campaign. Control 12 wants it known. */
export const CONTENT_HASH = 'sha256-x';
export const NOW = 1_700_000_000_000;
/** Entries in `demoJournal`. Written out, not derived from the array. */
export const JOURNAL_LENGTH = 12;

/**
 * `GameEvent` -> the row the journal accepts.
 *
 * `seq` is dropped: the allocator decides it. `id` is re-minted per campaign,
 * because `events.id` is a primary key over the WHOLE table and two campaigns
 * replaying the same fixture would collide on it.
 */
function toAppendable(event: GameEvent, campaignIndex: number): AppendableEvent {
  return {
    id: anId('event', campaignIndex * 100 + event.seq),
    type: event.type,
    payload: event.payload,
    actorKind: event.actorKind,
    scope: event.scope,
    recipients: event.recipients,
    createdAt: event.createdAt,
    playSessionId: event.playSessionId,
    payloadVersion: event.payloadVersion,
    actorPlayerId: event.actorPlayerId,
    subjectCharacterId: event.subjectCharacterId,
    correlationId: event.correlationId,
    causationId: event.causationId,
    rngStream: event.rngStream,
    rngDrawIndex: event.rngDrawIndex,
  };
}

/**
 * Twelve entries that land in all six projection tables, plus the two shapes
 * that make a replay worth doing: one `private` entry (ADR 0008) and one
 * cancelled entry.
 */
export function demoJournal(campaignId: CampaignId, campaignIndex = 0): readonly GameEvent[] {
  const { hero, olaf, vow, storm, scene } = journalIds(campaignIndex);

  return [
    anEvent({
      campaignId,
      seq: 1,
      type: 'campaign.created',
      payload: {
        name: 'Le Pacte de la Griffe-de-Givre',
        // kebab-case ASCII: `zSlug` refuses a ULID here.
        slug: 'pacte-griffe-de-givre',
        pitch: 'Le froid monte.',
        ownerPlayerId: PLAYER,
        contentPackVersion: '1.0.0',
        contentPackHash: CONTENT_HASH,
        rulesVersion: 1,
        rngSeed: 'deadbeef',
      },
    }),
    anEvent({
      campaignId,
      seq: 2,
      type: 'party.member_joined',
      payload: { playerId: PLAYER, role: 'owner', displayName: 'Kevin' },
    }),
    anEvent({
      campaignId,
      seq: 3,
      type: 'character.created',
      payload: {
        characterId: hero,
        playerId: PLAYER,
        championId: 'braum',
        displayName: 'Braum',
        sheetSource: 'handwritten',
        sheetRef: 'content:champions/braum@1.0.0',
        sheetSnapshot: { championId: 'braum', version: '1.0.0' },
        attributes: { vif: 1, coeur: 2, fer: 3, ombre: 1, esprit: 2 },
        gauges: { vigueur: 5, ame: 5, vivres: 5 },
        momentum: 2,
      },
    }),
    anEvent({
      campaignId,
      seq: 4,
      type: 'party.champion_locked',
      payload: { championId: 'braum', lockKind: 'reserved_pc', reason: 'PJ de Kevin' },
    }),
    anEvent({
      campaignId,
      seq: 5,
      type: 'entity.introduced',
      payload: {
        entityId: olaf,
        kind: 'npc',
        slug: 'olaf-le-borgne',
        name: 'Olaf',
        summary: 'Un berserker qui cherche sa fin.',
        disposition: 'neutre',
        details: { arme: 'hache' },
      },
    }),
    anEvent({
      campaignId,
      seq: 6,
      type: 'track.created',
      payload: {
        trackId: vow,
        kind: 'vow',
        rank: 'dangereux',
        title: 'Ramener la broche',
        description: '',
        ownerCharacterId: hero,
        visibility: 'public',
        initialTicks: 0,
      },
    }),
    anEvent({
      campaignId,
      seq: 7,
      type: 'clock.created',
      payload: {
        clockId: storm,
        title: 'La tempête arrive',
        description: '',
        segments: 6,
        visibility: 'public',
        consequence: 'Le col se ferme.',
      },
    }),
    anEvent({
      campaignId,
      seq: 8,
      type: 'scene.started',
      payload: {
        sceneId: scene,
        title: 'Le col battu par la tempête',
        entityIds: [olaf],
        presentCharacterIds: [hero],
      },
    }),
    anEvent({
      campaignId,
      seq: 9,
      type: 'scene.facts_updated',
      payload: {
        sceneId: scene,
        placeId: 'col-de-la-griffe',
        placeName: 'Le col de la Griffe',
        timeOfDay: 'crépuscule',
        present: [
          {
            ref: { kind: 'character', id: hero },
            name: 'Braum',
            state: 'accroché à la corde',
            sinceSeq: 8,
          },
        ],
        absent: [],
        source: 'engine',
      },
    }),
    // ADR 0008: one entry addressed to one player. The projections are rebuilt
    // from it all the same — they are the SERVER's state, not a view.
    anEvent({
      campaignId,
      seq: 10,
      type: 'character.gauge_changed',
      scope: 'private',
      recipients: [PLAYER],
      payload: {
        characterId: hero,
        gauge: 'vigueur',
        delta: -2,
        from: 5,
        to: 3,
        clamped: false,
        cause: 'move:face-danger/weak',
      },
    }),
    anEvent({
      campaignId,
      seq: 11,
      type: 'character.gauge_changed',
      payload: {
        characterId: hero,
        gauge: 'ame',
        delta: -1,
        from: 5,
        to: 4,
        clamped: false,
        cause: 'gm:proposal',
      },
    }),
    // Cancels entry 11: `ame` must come back to 5 in the rebuilt projection.
    anEvent({
      campaignId,
      seq: 12,
      type: 'system.reverted',
      payload: { targetSeqs: [11], reason: 'gm_refusal:cible_absente', byPlayerId: null },
    }),
  ];
}

export interface Fixture {
  readonly db: TempDb;
  readonly connection: SqliteConnection;
}

/**
 * A migrated file holding one player, the content pack the campaigns name, and
 * one campaign per identifier given — each with the same journal.
 *
 * The content pack row is not decoration: without it control 12 is red on
 * every base, which is itself a measure that control 12 bites.
 */
export function aSeededBase(campaignIds: readonly CampaignId[] = [CAMPAIGN]): Fixture {
  const db = migratedTempDb();
  const { connection } = db;

  connection
    .prepare(
      `INSERT INTO content_packs
         (hash, version, file_count, manifest_json, first_seen_at, last_seen_at)
       VALUES (?, '1.0.0', 1, '{}', ?, ?)`,
    )
    .run(CONTENT_HASH, NOW, NOW);

  for (const [index, campaignId] of campaignIds.entries()) {
    if (index === 0) {
      seedCampaign(connection, { playerId: PLAYER, campaignId });
    } else {
      connection
        .prepare(
          `INSERT INTO campaigns
             (id, slug, name, owner_player_id, content_pack_version, content_pack_hash,
              rules_version, reducer_version, rng_seed, seq, created_at, updated_at)
           VALUES (?, ?, ?, ?, '1.0.0', ?, 1, 1, 'deadbeef', 0, ?, ?)`,
        )
        .run(campaignId, `slug-${campaignId}`, campaignId, PLAYER, CONTENT_HASH, NOW, NOW);
    }
    appendEvents(connection, {
      campaignId,
      events: demoJournal(campaignId, index).map((event) => toAppendable(event, index)),
      now: NOW,
    });
  }

  return { db, connection };
}

/** The same base, with zone C already built. What `db:check` expects to find. */
export function aBuiltBase(campaignIds: readonly CampaignId[] = [CAMPAIGN]): Fixture {
  const fixture = aSeededBase(campaignIds);
  for (const campaignId of campaignIds) {
    rebuildCampaign(fixture.connection, campaignId);
  }
  return fixture;
}

function rowCount(connection: SqliteConnection, table: string, campaignId: string): number {
  return (
    connection
      .prepare(`SELECT count(*) AS n FROM ${table} WHERE campaign_id = ?`)
      .get(campaignId) as { n: number }
  ).n;
}

describe('the fixture journal', () => {
  it('feeds every projection table, so the suites are not rebuilding nothing', () => {
    const fixture = aBuiltBase();
    try {
      const empty = PROJECTION_TABLES.filter(
        (table) => rowCount(fixture.connection, table, CAMPAIGN) === 0,
      );
      expect(empty).toEqual([]);
      expect(demoJournal(CAMPAIGN)).toHaveLength(JOURNAL_LENGTH);
    } finally {
      fixture.db.close();
    }
  });
});
