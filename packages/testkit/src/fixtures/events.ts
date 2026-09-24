/**
 * `anEvent()` — one journal entry, envelope complete, payload complete.
 *
 * The envelope has SIXTEEN fields (03-donnees.md section 3.1, plus `scope` and
 * `recipients` from ADR 0008). Writing them by hand in a test is how a suite
 * ends up asserting on an envelope nobody meant to describe; `anEvent()` fills
 * them all and asks for nothing.
 *
 * TWO CALL SHAPES, and the types enforce which is which:
 *
 *   anEvent()                                  // a `system.note`, complete
 *   anEvent({ seq: 12, scope: 'private' })     // the same, envelope tweaked
 *   anEvent({ type: 'move.declared', payload: { … } })
 *
 * Naming a `type` makes its `payload` MANDATORY, and typed: `GameEventPayloads`
 * pairs the two in the engine, so `anEvent({ type: 'move.declared', payload:
 * { moveId: 'strike' } })` does not compile — the payload is incomplete. There
 * is deliberately no default payload per type: seventy-one invented defaults
 * would be seventy-one values nobody chose, and a test asserting on one would
 * be asserting on this file.
 *
 * ADR 0008 — `scope` defaults to `table` and `recipients` to `null`, which is
 * the only consistent pair for a party that stays together. Pass both when a
 * test needs an addressed entry.
 */

import type { EventEnvelope, GameEvent, GameEventOf, GameEventPayloads } from '@for/engine';

import { fixedClock } from '../clock/fixed.js';
import { aCorrelationId, anId } from './ids.js';

/** The type `anEvent()` builds when none is named: the journal's free bookmark. */
const DEFAULT_TYPE = 'system.note';

/**
 * The instant every fixture journal starts at. A FIXED clock, not `Date.now()`:
 * an event stream whose `createdAt` moves is an event stream no golden corpus
 * can hold.
 */
export const FIXTURE_EPOCH = '2026-01-01T00:00:00.000Z';

/** One minute between two journal entries. Round, so a diff is readable. */
export const FIXTURE_TICK_MS = 60_000;

const EPOCH_MS = fixedClock(FIXTURE_EPOCH).nowMs();

/** `createdAt` of the entry at `seq`. Derived, so two builders never disagree. */
export function fixtureCreatedAt(seq: number): number {
  return EPOCH_MS + seq * FIXTURE_TICK_MS;
}

/** Every envelope field, each one optional. */
export type EnvelopeOverrides = { readonly [K in keyof EventEnvelope]?: EventEnvelope[K] };

/** Naming a type obliges its payload, and types it. */
export type EventOverrides<TType extends keyof GameEventPayloads> = EnvelopeOverrides & {
  readonly type: TType;
  readonly payload: GameEventPayloads[TType];
};

function anEnvelope(overrides: EnvelopeOverrides): EventEnvelope {
  const seq = overrides.seq ?? 1;
  const base: EventEnvelope = {
    id: anId('event', seq),
    campaignId: anId('campaign'),
    seq,
    playSessionId: null,
    payloadVersion: 1,
    actorKind: 'system',
    actorPlayerId: null,
    subjectCharacterId: null,
    correlationId: aCorrelationId(seq),
    causationId: null,
    rngStream: null,
    rngDrawIndex: null,
    createdAt: fixtureCreatedAt(seq),
    scope: 'table',
    recipients: null,
  };
  return { ...base, ...overrides };
}

export function anEvent(overrides?: EnvelopeOverrides): GameEventOf<typeof DEFAULT_TYPE>;
export function anEvent<TType extends keyof GameEventPayloads>(
  overrides: EventOverrides<TType>,
): GameEventOf<TType>;
export function anEvent(
  overrides: EnvelopeOverrides & {
    readonly type?: keyof GameEventPayloads;
    readonly payload?: GameEventPayloads[keyof GameEventPayloads];
  } = {},
): GameEvent {
  const { type, payload, ...envelopeOverrides } = overrides;
  const envelope = anEnvelope(envelopeOverrides);

  if (type === undefined) {
    return {
      ...envelope,
      type: DEFAULT_TYPE,
      payload: { text: 'note de fixture', byPlayerId: anId('player') },
    };
  }

  // The overloads above are what guarantees the pair `(type, payload)` is one
  // of the seventy-one legal ones; the implementation signature cannot express
  // the correlation, so it asserts it once, here.
  return { ...envelope, type, payload } as GameEvent;
}
