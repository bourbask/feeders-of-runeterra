/**
 * `decide()` — THE FUNCTION THAT SETTLES THINGS.
 *
 * Invariant 1 lives here and nowhere else. This is the only place in the whole
 * system that draws a die, reads an outcome and turns it into journal entries.
 * Everything downstream — the server, the storyteller, the client — receives
 * what comes out of here as a fact already acquired. If a second place ever
 * starts writing `GameEvent`s, the invariant is gone, whatever the tests say.
 *
 * THE GOLDEN RULE, in one line: `decide` draws the dice, `reduce` never does.
 *
 * It returns a `Result` and does not throw on a rule violation
 * (01-architecture.md section 3.3). Exceptions stay for what they are for: a
 * caller handing the engine something structurally impossible, such as a price
 * table with a hole in it — which the content loader refuses at startup
 * (`coversDie`), so it cannot reach this function from a running server. The
 * REFUSALS a player can trigger are all `err(RuleViolation)`, every one of
 * them from the closed list in `types/violations.ts`.
 *
 * ---------------------------------------------------------------------------
 * THREE DEVIATIONS FROM THE SKETCH IN 01-architecture.md section 2.3, REPORTED
 * RATHER THAN APPLIED IN SILENCE. That document sketches
 * `DecisionContext = { rng, ids, now, actorId }`. The four fields are kept,
 * with their names and their meaning. Three things are added, and each one is
 * something the rules cannot run without:
 *
 *  1. `content`. 03-donnees.md section 3.3, rule 4 states that content the
 *     engine needs arrives as a FROZEN ARGUMENT. A move's consequences, the
 *     price table, the presage table and the oracles are all content. Without
 *     them `decide` cannot resolve a single move, so the sketch cannot be
 *     complete as written.
 *  2. `rng` is a `DecisionRng` (one generator PER STREAM) rather than a single
 *     `Rng`. 03-donnees.md section 3.6 requires draws to be reproducible from
 *     `(seed, seq, stream)`; one shared generator would make the index of a
 *     `price` draw depend on how many action dice happened to be rolled first,
 *     and the derivation would stop being stateless.
 *  3. `burnWindow`. The two-step burn (ARCHITECTURE.md section 4.4) needs to
 *     know which roll is still open. `CampaignState` holds no such field and
 *     is frozen by the Zod mirror, so the caller derives it from the journal —
 *     which is where 03-donnees.md section 3.7 says it comes from — and passes
 *     it in.
 *
 * An ADR is proposed for the three; none of them was invented for comfort.
 * ---------------------------------------------------------------------------
 */

import { outcomeFor, rollChallenge } from './dice/challenge.js';
import { rollOracle } from './dice/oracle.js';
import { PRESAGE_TABLE_ID, rollPresage } from './dice/presage.js';
import { NO_EFFECT_INDEX, PRICE_DIE, PRICE_TABLE_ID, rollPrice } from './dice/price.js';
import { rollProgress } from './dice/progress.js';
import { applyGaugeDelta } from './gauges.js';
import type { CharacterId, ClockId, EventId, IdFactory, PlayerId, RollId, TrackId } from './ids.js';
import { applyMomentumDelta, canBurnMomentum, resetMomentum } from './momentum.js';
import type { EngineContent, MoveDefinition, PriceEntryDefinition } from './moves/content.js';
import type { MoveIntent, MovePlan } from './moves/handler.js';
import { MOVE_BY_INTENT } from './moves/index.js';
import { boxesFilled, clampTicks } from './progress-track.js';
import type { Result } from './result.js';
import { err, isErr, ok } from './result.js';
import type { Rng, RngStream } from './rng.js';
import type { AttributeId } from './types/attributes.js';
import { ATTRIBUTE_MAX, ATTRIBUTE_MIN } from './types/attributes.js';
import type {
  BriefAppliedEffect,
  BriefAudience,
  BriefImposedPrice,
  BriefPerceivableFact,
  BriefPresage,
  BriefRollDetail,
  NarrationBrief,
} from './types/brief.js';
import type { CampaignState } from './types/campaign.js';
import type { CharacterState } from './types/character.js';
import type { ClockState } from './types/clock.js';
import { CLOCK_ADVANCE_MAX, CLOCK_ADVANCE_MIN } from './types/clock.js';
import type { EffectTarget, EngineEffect } from './types/effects.js';
import type {
  ActorKind,
  EventScope,
  GameEvent,
  GameEventOf,
  GameEventPayloads,
  RollAdd,
} from './types/events.js';
import type { Intent } from './types/intents.js';
import type { MoveId, Outcome } from './types/moves.js';
import { LIKELIHOOD_THRESHOLDS } from './types/moves.js';
import type { ProgressRank, TrackState } from './types/progress.js';
import { TICKS_PER_MILESTONE } from './types/progress.js';
import type { SceneState } from './types/scene.js';
import type { RuleViolation } from './types/violations.js';

// ------------------------------------------------------------------ context

/**
 * The engine's randomness for one decision: ONE GENERATOR PER NAMED STREAM.
 *
 * The canonical implementation is `createCampaignRng(seed, turnSeq, stream)`,
 * with `turnSeq = state.seq + 1` — the sequence the first entry of this turn
 * will take. Stateless derivation, so reproducing a draw needs no replay of
 * everything that came before (03-donnees.md section 3.6).
 */
export interface DecisionRng {
  stream(stream: RngStream): Rng;
}

/**
 * THE UNFINISHED TURN: an action roll that is written, visible, and whose
 * consequences have NOT been applied yet.
 *
 * 03-donnees.md section 3.4: "la regle veut qu'on voie les des avant de
 * decider [...] `move.resolved` n'applique les effets qu'apres". So the window
 * is not a flag on a finished turn, it IS the turn, held open. Everything
 * `decide` needs to finish it lives here, because there is nowhere else to put
 * it: `CampaignState` is mirrored in `@for/contracts` and adding to it is a
 * contract change.
 *
 * `intent` is what the player asked for, carried verbatim, and `plan` is what
 * the engine made of it AT DECLARATION TIME. The plan is CARRIED rather than
 * recomputed, because recomputing it replays the feasibility check that was
 * already settled before the dice were drawn: a scene closed between the two
 * steps made `strike` answer `no_active_scene` at closing time, with the dice
 * already in the journal and no way left to finish the turn. A window must
 * always be closeable — the dice are written, and only the consequences are
 * still owed.
 *
 * WHO FILLS IT: `decide` itself, on the turn that rolled (`Decision.pending`).
 * The caller stores it and hands it back on the closing intent. A cancelled
 * turn (`system.reverted`) drops it, which is how 03-donnees.md section 3.7
 * keeps its promise that the burn window comes back with everything else.
 */
export interface BurnWindow {
  /** Journal sequence of the `roll.action_resolved` this window holds open. */
  readonly rollSeq: number;
  readonly characterId: CharacterId;
  /** The move still waiting for its consequences, exactly as it was asked. */
  readonly intent: MoveIntent;
  /**
   * The group the turn is already written under. CARRIED, so the closing
   * entries join it instead of opening a second one: a turn is ONE
   * `correlation_id` (03-donnees.md sections 0.5 and 3.7). Two groups would
   * let `system.reverted` cancel a `roll.action_resolved` without the
   * `character.gauge_changed` it caused, and would leave `buildTurnProof` —
   * built from the events of one group — with the dice on one side and the
   * consequences on the other.
   */
  readonly correlationId: string;
  /** The `move.declared` every entry of this turn hangs from (`causation_id`). */
  readonly declarationId: EventId;
  /** What the engine made of the intent, decided BEFORE the dice were drawn. */
  readonly plan: MovePlan;
  /** What the dice gave, before any burn. */
  readonly outcome: Outcome;
  readonly isPresage: boolean;
  /**
   * The arithmetic written on `roll.action_resolved`, unmodified. It carries
   * `rollId`, the score a burn must beat (`total`) and the challenge dice the
   * revision is read against — so none of the three is copied twice.
   */
  readonly roll: BriefRollDetail;
}

/**
 * Does this journal entry shut that window?
 *
 * The safety net of 03-donnees.md section 3.4, in one place: "si le joueur ne
 * brule pas, la fenetre se ferme au premier evenement suivant du meme
 * personnage". Exported because the CALLER is the one that sees the next
 * entry, and a net whose rule is retyped at the call site is a net with a hole.
 *
 * It answers WHETHER, never WHAT: the events of the closing are produced by
 * `decide` on `momentum.keep`, like any other decision.
 */
export function burnWindowClosedBy(window: BurnWindow, event: GameEvent): boolean {
  return event.subjectCharacterId === window.characterId && event.seq > window.rollSeq;
}

export interface DecisionContext {
  readonly rng: DecisionRng;
  readonly ids: IdFactory;
  /** Epoch milliseconds, injected. The engine never reads a clock. */
  readonly now: number;
  readonly actorId: CharacterId;
  /** The content bundle at the version this campaign pins. */
  readonly content: EngineContent;
  /** The roll still open for a burn, or `null`. */
  readonly burnWindow?: BurnWindow | null;
}

export interface Decision {
  readonly events: readonly GameEvent[];
  /** Already decided, already journalled. The storyteller dresses it. */
  readonly brief: NarrationBrief;
  /**
   * NON-NULL WHEN THE TURN IS NOT OVER: the dice are written and the burn
   * window is open, so no consequence has been applied and no `move.resolved`
   * has been emitted. The caller stores it, hands it back on the closing
   * intent, and holds the narration until then — narrating an outcome the
   * player is about to revise would be telling the story twice.
   */
  readonly pending: BurnWindow | null;
}

// ------------------------------------------------------------------ helpers

const PAYLOAD_VERSION = 1;

/**
 * ADR 0008: the SERVER alone fills `scope` and `recipients`. The engine writes
 * the only pair that is consistent for a party that stays together, and M1
 * brings the split-party scope with the flag that decides it.
 */
const DEFAULT_SCOPE: EventScope = 'table';

/** Reserved template key for a turn that played no move. */
export const FALLBACK_DEFAULT_TEMPLATE_ID = 'default';

/**
 * How deep a price may cascade. A `pay_price` whose drawn entry is itself a
 * `pay_price` would otherwise loop; one level of nesting is enough for
 * "the price drags something else with it" and is bounded by construction.
 */
const MAX_EFFECT_DEPTH = 2;

interface EmitOptions {
  readonly actorKind: ActorKind;
  readonly actorPlayerId?: PlayerId | null;
  readonly subjectCharacterId?: CharacterId | null;
  readonly rngStream?: RngStream | null;
  readonly rngDrawIndex?: number | null;
}

/** `effect.op`, as the short machine string the journal reads with. */
function effectCause(effect: EngineEffect): string {
  return `effect:${effect.op}`;
}

/** Sorted by identifier: two replays must visit the same people in the same order. */
function activeCharacters(state: CampaignState): readonly CharacterState[] {
  return Object.values(state.characters)
    .filter((character) => character.status === 'active')
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A player-supplied modifier, as something the dice can take. */
function wholeBonus(bonus: number): number {
  return Number.isFinite(bonus) ? Math.trunc(bonus) : 0;
}

/**
 * The extreme band of a d100 oracle answer.
 *
 * A READING THE SPECIFICATION DOES NOT FIX, and it is flagged as such rather
 * than buried: `roll.yes_no_resolved` carries `isExtreme` and nothing says what
 * makes a result extreme. The reading taken is the usual one for a percentile
 * band — the outermost tenth of whichever side the answer landed on — so that
 * `improbable` (threshold 10) has an extreme yes at 1 and `quasi-certain`
 * (threshold 90) an extreme no at 100.
 */
export function isExtremeAnswer(value: number, threshold: number): boolean {
  if (value <= threshold) return value <= Math.max(1, Math.floor(threshold / 10));
  return value > 100 - Math.max(1, Math.floor((100 - threshold) / 10));
}

/** The template key a fallback narration resolves against. */
export function fallbackTemplateId(moveId: MoveId | null, outcome: Outcome | null): string {
  return `${moveId ?? FALLBACK_DEFAULT_TEMPLATE_ID}/${outcome ?? 'franche'}`;
}

// ------------------------------------------------------------ the turn scribe

/**
 * What a turn joins when it CONTINUES one already written instead of opening
 * its own: the correlation group, and the declaration its entries hang from.
 * Only the second step of a burn uses it (`closeBurnWindow`).
 */
interface TurnContinuation {
  readonly correlationId: string;
  readonly declarationId: EventId;
}

/**
 * The bookkeeping every decision shares: sequences, envelopes, draw indexes,
 * and the running values of whoever the turn touches.
 *
 * It mutates ONLY its own copies. `decide` never writes into the state it was
 * handed, which is the same promise `reduce` makes and for the same reason.
 */
function createTurn(state: CampaignState, ctx: DecisionContext, continued?: TurnContinuation) {
  const events: GameEvent[] = [];
  const workingCharacters = new Map<CharacterId, CharacterState>();
  const workingTracks = new Map<TrackId, TrackState>();
  const workingClocks = new Map<ClockId, ClockState>();
  const drawIndexes = new Map<RngStream, number>();
  const appliedEffects: BriefAppliedEffect[] = [];
  const correlationId = continued?.correlationId ?? ctx.ids.next();
  // The entry everything hangs from. Null until the first one is written, then
  // that one — except on a CONTINUED turn, where it is the declaration written
  // in the first half and the whole group keeps hanging from it.
  let causationId: EventId | null = continued?.declarationId ?? null;
  let imposedPrice: BriefImposedPrice | null = null;
  let presage: BriefPresage | null = null;
  let xpEarnedThisTurn = 0;
  let xpLostThisTurn = 0;

  function emit<TType extends keyof GameEventPayloads>(
    type: TType,
    payload: GameEventPayloads[TType],
    options: EmitOptions,
  ): GameEventOf<TType> {
    const event: GameEventOf<TType> = {
      id: ctx.ids.next() as EventId,
      campaignId: state.campaignId,
      seq: state.seq + events.length + 1,
      playSessionId: null,
      payloadVersion: PAYLOAD_VERSION,
      actorKind: options.actorKind,
      actorPlayerId: options.actorPlayerId ?? null,
      subjectCharacterId: options.subjectCharacterId ?? null,
      correlationId,
      causationId,
      rngStream: options.rngStream ?? null,
      rngDrawIndex: options.rngDrawIndex ?? null,
      createdAt: ctx.now,
      scope: DEFAULT_SCOPE,
      recipients: null,
      type,
      payload,
    };
    events.push(event as GameEvent);
    causationId ??= event.id;
    return event;
  }

  /** The index this stream stands at, then advanced by one. One index per ROLL. */
  function nextDrawIndex(stream: RngStream): number {
    const index = drawIndexes.get(stream) ?? state.rng.draws[stream] ?? 0;
    drawIndexes.set(stream, index + 1);
    return index;
  }

  function character(id: CharacterId): CharacterState | undefined {
    return workingCharacters.get(id) ?? state.characters[id];
  }

  function track(id: TrackId): TrackState | undefined {
    return workingTracks.get(id) ?? state.tracks[id];
  }

  function clock(id: ClockId): ClockState | undefined {
    return workingClocks.get(id) ?? state.clocks[id];
  }

  return {
    events,
    correlationId,
    emit,
    nextDrawIndex,
    character,
    track,
    clock,
    putCharacter: (next: CharacterState): void => {
      workingCharacters.set(next.id, next);
    },
    putTrack: (next: TrackState): void => {
      workingTracks.set(next.id, next);
    },
    putClock: (next: ClockState): void => {
      workingClocks.set(next.id, next);
    },
    appliedEffects,
    noteEffect: (entry: BriefAppliedEffect): void => {
      appliedEffects.push(entry);
    },
    get imposedPrice(): BriefImposedPrice | null {
      return imposedPrice;
    },
    setImposedPrice: (next: BriefImposedPrice): void => {
      imposedPrice = next;
    },
    get presage(): BriefPresage | null {
      return presage;
    },
    setPresage: (next: BriefPresage): void => {
      presage = next;
    },
    get xpEarned(): number {
      return xpEarnedThisTurn;
    },
    get xpLost(): number {
      return xpLostThisTurn;
    },
    addXpEarned: (amount: number): void => {
      xpEarnedThisTurn += amount;
    },
    addXpLost: (amount: number): void => {
      xpLostThisTurn += amount;
    },
  };
}

type Turn = ReturnType<typeof createTurn>;

// ------------------------------------------------------------ effect executor

/**
 * THE ONE EFFECT EXECUTOR.
 *
 * `switch (effect.op)` has thirteen branches and NO `default`:
 * `@typescript-eslint/switch-exhaustiveness-check` does not accept a default as
 * coverage, so a fourteenth operation added to `EngineEffect` tomorrow breaks
 * the lint instead of being dropped in silence.
 *
 * `pay_price` has ONE branch, because ADR 0006 leaves it one mode. There is no
 * `gm_choice`, no `player_choice`, and no place to grow one: the engine rolls
 * the d12 and applies what came up.
 */
function applyEffect(
  state: CampaignState,
  turn: Turn,
  ctx: DecisionContext,
  plan: MovePlan | null,
  effect: EngineEffect,
  depth: number,
): boolean {
  switch (effect.op) {
    case 'gauge':
      return applyGaugeEffect(state, turn, ctx, effect);
    case 'momentum':
      return applyMomentumEffect(turn, ctx, effect.delta, effectCause(effect));
    case 'momentum_reset': {
      const actor = turn.character(ctx.actorId);
      if (actor === undefined) return false;
      return applyMomentumEffect(
        turn,
        ctx,
        resetMomentum(actor.momentumBounds) - actor.momentum,
        effectCause(effect),
      );
    }
    case 'condition_add':
      return applyConditionAdd(turn, ctx, effect.conditionId);
    case 'condition_remove':
      return applyConditionRemove(turn, ctx, effect.conditionId, effectCause(effect));
    case 'track_tick':
      return applyTrackTick(state, turn, ctx, plan, effect);
    case 'track_create':
      return applyTrackCreate(turn, ctx, plan, effect);
    case 'clock_advance':
      return applyClockAdvance(state, turn, ctx, effect.segments);
    case 'xp':
      return applyXp(turn, ctx, plan, effect.amount, effectCause(effect));
    case 'pay_price':
      return applyPayPrice(state, turn, ctx, plan, depth);
    case 'oracle':
      return applyOracle(turn, ctx, effect.tableId);
    case 'narrative':
      // Zero mechanics by definition: an instruction to the storyteller, which
      // travels in the brief and writes nothing to the journal.
      return true;
    case 'choice':
      // NOT EXECUTABLE IN M0, and deliberately not faked. ADR 0006 bound 3 says
      // the player's selection arrives as an ORDINARY INTENT validated by the
      // server; `types/intents.ts` carries no such intent yet. Applying one
      // option on the player's behalf would be the engine choosing, which is
      // the one thing `choice` must never become. Reported with the task.
      return false;
  }
}

function applyEffects(
  state: CampaignState,
  turn: Turn,
  ctx: DecisionContext,
  plan: MovePlan | null,
  effects: readonly EngineEffect[],
  depth: number,
): void {
  for (const effect of effects) {
    if (!applyEffect(state, turn, ctx, plan, effect, depth)) continue;
    // The entry the effect produced, or — for `narrative`, which writes
    // nothing — the last entry of the turn so far. `BriefAppliedEffect.eventSeq`
    // always points inside this turn's group, which is what makes the proof
    // view checkable (02-mj-ia.md section 4.8.6, criterion 2).
    const produced = turn.events[turn.events.length - 1];
    turn.noteEffect({
      effect,
      subjectCharacterId: produced?.subjectCharacterId ?? null,
      trackId: plan?.trackId ?? null,
      eventSeq: produced?.seq ?? state.seq,
    });
  }
}

/** `self`, `all-allies`, and the one target nothing can carry yet. */
function resolveTargets(
  state: CampaignState,
  turn: Turn,
  ctx: DecisionContext,
  target: EffectTarget,
): readonly CharacterState[] {
  switch (target) {
    case 'self': {
      const actor = turn.character(ctx.actorId);
      return actor === undefined ? [] : [actor];
    }
    case 'all-allies':
      return activeCharacters(state).map((member) => turn.character(member.id) ?? member);
    case 'chosen-ally':
      // Same hole as `op: 'choice'`: the selection is an ordinary player intent
      // (ADR 0006 bound 3) and no such intent exists yet. Nobody is picked here.
      return [];
  }
}

function applyGaugeEffect(
  state: CampaignState,
  turn: Turn,
  ctx: DecisionContext,
  effect: Extract<EngineEffect, { readonly op: 'gauge' }>,
): boolean {
  if (effect.delta === 0) return false;
  const targets = resolveTargets(state, turn, ctx, effect.target);
  if (targets.length === 0) return false;
  for (const target of targets) {
    const from = target.gauges[effect.gauge];
    const change = applyGaugeDelta(from, effect.delta);
    turn.putCharacter({
      ...target,
      gauges: { ...target.gauges, [effect.gauge]: change.value },
    });
    turn.emit(
      'character.gauge_changed',
      {
        characterId: target.id,
        gauge: effect.gauge,
        delta: effect.delta,
        from,
        to: change.value,
        clamped: change.clamped,
        cause: effectCause(effect),
      },
      { actorKind: 'engine', subjectCharacterId: target.id },
    );
  }
  return true;
}

function applyMomentumEffect(
  turn: Turn,
  ctx: DecisionContext,
  delta: number,
  cause: string,
): boolean {
  if (delta === 0) return false;
  const actor = turn.character(ctx.actorId);
  if (actor === undefined) return false;
  const change = applyMomentumDelta(actor.momentum, delta, actor.momentumBounds);
  turn.putCharacter({ ...actor, momentum: change.momentum });
  turn.emit(
    'character.momentum_changed',
    {
      characterId: actor.id,
      delta,
      from: actor.momentum,
      to: change.momentum,
      clamped: change.clamped,
      cause,
    },
    { actorKind: 'engine', subjectCharacterId: actor.id },
  );
  return true;
}

function applyConditionAdd(turn: Turn, ctx: DecisionContext, conditionId: string): boolean {
  const actor = turn.character(ctx.actorId);
  if (actor === undefined) return false;
  if (actor.conditions.some((condition) => condition.conditionId === conditionId)) return false;
  const definition = ctx.content.conditions[conditionId];
  if (definition === undefined) return false;
  const event = turn.emit(
    'character.condition_added',
    {
      characterId: actor.id,
      conditionId,
      label: definition.label,
      source: 'engine',
    },
    { actorKind: 'engine', subjectCharacterId: actor.id },
  );
  turn.putCharacter({
    ...actor,
    conditions: [
      ...actor.conditions,
      { conditionId, label: definition.label, source: 'engine', sinceSeq: event.seq },
    ],
  });
  return true;
}

function applyConditionRemove(
  turn: Turn,
  ctx: DecisionContext,
  conditionId: string,
  cause: string,
): boolean {
  const actor = turn.character(ctx.actorId);
  if (actor === undefined) return false;
  if (!actor.conditions.some((condition) => condition.conditionId === conditionId)) return false;
  turn.putCharacter({
    ...actor,
    conditions: actor.conditions.filter((condition) => condition.conditionId !== conditionId),
  });
  turn.emit(
    'character.condition_removed',
    { characterId: actor.id, conditionId, cause },
    { actorKind: 'engine', subjectCharacterId: actor.id },
  );
  return true;
}

/**
 * The track a `track_tick` lands on: the one this move targets, or failing
 * that the most recently opened track of the right kind. Deterministic by
 * construction — `createdSeq` descending, identifier to break a tie.
 */
function targetTrack(
  state: CampaignState,
  turn: Turn,
  plan: MovePlan | null,
  kind: TrackState['kind'],
): TrackState | undefined {
  if (plan?.trackId != null) {
    const planned = turn.track(plan.trackId);
    if (planned?.kind === kind) return planned;
  }
  return Object.values(state.tracks)
    .map((candidate) => turn.track(candidate.id) ?? candidate)
    .filter((candidate) => candidate.kind === kind && candidate.status === 'open')
    .sort((a, b) => b.createdSeq - a.createdSeq || a.id.localeCompare(b.id))[0];
}

function applyTrackTick(
  state: CampaignState,
  turn: Turn,
  ctx: DecisionContext,
  plan: MovePlan | null,
  effect: Extract<EngineEffect, { readonly op: 'track_tick' }>,
): boolean {
  const track = targetTrack(state, turn, plan, effect.trackKind);
  if (track === undefined) return false;
  const ticks = effect.useRank ? TICKS_PER_MILESTONE[track.rank] : effect.ticks;
  if (ticks === 0) return false;
  const to = clampTicks(track.ticks + ticks);
  const event = turn.emit(
    'track.ticked',
    {
      trackId: track.id,
      ticks,
      from: track.ticks,
      to,
      cause: effectCause(effect),
      milestones: effect.useRank ? 1 : 0,
    },
    { actorKind: 'engine', subjectCharacterId: ctx.actorId },
  );
  turn.putTrack({ ...track, ticks: to, updatedSeq: event.seq });
  return true;
}

/**
 * The rank of a track a move opens.
 *
 * `rankFrom: 'player'` takes the rank the intent named; `'fixed'` takes the
 * one the content pinned. NEITHER IS INVENTED: an effect that names no rank
 * and gets none from the player creates no track at all, because a default
 * rank written here would be a rule no specification carries, and it would
 * silently decide how long a vow takes.
 */
function resolveRank(
  effect: Extract<EngineEffect, { readonly op: 'track_create' }>,
  plan: MovePlan | null,
): ProgressRank | null {
  if (effect.rankFrom === 'player') return plan?.playerRank ?? effect.rank ?? null;
  return effect.rank ?? null;
}

function applyTrackCreate(
  turn: Turn,
  ctx: DecisionContext,
  plan: MovePlan | null,
  effect: Extract<EngineEffect, { readonly op: 'track_create' }>,
): boolean {
  const rank = resolveRank(effect, plan);
  if (rank === null) return false;
  const trackId = ctx.ids.next() as TrackId;
  turn.emit(
    'track.created',
    {
      trackId,
      kind: effect.trackKind,
      rank,
      title: plan?.trackTitle ?? '',
      description: '',
      ownerCharacterId: ctx.actorId,
      visibility: 'public',
      initialTicks: 0,
    },
    { actorKind: 'engine', subjectCharacterId: ctx.actorId },
  );
  return true;
}

/**
 * The clock a `clock_advance` lands on: the most recently created one still
 * ticking. A clock identifier is not expressible in `EngineEffect`, so the
 * choice has to be a RULE rather than a parameter; the alternative — a clock
 * named by content — would let a content file reach a clock the campaign opened
 * at runtime, which is not something a versioned file can know.
 */
function applyClockAdvance(
  state: CampaignState,
  turn: Turn,
  ctx: DecisionContext,
  segments: number,
): boolean {
  const clock = Object.values(state.clocks)
    .map((candidate) => turn.clock(candidate.id) ?? candidate)
    .filter((candidate) => candidate.status === 'ticking')
    .sort((a, b) => b.createdSeq - a.createdSeq || a.id.localeCompare(b.id))[0];
  if (clock === undefined) return false;
  const delta = Math.min(Math.max(Math.trunc(segments), CLOCK_ADVANCE_MIN), CLOCK_ADVANCE_MAX);
  const to = Math.min(clock.filled + delta, clock.segments);
  if (to === clock.filled) return false;
  const event = turn.emit(
    'clock.advanced',
    { clockId: clock.id, delta, from: clock.filled, to, cause: 'effect:clock_advance' },
    { actorKind: 'engine', subjectCharacterId: ctx.actorId },
  );
  const filled = to === clock.segments;
  turn.putClock({
    ...clock,
    filled: to,
    status: filled ? 'filled' : clock.status,
    updatedSeq: event.seq,
  });
  if (filled) {
    turn.emit(
      'clock.filled',
      { clockId: clock.id, consequence: clock.consequence },
      { actorKind: 'engine', subjectCharacterId: ctx.actorId },
    );
  }
  return true;
}

function applyXp(
  turn: Turn,
  ctx: DecisionContext,
  plan: MovePlan | null,
  amount: number,
  reason: string,
): boolean {
  const actor = turn.character(ctx.actorId);
  if (actor === undefined || amount === 0) return false;
  if (amount > 0) {
    turn.addXpEarned(amount);
    turn.putCharacter({ ...actor, xpEarned: actor.xpEarned + amount });
    turn.emit(
      'character.xp_earned',
      plan?.trackId == null
        ? { characterId: actor.id, amount, reason }
        : { characterId: actor.id, amount, reason, trackId: plan.trackId },
      { actorKind: 'engine', subjectCharacterId: actor.id },
    );
    return true;
  }
  turn.addXpLost(-amount);
  turn.putCharacter({ ...actor, xpSpent: actor.xpSpent - amount });
  turn.emit(
    'character.xp_spent',
    { characterId: actor.id, amount: -amount, target: reason },
    { actorKind: 'player', actorPlayerId: actor.playerId, subjectCharacterId: actor.id },
  );
  return true;
}

/**
 * ADR 0006 made physical: ONE d12, ONE entry, no choice anywhere.
 *
 * When the entry carries several `suggestedEffects`, a SECOND draw on the same
 * `price` stream picks the index and `effectIndex` records it, so the whole
 * thing replays identically. That draw only happens when there is something to
 * arbitrate (`dice/price.ts` says why spending a die on a one-horse race would
 * shift every later draw of the stream).
 */
function applyPayPrice(
  state: CampaignState,
  turn: Turn,
  ctx: DecisionContext,
  plan: MovePlan | null,
  depth: number,
): boolean {
  if (depth >= MAX_EFFECT_DEPTH) return false;
  const table = ctx.content.priceTable;
  if (table.id !== PRICE_TABLE_ID || table.die !== PRICE_DIE) return false;
  const drawIndex = turn.nextDrawIndex('price');
  const roll = rollPrice<EngineEffect, PriceEntryDefinition>(table, ctx.rng.stream('price'));
  const rollId = ctx.ids.next() as RollId;
  turn.emit(
    'roll.price_paid',
    {
      rollId,
      value: roll.value,
      entryId: roll.entry.id,
      text: roll.entry.text,
      severity: roll.entry.severity,
      effectIndex: roll.effectIndex,
      targetCharacterId: ctx.actorId,
    },
    {
      actorKind: 'engine',
      subjectCharacterId: ctx.actorId,
      rngStream: 'price',
      rngDrawIndex: drawIndex,
    },
  );
  turn.setImposedPrice({
    rollId,
    tableId: table.id,
    value: roll.value,
    entryId: roll.entry.id,
    text: roll.entry.text,
    severity: roll.entry.severity,
    effectIndex: roll.effectIndex,
  });
  if (roll.effect !== null && roll.effectIndex !== NO_EFFECT_INDEX) {
    applyEffects(state, turn, ctx, plan, [roll.effect], depth + 1);
  }
  return true;
}

function applyOracle(turn: Turn, ctx: DecisionContext, tableId: string): boolean {
  const table = ctx.content.oracles[tableId];
  if (table === undefined) return false;
  const drawIndex = turn.nextDrawIndex('oracle');
  const roll = rollOracle(table, ctx.rng.stream('oracle'));
  turn.emit(
    'roll.oracle_resolved',
    {
      rollId: ctx.ids.next() as RollId,
      tableId: table.id,
      tableVersion: table.version,
      dieSize: table.die,
      value: roll.value,
      entryId: roll.entry.id,
      text: roll.entry.text,
      tags: roll.entry.tags ?? [],
    },
    {
      actorKind: 'engine',
      subjectCharacterId: ctx.actorId,
      rngStream: 'oracle',
      rngDrawIndex: drawIndex,
    },
  );
  return true;
}

// ------------------------------------------------------------------ the actor

function requireActiveCampaign(state: CampaignState): RuleViolation | null {
  return state.status === 'active'
    ? null
    : { code: 'campaign_not_active', details: { status: state.status } };
}

/**
 * The character acting, or the reason they cannot.
 *
 * Order matters to the player: "you do not exist", "you are dead", "you
 * retired", "you are not in this campaign", "your player is not at the table".
 * Each one is a different fix.
 */
function requireActor(
  state: CampaignState,
  actorId: CharacterId,
): Result<CharacterState, RuleViolation> {
  const character = state.characters[actorId];
  if (character === undefined) {
    return err({ code: 'unknown_character', details: { characterId: actorId } });
  }
  if (character.status === 'dead') {
    return err({ code: 'character_dead', details: { characterId: actorId } });
  }
  if (character.status === 'retired') {
    return err({ code: 'character_retired', details: { characterId: actorId } });
  }
  if (character.status === 'draft') {
    return err({ code: 'character_not_in_campaign', details: { characterId: actorId } });
  }
  if (!state.party.memberPlayerIds.includes(character.playerId)) {
    return err({ code: 'not_a_member', details: { playerId: character.playerId } });
  }
  return ok(character);
}

/**
 * Values a die can take.
 *
 * `rollChallenge` THROWS on an attribute outside [1, 3] or a non-integer
 * momentum, and it is right to: those cannot come from a character sheet. But
 * `decide` promises never to throw, so the impossible is turned into a refusal
 * here, at the boundary, once.
 */
function requireRollableActor(
  character: CharacterState,
  attribute: AttributeId,
): RuleViolation | null {
  const value = character.attributes[attribute];
  if (!Number.isInteger(value) || value < ATTRIBUTE_MIN || value > ATTRIBUTE_MAX) {
    return { code: 'attribute_not_allowed', details: { attribute, value } };
  }
  if (!Number.isInteger(character.momentum)) {
    return {
      code: 'gauge_out_of_range',
      details: { field: 'momentum', value: character.momentum },
    };
  }
  return null;
}

// ------------------------------------------------------------------- the brief

/**
 * The (scope, recipients) pair of a brief, built in ONE place.
 *
 * THE INVARIANT, and the only reason this function exists instead of an object
 * literal at each call site: `recipients` is `null` EXACTLY WHEN `scope` is
 * `'table'`. Two fields that must agree, written in two places, drift — that
 * is how `recipients: []` at table scope, or `recipients: null` on a private
 * fact, gets into a journal nobody re-reads. ADR 0008 decision 1.
 */
export function briefAudience(scope: EventScope, recipients: readonly PlayerId[]): BriefAudience {
  if (scope === 'table') return { scope, recipients: null };
  return { scope, recipients: [...recipients] };
}

/** Sorted by `ref.id`, then by `kind` so a ref in both lists still has one order. */
function compareFacts(a: BriefPerceivableFact, b: BriefPerceivableFact): number {
  const byRef = a.ref.id.localeCompare(b.ref.id);
  return byRef === 0 ? a.kind.localeCompare(b.kind) : byRef;
}

/** The scene's two lists, flattened into the one shape the brief carries. */
function sceneFacts(scene: SceneState): readonly BriefPerceivableFact[] {
  return [
    ...scene.present.map((presence): BriefPerceivableFact => ({
      kind: 'present',
      ref: presence.ref,
      name: presence.name,
      detail: presence.state,
      sinceSeq: presence.sinceSeq,
    })),
    ...scene.absent.map((absence): BriefPerceivableFact => ({
      kind: 'absent',
      ref: absence.ref,
      name: absence.name,
      detail: absence.cause,
      sinceSeq: absence.sinceSeq,
    })),
  ];
}

/**
 * WHAT ONE AUDIENCE PERCEIVES — ADR 0008 decision 3, and THE FUNCTION M1 WILL
 * CHANGE. Named and exported for exactly that reason: a filter written inline
 * inside `buildBrief` would have to be found again before it could be replaced.
 *
 * WHAT IT DOES IN M0, said plainly rather than left to be discovered:
 *
 *   - at `'table'` scope — the only scope `DEFAULT_SCOPE` produces, because the
 *     party stays grouped until M1 (ADR 0008 decision 1) — the filter is THE
 *     IDENTITY: every fact of the scene reaches every recipient. That is the
 *     whole M0 perimeter, and it is correct;
 *   - at any other scope, it returns NOTHING. M0 has no per-group rule to
 *     apply, and the failure this list exists to prevent is over-disclosure:
 *     handing a splinter group the whole scene would make perception
 *     decorative, which is the sentence ADR 0008 decision 3 is built on.
 *     Nothing in M0 reaches this branch; M1 replaces it with the real rule.
 *
 * Derived from `scene`, never stored: there is no second copy of the presence
 * facts to keep in step (02-mj-ia.md section 4.7).
 */
export function perceivableFactsFor(
  scene: SceneState | null,
  audience: BriefAudience,
): readonly BriefPerceivableFact[] {
  if (scene === null) return [];
  if (audience.scope !== 'table') return [];
  return [...sceneFacts(scene)].sort(compareFacts);
}

function buildBrief(
  state: CampaignState,
  turn: Turn,
  ctx: DecisionContext,
  fields: {
    readonly moveId: MoveId | null;
    readonly outcome: Outcome | null;
    readonly isPresage: boolean;
    readonly roll: BriefRollDetail | null;
    readonly playerInput: string;
  },
): NarrationBrief {
  const audience = briefAudience(DEFAULT_SCOPE, state.party.memberPlayerIds);
  return {
    correlationId: turn.correlationId,
    sceneId: state.scene?.sceneId ?? null,
    audience,
    perceivableFacts: perceivableFactsFor(state.scene, audience),
    actorCharacterId: ctx.actorId,
    moveId: fields.moveId,
    outcome: fields.outcome,
    isPresage: fields.isPresage,
    roll: fields.roll,
    appliedEffects: [...turn.appliedEffects],
    imposedPrice: turn.imposedPrice,
    presage: turn.presage,
    playerInput: fields.playerInput,
    eventSeqs: turn.events.map((event) => event.seq),
    fallbackTemplateId: fallbackTemplateId(fields.moveId, fields.outcome),
  };
}

// --------------------------------------------------------------------- moves

function decideMove(
  state: CampaignState,
  intent: MoveIntent,
  ctx: DecisionContext,
): Result<Decision, RuleViolation> {
  const actor = requireActor(state, ctx.actorId);
  if (isErr(actor)) return actor;

  const handler = MOVE_BY_INTENT[intent.type];
  const definition = ctx.content.moves[handler.id];
  if (definition === undefined) {
    return err({ code: 'unknown_move', details: { moveId: handler.id } });
  }

  const planned = handler.plan({
    state,
    character: actor.value,
    definition,
    intent,
  });
  if (isErr(planned)) return planned;
  const plan = planned.value;

  if (plan.roll.kind === 'action') {
    const unrollable = requireRollableActor(actor.value, plan.roll.attribute);
    if (unrollable !== null) return err(unrollable);
  }

  const turn = createTurn(state, ctx);
  const bonus = plan.roll.kind === 'action' ? wholeBonus(plan.roll.bonus) : 0;
  const adds: readonly RollAdd[] = bonus === 0 ? [] : [{ source: 'intent', value: bonus }];

  const declared = turn.emit(
    'move.declared',
    {
      moveId: handler.id,
      characterId: actor.value.id,
      narrativeInput: plan.narrativeInput,
      chosenAttribute: plan.roll.kind === 'action' ? plan.roll.attribute : undefined,
      declaredAdds: adds.length === 0 ? undefined : adds,
    },
    {
      actorKind: 'player',
      actorPlayerId: actor.value.playerId,
      subjectCharacterId: actor.value.id,
    },
  );

  applyEffects(state, turn, ctx, plan, plan.upfrontEffects, 0);

  const resolved = resolveRoll(turn, ctx, plan, actor.value.id, bonus, adds, definition);

  // THE TWO-STEP BURN, and the whole point of this task: when the roll opened a
  // window, the turn STOPS HERE. No outcome effect, no `move.resolved` — the
  // player has seen the dice and has not decided yet, and deciding for them by
  // applying the consequences now is what made burning cost a resource for
  // nothing (03-donnees.md section 3.4).
  if (resolved.detail !== null && resolved.burnWindow) {
    return ok({
      events: [...turn.events],
      brief: buildBrief(state, turn, ctx, {
        moveId: handler.id,
        outcome: resolved.outcome,
        isPresage: resolved.isPresage,
        roll: resolved.detail,
        playerInput: plan.narrativeInput,
      }),
      pending: {
        rollSeq: resolved.rollSeq,
        characterId: actor.value.id,
        intent,
        correlationId: turn.correlationId,
        declarationId: declared.id,
        plan,
        outcome: resolved.outcome,
        isPresage: resolved.isPresage,
        roll: resolved.detail,
      },
    });
  }

  applyEffects(state, turn, ctx, plan, definition.outcomes[resolved.outcome].effects, 0);
  applyResolution(turn, ctx, plan, resolved.outcome, resolved.rollSeq);

  turn.emit(
    'move.resolved',
    {
      moveId: handler.id,
      characterId: actor.value.id,
      rollSeq: resolved.rollSeq,
      outcome: resolved.outcome,
      effectsApplied: turn.appliedEffects.map((applied) => applied.effect),
    },
    { actorKind: 'engine', subjectCharacterId: actor.value.id },
  );

  return ok({
    events: [...turn.events],
    brief: buildBrief(state, turn, ctx, {
      moveId: handler.id,
      outcome: resolved.outcome,
      isPresage: resolved.isPresage,
      roll: resolved.detail,
      playerInput: plan.narrativeInput,
    }),
    pending: null,
  });
}

interface ResolvedRoll {
  readonly outcome: Outcome;
  readonly isPresage: boolean;
  readonly rollSeq: number;
  readonly detail: BriefRollDetail | null;
  /** `roll.action_resolved.burnWindow`, as written. Only an action roll opens one. */
  readonly burnWindow: boolean;
}

/**
 * The roll itself, and the events that record it.
 *
 * The presage rides here rather than in the effect executor because it is not
 * an effect: equal challenge dice impose a twist whatever the outcome, and the
 * `presages` table is reserved to the engine — `roll_oracle` cannot reach it
 * (ARCHITECTURE.md section 4.4).
 */
function resolveRoll(
  turn: Turn,
  ctx: DecisionContext,
  plan: MovePlan,
  characterId: CharacterId,
  bonus: number,
  adds: readonly RollAdd[],
  definition: MoveDefinition,
): ResolvedRoll {
  const actor = turn.character(characterId);
  switch (plan.roll.kind) {
    case 'none': {
      // No roll, so no roll sequence: `move.resolved.rollSeq` points at the
      // declaration instead, which is the entry this move really hangs from.
      const declaredSeq = turn.events[0]?.seq ?? 0;
      return {
        outcome: plan.roll.outcome,
        isPresage: false,
        rollSeq: declaredSeq,
        detail: null,
        burnWindow: false,
      };
    }
    case 'progress': {
      const track = turn.track(plan.roll.trackId);
      const drawIndex = turn.nextDrawIndex('action');
      const roll = rollProgress(boxesFilled(track?.ticks ?? 0), ctx.rng.stream('action'));
      const rollId = ctx.ids.next() as RollId;
      const event = turn.emit(
        'roll.progress_resolved',
        {
          rollId,
          trackId: plan.roll.trackId,
          ticks: track?.ticks ?? 0,
          filledBoxes: roll.filledBoxes,
          challengeDice: roll.challengeDice,
          outcome: roll.outcome,
          isPresage: roll.presage,
        },
        {
          actorKind: 'engine',
          subjectCharacterId: characterId,
          rngStream: 'action',
          rngDrawIndex: drawIndex,
        },
      );
      drawPresage(turn, ctx, characterId, roll.presage, event.seq);
      return {
        outcome: roll.outcome,
        isPresage: roll.presage,
        rollSeq: event.seq,
        detail: null,
        burnWindow: false,
      };
    }
    case 'action': {
      const attribute = plan.roll.attribute;
      const attributeValue = actor?.attributes[attribute] ?? ATTRIBUTE_MIN;
      const momentumBefore = actor?.momentum ?? 0;
      const drawIndex = turn.nextDrawIndex('action');
      const roll = rollChallenge(
        { attribute: attributeValue, bonus, momentum: momentumBefore, burnMomentum: false },
        ctx.rng.stream('action'),
      );
      const rollId = ctx.ids.next() as RollId;
      const burnWindow =
        definition.allowsMomentumBurn && canBurnMomentum(momentumBefore, roll.score);
      const event = turn.emit(
        'roll.action_resolved',
        {
          rollId,
          characterId,
          moveId: definition.id,
          attribute,
          attributeValue,
          actionDie: roll.actionDie,
          adds,
          rawTotal: roll.rawScore,
          total: roll.score,
          cappedAtTen: roll.rawScore > roll.score,
          challengeDice: roll.challengeDice,
          outcome: roll.outcome,
          isPresage: roll.presage,
          momentumBefore,
          momentumNegated: roll.momentumCancelled,
          burnWindow,
          rngStream: 'action',
          rngDrawIndex: drawIndex,
        },
        {
          actorKind: 'engine',
          subjectCharacterId: characterId,
          rngStream: 'action',
          rngDrawIndex: drawIndex,
        },
      );
      if (roll.momentumCancelled) {
        turn.emit(
          'character.momentum_negated',
          {
            characterId,
            actionDie: roll.actionDie,
            momentumValue: momentumBefore,
            rollSeq: event.seq,
          },
          { actorKind: 'engine', subjectCharacterId: characterId },
        );
      }
      drawPresage(turn, ctx, characterId, roll.presage, event.seq);
      return {
        outcome: roll.outcome,
        isPresage: roll.presage,
        rollSeq: event.seq,
        burnWindow,
        detail: {
          rollId,
          attribute,
          attributeValue,
          actionDie: roll.actionDie,
          adds,
          rawTotal: roll.rawScore,
          total: roll.score,
          cappedAtTen: roll.rawScore > roll.score,
          challengeDice: roll.challengeDice,
          momentumNegated: roll.momentumCancelled,
          burned: false,
        },
      };
    }
  }
}

function drawPresage(
  turn: Turn,
  ctx: DecisionContext,
  characterId: CharacterId,
  presage: boolean,
  rollSeq: number,
): void {
  if (!presage) return;
  const table = ctx.content.presageTable;
  if (table.id !== PRESAGE_TABLE_ID) return;
  const drawIndex = turn.nextDrawIndex('presage');
  const roll = rollPresage(table, ctx.rng.stream('presage'));
  turn.emit(
    'roll.presage_drawn',
    {
      rollId: ctx.ids.next() as RollId,
      tableId: table.id,
      value: roll.value,
      entryId: roll.entry.id,
      text: roll.entry.text,
      triggeredByRollSeq: rollSeq,
    },
    {
      actorKind: 'engine',
      subjectCharacterId: characterId,
      rngStream: 'presage',
      rngDrawIndex: drawIndex,
    },
  );
  turn.setPresage({
    tableId: table.id,
    value: roll.value,
    entryId: roll.entry.id,
    text: roll.entry.text,
  });
}

/**
 * How the move closes the track it acts on.
 *
 * `xpAwarded` and `xpLost` are read from the `xp` effects THIS TURN applied,
 * not from a ladder written here: the content says what a vow is worth, the
 * engine only reports what it handed out.
 */
function applyResolution(
  turn: Turn,
  ctx: DecisionContext,
  plan: MovePlan,
  outcome: Outcome,
  rollSeq: number,
): void {
  const resolution = plan.resolution[outcome];
  if (resolution === null || plan.trackId === null) return;
  switch (resolution.kind) {
    case 'resolved':
      turn.emit(
        'track.resolved',
        {
          trackId: plan.trackId,
          outcome: resolution.outcome,
          rollSeq,
          xpAwarded: turn.xpEarned,
        },
        { actorKind: 'engine', subjectCharacterId: ctx.actorId },
      );
      return;
    case 'forsaken':
      turn.emit(
        'track.forsaken',
        { trackId: plan.trackId, reason: plan.narrativeInput, xpLost: turn.xpLost },
        { actorKind: 'engine', subjectCharacterId: ctx.actorId },
      );
  }
}

// ---------------------------------------------------------- the other intents

/**
 * CLOSING THE WINDOW — the second step of the burn, in the only three ways it
 * happens (ARCHITECTURE.md section 4.4, 03-donnees.md section 3.4):
 *
 *   a. `momentum.burn` — `character.momentum_burned`, THEN `roll.action_revised`,
 *      THEN the effects of the REVISED outcome, THEN `move.resolved`;
 *   b. `momentum.keep` — the effects of the INITIAL outcome, then `move.resolved`;
 *   c. the safety net: the caller sees an entry about the same character
 *      (`burnWindowClosedBy`) and closes the window as (b).
 *
 * THE POINT, in one sentence: the burn REWRITES THE OUTCOME, and the effects
 * that are applied are those of the revised outcome, never those of the first
 * one. A failure can become a clean success, and then the failure's price is
 * never paid — that is what burning buys, and before this it bought nothing.
 *
 * THE FIRST ROLL IS NEVER REWRITTEN. The journal is append-only: the revision
 * is ADDED (`roll.action_revised.revisedFromSeq` points back at it), and the
 * first `roll.action_resolved` stays exactly as the players read it.
 *
 * NOT A DIE IS DRAWN HERE. The revised score is the momentum that was spent,
 * read against the challenge dice ALREADY WRITTEN on the first roll. Drawing
 * anything on the `action` stream would shift every index after it and rewrite
 * dice that are already in the journal.
 *
 * IT IS THE SAME TURN, NOT A SECOND ONE. The correlation group and the
 * declaration come from the window, so the closing entries land in the group
 * the dice are in: `system.reverted` cancels the whole thing at once
 * (03-donnees.md section 3.7) and `buildTurnProof` reads the dice and their
 * consequences in one pass (section 0.5).
 *
 * AND IT CANNOT BE REFUSED FOR A REASON ABOUT THE MOVE. The plan comes from
 * the window too: feasibility was settled before the dice, and replaying it
 * here against a state that has moved on would strand an open window nothing
 * could ever close. What remains state-dependent is the actor
 * (`requireActor`) — and an entry about that character is exactly what
 * `burnWindowClosedBy` makes the caller close the window on first.
 */
function closeBurnWindow(
  state: CampaignState,
  ctx: DecisionContext,
  window: BurnWindow,
  burn: boolean,
): Result<Decision, RuleViolation> {
  const actor = requireActor(state, ctx.actorId);
  if (isErr(actor)) return actor;

  const handler = MOVE_BY_INTENT[window.intent.type];
  const definition = ctx.content.moves[handler.id];
  if (definition === undefined) {
    return err({ code: 'unknown_move', details: { moveId: handler.id } });
  }
  const plan = window.plan;

  const turn = createTurn(state, ctx, {
    correlationId: window.correlationId,
    declarationId: window.declarationId,
  });
  let outcome = window.outcome;
  let roll = window.roll;

  if (burn) {
    const spent = actor.value.momentum;
    const resetTo = resetMomentum(actor.value.momentumBounds);
    turn.emit(
      'character.momentum_burned',
      { characterId: actor.value.id, spent, resetTo, appliedToRollSeq: window.rollSeq },
      { actorKind: 'engine', subjectCharacterId: actor.value.id },
    );
    // The burn is spent BEFORE the outcome effects run, so a `{ op: 'momentum' }`
    // reward on the revised outcome starts from the reset value and not from
    // the elan the character no longer has.
    turn.putCharacter({ ...actor.value, momentum: resetTo });
    outcome = outcomeFor(spent, window.roll.challengeDice);
    turn.emit(
      'roll.action_revised',
      {
        rollId: window.roll.rollId,
        revisedFromSeq: window.rollSeq,
        total: spent,
        outcome,
        isPresage: window.isPresage,
      },
      { actorKind: 'engine', subjectCharacterId: actor.value.id },
    );
    // `rawTotal` equals `total`: a burned score is the momentum itself, and
    // momentum is bounded at 10, so there is nothing to cap and nothing the
    // cap swallowed.
    roll = { ...window.roll, rawTotal: spent, total: spent, cappedAtTen: false, burned: true };
  }

  applyEffects(state, turn, ctx, plan, definition.outcomes[outcome].effects, 0);
  applyResolution(turn, ctx, plan, outcome, window.rollSeq);

  turn.emit(
    'move.resolved',
    {
      moveId: handler.id,
      characterId: actor.value.id,
      // The ROLL, not the revision: `roll.action_revised` links itself to it
      // through `revisedFromSeq`, and a proof that pointed at the revision
      // would lose the dice.
      rollSeq: window.rollSeq,
      outcome,
      effectsApplied: turn.appliedEffects.map((applied) => applied.effect),
    },
    { actorKind: 'engine', subjectCharacterId: actor.value.id },
  );

  return ok({
    events: [...turn.events],
    brief: buildBrief(state, turn, ctx, {
      moveId: handler.id,
      outcome,
      isPresage: window.isPresage,
      roll,
      playerInput: plan.narrativeInput,
    }),
    pending: null,
  });
}

/** The window this intent aims at, or the reason there is none to aim at. */
function requireBurnWindow(
  rollId: RollId,
  ctx: DecisionContext,
): Result<BurnWindow, RuleViolation> {
  const window = ctx.burnWindow ?? null;
  if (window?.roll.rollId !== rollId || window.characterId !== ctx.actorId) {
    return err({ code: 'no_burn_window', details: { rollId } });
  }
  return ok(window);
}

function decideBurn(
  state: CampaignState,
  intent: Extract<Intent, { readonly type: 'momentum.burn' }>,
  ctx: DecisionContext,
): Result<Decision, RuleViolation> {
  const window = requireBurnWindow(intent.rollId, ctx);
  if (isErr(window)) return window;
  const actor = requireActor(state, ctx.actorId);
  if (isErr(actor)) return actor;
  if (!canBurnMomentum(actor.value.momentum, window.value.roll.total)) {
    return err({
      code: 'momentum_too_low',
      details: { momentum: actor.value.momentum, total: window.value.roll.total },
    });
  }
  return closeBurnWindow(state, ctx, window.value, true);
}

/**
 * Saying NO, which is a decision and not an absence of one.
 *
 * It takes the same `rollId` as the burn so that a stale click — the window
 * already closed by the safety net, another roll since — is refused rather
 * than applied to whatever is open now.
 */
function decideKeep(
  state: CampaignState,
  intent: Extract<Intent, { readonly type: 'momentum.keep' }>,
  ctx: DecisionContext,
): Result<Decision, RuleViolation> {
  const window = requireBurnWindow(intent.rollId, ctx);
  if (isErr(window)) return window;
  return closeBurnWindow(state, ctx, window.value, false);
}

function decideOracleAsk(
  state: CampaignState,
  intent: Extract<Intent, { readonly type: 'oracle.ask' }>,
  ctx: DecisionContext,
): Result<Decision, RuleViolation> {
  const actor = requireActor(state, ctx.actorId);
  if (isErr(actor)) return actor;

  const turn = createTurn(state, ctx);
  const threshold = LIKELIHOOD_THRESHOLDS[intent.likelihood];
  const drawIndex = turn.nextDrawIndex('oracle');
  const value = ctx.rng.stream('oracle').roll(100);
  turn.emit(
    'roll.yes_no_resolved',
    {
      rollId: ctx.ids.next() as RollId,
      question: intent.question,
      likelihood: intent.likelihood,
      threshold,
      value,
      answer: value <= threshold ? 'oui' : 'non',
      isExtreme: isExtremeAnswer(value, threshold),
    },
    {
      actorKind: 'engine',
      subjectCharacterId: actor.value.id,
      rngStream: 'oracle',
      rngDrawIndex: drawIndex,
    },
  );
  return ok({
    events: [...turn.events],
    brief: buildBrief(state, turn, ctx, {
      moveId: null,
      outcome: null,
      isPresage: false,
      roll: null,
      playerInput: intent.question,
    }),
    pending: null,
  });
}

function decideOracleDraw(
  state: CampaignState,
  intent: Extract<Intent, { readonly type: 'oracle.draw' }>,
  ctx: DecisionContext,
): Result<Decision, RuleViolation> {
  const actor = requireActor(state, ctx.actorId);
  if (isErr(actor)) return actor;
  const table = ctx.content.oracles[intent.oracleId];
  if (table === undefined) {
    return err({ code: 'unknown_oracle_table', details: { oracleId: intent.oracleId } });
  }
  // Reserved to the engine: a presage is a consequence the rules impose, never
  // a table anyone may consult (ARCHITECTURE.md section 4.4).
  if (table.id === PRESAGE_TABLE_ID || table.id === PRICE_TABLE_ID) {
    return err({ code: 'unknown_oracle_table', details: { oracleId: intent.oracleId } });
  }

  const turn = createTurn(state, ctx);
  applyOracle(turn, ctx, intent.oracleId);
  return ok({
    events: [...turn.events],
    brief: buildBrief(state, turn, ctx, {
      moveId: null,
      outcome: null,
      isPresage: false,
      roll: null,
      playerInput: '',
    }),
    pending: null,
  });
}

function decideSpeech(
  state: CampaignState,
  intent: Extract<Intent, { readonly type: 'speech.say' }>,
  ctx: DecisionContext,
): Result<Decision, RuleViolation> {
  const actor = requireActor(state, ctx.actorId);
  if (isErr(actor)) return actor;
  const turn = createTurn(state, ctx);
  turn.emit(
    'narration.player_message',
    { text: intent.text, kind: intent.channel, characterId: actor.value.id },
    {
      actorKind: 'player',
      actorPlayerId: actor.value.playerId,
      subjectCharacterId: actor.value.id,
    },
  );
  return ok({
    events: [...turn.events],
    brief: buildBrief(state, turn, ctx, {
      moveId: null,
      outcome: null,
      isPresage: false,
      roll: null,
      playerInput: intent.text,
    }),
    pending: null,
  });
}

function decideJoin(
  state: CampaignState,
  intent: Extract<Intent, { readonly type: 'campaign.join' }>,
  ctx: DecisionContext,
): Result<Decision, RuleViolation> {
  const character = state.characters[intent.characterId];
  if (character === undefined) {
    return err({ code: 'unknown_character', details: { characterId: intent.characterId } });
  }
  const turn = createTurn(state, ctx);
  if (!state.party.memberPlayerIds.includes(character.playerId)) {
    turn.emit(
      'party.member_joined',
      { playerId: character.playerId, role: 'player', displayName: character.displayName },
      { actorKind: 'system' },
    );
  }
  return ok({
    events: [...turn.events],
    brief: buildBrief(state, turn, ctx, {
      moveId: null,
      outcome: null,
      isPresage: false,
      roll: null,
      playerInput: '',
    }),
    pending: null,
  });
}

function decideLeave(state: CampaignState, ctx: DecisionContext): Result<Decision, RuleViolation> {
  const character = state.characters[ctx.actorId];
  if (character === undefined) {
    return err({ code: 'unknown_character', details: { characterId: ctx.actorId } });
  }
  if (!state.party.memberPlayerIds.includes(character.playerId)) {
    return err({ code: 'not_a_member', details: { playerId: character.playerId } });
  }
  const turn = createTurn(state, ctx);
  turn.emit(
    'party.member_left',
    { playerId: character.playerId, reason: 'left' },
    { actorKind: 'system' },
  );
  return ok({
    events: [...turn.events],
    brief: buildBrief(state, turn, ctx, {
      moveId: null,
      outcome: null,
      isPresage: false,
      roll: null,
      playerInput: '',
    }),
    pending: null,
  });
}

/**
 * The only legal spread at creation, and the champion lock.
 *
 * NO EVENT COMES OUT OF THIS. The sheet does not exist yet: a handwritten one
 * is uploaded and a forged one is generated out of band, and it is
 * `character.created` — written by the server once the sheet is in hand — that
 * sets the lock (ARCHITECTURE.md section 4.4, "Creation de personnage"). What
 * the engine owns here is the refusal, and it owns it BEFORE a forge call is
 * paid for. Reported with the task: M0-24 writes the event.
 */
function decideCreateDraft(
  state: CampaignState,
  intent: Extract<Intent, { readonly type: 'character.create_draft' }>,
  ctx: DecisionContext,
): Result<Decision, RuleViolation> {
  const spread = Object.values(intent.spread).sort((a, b) => b - a);
  if (spread.join(',') !== '3,2,2,1,1') {
    return err({ code: 'attribute_spread_illegal', details: { spread: spread.join(',') } });
  }
  const lock = state.championLocks[intent.championSlug];
  if (lock !== undefined && lock.lockKind !== 'allowed_npc') {
    return err({
      code: 'champion_locked',
      details: { championId: intent.championSlug, lockKind: lock.lockKind },
    });
  }
  const turn = createTurn(state, ctx);
  return ok({
    events: [],
    brief: buildBrief(state, turn, ctx, {
      moveId: null,
      outcome: null,
      isPresage: false,
      roll: null,
      playerInput: intent.background,
    }),
    pending: null,
  });
}

/**
 * Play sessions produce no engine event, and that is a finding, not an
 * omission.
 *
 * `session.opened` carries an `ordinal` and the list of players present;
 * `CampaignState` holds neither, so the engine cannot fill them without
 * inventing a number. Those two entries are written by the server, which knows
 * both. Reported with the task.
 */
function decideSessionBoundary(
  state: CampaignState,
  ctx: DecisionContext,
): Result<Decision, RuleViolation> {
  const turn = createTurn(state, ctx);
  return ok({
    events: [],
    brief: buildBrief(state, turn, ctx, {
      moveId: null,
      outcome: null,
      isPresage: false,
      roll: null,
      playerInput: '',
    }),
    pending: null,
  });
}

// ------------------------------------------------------------------- the door

/**
 * Settle one intent.
 *
 * The switch has TWENTY-ONE branches and no `default`: adding an intent without
 * deciding what it does breaks the lint
 * (`@typescript-eslint/switch-exhaustiveness-check`, which does not take a
 * default as coverage) instead of falling through to a silent refusal.
 */
export function decide(
  state: CampaignState,
  intent: Intent,
  ctx: DecisionContext,
): Result<Decision, RuleViolation> {
  const inactive = requireActiveCampaign(state);
  if (inactive !== null) return err(inactive);

  switch (intent.type) {
    case 'campaign.join':
      return decideJoin(state, intent, ctx);
    case 'campaign.leave':
      return decideLeave(state, ctx);
    case 'character.create_draft':
      return decideCreateDraft(state, intent, ctx);
    case 'move.face_danger':
    case 'move.secure_advantage':
    case 'move.gather_information':
    case 'move.probe_a_soul':
    case 'move.strike':
    case 'move.endure_harm':
    case 'move.endure_cold':
    case 'move.swear_a_vow':
    case 'move.reach_a_milestone':
    case 'move.fulfill_your_vow':
    case 'move.forsake_your_vow':
      return decideMove(state, intent, ctx);
    case 'momentum.burn':
      return decideBurn(state, intent, ctx);
    case 'momentum.keep':
      return decideKeep(state, intent, ctx);
    case 'oracle.ask':
      return decideOracleAsk(state, intent, ctx);
    case 'oracle.draw':
      return decideOracleDraw(state, intent, ctx);
    case 'speech.say':
      return decideSpeech(state, intent, ctx);
    case 'play_session.begin':
    case 'play_session.end':
      return decideSessionBoundary(state, ctx);
  }
}
