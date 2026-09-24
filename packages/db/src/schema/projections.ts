/**
 * Zone C — snapshots and projections (03-donnees.md section 1.4).
 *
 * Every table here is a CACHE of `events`. `pnpm db:rebuild` truncates the lot
 * and replays the journal; that is the strongest test of invariant 4, which is
 * why they all cascade from `campaigns` instead of restricting it.
 *
 * The bounds written as CHECK constraints (gauges 0-5, momentum -6..+10, at
 * most eight present and eight absent in a scene) are a SECOND line of
 * defence, not the first. A reducer bug that pushes a gauge out of range makes
 * the transaction fail instead of writing the bug down.
 *
 * `WITHOUT ROWID` on `scene_state` and `campaign_champion_locks` is hand-added
 * in the migration: drizzle-kit has no way to express it, and its snapshot
 * does not record it either, so the hand edit creates no drift.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import type {
  CampaignStateDto,
  CharacterStateDto,
  EntityStateDto,
  SceneStateDto,
} from '@for/contracts';

import { campaigns } from './campaigns.js';

/** The frozen champion sheet. `Champion` itself is content (M0-09). */
type FrozenSheet = unknown;

export const snapshots = sqliteTable(
  'snapshots',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** State AFTER applying this seq. */
    seq: integer('seq').notNull(),
    reducerVersion: integer('reducer_version').notNull(),
    stateJson: text('state_json', { mode: 'json' }).$type<CampaignStateDto>().notNull(),
    /** sha256 of the canonical JSON. */
    stateHash: text('state_hash').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    kind: text('kind').notNull().default('rolling'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('snapshots_uq').on(t.campaignId, t.reducerVersion, t.seq),
    index('snapshots_lookup_idx').on(t.campaignId, t.reducerVersion, sql`${t.seq} DESC`),
    check('snapshots_kind_enum', sql`${t.kind} IN ('rolling','milestone','session_end')`),
    check('snapshots_state_json_valid', sql`json_valid(${t.stateJson})`),
  ],
);

export const characters = sqliteTable(
  'characters',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** Logical reference (cache). */
    playerId: text('player_id').notNull(),
    /** Content id, e.g. `braum`. */
    championId: text('champion_id').notNull(),
    displayName: text('display_name').notNull(),

    sheetSource: text('sheet_source').notNull(),
    /** `content:champions/braum@1.4.0`, or `forged:<champion_sheets.id>`. */
    sheetRef: text('sheet_ref').notNull(),
    /** FROZEN at creation: a content update never rewrites a live character. */
    sheetSnapshotJson: text('sheet_snapshot_json', { mode: 'json' }).$type<FrozenSheet>().notNull(),

    // Attributes as columns, not a blob: five bounded values, read on every roll.
    attrVif: integer('attr_vif').notNull(),
    attrCoeur: integer('attr_coeur').notNull(),
    attrFer: integer('attr_fer').notNull(),
    attrOmbre: integer('attr_ombre').notNull(),
    attrEsprit: integer('attr_esprit').notNull(),

    // Gauges 0-5.
    vigueur: integer('vigueur').notNull().default(5),
    ame: integer('ame').notNull().default(5),
    vivres: integer('vivres').notNull().default(5),

    // Momentum -6..+10, starts at +2.
    momentum: integer('momentum').notNull().default(2),
    momentumMax: integer('momentum_max').notNull().default(10),
    momentumReset: integer('momentum_reset').notNull().default(2),

    xpEarned: integer('xp_earned').notNull().default(0),
    xpSpent: integer('xp_spent').notNull().default(0),

    conditionsJson: text('conditions_json', { mode: 'json' })
      .$type<CharacterStateDto['conditions']>()
      .notNull()
      .default(sql`'[]'`),
    assetsJson: text('assets_json', { mode: 'json' })
      .$type<CharacterStateDto['assets']>()
      .notNull()
      .default(sql`'[]'`),
    bondsJson: text('bonds_json', { mode: 'json' })
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'`),
    notesJson: text('notes_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),

    status: text('status').notNull().default('active'),
    portraitUrl: text('portrait_url'),

    createdSeq: integer('created_seq').notNull(),
    updatedSeq: integer('updated_seq').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    // Casting lock: one champion is played by at most one living PC per campaign.
    uniqueIndex('characters_champion_uq')
      .on(t.campaignId, t.championId)
      .where(sql`${t.status} IN ('draft','active')`),
    // One active character per player per campaign.
    uniqueIndex('characters_active_player_uq')
      .on(t.campaignId, t.playerId)
      .where(sql`${t.status} IN ('draft','active')`),
    index('characters_campaign_idx').on(t.campaignId, t.status),
    check('characters_sheet_source_enum', sql`${t.sheetSource} IN ('handwritten','forged')`),
    check('characters_sheet_snapshot_json_valid', sql`json_valid(${t.sheetSnapshotJson})`),
    check('characters_attr_vif_range', sql`${t.attrVif} BETWEEN 1 AND 3`),
    check('characters_attr_coeur_range', sql`${t.attrCoeur} BETWEEN 1 AND 3`),
    check('characters_attr_fer_range', sql`${t.attrFer} BETWEEN 1 AND 3`),
    check('characters_attr_ombre_range', sql`${t.attrOmbre} BETWEEN 1 AND 3`),
    check('characters_attr_esprit_range', sql`${t.attrEsprit} BETWEEN 1 AND 3`),
    check('characters_vigueur_range', sql`${t.vigueur} BETWEEN 0 AND 5`),
    check('characters_ame_range', sql`${t.ame} BETWEEN 0 AND 5`),
    check('characters_vivres_range', sql`${t.vivres} BETWEEN 0 AND 5`),
    check('characters_momentum_range', sql`${t.momentum} BETWEEN -6 AND 10`),
    check('characters_momentum_max_range', sql`${t.momentumMax} BETWEEN 0 AND 10`),
    check('characters_momentum_reset_range', sql`${t.momentumReset} BETWEEN 0 AND 2`),
    check('characters_xp_earned_positive', sql`${t.xpEarned} >= 0`),
    check('characters_xp_spent_positive', sql`${t.xpSpent} >= 0`),
    check('characters_conditions_json_valid', sql`json_valid(${t.conditionsJson})`),
    check('characters_assets_json_valid', sql`json_valid(${t.assetsJson})`),
    check('characters_bonds_json_valid', sql`json_valid(${t.bondsJson})`),
    check('characters_notes_json_valid', sql`json_valid(${t.notesJson})`),
    check('characters_status_enum', sql`${t.status} IN ('draft','active','retired','dead')`),
    check('characters_xp_coherent', sql`${t.xpSpent} <= ${t.xpEarned}`),
    check('characters_momentum_reset_le_max', sql`${t.momentumReset} <= ${t.momentumMax}`),
  ],
);

export const progressTracks = sqliteTable(
  'progress_tracks',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    rank: text('rank').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Null means a party-wide track, not an absent one. */
    ownerCharacterId: text('owner_character_id'),
    ticks: integer('ticks').notNull().default(0),
    status: text('status').notNull().default('open'),
    visibility: text('visibility').notNull().default('public'),
    tagsJson: text('tags_json', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdSeq: integer('created_seq').notNull(),
    updatedSeq: integer('updated_seq').notNull(),
    resolvedSeq: integer('resolved_seq'),
  },
  (t) => [
    index('progress_tracks_campaign_idx').on(t.campaignId, t.status, t.kind),
    index('progress_tracks_owner_idx').on(t.ownerCharacterId, t.status),
    check(
      'progress_tracks_kind_enum',
      sql`${t.kind} IN ('vow','combat','journey','scene_challenge','bond')`,
    ),
    check(
      'progress_tracks_rank_enum',
      sql`${t.rank} IN ('genant','dangereux','redoutable','extreme','epique')`,
    ),
    check('progress_tracks_ticks_range', sql`${t.ticks} BETWEEN 0 AND 40`),
    check(
      'progress_tracks_status_enum',
      sql`${t.status} IN ('open','fulfilled','forsaken','failed','abandoned')`,
    ),
    check('progress_tracks_visibility_enum', sql`${t.visibility} IN ('public','gm')`),
    check('progress_tracks_tags_json_valid', sql`json_valid(${t.tagsJson})`),
  ],
);

export const clocks = sqliteTable(
  'clocks',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    segments: integer('segments').notNull(),
    filled: integer('filled').notNull().default(0),
    status: text('status').notNull().default('ticking'),
    visibility: text('visibility').notNull().default('public'),
    /** What happens when it saturates. */
    consequence: text('consequence').notNull().default(''),
    createdSeq: integer('created_seq').notNull(),
    updatedSeq: integer('updated_seq').notNull(),
  },
  (t) => [
    index('clocks_campaign_idx').on(t.campaignId, t.status),
    check('clocks_segments_enum', sql`${t.segments} IN (4,6,8,10)`),
    check('clocks_filled_positive', sql`${t.filled} >= 0`),
    check('clocks_status_enum', sql`${t.status} IN ('ticking','filled','resolved','cancelled')`),
    check('clocks_visibility_enum', sql`${t.visibility} IN ('public','gm')`),
    check('clocks_filled_le_segments', sql`${t.filled} <= ${t.segments}`),
  ],
);

export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** `olaf-le-borgne` */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** One or two sentences, injected into the prompt. */
    summary: text('summary').notNull().default(''),
    detailsJson: text('details_json', { mode: 'json' })
      .$type<EntityStateDto['details']>()
      .notNull()
      .default(sql`'{}'`),
    /** Set when this NPC is a champion. */
    championId: text('champion_id'),
    regionId: text('region_id'),
    status: text('status').notNull().default('active'),
    disposition: text('disposition'),
    firstSeenSeq: integer('first_seen_seq').notNull(),
    lastSeenSeq: integer('last_seen_seq').notNull(),
  },
  (t) => [
    uniqueIndex('entities_slug_uq').on(t.campaignId, t.slug),
    index('entities_kind_idx').on(t.campaignId, t.kind, t.status),
    index('entities_recent_idx').on(t.campaignId, sql`${t.lastSeenSeq} DESC`),
    check(
      'entities_kind_enum',
      sql`${t.kind} IN ('npc','place','faction','item','beast','thread','presage')`,
    ),
    check('entities_details_json_valid', sql`json_valid(${t.detailsJson})`),
    check(
      'entities_status_enum',
      sql`${t.status} IN ('active','dormant','dead','destroyed','resolved')`,
    ),
    check(
      'entities_disposition_enum',
      sql`${t.disposition} IS NULL OR ${t.disposition} IN ('allie','neutre','hostile','inconnu')`,
    ),
  ],
);

/**
 * The scene state: where we are, who is here, and who is no longer.
 *
 * One row per campaign — a campaign has at most one open scene. No row means
 * no scene (`CampaignState.scene` is null). The two cardinality CHECKs are
 * what stop a merge bug from writing a ninth entry that would blow the prompt
 * budget on every turn afterwards.
 */
export const sceneState = sqliteTable(
  'scene_state',
  {
    campaignId: text('campaign_id')
      .primaryKey()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    sceneId: text('scene_id').notNull(),
    placeId: text('place_id').notNull().default(''),
    placeName: text('place_name').notNull().default(''),
    timeOfDay: text('time_of_day').notNull().default(''),
    /** `ScenePresence[]`, at most 8, sorted by `ref.id`. */
    presentJson: text('present_json', { mode: 'json' })
      .$type<SceneStateDto['present']>()
      .notNull()
      .default(sql`'[]'`),
    /** `SceneAbsence[]`, at most 8. Monotone within a scene. */
    absentJson: text('absent_json', { mode: 'json' })
      .$type<SceneStateDto['absent']>()
      .notNull()
      .default(sql`'[]'`),
    updatedSeq: integer('updated_seq').notNull(),
  },
  (t) => [
    check('scene_state_present_json_valid', sql`json_valid(${t.presentJson})`),
    check('scene_state_absent_json_valid', sql`json_valid(${t.absentJson})`),
    check('scene_state_present_bounded', sql`json_array_length(${t.presentJson}) <= 8`),
    check('scene_state_absent_bounded', sql`json_array_length(${t.absentJson}) <= 8`),
  ],
);

/**
 * Casting lock: the AI GM must NEVER bring on a reserved champion — it is
 * another player's character. Feeds the system prompt, the proposal validator
 * and the character picker.
 */
export const campaignChampionLocks = sqliteTable(
  'campaign_champion_locks',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    championId: text('champion_id').notNull(),
    lockKind: text('lock_kind').notNull(),
    reason: text('reason').notNull().default(''),
    setSeq: integer('set_seq').notNull(),
  },
  (t) => [
    primaryKey({ name: 'campaign_champion_locks_pk', columns: [t.campaignId, t.championId] }),
    index('champion_locks_kind_idx').on(t.campaignId, t.lockKind),
    check(
      'campaign_champion_locks_kind_enum',
      sql`${t.lockKind} IN ('reserved_pc','allowed_npc','banned')`,
    ),
  ],
);
