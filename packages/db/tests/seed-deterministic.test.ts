/**
 * The demo campaign, measured — never read.
 *
 * Every number below comes from ONE of two places and the file says which:
 * a figure written out in the acceptance criteria of M0-26 (248 entries, 71
 * types, exit code 1) is SPELLED OUT here in full, and a figure that belongs
 * to the engine (the catalogue of event types) is compared TO THE ENGINE. No
 * assertion reads its expected value from the seed it is checking; that is
 * ADR 0007's operating rule and it is what keeps this file from being green
 * over nothing.
 *
 * Two consequences worth naming:
 *
 *   - `GAME_EVENT_TYPES` is a LOOP SOURCE here. Emptying it would make the
 *     coverage test pass with an empty journal, so its LENGTH is asserted
 *     against the 71 the task sheet writes out. One without the other is
 *     inert;
 *   - `DEMO_MINIMAL_EVENT_COUNT` is the one constant compared to a count, and
 *     that is the criterion itself: « ≈ 40 » cannot be checked, a constant
 *     can. The two operands are independent — a literal in `demo.ts` and a
 *     `SELECT count(*)` over rows the script wrote.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntegrityChecks } from '../src/check.js';
import type { SqliteConnection } from '../src/client.js';
import { openSqlite } from '../src/client.js';
import { dumpProjections, rebuildCampaign } from '../src/rebuild.js';
import { readSince, readSinceForPlayer } from '../src/repositories/events.js';
import { CHRONICLE_VERSIONS } from '../src/seed/chronicles.js';
import {
  DEMO_CAMPAIGN_SLUG,
  DEMO_MINIMAL_EVENT_COUNT,
  DEMO_SEED,
  seedDemoFile,
} from '../src/seed/demo.js';

import { GAME_EVENT_TYPES } from '@for/engine';

/** M0-26, acceptance criteria. Written out, never derived from the seed. */
const EXPECTED_EVENTS = 248;
const EXPECTED_TYPES = 71;
/** 03-donnees.md section 7.1: 180 + 68 = 248. */
const EXPECTED_SESSION_ONE = 180;
const EXPECTED_SESSION_TWO = 68;
/** Section 7.1: four players, eleven entities, three chronicle versions. */
const EXPECTED_PLAYERS = 4;
const EXPECTED_ENTITIES = 11;
const EXPECTED_CHRONICLES = 3;
/** The acceptance criterion of the production guard. */
const REFUSED_EXIT_CODE = 1;

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const WORKSPACE_ROOT = resolve(PACKAGE_ROOT, '..', '..');

let workspace: string;
let full: string;
let minimal: string;

/**
 * The file `pnpm <command>` runs, read out of the workspace manifest.
 *
 * Reading it rather than writing the path twice is what keeps a test from
 * drifting away from the command it claims to measure: rename an entry point
 * and the test goes red before the command does.
 */
function entryPointOf(command: string): string {
  const manifest = JSON.parse(readFileSync(join(WORKSPACE_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const script = manifest.scripts[command];
  const target = (script ?? '').split(/\s+/).find((part) => part.endsWith('.ts'));
  if (target === undefined) {
    throw new Error(`${command} ne pointe sur aucun fichier : ${String(script)}`);
  }
  return join(WORKSPACE_ROOT, target);
}

/**
 * A subprocess that transpiles TypeScript is slow under a loaded `turbo run`.
 *
 * MEASURED, not guessed: the two-process determinism test took 7.2 s while the
 * rest of the monorepo was building beside it, and vitest's default five
 * seconds failed it. The value is generous on purpose — this bound exists to
 * stop a hang, not to measure performance.
 */
const SUBPROCESS_TIMEOUT_MS = 120_000;

/** Runs one of the two commands in its OWN process. Returns the exit code. */
function runCommand(command: string, args: readonly string[], databasePath: string): number {
  try {
    execFileSync(process.execPath, ['--import', 'tsx', entryPointOf(command), ...args], {
      cwd: WORKSPACE_ROOT,
      env: { ...process.env, NODE_ENV: 'development', DATABASE_PATH: databasePath },
      stdio: 'pipe',
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function withBase<T>(path: string, body: (connection: SqliteConnection) => T): T {
  const connection = openSqlite(path);
  try {
    return body(connection);
  } finally {
    connection.close();
  }
}

function campaignId(connection: SqliteConnection): string {
  return (
    connection.prepare(`SELECT id FROM campaigns WHERE slug = ?`).get(DEMO_CAMPAIGN_SLUG) as {
      id: string;
    }
  ).id;
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'for-seed-'));
  full = join(workspace, 'full.db');
  minimal = join(workspace, 'minimal.db');
  seedDemoFile(full, { force: true });
  seedDemoFile(minimal, { force: true, minimal: true });
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('la campagne de démonstration', () => {
  it('porte exactement 248 entrées de journal', () => {
    withBase(full, (connection) => {
      const rows = connection.prepare(`SELECT count(*) AS n FROM events`).get() as { n: number };
      expect(rows.n).toBe(EXPECTED_EVENTS);
    });
  });

  it('couvre au moins une fois chacun des 71 types du catalogue', () => {
    // The catalogue is the ENGINE's, not the seed's — and its length is
    // spelled out, so emptying it cannot make this test pass over nothing.
    expect(GAME_EVENT_TYPES).toHaveLength(EXPECTED_TYPES);
    withBase(full, (connection) => {
      const present = new Set(
        (connection.prepare(`SELECT DISTINCT type FROM events`).all() as { type: string }[]).map(
          (row) => row.type,
        ),
      );
      const missing = GAME_EVENT_TYPES.filter((type) => !present.has(type));
      // The criterion asks the failure to NAME the missing types, which is
      // what comparing the arrays does; a `toBe(0)` on a count would not.
      expect(missing).toEqual([]);
    });
  });

  it('se répartit en deux séances de 180 et 68 entrées', () => {
    withBase(full, (connection) => {
      const rows = connection
        .prepare(
          `SELECT s.ordinal AS ordinal, count(e.seq) AS n
             FROM play_sessions s JOIN events e ON e.play_session_id = s.id
            GROUP BY s.ordinal ORDER BY s.ordinal`,
        )
        .all() as { ordinal: number; n: number }[];
      expect(rows).toEqual([
        { ordinal: 1, n: EXPECTED_SESSION_ONE },
        { ordinal: 2, n: EXPECTED_SESSION_TWO },
      ]);
    });
  });

  it('pose les quatre joueurs, les onze entités et les trois chroniques', () => {
    withBase(full, (connection) => {
      const count = (table: string): number =>
        (connection.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
      expect(count('players')).toBe(EXPECTED_PLAYERS);
      expect(count('entities')).toBe(EXPECTED_ENTITIES);
      expect(count('chronicles')).toBe(EXPECTED_CHRONICLES);
      expect(CHRONICLE_VERSIONS).toHaveLength(EXPECTED_CHRONICLES);
    });
  });

  it('porte les sept jets remarquables', () => {
    withBase(full, (connection) => {
      const one = (sql: string): number => (connection.prepare(sql).get() as { n: number }).n;
      const remarkable = {
        franche: one(
          `SELECT count(*) AS n FROM events WHERE type = 'roll.action_resolved'
             AND json_extract(payload_json, '$.outcome') = 'franche'`,
        ),
        partielle: one(
          `SELECT count(*) AS n FROM events WHERE type = 'roll.action_resolved'
             AND json_extract(payload_json, '$.outcome') = 'partielle'`,
        ),
        echec: one(
          `SELECT count(*) AS n FROM events WHERE type = 'roll.action_resolved'
             AND json_extract(payload_json, '$.outcome') = 'echec'`,
        ),
        presage: one(`SELECT count(*) AS n FROM events WHERE type = 'roll.presage_drawn'`),
        souffleBrule: one(
          `SELECT count(*) AS n FROM events WHERE type = 'character.momentum_burned'`,
        ),
        souffleNegatifAnnule: one(
          `SELECT count(*) AS n FROM events WHERE type = 'character.momentum_negated'`,
        ),
        plafonneADix: one(
          `SELECT count(*) AS n FROM events WHERE type = 'roll.action_resolved'
             AND json_extract(payload_json, '$.cappedAtTen') = 1`,
        ),
      };
      // Each one AT LEAST once. The exact counts are dice, not a contract.
      for (const [name, count] of Object.entries(remarkable)) {
        expect(count, `jet remarquable manquant : ${name}`).toBeGreaterThan(0);
      }
    });
  });

  it('garde le tour annulé au journal sans l’appliquer', () => {
    withBase(full, (connection) => {
      const reverted = connection
        .prepare(`SELECT seq, payload_json FROM events WHERE type = 'system.reverted'`)
        .all() as { seq: number; payload_json: string }[];
      expect(reverted).toHaveLength(1);
      const payload = JSON.parse(reverted[0]?.payload_json ?? '{}') as {
        targetSeqs: number[];
        reason: string;
        byPlayerId: string | null;
      };
      expect(payload.reason).toBe('gm_refusal:cible_morte');
      // A refusal is not human: 03-donnees.md section 3.4 makes `byPlayerId`
      // null exactly in that case.
      expect(payload.byPlayerId).toBeNull();
      expect(payload.targetSeqs.length).toBeGreaterThan(0);

      // The cancelled entries are STILL THERE — erasing them would be lying
      // about what happened (P22) — and they are all before the cancellation.
      const kept = connection
        .prepare(`SELECT count(*) AS n FROM events WHERE seq IN (${payload.targetSeqs.join(',')})`)
        .get() as { n: number };
      expect(kept.n).toBe(payload.targetSeqs.length);
      expect(Math.max(...payload.targetSeqs)).toBeLessThan(reverted[0]?.seq ?? 0);

      // And the character the cancelled turn was about is alive.
      const braum = connection
        .prepare(`SELECT status FROM characters WHERE champion_id = 'braum'`)
        .get() as { status: string };
      expect(braum.status).toBe('active');
    });
  });

  it('n’écrit aucune projection hors du réducteur', () => {
    // Invariant 4, measured the way control 9 measures it: zone C thrown away,
    // replayed, compared byte for byte. A gauge posted straight into
    // `characters` by the seed would show up here as a divergence.
    withBase(full, (connection) => {
      const id = campaignId(connection);
      const before = dumpProjections(connection, id);
      rebuildCampaign(connection, id);
      expect(dumpProjections(connection, id)).toBe(before);
    });
  });

  it('ne livre à un joueur que les entrées qui lui sont adressées', () => {
    withBase(full, (connection) => {
      const id = campaignId(connection);
      const everything = readSince(connection, id, 0);
      const addressed = everything.filter((event) => event.scope !== 'table');
      // ADR 0008: at least one entry is NOT at table scope, otherwise this
      // fixture could not tell a working filter from a missing one.
      expect(addressed.length).toBeGreaterThan(0);

      const players = (
        connection.prepare(`SELECT id, discord_username FROM players`).all() as {
          id: string;
          discord_username: string;
        }[]
      ).sort((a, b) => a.discord_username.localeCompare(b.discord_username));

      for (const player of players) {
        const mine = readSinceForPlayer(connection, id, player.id, 0);
        const expectedCount = everything.filter(
          (event) => event.scope === 'table' || (event.recipients ?? []).includes(player.id),
        ).length;
        expect(mine.length, `flux de ${player.discord_username}`).toBe(expectedCount);
        expect(mine.length).toBeLessThanOrEqual(everything.length);
      }

      // Somebody sees strictly less than the table: the addressed entries are
      // not addressed to everyone.
      const sizes = players.map(
        (player) => readSinceForPlayer(connection, id, player.id, 0).length,
      );
      expect(Math.min(...sizes)).toBeLessThan(everything.length);
    });
  });

  it('ne cite dans ses chroniques que des séquences que le journal porte', () => {
    withBase(full, (connection) => {
      const highest = (
        connection.prepare(`SELECT max(seq) AS n FROM events`).get() as { n: number }
      ).n;
      const rows = connection
        .prepare(`SELECT version, source_event_seq, doc_json FROM chronicles ORDER BY version`)
        .all() as { version: number; source_event_seq: number; doc_json: string }[];
      expect(rows).toHaveLength(EXPECTED_CHRONICLES);
      for (const row of rows) {
        const doc = JSON.parse(row.doc_json) as { facts: { fact_id: string; event_seq: number }[] };
        expect(doc.facts.length).toBeGreaterThan(0);
        for (const fact of doc.facts) {
          expect(fact.event_seq, `${fact.fact_id} (v${String(row.version)})`).toBeGreaterThan(0);
          expect(fact.event_seq).toBeLessThanOrEqual(row.source_event_seq);
          expect(row.source_event_seq).toBeLessThanOrEqual(highest);
        }
      }
    });
  });

  it('passe les douze oracles d’intégrité', () => {
    withBase(full, (connection) => {
      expect(runIntegrityChecks(connection)).toEqual([]);
    });
  });
});

describe('le déterminisme du seed', () => {
  it(
    'donne deux fichiers de sha256 identique après VACUUM',
    () => {
      // TWO PROCESSES, and that is not ceremony. Measured during recette: seeding
      // twice IN THE SAME PROCESS cannot see a value evaluated once per process.
      // A probe that replaced `DEMO_SEED.epoch` with `Date.now()` left the
      // in-process version of this test GREEN — the module was loaded once, so
      // both runs shared the same instant. The criterion says « deux exécutions
      // de pnpm db:seed --force », and two executions is what this runs.
      const first = join(workspace, 'run-1.db');
      const second = join(workspace, 'run-2.db');
      expect(runCommand('db:seed', ['--force'], first)).toBe(0);
      expect(runCommand('db:seed', ['--force'], second)).toBe(0);
      expect(sha256(first)).toBe(sha256(second));
      // And it is a real base, not two empty files that happen to match.
      expect(statSync(first).size).toBeGreaterThan(0);
      withBase(first, (connection) => {
        const rows = connection.prepare(`SELECT count(*) AS n FROM events`).get() as { n: number };
        expect(rows.n).toBe(EXPECTED_EVENTS);
      });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it('tire les mêmes dés parce que la graine ne bouge pas', () => {
    // The seed of section 7.2, spelled out. A change here is a change of every
    // die of the demo campaign and of every golden corpus built on it.
    expect(DEMO_SEED.rngSeed).toBe('00'.repeat(32));
    expect(DEMO_SEED.epoch).toBe(Date.UTC(2026, 0, 15, 20, 0, 0));
    withBase(full, (connection) => {
      const row = connection
        .prepare(
          `SELECT min(created_at) AS first FROM events WHERE campaign_id = (
             SELECT id FROM campaigns WHERE slug = ?)`,
        )
        .get(DEMO_CAMPAIGN_SLUG) as { first: number };
      expect(row.first).toBe(DEMO_SEED.epoch);
    });
  });
});

describe('la base minimale', () => {
  it('écrit exactement DEMO_MINIMAL_EVENT_COUNT entrées', () => {
    withBase(minimal, (connection) => {
      const rows = connection.prepare(`SELECT count(*) AS n FROM events`).get() as { n: number };
      expect(rows.n).toBe(DEMO_MINIMAL_EVENT_COUNT);
    });
  });

  it('ferme la première scène', () => {
    withBase(minimal, (connection) => {
      const last = connection
        .prepare(`SELECT type, payload_json FROM events ORDER BY seq DESC LIMIT 1`)
        .get() as { type: string; payload_json: string };
      expect(last.type).toBe('scene.ended');
      const opened = connection
        .prepare(`SELECT count(*) AS n FROM events WHERE type = 'scene.started'`)
        .get() as { n: number };
      const closed = connection
        .prepare(`SELECT count(*) AS n FROM events WHERE type = 'scene.ended'`)
        .get() as { n: number };
      expect(closed.n).toBe(opened.n);
    });
  });

  it('passe les douze oracles d’intégrité', () => {
    withBase(minimal, (connection) => {
      expect(runIntegrityChecks(connection)).toEqual([]);
    });
  });

  it('est plus courte que la campagne entière', () => {
    expect(DEMO_MINIMAL_EVENT_COUNT).toBeLessThan(EXPECTED_EVENTS);
  });
});

describe('la garde anti-production', () => {
  // THE COMMAND, not a function call. The criterion is an EXIT CODE of a
  // command line, and a unit test on `refuseInProduction` would prove nothing
  // about what `pnpm db:reset` does.
  it(
    'sort en 1 sans rien supprimer sous NODE_ENV=production',
    () => {
      const target = join(workspace, 'protegee.db');
      seedDemoFile(target, { force: true, minimal: true });
      const before = sha256(target);

      let status = 0;
      try {
        execFileSync(process.execPath, ['--import', 'tsx', entryPointOf('db:reset')], {
          cwd: WORKSPACE_ROOT,
          env: { ...process.env, NODE_ENV: 'production', DATABASE_PATH: target },
          stdio: 'pipe',
        });
      } catch (error) {
        status = (error as { status?: number }).status ?? 0;
      }

      expect(status).toBe(REFUSED_EXIT_CODE);
      // AND THE FILE IS UNTOUCHED. An exit code alone would pass on a command
      // that deleted the base and then refused.
      expect(sha256(target)).toBe(before);
    },
    SUBPROCESS_TIMEOUT_MS,
  );
});
