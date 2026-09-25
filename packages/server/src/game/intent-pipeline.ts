/**
 * THE ONE WRITE PATH (ARCHITECTURE.md section 6), step by step, and the place
 * where the four invariants meet.
 *
 * validate → authorise → decide (the dice are drawn HERE) → one short
 * transaction with NO network call in it → broadcast → and only then, out of
 * band and out of transaction, ask the storyteller to dress a fact that is
 * already acquired and already durable.
 *
 * ── WHAT EACH INVARIANT LOOKS LIKE IN THIS FILE ──────────────────────────
 *  1. THE ENGINE DECIDES. Every entry written below comes out of `decide()`,
 *     and every one of them goes through `assertNotAiAuthored` before it is
 *     appended. That function was exported and tested in M0-02 and CALLED BY
 *     NOBODY until this line: `reduce()` applied a `character.gauge_changed`
 *     signed `gm_ai` without a murmur, and the invariant was held by
 *     discipline. It is held by code here, and `tests/game/pipeline.test.ts`
 *     proves it by trying to push such an entry through.
 *  2. THE MEMORY IS IN THE BASE. Nothing about a campaign lives in this
 *     process between two intents — not the state, not the burn window. Both
 *     are read back from the journal at the top of every call.
 *  3. THE SERVER IS THE AUTHORITY. The input is an `Intent` and nothing else;
 *     it is re-parsed with `zIntent` even though the socket already parsed it,
 *     because "the client validated it" is not a guarantee, it is a hope.
 *  4. EVERYTHING REPLAYS. The entries are the only record. The projections are
 *     rewritten from them through `@for/db`'s own writer, in the same
 *     transaction, so the live path and `db:rebuild` cannot disagree.
 *
 * ── THE TWO-STEP BURN, AND WHAT THE SERVER OWES IT ───────────────────────
 * M0-34 made `decide()` stop applying a move's consequences while the player
 * can still burn their momentum: it returns `Decision.pending`, and while that
 * is non-null THE TURN IS NOT OVER. Three obligations follow, all here:
 *
 *   - the window is persisted. It is not written anywhere: `burn-window.ts`
 *     DERIVES it from the journal, which is why a cancellation brings it back
 *     with the rest and a restart does not lose it;
 *   - the storyteller is NOT called. Narrating an outcome the player is about
 *     to revise is telling the turn twice;
 *   - the closing intent gets the window back in `ctx.burnWindow`, and the
 *     entries it produces are stamped with the ROLL'S `correlation_id`, so one
 *     turn stays one group for « Pourquoi ? » and for `revertTurn`.
 *
 * And two refusals that are NOT the same refusal, which is the part worth
 * reading twice:
 *
 *   - the ACTOR asks for a new move while their own roll is undecided:
 *     `move_in_progress` (01-architecture.md section 3.3 — "ne se declenche
 *     que si l'acteur a un jet en attente de decision"). It is not a turn
 *     lock: the table stays free, and the code `not_your_turn` does not exist
 *     anywhere in this repository;
 *   - anything else that would write about that character — another player's
 *     strike, tomorrow a proposal — closes the window first, as
 *     `momentum.keep`, and then proceeds. That is the safety net of
 *     03-donnees.md section 3.4, and a player who closes their tab must never
 *     block the table. Whether an entry closes the window is asked of
 *     `burnWindowClosedBy`, the predicate `@for/engine` exports for exactly
 *     this, never of a copy of the rule written at this call site.
 */

import { zIntent } from '@for/contracts';
import {
  appendEvents,
  assertAcceptsIntents,
  getCampaign,
  listMemberPlayerIds,
  settleIntentOnce,
  writeProjectionsFrom,
} from '@for/db';
import {
  assertNotAiAuthored,
  burnWindowClosedBy,
  decide,
  fallbackNarration,
  isErr,
} from '@for/engine';

import { findOpenBurnWindow, isBurnClosingIntent, isMoveIntent } from './burn-window.js';
import { readJournalSince, toGameEvent } from './journal.js';
import { loadReplay, snapshotDue, writeSnapshot } from './snapshots.js';

import type { NarratorPort } from '@for/contracts';
import type { AppendableEvent, SqliteConnection } from '@for/db';
import type {
  BurnWindow,
  CampaignState,
  CharacterId,
  DecisionContext,
  EngineContent,
  FallbackTemplates,
  GameEvent,
  IdFactory,
  Intent,
  NarrationBrief,
  PlayerId,
  RuleViolation,
  RuleViolationCode,
} from '@for/engine';
import type { RngSource, TimeSource } from '../deps.js';

export interface GameDeps {
  readonly connection: SqliteConnection;
  readonly content: EngineContent;
  /** `content/fallbacks/narration.json`, for the turn the storyteller misses. */
  readonly fallbacks: FallbackTemplates;
  readonly clock: TimeSource;
  readonly rng: RngSource;
  readonly ids: IdFactory;
  readonly narrator: NarratorPort;
}

export interface PipelineInput {
  readonly campaignId: string;
  readonly playerId: PlayerId;
  /** The client's idempotence key. Replaying it must not reroll. */
  readonly intentId: string;
  readonly intent: Intent;
}

export type PipelineFailure =
  | { readonly kind: 'campaign_not_found' }
  | { readonly kind: 'forbidden_campaign' }
  | { readonly kind: 'campaign_rebuilding' }
  | { readonly kind: 'validation_failed'; readonly detail: string };

export interface PipelineAccepted {
  readonly kind: 'accepted';
  /** As the journal holds them, with the sequences the database allocated. */
  readonly events: readonly GameEvent[];
  /**
   * Absent on a REPLAY: the brief is what `decide()` produced, and a replay
   * does not call it. Absent is the honest answer — a rebuilt brief would be a
   * second version of a fact, and the first one was already narrated.
   */
  readonly brief?: NarrationBrief;
  /** Non-null while the roll waits for a burn decision. The turn is NOT over. */
  readonly pending: BurnWindow | null;
  /** `true` when this identifier had already been settled: no die was drawn. */
  readonly replayed: boolean;
}

export interface PipelineRejected {
  readonly kind: 'rejected';
  readonly violation: RuleViolation;
}

export type PipelineOutcome = PipelineAccepted | PipelineRejected | PipelineFailure;

// ------------------------------------------------------------------ context

/**
 * The generator for ONE decision: one stream per name, all derived from
 * `(seed, turnSeq, stream)` with `turnSeq = state.seq + 1` — the sequence the
 * first entry of this turn will take (03-donnees.md section 3.6).
 *
 * Stateless, so nothing has to be replayed to reproduce a draw, and two runs
 * of the same journal give the same dice.
 */
function decisionContext(
  deps: GameDeps,
  state: CampaignState,
  actorId: CharacterId,
  window: BurnWindow | null,
): DecisionContext {
  return {
    rng: { stream: (stream) => deps.rng.forCampaign(state.rng.seed, state.seq + 1, stream) },
    ids: deps.ids,
    now: deps.clock.now(),
    actorId,
    content: deps.content,
    burnWindow: window,
  };
}

/**
 * Which character is acting.
 *
 * `campaign.join` names the character it attaches to; every other intent comes
 * from the player's own character at this table. A player with no character
 * is refused `character_not_in_campaign` — INCLUDING for
 * `character.create_draft`, which is a hole rather than a rule: `decide()`
 * produces no entry for that intent (the forge is M0-29), so in M0 a character
 * is created by the seed and not by a player. Reported with the task.
 */
function resolveActor(
  state: CampaignState,
  playerId: PlayerId,
  intent: Intent,
): CharacterId | null {
  if (intent.type === 'campaign.join') return intent.characterId;
  const owned = Object.values(state.characters)
    .filter((character) => character.playerId === playerId)
    .sort((a, b) => a.id.localeCompare(b.id));
  return owned.find((character) => character.status === 'active')?.id ?? owned[0]?.id ?? null;
}

// ------------------------------------------------------------- the journal

/** The campaign's entries, as engine values. */
function journalOf(deps: GameDeps, campaignId: string): readonly GameEvent[] {
  return readJournalSince(deps.connection, campaignId, 0);
}

/**
 * The move that produced the roll at `rollSeq`, read from the `intents` table.
 *
 * `move.declared` does not carry it: a `strike` would lose its target and a
 * `swear_a_vow` its rank. The intent row does, and it is linked to the entries
 * it produced by `first_event_seq .. last_event_seq` (03-donnees.md section
 * 1.6).
 */
function intentForSeq(connection: SqliteConnection, campaignId: string, rollSeq: number) {
  return (): Intent | null => {
    const row = connection
      .prepare(
        `SELECT payload_json FROM intents
          WHERE campaign_id = ? AND first_event_seq <= ? AND last_event_seq >= ?
          ORDER BY first_event_seq DESC LIMIT 1`,
      )
      .get(campaignId, rollSeq, rollSeq) as { payload_json: string } | undefined;
    if (row === undefined) return null;
    const parsed = zIntent.safeParse(JSON.parse(row.payload_json));
    return parsed.success ? parsed.data : null;
  };
}

/** The `correlation_id` of the turn the open roll belongs to. */
function correlationOf(events: readonly GameEvent[], seq: number): string | null {
  return events.find((event) => event.seq === seq)?.correlationId ?? null;
}

// ------------------------------------------------------------- persistence

/**
 * A decided entry, in the shape the journal takes.
 *
 * `scope` and `recipients` are COPIED from what the engine wrote, and that is
 * not a contradiction of ADR 0008 ("c'est le serveur seul qui renseigne ces
 * deux champs"): the engine writes the only pair consistent for a party that
 * stays together, `('table', null)`, and M1 brings the rule that splits it.
 * The server keeps the pen; it has nothing else to write yet.
 *
 * ── `correlationId` IS ALWAYS THE SERVER'S, AND IT HAS TO BE ─────────────
 * 01-architecture.md section 5.4 and `zCorrelationId` agree: the group of a
 * turn is a UUID, "minte par le CLIENT pour l'idempotence et par le SERVEUR
 * pour les tours nes du moteur". `decide()` mints one per call from
 * `ctx.ids`, which is the ULID factory — a value `zGameEvent.parse` REFUSES,
 * measured rather than deduced. So the engine's value is a placeholder and
 * the server replaces it, with:
 *
 *   - the intent's own identifier, which is the idempotence key the client
 *     already minted as a UUID. One turn, one key, one group, and
 *     « Pourquoi ? » is addressable without inventing anything;
 *   - or, when this call FINISHES a turn an earlier one opened, the group of
 *     that earlier turn — so a two-step burn stays ONE turn for the proof and
 *     for `revertTurn`.
 *
 * Reported as an engine/contract divergence rather than worked around in
 * silence: `decide()` should take the group rather than mint one.
 */
export function toAppendable(event: GameEvent, correlationId: string): AppendableEvent {
  // Invariant 1, mechanically, on the way into the journal. See the header.
  assertNotAiAuthored(event);
  return {
    id: event.id,
    type: event.type,
    payload: event.payload,
    payloadVersion: event.payloadVersion,
    actorKind: event.actorKind,
    actorPlayerId: event.actorPlayerId,
    subjectCharacterId: event.subjectCharacterId,
    correlationId,
    causationId: event.causationId,
    rngStream: event.rngStream,
    rngDrawIndex: event.rngDrawIndex,
    scope: event.scope,
    recipients: event.recipients,
    createdAt: event.createdAt,
    playSessionId: event.playSessionId,
  };
}

/**
 * Zone C and the snapshot policy, INSIDE the caller's transaction.
 *
 * The projections go through `@for/db`'s `writeProjectionsFrom` — the same
 * `deleteProjections` + `writeProjections` pair `rebuildCampaign` runs. Risk 6
 * of ARCHITECTURE.md section 9 is a projection written by a second hand and
 * diverging from the rebuild in silence; there is no second hand here.
 */
function persistProjections(deps: GameDeps, campaignId: string): CampaignState {
  const replay = loadReplay(deps.connection, campaignId);
  writeProjectionsFrom(deps.connection, campaignId, replay);
  return replay.state;
}

function maybeSnapshot(
  deps: GameDeps,
  campaignId: string,
  state: CampaignState,
  written: readonly GameEvent[],
): void {
  const due = snapshotDue(state, written);
  if (due === null) return;
  writeSnapshot(deps.connection, {
    campaignId,
    state,
    due,
    id: deps.ids.next(),
    now: deps.clock.now(),
  });
}

/**
 * Entries the SERVER decided to write on its own — the safety net's
 * `momentum.keep`. No `intents` row: nobody asked for it, and an idempotence
 * key for something no client sent would be a key nothing could ever replay.
 */
function appendServerTurn(
  deps: GameDeps,
  campaignId: string,
  events: readonly GameEvent[],
  correlationId: string,
): readonly GameEvent[] {
  const now = deps.clock.now();
  const run = deps.connection.transaction((): readonly GameEvent[] => {
    appendEvents(deps.connection, {
      campaignId,
      events: events.map((event) => toAppendable(event, correlationId)),
      now,
    });
    const state = persistProjections(deps, campaignId);
    maybeSnapshot(deps, campaignId, state, events);
    return events;
  });
  return run.immediate();
}

// -------------------------------------------------------------- the window

interface OpenWindow {
  readonly window: BurnWindow;
  /** The group of the turn that opened it, so the closing entries join it. */
  readonly correlationId: string | null;
}

function openWindow(
  deps: GameDeps,
  campaignId: string,
  journal: readonly GameEvent[],
): OpenWindow | null {
  const window = findOpenBurnWindow(journal, (rollSeq) =>
    intentForSeq(deps.connection, campaignId, rollSeq)(),
  );
  if (window === null) return null;
  return { window, correlationId: correlationOf(journal, window.rollSeq) };
}

/**
 * Closes the window as `momentum.keep`, on the server's own initiative.
 *
 * It goes through `decide()` like everything else — the net decides WHEN, the
 * engine decides WHAT. A server that applied the initial outcome itself would
 * be a second place that writes game entries, which is the one thing
 * invariant 1 forbids.
 */
function closeWindowAsKeep(
  deps: GameDeps,
  campaignId: string,
  state: CampaignState,
  open: OpenWindow,
): RuleViolation | null {
  if (open.correlationId === null) {
    // A roll whose entries carry no group: nothing written by this pipeline
    // looks like that, so it is a journal that came from somewhere else. The
    // window is left open rather than closed into a group of its own, which
    // would split one turn in two for the proof.
    return { code: 'no_burn_window', details: { rollSeq: open.window.rollSeq } };
  }
  const ctx = decisionContext(deps, state, open.window.characterId, open.window);
  const decision = decide(state, { type: 'momentum.keep', rollId: open.window.roll.rollId }, ctx);
  if (isErr(decision)) return decision.error;
  appendServerTurn(deps, campaignId, decision.value.events, open.correlationId);
  return null;
}

// ------------------------------------------------------------ the narration

/**
 * Step 6 of ARCHITECTURE.md section 6: OUT of band, OUT of transaction, with
 * the fact already decided, already written and already broadcast.
 *
 * WHAT THIS IS NOT. It is not the prompt. 02-mj-ia.md builds the storyteller's
 * context in `@for/ai` (M0-22) and streams it to the table in `src/ai/`
 * (M0-29); what travels below is the brief as JSON in one block, which is the
 * least this file can send and still have a chain to measure. Replacing it
 * does not reopen this function: the port is injected.
 *
 * AN OUTAGE NEVER LOSES A GAME. Any failure of the port becomes
 * `narration.gm_failed` plus the engine's deterministic fallback, written as
 * `narration.gm_message { source: 'engine' }`. The game state was already
 * correct and durable before this function ran.
 */
async function narrate(
  deps: GameDeps,
  campaignId: string,
  state: CampaignState,
  brief: NarrationBrief,
  correlationId: string,
): Promise<void> {
  const requestId = deps.ids.next();
  let text = '';
  let failure: string | null = null;
  // The RAW identifier an adapter hands back, copied and never interpreted.
  // Before the first `end` there is nothing to copy, so the port's own name
  // stands in — a model column that said "unknown" would be worse.
  let providerModel: string = deps.narrator.providerId;

  try {
    for await (const chunk of deps.narrator.narrer({
      purpose: 'narration',
      requestId,
      system: [{ type: 'text', text: NARRATION_SYSTEM, cacheHint: 'stable' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(brief) }] }],
      tools: [],
      toolPolicy: 'none',
      maxOutputTokens: NARRATION_MAX_OUTPUT_TOKENS,
      effort: 'low',
    })) {
      if (chunk.type === 'delta') text += chunk.text;
      if (chunk.type === 'end') providerModel = chunk.result.providerModel;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const spoken = failure === null && text.length > 0;
  const now = deps.clock.now();
  const events: AppendableEvent[] = [];

  // `gm_failed` ONLY on a real failure. An empty answer from the `stub` port
  // is not a failure — it is a port that opens no socket, and the engine's
  // sentence below is what it was always going to produce. Writing
  // `gm_failed` there would put an incident in the journal every turn of every
  // test run, and a journal that cries wolf is a journal nobody reads.
  if (failure !== null) {
    events.push({
      id: deps.ids.next(),
      type: 'narration.gm_failed',
      payload: {
        aiCallId: requestId,
        errorKind: 'api_error',
        fallbackText: fallbackText(deps, state, brief),
      },
      actorKind: 'system',
      scope: 'table',
      recipients: null,
      correlationId,
      createdAt: now,
    });
  }

  events.push({
    id: deps.ids.next(),
    type: 'narration.gm_message',
    payload: {
      text: spoken ? text : fallbackText(deps, state, brief),
      aiCallId: requestId,
      model: providerModel,
      promptVersion: NARRATION_PROMPT_VERSION,
      // The player can always find out that the engine spoke and not the
      // storyteller. It is never pushed at them, and it is never hidden.
      source: spoken ? 'ai' : 'engine',
      citedEventSeqs: brief.eventSeqs,
    },
    actorKind: spoken ? 'gm_ai' : 'engine',
    scope: 'table',
    recipients: null,
    correlationId,
    createdAt: now,
  });

  appendEvents(deps.connection, { campaignId, events, now });
}

/** The engine's sentence, picked on the `fallback` stream so it replays. */
function fallbackText(deps: GameDeps, state: CampaignState, brief: NarrationBrief): string {
  return fallbackNarration(
    brief,
    state,
    deps.fallbacks,
    deps.rng.forCampaign(state.rng.seed, state.seq + 1, 'fallback'),
  );
}

/**
 * The system block, and the whole of it.
 *
 * NOT THE PROMPT OF 02-mj-ia.md section 2, which weighs some 2200 tokens and
 * lives in `@for/ai` behind `prompt-size.test.ts`. This is a placeholder with
 * one job: make the call real so the "after the commit" rule can be measured.
 */
const NARRATION_SYSTEM =
  "Tu es le conteur d'une table de jeu de rôle au Freljord. Le fait est déjà " +
  'acquis : habille-le, ne le renégocie pas.';

const NARRATION_PROMPT_VERSION = 'conteur/0.0.0-placeholder';

const NARRATION_MAX_OUTPUT_TOKENS = 512;

// ----------------------------------------------------------------- the path

/**
 * One intent, from the socket to the journal.
 *
 * Runs inside the campaign's write queue: see `write-queue.ts` for why nothing
 * may decide against a state another intent is about to move.
 */
export async function runIntent(deps: GameDeps, input: PipelineInput): Promise<PipelineOutcome> {
  const { campaignId, playerId, intentId } = input;

  try {
    assertAcceptsIntents(campaignId);
  } catch {
    return { kind: 'campaign_rebuilding' };
  }

  if (getCampaign(deps.connection, campaignId) === undefined) {
    return { kind: 'campaign_not_found' };
  }
  if (!listMemberPlayerIds(deps.connection, campaignId).includes(playerId)) {
    return { kind: 'forbidden_campaign' };
  }

  // Invariant 3. The socket already parsed the frame; this parses the INTENT,
  // which is a different claim, and it is the authority's own copy of it.
  const parsed = zIntent.safeParse(input.intent);
  if (!parsed.success) {
    return { kind: 'validation_failed', detail: parsed.error.issues[0]?.message ?? 'intention' };
  }
  const intent = parsed.data;

  let journal = journalOf(deps, campaignId);
  let state = loadReplay(deps.connection, campaignId).state;
  const actorId = resolveActor(state, playerId, intent);
  if (actorId === null) {
    return {
      kind: 'rejected',
      violation: { code: 'character_not_in_campaign', details: { playerId } },
    };
  }

  let open = openWindow(deps, campaignId, journal);

  if (open !== null && !isBurnClosingIntent(intent)) {
    const sameCharacter = open.window.characterId === actorId;
    if (sameCharacter && isMoveIntent(intent)) {
      // The actor's own roll is still undecided. NOT a turn lock: the rest of
      // the table is free, and this player has exactly one thing to do first.
      return {
        kind: 'rejected',
        violation: {
          code: 'move_in_progress',
          details: { rollId: open.window.roll.rollId, rollSeq: open.window.rollSeq },
        },
      };
    }
    if (sameCharacter || wouldClose(deps, state, actorId, intent, open.window)) {
      const failed = closeWindowAsKeep(deps, campaignId, state, open);
      if (failed !== null) return { kind: 'rejected', violation: failed };
      journal = journalOf(deps, campaignId);
      state = loadReplay(deps.connection, campaignId).state;
      open = null;
    }
  }

  const window = open?.window ?? null;
  /** Non-null when this call FINISHES a turn an earlier one opened. */
  const continues = isBurnClosingIntent(intent) ? (open?.correlationId ?? null) : null;
  /** The group every entry of this call joins. See `toAppendable`. */
  const turnCorrelation = continues ?? intentId;

  /**
   * What the decision produced, captured out of the callback.
   *
   * A record rather than three `let`s: the callback runs inside
   * `settleIntentOnce`, and a variable assigned there is one TypeScript's
   * control-flow analysis has to give up on. A field of an object it does not
   * narrow is honest about that instead of fighting it.
   */
  const captured: {
    violation: RuleViolation | null;
    brief: NarrationBrief | null;
    pending: BurnWindow | null;
  } = { violation: null, brief: null, pending: null };

  const now = deps.clock.now();
  const write = deps.connection.transaction((): PipelineOutcome => {
    // `decide()` runs INSIDE `settleIntentOnce`'s callback, and only when the
    // identifier is new. That is what makes a replayed intent cost nothing and
    // draw nothing: a reconnection that resends an unacknowledged intent must
    // not give the player a different outcome for an action taken once.
    const outcome = settleIntentOnce(
      deps.connection,
      {
        id: intentId,
        campaignId,
        playerId,
        characterId: actorId,
        type: intent.type,
        payload: intent,
        receivedAt: now,
      },
      () => {
        const decision = decide(state, intent, decisionContext(deps, state, actorId, window));
        if (isErr(decision)) {
          captured.violation = decision.error;
          return { kind: 'reject', code: decision.error.code, detail: null };
        }
        // The brief carries the group too, and it must be the group the
        // JOURNAL holds: M0-29 reads `brief.correlationId` to address the
        // narration it streams.
        captured.brief = { ...decision.value.brief, correlationId: turnCorrelation };
        captured.pending = decision.value.pending;
        return {
          kind: 'apply',
          events: decision.value.events.map((event) => toAppendable(event, turnCorrelation)),
        };
      },
    );

    if (outcome.status !== 'applied') {
      // A refusal REPLAYED has no `RuleViolation` object to hand back: the
      // journal stores the code, not the details. The code is the part the
      // client renders, and it comes from the closed union either way.
      const code = (captured.violation?.code ??
        outcome.rejection?.code ??
        'unknown_move') as RuleViolationCode;
      return {
        kind: 'rejected',
        violation: captured.violation ?? { code, details: { replayed: outcome.replayed } },
      };
    }

    // The entries AS THE JOURNAL HOLDS THEM: the database allocated the
    // sequences, and it is the authority on them. On a replay this is the only
    // source there is, which is exactly what "les evenements renvoyes sont
    // identiques" means.
    const events = outcome.events.map((row) => toGameEvent(row));
    const next = persistProjections(deps, campaignId);
    maybeSnapshot(deps, campaignId, next, events);
    state = next;
    return {
      kind: 'accepted',
      events,
      ...(captured.brief === null ? {} : { brief: captured.brief }),
      pending: captured.pending,
      replayed: outcome.replayed,
    };
  });

  const result = write.immediate();
  if (result.kind !== 'accepted') return result;

  // STEP 6 OF SECTION 6, and not one line earlier: the transaction is
  // committed, the entries are durable, and nothing below holds a write lock.
  //
  // Three reasons to stay silent, and the first is the one M0-34 bought:
  // a turn whose burn window is still open is a turn the player may yet
  // revise, and narrating it now would tell it twice.
  const brief = result.brief;
  if (result.pending === null && !result.replayed && brief !== undefined) {
    await narrate(deps, campaignId, state, brief, turnCorrelation);
  }
  return result;
}

/**
 * Would this intent, decided now, write an entry that shuts someone else's
 * window?
 *
 * The question is asked of `burnWindowClosedBy` and of nothing else: the rule
 * — "la fenetre se ferme au premier evenement suivant du meme personnage" —
 * has one implementation, in `@for/engine`, and a net whose rule is retyped at
 * the call site is a net with a hole.
 *
 * The decision below is DISCARDED. It writes nothing and consumes no draw
 * index: an index is consumed by an entry that reaches the journal, and no
 * entry is appended here.
 *
 * NO INTENT OF M0 REACHES THIS BRANCH, and that is said rather than left to be
 * discovered: the eleven moves, the oracles and the speech all write about
 * their OWN actor, so `sameCharacter` catches them first. The producer is
 * M0-29's validated proposals, which write about whoever the storyteller
 * named. It is exported and measured directly for that reason — a branch with
 * no caller yet is worth having only if it is known to work the day it gets
 * one.
 */
export function wouldClose(
  deps: GameDeps,
  state: CampaignState,
  actorId: CharacterId,
  intent: Intent,
  window: BurnWindow,
): boolean {
  const dry = decide(state, intent, decisionContext(deps, state, actorId, null));
  if (isErr(dry)) return false;
  return dry.value.events.some((event) => burnWindowClosedBy(window, event));
}
