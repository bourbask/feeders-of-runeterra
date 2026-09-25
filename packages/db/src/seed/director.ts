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
 * MEASURED ON THE RUN, NOT DEDUCED: `decide()` emits 22 of the 71 types in
 * this campaign; the seed authors the other 49. `Intent` has twenty members
 * and none of them opens a scene, introduces an entity, opens a play session,
 * writes a chronicle or reverts a turn — three `decide*` functions say so in
 * their own comments ("M0-24 writes the event", "Play sessions produce no
 * engine event, and that is a finding"). So a seed built on intents ALONE
 * cannot cover the catalogue, and the note on the task sheet is true of the
 * dice and false of the rest.
 *
 * The line this file draws, and it is the invariant-1 line:
 *
 *   - `play()` — anything the RULES decide. Every die, every gauge, every
 *     tick, every price: `decide()` produces it or it does not exist. Nothing
 *     here recomputes an outcome, and no caller may hand in an event.
 *   - `write()` — what the SERVER decides, and nothing else: lifecycle,
 *     membership, scenes, entities, narration, sessions, chronicles,
 *     administration.
 *
 * THAT LINE IS A TYPE, NOT A SENTENCE: `SERVER_WRITTEN_TYPES` below closes the
 * second half, `authored()` is generic over it, and
 * `seed-deterministic.test.ts` proves the two halves partition
 * `GAME_EVENT_TYPES`. The paragraph you are reading used to be the whole
 * guarantee, and it held nothing.
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
 *
 * ── THE UNFINISHED TURN, AND WHY IT IS NOT A FIXTURE'S BUSINESS ──────────
 * Since M0-34 a roll that may be burned does not finish: `decide()` writes the
 * dice and hands the rest back in `Decision.pending`. This file TAKES that
 * value; it does not rebuild one. It used to, by re-reading
 * `roll.action_resolved` — engine state copied into a fixture, which is the
 * line above drawn the wrong way round — and the copy went stale the day the
 * window started carrying its plan, its group and its declaration. It broke
 * `develop` rather than a branch, because neither M0-34 nor M0-26 held both
 * halves.
 */

import type { SqliteConnection } from '../client.js';
import { replayCampaign } from '../rebuild.js';
import type { AppendableEvent } from '../repositories/events.js';
import { appendEvents, readGroup } from '../repositories/events.js';
import type { JournalEvent } from '../repositories/rows.js';
import { demoCorrelationId } from './ids.js';

import type {
  BurnWindow,
  CampaignId,
  CampaignState,
  CharacterId,
  ClockId,
  ClockState,
  DecisionContext,
  DecisionRng,
  EngineContent,
  EventId,
  EventScope,
  GameEvent,
  GameEventOf,
  GameEventPayloads,
  GameEventType,
  IdFactory,
  Intent,
  PlayerId,
  PlaySessionId,
  Rng,
  RngStream,
} from '@for/engine';
import {
  CLOCK_ADVANCE_MAX,
  CLOCK_ADVANCE_MIN,
  createCampaignRng,
  decide,
  isErr,
  reduceAll,
} from '@for/engine';

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

/**
 * The CLOSED list of journal entries the seed is allowed to author by hand.
 *
 * ── WHY A TUPLE AND NOT A COMMENT ────────────────────────────────────────
 * The header above draws the invariant-1 line between `play()` and `write()`.
 * Until this tuple existed, NOTHING held it: a caller could hand `write()` a
 * complete `roll.action_resolved` — action die, challenge dice, outcome — or a
 * `character.gauge_changed` with a delta of -99, and `tsc` and `eslint` both
 * exited 0. Measured in recette, and it is the sixth « rule present and inert »
 * of the project (ADR 0007). `authored()` is now generic over THIS tuple, so
 * the same probe stops compiling (`TS2345`).
 *
 * ── WHAT IS IN IT, AND WHAT IS NOT ───────────────────────────────────────
 * What the SERVER decides: lifecycle, membership, scenes, entities, narration,
 * sessions, chronicles, administration — plus the four types measured
 * unreachable through `decide()` with the shipped content (`script.ts` header).
 * What the RULES decide is absent by construction: every die, every gauge,
 * every tick, every price comes out of `decide()` or does not exist.
 *
 * ONE ENTRY CARRIES DICE AND SAYS SO: `roll.raw`. No `decide()` branch produces
 * a loose roll, and the faces are NOT typed — `Director.rawRoll()` draws them
 * on the engine's own generator. It is in this list because the SERVER writes
 * the entry, not because the seed writes the numbers.
 *
 * The partition is measured, not promised: `seed-deterministic.test.ts` asserts
 * that the types `play()` produced, united with this tuple, are exactly
 * `GAME_EVENT_TYPES`, with an empty intersection.
 */
export const SERVER_WRITTEN_TYPES = [
  'campaign.content_pack_changed',
  'campaign.created',
  'campaign.settings_updated',
  'campaign.status_changed',
  'campaign.truth_set',
  'character.asset_added',
  'character.asset_removed',
  'character.asset_upgraded',
  'character.attributes_corrected',
  'character.condition_removed',
  'character.created',
  'character.died',
  'character.renamed',
  'character.retired',
  'character.sheet_rebound',
  'character.xp_spent',
  'chronicle.compacted',
  'clock.advanced',
  'clock.cancelled',
  'clock.created',
  'clock.filled',
  'clock.resolved',
  'entity.introduced',
  'entity.mentioned',
  'entity.status_changed',
  'entity.updated',
  'move.aborted',
  'narration.gm_failed',
  'narration.gm_message',
  'narration.gm_proposal',
  'narration.proposal_accepted',
  'narration.proposal_rejected',
  'narration.safety_flag',
  'party.champion_locked',
  'party.champion_unlocked',
  'party.member_role_changed',
  'roll.raw',
  'scene.ended',
  'scene.facts_updated',
  'scene.started',
  'session.closed',
  'session.opened',
  'system.correction',
  'system.note',
  'system.payload_upcast',
  'system.reverted',
  'system.rules_version_migrated',
  'track.abandoned',
  'track.rank_changed',
] as const satisfies readonly GameEventType[];

/** A type this file is allowed to hand-write. Anything else is `decide()`'s. */
export type ServerWrittenType = (typeof SERVER_WRITTEN_TYPES)[number];

/** One entry the server writes. No roll, no arithmetic, no gauge. */
export interface AuthoredEvent<TType extends ServerWrittenType = ServerWrittenType> {
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
export function authored<TType extends ServerWrittenType>(
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
  /**
   * The group the open window's dice are already written under, in the SEED's
   * own numbering. `BurnWindow.correlationId` carries the engine's, which the
   * director re-stamps (header, « what it re-stamps »), so the two halves of a
   * burned turn need this one to land together.
   */
  #burnGroup: string | null = null;
  readonly #options: DirectorOptions;
  readonly #played = new Set<GameEventType>();
  readonly #written = new Set<GameEventType>();

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

  /**
   * The two halves of the partition, AS PLAYED — not as declared.
   *
   * `seed-deterministic.test.ts` unites them and compares the result to
   * `GAME_EVENT_TYPES`. Reading them off the run rather than off a list is what
   * makes emptying `SERVER_WRITTEN_TYPES` fail something: an unused member of
   * the tuple never shows up here.
   */
  get playedTypes(): readonly GameEventType[] {
    return [...this.#played].sort();
  }

  get writtenTypes(): readonly GameEventType[] {
    return [...this.#written].sort();
  }

  /**
   * The roll a `momentum.burn` may still revise — TAKEN FROM `decide()`.
   *
   * It is `Decision.pending` verbatim, never rebuilt from the journal. The
   * director used to fabricate one by re-reading `roll.action_resolved`, which
   * is engine state copied into a fixture: the invariant-1 line this file
   * draws between `play()` and `write()` forbids exactly that, and the copy
   * went stale the day the engine gave the window its plan, its group and its
   * declaration (M0-34) — `tsc` caught it only once both branches were on
   * `develop`, because neither branch alone held the two halves.
   */
  get burnWindow(): BurnWindow | null {
    return this.#burnWindow;
  }

  /**
   * Journal sequences written under one correlation identifier, READ BACK.
   *
   * It used to be a map the director filled as it wrote, and that map was a
   * copy of what the journal already holds: two writes under one identifier —
   * which is exactly what a burned turn is — replaced the first half instead
   * of extending it, and `system.reverted` would have taken the consequences
   * back without the dice. The journal is the only list that cannot drift.
   */
  group(correlationId: string): readonly number[] {
    const events = readGroup(this.#options.connection, this.#options.campaignId, correlationId);
    if (events.length === 0) {
      throw new DemoScriptInconsistent(`groupe de corrélation ${correlationId} inconnu`);
    }
    return events.map((event) => event.seq);
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
    if (this.#options.stopAt !== name) return;
    this.settle();
    throw new DemoStopped(name);
  }

  /**
   * THE SAFETY NET OF 03-donnees.md section 3.4, held where the SERVER holds
   * it (contract of M0-24): an open window is closed by `momentum.keep` before
   * anything else is written.
   *
   * It exists because a window is not a flag, it is an UNFINISHED TURN: the
   * dice are journalled and their consequences are still owed. Dropping it
   * would leave `move.declared` and `roll.action_resolved` with no
   * `move.resolved` and no effect — measured on this very seed the day M0-34
   * landed, on Ashe's `gather-information`: the turn stayed half-written and
   * the journal lost two entries without a single test going red.
   *
   * STRICTER THAN THE RULE, AND SAID SO. `burnWindowClosedBy` closes on the
   * next entry about the SAME character, whenever it comes; `play` closes at
   * the end of its own beat, so a turn never stays open across somebody else's.
   * Holding a window across beats is a server behaviour, not a fixture one, and
   * the real net lives in `CampaignService` (M0-24). The script therefore burns
   * on the beat that follows its roll, or not at all — and `write` refuses
   * while one is open rather than closing it behind the caller's back.
   *
   * Called directly at the end of the campaign and at the `--minimal` mark, so
   * that no base ever ends on a half-written turn.
   */
  settle(): void {
    const pending = this.#burnWindow;
    if (pending === null) return;
    this.#closeByKeep(pending);
  }

  #closeByKeep(pending: BurnWindow): { readonly events: readonly JournalEvent[] } {
    return this.#playOnce(
      pending.characterId,
      { type: 'momentum.keep', rollId: pending.roll.rollId },
      'filet de sécurité : la fenêtre de brûlure se ferme sans dépense',
    );
  }

  /**
   * One player intent, settled by the rules and written to the journal.
   *
   * Returns what the engine produced, WITH its allocated sequences, so the
   * script can hang a scene or a chronicle off a track the rules just opened
   * — without ever inventing its identifier.
   *
   * ── TWO INTENTS, ONE TURN ────────────────────────────────────────────────
   * A burned turn is TWO calls to `decide()` and it stays ONE correlation
   * group (03-donnees.md sections 0.5 and 3.7): `system.reverted` cancels a
   * group, so a second group would take the dice back without their
   * consequences, and `buildTurnProof` reads one group, so the « Pourquoi ? »
   * proof would show the dice on one side and the effects on the other.
   *
   * The engine already holds that rule through `BurnWindow.correlationId`, and
   * the closing entries come out stamped with it. The director imposes its own
   * identifiers (`demoCorrelationId`, see `ids.ts`), so it READS the engine's
   * verdict off the events rather than retyping the rule: same group as the
   * open window means the same turn, so the closing rejoins `#burnGroup` and
   * the turn counter does not advance.
   */
  play(
    actorId: CharacterId,
    intent: Intent,
    note: string,
  ): { readonly events: readonly JournalEvent[]; readonly correlationId: string } {
    const opened = this.#playOnce(actorId, intent, note);
    const pending = this.#burnWindow;
    if (pending === null) return opened;
    const closed = this.#closeByKeep(pending);
    return {
      events: [...opened.events, ...closed.events],
      correlationId: opened.correlationId,
    };
  }

  /**
   * The roll of a turn the script MEANS to burn on: the window stays open.
   *
   * The only caller is the two-step burn of `script.ts`, which plays
   * `momentum.burn` on the next beat. Any other caller gets the safety net at
   * the next beat, which is `momentum.keep` — never a dropped turn.
   */
  playHoldingWindow(
    actorId: CharacterId,
    intent: Intent,
    note: string,
  ): { readonly events: readonly JournalEvent[]; readonly correlationId: string } {
    return this.#playOnce(actorId, intent, note);
  }

  #playOnce(
    actorId: CharacterId,
    intent: Intent,
    note: string,
  ): { readonly events: readonly JournalEvent[]; readonly correlationId: string } {
    const seqBase = this.#state.seq + 1;
    const pending = this.#burnWindow;
    const ctx: DecisionContext = {
      rng: turnRng(this.#options.seed, seqBase),
      ids: this.#options.ids,
      now: this.#now,
      actorId,
      content: this.#options.content,
      burnWindow: pending,
    };
    const decision = decide(this.#state, intent, ctx);
    if (isErr(decision)) {
      throw new DemoIntentRefused(note, decision.error.code, decision.error.details);
    }
    const rejoined = this.#continuedGroup(pending, decision.value.events);
    const correlationId = rejoined ?? demoCorrelationId(this.#turn);
    if (rejoined === null) this.#turn += 1;
    const written = this.#append(
      decision.value.events.map((event) => this.#toAppendable(event, correlationId)),
    );
    this.#apply(decision.value.events);
    for (const event of decision.value.events) this.#played.add(event.type);
    this.#burnWindow = decision.value.pending;
    this.#burnGroup = decision.value.pending === null ? null : correlationId;
    this.#now += this.#options.step;
    return { events: written, correlationId };
  }

  /** Entries the server writes. One correlation group, like a turn. */
  write(events: readonly AuthoredEvent[]): {
    readonly events: readonly JournalEvent[];
    readonly correlationId: string;
  } {
    // NOT THE NET HERE, AND THAT IS DELIBERATE. A hand-written entry must not
    // slip between the dice and the consequences they still owe — but closing
    // the window at this point would be SILENT, and several payloads of
    // `script.ts` are built with `director.state.seq + 1` BEFORE this call
    // runs (`facts()`, `session.closed.lastSeq`). Appending a closing here
    // would move the sequence those payloads already predicted, and nothing
    // would go red. A script that holds a window owes it a `momentum.burn` on
    // the very next beat, or a `settle()`; anything else is a script bug and
    // says so.
    if (this.#burnWindow !== null) {
      throw new DemoScriptInconsistent(
        `fenêtre de brûlure encore ouverte sur le jet ${String(this.#burnWindow.rollSeq)} : ` +
          'la fermer par « momentum.burn » ou « settle() » avant d’écrire',
      );
    }
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
    for (const event of events) this.#written.add(event.type);
    this.#now += this.#options.step;
    return { events: written, correlationId };
  }

  /**
   * A clock advance whose THREE NUMBERS come from the reduced state.
   *
   * WHY THIS EXISTS. `clock.advanced` is one of the four types the shipped
   * content cannot reach through `decide()`, so the server writes it — and for
   * three releases it wrote `{ delta, from, to }` typed out in `script.ts`.
   * Measured in recette: replacing `{ delta: 3, from: 3, to: 6 }` with
   * `{ delta: 3, from: 1, to: 99 }` on a SIX-segment clock left all 17 tests,
   * `db:seed` and `db:check` green, and the « Pourquoi ? » proof of that turn
   * would have told a player the clock went from 1 to 99. Arithmetic in the
   * seed is arithmetic nobody checks.
   *
   * Here `from` is the clock's filled count as the reducer left it and `to` is
   * `min(from + delta, segments)` — the same ceiling `reduce.ts` applies. The
   * script chooses the clock and the size of the push, and nothing else.
   */
  clockAdvance(
    clockId: ClockId,
    delta: number,
    cause: GameEventPayloads['clock.advanced']['cause'],
  ): AuthoredEvent {
    if (!Number.isInteger(delta) || delta < CLOCK_ADVANCE_MIN || delta > CLOCK_ADVANCE_MAX) {
      throw new DemoScriptInconsistent(
        `avance d'horloge de ${String(delta)} segment(s), hors de ` +
          `${String(CLOCK_ADVANCE_MIN)}..${String(CLOCK_ADVANCE_MAX)}`,
      );
    }
    const clock: ClockState | undefined = this.#state.clocks[clockId];
    if (clock === undefined) {
      throw new DemoScriptInconsistent(`horloge ${clockId} inconnue de l'état`);
    }
    return authored(
      'clock.advanced',
      {
        clockId,
        delta,
        from: clock.filled,
        to: Math.min(clock.filled + delta, clock.segments),
        cause,
      },
      { actorKind: 'gm_ai' },
    );
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
    this.#burnGroup = null;
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
   * The seed's group for a turn that CONTINUES the open window, or `null`.
   *
   * The test is the engine's own answer, not a copy of its rule: `decide()`
   * stamps a continued turn with `window.correlationId` (`createTurn`, via
   * `closeBurnWindow`) and mints a fresh one otherwise. So a produced turn
   * whose identifier is the window's IS the closing, whatever the intent was
   * called and whatever the rules made of it.
   */
  #continuedGroup(pending: BurnWindow | null, events: readonly GameEvent[]): string | null {
    if (pending === null || this.#burnGroup === null) return null;
    if (events[0]?.correlationId !== pending.correlationId) return null;
    return this.#burnGroup;
  }
}
