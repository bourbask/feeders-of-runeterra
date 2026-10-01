/**
 * LA MONTÉE EN WEBSOCKET, SUR UN VRAI PORT — la couture que M0-25 avait
 * nommée et laissée ouverte.
 *
 * Son `index.ts` écrivait, en capitales : « `wsPlugin` STILL REGISTERS NO
 * ROUTE […] `attachSocket` is the seam that task will call ». Tout le reste
 * de `tests/ws/**` pilote `attachSocket` par une paire de sockets en mémoire,
 * ce qui est exactement ce que la fiche de M0-25 demandait — et ce qui ne dit
 * rien de la montée HTTP elle-même.
 *
 * ── CE QUI EST VRAI ICI, ET C'EST PRESQUE TOUT ───────────────────────────
 * Une base SQLite sur un vrai fichier, migrée ; `buildApp` au complet, donc
 * les cinq greffons dans l'ordre d'`app.ts` ; un port qui écoute ; une session
 * posée par `createSession`, lue par le cookie ; et un client WebSocket réel —
 * celui de Node, qui existe en global depuis la 22.4 et accepte un en-tête,
 * donc sans dépendance de test à ajouter. Rien n'est simulé.
 *
 * ── CE QUE LA SONDE DE FUMÉE AJOUTE ──────────────────────────────────────
 * `scripts/smoke-m0.sh` refait ce parcours depuis un dépôt propre, sur le
 * seed de démonstration, et y ajoute l'aller-retour `c2s.why` →
 * `s2c.turn_proof`. Les deux mesurent la même couture ; celle-ci tourne à
 * chaque `pnpm test`, celle-là une fois par recette.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { staticContent } from '@for/content';
import { SESSION_COOKIE_NAME } from '@for/contracts';
import {
  addMember,
  appendEvents,
  createDb,
  insertCampaign,
  migrateConnection,
  upsertPlayer,
  writeProjectionsFrom,
} from '@for/db';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { createSession } from '../../src/auth/session.js';
import { envVars } from '../../src/auth/testing.js';
import { campaignRng, createUlidFactory, systemClock } from '../../src/deps.js';
import { readEnv } from '../../src/env.js';
import { loadReplay } from '../../src/game/snapshots.js';
import { createLogger } from '../../src/logger.js';
import { createCampaignAccess } from '../../src/ws/index.js';

import type { AppendableEvent } from '@for/db';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../src/deps.js';

const EPOCH = 1_700_000_000_000;
const CAMPAIGN = '0000000000000000000000CAMP';
const PLAYER = '0000000000000000000000PYRA';
const STRANGER = '0000000000000000000000PYRZ';
const CHARACTER = '0000000000000000000000CHRA';

/** Les trois trames que le critère de M0-30 exige à l'ouverture. */
const EXPECTED_AT_OPEN = ['s2c.welcome', 's2c.snapshot', 's2c.presence'];

interface Bed {
  readonly app: FastifyInstance;
  readonly deps: AppDeps;
  readonly port: number;
  readonly secret: string;
  close(): Promise<void>;
}

let beds: Bed[] = [];

afterEach(async () => {
  const open = beds;
  beds = [];
  for (const bed of open) await bed.close();
});

function bootstrap(id: number, type: string, payload: unknown): AppendableEvent {
  return {
    id: `0000000000000000000${String(1_000_000 + id)}`,
    type,
    payload,
    payloadVersion: 1,
    actorKind: 'system',
    actorPlayerId: null,
    subjectCharacterId: null,
    correlationId: null,
    causationId: null,
    rngStream: null,
    rngDrawIndex: null,
    scope: 'table',
    recipients: null,
    createdAt: EPOCH,
  };
}

/** Une application complète, une table, un joueur, une session. */
async function aLiveTable(): Promise<Bed> {
  const folder = mkdtempSync(join(tmpdir(), 'for-m030-ws-'));
  const path = join(folder, 'app.db');
  const { connection, db } = createDb(path);
  migrateConnection(connection);

  for (const [playerId, name] of [
    [PLAYER, 'Joueuse'],
    [STRANGER, 'Étrangère'],
  ] as const) {
    upsertPlayer(connection, {
      id: playerId,
      discordUserId: `discord-${playerId}`,
      discordUsername: name,
      createdAt: EPOCH,
    });
  }

  insertCampaign(connection, {
    id: CAMPAIGN,
    slug: 'la-table',
    name: 'La table',
    ownerPlayerId: PLAYER,
    contentPackVersion: '1.0.0',
    contentPackHash: 'hash',
    rulesVersion: 1,
    reducerVersion: 1,
    rngSeed: 'graine',
    createdAt: EPOCH,
    status: 'active',
  });
  addMember(connection, {
    id: `${PLAYER}-member`,
    campaignId: CAMPAIGN,
    playerId: PLAYER,
    joinedAt: EPOCH,
  });

  appendEvents(connection, {
    campaignId: CAMPAIGN,
    now: EPOCH,
    events: [
      bootstrap(1, 'campaign.created', {
        name: 'La table',
        slug: 'la-table',
        pitch: '',
        ownerPlayerId: PLAYER,
        contentPackVersion: '1.0.0',
        contentPackHash: 'hash',
        rulesVersion: 1,
        rngSeed: 'graine',
      }),
      bootstrap(2, 'campaign.status_changed', { from: 'draft', to: 'active' }),
      bootstrap(3, 'party.member_joined', {
        playerId: PLAYER,
        role: 'player',
        displayName: 'Joueuse',
      }),
      {
        ...bootstrap(4, 'character.created', {
          characterId: CHARACTER,
          playerId: PLAYER,
          championId: 'ashe',
          displayName: 'Ashe',
          sheetSource: 'handwritten',
          sheetRef: 'ashe',
          sheetSnapshot: {},
          attributes: { vif: 1, coeur: 2, fer: 2, ombre: 2, esprit: 3 },
          gauges: { vigueur: 5, ame: 5, vivres: 5 },
          momentum: 2,
        }),
        subjectCharacterId: CHARACTER,
      },
    ],
  });
  writeProjectionsFrom(connection, CAMPAIGN, loadReplay(connection, CAMPAIGN));

  const deps: AppDeps = {
    env: readEnv(envVars({ DATABASE_PATH: path })),
    logger: createLogger({ level: 'fatal', nodeEnv: 'test' }),
    connection,
    db,
    content: staticContent(),
    clock: systemClock,
    rng: campaignRng,
    ids: createUlidFactory(systemClock),
    startedAt: EPOCH,
  };

  const app = await buildApp(deps);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('pas de port');

  const session = createSession(connection, { playerId: PLAYER, now: Date.now() });

  const bed: Bed = {
    app,
    deps,
    port: address.port,
    secret: session.secret,
    close: async () => {
      await app.close();
      connection.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
  beds.push(bed);
  return bed;
}

interface Tape {
  readonly frames: { t: string; p: Record<string, unknown> }[];
  readonly closes: { code: number }[];
  send(frame: unknown): void;
  /** L'ÉVÉNEMENT `open`, jamais un délai. Voir l'en-tête de `connect`. */
  waitOpen(timeoutMs?: number): Promise<number>;
  waitFor(type: string, timeoutMs?: number): Promise<Record<string, unknown>>;
  waitClosed(timeoutMs?: number): Promise<number>;
  close(): void;
}

/**
 * Un vrai client WebSocket, avec son cookie de session s'il en a un.
 *
 * ── ON ATTEND `open`, PAS UNE DURÉE ──────────────────────────────────────
 * Les deux tests qui envoient une trame attendaient 50 ms en dur avant leur
 * premier `send`. Mesuré par la recette, arbre propre, `--force` :
 * `pnpm turbo run test --force` lance onze vitest en parallèle et échouait
 * **3 fois sur 6** en `InvalidStateError: Sent before connected`, là où le
 * fichier seul passait 15 fois sur 15. Un délai n'est pas une attente : il
 * mesure la charge de la machine, pas l'état de la socket.
 *
 * `waitOpen()` lit l'événement `open` — exactement ce que
 * `scripts/smoke-client.ts` fait déjà. Et il se termine aussi quand la socket
 * se FERME avant de s'ouvrir, pour que l'échec nomme la fermeture au lieu
 * d'attendre quatre secondes pour rien.
 */
function connect(bed: Bed, options: { cookie?: string; campaignId?: string | null }): Tape {
  const query = options.campaignId === null ? '' : `?campaignId=${options.campaignId ?? CAMPAIGN}`;
  // LE CLIENT DE NODE ACCEPTE UN EN-TÊTE, et c'est ce qui évite une
  // dépendance de test : l'option n'est pas dans la signature WHATWG, elle est
  // dans celle d'undici, d'où le passage par `unknown`.
  const open = WebSocket as unknown as new (url: string, options: unknown) => WebSocket;
  const socket = new open(`ws://127.0.0.1:${String(bed.port)}/ws${query}`, {
    ...(options.cookie === undefined
      ? {}
      : { headers: { cookie: `${SESSION_COOKIE_NAME}=${options.cookie}` } }),
  });

  const frames: { t: string; p: Record<string, unknown> }[] = [];
  const closes: { code: number }[] = [];
  let openedAt: number | null = null;
  socket.addEventListener('open', () => {
    openedAt = Date.now();
  });
  socket.addEventListener('message', (event) => {
    frames.push(JSON.parse(String(event.data)) as { t: string; p: Record<string, unknown> });
  });
  socket.addEventListener('close', (event) => {
    closes.push({ code: event.code });
  });

  const poll = async <T>(read: () => T | null, timeoutMs: number, what: string): Promise<T> => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const found = read();
      if (found !== null) return found;
      if (Date.now() > until) throw new Error(`rien n’est arrivé : ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  return {
    frames,
    closes,
    send: (frame: unknown) => {
      socket.send(JSON.stringify(frame));
    },
    waitOpen: (timeoutMs = 4000) =>
      poll(
        () => {
          const closed = closes[0];
          if (closed !== undefined) {
            throw new Error(`socket fermée en ${String(closed.code)} avant son ouverture`);
          }
          return openedAt;
        },
        timeoutMs,
        'l’ouverture de la socket',
      ),
    waitFor: (type: string, timeoutMs = 4000) =>
      poll(() => frames.find((frame) => frame.t === type)?.p ?? null, timeoutMs, type),
    waitClosed: (timeoutMs = 4000) =>
      poll(() => closes[0]?.code ?? null, timeoutMs, 'une fermeture'),
    close: () => {
      socket.close();
    },
  };
}

describe('la montée en WebSocket', () => {
  it('l’accès lit la base : inconnue, interdite, ouverte', async () => {
    const bed = await aLiveTable();
    const access = createCampaignAccess(bed.deps.connection);

    expect(await access.check('0000000000000000000000NOPE', PLAYER)).toBe('not_found');
    expect(await access.check(CAMPAIGN, STRANGER)).toBe('forbidden');
    expect(await access.check(CAMPAIGN, PLAYER)).toBe('ok');
  });

  it('une socket authentifiée reçoit `s2c.welcome`, `s2c.snapshot` et `s2c.presence`', async () => {
    const bed = await aLiveTable();
    const tape = connect(bed, { cookie: bed.secret });

    await tape.waitOpen();
    tape.send({
      v: 1,
      t: 'c2s.hello',
      id: '11111111-1111-4111-8111-111111111111',
      p: { clientVersion: 'test/0.0.0', lastDeliverySeq: null },
    });

    const welcome = await tape.waitFor('s2c.welcome');
    expect(welcome['campaignId']).toBe(CAMPAIGN);
    expect(welcome['playerId']).toBe(PLAYER);
    // SON personnage, et pas celui du voisin.
    expect((welcome['you'] as { characterId: string }).characterId).toBe(CHARACTER);

    await tape.waitFor('s2c.snapshot');
    await tape.waitFor('s2c.presence');

    // LES TROIS, dans l'ordre que le protocole déclare.
    expect(tape.frames.map((frame) => frame.t)).toStrictEqual(EXPECTED_AT_OPEN);
    tape.close();
  });

  it('une socket sans session est fermée en 4002', async () => {
    const bed = await aLiveTable();
    const tape = connect(bed, {});
    expect(await tape.waitClosed()).toBe(4002);
  });

  it('une socket sans `?campaignId=` est fermée en 4004', async () => {
    const bed = await aLiveTable();
    const tape = connect(bed, { cookie: bed.secret, campaignId: null });
    expect(await tape.waitClosed()).toBe(4004);
  });

  it('une campagne dont le joueur n’est pas membre est fermée en 4003', async () => {
    const bed = await aLiveTable();
    const stranger = createSession(bed.deps.connection, { playerId: STRANGER, now: Date.now() });
    const tape = connect(bed, { cookie: stranger.secret });
    expect(await tape.waitClosed()).toBe(4003);
  });

  it('le départ du transport vide la salle', async () => {
    const bed = await aLiveTable();
    const tape = connect(bed, { cookie: bed.secret });
    await tape.waitOpen();
    tape.send({
      v: 1,
      t: 'c2s.hello',
      id: '22222222-2222-4222-8222-222222222222',
      p: { clientVersion: 'test/0.0.0', lastDeliverySeq: null },
    });
    await tape.waitFor('s2c.presence');

    const hub = bed.app.tableHub;
    expect(hub?.connectionsOf(CAMPAIGN as never)).toHaveLength(1);

    tape.close();
    const until = Date.now() + 4000;
    while (hub?.connectionsOf(CAMPAIGN as never).length !== 0 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(hub?.connectionsOf(CAMPAIGN as never)).toHaveLength(0);
  });
});
