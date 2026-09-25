/**
 * The demo campaign's stagehand: it plays intents through the REAL `decide()`
 * and writes, beside them, the entries the server writes.
 *
 * ── WHY THERE ARE TWO WAYS IN, AND WHERE THE LINE IS ─────────────────────
 * The task sheet says the seed plays a scripted list of intents through
 * `decide()` rather than typing 248 journal entries by hand, and it is right:
 * a hand-typed journal is a second rules engine, it drifts at the first payload
 * change, and it can hold states the engine would never produce — which would
 * make `db:check` control 9 a liar.
 *
 * MEASURED, AND REPORTED: `decide()` can produce 26 of the 71 event types.
 * `Intent` has twenty members and none of them opens a scene, introduces an
 * entity, opens a play session, writes a chronicle or reverts a turn — three
 * `decide*` functions say so in their own comments ("M0-24 writes the event",
 * "Play sessions produce no engine event, and that is a finding"). So a seed
 * built on intents ALONE cannot cover the catalogue, and the note on the task
 * sheet is true of the dice and false of the rest.
 *
 * The line this file draws, and it is the invariant-1 line:
 *
 *   - `play()` — anything the RULES decide. Every die, every gauge, every
 *     tick, every price: `decide()` produces it or it does not exist. Nothing
 *     here recomputes an outcome, and no caller may hand in an event.
 *   - `write()` — what the SERVER decides, and nothing else: lifecycle,
 *     membership, scenes, entities, narration, sessions, chronicles,
 *     administration. These carry no roll and no arithmetic.
 *
 * ── WHAT IT RE-STAMPS, AND WHY THAT IS THE SERVER'S JOB ──────────────────
 * `playSessionId` and `correlationId`. The first is bookkeeping the engine has
 * no field for. The second is a REPORTED CONTRACT BREAK: `decide()` mints the
 * correlation identifier from its `IdFactory`, which produces ULIDs, while
 * `zCorrelationId` is `z.uuid()` — so an unstamped turn fails `zGameEvent`,
 * and therefore fails `replayJournal` AND `db:check` control 10. See `ids.ts`.
 *
 * ── WHY THE STATE IS REPLAYED AFTER A CANCELLATION ───────────────────────
 * `reduceAll` skips the sequences a `system.reverted` names, and it can only do
 * that with the WHOLE journal in hand: it is a two-pass function. An
 * incremental state has already applied the entries the cancellation takes
 * back, so after a revert the director throws its state away and replays the
 * journal from the database — the same path `db:rebuild` takes.
 */

import type { SqliteConnection } from '../client.js';
import { replayCampaign } from '../rebuild.js';
import type { AppendableEvent } from '../repositories/events.js';
import { appendEvents } from '../repositories/events.js';
import type { JournalEvent } from '../repositories/rows.js';
import { demoCorrelationId } from './ids.js';

import type {
  BurnWindow,
  CampaignId,
  CampaignState,
  CharacterId,
  DecisionContext,
  DecisionRng,
  EngineContent,
  EventId,
  EventScope,
  GameEvent,
  GameEventOf,
  GameEventPayloads,
  IdFactory,
  Intent,
  PlayerId,
  PlaySessionId,
  Rng,
  RngStream,
} from '@for/engine';
import { createCampaignRng, decide, isErr, reduceAll } from '@for/engine';

/** Raised when a scripted intent the demo depends on is refused by the rules. */
export class DemoIntentRefused extends Error {
  constructor(
    readonly note: string,
    readonly code: string,
    readonly details: unknown,
  ) {
    super(`intention « ${note} » refusée par le moteur : ${code} ${JSON.stringify(details)}`);
    this.name = 'DemoIntentRefused';
  }
}

/** Raised when the script asks for something the journal cannot back. */
export class DemoScriptInconsistent extends Error {
  constructor(detail: string) {
    super(`script de démonstration incohérent : ${detail}`);
    this.name = 'DemoScriptInconsistent';
  }
}

/** Thrown to stop the script at the mark `--minimal` stops on. */
export class DemoStopped extends Error {
  constructor(readonly mark: string) {
    super(`démonstration arrêtée à la marque « ${mark} »`);
    this.name = 'DemoStopped';
  }
}

/** One entry the server writes. No roll, no arithmetic, no gauge. */
export interface AuthoredEvent<TType extends keyof GameEventPayloads = keyof GameEventPayloads> {
  readonly type: TType;
  readonly payload: GameEventPayloads[TType];
  readonly actorKind: GameEvent['actorKind'];
  readonly actorPlayerId?: PlayerId | null;
  readonly subjectCharacterId?: CharacterId | null;
  /** ADR 0008. Absent means `table`, which is the only scope M0 plays at. */
  readonly scope?: EventScope;
  readonly recipients?: readonly PlayerId[];
}

/** Sugar so the script reads as a list of facts rather than a list of casts. */
export function authored<TType extends keyof GameEventPayloads>(
  type: TType,
  payload: GameEventPayloads[TType],
  envelope: Omit<AuthoredEvent<TType>, 'type' | 'payload'>,
): AuthoredEvent {
  return { type, payload, ...envelope };
}

export interface DirectorOptions {
  readonly connection: SqliteConnection;
  readonly campaignId: CampaignId;
  readonly ownerPlayerId: PlayerId;
  readonly seed: string;
  readonly content: EngineContent;
  readonly ids: IdFactory;
  /** First instant of the campaign. Every later one is derived from it. */
  readonly epoch: number;
  /** Milliseconds added between two beats. */
  readonly step: number;
  readonly initialState: CampaignState;
  /** The mark `--minimal` stops on, or `null` for the whole campaign. */
  readonly stopAt: string | null;
}

/**
 * The generator a turn draws from: ONE per (campaign seed, turn, stream).
 *
 * The memo is load-bearing, not a cache. `decide()` calls `stream('price')`
 * twice when an entry has several effects, and the second call must continue
 * the first generator — a fresh one would redraw the d12's own value as the
 * effect index, and ADR 0006's arbitration would stop being an arbitration.
 */
function turnRng(seed: string, seq: number): DecisionRng {
  const memo = new Map<RngStream, Rng>();
  return {
    stream(name: RngStream): Rng {
      const found = memo.get(name);
      if (found !== undefined) return found;
      const made = createCampaignRng(seed, seq, name);
      memo.set(name, made);
      return made;
    },
  };
}

export class Director {
  #state: CampaignState;
  #now: number;
  #turn = 0;
  #session: PlaySessionId | null = null;
  #burnWindow: BurnWindow | null = null;
  readonly #options: DirectorOptions;
  readonly #groups = new Map<string, number[]>();

  constructor(options: DirectorOptions) {
    this.#options = options;
    this.#state = options.initialState;
    this.#now = options.epoch;
  }

  get state(): CampaignState {
    return this.#state;
  }

  get now(): number {
    return this.#now;
  }

  /** The roll a `momentum.burn` may still revise, as the journal leaves it. */
  get burnWindow(): BurnWindow | null {
    return this.#burnWindow;
  }

  /** Journal sequences written under one correlation identifier. */
  group(correlationId: string): readonly number[] {
    const found = this.#groups.get(correlationId);
    if (found === undefined) {
      throw new DemoScriptInconsistent(`groupe de corrélation ${correlationId} inconnu`);
    }
    return found;
  }

  openSession(playSessionId: PlaySessionId): void {
    this.#session = playSessionId;
  }

  /**
   * A die the storyteller asked for out of band, drawn by the ENGINE's
   * generator and never typed out.
   *
   * `roll.raw` is the one entry of the catalogue that carries dice and that no
   * `decide()` branch produces — nothing calls for a loose roll today. Writing
   * its faces by hand would put arithmetic in the seed, so the draw goes
   * through `createCampaignRng` on the `fallback` stream at the current
   * sequence: reproducible, and the same primitive every other draw of the
   * campaign uses.
   */
  rawRoll(sides: number, count: number): readonly { sides: number; value: number }[] {
    const rng = createCampaignRng(this.#options.seed, this.#state.seq + 1, 'fallback');
    return Array.from({ length: count }, () => ({ sides, value: rng.roll(sides) }));
  }

  /** Days pass between two play sessions; the journal has to show it. */
  skip(milliseconds: number): void {
    this.#now += milliseconds;
  }

  /** Stops the script here when the seed was asked for the minimal base. */
  mark(name: string): void {
    if (this.#options.stopAt === name) throw new DemoStopped(name);
  }

  /**
   * One player intent, settled by the rules and written to the journal.
   *
   * Returns what the engine produced, WITH its allocated sequences, so the
   * script can hang a scene or a chronicle off a track the rules just opened
   * — without ever inventing its identifier.
   */
  play(
    actorId: CharacterId,
    intent: Intent,
    note: string,
  ): { readonly events: readonly JournalEvent[]; readonly correlationId: string } {
    const seqBase = this.#state.seq + 1;
    const ctx: DecisionContext = {
      rng: turnRng(this.#options.seed, seqBase),
      ids: this.#options.ids,
      now: this.#now,
      actorId,
      content: this.#options.content,
      burnWindow: this.#burnWindow,
    };
    const decision = decide(this.#state, intent, ctx);
    if (isErr(decision)) {
      throw new DemoIntentRefused(note, decision.error.code, decision.error.details);
    }
    const correlationId = demoCorrelationId(this.#turn);
    this.#turn += 1;
    const written = this.#append(
      decision.value.events.map((event) => this.#toAppendable(event, correlationId)),
    );
    this.#apply(decision.value.events);
    this.#groups.set(correlationId, [...written.map((event) => event.seq)]);
    this.#rememberBurnWindow(decision.value.events);
    this.#now += this.#options.step;
    return { events: written, correlationId };
  }

  /** Entries the server writes. One correlation group, like a turn. */
  write(events: readonly AuthoredEvent[]): {
    readonly events: readonly JournalEvent[];
    readonly correlationId: string;
  } {
    const correlationId = demoCorrelationId(this.#turn);
    this.#turn += 1;
    const seqBase = this.#state.seq;
    const built = events.map((event, index) =>
      this.#authoredToEvent(event, correlationId, seqBase + index + 1),
    );
    const written = this.#append(
      built.map((event) => this.#toAppendable(event, correlationId, event.recipients)),
    );
    this.#apply(built);
    this.#groups.set(correlationId, [...written.map((event) => event.seq)]);
    this.#now += this.#options.step;
    return { events: written, correlationId };
  }

  /**
   * The journal, replayed from the database into the director's state.
   *
   * Called after a `system.reverted`, because the two-pass replay is the only
   * thing that can undo entries an incremental reduction has already applied.
   */
  resync(): void {
    this.#state = replayCampaign(this.#options.connection, this.#options.campaignId).state;
    this.#burnWindow = null;
  }

  #append(events: readonly AppendableEvent[]): readonly JournalEvent[] {
    return appendEvents(this.#options.connection, {
      campaignId: this.#options.campaignId,
      events,
      now: this.#now,
    }).events;
  }

  #apply(events: readonly GameEvent[]): void {
    this.#state = reduceAll(this.#state, events);
  }

  #toAppendable(
    event: GameEvent,
    correlationId: string,
    recipients?: readonly PlayerId[] | null,
  ): AppendableEvent {
    const addressed = recipients ?? event.recipients;
    return {
      id: event.id,
      type: event.type,
      payload: event.payload,
      actorKind: event.actorKind,
      scope: event.scope,
      recipients: event.scope === 'table' ? null : (addressed ?? null),
      createdAt: event.createdAt,
      playSessionId: this.#session,
      payloadVersion: event.payloadVersion,
      actorPlayerId: event.actorPlayerId,
      subjectCharacterId: event.subjectCharacterId,
      correlationId,
      causationId: event.causationId,
      rngStream: event.rngStream,
      rngDrawIndex: event.rngDrawIndex,
    };
  }

  #authoredToEvent(entry: AuthoredEvent, correlationId: string, seq: number): GameEvent {
    const scope = entry.scope ?? 'table';
    const event: GameEventOf<typeof entry.type> = {
      id: this.#options.ids.next() as EventId,
      campaignId: this.#options.campaignId,
      seq,
      playSessionId: this.#session,
      payloadVersion: 1,
      actorKind: entry.actorKind,
      actorPlayerId: entry.actorPlayerId ?? null,
      subjectCharacterId: entry.subjectCharacterId ?? null,
      correlationId,
      causationId: null,
      rngStream: null,
      rngDrawIndex: null,
      createdAt: this.#now,
      scope,
      recipients: scope === 'table' ? null : (entry.recipients ?? null),
      type: entry.type,
      payload: entry.payload,
    };
    return event as GameEvent;
  }

  /**
   * The window a `momentum.burn` may still use.
   *
   * STRICTER THAN THE RULE, AND SAID SO. ARCHITECTURE.md section 4.4 closes
   * the window "au premier événement suivant du même personnage"; this closes
   * it at the next BEAT, whoever plays it. A seed only ever burns on the beat
   * right after the roll, so the difference never shows here — but a caller
   * who read this as the real rule would be wrong, and the real window belongs
   * to `CampaignService` (M0-24), not to a fixture.
   */
  #rememberBurnWindow(events: readonly GameEvent[]): void {
    let window: BurnWindow | null = null;
    for (const event of events) {
      if (event.type === 'roll.action_resolved' && event.payload.burnWindow) {
        window = {
          rollId: event.payload.rollId,
          rollSeq: event.seq,
          characterId: event.payload.characterId,
          total: event.payload.total,
          challengeDice: [event.payload.challengeDice[0], event.payload.challengeDice[1]],
        };
      }
    }
    this.#burnWindow = window;
  }
}
