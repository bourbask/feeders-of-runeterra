/**
 * Zone C — the character projection (03-donnees.md section 1.4).
 *
 * EVERY ROW HERE IS A CACHE of `events`, and this repository is written so
 * that it stays one. `upsertCharacter` takes the whole row and replaces it;
 * there is deliberately no `setVigueur(…)` or any other field-by-field
 * mutator, because a projection mutated outside the reducer is precisely the
 * bug `pnpm db:rebuild` (M0-17) exists to catch — and it would catch it three
 * months late.
 *
 * `truncateForCampaign` is the rebuild's first step: zone C is thrown away
 * and replayed. It is here rather than in M0-17's `rebuild.ts` because a
 * table's write path and its truncation belong to the same file.
 */

import type { SqliteConnection } from '../client.js';

export interface CharacterUpsert {
  readonly id: string;
  readonly campaignId: string;
  readonly playerId: string;
  readonly championId: string;
  readonly displayName: string;
  readonly sheetSource: 'handwritten' | 'forged';
  readonly sheetRef: string;
  readonly sheetSnapshot: unknown;
  readonly attrVif: number;
  readonly attrCoeur: number;
  readonly attrFer: number;
  readonly attrOmbre: number;
  readonly attrEsprit: number;
  readonly createdSeq: number;
  readonly updatedSeq: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly vigueur?: number;
  readonly ame?: number;
  readonly vivres?: number;
  readonly momentum?: number;
  readonly status?: string;
}

export interface CharacterRow {
  readonly id: string;
  readonly campaign_id: string;
  readonly player_id: string;
  readonly champion_id: string;
  readonly display_name: string;
  readonly sheet_source: string;
  readonly sheet_ref: string;
  readonly sheet_snapshot_json: string;
  readonly attr_vif: number;
  readonly attr_coeur: number;
  readonly attr_fer: number;
  readonly attr_ombre: number;
  readonly attr_esprit: number;
  readonly vigueur: number;
  readonly ame: number;
  readonly vivres: number;
  readonly momentum: number;
  readonly status: string;
  readonly created_seq: number;
  readonly updated_seq: number;
  readonly created_at: number;
  readonly updated_at: number;
}

/** Writes the projected character, replacing it whole. */
export function upsertCharacter(connection: SqliteConnection, row: CharacterUpsert): void {
  connection
    .prepare(
      `INSERT INTO characters
         (id, campaign_id, player_id, champion_id, display_name, sheet_source, sheet_ref,
          sheet_snapshot_json, attr_vif, attr_coeur, attr_fer, attr_ombre, attr_esprit,
          vigueur, ame, vivres, momentum, status, created_seq, updated_seq,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         sheet_ref = excluded.sheet_ref,
         sheet_snapshot_json = excluded.sheet_snapshot_json,
         attr_vif = excluded.attr_vif, attr_coeur = excluded.attr_coeur,
         attr_fer = excluded.attr_fer, attr_ombre = excluded.attr_ombre,
         attr_esprit = excluded.attr_esprit,
         vigueur = excluded.vigueur, ame = excluded.ame, vivres = excluded.vivres,
         momentum = excluded.momentum, status = excluded.status,
         updated_seq = excluded.updated_seq, updated_at = excluded.updated_at`,
    )
    .run(
      row.id,
      row.campaignId,
      row.playerId,
      row.championId,
      row.displayName,
      row.sheetSource,
      row.sheetRef,
      JSON.stringify(row.sheetSnapshot),
      row.attrVif,
      row.attrCoeur,
      row.attrFer,
      row.attrOmbre,
      row.attrEsprit,
      row.vigueur ?? 5,
      row.ame ?? 5,
      row.vivres ?? 5,
      row.momentum ?? 2,
      row.status ?? 'active',
      row.createdSeq,
      row.updatedSeq,
      row.createdAt,
      row.updatedAt,
    );
}

export function getCharacter(
  connection: SqliteConnection,
  characterId: string,
): CharacterRow | undefined {
  return connection.prepare(`SELECT * FROM characters WHERE id = ?`).get(characterId) as
    CharacterRow | undefined;
}

export function listCharacters(
  connection: SqliteConnection,
  campaignId: string,
): readonly CharacterRow[] {
  return connection
    .prepare(`SELECT * FROM characters WHERE campaign_id = ? ORDER BY id`)
    .all(campaignId) as CharacterRow[];
}

/** Throws the projection away. The journal is what survives. */
export function truncateForCampaign(connection: SqliteConnection, campaignId: string): number {
  return connection.prepare(`DELETE FROM characters WHERE campaign_id = ?`).run(campaignId).changes;
}
