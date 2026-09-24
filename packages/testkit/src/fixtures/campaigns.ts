/**
 * `LONG_CAMPAIGN` — two thousand journal entries, the proof of invariant 2.
 *
 * Invariant 2 says the memory lives in the database, never in the context
 * window. A three-event fixture cannot tell a design that respects it from one
 * that quietly keeps everything in memory: both are fine at three events.
 * Two thousand is the size at which "we compact the chronicle" stops being a
 * sentence in a document.
 *
 * WHAT MAKES IT USABLE AS AN ORACLE, and each point is a way it could have
 * been useless:
 *
 *   - `seq` is dense from 1 to `LONG_CAMPAIGN.length`, which is what
 *     `expectSeqContiguous` checks and what the `events_seq_dense` trigger of
 *     M0-11 will enforce in SQL;
 *   - every entry PARSES against `zGameEvent`. A journal fixture that did not
 *     would make every replay test green over nothing;
 *   - the dice come from `createSeededRng(SEEDS.fuzz)` and the instants from
 *     `fixedClock`, so two runs build the same two thousand entries byte for
 *     byte;
 *   - each entry is internally COHERENT: the outcome of an action roll is the
 *     one its dice give, `move.resolved` cites the seq of its own roll, and
 *     `narration.gm_message` cites the roll it dresses. A fixture whose
 *     numbers disagree with each other teaches a reader the wrong shape;
 *   - one turn in eight is `private` and addressed to one player (ADR 0008),
 *     so a per-recipient replay test has something to bite on. A journal made
 *     only of `table` entries would let a broken filter pass.
 *
 * The events cycle through eight types out of the seventy-one. That is on
 * purpose: this is a fixture of VOLUME, not a catalogue. Coverage of the
 * catalogue is `tests/event-catalog.test.ts` in `@for/contracts`.
 */

import type { CampaignId, CharacterId, GameEvent, Outcome, PlayerId } from '@for/engine';

import { SEEDS, createSeededRng } from '../rng/seeded.js';
import { anEvent } from './events.js';
import { aCorrelationId, anId } from './ids.js';

/** Journal entries before the first turn: creation, the player, the session. */
const PROLOGUE_LENGTH = 3;

/** Entries per turn. */
export const JOURNAL_TURN_LENGTH = 8;

/** Turns before an addressed, private one. */
const PRIVATE_EVERY = 8;

/** Boxes of a progress track: twenty turns of two ticks fill one exactly. */
const TURNS_PER_TRACK = 20;

/** Score ceiling of an action roll (`ACTION_SCORE_CAP` in the contracts). */
const SCORE_CAP = 10;

export interface JournalOptions {
  /** Total entries. At least `PROLOGUE_LENGTH`. */
  readonly count?: number;
  readonly campaignId?: CampaignId;
  readonly playerId?: PlayerId;
  readonly characterId?: CharacterId;
  /** Seed of the dice. Same seed, same journal. */
  readonly seed?: string;
}

/** The outcome those dice give. Computed, never asserted. */
function outcomeOf(total: number, challenge: readonly [number, number]): Outcome {
  const beaten = challenge.filter((die) => total > die).length;
  if (beaten === 2) return 'franche';
  if (beaten === 1) return 'partielle';
  return 'echec';
}

const GAUGES = ['vigueur', 'ame', 'vivres'] as const;

/**
 * A journal of `count` entries, dense from `seq` 1.
 *
 * @param options what the caller wants to pin. Everything else is derived.
 */
export function aJournal(options: JournalOptions = {}): readonly GameEvent[] {
  const count = options.count ?? PROLOGUE_LENGTH;
  if (!Number.isInteger(count) || count < PROLOGUE_LENGTH) {
    throw new RangeError(
      `aJournal: count must be an integer >= ${String(PROLOGUE_LENGTH)}, got ${String(count)}`,
    );
  }

  const campaignId = options.campaignId ?? anId('campaign');
  const playerId = options.playerId ?? anId('player');
  const characterId = options.characterId ?? anId('character');
  const rng = createSeededRng(options.seed ?? SEEDS.fuzz);

  const events: GameEvent[] = [
    anEvent({
      type: 'campaign.created',
      campaignId,
      seq: 1,
      actorKind: 'player',
      actorPlayerId: playerId,
      correlationId: null,
      payload: {
        name: 'La longue marche',
        slug: 'la-longue-marche',
        pitch: 'Une bande remonte vers le nord avant la fermeture du col.',
        ownerPlayerId: playerId,
        contentPackVersion: '0.1.0',
        contentPackHash: 'sha256:fixture',
        rulesVersion: 1,
        rngSeed: SEEDS.campaign,
      },
    }),
    anEvent({
      type: 'party.member_joined',
      campaignId,
      seq: 2,
      actorKind: 'player',
      actorPlayerId: playerId,
      correlationId: null,
      payload: { playerId, role: 'owner', displayName: 'La joueuse' },
    }),
    anEvent({
      type: 'session.opened',
      campaignId,
      seq: 3,
      actorKind: 'system',
      correlationId: null,
      payload: { playSessionId: anId('session'), ordinal: 1, presentPlayerIds: [playerId] },
    }),
  ];

  for (let turn = 0; events.length < count; turn += 1) {
    const start = PROLOGUE_LENGTH + turn * JOURNAL_TURN_LENGTH + 1;
    const rollSeq = start + 2;
    const isPrivate = turn % PRIVATE_EVERY === PRIVATE_EVERY - 1;
    const addressed = isPrivate
      ? ({ scope: 'private', recipients: [playerId] } as const)
      : ({ scope: 'table', recipients: null } as const);
    const turnOf = { campaignId, correlationId: aCorrelationId(turn + 1), ...addressed };

    const actionDie = rng.roll(6);
    const attributeValue = 2;
    const rawTotal = actionDie + attributeValue;
    const total = Math.min(rawTotal, SCORE_CAP);
    const challengeDice: readonly [number, number] = [rng.roll(10), rng.roll(10)];
    const outcome = outcomeOf(total, challengeDice);
    const gauge = GAUGES[turn % GAUGES.length] ?? 'vigueur';
    const gaugeFrom = 5 - (turn % 5);
    const trackFrom = (turn % TURNS_PER_TRACK) * 2;

    const turnEvents: readonly GameEvent[] = [
      anEvent({
        ...turnOf,
        type: 'narration.player_message',
        seq: start,
        actorKind: 'player',
        actorPlayerId: playerId,
        subjectCharacterId: characterId,
        payload: { text: 'Je remonte la crête pour voir le col.', kind: 'ic', characterId },
      }),
      anEvent({
        ...turnOf,
        type: 'move.declared',
        seq: start + 1,
        actorKind: 'player',
        actorPlayerId: playerId,
        subjectCharacterId: characterId,
        payload: {
          moveId: 'face-danger',
          characterId,
          narrativeInput: 'Je remonte la crête pour voir le col.',
        },
      }),
      anEvent({
        ...turnOf,
        type: 'roll.action_resolved',
        seq: rollSeq,
        actorKind: 'engine',
        subjectCharacterId: characterId,
        rngStream: 'action',
        rngDrawIndex: turn,
        payload: {
          rollId: anId('roll', turn + 1),
          characterId,
          moveId: 'face-danger',
          attribute: 'fer',
          attributeValue,
          actionDie,
          adds: [],
          rawTotal,
          total,
          cappedAtTen: rawTotal > SCORE_CAP,
          challengeDice: [challengeDice[0], challengeDice[1]],
          outcome,
          isPresage: challengeDice[0] === challengeDice[1],
          momentumBefore: 2,
          momentumNegated: false,
          burnWindow: true,
          rngStream: 'action',
          rngDrawIndex: turn,
        },
      }),
      anEvent({
        ...turnOf,
        type: 'move.resolved',
        seq: start + 3,
        actorKind: 'engine',
        subjectCharacterId: characterId,
        payload: { moveId: 'face-danger', characterId, rollSeq, outcome, effectsApplied: [] },
      }),
      anEvent({
        ...turnOf,
        type: 'character.gauge_changed',
        seq: start + 4,
        actorKind: 'engine',
        subjectCharacterId: characterId,
        causationId: anId('event', rollSeq),
        payload: {
          characterId,
          gauge,
          delta: -1,
          from: gaugeFrom,
          to: gaugeFrom - 1,
          clamped: false,
          cause: `move:face-danger/${outcome}`,
        },
      }),
      anEvent({
        ...turnOf,
        type: 'track.ticked',
        seq: start + 5,
        actorKind: 'engine',
        causationId: anId('event', rollSeq),
        payload: {
          trackId: anId('track', 1 + Math.floor(turn / TURNS_PER_TRACK)),
          ticks: 2,
          from: trackFrom,
          to: trackFrom + 2,
          cause: `move:face-danger/${outcome}`,
          milestones: 0,
        },
      }),
      anEvent({
        ...turnOf,
        type: 'narration.gm_message',
        seq: start + 6,
        actorKind: 'gm_ai',
        subjectCharacterId: characterId,
        payload: {
          text: 'Le vent te prend de flanc et la crête se dérobe sous ta botte.',
          aiCallId: anId('aicall', turn + 1),
          model: 'stub',
          promptVersion: 'fixture-1',
          source: 'ai',
          respondsToSeq: rollSeq,
          citedEventSeqs: [rollSeq],
        },
      }),
      anEvent({
        ...turnOf,
        type: 'system.note',
        seq: start + 7,
        actorKind: 'player',
        actorPlayerId: playerId,
        payload: { text: `fin du tour ${String(turn + 1)}`, byPlayerId: playerId },
      }),
    ];

    events.push(...turnEvents);
  }

  return events.slice(0, count);
}

/** The size `LONG_CAMPAIGN` is built at. The acceptance criterion reads it. */
export const LONG_CAMPAIGN_LENGTH = 2000;

/** Two thousand entries, dense from 1. Built once, at import. */
export const LONG_CAMPAIGN: readonly GameEvent[] = aJournal({ count: LONG_CAMPAIGN_LENGTH });
