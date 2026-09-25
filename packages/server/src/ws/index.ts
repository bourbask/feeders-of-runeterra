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

import { WS_CLOSE_CODES, zCampaignId, zPlayerId } from '@for/contracts';

import { TableConnection, authorizeHandshake } from './connection.js';
import { WsRateLimiter, routeMessage } from './handlers.js';
import { TableHub } from './hub.js';

import type { ContentRegistry } from '@for/content';
import type { IdFactory } from '@for/engine';
import type { FastifyPluginCallback } from 'fastify';
import type { AppPluginOptions, TimeSource } from '../deps.js';
import type { CampaignService } from '../game/types.js';
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

/**
 * Frame identifiers. A UUID, because `zMessageId` is `z.uuid()` — see
 * `FrameIdSource` in `connection.ts` for why `AppDeps.ids` cannot serve here.
 * Held by `tests/ws/handshake.test.ts`, « la source d'identifiants de trame
 * rend ce que `zMessageId` accepte, jamais un ULID ».
 */
export const randomFrameIds: FrameIdSource = { next: () => randomUUID() };

export function createTableHub(service: CampaignService): TableHub {
  return new TableHub({ service });
}

export interface AttachInput {
  readonly hub: TableHub;
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
 * The Fastify plugin. It registers nothing until `@fastify/websocket` becomes
 * a dependency of this package — see the header. It stays in `app.ts`'s
 * registration list so that the composition point never has to be reopened.
 */
export const wsPlugin: FastifyPluginCallback<AppPluginOptions> = (_app, _options, done) => {
  done();
};
