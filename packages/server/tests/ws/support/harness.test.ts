/**
 * The in-memory table every `tests/ws/**` suite drives: a pair of sockets, a
 * fake `CampaignService`, a simulated clock.
 *
 * A `.test.ts` THOUGH IT IS A SUPPORT FILE, following the precedent of
 * `packages/db/tests/support/campaign.test.ts` and
 * `packages/engine/tests/support/every-event.test.ts`: the flat ESLint config
 * maps `**\/*.test.ts` to `tsconfig.test.json` and everything else to the
 * project service, which only sees `src/**`. A plain `.ts` here would belong
 * to no TypeScript program and `pnpm lint` would stop on it. It carries its
 * own tests at the foot — a fixture that does not hold up is a suite that
 * measures nothing.
 *
 * EVERY IDENTIFIER IS ULID-SHAPED AND EVERY FRAME IDENTIFIER IS A UUID. Not
 * cosmetic: `zPlayerId` refuses `p1`, and `zMessageId` refuses a ULID. The
 * connection parses every frame it sends against `zS2CEnvelope`, so a fixture
 * with sloppy identifiers would fail inside the code under test and the suite
 * would be measuring its own strings.
 *
 * THE FAKE SERVICE COUNTS WHAT IT IS ASKED. `journal.length`, `submitCalls`
 * and `narrationsStarted` are what the "`c2s.why` mutates nothing" criterion
 * reads; a fake that merely returned canned answers could not tell a read
 * from a write.
 *
 * AND IT KEEPS WHAT IT IS HANDED, WHICH COUNTING ALONE DOES NOT. An earlier
 * version of this file declared `getSnapshot(campaignId)` and
 * `getTurnProof(campaignId, correlationId)` — ONE PARAMETER FEWER THAN THE
 * INTERFACE. TypeScript accepts that without a word, so `viewerId` did not
 * exist in the fixture and no assertion could reach it: the READING half of
 * ADR 0008 was guarded by nothing, and a server that served Alice Bob's
 * snapshot passed the whole suite. Same for the write: `submitIntent` counted
 * its calls and threw the input away, so neither the `playerId` the server
 * attributes the write to (invariant 3) nor the idempotence key was measured
 * anywhere. The fake now RECORDS every viewer, KEEPS every input, and ANSWERS
 * PER VIEWER — and `DOUBLE_ARITIES` below makes a fake that loses a
 * parameter again a compilation error rather than a silent hole.
 */

import { setImmediate } from 'node:timers';

import { describe, expect, it } from 'vitest';

import { staticContent } from '@for/content';
import type { TableStateDto, TurnProofDto } from '@for/contracts';
import { PROTOCOL_VERSION, zGameEvent, zPlayerId, zTableState, zTurnProof } from '@for/contracts';
import type { CampaignId, PlayerId, Result } from '@for/engine';
import { err, ok } from '@for/engine';

import type { TimeSource } from '../../../src/deps.js';
import { AppError } from '../../../src/errors.js';
import type {
  CampaignService,
  PersistedEvent,
  SubmitIntentInput,
  SubmitIntentResult,
  TurnProofResult,
} from '../../../src/game/types.js';
import type {
  CampaignAccess,
  FrameIdSource,
  NarrationReplay,
  TableConnection,
  TableHub,
  WsLogger,
  WsSocket,
} from '../../../src/ws/index.js';
import { attachSocket, createTableHub } from '../../../src/ws/index.js';

// ───────────────────────────────────────────────────────────── identifiers

/** Crockford base32, the 32 symbols a ULID is written in. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A distinct, valid ULID per number. First symbol `0`, as the shape demands. */
export function anId(n: number): string {
  let rest = n;
  let tail = '';
  for (let i = 0; i < 25; i += 1) {
    tail = CROCKFORD.charAt(rest % 32) + tail;
    rest = Math.floor(rest / 32);
  }
  return `0${tail}`;
}

/** A distinct, valid UUID per number — what `zMessageId` and `zCorrelationId` want. */
export function aUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

export const CAMPAIGN = anId(1) as CampaignId;
export const OTHER_CAMPAIGN = anId(2) as CampaignId;
export const ALICE = anId(10) as PlayerId;
export const BOB = anId(11) as PlayerId;

// ─────────────────────────────────────────────────────────────── the socket

export interface CloseRecord {
  readonly code: number;
  readonly reason: string | undefined;
}

/**
 * A transport that keeps the BYTES.
 *
 * The suites assert on `sent`, the raw strings, and not on objects the hub
 * handed over: the ADR 0008 question is what left the server, and an
 * assertion on an intermediate structure could be satisfied by a frame that
 * was built and then filtered by the client.
 */
export class FakeSocket implements WsSocket {
  readonly sent: string[] = [];

  readonly closes: CloseRecord[] = [];

  /** While true the transport never acknowledges: the queue never drains. */
  stalled = false;

  /** The acknowledgements held back while `stalled`. `drain()` runs them. */
  private readonly held: (() => void)[] = [];

  send(data: string, onFlushed?: () => void): void {
    this.sent.push(data);
    if (this.stalled) {
      if (onFlushed !== undefined) this.held.push(onFlushed);
      return;
    }
    onFlushed?.();
  }

  /**
   * The transport catches up: every held acknowledgement fires.
   *
   * A REAL TRANSPORT DOES THIS, and nothing measured the server's behaviour
   * afterwards. It is how the socket's collapsed flag gets a chance to rearm.
   */
  drain(): void {
    this.stalled = false;
    const pending = this.held.splice(0, this.held.length);
    for (const ack of pending) ack();
  }

  close(code: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  frames(): { t: string; p: Record<string, unknown> }[] {
    return this.sent.map((line) => JSON.parse(line) as { t: string; p: Record<string, unknown> });
  }

  types(): string[] {
    return this.frames().map((frame) => frame.t);
  }

  of(type: string): { t: string; p: Record<string, unknown> }[] {
    return this.frames().filter((frame) => frame.t === type);
  }

  clear(): void {
    this.sent.length = 0;
    this.closes.length = 0;
  }
}

// ──────────────────────────────────────────────────────────────── the clock

export class FakeClock implements TimeSource {
  constructor(private current = 1_700_000_000_000) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    this.current += ms;
    return this.current;
  }
}

/** UUIDs, minted in order, so a failing assertion names a frame. */
export class CountingFrameIds implements FrameIdSource {
  private n = 0;

  next(): string {
    this.n += 1;
    return aUuid(this.n);
  }
}

/** ULIDs, for `s2c.error.requestId`. */
export class CountingIds {
  private n = 1000;

  next(): string {
    this.n += 1;
    return anId(this.n);
  }
}

export const SILENT_LOGGER: WsLogger = { warn: () => undefined };

/** A logger that KEEPS what it was told. Used where the drop is the point. */
export class RecordingLogger implements WsLogger {
  readonly warnings: { context: object; message: string }[] = [];

  warn(context: object, message: string): void {
    this.warnings.push({ context, message });
  }
}

// ──────────────────────────────────────────────────────────── the scheduler

/** A promise a probe opens by hand, to hold an `await` exactly where it is. */
export class Gate {
  private release: (() => void) | null = null;

  readonly closed = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  open(): void {
    this.release?.();
  }
}

/**
 * Lets every pending microtask run, so a routine suspended on an `await`
 * really is suspended when the probe looks at it.
 *
 * A macrotask, on purpose: the microtask queue is drained before it fires,
 * whatever its depth, so a probe never has to guess how many `await`s stand
 * between the call and the suspension point.
 */
export function letAwaitsRun(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

// ────────────────────────────────────────────────────────────── the events

export interface EventInput {
  readonly seq: number;
  readonly scope: 'table' | 'subset' | 'private';
  readonly recipients?: readonly string[] | null;
  readonly campaignId?: CampaignId;
  readonly correlationId?: string | null;
  readonly text?: string;
}

/**
 * One journalled event. `system.note` because it is the cheapest of the 71
 * variants that still carries a real payload — the suites are about delivery,
 * not about any one event's meaning.
 */
export function anEvent(input: EventInput): PersistedEvent {
  return {
    id: anId(5000 + input.seq),
    campaignId: input.campaignId ?? CAMPAIGN,
    seq: input.seq,
    playSessionId: null,
    type: 'system.note',
    payloadVersion: 1,
    payload: { text: input.text ?? `note ${String(input.seq)}`, byPlayerId: ALICE },
    actorKind: 'system',
    actorPlayerId: null,
    subjectCharacterId: null,
    correlationId: input.correlationId ?? null,
    causationId: null,
    rngStream: null,
    rngDrawIndex: null,
    scope: input.scope,
    recipients: input.recipients ?? null,
    createdAt: 1_700_000_000_000,
  };
}

// ─────────────────────────────────────────────────────────── the characters

/**
 * One character of the table state, valid against `zCharacterState`.
 *
 * WRITTEN OUT HERE AND NOT IMPORTED FROM `@for/testkit`: that package is not a
 * dependency of `@for/server`, and adding it means editing
 * `packages/server/package.json`, which M0-25's file list does not carry. The
 * fixture holds up on its own — `zTableState` parses it at the foot of this
 * file, and the connection parses it again on every frame that carries it.
 */
export function aCharacter(id: string, playerId: PlayerId): TableStateDto['characters'][number] {
  return {
    id,
    playerId,
    championId: 'ashe',
    displayName: 'Ashe des glaces',
    sheet: { championId: 'ashe', source: 'handwritten', ref: 'content:champions/ashe@1.0.0' },
    attributes: { vif: 2, coeur: 3, fer: 2, ombre: 1, esprit: 1 },
    gauges: { vigueur: 5, ame: 5, vivres: 5 },
    momentum: 2,
    momentumBounds: { min: -6, max: 10, reset: 2 },
    xpEarned: 0,
    xpSpent: 0,
    conditions: [],
    assets: [],
    status: 'active',
    createdSeq: 1,
    updatedSeq: 1,
  } as unknown as TableStateDto['characters'][number];
}

/** Alice's character, and the identifier her `s2c.welcome` must carry. */
export const ALICE_CHARACTER = anId(20);

// ───────────────────────────────────────────────────────────── the service

const EMPTY_STATE = (
  campaignId: CampaignId,
  characters: TableStateDto['characters'],
  truths: TableStateDto['truths'] = [],
) =>
  ({
    campaignId,
    seq: 0,
    status: 'active',
    contentPackHash: 'hash-de-test',
    settings: {
      schemaVersion: 1,
      models: { narration: null, structured: null },
      gmVerbosity: 'standard',
      oracleBias: 'neutre',
      safety: { lines: [], veils: [] },
      allowForgedChampions: true,
      requireForgeReview: false,
    },
    truths,
    characters,
    tracks: [],
    clocks: [],
    entities: [],
    championLocks: [],
    scene: null,
    party: { memberPlayerIds: [ALICE, BOB], ownerPlayerId: ALICE },
  }) as unknown as TableStateDto;

/**
 * Where a proof is filed. THE VIEWER IS PART OF THE KEY, on purpose: since
 * ADR 0008 « what happened » has no single answer, so a store keyed by
 * campaign alone could not tell Alice's proof from Bob's — and no test could
 * then catch a server that served the wrong one.
 */
export function proofKey(campaignId: string, correlationId: string, viewerId: string): string {
  return `${campaignId}|${correlationId}|${viewerId}`;
}

/**
 * The service the hub routes to. It COUNTS, so that a read can be told from a
 * write by something other than good intentions — and it REMEMBERS WHO ASKED,
 * so that the answer can be told from another player's answer.
 */
export class FakeCampaignService implements CampaignService {
  readonly journal: PersistedEvent[] = [];

  /** Keyed by `proofKey`: a proof belongs to one table AND to one viewer. */
  readonly proofs = new Map<string, TurnProofResult>();

  /**
   * What each viewer's projection answers, read BY VIEWER and never globally.
   * `truths` is the cheapest field of `zTableState` that carries a list, and
   * the point is only that the state DEPENDS on who asked for it.
   */
  readonly truthsByViewer = new Map<string, TableStateDto['truths']>();

  /** Every `viewerId` handed to `getSnapshot`, in order. */
  readonly snapshotViewers: string[] = [];

  /** Every `viewerId` handed to `getTurnProof`, in order. */
  readonly proofViewers: string[] = [];

  /** Every `SubmitIntentInput` the server built, KEPT WHOLE, in order. */
  readonly submits: SubmitIntentInput[] = [];

  submitCalls = 0;

  readCalls = 0;

  snapshotCalls = 0;

  proofCalls = 0;

  /** Stands in for the out-of-band storyteller. A read must never move it. */
  narrationsStarted = 0;

  /** Set by a probe to check that the "mutates nothing" suite really bites. */
  mutateOnProof = false;

  characters: TableStateDto['characters'] = [];

  /** The last input the server handed over, or `null` if it never wrote. */
  get lastSubmit(): SubmitIntentInput | null {
    return this.submits.at(-1) ?? null;
  }

  submitIntent(input: SubmitIntentInput): Promise<Result<SubmitIntentResult, AppError>> {
    this.submitCalls += 1;
    this.submits.push(input);
    if ((input.intent as { type: string }).type === 'campaign.leave') {
      return Promise.resolve(
        err(new AppError('forbidden_campaign', 403, 'La table te refuse ce geste.')),
      );
    }
    const event = anEvent({
      seq: this.journal.length + 1,
      scope: 'table',
      campaignId: input.campaignId,
    });
    this.journal.push(event);
    this.narrationsStarted += 1;
    return Promise.resolve(ok({ accepted: true, events: [event] }));
  }

  /**
   * Set by a probe to suspend `getSnapshot` AFTER its state has been frozen.
   *
   * That is the shape of the real thing: a read that has already decided what
   * it will answer, and has not answered yet. Anything committed while it is
   * suspended belongs to neither the state it returns nor — without the flush
   * — to anything the player is sent.
   */
  suspendSnapshot: (() => Promise<void>) | null = null;

  async getSnapshot(
    campaignId: CampaignId,
    viewerId: PlayerId,
  ): Promise<{ state: TableStateDto; lastSeq: number }> {
    this.snapshotCalls += 1;
    this.snapshotViewers.push(viewerId);
    const frozen = {
      state: EMPTY_STATE(campaignId, this.characters, this.truthsByViewer.get(viewerId) ?? []),
      lastSeq: this.journal.length,
    };
    if (this.suspendSnapshot !== null) await this.suspendSnapshot();
    return frozen;
  }

  readEventsSince(campaignId: CampaignId, seq: number): Promise<readonly PersistedEvent[]> {
    this.readCalls += 1;
    return Promise.resolve(
      this.journal.filter((event) => event.campaignId === campaignId && event.seq > seq),
    );
  }

  getTurnProof(
    campaignId: CampaignId,
    correlationId: string,
    viewerId: PlayerId,
  ): Promise<TurnProofResult | null> {
    this.proofCalls += 1;
    this.proofViewers.push(viewerId);
    if (this.mutateOnProof) {
      this.journal.push(anEvent({ seq: this.journal.length + 1, scope: 'table', campaignId }));
    }
    return Promise.resolve(this.proofs.get(proofKey(campaignId, correlationId, viewerId)) ?? null);
  }

  /** Appends straight to the journal, the way a committed turn would. */
  commit(events: readonly PersistedEvent[]): void {
    for (const event of events) this.journal.push(event);
  }
}

/**
 * ═══ LE FAUX REÇOIT-IL TOUT CE QUE LE VRAI REÇOIT ? ════════════════════════
 *
 * TypeScript accepte une méthode qui déclare MOINS de paramètres que celle
 * qu'elle implémente. Un `getSnapshot(campaignId)` satisfait donc
 * `getSnapshot(campaignId, viewerId)` sans un mot, et le paramètre absent
 * cesse d'exister pour toute la suite : aucune assertion ne peut plus porter
 * dessus. Mesuré : `viewerId` et `playerId` remplacés par une chaîne vide dans
 * le code de production laissaient 153 tests verts.
 *
 * DEUX FILETS, parce qu'ils n'ont pas la même maille : celui-ci rougit à la
 * COMPILATION (`pnpm typecheck:tests`, job 4 de la CI) dès qu'une arité
 * diverge ; celui du pied de ce fichier la relit à l'EXÉCUTION.
 */
type Arity<F> = F extends (...args: infer A) => unknown ? A['length'] : never;

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export type DoubleArities = [
  Exactly<Arity<FakeCampaignService['submitIntent']>, Arity<CampaignService['submitIntent']>>,
  Exactly<Arity<FakeCampaignService['getSnapshot']>, Arity<CampaignService['getSnapshot']>>,
  Exactly<Arity<FakeCampaignService['readEventsSince']>, Arity<CampaignService['readEventsSince']>>,
  Exactly<Arity<FakeCampaignService['getTurnProof']>, Arity<CampaignService['getTurnProof']>>,
  Exactly<Arity<AccessStub['check']>, Arity<CampaignAccess['check']>>,
  Exactly<Arity<FakeSocket['send']>, Arity<WsSocket['send']>>,
  Exactly<Arity<FakeSocket['close']>, Arity<WsSocket['close']>>,
  Exactly<Arity<RecordingLogger['warn']>, Arity<WsLogger['warn']>>,
];

/**
 * Une arité qui diverge rend un `never` ci-dessus, et cette ligne ne compile
 * plus. LES HUIT SONT CELLES QUI PEUVENT PERDRE QUELQUE CHOSE : `now()` et
 * `next()` ne prennent aucun paramètre, il n'y a rien à y oublier.
 */
export const DOUBLE_ARITIES: DoubleArities = [true, true, true, true, true, true, true, true];

/** A minimal proof, valid against `zTurnProof`. */
export function aProof(correlationId: string): TurnProofDto {
  return zTurnProof.parse({
    correlationId,
    firstSeq: 1,
    lastSeq: 2,
    status: 'applied',
    revertedBy: null,
    move: null,
    roll: null,
    revision: null,
    effects: [],
    price: null,
    presage: null,
    narration: null,
  });
}

// ──────────────────────────────────────────────────────────── the table

/**
 * The auth layer (M0-23), as the handshake sees it.
 *
 * IL RETIENT CE QU'ON LUI DEMANDE. Un `check()` sans paramètre — ce qu'il
 * était — satisfait `check(campaignId, playerId)` sans un mot, et la question
 * posée à l'autorisation cesse alors d'exister pour la suite : mesuré,
 * `access.check('', '')` dans `authorizeHandshake` laissait 189 tests verts.
 * C'est l'invariant 3 à la porte d'entrée, donc il se mesure.
 */
export class AccessStub implements CampaignAccess {
  verdict: 'ok' | 'forbidden' | 'not_found' = 'ok';

  /** Chaque couple (campagne, joueur) soumis à l'autorisation, dans l'ordre. */
  readonly asked: { campaignId: string; playerId: string }[] = [];

  check(campaignId: string, playerId: string): Promise<'ok' | 'forbidden' | 'not_found'> {
    this.asked.push({ campaignId, playerId });
    return Promise.resolve(this.verdict);
  }
}

/** One c2s frame, serialised the way a browser would send it. */
export function c2s(type: string, payload: unknown, id: string): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, t: type, id, p: payload });
}

export interface OpenSocket {
  readonly connection: TableConnection;
  readonly socket: FakeSocket;
}

/**
 * A live table: one hub, one fake service, one simulated clock, and as many
 * sockets as a suite needs.
 */
export class Table {
  readonly service = new FakeCampaignService();

  readonly clock = new FakeClock();

  readonly access = new AccessStub();

  readonly hub: TableHub;

  /** Swapped for a `RecordingLogger` where what was dropped is the point. */
  logger: WsLogger = SILENT_LOGGER;

  private frames = 0;

  constructor(readonly narration?: NarrationReplay) {
    this.hub = createTableHub(this.service);
  }

  /** The next c2s frame identifier. Distinct per call, valid as a UUID. */
  nextFrameId(): string {
    this.frames += 1;
    return aUuid(100_000 + this.frames);
  }

  /**
   * `playerId: null` is "no valid session", `campaignId: null` is "no
   * `?campaignId=`" — the two handshake refusals, expressed as inputs rather
   * than as a second code path in the fixture.
   */
  async connect(
    playerId: PlayerId | null,
    campaignId: CampaignId | null = CAMPAIGN,
  ): Promise<{ socket: FakeSocket; connection: TableConnection | null }> {
    const socket = new FakeSocket();
    const connection = await attachSocket({
      hub: this.hub,
      socket,
      request: { session: playerId === null ? null : { playerId }, campaignId },
      access: this.access,
      service: this.service,
      content: staticContent(),
      clock: this.clock,
      ids: new CountingIds(),
      frameIds: new CountingFrameIds(),
      logger: this.logger,
      ...(this.narration === undefined ? {} : { narration: this.narration }),
    });
    return { connection, socket };
  }

  /** Connect, then say hello. What every suite but the handshake one starts with. */
  async join(playerId: PlayerId, lastDeliverySeq: number | null = null): Promise<OpenSocket> {
    const opened = await this.connect(playerId);
    if (opened.connection === null) throw new Error('la poignée de main a été refusée');
    await opened.connection.receive(
      c2s('c2s.hello', { clientVersion: '0.0.0-test', lastDeliverySeq }, this.nextFrameId()),
    );
    return { connection: opened.connection, socket: opened.socket };
  }
}

// ───────────────────────────────────────────────────────── the fixture holds

describe('le harnais des suites WebSocket', () => {
  it('produit des identifiants que les schémas gelés acceptent', () => {
    expect(zPlayerId.safeParse(ALICE).success).toBe(true);
    expect(zPlayerId.safeParse(BOB).success).toBe(true);
    expect(ALICE).not.toBe(BOB);
  });

  it('produit des événements que zGameEvent accepte, dans les trois portées', () => {
    expect(zGameEvent.safeParse(anEvent({ seq: 1, scope: 'table' })).success).toBe(true);
    expect(
      zGameEvent.safeParse(anEvent({ seq: 2, scope: 'private', recipients: [ALICE] })).success,
    ).toBe(true);
    expect(
      zGameEvent.safeParse(anEvent({ seq: 3, scope: 'subset', recipients: [ALICE, BOB] })).success,
    ).toBe(true);
  });

  it('produit un état de table que zTableState accepte', () => {
    expect(zTableState.safeParse(EMPTY_STATE(CAMPAIGN, [])).success).toBe(true);
  });

  it('produit un personnage que zTableState accepte, rattaché à son joueur', () => {
    const state = EMPTY_STATE(CAMPAIGN, [aCharacter(ALICE_CHARACTER, ALICE)]);
    const parsed = zTableState.safeParse(state);
    expect(parsed.success).toBe(true);
    // Sans ce rattachement, le test de `s2c.welcome.you` mesurerait un `null`
    // qui vient de la fixture et non du serveur.
    expect(state.characters[0]?.playerId).toBe(ALICE);
    expect(state.characters[0]?.id).toBe(ALICE_CHARACTER);
  });

  it('retient les acquittements pendant que le transport est bloqué, et les rend au drain', () => {
    const socket = new FakeSocket();
    let flushed = 0;
    socket.stalled = true;
    socket.send('a', () => {
      flushed += 1;
    });
    socket.send('b', () => {
      flushed += 1;
    });
    expect(flushed).toBe(0);

    socket.drain();
    expect(flushed).toBe(2);
    expect(socket.sent).toStrictEqual(['a', 'b']);
  });

  it('suspend `getSnapshot` après avoir figé son état, et le rend au déverrouillage', async () => {
    const service = new FakeCampaignService();
    const gate = new Gate();
    service.suspendSnapshot = () => gate.closed;

    const inFlight = service.getSnapshot(CAMPAIGN, ALICE);
    await letAwaitsRun();
    // L'état est figé — `lastSeq` vaut 0 — mais rien n'est rendu encore.
    expect(service.snapshotCalls).toBe(1);
    service.commit([anEvent({ seq: 1, scope: 'table' })]);

    gate.open();
    expect((await inFlight).lastSeq).toBe(0);
  });

  it('compte les écritures et les lectures séparément', async () => {
    const service = new FakeCampaignService();
    await service.submitIntent({
      campaignId: CAMPAIGN,
      playerId: ALICE,
      intentId: aUuid(1),
      intent: { type: 'play_session.begin' },
    });
    expect(service.journal).toHaveLength(1);
    expect(service.narrationsStarted).toBe(1);

    await service.getTurnProof(CAMPAIGN, aUuid(9), ALICE);
    expect(service.journal).toHaveLength(1);
    expect(service.narrationsStarted).toBe(1);

    // Et il RETIENT ce qu'on lui a passé : sans cette ligne, « le serveur a
    // écrit » et « le serveur a écrit CECI » resteraient le même test.
    expect(service.lastSubmit).toStrictEqual({
      campaignId: CAMPAIGN,
      playerId: ALICE,
      intentId: aUuid(1),
      intent: { type: 'play_session.begin' },
    });
  });

  it("déclare exactement les paramètres de l'interface, jamais un de moins", () => {
    const fake = new FakeCampaignService();

    // LES QUATRE ARITÉS VIENNENT DE `src/game/types.ts`, écrites en toutes
    // lettres : c'est la déclaration de l'interface, et elle n'existe nulle
    // part ailleurs sous une forme qu'un test puisse lire à l'exécution.
    // `Function.prototype.length` compte les paramètres déclarés.
    expect(fake.submitIntent.length).toBe(1);
    expect(fake.getSnapshot.length).toBe(2);
    expect(fake.readEventsSince.length).toBe(2);
    expect(fake.getTurnProof.length).toBe(3);

    // `CampaignAccess.check(campaignId, playerId)`, `WsSocket.send(data,
    // onFlushed?)` et `close(code, reason?)`, `WsLogger.warn(context, message)`.
    expect(new AccessStub().check.length).toBe(2);
    expect(new FakeSocket().send.length).toBe(2);
    expect(new FakeSocket().close.length).toBe(2);
    expect(new RecordingLogger().warn.length).toBe(2);

    // Le filet de compilation, relu ici pour qu'il ne soit pas du code mort.
    expect(DOUBLE_ARITIES).toStrictEqual(Array.from({ length: 8 }, () => true));
  });

  it('rend un état ET une preuve qui dépendent du destinataire', async () => {
    const service = new FakeCampaignService();
    const turn = aUuid(9);
    service.truthsByViewer.set(ALICE, [
      { truthId: 'la-veille-d-alice', optionId: 'oui', customText: null },
    ]);
    service.proofs.set(proofKey(CAMPAIGN, turn, BOB), { proof: aProof(turn), truncated: false });

    // Deux destinataires, deux réponses. Sans cette dépendance, remplacer le
    // destinataire par n'importe quoi rendrait exactement le même état.
    expect((await service.getSnapshot(CAMPAIGN, ALICE)).state.truths).toStrictEqual([
      { truthId: 'la-veille-d-alice', optionId: 'oui', customText: null },
    ]);
    expect((await service.getSnapshot(CAMPAIGN, BOB)).state.truths).toStrictEqual([]);
    expect(await service.getTurnProof(CAMPAIGN, turn, BOB)).not.toBeNull();
    expect(await service.getTurnProof(CAMPAIGN, turn, ALICE)).toBeNull();

    expect(service.snapshotViewers).toStrictEqual([ALICE, BOB]);
    expect(service.proofViewers).toStrictEqual([BOB, ALICE]);
  });
});
