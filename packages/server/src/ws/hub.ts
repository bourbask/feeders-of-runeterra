/**
 * `TableHub` — who is connected, WHO RECEIVES WHAT, and where each player's
 * dense delivery numbering stands.
 *
 * ══ THE SERVER DECIDES WHO RECEIVES WHAT (ADR 0008 decision 1, invariant 3) ══
 *
 * `isVisibleTo` below is the only place ON THIS PATH where that question is
 * answered — live broadcast and catch-up both call it, and nothing else in
 * `src/ws/` reads an event's scope. That last clause is a grep, and it runs on
 * every test run: `tests/ws/addressed-broadcast.test.ts`, « une seule lecture
 * de la portée dans tout `src/ws` ».
 *
 * It is NOT the only expression of the predicate in the repository: `@for/db`
 * carries the same rule as SQL (`VISIBLE_TO_PLAYER`, `repositories/events.ts`)
 * for replaying one player's thread, and that one is held by its own package's
 * suite (`packages/db/tests/events-repo.test.ts`). NOTHING IN THIS PACKAGE
 * COMPARES THE TWO — two expressions of one rule, said out loud rather than
 * promised.
 *
 * A `private` event is never written to a socket whose player is not in
 * `recipients`. The proof is `tests/ws/addressed-broadcast.test.ts`, « un
 * événement `private` ne quitte jamais le serveur vers un non-destinataire »,
 * « un événement `subset` va aux nommés, et à eux seuls » and « le rattrapage
 * est adressé comme la diffusion : un secret ne revient pas par la reprise »,
 * which read the BYTES handed to the other player's transport rather than the
 * frames the hub thinks it sent. What a browser would do with a frame it never
 * receives is not this package's to measure.
 *
 * ══ THE DELIVERY NUMBER (ADR 0010 decision 1) ═══════════════════════════════
 *
 * `seq` is the journal's clock and has legitimate holes for any one player
 * since broadcast became addressed. `deliverySeq` is dense per
 * (campaign, player) and is what `c2s.resume` carries. The hub mints it here,
 * and it is NOT stored: `@for/db` derives the same number from the journal
 * with a `ROW_NUMBER() OVER (ORDER BY seq)` over the visible stream
 * (`readForPlayerAfterDelivery`), so the definition is
 *
 *     deliverySeq(p, e) = |{ f : f.seq <= e.seq and isVisibleTo(f, p) }|
 *
 * and this module computes exactly that, from `readEventsSince(campaignId, 0)`
 * at hydration and by increment afterwards. Two paths, one definition — which
 * is the point, because a counter kept only in memory would not survive a
 * restart and could not be compared to anything.
 *
 * WHAT HOLDS THE DEFINITION HERE: `tests/ws/delivery.test.ts`, « ce qu'Alice a
 * reçu est exactement ce que son fil rejoué redonne », which rebuilds the set
 * from the journal and compares it to the bytes, and « `seq` a des trous
 * légitimes là où `deliverySeq` n'en a aucun ».
 *
 * ══ WHY HYDRATION READS THE WHOLE JOURNAL, AND WHAT WOULD FIX IT ═══════════
 *
 * REPORTED, NOT WORKED AROUND. `CampaignService` as M0-20 froze it has no
 * delivery-aware read: `readEventsSince(campaignId, seq)` takes no `viewerId`
 * and returns no `deliverySeq`, and `getSnapshot` returns no
 * `lastDeliverySeq` — while `s2c.welcome`, `s2c.snapshot`, `s2c.events_batch`
 * and `c2s.resume` all need one. `@for/db` ALREADY SHIPS the indexed query
 * (`readForPlayerAfterDelivery`, M0-15); the interface simply does not expose
 * it. Until it does, a player's first `c2s.hello` on a campaign costs one full
 * journal read, and one only: `tests/ws/delivery.test.ts`, « un second
 * `c2s.hello` ne recoûte pas une lecture intégrale — et chaque joueur a la
 * sienne ». The hub may not reach past the service to the database — it
 * routes, it does not read — so the cost is paid here and named here.
 *
 * AND IT COSTS MORE THAN ONE READ. Because `getSnapshot` returns no
 * `lastDeliverySeq`, a snapshot answer has to take its state from the service
 * and its cursor from here, at two different instants — and an event committed
 * between the two is counted by the cursor, absent from the state, and, on
 * `c2s.hello`, never written at all. `handlers.ts` closes that window by
 * reading the cursor first and draining `deliveredSince` afterwards, which
 * costs a duplicate frame — `tests/ws/snapshot-race.test.ts`, « livre un
 * événement diffusé pendant que la lecture est en vol — `c2s.hello` » and
 * « ne laisse jamais un instantané écraser un événement plus récent que lui —
 * `c2s.resume` ». A `getSnapshot` that returned its OWN
 * `lastDeliverySeq` would make both the full read and the drain unnecessary:
 * one reading, one instant. That is the same report, and it is why it matters.
 *
 * ══ WHAT THIS FILE IS NOT ══════════════════════════════════════════════════
 *
 * It rolls no die, applies no event to any state, and builds no proof — the
 * grep of the acceptance criterion, replayed on every run by
 * `tests/ws/routing.test.ts`, describe « le hub ne décide rien (invariant 1) ».
 * It holds a list of connections, a per-player counter, and a bounded tail of
 * what it has already delivered.
 */

import { EVENT_SCOPES } from '@for/engine';

import type { CampaignId, PlayerId } from '@for/engine';
import type { CampaignService, PersistedEvent } from '../game/types.js';
import type { DeliveredEntry, PresenceMember, TableConnection } from './connection.js';

/**
 * How far back a client may resume from, in delivered events.
 *
 * MINE, AND SAID SO. 01-architecture.md section 5.4 says a snapshot is sent
 * when the client's cursor is "trop ancien ou absent" and never quantifies
 * "trop ancien". 200 is the snapshot cadence of ARCHITECTURE.md section 4.5:
 * past that many events a client is, by the repository's own measure, better
 * served by a fresh state than by a replay. Raising it lengthens
 * `PlayerStream.tail`; nothing else reads this constant.
 *
 * WHERE THE BOUND FALLS IS MEASURED, in both directions, through the public
 * seam: `tests/ws/delivery.test.ts`, « sert le curseur qui est juste à la
 * borne, et refuse celui qui est un cran derrière ».
 */
export const WS_DELIVERY_TAIL_MAX = 200;

/**
 * THE VISIBILITY PREDICATE OF ADR 0008. One function, one answer, one caller
 * per direction — live broadcast and catch-up both go through it.
 *
 * A SWITCH, NOT AN `if`: `switch-exhaustiveness-check` makes a fourth scope a
 * lint error here instead of a silent delivery — that one is held by
 * `pnpm lint`, not by a test, and at runtime by
 * `tests/ws/addressed-broadcast.test.ts`, « chaque portée du moteur a une
 * réponse, et seule `table` est ouverte », which walks the engine's own tuple.
 * And the default of the two addressed scopes is REFUSAL — a `recipients` that
 * is null or empty reaches nobody, which is the fail-closed direction: « une
 * liste de destinataires vide ou absente ne livre à personne — le défaut est
 * le refus ».
 */
export function isVisibleTo(event: PersistedEvent, playerId: string): boolean {
  switch (event.scope) {
    case 'table':
      return true;
    case 'subset':
    case 'private':
      return event.recipients?.includes(playerId) ?? false;
  }
}

/**
 * The scopes that are addressed, derived from the engine's own tuple.
 *
 * Exported so a test can compare it to the list ADR 0008 writes out in full,
 * rather than to this module's own arithmetic —
 * `tests/ws/addressed-broadcast.test.ts`, « les portées adressées sont celles
 * que l'ADR 0008 nomme, et le moteur les porte toutes ».
 */
export const ADDRESSED_SCOPES: readonly string[] = EVENT_SCOPES.filter(
  (scope) => scope !== 'table',
);

/** What `c2s.hello` and `c2s.resume` get back. */
export type Catchup =
  | { readonly kind: 'batch'; readonly entries: readonly DeliveredEntry[] }
  | { readonly kind: 'snapshot'; readonly reason: string };

/** One player's dense stream in one campaign. */
interface PlayerStream {
  /**
   * High-water mark of `deliverySeq`. Exact, whatever the tail retains — held
   * by `tests/ws/snapshot-race.test.ts`, « sert le lot partiel que la file
   * retient encore quand elle a roulé pendant la fenêtre — `c2s.hello` », where
   * the tail rolls and the head keeps counting past it.
   */
  head: number;
  /**
   * Highest journal `seq` already counted. Makes appends idempotent — held by
   * `tests/ws/delivery.test.ts`, « ne recompte pas un événement rediffusé par
   * erreur ».
   */
  lastSeq: number;
  /** The last `WS_DELIVERY_TAIL_MAX` deliveries, for the catch-up. */
  tail: DeliveredEntry[];
  /** True while the first journal read is in flight. */
  hydrating: boolean;
  /** Events broadcast during hydration, applied once it lands. */
  pending: PersistedEvent[];
}

interface CampaignRoom {
  readonly connections: Set<TableConnection>;
  readonly streams: Map<string, PlayerStream>;
}

export interface HubDeps {
  readonly service: CampaignService;
}

export class TableHub {
  private readonly deps: HubDeps;

  private readonly rooms = new Map<string, CampaignRoom>();

  constructor(deps: HubDeps) {
    this.deps = deps;
  }

  // ------------------------------------------------------------- the room

  private room(campaignId: string): CampaignRoom {
    const existing = this.rooms.get(campaignId);
    if (existing !== undefined) return existing;
    const created: CampaignRoom = { connections: new Set(), streams: new Map() };
    this.rooms.set(campaignId, created);
    return created;
  }

  /**
   * A connection joins the broadcast set. Called AFTER its `c2s.hello` has
   * been answered, so that the catch-up and the live stream cannot interleave.
   *
   * THE STREAM COUNTING IS NOT ENOUGH ON ITS OWN, and saying otherwise was
   * wrong: the stream does keep counting during the handshake, but a snapshot
   * answer carries a cursor read BEFORE the service call, so what the stream
   * gained in between reaches nobody unless it is written out. That is
   * `handlers.ts`, `flushAfterSnapshot`, which runs just before this call, and
   * `tests/ws/snapshot-race.test.ts` holds the whole order, frame by frame.
   */
  attach(connection: TableConnection): void {
    this.room(connection.session.campaignId).connections.add(connection);
  }

  /**
   * The socket went away. The last one out drops the room's streams — both
   * halves held by `tests/ws/delivery.test.ts`, « garde les flux tant qu'une
   * socket reste, et les emporte quand la dernière part », which re-reads the
   * journal afterwards to prove the streams are really gone.
   */
  detach(connection: TableConnection): void {
    const campaignId = connection.session.campaignId;
    const room = this.rooms.get(campaignId);
    if (room === undefined) return;
    room.connections.delete(connection);
    if (room.connections.size === 0) this.rooms.delete(campaignId);
  }

  connectionsOf(campaignId: CampaignId): readonly TableConnection[] {
    return [...(this.rooms.get(campaignId)?.connections ?? [])];
  }

  // -------------------------------------------------------- the numbering

  /**
   * Makes sure this player's stream exists and is numbered, reading the
   * journal once if it is not.
   *
   * THE RACE IS HANDLED, AND IT IS THE INTERESTING PART. The stream is put in
   * the map BEFORE the read is awaited, marked `hydrating`, so an event
   * broadcast meanwhile lands in `pending` instead of being dropped. The read
   * is then applied first, `pending` second, and `appendVisible` skips
   * anything whose `seq` is already counted — so an event that appears in both
   * is counted exactly once, and one that appears in neither cannot exist.
   * Held by `tests/ws/delivery.test.ts`, « un événement diffusé pendant
   * l'hydratation est compté une fois, et une seule ».
   */
  async openStream(campaignId: CampaignId, playerId: PlayerId): Promise<void> {
    const room = this.room(campaignId);
    if (room.streams.has(playerId)) return;

    const stream: PlayerStream = {
      head: 0,
      lastSeq: 0,
      tail: [],
      hydrating: true,
      pending: [],
    };
    room.streams.set(playerId, stream);

    const journal = await this.deps.service.readEventsSince(campaignId, 0);
    for (const event of journal) this.appendVisible(stream, event, playerId);

    const pending = stream.pending;
    stream.pending = [];
    stream.hydrating = false;
    for (const event of pending) this.appendVisible(stream, event, playerId);
  }

  /** Head of this player's dense stream. 0 when nothing was ever delivered. */
  deliveryHead(campaignId: CampaignId, playerId: PlayerId): number {
    return this.rooms.get(campaignId)?.streams.get(playerId)?.head ?? 0;
  }

  /**
   * What the player is missing after `sinceDeliverySeq`.
   *
   * `null` means "I have never received anything", which is a snapshot, not a
   * replay of the whole campaign: `c2s.hello` carries `lastDeliverySeq: null`
   * exactly in that case. Held by `tests/ws/handshake.test.ts`, « envoie un
   * instantané quand le curseur est absent, un rattrapage quand il existe », and
   * the two refusals by `tests/ws/delivery.test.ts`, « un curseur plus ancien
   * que la fenêtre retenue retombe sur un instantané » and « un curseur en
   * avance sur le serveur retombe sur un instantané ».
   */
  catchUpFrom(campaignId: CampaignId, playerId: PlayerId, since: number | null): Catchup {
    const stream = this.rooms.get(campaignId)?.streams.get(playerId);
    if (stream === undefined) return { kind: 'snapshot', reason: 'flux inconnu' };
    if (since === null) return { kind: 'snapshot', reason: 'aucun curseur' };

    if (since > stream.head) {
      return { kind: 'snapshot', reason: 'curseur en avance sur le serveur' };
    }

    const missing = stream.tail.filter((entry) => entry.deliverySeq > since);
    if (stream.head - since > missing.length) {
      return { kind: 'snapshot', reason: 'curseur trop ancien' };
    }

    return { kind: 'batch', entries: missing };
  }

  /**
   * What this player's stream gained past `since`, straight from the tail.
   *
   * NOT `catchUpFrom`, AND THE DIFFERENCE MATTERS. `catchUpFrom` answers a
   * client's cursor and may refuse it — too old, ahead of the server — which
   * is right for a resume and wrong here: the caller has just sent a snapshot
   * built BEFORE `since` was read, and needs whatever arrived since, with no
   * second opinion. See `handlers.ts`, `flushAfterSnapshot`.
   *
   * When the tail has rolled past `since`, this returns what it still holds
   * and the entries come back with a hole in `deliverySeq` — which the client
   * sees and answers with a `c2s.resume` (`client/src/ws/store.ts`). A visible
   * hole is recoverable; a silent one is not.
   *
   * THE DIFFERENCE IS MEASURED, NOT STATED, by `tests/ws/snapshot-race.test.ts`,
   * « sert le lot partiel que la file retient encore quand elle a roulé pendant
   * la fenêtre — `c2s.hello` » and the same title ending in « — `c2s.resume` »:
   * the tail rolls during the window, this call serves the entries it still
   * holds, and the same cursor handed to `catchUpFrom` comes back « curseur
   * trop ancien » — which would write NOTHING. Both tests assert that second
   * reading too, so the substitution is refused by name.
   */
  deliveredSince(
    campaignId: CampaignId,
    playerId: PlayerId,
    since: number,
  ): readonly DeliveredEntry[] {
    const stream = this.rooms.get(campaignId)?.streams.get(playerId);
    if (stream === undefined) return [];
    return stream.tail.filter((entry) => entry.deliverySeq > since);
  }

  // --------------------------------------------------------- the delivery

  /**
   * Hands a batch of journalled events to everyone entitled to them.
   *
   * ORDER IS THE POINT. Events are delivered in `seq` order, and each player's
   * `deliverySeq` therefore increases by exactly one per frame — the "sans
   * trou" guarantee of ARCHITECTURE.md section 6, moved onto the counter for
   * which it is still true. Held by `tests/ws/delivery.test.ts`, « livre 50
   * événements dans l'ordre strict, sans trou de livraison ».
   */
  broadcast(campaignId: CampaignId, events: readonly PersistedEvent[]): void {
    const room = this.rooms.get(campaignId);
    if (room === undefined) return;

    for (const event of events) {
      for (const [playerId, stream] of room.streams) {
        if (stream.hydrating) {
          stream.pending.push(event);
          continue;
        }
        const entry = this.appendVisible(stream, event, playerId);
        if (entry === null) continue;
        for (const connection of room.connections) {
          if (connection.session.playerId !== playerId) continue;
          connection.sendEvent(entry);
        }
      }
    }
  }

  /**
   * Counts one event into one player's stream, if that player may see it.
   *
   * Returns the entry when it was counted, `null` when it was not visible or
   * was already counted. `null` is what stops a frame from being written.
   */
  private appendVisible(
    stream: PlayerStream,
    event: PersistedEvent,
    playerId: string,
  ): DeliveredEntry | null {
    if (event.seq <= stream.lastSeq) return null;
    stream.lastSeq = event.seq;

    if (!isVisibleTo(event, playerId)) return null;

    stream.head += 1;
    const entry: DeliveredEntry = { seq: event.seq, deliverySeq: stream.head, event };
    stream.tail.push(entry);
    if (stream.tail.length > WS_DELIVERY_TAIL_MAX) {
      stream.tail = stream.tail.slice(stream.tail.length - WS_DELIVERY_TAIL_MAX);
    }
    return entry;
  }

  // --------------------------------------------------------- the presence

  presence(campaignId: CampaignId): readonly PresenceMember[] {
    const room = this.rooms.get(campaignId);
    if (room === undefined) return [];
    return [...room.connections].map((connection) => connection.member);
  }

  /**
   * Everyone at the table learns who is there — `tests/ws/handshake.test.ts`,
   * « diffuse la présence à toute la table quand quelqu'un arrive — Y COMPRIS
   * au nouvel arrivant ». Ephemeral, never journalled: « la présence est
   * éphémère : elle ne passe jamais par le journal », in the same suite.
   */
  broadcastPresence(campaignId: CampaignId): void {
    const members = this.presence(campaignId);
    for (const connection of this.connectionsOf(campaignId)) {
      connection.sendPresence(members);
    }
  }

  // --------------------------------------------------------- the heartbeat

  /**
   * One beat, driven by the injected clock. Closed sockets leave the room —
   * `tests/ws/limits.test.ts`, « une connexion fermée quitte la salle ».
   */
  tick(now: number): void {
    for (const room of [...this.rooms.values()]) {
      for (const connection of [...room.connections]) {
        connection.tick(now);
        if (!connection.isOpen) this.detach(connection);
      }
    }
  }
}
