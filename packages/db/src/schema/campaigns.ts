/**
 * Zone A — campaigns, membership and play sessions (03-donnees.md section 1.2).
 *
 * `campaigns.seq` is the ONLY zone A column mutated on the hot path: it is the
 * journal's sequence allocator (section 3.2). Deriving it from
 * `MAX(events.seq)` would cost a scan and a race; an `UPDATE … RETURNING`
 * serialises writers for free.
 *
 * `campaign_members.character_id` deliberately carries NO SQL foreign key:
 * `characters` is a zone C cache that `db:rebuild` truncates, and a hard key
 * would make the rebuild impossible. `pnpm db:check` (M0-17) verifies it.
 */

import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import type { CampaignSettingsDto, CampaignStateDto } from '@for/contracts';

import { players } from './players.js';

/**
 * `@for/contracts` exports `zCampaignTruth` but no `CampaignTruthDto` alias, so
 * the element type is read off the state DTO rather than hand-written here. A
 * second hand-written shape would be a second place to forget.
 */
type CampaignTruthDto = CampaignStateDto['truths'][number];

export const campaigns = sqliteTable(
  'campaigns',
  {
    id: text('id').primaryKey(),
    /** URL segment: /c/le-pacte-de-la-griffe */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    pitch: text('pitch').notNull().default(''),
    ownerPlayerId: text('owner_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('draft'),

    // Reproducibility: a campaign is pinned to one content and one rules version.
    contentPackVersion: text('content_pack_version').notNull(),
    contentPackHash: text('content_pack_hash').notNull(),
    rulesVersion: integer('rules_version').notNull(),
    reducerVersion: integer('reducer_version').notNull(),

    /** Master seed, 32 bytes hex. Every draw derives from (seed, seq, stream). */
    rngSeed: text('rng_seed').notNull(),

    /** The journal's sequence counter. Allocated by `UPDATE … RETURNING`. */
    seq: integer('seq').notNull().default(0),

    settingsJson: text('settings_json', { mode: 'json' })
      .$type<CampaignSettingsDto>()
      .notNull()
      .default(sql`'{}'`),
    truthsJson: text('truths_json', { mode: 'json' })
      .$type<CampaignTruthDto[]>()
      .notNull()
      .default(sql`'[]'`),

    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    archivedAt: integer('archived_at'),
  },
  (t) => [
    uniqueIndex('campaigns_slug_uq').on(t.slug),
    index('campaigns_owner_idx').on(t.ownerPlayerId),
    index('campaigns_status_idx').on(t.status, sql`${t.updatedAt} DESC`),
    check('campaigns_status_enum', sql`${t.status} IN ('draft','active','paused','archived')`),
    check('campaigns_settings_json_valid', sql`json_valid(${t.settingsJson})`),
    check('campaigns_truths_json_valid', sql`json_valid(${t.truthsJson})`),
  ],
);

export const campaignMembers = sqliteTable(
  'campaign_members',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    role: text('role').notNull().default('player'),
    /** Logical reference to `characters`, a rebuildable cache. No SQL key. */
    characterId: text('character_id'),
    invitedBy: text('invited_by').references(() => players.id, { onDelete: 'set null' }),
    joinedAt: integer('joined_at').notNull(),
    leftAt: integer('left_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('campaign_members_uq').on(t.campaignId, t.playerId),
    index('campaign_members_player_idx').on(t.playerId, t.leftAt),
    index('campaign_members_campaign_idx').on(t.campaignId, t.leftAt),
    check('campaign_members_role_enum', sql`${t.role} IN ('owner','player','spectator')`),
  ],
);

export const playSessions = sqliteTable(
  'play_sessions',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    /** 1, 2, 3… readable by a human. */
    ordinal: integer('ordinal').notNull(),
    title: text('title'),
    status: text('status').notNull().default('scheduled'),
    /** Voice stays on Discord. */
    discordChannelId: text('discord_channel_id'),
    scheduledFor: integer('scheduled_for'),
    startedAt: integer('started_at'),
    endedAt: integer('ended_at'),
    firstEventSeq: integer('first_event_seq'),
    lastEventSeq: integer('last_event_seq'),
    /** Logical reference to `chronicles`. */
    recapChronicleId: text('recap_chronicle_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('play_sessions_ordinal_uq').on(t.campaignId, t.ordinal),
    index('play_sessions_campaign_idx').on(t.campaignId, sql`${t.startedAt} DESC`),
    index('play_sessions_live_idx')
      .on(t.status)
      .where(sql`${t.status} = 'live'`),
    check('play_sessions_status_enum', sql`${t.status} IN ('scheduled','live','ended')`),
  ],
);
