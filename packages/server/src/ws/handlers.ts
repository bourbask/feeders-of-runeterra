/**
 * The routing of the eight `c2s.*` frames, and the rate limiting of section
 * 5.6. Nothing here decides anything: every routine either asks
 * `CampaignService` or asks `TableHub`, and forwards the answer — the grep of
 * the acceptance criterion covers this file too, `tests/ws/routing.test.ts`,
 * describe « le hub ne décide rien (invariant 1) ».
 *
 * ══ `c2s.why` IS A READ, AND IT IS PROVEN TO BE ONE (P22) ══════════════════
 *
 * `handleWhy` calls `CampaignService.getTurnProof` and sends the result. It
 * does not read the journal, does not project anything, does not build a
 * proof and does not roll a die to display one. A `correlationId` the
 * campaign does not own comes back `null` from the service and is answered as
 * unknown — NEVER served from another table, which is why the campaign
 * identifier passed to the service is the SOCKET's, never the client's: the
 * frame carries one field and it is not a campaign.
 *
 * HELD BY `tests/ws/why.test.ts`: « ne mute rien après 100 appels : ni le
 * journal, ni une narration » with its counter-probe « et le compteur mord :
 * une lecture qui écrirait ferait tomber le test précédent », « interroge le
 * service avec la campagne DE LA SOCKET, pas une campagne fournie par le
 * client », « un `correlationId` d'une AUTRE campagne est traité comme
 * inconnu, jamais servi » and « demande la preuve DU JOUEUR DE LA SOCKET, et
 * sert la sienne, pas celle du voisin ».
 *
 * ══ TWO THINGS ABOUT THE RATE LIMITER THAT ARE NOT OBVIOUS ════════════════
 *
 *   1. `WS_RATE_LIMITS.burst` IS NOT HONOURED, AND IT CANNOT BE. The frozen
 *      table gives `c2s.intent` `{ count: 5, windowMs: 10_000, burst: 10 }`,
 *      while the acceptance criterion of M0-25 reads "six `c2s.intent` in 10 s
 *      raise `s2c.error { code: 'rate_limited' }`". Under any reading of
 *      `burst` that tolerates ten frames in a burst, the sixth is accepted and
 *      the criterion is false; under the criterion, `burst` is dead. The two
 *      cannot both hold. The criterion wins here because it is what M0-25 is
 *      measured on, and the contradiction is reported rather than papered
 *      over — see the PR. The criterion's side is held by
 *      `tests/ws/limits.test.ts`, « accepte cinq `c2s.intent` en 10 s et refuse
 *      le sixième »; `burst` is read by nothing, here or anywhere.
 *   2. `c2s.typing` OVERRUNS ARE DROPPED IN SILENCE, not answered and not
 *      counted as a strike. Section 5.6 spells that row out: "échantillonné à
 *      1/s côté client, ignoré au-delà côté serveur". Erroring on it would
 *      close a socket over a keystroke. Held by `tests/ws/limits.test.ts`,
 *      « `c2s.typing` au-delà de sa cadence est ignoré, pas refusé, et ne
 *      compte pas de faute ».
 *
 * THE ROUTE TABLE IS A `Record<C2SMessageType, …>`, not a switch. A frame type
 * the protocol has and this file has not is then a COMPILATION error, and
 * `tests/ws/routing.test.ts`, « route exactement les huit trames que le
 * protocole déclare », compares its keys to `c2sMessageTypesOfSchema()` —
 * derived on both sides — plus the number the task sheet writes out; « répond
 * à chacune des huit sans jamais fermer la socket » drives all eight.
 */

import { contentVersion } from '@for/content';
import { WS_RATE_LIMIT_STRIKES_BEFORE_CLOSE, WS_RATE_LIMITS } from '@for/contracts';

import type { ContentRegistry } from '@for/content';
import type { C2SMessage, C2SMessageType, WsRateLimit } from '@for/contracts';
import type { CharacterId, Intent } from '@for/engine';
import type { TimeSource } from '../deps.js';
import type { CampaignService } from '../game/types.js';
import type { NarrationStatus, TableConnection } from './connection.js';
import type { TableHub } from './hub.js';

// ───────────────────────────────────────────────────────── the rate limiter

export type RateVerdict = 'ok' | 'error' | 'close' | 'drop';

/**
 * The frames whose overrun is ignored instead of refused (section 5.6).
 * A list, so that adding one is a visible edit rather than a condition.
 *
 * IT IS WALKED, NOT PINNED: empty it and `tests/ws/limits.test.ts`,
 * « `c2s.typing` au-delà de sa cadence est ignoré, pas refusé, et ne compte pas
 * de faute », goes red — the overrun becomes an `s2c.error`.
 */
const SILENTLY_DROPPED: readonly C2SMessageType[] = ['c2s.typing'];

/**
 * Per connection, per frame type, sliding window.
 *
 * Strikes are counted PER CONNECTION and not per bucket: section 5.6 says
 * "puis fermeture 4008 au troisième" under a table of per-connection limits,
 * and a client that alternates between two buckets to stay under three
 * strikes each would be exactly the loop the rule exists to stop.
 *
 * HELD BY `tests/ws/limits.test.ts`, « les fautes se comptent PAR CONNEXION,
 * pas par seau : trois dépassements sur deux seaux ferment » — two buckets, so
 * a per-bucket counter would still be at two and would not close.
 */
/**
 * The frozen table of section 5.6, widened to the shape this file reads it
 * through. `WS_RATE_LIMITS` is `as const satisfies Partial<Record<…>>`, so its
 * own type only has the five keys it declares; indexing it by an arbitrary
 * frame type needs the declared shape, not the inferred one. Same object,
 * named once — emptying the table in `@for/contracts` makes every bucket
 * vanish here, and `tests/ws/limits.test.ts`, « les seaux viennent de la table
 * gelée : un type sans seau passe toujours », reads that table rather than a
 * copy of it.
 */
const LIMITS: Partial<Record<C2SMessageType, WsRateLimit>> = WS_RATE_LIMITS;

export class WsRateLimiter {
  private readonly hits = new Map<string, number[]>();

  private strikes = 0;

  check(type: C2SMessageType, now: number): RateVerdict {
    const limit = LIMITS[type];
    if (limit === undefined) return 'ok';

    const fresh = (this.hits.get(type) ?? []).filter((at) => now - at < limit.windowMs);
    this.hits.set(type, fresh);

    if (fresh.length < limit.count) {
      fresh.push(now);
      return 'ok';
    }

    if (SILENTLY_DROPPED.includes(type)) return 'drop';

    this.strikes += 1;
    return this.strikes >= WS_RATE_LIMIT_STRIKES_BEFORE_CLOSE ? 'close' : 'error';
  }
}

// ──────────────────────────────────────────────────────────── the context

/**
 * How the narration buffer is reached. OWNED BY M0-29 (`src/ai/broadcast.ts`,
 * 01-architecture.md section 2.8), which is why this is a port and why it is
 * optional: `c2s.resume_narration` must be ROUTED by M0-25 — the task sheet
 * says eight frames — but the buffer it replays is not M0-25's to write. It
 * never triggers a second generation (02-mj-ia.md section 6.3) — held by
 * `tests/ws/routing.test.ts`, « rejoue le tampon quand il existe, et ne relance
 * jamais une génération », which also requires the campaign and the player of
 * the replay to come from the socket, and « annonce `aborted` quand le tampon
 * n'a plus rien ».
 */
export interface NarrationReplay {
  replay(input: {
    readonly campaignId: string;
    readonly playerId: string;
    readonly narrationId: string;
    readonly lastChunk: number;
  }): Promise<{
    readonly narrationId: string;
    readonly chunk: number;
    readonly text: string;
    readonly status: NarrationStatus;
  } | null>;
}

export interface HandlerDeps {
  readonly hub: TableHub;
  readonly service: CampaignService;
  readonly content: ContentRegistry;
  readonly clock: TimeSource;
  readonly narration?: NarrationReplay;
}

export interface HandlerContext {
  readonly deps: HandlerDeps;
  readonly connection: TableConnection;
  readonly limiter: WsRateLimiter;
}

// ───────────────────────────────────────────────────────────── the routines

/**
 * Writes whatever was delivered to this player past `since`.
 *
 * ══ THE WINDOW THIS CLOSES, AND WHY A SNAPSHOT ALONE LOSES EVENTS ═════════
 *
 * A snapshot answer is built from two readings taken at two instants: the
 * STATE comes from `getSnapshot`, which is awaited, and the CURSOR comes from
 * the hub, which keeps counting during that await. An event committed and
 * broadcast in between is then counted by the cursor and absent from the
 * state — and on `c2s.hello` the socket is not in the broadcast set yet, so it
 * is never written either. The client overwrites its state on the snapshot,
 * stores that cursor, and its gap detector can never fire: the next event
 * carries exactly the number it expects. Silent and final, and it breaks
 * invariant 4 as ADR 0008 hardens it — replaying that player's thread from the
 * journal would give back an event they never saw.
 *
 * So the cursor is read BEFORE the await, the snapshot is sent carrying THAT
 * number, and everything the stream gained since is written here, before the
 * socket joins the broadcast set. A duplicate is caught up — the snapshot has
 * just wiped the client's state, so re-applying is exact — a loss is not.
 *
 * HELD BY `tests/ws/snapshot-race.test.ts`, on both paths and in both
 * directions: « livre un événement diffusé pendant que la lecture est en vol —
 * `c2s.hello` », « ne laisse jamais un instantané écraser un événement plus
 * récent que lui — `c2s.resume` », « le rattrapage de la fenêtre reste adressé :
 * ce qui n'est pas pour Alice ne passe pas », « le rattrapage de la fenêtre ne
 * rejoue rien quand la fenêtre est vide », and — because the window may be
 * longer than what the hub still holds — « sert le lot partiel que la file
 * retient encore quand elle a roulé pendant la fenêtre », on both paths.
 *
 * AND IT IS `deliveredSince`, NOT `catchUpFrom`: see that method's header. The
 * two tests just named assert the substitution's outcome, so swapping them here
 * is refused by a test and not by a comment.
 */
function flushAfterSnapshot(ctx: HandlerContext, since: number): void {
  const { campaignId, playerId } = ctx.connection.session;
  for (const entry of ctx.deps.hub.deliveredSince(campaignId, playerId, since)) {
    ctx.connection.sendEvent(entry);
  }
}

async function handleHello(
  ctx: HandlerContext,
  message: Extract<C2SMessage, { t: 'c2s.hello' }>,
): Promise<void> {
  const { hub, service, content } = ctx.deps;
  const { campaignId, playerId } = ctx.connection.session;

  await hub.openStream(campaignId, playerId);

  // READ BEFORE THE AWAIT. See `flushAfterSnapshot` — this line and the next
  // one are the whole race, and their order is the fix.
  const head = hub.deliveryHead(campaignId, playerId);
  const snapshot = await service.getSnapshot(campaignId, playerId);

  let mine: CharacterId | null = null;
  for (const character of snapshot.state.characters) {
    if (character.playerId === playerId) mine = character.id;
  }
  ctx.connection.setCharacter(mine);

  ctx.connection.sendWelcome({
    characterId: mine,
    contentVersion: contentVersion(content.bundle.version, content.bundle.hash),
    lastSeq: snapshot.lastSeq,
    lastDeliverySeq: head,
  });

  const catchup = hub.catchUpFrom(campaignId, playerId, message.p.lastDeliverySeq);
  if (catchup.kind === 'batch') {
    // The catch-up is computed after the await, so it already carries whatever
    // landed during it. Nothing to flush.
    ctx.connection.sendBatch(catchup.entries);
  } else {
    ctx.connection.sendSnapshot(snapshot.state, snapshot.lastSeq, head);
    flushAfterSnapshot(ctx, head);
  }

  ctx.connection.markGreeted();
  hub.attach(ctx.connection);
  hub.broadcastPresence(campaignId);
}

/**
 * The only mutating frame. The engine decides inside `submitIntent`; this
 * routine hands over an `Intent` and broadcasts whatever came back already
 * journalled and already numbered.
 *
 * WHAT THE SERVER SIGNS IS MEASURED, with two actors and two callers:
 * `tests/ws/routing.test.ts`, « signe l'écriture avec la campagne, le joueur de
 * la socket et l'`id` de la trame — `c2s.intent` », « et la signe de la même
 * façon quand la parole passe par `c2s.speak` », « la clé d'idempotence change
 * à chaque trame : deux gestes ne sont jamais le même tour », and the refusal
 * path by « un refus du service devient `s2c.rejected`, jamais un événement ».
 */
async function submit(ctx: HandlerContext, intentId: string, intent: Intent): Promise<void> {
  const { hub, service } = ctx.deps;
  const { campaignId, playerId } = ctx.connection.session;

  const result = await service.submitIntent({ campaignId, playerId, intentId, intent });
  if (!result.ok) {
    ctx.connection.sendRejected(intentId, result.error.code, result.error.userMessage);
    return;
  }
  hub.broadcast(campaignId, result.value.events);
}

async function handleIntent(
  ctx: HandlerContext,
  message: Extract<C2SMessage, { t: 'c2s.intent' }>,
): Promise<void> {
  await submit(ctx, message.id, message.p.intent);
}

/**
 * Speech. `c2s.speak` BECOMES `speech.say` here — section 5.2 — and the two
 * fields it carries are the intent's own schema nodes, so nothing is
 * translated on the way. Held by `tests/ws/routing.test.ts`, « `c2s.speak`
 * devient une intention `speech.say`, jamais un chemin d'écriture à part »,
 * which sends both channels so that a hard-coded one cannot pass.
 */
async function handleSpeak(
  ctx: HandlerContext,
  message: Extract<C2SMessage, { t: 'c2s.speak' }>,
): Promise<void> {
  await submit(ctx, message.id, {
    type: 'speech.say',
    channel: message.p.channel,
    text: message.p.text,
  });
}

function handleTyping(
  ctx: HandlerContext,
  message: Extract<C2SMessage, { t: 'c2s.typing' }>,
): Promise<void> {
  ctx.connection.setTyping(message.p.typing);
  ctx.deps.hub.broadcastPresence(ctx.connection.session.campaignId);
  return Promise.resolve();
}

async function handleResume(
  ctx: HandlerContext,
  message: Extract<C2SMessage, { t: 'c2s.resume' }>,
): Promise<void> {
  const { hub, service } = ctx.deps;
  const { campaignId, playerId } = ctx.connection.session;

  const catchup = hub.catchUpFrom(campaignId, playerId, message.p.sinceDeliverySeq);
  if (catchup.kind === 'batch') {
    ctx.connection.sendBatch(catchup.entries);
    return;
  }

  // READ BEFORE THE AWAIT, same race as `handleHello` and worse on this path:
  // the socket IS attached, so an event of the window is written live and
  // would then be OVERWRITTEN by a snapshot older than itself. The flush puts
  // it back after the snapshot, which costs one duplicate frame. Measured by
  // `tests/ws/snapshot-race.test.ts`, « ne laisse jamais un instantané écraser
  // un événement plus récent que lui — `c2s.resume` », which reads the ORDER of
  // the bytes and not just their presence.
  const head = hub.deliveryHead(campaignId, playerId);
  const snapshot = await service.getSnapshot(campaignId, playerId);
  ctx.connection.sendSnapshot(snapshot.state, snapshot.lastSeq, head);
  flushAfterSnapshot(ctx, head);
}

function handlePong(ctx: HandlerContext): Promise<void> {
  ctx.connection.markPong(ctx.deps.clock.now());
  return Promise.resolve();
}

async function handleResumeNarration(
  ctx: HandlerContext,
  message: Extract<C2SMessage, { t: 'c2s.resume_narration' }>,
): Promise<void> {
  const replay = ctx.deps.narration;
  if (replay === undefined) {
    ctx.connection.sendError(
      'ai_unavailable',
      "La reprise de narration n'est pas encore branchée.",
      message.id,
    );
    return;
  }

  const { campaignId, playerId } = ctx.connection.session;
  const buffered = await replay.replay({
    campaignId,
    playerId,
    narrationId: message.p.narrationId,
    lastChunk: message.p.lastChunk,
  });

  if (buffered === null) {
    ctx.connection.sendNarrationError(message.p.narrationId, 'aborted');
    return;
  }
  ctx.connection.sendNarrationSnapshot(buffered);
}

/**
 * « Pourquoi ? ». The campaign identifier is the SOCKET's, and so is the
 * viewer: a proof from another table cannot be asked for, let alone served,
 * and a neighbour's proof is not served either — `tests/ws/why.test.ts`,
 * « interroge le service avec la campagne DE LA SOCKET, pas une campagne
 * fournie par le client » and « demande la preuve DU JOUEUR DE LA SOCKET, et
 * sert la sienne, pas celle du voisin ».
 */
async function handleWhy(
  ctx: HandlerContext,
  message: Extract<C2SMessage, { t: 'c2s.why' }>,
): Promise<void> {
  const { campaignId, playerId } = ctx.connection.session;
  const found = await ctx.deps.service.getTurnProof(campaignId, message.p.correlationId, playerId);

  if (found === null) {
    ctx.connection.sendError(
      'validation_failed',
      'Ce tour est introuvable dans cette campagne.',
      message.id,
    );
    return;
  }
  ctx.connection.sendTurnProof(message.p.correlationId, found.proof, found.truncated);
}

// ────────────────────────────────────────────────────────── the route table

type RouteTable = {
  readonly [T in C2SMessageType]: (
    ctx: HandlerContext,
    message: Extract<C2SMessage, { t: T }>,
  ) => Promise<void>;
};

/**
 * THE EIGHT. `Record<C2SMessageType, …>` and not `Partial<…>`: a ninth frame
 * added to the protocol stops this file from compiling, which is the only
 * kind of completeness that survives a refactor. The count and the names are
 * held at runtime too — `tests/ws/routing.test.ts`, « route exactement les huit
 * trames que le protocole déclare ».
 */
export const ROUTES: RouteTable = {
  'c2s.hello': handleHello,
  'c2s.intent': handleIntent,
  'c2s.speak': handleSpeak,
  'c2s.typing': handleTyping,
  'c2s.resume': handleResume,
  'c2s.pong': handlePong,
  'c2s.resume_narration': handleResumeNarration,
  'c2s.why': handleWhy,
};

/**
 * ONE CAST, HERE AND NOWHERE ELSE, and it is safe for a reason a reader can
 * check: `ROUTES[message.t]` is the routine declared for THAT discriminant,
 * so the frame it is handed is the frame it declared. TypeScript cannot join
 * the two sides of a mapped type through a union key; that is a limitation of
 * the checker, not a hole in the routing. What the cast could hide — a routine
 * handed the wrong frame — is what `tests/ws/routing.test.ts`, « répond à
 * chacune des huit sans jamais fermer la socket », drives: each of the eight
 * produces its own answer, and none produces a schema throw.
 */
function routineFor(
  type: C2SMessageType,
): (ctx: HandlerContext, message: C2SMessage) => Promise<void> {
  return ROUTES[type] as unknown as (ctx: HandlerContext, message: C2SMessage) => Promise<void>;
}

/**
 * The two frames a socket may send before `c2s.hello` has been answered: the
 * greeting itself, and the heartbeat, which the server started. BOTH
 * DIRECTIONS, in `tests/ws/routing.test.ts`: « refuse toute trame autre que
 * l'accueil tant que `c2s.hello` n'a pas répondu » and « le battement passe
 * avant l'accueil, et il repousse l'échéance ».
 */
const BEFORE_HELLO: readonly C2SMessageType[] = ['c2s.hello', 'c2s.pong'];

/**
 * One validated frame, rate-limited then routed.
 *
 * The limiter runs BEFORE the routine, on every frame including `c2s.pong`
 * and `c2s.hello` — which have no bucket and therefore always pass. Putting
 * it after would let a flood of expensive reads through: that the refused
 * frame never reaches the service is asserted by `tests/ws/limits.test.ts`,
 * « accepte cinq `c2s.intent` en 10 s et refuse le sixième » (`submitCalls`
 * stays at five), and the no-bucket half by « les seaux viennent de la table
 * gelée : un type sans seau passe toujours ».
 */
export async function routeMessage(ctx: HandlerContext, message: C2SMessage): Promise<void> {
  switch (ctx.limiter.check(message.t, ctx.deps.clock.now())) {
    case 'drop':
      return;
    case 'close':
      ctx.connection.closeWith('rate_limited');
      return;
    case 'error':
      ctx.connection.sendError('rate_limited', 'Trop de messages : ralentis.', message.id);
      return;
    case 'ok':
      break;
  }

  if (!ctx.connection.hasGreeted && !BEFORE_HELLO.includes(message.t)) {
    ctx.connection.sendError(
      'validation_failed',
      'Commence par `c2s.hello` : la session de table n’est pas ouverte.',
      message.id,
    );
    return;
  }

  await routineFor(message.t)(ctx, message);
}
