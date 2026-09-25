/**
 * The fixtures every `tests/game` file runs on: a real SQLite file, a real
 * migration, a real content bundle, and the three deterministic substitutes —
 * clock, identifiers, dice.
 *
 * WHY THIS FIXTURE MODULE IS ITSELF A `.test.ts`. The flat ESLint config
 * attaches a TypeScript program to `**\/*.test.ts` and to nothing else under
 * `tests/`, so a plain `.ts` helper there is reported as "not found by the
 * project service". `@for/engine` already carries its fixtures this way
 * (`tests/support/engine-content.test.ts`), for the same reason and with the
 * same answer: the module pays for its place by self-checking. A fixture that
 * has quietly stopped covering what the suite assumes is a green suite
 * measuring nothing.
 *
 * NOTHING HERE IS A FAKE DATABASE. The tests open a file, run the real
 * migrations, and write through the real repositories, because most of what
 * this task must prove is about the journal, the triggers and the
 * projections — and a fake would prove it about the fake.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { staticContent } from '@for/content';
import {
  addMember,
  appendEvents,
  insertCampaign,
  migrateConnection,
  openSqlite,
  upsertPlayer,
  writeProjectionsFrom,
} from '@for/db';
import { describe, expect, it } from 'vitest';

import { buildNarrator } from '../../src/ai/narrator.js';
import { readEnv } from '../../src/env.js';
import { toEngineContent } from '../../src/game/content.js';
import { loadReplay } from '../../src/game/snapshots.js';

import type { NarrateEvent, NarratorPort } from '@for/contracts';
import type { AppendableEvent, SqliteConnection } from '@for/db';
import type {
  CampaignId,
  CharacterId,
  FallbackTemplates,
  IdFactory,
  PlayerId,
  Rng,
  RngStream,
  TracingRng,
} from '@for/engine';
import type { RngSource, TimeSource } from '../../src/deps.js';
import type { GameDeps } from '../../src/game/intent-pipeline.js';

// -------------------------------------------------------------- identifiers

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A ULID factory that counts.
 *
 * NOT `createUlidFactory` with pinned random bytes: two identifiers minted in
 * the same millisecond would then be EQUAL, and `events.id` is a primary key —
 * a turn of four entries would abort on the second. Counting is what makes
 * them unique AND reproducible, which is the pair every test here needs.
 *
 * The first symbol is forced into `[0-7]`, which `ULID_PATTERN` requires.
 */
export function counterUlids(start = 1): IdFactory & { count(): number } {
  let n = start;
  return {
    next: () => {
      const value = n;
      n += 1;
      let out = '';
      let rest = value;
      for (let i = 0; i < 25; i += 1) {
        out = CROCKFORD.charAt(rest % 32) + out;
        rest = Math.floor(rest / 32);
      }
      return `0${out}`;
    },
    count: () => n - start,
  };
}

/** A UUID that counts, for the intent identifiers `zCorrelationId` demands. */
export function uuidAt(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

// -------------------------------------------------------------------- dice

export interface ScriptedSource extends RngSource {
  /** Queues values on one stream. Consumed in order by every draw. */
  script(stream: RngStream, values: readonly number[]): void;
  /** What is left unconsumed on a stream. `0` after a turn that spent it all. */
  left(stream: RngStream): number;
}

/**
 * A generator that reads from a script and FAILS WHEN THE SCRIPT RUNS OUT.
 *
 * Failing is the point, and it is what makes "la revision ne tire rien"
 * measurable: a closing turn runs with nothing queued, so a single draw
 * anywhere in it raises instead of quietly producing a number.
 */
export class ScriptExhausted extends Error {
  constructor(stream: string) {
    super(`script épuisé sur le flux ${stream}`);
    this.name = 'ScriptExhausted';
  }
}

export function scriptedSource(): ScriptedSource {
  const queues = new Map<RngStream, number[]>();
  const take = (stream: RngStream): number => {
    const queue = queues.get(stream);
    const value = queue?.shift();
    if (value !== undefined) return value;
    // `fallback` CHOOSES A SENTENCE, it decides nothing about the game
    // (03-donnees.md section 3.6 lists it apart, "choix du gabarit de
    // narration de repli"). Making every test queue a value for it would put
    // noise in every script and hide the draws that do matter, so it answers
    // 1 — deterministically, which is all the stream promises. Any stream that
    // touches the fiction still fails loudly.
    if (stream === 'fallback') return 1;
    throw new ScriptExhausted(stream);
  };
  const rngFor = (stream: RngStream): TracingRng => {
    const trace: { sides: number; value: number }[] = [];
    const rng: Rng = {
      roll: (sides) => {
        const value = take(stream);
        trace.push({ sides, value });
        return value;
      },
    };
    return { roll: rng.roll.bind(rng), trace: () => trace };
  };
  return {
    forCampaign: (_seed, _seq, stream) => rngFor(stream),
    script: (stream, values) => {
      queues.set(stream, [...(queues.get(stream) ?? []), ...values]);
    },
    left: (stream) => queues.get(stream)?.length ?? 0,
  };
}

/**
 * A `narrer` that answers ONE `end` event and records that it was called.
 *
 * Hand-written rather than `async function*`, for the reason `narrator.ts`
 * gives: a port that opens no socket has nothing to await, and an `async`
 * generator with no `await` is a claim the lint refuses.
 */
export function spyNarrator(base: NarratorPort, onCall: () => void): NarratorPort {
  return {
    ...base,
    narrer: () => {
      onCall();
      const items: NarrateEvent[] = [
        {
          type: 'end',
          result: {
            text: '',
            finish: 'complete',
            toolCalls: [],
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            providerModel: 'stub',
            latencyMs: 0,
          },
        },
      ];
      return {
        [Symbol.asyncIterator]: () => {
          const iterator = items[Symbol.iterator]();
          return { next: () => Promise.resolve(iterator.next()) };
        },
      };
    },
  };
}

// ---------------------------------------------------------------- the table

export const CAMPAIGN_ID = '0000000000000000000000CAMP' as CampaignId;
export const PLAYER_ID = '0000000000000000000000PYRA' as PlayerId;
export const OTHER_PLAYER_ID = '0000000000000000000000PYRB' as PlayerId;
export const CHARACTER_ID = '0000000000000000000000CHRA' as CharacterId;
export const OTHER_CHARACTER_ID = '0000000000000000000000CHRB' as CharacterId;

export interface Table {
  readonly connection: SqliteConnection;
  readonly deps: GameDeps;
  readonly rng: ScriptedSource;
  readonly ids: IdFactory & { count(): number };
  readonly clock: TimeSource;
  close(): void;
}

const EPOCH = 1_700_000_000_000;

function envVars(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '8787',
    PUBLIC_URL: 'http://localhost:5173',
    LOG_LEVEL: 'fatal',
    DATABASE_PATH: join(tmpdir(), 'for-game-test.db'),
    SESSION_SECRET: 'a'.repeat(32),
    DISCORD_CLIENT_ID: 'client-id',
    DISCORD_CLIENT_SECRET: 'client-secret',
    DISCORD_REDIRECT_URI: 'http://localhost:8787/api/auth/discord/callback',
    NARRATOR_PROVIDER: 'stub',
  };
}

/** `content/fallbacks/narration.json`, read the way the plugin reads it. */
export function fallbacks(): FallbackTemplates {
  return {
    templates: {
      'face-danger': {
        franche: ['Ça passe.'],
        partielle: ['Ça passe, mal.'],
        echec: ['Ça ne passe pas.'],
      },
      default: { franche: ['Rien à dire.'] },
    },
  };
}

/**
 * A migrated database holding ONE active campaign, one player, one character
 * with nine momentum, and nothing else.
 *
 * Nine is not decoration: `burnWindow` is true only while the momentum beats
 * the score (`canBurnMomentum`), so a character with the default two could
 * never open the window the burn tests are about.
 */
export function aTable(options: { readonly momentum?: number } = {}): Table {
  const dir = mkdtempSync(join(tmpdir(), 'for-m024-'));
  const connection = openSqlite(join(dir, 'test.db'));
  migrateConnection(connection);

  // ORDER IS A FOREIGN KEY, not a preference: `campaigns.owner_player_id`
  // points at `players`, and `campaign_members` points at both.
  for (const [playerId, name] of [
    [PLAYER_ID, 'Joueuse'],
    [OTHER_PLAYER_ID, 'Joueur'],
  ] as const) {
    upsertPlayer(connection, {
      id: playerId,
      discordUserId: `discord-${playerId}`,
      discordUsername: name,
      createdAt: EPOCH,
    });
  }

  insertCampaign(connection, {
    id: CAMPAIGN_ID,
    slug: 'la-table',
    name: 'La table',
    ownerPlayerId: PLAYER_ID,
    contentPackVersion: '1.0.0',
    contentPackHash: 'hash',
    rulesVersion: 1,
    reducerVersion: 1,
    rngSeed: 'graine',
    createdAt: EPOCH,
    status: 'active',
  });

  for (const playerId of [PLAYER_ID, OTHER_PLAYER_ID]) {
    addMember(connection, {
      id: `${playerId}-member`,
      campaignId: CAMPAIGN_ID,
      playerId,
      joinedAt: EPOCH,
    });
  }

  const bootstrap = counterUlids(1_000_000);
  const envelope = (
    type: string,
    payload: unknown,
    subject: string | null = null,
  ): AppendableEvent => ({
    id: bootstrap.next(),
    type,
    payload,
    payloadVersion: 1,
    actorKind: 'system',
    actorPlayerId: null,
    subjectCharacterId: subject,
    correlationId: uuidAt(0),
    causationId: null,
    rngStream: null,
    rngDrawIndex: null,
    scope: 'table',
    recipients: null,
    createdAt: EPOCH,
  });

  // ONE CHAMPION PER CHARACTER: `campaign_champion_locks` and the unique
  // index on (campaign_id, champion_id) are the distribution lock of
  // ARCHITECTURE.md section 4.4, and two characters on `ashe` would violate it.
  const sheet = (
    characterId: CharacterId,
    playerId: PlayerId,
    name: string,
    championId: string,
  ): AppendableEvent =>
    envelope(
      'character.created',
      {
        characterId,
        playerId,
        championId,
        displayName: name,
        sheetSource: 'handwritten',
        sheetRef: championId,
        sheetSnapshot: {},
        attributes: { vif: 1, coeur: 2, fer: 2, ombre: 2, esprit: 3 },
        gauges: { vigueur: 5, ame: 5, vivres: 5 },
        momentum: options.momentum ?? 9,
      },
      characterId,
    );

  appendEvents(connection, {
    campaignId: CAMPAIGN_ID,
    now: EPOCH,
    events: [
      envelope('campaign.created', {
        name: 'La table',
        slug: 'la-table',
        pitch: '',
        ownerPlayerId: PLAYER_ID,
        contentPackVersion: '1.0.0',
        contentPackHash: 'hash',
        rulesVersion: 1,
        rngSeed: 'graine',
      }),
      envelope('campaign.status_changed', { from: 'draft', to: 'active' }),
      // LA TABLE, pas seulement la base : `requireActor` refuse `not_a_member`
      // tant que `party.memberPlayerIds` ne porte pas le joueur, et cet état
      // vient du journal, jamais de `campaign_members`.
      envelope('party.member_joined', {
        playerId: PLAYER_ID,
        role: 'player',
        displayName: 'Joueuse',
      }),
      envelope('party.member_joined', {
        playerId: OTHER_PLAYER_ID,
        role: 'player',
        displayName: 'Joueur',
      }),
      sheet(CHARACTER_ID, PLAYER_ID, 'Ashe', 'ashe'),
      sheet(OTHER_CHARACTER_ID, OTHER_PLAYER_ID, 'Braum', 'braum'),
    ],
  });
  writeProjectionsFrom(connection, CAMPAIGN_ID, loadReplay(connection, CAMPAIGN_ID));

  const rng = scriptedSource();
  const ids = counterUlids();
  const clock: TimeSource = { now: () => EPOCH };
  const deps: GameDeps = {
    connection,
    content: toEngineContent(staticContent()),
    fallbacks: fallbacks(),
    clock,
    rng,
    ids,
    narrator: buildNarrator(readEnv(envVars())),
  };

  return {
    connection,
    deps,
    rng,
    ids,
    clock,
    close: () => {
      connection.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Every entry of the campaign, oldest first. */
export function journal(connection: SqliteConnection): readonly { type: string; seq: number }[] {
  return connection
    .prepare(`SELECT seq, type FROM events WHERE campaign_id = ? ORDER BY seq`)
    .all(CAMPAIGN_ID) as { type: string; seq: number }[];
}

// --------------------------------------------------------------- self-check

describe('les fixtures de tests/game', () => {
  it('monte une campagne active, dense, avec deux personnages', () => {
    const table = aTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect(state.status).toBe('active');
      expect(Object.keys(state.characters).sort()).toEqual(
        [CHARACTER_ID, OTHER_CHARACTER_ID].sort(),
      );
      expect(state.characters[CHARACTER_ID]?.momentum).toBe(9);
      expect(journal(table.connection).map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    } finally {
      table.close();
    }
  });

  it('épuise son script au lieu de dériver un dé', () => {
    const source = scriptedSource();
    source.script('action', [4]);
    const rng = source.forCampaign('graine', 1, 'action');
    expect(rng.roll(6)).toBe(4);
    expect(() => rng.roll(6)).toThrow(ScriptExhausted);
  });

  it('mint des identifiants distincts, tous des ULID', () => {
    const ids = counterUlids();
    const minted = [ids.next(), ids.next(), ids.next()];
    expect(new Set(minted).size).toBe(3);
    for (const id of minted) expect(id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  });
});
