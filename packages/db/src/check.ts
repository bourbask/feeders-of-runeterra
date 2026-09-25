/**
 * `pnpm db:check` — the twelve integrity oracles of 03-donnees.md section 7.3.
 *
 * Each control returns ZERO LINE when it is happy. One line returned fails the
 * command, and the line names its control by number: a red build that says
 * "control 9" sends you to the reducer, a red build that says "control 5"
 * sends you to the allocator.
 *
 * ── HOW THIS LIST IS KEPT HONEST ─────────────────────────────────────────
 * `CONTROLS` is a loop source. Emptying it would make `runIntegrityChecks`
 * return nothing and `db:check` exit 0 on a broken base — the "rule present
 * and inert" failure this repository has paid for six times. Two measures,
 * both in `tests/check.test.ts`:
 *
 *   1. the twelve numbers and the twelve names are SPELLED OUT in the test,
 *      copied from the table of section 7.3, and compared member for member;
 *   2. every control has its own violation, written in the test as a base that
 *      breaks exactly that rule, and asserted to come back red WITH that
 *      control's number — and green once the violation is undone.
 *
 * Two of the twelve cannot be violated through the only write path, and the
 * test says so out loud rather than pretending: control 1 needs the FILE
 * corrupted behind SQLite's back, and control 6 needs
 * `PRAGMA ignore_check_constraints`, because the `CHECK` refuses the bad row
 * before any oracle could see it. Both are reproduced that way in the test,
 * which is the only honest red available for a second line of defence.
 *
 * ── CONTROL 11, AS POINT P4 REFORMULATED IT ──────────────────────────────
 * The spec first asked for `covers_from_seq` / `covers_to_seq`, two columns
 * that do not exist in the DDL. The control reads, and this is what is
 * implemented here: `version` dense from 1 to N per campaign, `source_event_seq`
 * strictly increasing with `version`, and `source_event_seq` never above
 * `campaigns.seq`.
 *
 * ── WHY THERE IS NO THIRTEENTH ───────────────────────────────────────────
 * `scene_state` gets no control of its own: it is a zone C projection, so
 * control 9 truncates it, replays it and compares it byte for byte like the
 * other five. A dedicated control would give the illusion of an extra
 * guarantee where it already exists (section 7.3).
 */

import { createHash } from 'node:crypto';

import type { SqliteConnection } from './client.js';
import { dumpProjections, rebuildCampaign, replayJournal } from './rebuild.js';
import { readSince } from './repositories/events.js';

import { upcast, zGameEvent } from '@for/contracts';
import { REDUCER_VERSION } from '@for/engine';

/** One offending line. Zero of them is what a green control returns. */
export interface CheckFinding {
  readonly control: number;
  readonly name: string;
  readonly campaignId: string | null;
  readonly detail: string;
}

interface Control {
  readonly number: number;
  /** The wording of the table in section 7.3, in French: it is user-facing. */
  readonly name: string;
  readonly run: (connection: SqliteConnection) => readonly CheckFinding[];
}

function finding(control: Control, campaignId: string | null, detail: string): CheckFinding {
  return { control: control.number, name: control.name, campaignId, detail };
}

function campaignIds(connection: SqliteConnection): readonly string[] {
  const rows = connection.prepare(`SELECT id FROM campaigns ORDER BY id`).all() as {
    id: string;
  }[];
  return rows.map((row) => row.id);
}

// ------------------------------------------------------------ canonical JSON

/**
 * The bytes a `state_hash` is taken over.
 *
 * Keys sorted recursively, by code unit: `JSON.stringify` keeps INSERTION
 * order, so two states holding the same facts in a different order would hash
 * differently and control 8 would report a drift that never happened.
 *
 * Exported because the writer of a snapshot and this control must use the same
 * function. Two implementations of "canonical" is one too many.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') {
    // `JSON.stringify` is DECLARED to return `string` and hands back
    // `undefined` for a function or a symbol. Neither belongs in a state, and
    // refusing them by name keeps the hash total without a `??` the compiler
    // believes is dead.
    return typeof value === 'function' || typeof value === 'symbol'
      ? 'null'
      : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

/** sha256, hex, of the canonical JSON. The value `snapshots.state_hash` holds. */
export function stateHash(state: unknown): string {
  return createHash('sha256').update(canonicalJson(state)).digest('hex');
}

// --------------------------------------------------------------- the twelve

const CONTROL_1: Control = {
  number: 1,
  name: 'Intégrité SQLite',
  run: (connection) => {
    let rows: { integrity_check: string }[];
    try {
      rows = connection.pragma('integrity_check') as { integrity_check: string }[];
    } catch (error) {
      // A file corrupted badly enough makes the PRAGMA itself raise. That is a
      // finding, not a crash: the command must report and exit 1.
      return [finding(CONTROL_1, null, `integrity_check a levé : ${String(error)}`)];
    }
    return rows
      .filter((row) => row.integrity_check !== 'ok')
      .map((row) => finding(CONTROL_1, null, row.integrity_check));
  },
};

const CONTROL_2: Control = {
  number: 2,
  name: 'FK physiques',
  run: (connection) => {
    const rows = connection.pragma('foreign_key_check') as {
      table: string;
      rowid: number | null;
      parent: string;
    }[];
    return rows.map((row) =>
      finding(
        CONTROL_2,
        null,
        `${row.table} (rowid ${String(row.rowid)}) référence ${row.parent} sans cible`,
      ),
    );
  },
};

/**
 * The four columns that carry a reference WITHOUT a SQL foreign key.
 *
 * `campaign_members.character_id` is the reason the family exists: a hard key
 * to `characters` would forbid the truncation of zone C, so the link is
 * checked here instead (section 1.2).
 */
const LOGICAL_KEYS = [
  {
    label: 'characters.player_id',
    sql: `SELECT c.campaign_id AS campaign_id, c.id AS ref FROM characters c
           WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.id = c.player_id)`,
  },
  {
    label: 'campaign_members.character_id',
    sql: `SELECT m.campaign_id AS campaign_id, m.id AS ref FROM campaign_members m
           WHERE m.character_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.id = m.character_id)`,
  },
  {
    label: 'events.play_session_id',
    sql: `SELECT e.campaign_id AS campaign_id, e.id AS ref FROM events e
           WHERE e.play_session_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM play_sessions s WHERE s.id = e.play_session_id)`,
  },
  {
    label: 'chronicles.ai_call_id',
    sql: `SELECT h.campaign_id AS campaign_id, h.id AS ref FROM chronicles h
           WHERE h.ai_call_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM ai_calls a WHERE a.id = h.ai_call_id)`,
  },
] as const;

const CONTROL_3: Control = {
  number: 3,
  name: 'FK logiques',
  run: (connection) =>
    LOGICAL_KEYS.flatMap((key) => {
      const rows = connection.prepare(key.sql).all() as {
        campaign_id: string;
        ref: string;
      }[];
      return rows.map((row) =>
        finding(CONTROL_3, row.campaign_id, `${key.label} sans cible sur ${row.ref}`),
      );
    }),
};

const CONTROL_4: Control = {
  number: 4,
  name: 'Densité de séquence',
  run: (connection) => {
    const rows = connection
      .prepare(
        `SELECT campaign_id, max(seq) AS high, min(seq) AS low, count(*) AS n
           FROM events GROUP BY campaign_id
          HAVING max(seq) <> count(*) OR min(seq) <> 1`,
      )
      .all() as { campaign_id: string; high: number; low: number; n: number }[];
    return rows.map((row) =>
      finding(
        CONTROL_4,
        row.campaign_id,
        `seq de ${String(row.low)} à ${String(row.high)} pour ${String(row.n)} entrées`,
      ),
    );
  },
};

const CONTROL_5: Control = {
  number: 5,
  name: 'Compteur cohérent',
  run: (connection) => {
    const rows = connection
      .prepare(
        `SELECT c.id AS campaign_id, c.seq AS counter,
                COALESCE((SELECT max(e.seq) FROM events e WHERE e.campaign_id = c.id), 0) AS high
           FROM campaigns c
          WHERE counter <> high`,
      )
      .all() as { campaign_id: string; counter: number; high: number }[];
    return rows.map((row) =>
      finding(
        CONTROL_5,
        row.campaign_id,
        `campaigns.seq = ${String(row.counter)}, max(events.seq) = ${String(row.high)}`,
      ),
    );
  },
};

/**
 * Bounds, checked again although the DDL already carries them.
 *
 * Redundant on a live base and deliberately so (section 7.3): after a rebuild,
 * a reducer that pushed a gauge out of range would have failed the
 * transaction — unless the constraint itself went missing in a migration. This
 * control is what notices that the second line of defence is gone.
 */
const BOUNDS = [
  {
    label: 'jauge hors de 0..5',
    sql: `SELECT campaign_id, id FROM characters
           WHERE vigueur NOT BETWEEN 0 AND 5 OR ame NOT BETWEEN 0 AND 5
              OR vivres NOT BETWEEN 0 AND 5`,
  },
  {
    label: 'souffle hors de -6..10',
    sql: `SELECT campaign_id, id FROM characters WHERE momentum NOT BETWEEN -6 AND 10`,
  },
  {
    label: 'attribut hors de 1..3',
    sql: `SELECT campaign_id, id FROM characters
           WHERE attr_vif NOT BETWEEN 1 AND 3 OR attr_coeur NOT BETWEEN 1 AND 3
              OR attr_fer NOT BETWEEN 1 AND 3 OR attr_ombre NOT BETWEEN 1 AND 3
              OR attr_esprit NOT BETWEEN 1 AND 3`,
  },
  {
    label: 'crans hors de 0..40',
    sql: `SELECT campaign_id, id FROM progress_tracks WHERE ticks NOT BETWEEN 0 AND 40`,
  },
  {
    label: 'horloge au-delà de ses segments',
    sql: `SELECT campaign_id, id FROM clocks WHERE filled < 0 OR filled > segments`,
  },
] as const;

const CONTROL_6: Control = {
  number: 6,
  name: 'Bornes des jauges',
  run: (connection) =>
    BOUNDS.flatMap((bound) => {
      const rows = connection.prepare(bound.sql).all() as {
        campaign_id: string;
        id: string;
      }[];
      return rows.map((row) => finding(CONTROL_6, row.campaign_id, `${row.id} : ${bound.label}`));
    }),
};

const CONTROL_7: Control = {
  number: 7,
  name: 'Verrous de distribution',
  run: (connection) => {
    const rows = connection
      .prepare(
        `SELECT e.campaign_id AS campaign_id, e.id AS id, e.champion_id AS champion_id
           FROM entities e
           JOIN campaign_champion_locks l
             ON l.campaign_id = e.campaign_id AND l.champion_id = e.champion_id
          WHERE e.kind = 'npc' AND l.lock_kind = 'reserved_pc'`,
      )
      .all() as { campaign_id: string; id: string; champion_id: string }[];
    return rows.map((row) =>
      finding(
        CONTROL_7,
        row.campaign_id,
        `le PNJ ${row.id} porte le champion réservé ${row.champion_id}`,
      ),
    );
  },
};

const CONTROL_8: Control = {
  number: 8,
  name: 'Instantanés',
  run: (connection) => {
    const snapshots = connection
      .prepare(
        `SELECT id, campaign_id, seq, reducer_version, state_hash
           FROM snapshots WHERE reducer_version = ? ORDER BY campaign_id, seq`,
      )
      .all(REDUCER_VERSION) as {
      id: string;
      campaign_id: string;
      seq: number;
      state_hash: string;
    }[];

    return snapshots.flatMap((snapshot) => {
      const journal = readSince(connection, snapshot.campaign_id, 0).filter(
        (event) => event.seq <= snapshot.seq,
      );
      if (journal.length < snapshot.seq) {
        return [
          finding(
            CONTROL_8,
            snapshot.campaign_id,
            `instantané ${snapshot.id} à seq ${String(snapshot.seq)} au-delà du journal`,
          ),
        ];
      }
      let replayed: string;
      try {
        replayed = stateHash(replayJournal(snapshot.campaign_id, journal).state);
      } catch (error) {
        return [finding(CONTROL_8, snapshot.campaign_id, `rejeu impossible : ${String(error)}`)];
      }
      return replayed === snapshot.state_hash
        ? []
        : [
            finding(
              CONTROL_8,
              snapshot.campaign_id,
              `instantané ${snapshot.id} : state_hash ${snapshot.state_hash}, rejeu ${replayed}`,
            ),
          ];
    });
  },
};

const CONTROL_9: Control = {
  number: 9,
  name: 'Reconstruction idempotente',
  run: (connection) =>
    campaignIds(connection).flatMap((campaignId) => {
      const before = dumpProjections(connection, campaignId);
      try {
        rebuildCampaign(connection, campaignId);
      } catch (error) {
        return [finding(CONTROL_9, campaignId, `reconstruction impossible : ${String(error)}`)];
      }
      const after = dumpProjections(connection, campaignId);
      if (before === after) return [];
      return [
        finding(
          CONTROL_9,
          campaignId,
          `projections divergentes après reconstruction : ${firstDifference(before, after)}`,
        ),
      ];
    }),
};

/**
 * The first line that differs, reduced to the COLUMNS that differ.
 *
 * A finding that printed the two rows whole would be four hundred characters
 * of identical JSON around one number, and the one number is the whole point:
 * "vigueur 1 -> 3" sends you to the write that had no event behind it.
 */
function firstDifference(before: string, after: string): string {
  const left = before.split('\n');
  const right = after.split('\n');
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const one = left[index] ?? '';
    const other = right[index] ?? '';
    if (one === other) continue;
    const columns = differingColumns(one, other);
    return columns ?? `avant « ${one || '(rien)'} » / après « ${other || '(rien)'} »`;
  }
  return 'différence sans ligne divergente';
}

/** `null` when either side is not a row of JSON — a table header, or nothing. */
function differingColumns(one: string, other: string): string | null {
  const left = parseRow(one);
  const right = parseRow(other);
  if (left === null || right === null) return null;

  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const changed = keys
    .filter((key) => canonicalJson(left[key]) !== canonicalJson(right[key]))
    .map((key) => `${key} ${canonicalJson(left[key])} -> ${canonicalJson(right[key])}`);
  return changed.length === 0 ? null : changed.join(', ');
}

function parseRow(line: string): Record<string, unknown> | null {
  if (!line.startsWith('{')) return null;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const CONTROL_10: Control = {
  number: 10,
  name: 'Payloads',
  run: (connection) =>
    campaignIds(connection).flatMap((campaignId) =>
      readSince(connection, campaignId, 0).flatMap((row) => {
        try {
          const { payload, payloadVersion } = upcast({
            type: row.type,
            payloadVersion: row.payloadVersion,
            payload: row.payload,
          });
          const parsed = zGameEvent.safeParse({ ...row, payload, payloadVersion });
          return parsed.success
            ? []
            : [
                finding(
                  CONTROL_10,
                  campaignId,
                  `seq ${String(row.seq)} (${row.type}) : ${parsed.error.issues
                    .map((issue) => `${issue.path.join('.')} ${issue.message}`)
                    .join(' ; ')}`,
                ),
              ];
        } catch (error) {
          return [finding(CONTROL_10, campaignId, `seq ${String(row.seq)} : ${String(error)}`)];
        }
      }),
    ),
};

const CONTROL_11: Control = {
  number: 11,
  name: 'Chroniques',
  run: (connection) =>
    campaignIds(connection).flatMap((campaignId) => {
      const rows = connection
        .prepare(
          `SELECT version, source_event_seq FROM chronicles
            WHERE campaign_id = ? ORDER BY version`,
        )
        .all(campaignId) as { version: number; source_event_seq: number }[];
      const counter = (
        connection.prepare(`SELECT seq FROM campaigns WHERE id = ?`).get(campaignId) as {
          seq: number;
        }
      ).seq;

      const found: CheckFinding[] = [];
      let previousSeq = -1;
      for (const [index, row] of rows.entries()) {
        const expected = index + 1;
        if (row.version !== expected) {
          found.push(
            finding(
              CONTROL_11,
              campaignId,
              `version ${String(row.version)} là où ${String(expected)} était attendu`,
            ),
          );
        }
        if (row.source_event_seq <= previousSeq) {
          found.push(
            finding(
              CONTROL_11,
              campaignId,
              `version ${String(row.version)} : source_event_seq ${String(
                row.source_event_seq,
              )} n'est pas au-dessus de ${String(previousSeq)}`,
            ),
          );
        }
        if (row.source_event_seq > counter) {
          found.push(
            finding(
              CONTROL_11,
              campaignId,
              `version ${String(row.version)} : source_event_seq ${String(
                row.source_event_seq,
              )} dépasse campaigns.seq ${String(counter)}`,
            ),
          );
        }
        previousSeq = row.source_event_seq;
      }
      return found;
    }),
};

const CONTROL_12: Control = {
  number: 12,
  name: 'Contenu',
  run: (connection) => {
    const rows = connection
      .prepare(
        `SELECT c.id AS campaign_id, c.content_pack_hash AS hash FROM campaigns c
          WHERE NOT EXISTS (SELECT 1 FROM content_packs p WHERE p.hash = c.content_pack_hash)`,
      )
      .all() as { campaign_id: string; hash: string }[];
    return rows.map((row) =>
      finding(CONTROL_12, row.campaign_id, `content_pack_hash ${row.hash} absent de content_packs`),
    );
  },
};

/** The twelve, in the order of the table of section 7.3. */
export const CONTROLS: readonly Control[] = [
  CONTROL_1,
  CONTROL_2,
  CONTROL_3,
  CONTROL_4,
  CONTROL_5,
  CONTROL_6,
  CONTROL_7,
  CONTROL_8,
  CONTROL_9,
  CONTROL_10,
  CONTROL_11,
  CONTROL_12,
];

/** Number and name of each control, for a caller that reports rather than runs. */
export const CONTROL_ROSTER: readonly { readonly number: number; readonly name: string }[] =
  CONTROLS.map((control) => ({ number: control.number, name: control.name }));

/**
 * Runs the twelve in order and returns every offending line.
 *
 * Control 9 REBUILDS as it checks — that is what the control is (section 7.3):
 * dump, rebuild, dump, compare. Running `db:check` therefore leaves zone C in
 * the state the journal says it should be in.
 */
export function runIntegrityChecks(connection: SqliteConnection): readonly CheckFinding[] {
  return CONTROLS.flatMap((control) => {
    try {
      return control.run(connection);
    } catch (error) {
      // A control that cannot even RUN is a finding, not a crash: on a file
      // damaged badly enough, the query itself raises, and `db:check` must
      // still name what it could not check and exit 1.
      return [finding(control, null, `contrôle interrompu : ${String(error)}`)];
    }
  });
}

/** One finding, as `db:check` prints it. */
export function formatFinding(found: CheckFinding): string {
  const where = found.campaignId === null ? '' : ` [${found.campaignId}]`;
  return `contrôle ${String(found.control)} — ${found.name}${where} : ${found.detail}`;
}
