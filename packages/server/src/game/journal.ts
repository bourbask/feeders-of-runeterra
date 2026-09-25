/**
 * Reading the journal back as engine values.
 *
 * `@for/db` hands out `JournalEvent`: the row, with its payload parsed as
 * `unknown`. The engine works in `GameEvent`. The bridge is the SAME one
 * `replayJournal` walks — upcast, then `zGameEvent.parse` — and it is written
 * once here so the three readers that need it (the burn window, the proof, the
 * cancellation) cannot each grow their own idea of what a row means.
 *
 * WHY IT PARSES INSTEAD OF CASTING. A payload comes out of SQLite as JSON that
 * nothing has checked since it was written, possibly by an older version of
 * this program. Casting would push whatever is in the column straight into the
 * reducer. Parsing is also what makes the upcasters real: a row at an older
 * `payload_version` is brought forward before the schema sees it, which is the
 * whole promise of 03-donnees.md section 3.8 — "une campagne de 2026 doit
 * encore se charger en 2028".
 */

import { upcast, zGameEvent } from '@for/contracts';
import { EVENT_COLUMNS, toJournalEvent } from '@for/db';

import type { EventRow, JournalEvent, SqliteConnection } from '@for/db';
import type { GameEvent } from '@for/engine';

/** One row, upcast and parsed. Throws on a payload no schema recognises. */
export function toGameEvent(row: JournalEvent): GameEvent {
  const { payload, payloadVersion } = upcast({
    type: row.type,
    payloadVersion: row.payloadVersion,
    payload: row.payload,
  });
  return zGameEvent.parse({ ...row, payload, payloadVersion });
}

/** The whole campaign after `afterSeq`, as engine values, in `seq` order. */
export function readJournalSince(
  connection: SqliteConnection,
  campaignId: string,
  afterSeq: number,
): readonly GameEvent[] {
  const rows = connection
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM events
        WHERE campaign_id = ? AND seq > ?
        ORDER BY seq`,
    )
    .all(campaignId, afterSeq) as EventRow[];
  return rows.map((row) => toGameEvent(toJournalEvent(row)));
}

/**
 * Every entry of one turn, in `seq` order.
 *
 * THE GROUP IS THE UNIT, and that is the whole point of `correlation_id`:
 * « Pourquoi ? » reads a turn, and `revertTurn` cancels a turn. Neither takes
 * a list of sequences, because a caller able to name sequences is a caller
 * able to cancel a roll without the gauge change it caused (03-donnees.md
 * section 3.7).
 */
export function readCorrelationGroup(
  connection: SqliteConnection,
  campaignId: string,
  correlationId: string,
): readonly GameEvent[] {
  const rows = connection
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM events
        WHERE campaign_id = ? AND correlation_id = ?
        ORDER BY seq`,
    )
    .all(campaignId, correlationId) as EventRow[];
  return rows.map((row) => toGameEvent(toJournalEvent(row)));
}
