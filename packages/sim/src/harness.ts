/**
 * The harness: a real database, the real write path, the real hub, and a pair
 * of in-memory sockets per player.
 *
 * ── WHAT IS REAL HERE, AND WHAT IS NOT ───────────────────────────────────
 * REAL: the SQLite file and its migrations, `CampaignService`, the intent
 * pipeline, `@for/engine`, `@for/db`'s repositories and projections,
 * `attachSocket` / `routeMessage` / `TableHub` — every `c2s.*` this harness
 * sends is parsed by `zC2SEnvelope` and every `s2c.*` it reads was serialised
 * by `zS2CEnvelope`, on the server's own code path.
 * NOT REAL: the transport (two methods, in memory), the clock (fixed), the
 * identifier sources (counting), and the storyteller (`scripted-narrator.ts`,
 * no socket). Those four are exactly the non-deterministic things `AppDeps`
 * exists to inject.
 *
 * ── A DIVERGENCE FROM 01-architecture.md §7.4, REPORTED ──────────────────
 * §7.4 says "construit l'application avec `buildApp()` et des dépendances
 * injectées : […] `ScriptedNarrator` (implémentation du port)". THE TWO
 * HALVES OF THAT SENTENCE CANNOT BOTH HOLD TODAY: `AppDeps` carries no
 * `NarratorPort` — `deps.ts` says so in its own header and explains why — and
 * `gamePlugin` builds the port itself from `env`. Passing the scripted port
 * through `buildApp` is therefore impossible without reopening `deps.ts`,
 * which is not this task's file list. So the harness composes
 * `createCampaignService` exactly as `gamePlugin` does, with the scripted port
 * in place of `buildNarrator(env)`; everything downstream of that call is the
 * server's own code. Wiring §7.4 back is one optional field on `AppDeps`.
 *
 * ── THE DRAIN IS BY SEQUENCE, NEVER BY THE INTENT'S RESULT ───────────────
 * M0-24 leaves this in writing: entries written by the burn safety net and by
 * the narration are JOURNALLED and ABSENT from `SubmitIntentResult.events`.
 * `ws/handlers.ts` broadcasts that result, so those entries reach no socket
 * through it. `pump()` below therefore re-reads the journal from a cursor
 * after every step and hands what it finds to `hub.broadcast`, which is
 * idempotent per player (`appendVisible` skips a `seq` already counted). A
 * harness that trusted the result would leave a hole exactly where the two
 * hardest rules of this repository live.
 *
 * WHAT THAT HOLE LOOKS LIKE WHEN THE DRAIN IS REMOVED: `tests/scenarios.test.ts`,
 * « la diffusion par séquence n'est pas décorative : sans elle, le fil d'un
 * joueur perd des entrées », runs a scenario with the drain disabled and
 * requires `checkReplayEquivalence` to fail. Both directions, one test.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GENERATED_FILES, staticContent } from '@for/content';
import { PROTOCOL_VERSION } from '@for/contracts';
import {
  addMember,
  appendEvents,
  canonicalJson,
  insertCampaign,
  migrateConnection,
  openSqlite,
  readSince,
  readSinceForPlayer,
  upsertPlayer,
  writeProjectionsFrom,
} from '@for/db';
import { boxesFilled, createCampaignRng } from '@for/engine';
import {
  attachSocket,
  createCampaignService,
  createTableHub,
  loadReplay,
  openBurnWindows,
  readJournalSince,
  revertTurn,
  toEngineContent,
} from '@for/server';

import { fixedClock } from '@for/testkit';

import { expandUlid } from './scenario.js';
import { createScriptedNarrator } from './scripted-narrator.js';

import type { ContentRegistry } from '@for/content';
import type { NarratorPort } from '@for/contracts';
import type { AppendableEvent, JournalEvent, SqliteConnection } from '@for/db';
import type {
  CampaignId,
  CampaignState,
  CharacterId,
  EntityId,
  FallbackTemplates,
  GameEvent,
  IdFactory,
  Intent,
  PlayerId,
  SceneId,
} from '@for/engine';
import type {
  CampaignService,
  GameDeps,
  RngSource,
  TableConnection,
  TableHub,
  TimeSource,
  WsSocket,
} from '@for/server';
import type { Scenario, ScenarioStep } from './scenario.js';

/**
 * How far the injected clock moves between two steps.
 *
 * Three seconds, and the number is not arbitrary: `WS_RATE_LIMITS['c2s.intent']`
 * is five frames per ten seconds, so a spacing of three keeps at most four in
 * any window and a scenario is never refused for a reason that has nothing to
 * do with the rules it measures. Lowering it below two seconds makes
 * `01-full-session` red on `rate_limited` — which is the check doing its job,
 * on the wrong subject.
 */
export const SIM_STEP_MS = 3000;

// ------------------------------------------------------ deterministic parts

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A ULID factory that counts.
 *
 * NOT `counterIds` from `@for/testkit`: that one hands back `id-1`, which
 * `zGameEvent.parse` refuses — `events.id` is a ULID and the journal is read
 * back through the frozen schema. Counting, rather than pinning random bytes,
 * is what keeps two identifiers minted in the same millisecond DISTINCT: they
 * are a primary key, and a turn of four entries would abort on the second.
 */
export function counterUlids(start = 1): IdFactory & { count(): number } {
  let n = start;
  return {
    next: () => {
      const value = n;
      n += 1;
      let out = '';
      let rest = value;
      for (let index = 0; index < 25; index += 1) {
        out = CROCKFORD.charAt(rest % 32) + out;
        rest = Math.floor(rest / 32);
      }
      return `0${out}`;
    },
    count: () => n - start,
  };
}

/** A UUID that counts, for `zMessageId` and for the group of a turn. */
export function counterUuids(prefix = 0): { next(): string } {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `00000000-0000-4000-8000-${prefix.toString(16).padStart(4, '0')}${n.toString(16).padStart(8, '0')}`;
    },
  };
}

/** `content/fallbacks/narration.json`, read the way `gamePlugin` reads it. */
export function fallbackTemplates(): FallbackTemplates {
  const raw = GENERATED_FILES['fallbacks/narration.json'];
  if (raw === undefined) {
    throw new Error('contenu incomplet : fallbacks/narration.json absent du paquet compilé');
  }
  return JSON.parse(raw) as FallbackTemplates;
}

// ------------------------------------------------------------- the transport

/** One frame as it left the server: the bytes, and the object they encode. */
export interface CapturedFrame {
  readonly raw: string;
  readonly type: string;
  readonly seq: number | null;
  readonly deliverySeq: number | null;
  readonly payload: Record<string, unknown>;
}

interface Envelope {
  readonly t: string;
  readonly seq?: number;
  readonly deliverySeq?: number;
  readonly p: Record<string, unknown>;
}

function capture(raw: string): CapturedFrame {
  const parsed = JSON.parse(raw) as Envelope;
  return {
    raw,
    type: parsed.t,
    seq: parsed.seq ?? null,
    deliverySeq: parsed.deliverySeq ?? null,
    payload: parsed.p,
  };
}

/** What one player's transport recorded, across every socket they ever had. */
export interface PlayerTape {
  readonly playerId: PlayerId;
  readonly symbol: string;
  readonly frames: CapturedFrame[];
  readonly closes: { code: number; reason: string | undefined }[];
}

/**
 * The transport double.
 *
 * ITS TWO METHODS ARE THE INTERFACE'S TWO METHODS, `onFlushed` included. A
 * double declared with one parameter fewer compiles without a word and makes
 * the argument it drops invisible to every scenario — mode 8 of the standard
 * probe, and the reason `send` names `onFlushed` and calls it: the server
 * decrements `inFlight` in that callback, and a double that never called it
 * would collapse the socket queue after 64 frames.
 */
export function simSocket(tape: PlayerTape): WsSocket {
  return {
    send: (data: string, onFlushed?: () => void): void => {
      tape.frames.push(capture(data));
      onFlushed?.();
    },
    close: (code: number, reason?: string): void => {
      tape.closes.push({ code, reason });
    },
  };
}

// ----------------------------------------------------------------- the run

/** What one step did, as the report and the checks read it. */
export interface StepOutcome {
  readonly index: number;
  readonly kind: ScenarioStep['kind'];
  readonly note: string | null;
  /** Entry types this step appended, read from the journal BY SEQUENCE. */
  readonly appended: readonly string[];
  /** `s2c.rejected` / `s2c.error` code, when the table refused. */
  readonly rejected: string | null;
  /** What the expectations of this step found wrong, in French. */
  readonly failures: readonly string[];
  /** Move identifiers this step declared, for the coverage check. */
  readonly moves: readonly string[];
}

export interface SimHarness {
  readonly scenario: Scenario;
  readonly campaignId: CampaignId;
  readonly connection: SqliteConnection;
  readonly service: CampaignService;
  readonly hub: TableHub;
  readonly deps: GameDeps;
  readonly tapes: ReadonlyMap<string, PlayerTape>;
  readonly players: ReadonlyMap<string, { playerId: PlayerId; characterId: CharacterId }>;
  readonly steps: readonly StepOutcome[];
  readonly state: () => CampaignState;
  readonly journal: () => readonly GameEvent[];
  readonly rows: () => readonly JournalEvent[];
  readonly threadOf: (playerId: PlayerId) => readonly JournalEvent[];
  readonly journalHash: () => string;
  readonly run: () => Promise<void>;
  readonly close: () => void;
}

export interface HarnessOptions {
  readonly scenario: Scenario;
  /** Overrides `scenario.seed`. `pnpm sim run --seed=…`. */
  readonly seed?: string;
  /** Replaces the scripted port — how `checks/lockout.ts` is shown to bite. */
  readonly narrator?: NarratorPort;
  /** One folder per harness; the temporary directory is shared between agents. */
  readonly tmpPrefix?: string;
  /**
   * Turns the sequence drain OFF.
   *
   * It exists so that the claim in this file's header can be MEASURED rather
   * than believed: with the drain off, a player's thread and the journal
   * disagree, and `checkReplayEquivalence` says so.
   */
  readonly withoutSequenceDrain?: boolean;
}

/** The campaign identifier of a scenario: derived, so two runs agree. */
export function campaignIdOf(scenario: Scenario): CampaignId {
  return expandUlid(`CAMP${numberOf(scenario)}`) as CampaignId;
}

function numberOf(scenario: Scenario): string {
  return /^(\d+)/.exec(scenario.id)?.[1] ?? '00';
}

export function createSimHarness(options: HarnessOptions): SimHarness {
  const { scenario } = options;
  const seed = options.seed ?? scenario.seed;
  const campaignId = campaignIdOf(scenario);
  const startedAt = Date.parse(scenario.startedAt);
  if (Number.isNaN(startedAt)) {
    throw new RangeError(
      `${scenario.id} : startedAt « ${scenario.startedAt} » n'est pas un instant`,
    );
  }

  const folder = mkdtempSync(join(tmpdir(), options.tmpPrefix ?? 'for-sim-'));
  const connection = openSqlite(join(folder, 'sim.db'));
  migrateConnection(connection);

  /**
   * THE CLOCK MOVES, AND IT HAS TO.
   *
   * §7.4 says `fixedClock(scenario.startedAt)`, and a clock that never moved
   * would make every scenario longer than five intents FALSE BY
   * CONSTRUCTION: §5.6 caps `c2s.intent` at five frames per ten seconds, the
   * limiter reads the injected clock, and at one instant the sixth move of
   * `01-full-session` comes back `rate_limited` — measured, that is exactly
   * what happened. So the fixture is used the way it was built to be used:
   * `advance()` is the ONLY thing that moves it, it is called once per step,
   * and the step is `SIM_STEP_MS`. Nothing reads the wall clock, two runs
   * still stamp the same milliseconds, and the limiter sees a table playing
   * at a human pace.
   */
  const ticking = fixedClock(scenario.startedAt);
  const clock: TimeSource = { now: () => ticking.nowMs() };
  const ids = counterUlids();
  const frameIds = counterUuids(0x0f);
  const messageIds = counterUuids(0x0a);
  const rng: RngSource = { forCampaign: createCampaignRng };
  const content: ContentRegistry = staticContent();
  const narrator = options.narrator ?? createScriptedNarrator();

  // ----------------------------------------------------------- the players

  const players = new Map<string, { playerId: PlayerId; characterId: CharacterId }>();
  for (const player of scenario.players) {
    players.set(player.symbol, {
      playerId: expandUlid(player.symbol) as PlayerId,
      characterId: expandUlid(player.character.symbol) as CharacterId,
    });
  }
  const owner = scenario.players[0];
  if (owner === undefined) throw new RangeError(`${scenario.id} : aucun joueur`);
  const ownerSymbol = owner.symbol;
  const ownerId = expandUlid(ownerSymbol) as PlayerId;

  for (const player of scenario.players) {
    upsertPlayer(connection, {
      id: expandUlid(player.symbol),
      discordUserId: `discord-${player.symbol}`,
      discordUsername: player.displayName,
      createdAt: startedAt,
    });
  }
  insertCampaign(connection, {
    id: campaignId,
    slug: `sim-${scenario.id}`,
    name: scenario.title,
    ownerPlayerId: ownerId,
    contentPackVersion: content.bundle.version,
    contentPackHash: content.bundle.hash,
    rulesVersion: 1,
    reducerVersion: 1,
    rngSeed: seed,
    createdAt: startedAt,
    status: 'active',
  });
  for (const player of scenario.players) {
    addMember(connection, {
      id: `${expandUlid(player.symbol)}-member`,
      campaignId,
      playerId: expandUlid(player.symbol),
      joinedAt: startedAt,
    });
  }

  // --------------------------------------------------------- the bootstrap

  writeBootstrap();

  function writeBootstrap(): void {
    const bootstrapIds = counterUlids(1_000_000);
    const group = '00000000-0000-4000-8000-000000000000';
    const envelope = (
      type: string,
      payload: unknown,
      subject: string | null = null,
    ): AppendableEvent => ({
      id: bootstrapIds.next(),
      type,
      payload,
      payloadVersion: 1,
      actorKind: 'system',
      actorPlayerId: null,
      subjectCharacterId: subject,
      correlationId: group,
      causationId: null,
      rngStream: null,
      rngDrawIndex: null,
      scope: 'table',
      recipients: null,
      createdAt: startedAt,
    });

    const events: AppendableEvent[] = [
      envelope('campaign.created', {
        name: scenario.title,
        slug: `sim-${scenario.id}`,
        pitch: '',
        ownerPlayerId: ownerId,
        contentPackVersion: content.bundle.version,
        contentPackHash: content.bundle.hash,
        rulesVersion: 1,
        rngSeed: seed,
      }),
      envelope('campaign.status_changed', { from: 'draft', to: 'active' }),
    ];
    for (const player of scenario.players) {
      events.push(
        envelope('party.member_joined', {
          playerId: expandUlid(player.symbol),
          role: player.symbol === ownerSymbol ? 'owner' : 'player',
          displayName: player.displayName,
        }),
      );
    }
    for (const player of scenario.players) {
      events.push(
        envelope(
          'character.created',
          {
            characterId: expandUlid(player.character.symbol),
            playerId: expandUlid(player.symbol),
            championId: player.character.championId,
            displayName: player.character.displayName,
            sheetSource: 'handwritten',
            sheetRef: player.character.championId,
            sheetSnapshot: {},
            attributes: player.character.attributes,
            gauges: player.character.gauges,
            momentum: player.character.momentum,
          },
          expandUlid(player.character.symbol),
        ),
      );
    }
    // THE DISTRIBUTION LOCK, WRITTEN EXPLICITLY — and that is a divergence
    // worth naming. ARCHITECTURE.md §4.4 says "c'est `character.created` qui
    // pose le verrou", but `reduce()` fills `championLocks` from
    // `party.champion_locked` and from nothing else: a campaign built with
    // `character.created` alone has an EMPTY lock table, and
    // `checks/lockout.ts` would then find nothing reserved and pass over an
    // empty list. Measured: the lockout counter-probe stayed green until this
    // entry was added. So the bootstrap writes both, and the gap is reported
    // rather than papered over by weakening the check.
    for (const player of scenario.players) {
      events.push(
        envelope('party.champion_locked', {
          championId: player.character.championId,
          lockKind: 'reserved_pc',
          reason: `personnage de ${player.displayName}`,
        }),
      );
    }
    for (const entity of scenario.entities) {
      events.push(
        envelope('entity.introduced', {
          entityId: expandUlid(entity.symbol),
          kind: entity.kind,
          slug: entity.symbol.toLowerCase(),
          name: entity.displayName,
          summary: entity.displayName,
          disposition: 'hostile',
          details: {},
        }),
      );
    }
    if (scenario.scene !== null) {
      events.push(
        envelope('scene.started', {
          sceneId: expandUlid(`SCN${numberOf(scenario)}`) as SceneId,
          title: scenario.scene.title,
          entityIds: scenario.scene.entities.map((symbol) => expandUlid(symbol) as EntityId),
          presentCharacterIds: scenario.players.map(
            (player) => expandUlid(player.character.symbol) as CharacterId,
          ),
        }),
      );
    }

    appendEvents(connection, { campaignId, events, now: startedAt });
    writeProjectionsFrom(connection, campaignId, loadReplay(connection, campaignId));
  }

  // ------------------------------------------------------------ the server

  const deps: GameDeps = {
    connection,
    content: toEngineContent(content),
    fallbacks: fallbackTemplates(),
    clock,
    rng,
    ids,
    narrator,
  };
  const written = createCampaignService({ deps });

  /**
   * THE SEQUENCE DRAIN, INSERTED WHERE IT CAN BE ORDERED CORRECTLY.
   *
   * `ws/handlers.ts` broadcasts `result.value.events` — the entries the
   * INTENT produced. The burn safety net writes its closing entries EARLIER
   * in the same call and they are absent from that list (M0-24 says so in
   * writing), so broadcasting the result first sets each player's `lastSeq`
   * PAST them, and `appendVisible` then refuses them for ever: they reach no
   * socket, and they never can. Measured on `06-two-players-interleaved`:
   * three entries lost, and every delivery number after them shifted.
   *
   * Draining AFTER the handler's broadcast cannot fix that — the damage is
   * the cursor. Draining BEFORE it can, and this wrapper is the only seam
   * where "before" exists: the real `submitIntent` has committed, the journal
   * is complete, and the handler has not spoken yet. The handler's own
   * broadcast then delivers nothing new, because `appendVisible` skips a
   * `seq` already counted.
   *
   * THIS IS A HARNESS WORKAROUND FOR A SERVER GAP, and it is reported as one
   * rather than left to look like a design: the same hole exists in
   * production, where nothing drains. Diffusion is M0-29's file list.
   */
  const service: CampaignService = {
    ...written,
    submitIntent: async (input) => {
      const result = await written.submitIntent(input);
      pump();
      return result;
    },
  };

  const hub = createTableHub(service);

  const warnings: { context: object; message: string }[] = [];
  const logger = {
    warn: (context: object, message: string): void => {
      warnings.push({ context, message });
    },
  };

  const tapes = new Map<string, PlayerTape>();
  const connections = new Map<string, TableConnection>();

  // --------------------------------------------------------------- reading

  const state = (): CampaignState => loadReplay(connection, campaignId).state;
  const journal = (): readonly GameEvent[] => readJournalSince(connection, campaignId, 0);
  const rows = (): readonly JournalEvent[] => readSince(connection, campaignId, 0);
  const threadOf = (playerId: PlayerId): readonly JournalEvent[] =>
    readSinceForPlayer(connection, campaignId, playerId, 0);

  /**
   * The hash two runs of the same seed must agree on.
   *
   * It hashes the JOURNAL, not the final state: a state hash would be equal
   * for two runs that wrote the same numbers by different roads, and what
   * invariant 4 promises is the road. `createdAt` is deliberately absent —
   * the clock is injected and fixed, so it would add no signal — and the two
   * RNG columns are deliberately present, because they are what says the same
   * die was drawn at the same index.
   */
  const journalHash = (): string =>
    createHash('sha256')
      .update(
        canonicalJson(
          journal().map((event) => ({
            seq: event.seq,
            id: event.id,
            type: event.type,
            payload: event.payload,
            actorKind: event.actorKind,
            subjectCharacterId: event.subjectCharacterId,
            correlationId: event.correlationId,
            scope: event.scope,
            recipients: event.recipients,
            rngStream: event.rngStream,
            rngDrawIndex: event.rngDrawIndex,
          })),
        ),
      )
      .digest('hex');

  // --------------------------------------------------------- the connection

  function lastDeliverySeqOf(tape: PlayerTape): number | null {
    let best: number | null = null;
    const keep = (value: unknown): void => {
      if (typeof value === 'number') best = Math.max(best ?? 0, value);
    };
    for (const frame of tape.frames) {
      keep(frame.deliverySeq);
      if (frame.type === 's2c.snapshot') keep(frame.payload['lastDeliverySeq']);
      if (frame.type === 's2c.events_batch') {
        for (const entry of (frame.payload['events'] ?? []) as { deliverySeq?: unknown }[]) {
          keep(entry.deliverySeq);
        }
      }
    }
    return best;
  }

  async function connect(symbol: string): Promise<void> {
    const identity = players.get(symbol);
    if (identity === undefined) {
      throw new RangeError(`${scenario.id} : joueur inconnu « ${symbol} »`);
    }
    let tape = tapes.get(symbol);
    if (tape === undefined) {
      tape = { playerId: identity.playerId, symbol, frames: [], closes: [] };
      tapes.set(symbol, tape);
    }
    const attached = await attachSocket({
      hub,
      socket: simSocket(tape),
      request: { session: { playerId: identity.playerId }, campaignId },
      // The auth layer's verdict, stubbed AT THE GUARD and not inside the game
      // pipeline: `runIntent` still asks `listMemberPlayerIds` for itself, so a
      // player who is not a member is still refused by the real rule.
      access: { check: () => Promise.resolve('ok' as const) },
      service,
      content,
      clock,
      ids,
      frameIds,
      logger,
    });
    if (attached === null) {
      throw new Error(`${scenario.id} : poignée de main refusée pour ${symbol}`);
    }
    connections.set(symbol, attached);

    await attached.receive(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        t: 'c2s.hello',
        id: messageIds.next(),
        p: { clientVersion: 'sim/0.0.0', lastDeliverySeq: lastDeliverySeqOf(tape) },
      }),
    );
  }

  // ---------------------------------------------------------- the delivery

  let pumped = 0;

  function pump(): void {
    if (options.withoutSequenceDrain === true) return;
    const fresh = readSince(connection, campaignId, pumped);
    if (fresh.length === 0) return;
    hub.broadcast(campaignId, fresh);
    pumped = fresh.at(-1)?.seq ?? pumped;
  }

  // --------------------------------------------------------------- running

  const steps: StepOutcome[] = [];
  const groupsByStep = new Map<number, string>();

  async function send(symbol: string, frame: { t: string; p: unknown }): Promise<void> {
    const target = connections.get(symbol);
    if (target === undefined) {
      throw new RangeError(`${scenario.id} : « ${symbol} » n'est pas connecté`);
    }
    await target.receive(
      JSON.stringify({ v: PROTOCOL_VERSION, t: frame.t, id: messageIds.next(), p: frame.p }),
    );
  }

  async function runStep(step: ScenarioStep, index: number): Promise<void> {
    ticking.advance(SIM_STEP_MS);
    const before = lastSeq();
    const mark = new Map<string, number>();
    for (const [symbol, tape] of tapes) mark.set(symbol, tape.frames.length);

    switch (step.kind) {
      case 'intent':
        await send(step.player, { t: 'c2s.intent', p: { intent: step.intent } });
        break;
      case 'speak':
        await send(step.player, {
          t: 'c2s.speak',
          p: { channel: step.channel, text: step.text },
        });
        break;
      case 'burn':
      case 'keep': {
        // THE WINDOW THE ACTOR OWNS, never "the last one of the journal":
        // two players waiting on a burn decision at the same moment is the
        // normal state of a free table (ARCHITECTURE.md §4.4), and answering
        // the wrong one loses a turn in silence.
        const actor = players.get(step.player)?.characterId;
        const window = openBurnWindows(deps, campaignId, journal()).find(
          (candidate) => candidate.characterId === actor,
        );
        if (window === undefined) {
          throw new RangeError(
            `${scenario.id} : « ${step.player} » n'a aucune fenêtre ouverte à l'étape ${String(index)}`,
          );
        }
        await send(step.player, {
          t: 'c2s.intent',
          p: {
            intent: {
              type: step.kind === 'burn' ? 'momentum.burn' : 'momentum.keep',
              rollId: window.roll.rollId,
            },
          },
        });
        break;
      }
      case 'vow': {
        const tracks = Object.values(state().tracks).sort((a, b) => a.id.localeCompare(b.id));
        const track = tracks[step.index];
        if (track === undefined) {
          throw new RangeError(
            `${scenario.id} : aucune piste au rang ${String(step.index)} à l'étape ${String(index)}`,
          );
        }
        const intent: Intent =
          step.action === 'milestone'
            ? { type: 'move.reach_a_milestone', trackId: track.id }
            : step.action === 'fulfill'
              ? { type: 'move.fulfill_your_vow', trackId: track.id }
              : {
                  type: 'move.forsake_your_vow',
                  trackId: track.id,
                  reason: step.reason ?? 'abandonné',
                };
        await send(step.player, { t: 'c2s.intent', p: { intent } });
        break;
      }
      case 'secret': {
        const to = players.get(step.player)?.playerId;
        if (to === undefined) {
          throw new RangeError(`${scenario.id} : joueur inconnu « ${step.player} »`);
        }
        appendEvents(connection, {
          campaignId,
          now: startedAt,
          events: [
            {
              id: ids.next(),
              type: 'system.note',
              payload: { text: step.text, byPlayerId: ownerId },
              payloadVersion: 1,
              actorKind: 'system',
              actorPlayerId: null,
              subjectCharacterId: null,
              correlationId: null,
              causationId: null,
              rngStream: null,
              rngDrawIndex: null,
              scope: 'private',
              recipients: [to],
              createdAt: startedAt,
            },
          ],
        });
        break;
      }
      case 'reconnect': {
        const previous = connections.get(step.player);
        if (previous !== undefined) {
          previous.markClosed();
          hub.detach(previous);
          connections.delete(step.player);
        }
        await connect(step.player);
        break;
      }
      case 'resume':
        await send(step.player, {
          t: 'c2s.resume',
          p: { sinceDeliverySeq: step.sinceDeliverySeq },
        });
        break;
      case 'revert': {
        const group = groupsByStep.get(step.step);
        if (group === undefined) {
          throw new RangeError(
            `${scenario.id} : l'étape ${String(step.step)} n'a ouvert aucun tour`,
          );
        }
        revertTurn(connection, {
          campaignId,
          correlationId: group,
          reason: step.reason,
          byPlayerId: ownerId,
          ids,
          now: startedAt,
        });
        break;
      }
    }

    pump();

    const written = readSince(connection, campaignId, before);
    const appended = written.map((row) => row.type);
    const moves = written
      .filter((row) => row.type === 'move.declared')
      .map((row) => {
        const moveId = (row.payload as { moveId?: unknown }).moveId;
        return typeof moveId === 'string' ? moveId : '';
      });

    const group = written.find((row) => row.correlationId !== null)?.correlationId;
    if (group != null) groupsByStep.set(index, group);

    const actor = 'player' in step ? step.player : null;
    let rejected: string | null = null;
    if (actor !== null) {
      const tape = tapes.get(actor);
      for (const frame of tape?.frames.slice(mark.get(actor) ?? 0) ?? []) {
        if (frame.type === 's2c.rejected' || frame.type === 's2c.error') {
          rejected = String(frame.payload['code']);
        }
      }
    }

    const failures = checkExpectation(step, index, appended, rejected);

    steps.push({
      index,
      kind: step.kind,
      note: step.note ?? null,
      appended,
      rejected,
      failures,
      moves,
    });
  }

  function lastSeq(): number {
    const row = connection
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS head FROM events WHERE campaign_id = ?`)
      .get(campaignId) as { head: number };
    return row.head;
  }

  function checkExpectation(
    step: ScenarioStep,
    index: number,
    appended: readonly string[],
    rejected: string | null,
  ): readonly string[] {
    const expected = 'expect' in step ? step.expect : undefined;
    if (expected === undefined) return [];
    const failures: string[] = [];
    const where = `étape ${String(index)}`;
    const live = state();

    if (expected.accepted === true && rejected !== null) {
      failures.push(`${where} : acceptée attendue, refusée « ${rejected} »`);
    }
    if (expected.accepted === false && rejected === null) {
      failures.push(`${where} : refus attendu, aucune trame de refus`);
    }
    if (expected.rejection !== undefined && expected.rejection !== rejected) {
      failures.push(
        `${where} : refus « ${expected.rejection} » attendu, obtenu « ${rejected ?? 'aucun'} »`,
      );
    }
    if (expected.events !== undefined) {
      const found = appended.join(', ');
      const wanted = expected.events.join(', ');
      if (found !== wanted) {
        failures.push(`${where} : entrées « ${found} » au lieu de « ${wanted} »`);
      }
    }
    if (expected.window !== undefined) {
      const open = openBurnWindows(deps, campaignId, journal()).length > 0;
      if ((expected.window === 'open') !== open) {
        failures.push(
          `${where} : fenêtre ${open ? 'ouverte' : 'fermée'}, attendue ${expected.window}`,
        );
      }
    }
    if (expected.gauges !== undefined) {
      for (const [symbol, wanted] of Object.entries(expected.gauges)) {
        const character = live.characters[expandUlid(symbol) as CharacterId];
        if (character === undefined) {
          failures.push(`${where} : personnage « ${symbol} » absent de l'état`);
          continue;
        }
        for (const [gauge, value] of Object.entries(wanted)) {
          const actual =
            gauge === 'momentum'
              ? character.momentum
              : character.gauges[gauge as keyof typeof character.gauges];
          if (actual !== value) {
            failures.push(
              `${where} : ${symbol}.${gauge} = ${String(actual)}, attendu ${String(value)}`,
            );
          }
        }
      }
    }
    if (expected.tracks !== undefined) {
      const tracks = Object.values(live.tracks).sort((a, b) => a.id.localeCompare(b.id));
      if (tracks.length !== expected.tracks.length) {
        failures.push(
          `${where} : ${String(tracks.length)} pistes, ${String(expected.tracks.length)} attendues`,
        );
      }
      for (const [at, wanted] of expected.tracks.entries()) {
        const track = tracks[at];
        if (track === undefined) continue;
        if (track.rank !== wanted.rank) {
          failures.push(
            `${where} : piste ${String(at)} de rang ${track.rank}, attendu ${wanted.rank}`,
          );
        }
        if (track.ticks !== wanted.ticks) {
          failures.push(
            `${where} : piste ${String(at)} à ${String(track.ticks)} crans, attendu ${String(wanted.ticks)}`,
          );
        }
        const boxes = boxesFilled(track.ticks);
        if (boxes !== wanted.boxes) {
          failures.push(
            `${where} : piste ${String(at)} à ${String(boxes)} cases, attendu ${String(wanted.boxes)}`,
          );
        }
        if (wanted.status !== undefined && track.status !== wanted.status) {
          failures.push(
            `${where} : piste ${String(at)} en « ${track.status} », attendu « ${wanted.status} »`,
          );
        }
      }
    }
    if (expected.characterStatus !== undefined) {
      for (const [symbol, wanted] of Object.entries(expected.characterStatus)) {
        const character = live.characters[expandUlid(symbol) as CharacterId];
        if (character?.status !== wanted) {
          failures.push(
            `${where} : ${symbol} en « ${character?.status ?? 'absent'} », attendu « ${wanted} »`,
          );
        }
      }
    }
    if (expected.outcome !== undefined) {
      const resolved = rows()
        .filter((row) => row.type === 'roll.action_resolved' || row.type === 'roll.action_revised')
        .at(-1);
      const outcome = (resolved?.payload as { outcome?: unknown } | undefined)?.outcome;
      if (outcome !== expected.outcome) {
        failures.push(`${where} : issue « ${String(outcome)} », attendue « ${expected.outcome} »`);
      }
    }
    return failures;
  }

  async function run(): Promise<void> {
    for (const player of scenario.players) await connect(player.symbol);
    pump();
    for (const [index, step] of scenario.steps.entries()) await runStep(step, index);
  }

  return {
    scenario,
    campaignId,
    connection,
    service,
    hub,
    deps,
    tapes,
    players,
    steps,
    state,
    journal,
    rows,
    threadOf,
    journalHash,
    run,
    close: () => {
      connection.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}
