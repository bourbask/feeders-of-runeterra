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
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
import type { SeedReport } from '../src/seed/demo.js';
import {
  DEMO_CAMPAIGN_SLUG,
  DEMO_MINIMAL_EVENT_COUNT,
  DEMO_SEED,
  seedDemoFile,
} from '../src/seed/demo.js';
import { DemoScriptInconsistent, Director, SERVER_WRITTEN_TYPES } from '../src/seed/director.js';
import {
  DemoContentIncomplete,
  demoContent,
  previousPackVersion,
} from '../src/seed/engine-content.js';
import {
  NotADemoBase,
  databasePath,
  refuseForeignBase,
  refuseInProduction,
} from '../src/seed/guard.js';
import { ULID_LENGTH, demoCorrelationId, monotonicUlidFactory } from '../src/seed/ids.js';

import type { CampaignId, ClockId, PlayerId } from '@for/engine';
import {
  CLOCK_ADVANCE_MAX,
  CLOCK_ADVANCE_MIN,
  GAME_EVENT_TYPES,
  boxesFilled,
  createInitialCampaignState,
} from '@for/engine';

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
/** A clock identifier for the unit tests below. Never written to a journal. */
const CLOCK_ID = 'clock-de-test' as ClockId;

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const WORKSPACE_ROOT = resolve(PACKAGE_ROOT, '..', '..');

let workspace: string;
let full: string;
let minimal: string;
let fullReport: SeedReport;

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
  fullReport = seedDemoFile(full, { force: true });
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

      // THE WHOLE TURN, NOT A LINE OF IT (03-donnees.md section 3.7): the
      // cancellation names the entire correlation group. Measured from the
      // other side — the `correlation_id` column of the entries it names,
      // then every entry that column covers — so a `targetSeqs` truncated to
      // its last line goes red. It did not, before this assertion existed:
      // `readGroup` returning `rows.slice(-1)` left all 35 tests green.
      const groups = connection
        .prepare(
          `SELECT DISTINCT correlation_id AS correlation FROM events
            WHERE seq IN (${payload.targetSeqs.join(',')})`,
        )
        .all() as { correlation: string }[];
      expect(groups).toHaveLength(1);
      const whole = connection
        .prepare(`SELECT seq FROM events WHERE correlation_id = ? ORDER BY seq`)
        .all(groups[0]?.correlation ?? '') as { seq: number }[];
      expect([...payload.targetSeqs].sort((a, b) => a - b)).toEqual(whole.map((row) => row.seq));

      // And the character the cancelled turn was about is alive.
      const braum = connection
        .prepare(`SELECT status FROM characters WHERE champion_id = 'braum'`)
        .get() as { status: string };
      expect(braum.status).toBe('active');
    });
  });

  it('tient le tour brûlé en UN SEUL groupe de corrélation, des dés aux conséquences', () => {
    // 03-donnees.md sections 0.5 and 3.7, measured on the only burned turn of
    // the demo. A burn is TWO calls to `decide()` and it must stay ONE group:
    // `system.reverted` cancels a group, so a second one would take the dice
    // back without the `character.gauge_changed` they caused, and
    // `buildTurnProof` reads ONE group, so the « Pourquoi ? » proof would show
    // the dice on one side and the consequences on the other.
    //
    // WHAT MAKES IT GO RED. If the closing opened its own group, the array
    // below would stop at `roll.action_resolved` — measured by returning
    // `null` from `Director.#continuedGroup`.
    withBase(full, (connection) => {
      const burned = connection
        .prepare(
          `SELECT correlation_id AS correlation FROM events
            WHERE type = 'character.momentum_burned'`,
        )
        .all() as { correlation: string }[];
      expect(burned).toHaveLength(1);
      const correlation = burned[0]?.correlation ?? '';

      const group = connection
        .prepare(
          `SELECT seq, id, type, causation_id AS causation, payload_json AS payload
             FROM events WHERE correlation_id = ? ORDER BY seq`,
        )
        .all(correlation) as {
        seq: number;
        id: string;
        type: string;
        causation: string | null;
        payload: string;
      }[];

      // The EXACT array, in order: the dice, the revision and the effects of
      // the REVISED outcome, all under one identifier. Two steps, one turn.
      expect(group.map((row) => row.type)).toEqual([
        'move.declared',
        'roll.action_resolved',
        'character.momentum_burned',
        'roll.action_revised',
        'character.momentum_changed',
        'move.resolved',
      ]);

      // The causation chain, entire: everything hangs off the declaration, and
      // the declaration hangs off nothing.
      const declaration = group[0];
      expect(declaration?.causation).toBeNull();
      expect(group.slice(1).map((row) => row.causation)).toEqual(
        group.slice(1).map(() => declaration?.id),
      );

      // A SECOND OPERAND, read the other way round: over the span of the turn,
      // from the declaration to the resolution, the journal knows exactly one
      // correlation identifier. Counting from the sequences rather than from
      // the group catches a foreign entry slipped between the two steps.
      const first = declaration?.seq ?? 0;
      const last = group.at(-1)?.seq ?? 0;
      const spanned = connection
        .prepare(`SELECT count(DISTINCT correlation_id) AS n FROM events WHERE seq BETWEEN ? AND ?`)
        .get(first, last) as { n: number };
      expect(spanned.n).toBe(1);

      // And the proof reads as one: `move.resolved` points at the ROLL, not at
      // the revision, and both are inside the group.
      const resolved = JSON.parse(group.at(-1)?.payload ?? '{}') as { rollSeq: number };
      const revised = JSON.parse(group[3]?.payload ?? '{}') as { revisedFromSeq: number };
      expect(resolved.rollSeq).toBe(group[1]?.seq);
      expect(revised.revisedFromSeq).toBe(group[1]?.seq);
    });
  });

  it('n’écrit aucune projection hors du réducteur', () => {
    // Invariant 4, measured the way control 9 measures it: zone C thrown away,
    // replayed, compared byte for byte. A gauge posted straight into
    // `characters` by the seed would show up here as a divergence.
    //
    // ON A COPY, AND THAT IS A CORRECTION, NOT A PRECAUTION. This test used to
    // rebuild `full` itself, and `passe les douze oracles` runs after it on the
    // same file: control 9 was therefore MADE TRUE by this test a moment before
    // the other one read it. Measured in recette — with an `UPDATE characters`
    // posted after the rebuild, `passe les douze oracles` stayed GREEN under
    // `vitest run tests/seed-deterministic.test.ts`, the command `turbo run
    // test` runs, and only went red when run alone with `-t`. Mode 3 of the
    // battery: a threshold no contractual command reaches.
    const copy = join(workspace, 'rebuild-copy.db');
    copyFileSync(full, copy);
    withBase(copy, (connection) => {
      const id = campaignId(connection);
      const before = dumpProjections(connection, id);
      rebuildCampaign(connection, id);
      expect(dumpProjections(connection, id)).toBe(before);
    });
  });

  it('partage le catalogue en deux : ce que le jeu tranche, ce que le serveur écrit', () => {
    // INVARIANT 1, MEASURED. `director.ts` draws the line between `play()` —
    // anything the rules decide — and `write()` — what the server decides. The
    // line is held by a type (`SERVER_WRITTEN_TYPES`, which stops the probe
    // « authored('roll.action_resolved', …) » from compiling) and by the four
    // assertions below, which hold the type honest.
    //
    // The catalogue is the ENGINE's and its length is the task sheet's 71,
    // spelled out: without it, emptying `GAME_EVENT_TYPES` would make this pass
    // over nothing.
    expect(GAME_EVENT_TYPES).toHaveLength(EXPECTED_TYPES);

    const played = [...fullReport.playedTypes];
    const declared = [...SERVER_WRITTEN_TYPES];

    // 1. Nothing the rules produce may be hand-written. An empty intersection
    //    is what « le moteur décide, l'IA raconte » means in this file.
    expect(declared.filter((type) => played.includes(type))).toEqual([]);

    // 2. The two halves cover the catalogue exactly — so emptying the tuple
    //    leaves 49 types uncovered and this assertion names every one of them.
    expect([...new Set([...played, ...declared])].sort()).toEqual([...GAME_EVENT_TYPES].sort());

    // 3. And the tuple is not a list of wishes: what the RUN authored is what
    //    it declares, member for member. A member nothing writes proves nothing.
    expect(declared.sort()).toEqual([...fullReport.serverWrittenTypes].sort());
  });

  it('n’avance jamais une horloge autrement que le réducteur ne les compte', () => {
    // The three `clock.advanced` of the campaign used to carry `delta`, `from`
    // and `to` TYPED OUT in `script.ts`. Measured in recette: replacing
    // `{ delta: 3, from: 3, to: 6 }` with `{ delta: 3, from: 1, to: 99 }` on a
    // six-segment clock left the 17 tests, `db:seed` and `db:check` at 0 — and
    // the « Pourquoi ? » proof of that turn would have told a player the clock
    // went from 1 to 99. `Director.clockAdvance` now derives the three numbers
    // from the reduced state; this walks the journal and checks it did.
    withBase(full, (connection) => {
      const rows = connection
        .prepare(
          `SELECT seq, type, payload_json FROM events
            WHERE type IN ('clock.created', 'clock.advanced', 'clock.filled') ORDER BY seq`,
        )
        .all() as { seq: number; type: string; payload_json: string }[];

      const segments = new Map<string, number>();
      const filled = new Map<string, number>();
      const advances: { seq: number; from: number; to: number; delta: number }[] = [];

      for (const row of rows) {
        const payload = JSON.parse(row.payload_json) as {
          clockId: string;
          segments?: number;
          delta?: number;
          from?: number;
          to?: number;
        };
        if (row.type === 'clock.created') {
          segments.set(payload.clockId, payload.segments ?? 0);
          filled.set(payload.clockId, 0);
          continue;
        }
        if (row.type === 'clock.filled') {
          filled.set(payload.clockId, segments.get(payload.clockId) ?? 0);
          continue;
        }
        const size = segments.get(payload.clockId);
        const before = filled.get(payload.clockId);
        expect(size, `horloge inconnue au seq ${String(row.seq)}`).toBeDefined();
        expect(before, `horloge jamais créée au seq ${String(row.seq)}`).toBeDefined();
        const delta = payload.delta ?? 0;
        // The ceiling of a single advance is the ENGINE's, not a number here.
        expect(delta, `avance du seq ${String(row.seq)}`).toBeGreaterThanOrEqual(CLOCK_ADVANCE_MIN);
        expect(delta).toBeLessThanOrEqual(CLOCK_ADVANCE_MAX);
        expect(payload.from, `from du seq ${String(row.seq)}`).toBe(before);
        expect(payload.to, `to du seq ${String(row.seq)}`).toBe(
          Math.min((before ?? 0) + delta, size ?? 0),
        );
        filled.set(payload.clockId, payload.to ?? 0);
        advances.push({ seq: row.seq, from: payload.from ?? 0, to: payload.to ?? 0, delta });
      }

      // The fixture has to be able to tell a derived `from` from a hard-coded
      // one: at least two advances, and not all of them starting at zero.
      expect(advances.length).toBeGreaterThan(1);
      expect(new Set(advances.map((advance) => advance.from)).size).toBeGreaterThan(1);
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

  it('clôt le serment dangereux par une réussite, et les dés en sont tirés', () => {
    // 03-donnees.md section 7.1 : « 1 accompli (dangereux), 1 en cours
    // (redoutable), 1 abandonné ». The three words are spelled out here; what
    // the seed arranges is the SCORE (three milestones at `dangereux`, so six
    // complete boxes), never the outcome.
    withBase(full, (connection) => {
      const resolved = connection
        .prepare(
          `SELECT e.seq AS seq, e.payload_json AS payload, t.rank AS rank, t.ticks AS ticks
             FROM events e JOIN progress_tracks t
               ON t.id = json_extract(e.payload_json, '$.trackId')
            WHERE e.type = 'track.resolved'
              AND json_extract(e.payload_json, '$.outcome') = 'fulfilled'`,
        )
        .all() as { seq: number; payload: string; rank: string; ticks: number }[];
      expect(resolved).toHaveLength(1);
      const vow = resolved[0];
      expect(vow?.rank).toBe('dangereux');

      // The rank-to-XP branch of `track.resolved` is exercised by real data:
      // that is what makes this seed usable as a golden-corpus fixture.
      const payload = JSON.parse(vow?.payload ?? '{}') as { xpAwarded: number; rollSeq: number };
      expect(payload.xpAwarded).toBeGreaterThan(0);

      // The roll behind it was DRAWN, not written: it carries its stream and
      // its draw index, and its score is the engine's reading of the ticks.
      const roll = connection
        .prepare(`SELECT payload_json, rng_stream, rng_draw_index FROM events WHERE seq = ?`)
        .get(payload.rollSeq) as {
        payload_json: string;
        rng_stream: string | null;
        rng_draw_index: number | null;
      };
      const rollPayload = JSON.parse(roll.payload_json) as {
        filledBoxes: number;
        challengeDice: [number, number];
      };
      expect(roll.rng_stream).not.toBeNull();
      expect(roll.rng_draw_index).not.toBeNull();
      expect(rollPayload.filledBoxes).toBe(boxesFilled(vow?.ticks ?? 0));
      // A weak hit fulfils too, so the only thing the dice OWE is that the
      // score beat at least one of them — which is what `outcome` already says.
      expect(Math.min(...rollPayload.challengeDice)).toBeLessThan(rollPayload.filledBoxes);

      // The other two lines of section 7.1, on the same fixture.
      const statuses = (
        connection.prepare(`SELECT status FROM progress_tracks`).all() as { status: string }[]
      ).map((row) => row.status);
      expect(statuses).toContain('open');
      expect(statuses).toContain('abandoned');
    });
  });

  it('lie chaque joueur au personnage avec lequel il a fini', () => {
    withBase(full, (connection) => {
      const created = connection
        .prepare(`SELECT payload_json FROM events WHERE type = 'character.created' ORDER BY seq`)
        .all() as { payload_json: string }[];
      const last = new Map<string, string>();
      const counts = new Map<string, number>();
      for (const row of created) {
        const payload = JSON.parse(row.payload_json) as { playerId: string; characterId: string };
        last.set(payload.playerId, payload.characterId);
        counts.set(payload.playerId, (counts.get(payload.playerId) ?? 0) + 1);
      }
      // WITHOUT THIS LINE THE TEST PROVES NOTHING: if every player had made a
      // single character, « the first » and « the last » would be the same row
      // and the bug this replaces would still be here.
      expect(Math.max(...counts.values())).toBeGreaterThan(1);

      const members = connection
        .prepare(`SELECT player_id, character_id FROM campaign_members ORDER BY player_id`)
        .all() as { player_id: string; character_id: string | null }[];
      for (const member of members) {
        expect(member.character_id, `adhésion de ${member.player_id}`).toBe(
          last.get(member.player_id) ?? null,
        );
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

/**
 * `guard.ts` was at 0 % OF LINES on the coverage report, and `refuseForeignBase`
 * had no test at all — the recette had to check by hand that it bites. That is
 * the file this block covers, and reading it is what turned up the two defects
 * corrected with it: an unopenable file walked its exception out of the guard,
 * and `pnpm db:seed` without `--force` never called it.
 */
describe('la garde de base étrangère', () => {
  /** A base seeded, then re-owned by somebody who is not a demo player. */
  function foreignBase(name: string): string {
    const target = join(workspace, name);
    seedDemoFile(target, { force: true, minimal: true });
    withBase(target, (connection) => {
      connection.prepare(`UPDATE players SET discord_username = 'vrai-joueur'`).run();
    });
    return target;
  }

  it('laisse passer une base de démonstration', () => {
    expect(() => {
      refuseForeignBase(minimal);
    }).not.toThrow();
  });

  it('refuse une base dont le propriétaire n’est pas un joueur de démonstration', () => {
    const target = foreignBase('etrangere.db');
    expect(() => {
      refuseForeignBase(target);
    }).toThrow(NotADemoBase);
  });

  it('laisse passer un fichier absent, un fichier vide, et un fichier qui n’est pas une base', () => {
    // The comment on `refuseForeignBase` promised exactly this, and until now
    // nothing held it: `openSqlite` threw and the exception walked out, so
    // `pnpm db:reset` on a `DATABASE_PATH` pointing at a text file exited 1
    // with a `SqliteError` instead of resetting a file that is not a base.
    const absent = join(workspace, 'jamais-creee.db');
    const garbage = join(workspace, 'pas-une-base.db');
    writeFileSync(garbage, 'ceci n’est pas une base SQLite\n');
    const bare = join(workspace, 'vide.db');
    withBase(bare, (connection) => {
      connection.exec(`CREATE TABLE rien (x INTEGER)`);
    });

    for (const target of [absent, garbage, bare]) {
      expect(() => {
        refuseForeignBase(target);
      }).not.toThrow();
    }
  });

  it(
    'fait sortir « pnpm db:seed » en 1 SANS --force, sans rien écrire',
    () => {
      // THE COMMAND, not the function. Without `--force` nothing is deleted —
      // but the demo campaign would be APPENDED to somebody's real journal,
      // which is append-only and has no undo. The guard used to run under
      // `--force` only.
      const target = foreignBase('etrangere-commande.db');
      const before = sha256(target);
      expect(runCommand('db:seed', [], target)).toBe(REFUSED_EXIT_CODE);
      expect(sha256(target)).toBe(before);
      expect(runCommand('db:seed', ['--force'], target)).toBe(REFUSED_EXIT_CODE);
      expect(sha256(target)).toBe(before);
    },
    SUBPROCESS_TIMEOUT_MS,
  );
});

describe('les deux refus, en appel direct', () => {
  it('ne refuse que sous NODE_ENV=production, et nomme la commande', () => {
    const before = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'production';
      expect(() => {
        refuseInProduction('db:reset');
      }).toThrow(/db:reset/);
      process.env['NODE_ENV'] = 'development';
      expect(() => {
        refuseInProduction('db:reset');
      }).not.toThrow();
    } finally {
      if (before === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = before;
    }
  });

  it('lit DATABASE_PATH, et retombe sur le défaut de la section 6.1', () => {
    const before = process.env['DATABASE_PATH'];
    try {
      process.env['DATABASE_PATH'] = '/tmp/une-base-a-moi.db';
      expect(databasePath()).toBe('/tmp/une-base-a-moi.db');
      delete process.env['DATABASE_PATH'];
      expect(databasePath()).toBe('./data/app.db');
    } finally {
      if (before === undefined) delete process.env['DATABASE_PATH'];
      else process.env['DATABASE_PATH'] = before;
    }
  });
});

describe('l’avance d’horloge, hors de tout journal', () => {
  /** A director over a state that holds one six-segment clock at three. */
  function directorWithClock(filled: number): Director {
    const campaignId = 'c-horloge' as CampaignId;
    const ownerPlayerId = 'p-horloge' as PlayerId;
    const base = createInitialCampaignState({
      campaignId,
      ownerPlayerId,
      seed: DEMO_SEED.rngSeed,
      contentPackHash: 'hash',
    });
    return new Director({
      // `clockAdvance` reads the state and nothing else; no row is written.
      connection: undefined as unknown as SqliteConnection,
      campaignId,
      ownerPlayerId,
      seed: DEMO_SEED.rngSeed,
      content: demoContent().engine,
      ids: monotonicUlidFactory(DEMO_SEED.ulidSeed),
      epoch: DEMO_SEED.epoch,
      step: 1,
      initialState: {
        ...base,
        clocks: {
          [CLOCK_ID]: {
            id: CLOCK_ID,
            title: 'La neige tient le col',
            description: '',
            segments: 6,
            filled,
            status: 'ticking',
            visibility: 'public',
            consequence: '',
            createdSeq: 1,
            updatedSeq: 1,
          },
        },
      },
      stopAt: null,
    });
  }

  it('plafonne aux segments plutôt que de les dépasser', () => {
    // Two starting points, chosen so a hard-coded `from: 0` or a `to` that
    // forgot its ceiling would fail on one of them.
    expect(directorWithClock(0).clockAdvance(CLOCK_ID, 3, 'gm:proposal').payload).toEqual({
      clockId: CLOCK_ID,
      delta: 3,
      from: 0,
      to: 3,
      cause: 'gm:proposal',
    });
    expect(directorWithClock(5).clockAdvance(CLOCK_ID, 3, 'gm:proposal').payload).toEqual({
      clockId: CLOCK_ID,
      delta: 3,
      from: 5,
      to: 6,
      cause: 'gm:proposal',
    });
  });

  it('refuse une avance hors du plafond du moteur, et une horloge inconnue', () => {
    const director = directorWithClock(0);
    for (const delta of [CLOCK_ADVANCE_MIN - 1, CLOCK_ADVANCE_MAX + 1, 1.5]) {
      expect(() => director.clockAdvance(CLOCK_ID, delta, 'gm:proposal')).toThrow(
        DemoScriptInconsistent,
      );
    }
    expect(() => director.clockAdvance('pas-une-horloge' as ClockId, 1, 'gm:proposal')).toThrow(
      DemoScriptInconsistent,
    );
  });
});

describe('les deux fabriques d’identifiants', () => {
  it('rend la graine, puis la graine incrémentée, en retenant sa retenue', () => {
    // Two calls are not enough to see a carry: the seed below ends in `Z`, the
    // last letter of Crockford base32, so the second increment has to carry.
    const factory = monotonicUlidFactory('01JQ000000000000000000000Z');
    const handed = [factory.next(), factory.next(), factory.next()];
    expect(handed).toEqual([
      '01JQ000000000000000000000Z',
      '01JQ0000000000000000000010',
      '01JQ0000000000000000000011',
    ]);
  });

  it('refuse une graine de mauvaise longueur, un caractère hors base 32, un débordement', () => {
    expect(() => monotonicUlidFactory('trop-court')).toThrow(RangeError);
    const outside = monotonicUlidFactory('01JQ00000000000000000000IL');
    outside.next();
    expect(() => outside.next()).toThrow(RangeError);
    const full = monotonicUlidFactory('Z'.repeat(ULID_LENGTH));
    expect(full.next()).toBe('Z'.repeat(ULID_LENGTH));
    expect(() => full.next()).toThrow(RangeError);
  });

  it('rend un UUID de version 4 qui ne dépend que du compteur', () => {
    expect(demoCorrelationId(0)).toBe('00000000-0000-4000-8000-000000000000');
    expect(demoCorrelationId(255)).toBe('00000000-0000-4000-8000-0000000000ff');
    expect(demoCorrelationId(7)).toBe(demoCorrelationId(7));
    expect(demoCorrelationId(7)).not.toBe(demoCorrelationId(8));
    expect(() => demoCorrelationId(-1)).toThrow(RangeError);
    expect(() => demoCorrelationId(1.5)).toThrow(RangeError);
    expect(() => demoCorrelationId(16 ** 12)).toThrow(RangeError);
  });
});

describe('le pack de contenu précédent', () => {
  it('recule d’un patch, d’un mineur, puis d’un majeur', () => {
    expect(previousPackVersion('1.2.3')).toBe('1.2.2');
    expect(previousPackVersion('1.2.0')).toBe('1.1.9');
    expect(previousPackVersion('1.0.0')).toBe('0.9.9');
    expect(previousPackVersion('0.0.0')).toBe('0.9.9');
  });

  it('refuse une fiche de champion que le bundle ne porte pas', () => {
    expect(() => demoContent().championSheet('pas-un-champion')).toThrow(DemoContentIncomplete);
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
