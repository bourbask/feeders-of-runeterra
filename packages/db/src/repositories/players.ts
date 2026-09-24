/**
 * Zone A — the Discord identity (03-donnees.md section 1.1).
 *
 * A player is never deleted, only anonymised (`deleted_at`), so there is no
 * delete here and there is not meant to be one.
 */

import type { SqliteConnection } from '../client.js';

export interface PlayerInsert {
  readonly id: string;
  readonly discordUserId: string;
  readonly discordUsername: string;
  readonly createdAt: number;
  readonly discordGlobalName?: string | null;
  readonly locale?: string;
}

export interface PlayerRow {
  readonly id: string;
  readonly discord_user_id: string;
  readonly discord_username: string;
  readonly discord_global_name: string | null;
  readonly locale: string;
  readonly is_admin: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly last_seen_at: number | null;
  readonly deleted_at: number | null;
}

/**
 * Creates the player, or refreshes the Discord fields of the one already
 * bound to that snowflake. The conflict target is `discord_user_id`, not
 * `id`: the same human coming back through OAuth must not become a second
 * player.
 */
export function upsertPlayer(connection: SqliteConnection, row: PlayerInsert): void {
  connection
    .prepare(
      `INSERT INTO players
         (id, discord_user_id, discord_username, discord_global_name, locale,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(discord_user_id) DO UPDATE SET
         discord_username = excluded.discord_username,
         discord_global_name = excluded.discord_global_name,
         updated_at = excluded.updated_at`,
    )
    .run(
      row.id,
      row.discordUserId,
      row.discordUsername,
      row.discordGlobalName ?? null,
      row.locale ?? 'fr',
      row.createdAt,
      row.createdAt,
    );
}

export function getPlayer(connection: SqliteConnection, playerId: string): PlayerRow | undefined {
  return connection.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId) as
    PlayerRow | undefined;
}

export function getPlayerByDiscordUserId(
  connection: SqliteConnection,
  discordUserId: string,
): PlayerRow | undefined {
  return connection
    .prepare(`SELECT * FROM players WHERE discord_user_id = ?`)
    .get(discordUserId) as PlayerRow | undefined;
}

export function touchLastSeen(connection: SqliteConnection, playerId: string, at: number): void {
  connection.prepare(`UPDATE players SET last_seen_at = ? WHERE id = ?`).run(at, playerId);
}
