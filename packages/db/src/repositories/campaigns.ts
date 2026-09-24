/**
 * Zone A — campaigns and membership (03-donnees.md section 1.2).
 *
 * `campaignSeq` reads the ALLOCATOR, not `MAX(events.seq)`. The two are equal
 * on a healthy campaign and that equality is one of the integrity oracles
 * M0-17 will check; reading the allocator is what makes the check meaningful,
 * because a reader that derived the value from the journal could never catch a
 * counter that drifted.
 */

import type { SqliteConnection } from '../client.js';

export interface CampaignInsert {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly ownerPlayerId: string;
  readonly contentPackVersion: string;
  readonly contentPackHash: string;
  readonly rulesVersion: number;
  readonly reducerVersion: number;
  readonly rngSeed: string;
  readonly createdAt: number;
  readonly pitch?: string;
  readonly status?: string;
}

export interface CampaignRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly owner_player_id: string;
  readonly status: string;
  readonly content_pack_version: string;
  readonly content_pack_hash: string;
  readonly rules_version: number;
  readonly reducer_version: number;
  readonly rng_seed: string;
  readonly seq: number;
  readonly created_at: number;
  readonly updated_at: number;
}

/** Creates a campaign with its sequence counter at 0. */
export function insertCampaign(connection: SqliteConnection, row: CampaignInsert): void {
  connection
    .prepare(
      `INSERT INTO campaigns
         (id, slug, name, pitch, owner_player_id, status, content_pack_version,
          content_pack_hash, rules_version, reducer_version, rng_seed, seq,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      row.id,
      row.slug,
      row.name,
      row.pitch ?? '',
      row.ownerPlayerId,
      row.status ?? 'draft',
      row.contentPackVersion,
      row.contentPackHash,
      row.rulesVersion,
      row.reducerVersion,
      row.rngSeed,
      row.createdAt,
      row.createdAt,
    );
}

export function getCampaign(
  connection: SqliteConnection,
  campaignId: string,
): CampaignRow | undefined {
  return connection.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(campaignId) as
    CampaignRow | undefined;
}

/** The allocator's current value, or `undefined` when there is no campaign. */
export function campaignSeq(connection: SqliteConnection, campaignId: string): number | undefined {
  const row = connection.prepare(`SELECT seq FROM campaigns WHERE id = ?`).get(campaignId) as
    { seq: number } | undefined;
  return row?.seq;
}

export interface MemberInsert {
  readonly id: string;
  readonly campaignId: string;
  readonly playerId: string;
  readonly joinedAt: number;
  readonly role?: string;
  readonly characterId?: string | null;
}

export function addMember(connection: SqliteConnection, row: MemberInsert): void {
  connection
    .prepare(
      `INSERT INTO campaign_members
         (id, campaign_id, player_id, role, character_id, joined_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.campaignId,
      row.playerId,
      row.role ?? 'player',
      row.characterId ?? null,
      row.joinedAt,
      row.joinedAt,
      row.joinedAt,
    );
}

/** Who is still at the table. A `table`-scoped event reaches exactly these. */
export function listMemberPlayerIds(
  connection: SqliteConnection,
  campaignId: string,
): readonly string[] {
  const rows = connection
    .prepare(
      `SELECT player_id FROM campaign_members
        WHERE campaign_id = ? AND left_at IS NULL
        ORDER BY player_id`,
    )
    .all(campaignId) as { player_id: string }[];
  return rows.map((row) => row.player_id);
}
