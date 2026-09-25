/**
 * One socket, its lifecycle, and the only place a frame is turned into bytes.
 *
 * THREE JOBS, AND NOTHING ELSE. This file (1) refuses what may not enter,
 * (2) mints and serialises what leaves, (3) keeps the heartbeat. It decides
 * nothing about the game: `hub.ts` decides WHO receives an event,
 * `handlers.ts` decides WHICH routine answers a frame, and the engine — which
 * this module never calls, directly or otherwise — decides everything else.
 * HELD BY `tests/ws/routing.test.ts`, describe « le hub ne décide rien
 * (invariant 1) » — its first test greps this directory for the three names
 * the acceptance criterion forbids, which is why THEY are not written here,
 * not even in a comment — and « n'importe du moteur que des types, et un seul
 * tuple de valeurs ». Both re-read this file on every run.
 *
 * WHY THE TRANSPORT IS AN INTERFACE AND NOT `@fastify/websocket`. `WsSocket`
 * has two methods. Everything the acceptance criteria of M0-25 ask for —
 * close codes, oversized frames, heartbeat on a simulated clock, back
 * pressure, addressed broadcast — is observable through those two, and a pair
 * of in-memory sockets measures them without a listening port. The real
 * upgrade needs `@fastify/websocket`, which is NOT in
 * `packages/server/package.json` and which this task's file list does not let
 * it add; see the header of `index.ts`. That absence is read, not asserted, by
 * `tests/ws/routing.test.ts`, « le greffon n'enregistre aucune route, et
 * `@fastify/websocket` n'est pas une dépendance du paquet », and the two
 * methods of the double are held to the interface's own by
 * `tests/ws/support/harness.test.ts`, « déclare exactement les paramètres de
 * l'interface, jamais un de moins ».
 *
 * EVERY OUTGOING FRAME IS PARSED BY `zS2CEnvelope` BEFORE IT IS SERIALISED.
 * That is deliberate and it is not a belt-and-braces gesture: the protocol was
 * frozen by M0-08 and ADR 0007 is the whole story of what an unguarded mirror
 * is worth. A frame this server builds wrongly must die here, on the server,
 * rather than reach a browser as something the client's own schema will
 * reject. It costs one parse per frame; M0 is a foundation, not a benchmark.
 * MEASURED, not announced, in `tests/ws/outgoing.test.ts`: « jette sur une
 * trame que le serveur aurait mal construite, et n'écrit rien », « refuse un
 * type de trame que le protocole gelé ne déclare pas », and the low direction,
 * « laisse passer la même trame une fois bien formée ». The same suite holds
 * the three other guarantees this file used to claim without proof: the 256 KiB
 * wire bound (« abandonne une trame trop lourde pour le fil, et le dit au
 * journal » / « écrit la même trame quand elle tient »), the single close
 * (« n'est fermée qu'une fois, et n'écrit plus rien après ») and the queue
 * collapse that must rearm (« se réarme quand le transport a rattrapé son
 * retard »).
 *
 * THE ORDER OF THE ENTRY CHECKS IS PART OF THE CONTRACT, because two of them
 * answer with a close code rather than with a message:
 *
 *   1. byte length     > 64 KiB            -> close 4009, before any parsing;
 *   2. JSON.parse      fails               -> `s2c.error { validation_failed }`;
 *   3. `v`             != PROTOCOL_VERSION -> close 4001, before the union;
 *   4. `zC2SEnvelope`  fails               -> `s2c.error { validation_failed }`.
 *
 * ONE NAMED TEST PER STEP, and step 1's order is measured rather than stated:
 * `tests/ws/limits.test.ts`, « ferme sur la taille AVANT de tenter la moindre
 * analyse » sends perfectly valid JSON that is only too big;
 * `tests/ws/handshake.test.ts` holds the other three — « refuse une trame qui
 * n'est pas du JSON, sans fermer la socket », « ferme en 4001 une trame dont le
 * `v` diffère », « refuse une trame du bon `v` qui ne respecte aucune des huit
 * formes ».
 *
 * Step 3 goes through `zEnvelopeHead` rather than the full union on purpose: a
 * frame from a future protocol will not parse as any of the eight variants,
 * and answering it with a pile of union errors instead of 4001 is how a
 * version mismatch becomes an unreadable bug report.
 */

import { Buffer } from 'node:buffer';

import type { zNarrationErrorCode, zNarrationStatus } from '@for/contracts';
import {
  PROTOCOL_VERSION,
  WS_CLOSE_CODES,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
  WS_MAX_INCOMING_FRAME_BYTES,
  WS_MAX_OUTGOING_FRAME_BYTES,
  WS_SOCKET_QUEUE_MAX_MESSAGES,
  zC2SEnvelope,
  zEnvelopeHead,
  zS2CEnvelope,
} from '@for/contracts';

import type {
  AppErrorCode,
  C2SMessage,
  RejectionCode,
  TableStateDto,
  TurnProofDto,
  WsCloseReason,
} from '@for/contracts';
import type { CampaignId, CharacterId, IdFactory, PlayerId } from '@for/engine';
import type { z } from 'zod';
import type { TimeSource } from '../deps.js';
import type { PersistedEvent } from '../game/types.js';

/**
 * DERIVED FROM THE FROZEN SCHEMAS, never retyped. `@for/contracts` exports the
 * two enums as schemas and not as types; recopying their members here would be
 * a mirror nobody guards, which is the whole lesson of ADR 0007.
 *
 * WHAT HOLDS THEM IS THE COMPILER, NOT A TEST, and it is said plainly: these
 * are `z.output<…>` of the frozen schemas, so a member removed in
 * `@for/contracts` turns the call sites red under `pnpm typecheck` and
 * `pnpm typecheck:tests`. No runtime assertion compares the two lists here.
 */
export type NarrationErrorCode = z.output<typeof zNarrationErrorCode>;
export type NarrationStatus = z.output<typeof zNarrationStatus>;

/**
 * One journalled event, plus the two numbers the wire carries with it.
 *
 * DECLARED HERE AND NOT IN `hub.ts`, although the hub is what mints
 * `deliverySeq`: `hub.ts` already imports this module, and dependency-cruiser
 * forbids cycles with `tsPreCompilationDeps` on — a type-only back edge is
 * still an edge. The gate that holds it is `pnpm run depcruise`, rule
 * `pas-de-cycle`, not a test file. The shape is a frame shape anyway: it is
 * exactly what `s2c.event` and one entry of `s2c.events_batch` carry.
 */
export interface DeliveredEntry {
  /**
   * Journal position. Global, and NOT dense for a given recipient — held by
   * `tests/ws/delivery.test.ts`, « `seq` a des trous légitimes là où
   * `deliverySeq` n'en a aucun ».
   */
  readonly seq: number;
  /**
   * ADR 0010: dense per (campaign, player). The only gap-free counter — same
   * test, which asserts the density of this one beside the holes of the other.
   */
  readonly deliverySeq: number;
  readonly event: PersistedEvent;
}

/** One line of `s2c.presence`. */
export interface PresenceMember {
  readonly playerId: PlayerId;
  readonly characterId: CharacterId | null;
  readonly online: boolean;
  readonly typing: boolean;
}

/**
 * The close code for a heartbeat that stopped answering.
 *
 * REPORTED, NOT INVENTED QUIETLY: 01-architecture.md section 5.5 assigns
 * 4001-4004 and 4008-4011 and has NO name for "no `c2s.pong` in 60 s", while
 * section 5 requires the socket to be closed for exactly that. `1001` is the
 * RFC 6455 "going away", which is what actually happened and which no
 * deployed client can confuse with an application refusal. Adding a 4012
 * would be a protocol change, and the protocol is frozen.
 *
 * MEASURED, in `tests/ws/limits.test.ts`: « le code du battement n'appartient
 * pas aux codes que le protocole gelé nomme » reads `WS_CLOSE_CODES` and
 * requires this number to be absent from it, and « ferme la connexion sans
 * `c2s.pong` pendant 60 s, et pas avant » requires it on the wire.
 */
export const WS_CLOSE_HEARTBEAT_TIMEOUT = 1001;

/** A transport. Two methods, so a test can be one object literal. */
export interface WsSocket {
  /**
   * `onFlushed` fires when the transport has actually written the frame. The
   * double honours it — `tests/ws/support/harness.test.ts`, « retient les
   * acquittements pendant que le transport est bloqué, et les rend au drain » —
   * and what the server does with it is `tests/ws/outgoing.test.ts`, « se
   * réarme quand le transport a rattrapé son retard ».
   */
  send(data: string, onFlushed?: () => void): void;
  close(code: number, reason?: string): void;
}

/** Enough of pino for this module; a `Logger` satisfies it structurally. */
export interface WsLogger {
  warn(context: object, message: string): void;
}

/**
 * Who this socket is, settled during the handshake and never again: there is
 * no setter, and every write the server signs is signed from here —
 * `tests/ws/routing.test.ts`, « signe l'écriture avec la campagne, le joueur de
 * la socket et l'`id` de la trame — `c2s.intent` », and
 * `tests/ws/handshake.test.ts`, « nomme la socket dans `s2c.welcome` : son
 * joueur et sa campagne ».
 */
export interface ConnectionSession {
  readonly playerId: PlayerId;
  readonly campaignId: CampaignId;
}

/**
 * Where the `id` of an s2c envelope comes from.
 *
 * NOT `AppDeps.ids`, AND THAT IS A DIVERGENCE WORTH NAMING. `zMessageId` is
 * `z.uuid()` (01-architecture.md section 5.1: "uuid v7"), while
 * `createUlidFactory` in `deps.ts` mints ULIDs — 26 characters of Crockford
 * base32, which `z.uuid()` refuses. The two identifier vocabularies are both
 * deliberate and they do not meet, so frame identifiers get their own source,
 * injected like everything else that is not deterministic.
 *
 * THAT THEY DO NOT MEET IS MEASURED: `tests/ws/outgoing.test.ts`, « le
 * `requestId` d'une erreur est un ULID, jamais l'`id` de la trame qui le
 * porte », and `tests/ws/handshake.test.ts`, « la source d'identifiants de
 * trame rend ce que `zMessageId` accepte, jamais un ULID ».
 */
export interface FrameIdSource {
  next(): string;
}

export interface ConnectionDeps {
  readonly socket: WsSocket;
  readonly session: ConnectionSession;
  readonly clock: TimeSource;
  /** `requestId` of `s2c.error`. A ULID, like every other server identifier. */
  readonly ids: IdFactory;
  /** `id` of every s2c envelope. A UUID — see `FrameIdSource`. */
  readonly frameIds: FrameIdSource;
  readonly logger: WsLogger;
  /** Called once a frame has passed all four entry checks. */
  readonly onMessage: (message: C2SMessage) => Promise<void>;
}

/** What the payload of `s2c.welcome` needs that this module cannot know. */
export interface WelcomeFacts {
  readonly characterId: CharacterId | null;
  readonly contentVersion: string;
  readonly lastSeq: number;
  readonly lastDeliverySeq: number;
}

export class TableConnection {
  private readonly deps: ConnectionDeps;

  private open = true;

  /** Frames handed to the transport and not yet flushed. */
  private inFlight = 0;

  /**
   * Set once the queue overflowed; cleared when the transport drains — the
   * rearming is `tests/ws/outgoing.test.ts`, « se réarme quand le transport a
   * rattrapé son retard ».
   */
  private collapsed = false;

  private lastPongAt: number;

  private lastPingAt: number;

  /**
   * Filled at `c2s.hello`; `s2c.welcome` and `s2c.presence` report it —
   * `tests/ws/handshake.test.ts`, « nomme le personnage du joueur dans
   * `s2c.welcome.you`, et `null` quand il n'en a pas » and « porte le
   * personnage et la frappe de chacun dans `s2c.presence` ».
   */
  private characterId: CharacterId | null = null;

  /**
   * Whether `c2s.hello` has been answered.
   *
   * IT GATES EVERY OTHER FRAME BUT THE HEARTBEAT, and the reason is not
   * ceremony. A `c2s.intent` accepted before the handshake would be resolved
   * and journalled while this socket is not yet in the hub's broadcast set:
   * the table would see the events and the author would not. Refusing it is
   * the only answer that leaves no silent hole.
   *
   * BOTH DIRECTIONS, in `tests/ws/routing.test.ts`: « refuse toute trame autre
   * que l'accueil tant que `c2s.hello` n'a pas répondu » for the refusal, and
   * « le battement passe avant l'accueil, et il repousse l'échéance » for the
   * exception this flag deliberately leaves open.
   */
  private greeted = false;

  private typing = false;

  constructor(deps: ConnectionDeps) {
    this.deps = deps;
    const now = deps.clock.now();
    this.lastPongAt = now;
    this.lastPingAt = now;
  }

  get session(): ConnectionSession {
    return this.deps.session;
  }

  get isOpen(): boolean {
    return this.open;
  }

  get member(): PresenceMember {
    return {
      playerId: this.deps.session.playerId,
      characterId: this.characterId,
      online: this.open,
      typing: this.typing,
    };
  }

  get hasGreeted(): boolean {
    return this.greeted;
  }

  markGreeted(): void {
    this.greeted = true;
  }

  setCharacter(characterId: CharacterId | null): void {
    this.characterId = characterId;
  }

  setTyping(typing: boolean): void {
    this.typing = typing;
  }

  markPong(now: number): void {
    this.lastPongAt = now;
  }

  // ------------------------------------------------------------- incoming

  /**
   * One inbound frame, from bytes to a validated message.
   *
   * Returns nothing: what happens next is either a close, an `s2c.error`, or
   * `onMessage`. A caller that wanted a verdict would be a second place where
   * an unvalidated frame could be looked at.
   */
  async receive(raw: string | Uint8Array): Promise<void> {
    if (!this.open) return;

    if (Buffer.byteLength(raw) > WS_MAX_INCOMING_FRAME_BYTES) {
      this.closeWith('payload_too_large');
      return;
    }

    const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.sendError('validation_failed', "La trame n'est pas du JSON valide.");
      return;
    }

    const head = zEnvelopeHead.safeParse(parsed);
    if (head.success && head.data.v !== PROTOCOL_VERSION) {
      this.closeWith('protocol_version');
      return;
    }

    const frame = zC2SEnvelope.safeParse(parsed);
    if (!frame.success) {
      this.sendError('validation_failed', 'La trame ne respecte pas le protocole.');
      return;
    }

    await this.deps.onMessage(frame.data);
  }

  // -------------------------------------------------------------- outgoing

  /**
   * Serialise one frame and hand it to the transport.
   *
   * `zS2CEnvelope.parse` THROWS here rather than returning a verdict: a frame
   * the server built wrongly is a programming error, not a client problem, and
   * swallowing it would put the bug on a player's screen. Held by
   * `tests/ws/outgoing.test.ts`, « jette sur une trame que le serveur aurait
   * mal construite, et n'écrit rien ».
   */
  send(frame: unknown): boolean {
    if (!this.open) return false;

    const checked = zS2CEnvelope.parse(frame);
    const data = JSON.stringify(checked);
    const bytes = Buffer.byteLength(data);

    if (bytes > WS_MAX_OUTGOING_FRAME_BYTES) {
      this.deps.logger.warn(
        { type: checked.t, bytes, limit: WS_MAX_OUTGOING_FRAME_BYTES },
        'outgoing frame over the wire limit, dropped',
      );
      return false;
    }

    if (this.inFlight >= WS_SOCKET_QUEUE_MAX_MESSAGES) {
      this.collapse();
      return false;
    }

    this.write(data);
    return true;
  }

  /**
   * Back pressure, as 02-mj-ia.md section 6.3 words it: past the queue bound
   * the server collapses the socket queue rather than growing it without end.
   * The client is told to redo `c2s.hello`, which is the one recovery that
   * needs no buffer at all. Held by `tests/ws/limits.test.ts`, « replie la file
   * au-delà de sa borne et demande une resynchronisation », and by
   * `tests/ws/outgoing.test.ts`, « se réarme quand le transport a rattrapé son
   * retard », which is the half a single collapse cannot show.
   */
  private collapse(): void {
    if (this.collapsed) return;
    this.collapsed = true;
    this.deps.logger.warn(
      { queued: this.inFlight, limit: WS_SOCKET_QUEUE_MAX_MESSAGES },
      'socket queue collapsed, asking the client to resynchronise',
    );
    this.write(
      JSON.stringify(
        zS2CEnvelope.parse(this.frame('s2c.resync_required', { reason: 'file de socket saturée' })),
      ),
    );
  }

  private write(data: string): void {
    this.inFlight += 1;
    this.deps.socket.send(data, () => {
      this.inFlight -= 1;
      if (this.inFlight === 0) this.collapsed = false;
    });
  }

  /**
   * The `{ v, t, id, ts, p }` shell EVERY s2c frame wears, `s2c.event`
   * included — its two counters arrive through `extra` and sit where the
   * protocol puts them, beside `ts` and not inside `p`.
   *
   * ONE FACTORY, ONE PATH, AND THAT IS THE WHOLE POINT. `s2c.event` used to
   * build its own shell in full, so the `id` and the `ts` of the most frequent
   * frame of the stream were minted by a second expression that no guard
   * watched: freezing either of them left the suite green. A guard can only
   * hold the shell it looks at, so there is now one shell.
   *
   * Held on a real `s2c.event` by `tests/ws/outgoing.test.ts`, « l'enveloppe
   * d'un `s2c.event` sort de la même fabrique : deux événements, deux `id` » and
   * « et son `ts` suit l'horloge injectée, à deux instants et pas un seul ».
   */
  private frame(type: string, payload: unknown, extra?: Record<string, number>): unknown {
    return {
      v: PROTOCOL_VERSION,
      t: type,
      id: this.deps.frameIds.next(),
      ts: this.deps.clock.now(),
      ...(extra ?? {}),
      p: payload,
    };
  }

  // ------------------------------------------------- the frames, by name

  sendWelcome(facts: WelcomeFacts): void {
    this.send(
      this.frame('s2c.welcome', {
        protocolVersion: PROTOCOL_VERSION,
        playerId: this.deps.session.playerId,
        campaignId: this.deps.session.campaignId,
        you: { characterId: facts.characterId },
        contentVersion: facts.contentVersion,
        lastSeq: facts.lastSeq,
        lastDeliverySeq: facts.lastDeliverySeq,
      }),
    );
  }

  sendSnapshot(state: TableStateDto, lastSeq: number, lastDeliverySeq: number): void {
    this.send(this.frame('s2c.snapshot', { state, lastSeq, lastDeliverySeq }));
  }

  /**
   * The only numbered frame. Both counters, always — ADR 0010, and through the
   * one shell factory like every other frame.
   *
   * Held by `tests/ws/delivery.test.ts`, « livre 50 événements dans l'ordre
   * strict, sans trou de livraison » and « `seq` a des trous légitimes là où
   * `deliverySeq` n'en a aucun ».
   */
  sendEvent(entry: DeliveredEntry): boolean {
    return this.send(
      this.frame(
        's2c.event',
        { event: entry.event },
        { seq: entry.seq, deliverySeq: entry.deliverySeq },
      ),
    );
  }

  /**
   * The catch-up, split so that no frame passes 256 KiB.
   *
   * ALWAYS SENDS AT LEAST ONE FRAME, empty batch included: the acceptance
   * criterion says a `c2s.hello` is answered by a catch-up OR a snapshot, and
   * "you had missed nothing" is a catch-up, not a silence. Held by
   * `tests/ws/delivery.test.ts`, « `c2s.hello` avec un curseur exactement à
   * jour répond un lot VIDE, pas un instantané » and « `c2s.resume` avec un
   * curseur exactement à jour répond un lot VIDE, pas un silence »; the split
   * itself by « découpe un rattrapage trop lourd en plusieurs trames de moins
   * de 256 Kio ».
   */
  sendBatch(entries: readonly DeliveredEntry[]): number {
    const overhead = Buffer.byteLength(
      JSON.stringify(this.frame('s2c.events_batch', { events: [] })),
    );

    let frames = 0;
    let current: DeliveredEntry[] = [];
    let size = overhead;

    const flush = (): void => {
      this.send(
        this.frame('s2c.events_batch', {
          events: current.map((entry) => ({
            seq: entry.seq,
            deliverySeq: entry.deliverySeq,
            event: entry.event,
          })),
        }),
      );
      frames += 1;
    };

    for (const entry of entries) {
      const cost =
        Buffer.byteLength(
          JSON.stringify({ seq: entry.seq, deliverySeq: entry.deliverySeq, event: entry.event }),
        ) + 1;
      if (current.length > 0 && size + cost > WS_MAX_OUTGOING_FRAME_BYTES) {
        flush();
        current = [];
        size = overhead;
      }
      current.push(entry);
      size += cost;
    }

    flush();
    return frames;
  }

  sendPresence(members: readonly PresenceMember[]): void {
    this.send(this.frame('s2c.presence', { members }));
  }

  sendTurnProof(correlationId: string, proof: TurnProofDto, truncated: boolean): void {
    this.send(this.frame('s2c.turn_proof', { correlationId, proof, truncated }));
  }

  sendRejected(intentId: string, code: RejectionCode, message: string): void {
    this.send(this.frame('s2c.rejected', { intentId, code, message }));
  }

  sendError(code: AppErrorCode, message: string, intentId?: string): void {
    this.send(
      this.frame('s2c.error', {
        code,
        message,
        requestId: this.deps.ids.next(),
        ...(intentId === undefined ? {} : { intentId }),
      }),
    );
  }

  sendPing(): void {
    this.send(this.frame('s2c.ping', {}));
  }

  /**
   * The whole narration buffer, replayed after a cut. NEVER a second
   * generation: what is sent here is what the server already holds
   * (02-mj-ia.md section 6.3). Held by `tests/ws/routing.test.ts`, « rejoue le
   * tampon quand il existe, et ne relance jamais une génération ».
   */
  sendNarrationSnapshot(buffered: {
    readonly narrationId: string;
    readonly chunk: number;
    readonly text: string;
    readonly status: NarrationStatus;
  }): void {
    this.send(this.frame('s2c.narration_snapshot', buffered));
  }

  sendNarrationError(narrationId: string, code: NarrationErrorCode): void {
    this.send(this.frame('s2c.narration_error', { narrationId, code }));
  }

  // ------------------------------------------------------------ heartbeat

  /**
   * One beat of the injected clock. Timeout is checked BEFORE the ping: a
   * socket that has been silent for a minute is closed, not pinged again.
   * Held by `tests/ws/limits.test.ts`, « au battement qui ferme, RIEN d'autre
   * ne part : le délai est vérifié AVANT le ping », and the cadence itself by
   * « envoie un `s2c.ping` toutes les 25 s — une CADENCE, donc quatre tics ».
   */
  tick(now: number): void {
    if (!this.open) return;

    if (now - this.lastPongAt >= WS_HEARTBEAT_TIMEOUT_MS) {
      this.open = false;
      this.deps.socket.close(WS_CLOSE_HEARTBEAT_TIMEOUT, 'heartbeat');
      return;
    }

    if (now - this.lastPingAt >= WS_HEARTBEAT_INTERVAL_MS) {
      this.lastPingAt = now;
      this.sendPing();
    }
  }

  // ---------------------------------------------------------------- close

  /**
   * Closes with the number section 5.5 gives that reason, and only that —
   * `tests/ws/handshake.test.ts` for 4001 to 4004, `tests/ws/limits.test.ts`
   * for 4008 (« ferme en 4008 au troisième dépassement ») and 4009 (« ferme en
   * 4009 à 65 Kio — le chiffre du critère »).
   */
  closeWith(reason: WsCloseReason): void {
    if (!this.open) return;
    this.open = false;
    this.deps.socket.close(WS_CLOSE_CODES[reason], reason);
  }

  /**
   * The transport went away on its own. Held by `tests/ws/outgoing.test.ts`,
   * « quitte la table quand le transport est parti de lui-même ».
   */
  markClosed(): void {
    this.open = false;
  }
}

// ---------------------------------------------------------------- handshake

/** What the auth layer (M0-23) has to answer before a socket may live. */
export interface CampaignAccess {
  /**
   * Whether this player may follow this campaign. THREE ANSWERS, NOT TWO: a
   * campaign that does not exist and a campaign that is somebody else's are
   * different close codes (4004 and 4003), and collapsing them would either
   * lie to a legitimate player or tell a stranger which tables exist. Held by
   * `tests/ws/handshake.test.ts`, « ferme en 4003 une campagne interdite » and
   * « ferme en 4004 une campagne inconnue, et une absence de campagne »; what
   * is submitted to the verdict, by « soumet à l'autorisation la campagne de la
   * requête ET le joueur de la session ».
   */
  check(campaignId: string, playerId: string): Promise<'ok' | 'forbidden' | 'not_found'>;
}

/** The handshake, as the transport sees it: a cookie, and a query parameter. */
export interface HandshakeRequest {
  /** Resolved from the session cookie by M0-23. `null` = no valid session. */
  readonly session: { readonly playerId: string } | null;
  /** `?campaignId=`. A connection follows exactly one table (section 5). */
  readonly campaignId: string | null;
}

export type HandshakeOutcome =
  | { readonly ok: true; readonly playerId: string; readonly campaignId: string }
  | { readonly ok: false; readonly close: WsCloseReason };

/**
 * Who may open a socket, in the order the close codes demand.
 *
 * IDENTITY BEFORE RESOURCE. An unauthenticated caller is 4002 whatever
 * campaign it named: answering 4004 first would tell an anonymous stranger
 * whether a campaign identifier exists, which is a disclosure for free on a
 * public deployment. Held by `tests/ws/handshake.test.ts`, « répond 4002 avant
 * 4004 : l'identité passe avant la ressource » and « ne consulte pas
 * l'autorisation quand l'identité manque : 4002 d'abord ».
 */
export async function authorizeHandshake(
  access: CampaignAccess,
  request: HandshakeRequest,
): Promise<HandshakeOutcome> {
  const session = request.session;
  if (session === null) return { ok: false, close: 'unauthenticated' };

  const campaignId = request.campaignId;
  if (campaignId === null || campaignId.length === 0) {
    return { ok: false, close: 'campaign_not_found' };
  }

  const verdict = await access.check(campaignId, session.playerId);
  switch (verdict) {
    case 'ok':
      return { ok: true, playerId: session.playerId, campaignId };
    case 'forbidden':
      return { ok: false, close: 'forbidden_campaign' };
    case 'not_found':
      return { ok: false, close: 'campaign_not_found' };
  }
}
