/**
 * ONE TURN OF THE STORYTELLER, end to end (02-mj-ia.md sections 1, 6, 7).
 *
 * Step 6 of ARCHITECTURE.md section 6, and nothing before it: the dice are
 * rolled, the entries are committed, the `s2c.event` frames are out. What
 * happens here is text, and text alone. An outage of the port loses prose and
 * never a game.
 *
 * ── THE ORDER OF THE FRAMES IS A CONTRACT, NOT A HABIT ───────────────────
 * On a turn a proven refusal cancels, section 6.2 fixes three frames in this
 * order and no other:
 *
 *   1. `s2c.narration_done` — the prose is valid, and it is what explains to
 *      the player, in fiction, why nothing took place;
 *   2. `s2c.narration_error { code: 'action_impossible' }`;
 *   3. the `s2c.event` of the `system.reverted`, which MARKS the lines named
 *      by `targetSeqs` as cancelled.
 *
 * Held by `tests/ai/turn.test.ts`, « l'ordre exact après un refus retenu »,
 * which records the three channels into one list and asserts the array.
 *
 * ── AND NOTHING IS ERASED ────────────────────────────────────────────────
 * There is no suppression frame, in this file or anywhere: a cancelled turn
 * stays on screen, struck through, with « Pourquoi ? » still on it (P22,
 * section 4.8.6). `getTurnProof` answers on the cancelled group afterwards,
 * with `status: 'reverted'` and the roll, the effects, the price and the
 * presage it cancelled.
 *
 * ── THE HUB IS TOLD BY SEQUENCE, NEVER BY THE RESULT ─────────────────────
 * M0-24 left this in writing: entries written by the burn window's SAFETY NET
 * are journalled and absent from the intent's result, so a hub handed
 * `result.events` leaves a hole in `seq`. Everything this file broadcasts goes
 * through `EventDelivery.deliverSince(campaignId, sinceSeq)`, which reads the
 * journal. And it is the HUB that applies the scope filter of ADR 0008, for
 * the same reason: the intent path hands its events over unfiltered.
 *
 * ── THE REFUSAL IS PROVEN BEFORE THE SCENE IS MERGED ─────────────────────
 * Deliberate, and worth a line. A proven refusal cancels the whole group; a
 * `scene.facts_updated` written first would be cancelled with it, and one
 * written after would survive a turn that did not happen. So the refusal is
 * settled first, and the merge runs only on the turns that stand.
 */

import {
  CONTEUR_PROMPT_VERSION,
  DEFAULT_LIMITS,
  buildNarrateRequest,
  postfilter,
  readNarration,
  runNarration,
} from '@for/ai';
import { appendEvents } from '@for/db';
import { fallbackNarration } from '@for/engine';

import type { NarratorBreaker } from './calls.js';
import { narratorErrorCodeOf, narratorPlan, recordAiCall } from './calls.js';
import { assetNames, factVocabulary, trimmableContext } from './context.js';
import { championOfCharacter, reservedChampions } from './lockout.js';
import { applyRefusal } from './refusal.js';
import { applySceneBlock, sceneBefore } from './scene-state.js';

import type { AssertionContext, ReservedChampion } from '@for/ai';
import type { ContentRegistry } from '@for/content';
import type {
  NarrateRequest,
  NarrationBriefDto,
  NarratorMessage,
  NarratorPort,
  SceneBlock,
} from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type {
  AiCallId,
  CampaignState,
  EventId,
  FallbackTemplates,
  GameEventOf,
  IdFactory,
  NarrationBrief,
  Rng,
} from '@for/engine';
import type { TimeSource } from '../deps.js';
import type { NarrationBroadcast, NarrationDispatcher } from './broadcast.js';
import type { AiLogger } from './refusal.js';

/**
 * What the model's leak costs, in a field a test can read.
 *
 * « une alerte journalisée » is not verifiable; `event`, `campaignId` and
 * `assertion` are. Held by `tests/ai/turn.test.ts`, « une fuite de champion
 * réservé lève une ligne warn portant les trois champs ».
 */
export const RESERVED_CHAMPION_LEAK = 'reserved_champion_leak';

/** How the hub is told. By SEQUENCE — see the header. */
export interface EventDelivery {
  deliverSince(campaignId: string, sinceSeq: number): void;
}

export interface TurnDeps {
  readonly connection: SqliteConnection;
  readonly content: ContentRegistry;
  readonly narrator: NarratorPort;
  readonly ids: IdFactory;
  readonly clock: TimeSource;
  readonly logger: AiLogger;
  readonly dispatcher: NarrationDispatcher;
  readonly breaker: NarratorBreaker;
  readonly delivery: EventDelivery;
  /** `content/fallbacks/narration.json`, for the turn the storyteller misses. */
  readonly fallbacks: FallbackTemplates;
  /** The `fallback` stream, so the engine's sentence replays. */
  readonly fallbackRng: (state: CampaignState) => Rng;
  /** The campaign block of the prompt, built once per campaign by the caller. */
  readonly campaignBlock: string;
  readonly systemPrompt: string;
  /** In [0, 1), for the retry backoff. Injected: a wait is a value. */
  readonly jitter: () => number;
  /** Awaits `ms`. Injected so a test does not sleep. */
  readonly wait: (ms: number) => Promise<void>;
}

export interface TurnInput {
  readonly campaignId: string;
  readonly brief: NarrationBrief;
  /** The committed state, after the turn's entries. */
  readonly state: CampaignState;
  /** The journal head BEFORE this narration writes anything. */
  readonly sinceSeq: number;
  readonly now: number;
}

export interface TurnResult {
  readonly narrationId: string;
  readonly source: 'ai' | 'engine';
  /** What players received. Never carries `<scene_apres>`. */
  readonly text: string;
  readonly sceneBlock: SceneBlock | null;
  readonly refusal: ReturnType<typeof applyRefusal>;
  /** `seq` of the `scene.facts_updated`, or `null`. */
  readonly sceneFactsSeq: number | null;
  readonly attempts: number;
}

interface Spoken {
  /**
   * A DISCRIMINANT, not decoration. Without a literal field on both sides the
   * compiler cannot narrow `Attempt` in the branch where the call SUCCEEDED —
   * `Spoken` and the failure share no property, and a type predicate excludes
   * a member only when a discriminant says which member it is.
   */
  readonly failed: false;
  readonly raw: string;
  readonly model: string;
  readonly finish: NonNullable<Parameters<typeof recordAiCall>[1]['finishReason']>;
  readonly usage: Parameters<typeof recordAiCall>[1]['usage'];
  readonly latencyMs: number;
  readonly attempts: number;
}

interface Failure {
  readonly failed: true;
  readonly code: string;
  readonly attempts: number;
}

type Attempt = Spoken | Failure;

const failed = (value: Attempt): value is Failure => value.failed;

/**
 * Run the storyteller for one turn.
 *
 * It NEVER throws on the port's account: every failure becomes
 * `narration.gm_failed` plus the engine's sentence, because the fact was
 * already decided, already written and already broadcast.
 */
export async function runNarrationTurn(deps: TurnDeps, input: TurnInput): Promise<TurnResult> {
  const brief: NarrationBriefDto = toBriefDto(input.brief);
  const eventSeq = brief.eventSeqs[0] ?? input.state.seq;
  const actorCharacterId = brief.actorCharacterId;

  const broadcast = deps.dispatcher.open({
    campaignId: input.campaignId,
    eventSeq,
    actorCharacterId,
    audience: {
      scope: brief.audience.scope,
      recipients: brief.audience.recipients,
    },
    now: input.now,
  });

  const reserved = reservedChampions(
    deps.connection,
    deps.content,
    input.campaignId,
    ownChampion(deps, input, actorCharacterId),
  );

  const request = buildNarrateRequest({
    requestId: deps.ids.next(),
    brief,
    systemPrompt: deps.systemPrompt,
    campaignBlock: deps.campaignBlock,
    actorLabel: actorLabel(input.state, actorCharacterId),
    vocabulary: factVocabulary(brief, deps.content),
    trimmable: trimmableContext(deps.connection, deps.content, input.state, input.campaignId),
    contextWindowTokens: deps.narrator.capabilities.contextWindowTokens,
  }).request;

  const attempt = await speak(deps, input, broadcast, request, reserved);
  /** The answer, or `null` when the port failed. Narrowed ONCE, here. */
  const spoken: Spoken | null = failed(attempt) ? null : attempt;

  // ---------------------------------------------------------------- the prose

  const reading =
    spoken === null || spoken.raw.length === 0 ? null : readNarration(spoken.raw, reserved);

  const engineText = (): string =>
    fallbackNarration(input.brief, input.state, deps.fallbacks, deps.fallbackRng(input.state));

  const source: 'ai' | 'engine' = reading === null ? 'engine' : 'ai';
  const text = reading === null ? engineText() : reading.output.prose;
  const model = spoken === null ? deps.narrator.providerId : spoken.model;

  // --------------------------------------------------------------- the trace

  recordAiCall(deps.connection, {
    id: request.requestId,
    campaignId: input.campaignId,
    purpose: 'narration',
    provider: deps.narrator.providerId,
    model,
    promptVersion: CONTEUR_PROMPT_VERSION,
    systemHash: '',
    status: spoken === null ? 'error' : 'ok',
    usage: spoken?.usage ?? ZERO,
    latencyMs: spoken?.latencyMs ?? 0,
    trimLevel: 0,
    ...(spoken === null ? {} : { finishReason: spoken.finish }),
    ...(failed(attempt) ? { errorCode: narratorErrorCodeOf({ code: attempt.code }) } : {}),
    resultingEventSeq: eventSeq,
    evalTags: reading === null ? [] : [...reading.tags],
    createdAt: input.now,
  });

  // ------------------------------------------------------------ the refusal
  //
  // BEFORE the prose is persisted, and that is section 4.8.3 point 4 rather
  // than a preference: `revertTurn` names the entries the group holds AT THAT
  // INSTANT, so a `narration.gm_message` written first would be struck through
  // along with the dice — and the prose is exactly what explains to the player,
  // in fiction, why nothing took place. Written after, it keeps the turn's
  // `correlation_id` (one turn, one group, « Pourquoi ? » still addressable)
  // and stays out of `targetSeqs`. Held by `tests/ai/refusal.test.ts`, « la
  // prose du tour annulé n'est pas dans les lignes barrées ».
  const refusal = applyRefusal(
    { connection: deps.connection, ids: deps.ids, logger: deps.logger },
    {
      campaignId: input.campaignId,
      correlationId: brief.correlationId,
      refusal: reading?.output.sceneBlock?.refus ?? null,
      declaredCount: (reading?.output.sceneBlock?.refus ?? null) === null ? 0 : 1,
      state: input.state,
      sceneAtDeclaration: sceneBefore(input.state),
      actorCharacterId,
      intention: brief.playerInput,
      moveId: brief.moveId,
      actorAssets: assetNames(input.state, deps.content, actorCharacterId),
      aiCallId: request.requestId,
      now: input.now,
    },
  );

  // ----------------------------------------------------------- the narration

  if (failed(attempt)) {
    appendNarration(deps, input, 'narration.gm_failed', {
      aiCallId: request.requestId as AiCallId,
      errorKind: failureKind(attempt.code),
      fallbackText: text,
    });
  }

  const message = appendNarration(deps, input, 'narration.gm_message', {
    text,
    aiCallId: request.requestId as AiCallId,
    model,
    promptVersion: CONTEUR_PROMPT_VERSION,
    source,
    citedEventSeqs: brief.eventSeqs,
  });

  // THE ORDER OF THE THREE FRAMES, and it is a contract (section 6.2):
  // `narration_done` first — the prose is valid and must be shown; then
  // `narration_error { action_impossible }`; then, last, the `s2c.event` of
  // the `system.reverted`, which marks the cancelled lines.
  //
  // Section 6.4: `narration_done` never precedes the commit of the entry it
  // announces, so a client may treat it as the point of truth.
  broadcast.complete({ eventSeq, text, model, source }, input.now);

  if (refusal.kind === 'upheld') {
    broadcast.fail('action_impossible', input.now);
  }

  // -------------------------------------------------------------- the scene

  const merged =
    refusal.kind === 'upheld'
      ? null
      : applySceneBlock(
          { connection: deps.connection, ids: deps.ids },
          {
            campaignId: input.campaignId,
            correlationId: brief.correlationId,
            causationId: message,
            state: input.state,
            block: reading?.output.sceneBlock ?? null,
            aiCallId: request.requestId,
            now: input.now,
          },
        );

  // BY SEQUENCE, and once: everything this turn wrote, in journal order,
  // filtered by the hub. See the header.
  deps.delivery.deliverSince(input.campaignId, input.sinceSeq);

  return {
    narrationId: broadcast.narrationId,
    source,
    text: broadcast.emittedText().length > 0 ? broadcast.emittedText() : text,
    sceneBlock: reading?.output.sceneBlock ?? null,
    refusal,
    sceneFactsSeq: merged?.seq ?? null,
    attempts: attempt.attempts,
  };
}

// -------------------------------------------------------------- the speaking

const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * Call the port, stream it, post-filter it, and retry once if the filter says
 * so.
 *
 * TWO LADDERS, NOT ONE, and they are different: `narratorPlan` answers a port
 * ERROR (section 7.1), the post-filter answers a prose that came back and is
 * wrong (section 8.6). Folding them would give a `bad_request` the
 * post-filter's retry, which section 7.2 forbids by name.
 */
async function speak(
  deps: TurnDeps,
  input: TurnInput,
  broadcast: NarrationBroadcast,
  first: NarrateRequest,
  reserved: readonly ReservedChampion[],
): Promise<Attempt> {
  if (deps.breaker.isOpen(input.campaignId, input.now)) {
    // « Conteur hors ligne ». Not a failure of this call: a decision taken
    // five failures ago, and the engine's sentence is what it buys.
    return { failed: true, code: 'unavailable', attempts: 0 };
  }

  let request = first;
  let attempts = 0;
  let portAttempt = 0;

  for (;;) {
    let outcome;
    try {
      outcome = await runNarration(request, {
        narrator: deps.narrator,
        onEvent: (event) => {
          if (event.type !== 'delta') return;
          broadcast.push(event.text);
          // THE CLOCK, not the turn's timestamp: the 50 ms window is a real
          // window, and a constant `now` would coalesce a whole turn into one
          // frame — which is what a caller who passed `input.now` would get.
          broadcast.pump(deps.clock.now());
        },
      });
    } catch (error) {
      const code = narratorErrorCodeOf(error);
      const armed = deps.breaker.recordFailure(input.campaignId, code, input.now);
      portAttempt += 1;
      const plan = narratorPlan({
        code,
        retryAfterMs: readRetryAfter(error),
        attempt: portAttempt,
        jitter: deps.jitter(),
      });
      // `quota_exhausted` arms the breaker and is never retried — `narratorPlan`
      // answers `give_up` for it, and `armed` only records that the campaign is
      // now offline.
      if (plan.kind === 'retry' && !armed) {
        await deps.wait(plan.waitMs);
        continue;
      }
      broadcast.seal(deps.clock.now());
      return { failed: true, code, attempts: portAttempt };
    }

    deps.breaker.recordSuccess(input.campaignId);
    broadcast.seal(deps.clock.now());
    attempts += 1;

    const raw = outcome.text;
    if (raw.length === 0) {
      // The `stub` port answers nothing. That is not a failure — see
      // `ai/narrator.ts` — and the engine's sentence is what it always meant.
      return spokenOf(outcome, deps, attempts);
    }

    const reading = readNarration(raw, reserved);
    const verdict = postfilter(
      reading.output.prose,
      assertionContext(deps, input, reserved, reading.output.sceneBlock),
      attempts - 1,
    );

    if (verdict.reservedChampionLeak) {
      // ALWAYS logged, even when the retry then succeeds (section 8.6).
      deps.logger.warn(
        {
          event: RESERVED_CHAMPION_LEAK,
          campaignId: input.campaignId,
          assertion: 'no_reserved_champion',
        },
        'le conteur a nommé un champion réservé',
      );
    }

    if (verdict.decision === 'accept') return spokenOf(outcome, deps, attempts);
    if (verdict.decision === 'fallback') {
      return { failed: true, code: 'invalid_output', attempts };
    }

    // `retry`: the corrections are APPENDED to the user message, never a
    // rewrite of the system prompt or of the campaign block — section 7.2,
    // « pour préserver le préfixe caché ».
    request = withCorrections(request, verdict.corrections);
  }
}

function spokenOf(
  outcome: Awaited<ReturnType<typeof runNarration>>,
  deps: TurnDeps,
  attempts: number,
): Spoken {
  return {
    failed: false,
    raw: outcome.text,
    model:
      outcome.result.providerModel.length > 0
        ? outcome.result.providerModel
        : deps.narrator.providerId,
    finish: outcome.result.finish,
    usage: outcome.result.usage,
    latencyMs: outcome.result.latencyMs,
    attempts,
  };
}

/** Appends `<corrections>` to the LAST user message. */
function withCorrections(request: NarrateRequest, corrections: string): NarrateRequest {
  const messages: NarratorMessage[] = request.messages.map((message) => ({ ...message }));
  const last = messages.at(-1);
  if (last === undefined) return request;
  messages[messages.length - 1] = {
    role: last.role,
    content: [...last.content, { type: 'text', text: corrections }],
  };
  return { ...request, messages };
}

/** `retryAfterMs` as the adapter reported it, or nothing. */
function readRetryAfter(error: unknown): number | null {
  const value = (error as { readonly retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof value === 'number' ? value : null;
}

/**
 * The journal's word for a failure, which is NOT the wire's word.
 *
 * `narration.gm_failed.errorKind` records what broke inside the server;
 * `s2c.narration_error.code` says what a screen should do. Two audiences, two
 * vocabularies — 01-architecture.md section 5.4 keeps them apart, and a single
 * mapping table here is what stops them from being fused.
 */
export function failureKind(
  code: string,
): 'api_error' | 'refused' | 'invalid_output' | 'rejected_by_postfilter' | 'aborted' {
  switch (code) {
    case 'refused':
      return 'refused';
    case 'aborted':
      return 'aborted';
    case 'invalid_output':
      // The post-filter is the only producer of this code in this file, and
      // its own word is the specific one.
      return 'rejected_by_postfilter';
    default:
      return 'api_error';
  }
}

// -------------------------------------------------------------- the helpers

/**
 * The engine's brief, as the DTO `@for/ai` reads.
 *
 * A COPY, field by field, and the reason is mechanical rather than stylistic:
 * `NarrationBrief` carries `readonly` arrays and `NarrationBriefDto` — the Zod
 * output — carries mutable ones, so the two types are not assignable in that
 * direction. Written out rather than spread, for the reason
 * `refusalProofInput` is written out: a spread carries a future field through
 * in silence, and this is the boundary between what the ENGINE decided and
 * what the model will be shown.
 */
export function toBriefDto(brief: NarrationBrief): NarrationBriefDto {
  return {
    correlationId: brief.correlationId,
    sceneId: brief.sceneId,
    audience: {
      scope: brief.audience.scope,
      recipients: brief.audience.recipients === null ? null : [...brief.audience.recipients],
    },
    perceivableFacts: brief.perceivableFacts.map((fact) => ({ ...fact, ref: { ...fact.ref } })),
    actorCharacterId: brief.actorCharacterId,
    moveId: brief.moveId,
    outcome: brief.outcome,
    isPresage: brief.isPresage,
    roll:
      brief.roll === null
        ? null
        : {
            ...brief.roll,
            adds: brief.roll.adds.map((add) => ({ ...add })),
            challengeDice: [brief.roll.challengeDice[0], brief.roll.challengeDice[1]],
          },
    appliedEffects: brief.appliedEffects.map((applied) => ({ ...applied })),
    imposedPrice: brief.imposedPrice === null ? null : { ...brief.imposedPrice },
    presage: brief.presage === null ? null : { ...brief.presage },
    playerInput: brief.playerInput,
    eventSeqs: [...brief.eventSeqs],
    fallbackTemplateId: brief.fallbackTemplateId,
  };
}

function ownChampion(
  deps: TurnDeps,
  input: TurnInput,
  characterId: string | null,
): readonly string[] {
  if (characterId === null) return [];
  const champion = championOfCharacter(deps.connection, input.campaignId, characterId);
  return champion === null ? [] : [champion];
}

function actorLabel(state: CampaignState, characterId: string | null): string {
  if (characterId === null) return 'le personnage';
  const character = Object.values(state.characters).find((entry) => entry.id === characterId);
  return character?.displayName ?? 'le personnage';
}

/** What the post-filter is handed. Read from the state, never guessed. */
function assertionContext(
  deps: TurnDeps,
  input: TurnInput,
  reserved: readonly ReservedChampion[],
  sceneBlock: SceneBlock | null,
): AssertionContext {
  const brief = input.brief;
  const scene = sceneBefore(input.state);
  const priceEntry =
    brief.imposedPrice === null
      ? undefined
      : deps.content.bundle.priceTable.entries.find(
          (entry) => entry.id === brief.imposedPrice?.entryId,
        );
  return {
    reservedChampions: reserved,
    playerCharacterNames: Object.values(input.state.characters).map(
      (character) => character.displayName,
    ),
    absentNames: scene.absent.map((entry) => entry.name),
    sceneEntityNames: scene.present.map((entry) => entry.name),
    // `null` means « no price this turn ». An EMPTY list means « a price with
    // no keyword », which `price_respected` fails on purpose — a price nothing
    // can be scored against is a hole in the content, not a free pass.
    priceKeywords: brief.imposedPrice === null ? null : [...(priceEntry?.keywords ?? [])],
    factHasTimeSkip: false,
    sceneBlock,
    refusal: null,
    expectedRefusal: null,
    toolCalls: [],
    allowedTools: [],
    mentionsAny: [],
    limits: DEFAULT_LIMITS,
  };
}

/** One `narration.*` entry, appended. Returns its identifier for causation. */
function appendNarration<TType extends 'narration.gm_message' | 'narration.gm_failed'>(
  deps: TurnDeps,
  input: TurnInput,
  type: TType,
  payload: GameEventOf<TType>['payload'],
): EventId {
  const id = deps.ids.next() as EventId;
  appendEvents(deps.connection, {
    campaignId: input.campaignId,
    events: [
      {
        id,
        type,
        payload,
        payloadVersion: 1,
        // The model spoke. `narration.*` is the trace of what it said, and it
        // carries no game value (03-donnees.md section 0.5).
        actorKind: type === 'narration.gm_message' ? 'gm_ai' : 'system',
        actorPlayerId: null,
        subjectCharacterId: input.brief.actorCharacterId,
        correlationId: input.brief.correlationId,
        causationId: null,
        rngStream: null,
        rngDrawIndex: null,
        scope: 'table',
        recipients: null,
        createdAt: input.now,
      },
    ],
    now: input.now,
  });
  return id;
}
