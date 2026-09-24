/**
 * Zone A — identity and web sessions (03-donnees.md section 1.1).
 *
 * `players` is the Discord identity, `auth_sessions` the cookie session (the
 * row id IS the sha256 of the cookie secret, so a database leak hands out no
 * session), and `oauth_states` the short-lived anti-CSRF row of the OAuth
 * flow. ADR 0010 decision 6 places `oauth_states` in zone A: it is not
 * rebuildable from the journal, it is simply disposable.
 */

import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const players = sqliteTable(
  'players',
  {
    /** ULID. */
    id: text('id').primaryKey(),
    /** Discord snowflake, immutable. */
    discordUserId: text('discord_user_id').notNull(),
    discordUsername: text('discord_username').notNull(),
    discordGlobalName: text('discord_global_name'),
    discordAvatarHash: text('discord_avatar_hash'),
    /** Scope `email`; null when the player did not grant it. */
    discordEmail: text('discord_email'),
    locale: text('locale').notNull().default('fr'),
    isAdmin: integer('is_admin').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastSeenAt: integer('last_seen_at'),
    /** GDPR anonymisation. Never a real DELETE. */
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('players_discord_user_id_uq').on(t.discordUserId),
    index('players_last_seen_idx').on(sql`${t.lastSeenAt} DESC`),
    check('players_is_admin_bool', sql`${t.isAdmin} IN (0,1)`),
  ],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    /** sha256(secret) in hex. The secret itself never reaches the database. */
    id: text('id').primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    userAgent: text('user_agent'),
    /** sha256(ip + pepper), diagnostics only. */
    ipHash: text('ip_hash'),
  },
  (t) => [
    index('auth_sessions_player_idx').on(t.playerId, sql`${t.expiresAt} DESC`),
    index('auth_sessions_expiry_idx').on(t.expiresAt),
  ],
);

export const oauthStates = sqliteTable(
  'oauth_states',
  {
    /** 32 random bytes, base64url. */
    state: text('state').primaryKey(),
    /** PKCE. */
    codeVerifier: text('code_verifier').notNull(),
    /** Internal path, validated server side. */
    redirectTo: text('redirect_to'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('oauth_states_expiry_idx').on(t.expiresAt)],
);
