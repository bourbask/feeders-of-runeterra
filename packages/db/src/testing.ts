/**
 * Fixtures for this package's own tests. NOT re-exported by `src/index.ts`.
 *
 * WHY IT LIVES UNDER `src/` AND NOT IN `tests/`: the repository's flat ESLint
 * config maps `**\/*.test.ts` to `tsconfig.test.json` and everything else to
 * the project service, which only sees `src/**`. A support file under
 * `tests/` is therefore in no TypeScript program at all and `pnpm lint` stops
 * on "not found by the project service". Reported rather than worked around
 * with an ignore comment.
 *
 * A migrated database on a REAL FILE, never `:memory:`. WAL is the reason:
 * `journal_mode = WAL` is silently downgraded on an in-memory database, so a
 * suite built on `:memory:` would be measuring a different engine from the one
 * production runs.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SqliteConnection } from './client.js';
import { migrateFile } from './migrate.js';

export interface TempDb {
  readonly connection: SqliteConnection;
  readonly path: string;
  readonly close: () => void;
}

/** Creates a temporary folder, migrates a file inside it, returns both. */
export function migratedTempDb(): TempDb {
  const folder = mkdtempSync(join(tmpdir(), 'for-db-test-'));
  const path = join(folder, 'app.db');
  const connection = migrateFile(path);
  return {
    connection,
    path,
    close: () => {
      connection.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

const NOW = 1_700_000_000_000;

/** One player and one campaign, the minimum any journal row needs. */
export function seedCampaign(
  connection: SqliteConnection,
  ids: { playerId: string; campaignId: string },
): void {
  connection
    .prepare(
      `INSERT INTO players (id, discord_user_id, discord_username, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ids.playerId, `discord-${ids.playerId}`, 'kevin', NOW, NOW);

  connection
    .prepare(
      `INSERT INTO campaigns
         (id, slug, name, owner_player_id, content_pack_version, content_pack_hash,
          rules_version, reducer_version, rng_seed, seq, created_at, updated_at)
       VALUES (?, ?, ?, ?, '1.0.0', 'sha256-x', 1, 1, 'deadbeef', 0, ?, ?)`,
    )
    .run(ids.campaignId, `slug-${ids.campaignId}`, 'Le pacte de la griffe', ids.playerId, NOW, NOW);
}

/** Allocates the next `seq` exactly as section 3.2 prescribes, then inserts. */
export function appendEvent(
  connection: SqliteConnection,
  row: {
    id: string;
    campaignId: string;
    seq: number;
    type: string;
    scope?: string;
    recipientsJson?: string | null;
  },
): void {
  connection
    .prepare(
      `INSERT INTO events
         (id, campaign_id, seq, type, payload_json, actor_kind, scope, recipients_json, created_at)
       VALUES (?, ?, ?, ?, '{}', 'engine', ?, ?, ?)`,
    )
    .run(
      row.id,
      row.campaignId,
      row.seq,
      row.type,
      row.scope ?? 'table',
      row.recipientsJson ?? null,
      NOW,
    );
}

/** `UPDATE campaigns SET seq = seq + n RETURNING seq` — the allocator. */
export function allocateSeq(connection: SqliteConnection, campaignId: string, n = 1): number {
  const row = connection
    .prepare(`UPDATE campaigns SET seq = seq + ? WHERE id = ? RETURNING seq`)
    .get(n, campaignId) as { seq: number };
  return row.seq;
}
