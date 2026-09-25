/**
 * The distribution lock, read back from the projection — DEFENCE IN DEPTH.
 *
 * ── WHY IT IS READ TWICE, AND WHY THAT IS NOT DUPLICATION ────────────────
 * The storyteller is TOLD the reserved names, in the campaign block of its
 * prompt (`buildCampaignBlock`, M0-18). Telling is the first line; it is also
 * the line a small model crosses. The second line is this file: the list is
 * re-read from `campaign_champion_locks` AT THE MOMENT THE PROSE COMES BACK,
 * and the post-filter runs on THAT list. A player who joined mid-generation
 * has their champion locked by an entry the prompt never saw — the projection
 * has it, the prompt does not, and only the second reading catches it.
 *
 * The two readings are not compared to each other: one is an instruction, the
 * other a check. Comparing them would be the chiffre-qui-se-compare-à-lui-même
 * of ADR 0007.
 *
 * ── THE RULE IS NOT REWRITTEN HERE ───────────────────────────────────────
 * The leak itself is decided by `noReservedChampion`, the production
 * assertion of `@for/ai`. This module answers WHO is reserved; it does not
 * answer whether a text names them. One rule, one implementation, shared by
 * the eval and the post-filter — that sharing is the reason
 * `packages/ai/src/assertions/` exists at all (ARCHITECTURE.md section 4.3).
 *
 * ── THE ALIASES COME FROM THE CONTENT, NEVER FROM THE JOURNAL ────────────
 * `campaign_champion_locks` stores a `champion_id`. The names that identifier
 * answers to live in `content/champions-index.json`, which is versioned, and
 * a nickname missing from it is a hole in the lock — risk 5 of
 * ARCHITECTURE.md section 9, a content chantier rather than a code one. A
 * champion the index does not know keeps its identifier as its only name,
 * loudly rather than silently: `tests/ai/lockout.test.ts`, « un champion
 * absent de l'index garde son identifiant pour seul nom ».
 */

import type { ReservedChampion } from '@for/ai';
import type { ContentRegistry } from '@for/content';
import type { SqliteConnection } from '@for/db';

/** The three lock kinds of `campaign_champion_locks.lock_kind`. */
export type ChampionLockKind = 'reserved_pc' | 'allowed_npc' | 'banned';

export interface ChampionLockRow {
  readonly championId: string;
  readonly lockKind: ChampionLockKind;
  readonly setSeq: number;
}

/**
 * The campaign's locks, as the projection holds them, ordered.
 *
 * BY CAMPAIGN, and the scope is a decision rather than a query detail
 * (ARCHITECTURE.md section 4.1): a reserved champion is another player's AT
 * THIS TABLE. A cross-campaign reservation would leak the roster of every
 * other table into this prompt.
 */
export function championLocks(
  connection: SqliteConnection,
  campaignId: string,
): readonly ChampionLockRow[] {
  const rows = connection
    .prepare(
      `SELECT champion_id, lock_kind, set_seq FROM campaign_champion_locks
        WHERE campaign_id = ? ORDER BY champion_id`,
    )
    .all(campaignId) as { champion_id: string; lock_kind: string; set_seq: number }[];
  return rows.map((row) => ({
    championId: row.champion_id,
    lockKind: row.lock_kind as ChampionLockKind,
    setSeq: row.set_seq,
  }));
}

/**
 * Every name the post-filter must refuse, re-read now.
 *
 * `except` drops one champion from the list: the ACTING character's own. The
 * storyteller is writing about them, and a filter that refused their name
 * would refuse every turn. Section 2.1 says the same thing from the prompt's
 * side — the reserved list is « les champions des AUTRES joueurs ».
 */
export function reservedChampions(
  connection: SqliteConnection,
  content: ContentRegistry,
  campaignId: string,
  except: readonly string[] = [],
): readonly ReservedChampion[] {
  const excluded = new Set(except);
  return championLocks(connection, campaignId)
    .filter((lock) => lock.lockKind === 'reserved_pc' && !excluded.has(lock.championId))
    .map((lock) => {
      const entry = content.listChampionIndex().find((row) => row.id === lock.championId);
      return entry === undefined
        ? { displayName: lock.championId, aliases: [] }
        : { displayName: entry.displayName, aliases: entry.aliases };
    });
}

/**
 * The champion each character of this campaign plays, from the projection.
 *
 * Used to answer `except` above, and nothing else. It reads `characters`
 * rather than the journal because the caller already has a committed state
 * and a second replay per turn would buy nothing.
 */
export function championOfCharacter(
  connection: SqliteConnection,
  campaignId: string,
  characterId: string,
): string | null {
  const row = connection
    .prepare(`SELECT champion_id FROM characters WHERE campaign_id = ? AND id = ?`)
    .get(campaignId, characterId) as { champion_id: string } | undefined;
  return row?.champion_id ?? null;
}
