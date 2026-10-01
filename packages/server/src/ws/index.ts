/**
 * The WebSocket module: what `app.ts` registers, and what binds a transport
 * to the hub.
 *
 * ══ WHAT IS HERE, AND WHAT IS DELIBERATELY NOT ════════════════════════════
 *
 * `createTableHub` and `attachSocket` are complete: a socket handed to
 * `attachSocket` is authorised, framed, rate-limited, heartbeated and
 * addressed exactly as the protocol says. `tests/ws/**` drives them through
 * in-memory socket pairs, which is what the task sheet asks for, and each of
 * those five words has its test:
 *
 *   - authorised   `handshake.test.ts`, « ferme en 4002 une connexion sans
 *                  session valide », and the three other codes beside it;
 *   - framed       `outgoing.test.ts`, « jette sur une trame que le serveur
 *                  aurait mal construite, et n'écrit rien »;
 *   - rate-limited `limits.test.ts`, « accepte cinq `c2s.intent` en 10 s et
 *                  refuse le sixième »;
 *   - heartbeated  `limits.test.ts`, « envoie un `s2c.ping` toutes les 25 s —
 *                  une CADENCE, donc quatre tics »;
 *   - addressed    `addressed-broadcast.test.ts`, « un événement `private` ne
 *                  quitte jamais le serveur vers un non-destinataire ».
 *
 * `wsPlugin` STILL REGISTERS NO ROUTE, and that is a reported gap rather than
 * an oversight. The HTTP upgrade needs `@fastify/websocket`, which is not a
 * dependency of `@for/server`; adding it means editing
 * `packages/server/package.json` and `pnpm-lock.yaml`, neither of which is in
 * M0-25's file list — and both of which M0-23 and M0-24 are holding open in
 * the same wave. `attachSocket` is the seam that task will call: it takes a
 * `WsSocket` (two methods) and a `HandshakeRequest` (a session and a query
 * parameter), so binding it is a dozen lines with no decisions left in them.
 *
 * BOTH HALVES OF THAT REPORT ARE READ BY A TEST rather than believed:
 * `tests/ws/routing.test.ts`, « n'enregistre aucune route, et
 * `@fastify/websocket` n'est pas une dépendance du paquet », registers the
 * plugin on a real Fastify instance, counts the routes it adds, and reads
 * `packages/server/package.json`.
 *
 * ══ THE INVARIANTS, WHERE THEY LIVE ═══════════════════════════════════════
 *
 *   - invariant 1 — nothing under `src/ws/` calls the engine. Measured, not
 *     claimed, by `tests/ws/routing.test.ts`, describe « le hub ne décide rien
 *     (invariant 1) »: the acceptance criterion greps this directory for the
 *     engine's two decision entry points and for the proof builder, and
 *     requires zero hits. The three names are NOT spelled out anywhere under
 *     `src/ws/`, not even in a comment — a grep counts lines, and a comment
 *     that quoted them would turn the criterion red while proving nothing.
 *     They are written out once, in `tests/ws/routing.test.ts`, which replays
 *     the same search on every run;
 *   - invariant 3 — every inbound frame goes through `zC2SEnvelope` before
 *     anything looks at it (`handshake.test.ts`, « refuse une trame du bon `v`
 *     qui ne respecte aucune des huit formes »), and the only mutating route
 *     hands an `Intent` to `CampaignService` signed with the socket's own
 *     player (`routing.test.ts`, « signe l'écriture avec la campagne, le joueur
 *     de la socket et l'`id` de la trame — `c2s.intent` »);
 *   - ADR 0008 — `hub.ts` decides who receives what, and the reading half is
 *     addressed too: `addressed-broadcast.test.ts`, « un événement `private` ne
 *     quitte jamais le serveur vers un non-destinataire », and
 *     `handshake.test.ts`, « l'accueil sert à chacun l'instantané de SON
 *     joueur ». What a browser filters is `packages/client`'s own suite;
 *   - ADR 0010 — `s2c.event` carries both counters, and `c2s.resume` reads
 *     the dense one: `delivery.test.ts`, « `s2c.snapshot` porte le numéro de
 *     LIVRAISON, jamais le `seq` global — accueil » and « le curseur de
 *     l'instantané est celui que le client renverra, et il suffit à reprendre ».
 */

import { randomUUID } from 'node:crypto';
import { clearInterval, setInterval } from 'node:timers';

import websocket from '@fastify/websocket';
import {
  WS_CLOSE_CODES,
  WS_MAX_INCOMING_FRAME_BYTES,
  zCampaignId,
  zPlayerId,
} from '@for/contracts';
import { getCampaign, listMemberPlayerIds } from '@for/db';

import { TableConnection, authorizeHandshake } from './connection.js';
import { WsRateLimiter, routeMessage } from './handlers.js';
import { TableHub } from './hub.js';

import type { ContentRegistry } from '@for/content';
import type { SqliteConnection } from '@for/db';
import type { IdFactory } from '@for/engine';
import type { FastifyPluginCallback } from 'fastify';
import type { Buffer } from 'node:buffer';
import type { NarrationDispatcher } from '../ai/broadcast.js';
import type { AppPluginOptions, TimeSource } from '../deps.js';
import type { CampaignService, EventDelivery } from '../game/types.js';
import type {
  CampaignAccess,
  FrameIdSource,
  HandshakeRequest,
  WsLogger,
  WsSocket,
} from './connection.js';
import type { HandlerDeps, NarrationReplay } from './handlers.js';

export * from './connection.js';
export * from './handlers.js';
export * from './hub.js';
export * from './narration.js';

/**
 * Frame identifiers. A UUID, because `zMessageId` is `z.uuid()` — see
 * `FrameIdSource` in `connection.ts` for why `AppDeps.ids` cannot serve here.
 * Held by `tests/ws/handshake.test.ts`, « la source d'identifiants de trame
 * rend ce que `zMessageId` accepte, jamais un ULID ».
 */
export const randomFrameIds: FrameIdSource = { next: () => randomUUID() };

/**
 * The hub, and — when the process generates narration — the buffer a joining
 * socket is subscribed to.
 *
 * `NarrationDispatcher` ALREADY IMPLEMENTS `NarrationReplay`, the port
 * `handlers.ts` declared for `c2s.resume_narration`: same method, same input
 * fields, same return shape. M0-29 wrote it that way on purpose; this is where
 * the two are joined, which is why `AttachInput.narration` takes the
 * dispatcher itself rather than an adapter around it. Held by
 * `tests/ws/narration-frames.test.ts`, « le diffuseur EST le port de reprise :
 * `c2s.resume_narration` sert son tampon ».
 */
export function createTableHub(
  service: CampaignService,
  dispatcher?: NarrationDispatcher,
): TableHub {
  return new TableHub({ service, ...(dispatcher === undefined ? {} : { dispatcher }) });
}

export interface AttachInput {
  readonly hub: TableHub;
  /**
   * How a write reaches this socket: the journal, read by sequence. See
   * `game/delivery.ts` and issue #67 — the result of an intent is NOT the
   * journal, and the difference is three lost entries per game.
   */
  readonly delivery: EventDelivery;
  readonly socket: WsSocket;
  readonly request: HandshakeRequest;
  readonly access: CampaignAccess;
  readonly service: CampaignService;
  readonly content: ContentRegistry;
  readonly clock: TimeSource;
  /** ULIDs, for `s2c.error.requestId`. */
  readonly ids: IdFactory;
  /** UUIDs, for the `id` of every s2c envelope. */
  readonly frameIds: FrameIdSource;
  readonly logger: WsLogger;
  readonly narration?: NarrationReplay;
}

/**
 * Authorises a socket and wires it to the hub.
 *
 * Returns `null` when the handshake was refused — the socket has already been
 * closed with the code section 5.5 gives that refusal, and no connection
 * object exists for it, which is the point: an unauthorised socket must not
 * end up in a room even in a closed state. The four refusals are held by
 * `tests/ws/handshake.test.ts`, « ferme en 4002 une connexion sans session
 * valide », « ferme en 4003 une campagne interdite », « ferme en 4004 une
 * campagne inconnue, et une absence de campagne » and « répond 4002 avant
 * 4004 : l'identité passe avant la ressource ».
 *
 * The two identifiers are PARSED, not cast. `zPlayerId` and `zCampaignId`
 * carry the engine's brand and the ULID shape; a cast would hand the brand to
 * whatever the auth layer happened to produce, which is how a nominal type
 * stops meaning anything. MEASURED, not announced, by
 * `tests/ws/handshake.test.ts`, « sont PARSÉS, jamais castés : une forme que
 * le moteur refuse ne devient pas une session »: it hands the auth layer a
 * `playerId` of `p1` and a `campaignId` of `campagne-2`, and requires this
 * function to reject rather than to mint a session — replace either `parse`
 * with a cast and that test goes red. Its low direction is « et laissent
 * passer la forme que les schémas gelés déclarent », in the same describe.
 */
export async function attachSocket(input: AttachInput): Promise<TableConnection | null> {
  const outcome = await authorizeHandshake(input.access, input.request);
  if (!outcome.ok) {
    input.socket.close(WS_CLOSE_CODES[outcome.close], outcome.close);
    return null;
  }

  const deps: HandlerDeps = {
    hub: input.hub,
    delivery: input.delivery,
    service: input.service,
    content: input.content,
    clock: input.clock,
    ...(input.narration === undefined ? {} : { narration: input.narration }),
  };

  const limiter = new WsRateLimiter();

  const connection: TableConnection = new TableConnection({
    socket: input.socket,
    session: {
      playerId: zPlayerId.parse(outcome.playerId),
      campaignId: zCampaignId.parse(outcome.campaignId),
    },
    clock: input.clock,
    ids: input.ids,
    frameIds: input.frameIds,
    logger: input.logger,
    onMessage: (message) => routeMessage({ deps, connection, limiter }, message),
  });

  return connection;
}

/**
 * WHO MAY FOLLOW WHICH TABLE, read from the database.
 *
 * THREE ANSWERS, NOT TWO, and that is `CampaignAccess`'s own contract: a
 * campaign that does not exist and a campaign that is somebody else's are
 * different close codes (4004 and 4003). Collapsing them would either lie to a
 * legitimate player or tell a stranger which tables exist.
 *
 * Held by `tests/ws/upgrade.test.ts`, « l'accès lit la base : inconnue,
 * interdite, ouverte », which drives the three on a real campaign.
 */
export function createCampaignAccess(connection: SqliteConnection): CampaignAccess {
  return {
    check: (campaignId: string, playerId: string) => {
      if (getCampaign(connection, campaignId) === undefined) {
        return Promise.resolve('not_found' as const);
      }
      return Promise.resolve(
        listMemberPlayerIds(connection, campaignId).includes(playerId)
          ? ('ok' as const)
          : ('forbidden' as const),
      );
    },
  };
}

/** The upgrade path (01-architecture.md section 5). One table per socket. */
export const WS_ROUTE = '/ws';

/**
 * How often `TableHub.tick` runs. The heartbeat itself is
 * `WS_HEARTBEAT_INTERVAL_MS` (25 s) and `WS_HEARTBEAT_TIMEOUT_MS` (60 s); this
 * is only how often the clock is LOOKED AT, and it has to be finer than the
 * cadence it drives or a 25 s ping would fire every 30 s. Five seconds is the
 * largest divisor of both that leaves the comparison exact.
 */
export const WS_TICK_INTERVAL_MS = 5_000;

/**
 * THE RAW SOCKET, DECLARED HERE AND NOT IMPORTED, and that is a measurement
 * rather than a preference.
 *
 * `@fastify/websocket` re-exports `ws`'s own `WebSocket` type, and `ws` is NOT
 * a declared dependency of this package — it arrives as a transitive one. With
 * `skipLibCheck` the compiler lets that through and the type silently becomes
 * unresolvable: `pnpm lint` answered ten `no-unsafe-call` /
 * `no-unsafe-member-access` on this very function, which is the type system
 * saying it has no idea what `socket.send` is. Four members are used here;
 * naming them is both honest and checkable.
 */
interface RawSocket {
  send(data: string, callback?: () => void): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
}

/**
 * The transport, adapted. Two methods, and both are the ones `WsSocket`
 * declares — a `send(data)` that dropped `onFlushed` would compile and would
 * silently disable the back-pressure rearming of `TableConnection`.
 */
function wireSocket(socket: RawSocket): WsSocket {
  return {
    send: (data: string, onFlushed?: () => void): void => {
      socket.send(data, () => {
        onFlushed?.();
      });
    },
    close: (code: number, reason?: string): void => {
      socket.close(code, reason);
    },
  };
}

/**
 * THE UPGRADE, AND THE GAP M0-25 REPORTED IS CLOSED HERE.
 *
 * M0-25 wrote: "`wsPlugin` STILL REGISTERS NO ROUTE, and that is a reported
 * gap rather than an oversight. The HTTP upgrade needs `@fastify/websocket`,
 * which is not a dependency of `@for/server` […] `attachSocket` is the seam
 * that task will call". This is that call, and `@fastify/websocket` is now a
 * dependency of the package.
 *
 * ── WHAT IS READ PER REQUEST, AND WHY ────────────────────────────────────
 * `app.ts` registers this plugin BEFORE `gamePlugin`, and `app.ts` is closed.
 * The hub, the service, the dispatcher and the delivery are therefore read
 * from the instance INSIDE the handler, by which point `gamePlugin` has run.
 * A socket that arrives before the composition is answered 1013 rather than
 * crashing the process.
 *
 * ── THE HEARTBEAT IS ONE TIMER FOR THE WHOLE PROCESS ─────────────────────
 * `TableHub.tick` walks every room; one `setInterval` per socket would be one
 * timer per player for a job that is already global. It is `unref`'d so it
 * never holds the process open, and cleared on `onClose` so a test that builds
 * ten applications does not leave ten timers behind.
 *
 * Held by `tests/ws/upgrade.test.ts`: « une socket authentifiée reçoit
 * `s2c.welcome`, `s2c.snapshot` et `s2c.presence` », « une socket sans session
 * est fermée en 4002 » and « le départ du transport vide la salle ».
 */
export const wsPlugin: FastifyPluginCallback<AppPluginOptions> = (app, options, done) => {
  const { deps } = options;
  const access = createCampaignAccess(deps.connection);

  void app.register(websocket, {
    options: { maxPayload: WS_MAX_INCOMING_FRAME_BYTES },
  });

  app.register((scope, _opts, ready) => {
    scope.get(WS_ROUTE, { websocket: true }, (rawSocket: unknown, request) => {
      const socket = rawSocket as RawSocket;
      const hub = scope.tableHub;
      const service = scope.campaigns;
      const delivery = scope.delivery;
      if (hub === undefined || service === undefined || delivery === undefined) {
        // The composition has not run. 1013 is "try again later"; closing with
        // an application code would tell a client to stop retrying.
        socket.close(1013, 'not ready');
        return;
      }

      const session = scope.currentPlayer(request);
      const query = request.query as { campaignId?: string };

      void attachSocket({
        hub,
        delivery,
        socket: wireSocket(socket),
        request: {
          session: session === null ? null : { playerId: session.profile.id },
          campaignId: query.campaignId ?? null,
        },
        access,
        service,
        content: deps.content,
        clock: deps.clock,
        ids: deps.ids,
        frameIds: randomFrameIds,
        logger: deps.logger,
        ...(scope.narration === undefined ? {} : { narration: scope.narration }),
      }).then((connection) => {
        if (connection === null) return;

        socket.on('message', (raw: Buffer) => {
          void connection.receive(raw.toString('utf8'));
        });

        socket.on('close', () => {
          connection.markClosed();
          hub.detach(connection);
          hub.broadcastPresence(connection.session.campaignId);
        });
      });
    });
    ready();
  });

  const beat = setInterval(() => {
    app.tableHub?.tick(deps.clock.now());
  }, WS_TICK_INTERVAL_MS);
  beat.unref();
  app.addHook('onClose', (_instance, onClosed) => {
    clearInterval(beat);
    onClosed();
  });

  done();
};
