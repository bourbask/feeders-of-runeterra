/**
 * Frame builders for the tests.
 *
 * EVERY GAME STATE HERE COMES FROM `@for/testkit` (01-architecture.md section
 * 7.2): no literal state object in a test file, so a field added to the engine
 * does not leave fifty fixtures behind. What this file adds is the WIRE
 * ENVELOPE, which is the client's business and nobody else's.
 *
 * The builders return `unknown`, deliberately. The store's job is to
 * `safeParse` whatever arrives; handing it a pre-typed object would test a
 * path production never takes.
 */

import type { S2CMessage, TableStateDto, TurnProofDto } from '@for/contracts';
import { zTableState } from '@for/contracts';
import type { GameEvent } from '@for/engine';
import type { TableStateOverrides } from '@for/testkit';
import { aCorrelationId, aTableState, anId } from '@for/testkit';

let compteur = 0;

/** A UUID for the envelope `id`. Deterministic: a fixture reads no clock. */
export function aFrameId(): string {
  compteur += 1;
  return `00000000-0000-4000-9000-${compteur.toString(16).padStart(12, '0')}`;
}

/** Fixed instant. `ts` is the server's stamp, and a fixture has no server. */
export const FRAME_TS = 1_767_225_600_000;

function frame(t: S2CMessage['t'], p: unknown): unknown {
  return { v: 1, t, id: aFrameId(), ts: FRAME_TS, p };
}

export function eventFrame(seq: number, deliverySeq: number, event: GameEvent): unknown {
  return { v: 1, t: 's2c.event', id: aFrameId(), ts: FRAME_TS, seq, deliverySeq, p: { event } };
}

export function batchFrame(
  entries: readonly { seq: number; deliverySeq: number; event: GameEvent }[],
): unknown {
  return frame('s2c.events_batch', { events: entries });
}

/**
 * `project(CampaignState, viewerId)` as the server does it: records become
 * arrays, `rng` is dropped, and the state is the testkit's, never a literal.
 *
 * THE PROJECTION IS PARSED, not cast. `zTableState.parse` is what turns the
 * engine's readonly state into the DTO's own shape, and it fails loudly if the
 * projection drops a field or keeps one it must not — `rng` in particular. A
 * cast here would make the fixture agree with itself instead of with the
 * contract.
 */
export function aTableStateDto(overrides: TableStateOverrides = {}): TableStateDto {
  const state = aTableState(overrides);
  const projete = {
    campaignId: state.campaignId,
    seq: state.seq,
    status: state.status,
    contentPackHash: state.contentPackHash,
    settings: state.settings,
    truths: state.truths,
    characters: Object.values(state.characters),
    tracks: Object.values(state.tracks).map((track) => ({ ...track, visibility: 'public' })),
    clocks: Object.values(state.clocks).map((clock) => ({ ...clock, visibility: 'public' })),
    entities: Object.values(state.entities),
    championLocks: Object.values(state.championLocks),
    scene: state.scene,
    party: state.party,
  };
  return zTableState.parse(structuredClone(projete));
}

export function welcomeFrame(lastSeq = 0, lastDeliverySeq = 0): unknown {
  return frame('s2c.welcome', {
    protocolVersion: 1,
    playerId: anId('player'),
    campaignId: anId('campaign'),
    you: { characterId: anId('character') },
    contentVersion: '1.0.0',
    lastSeq,
    lastDeliverySeq,
  });
}

export function snapshotFrame(
  state: TableStateDto,
  lastSeq: number,
  lastDeliverySeq: number,
): unknown {
  return frame('s2c.snapshot', { state, lastSeq, lastDeliverySeq });
}

export function presenceFrame(
  members: readonly { playerId: string; characterId: string | null }[],
): unknown {
  return frame('s2c.presence', {
    members: members.map((member) => ({ ...member, online: true, typing: false })),
  });
}

export function turnProofFrame(proof: TurnProofDto, truncated = false): unknown {
  return frame('s2c.turn_proof', { correlationId: proof.correlationId, proof, truncated });
}

/** A complete, applied proof. Every optional part present, so a test can remove one. */
export function aTurnProof(overrides: Partial<TurnProofDto> = {}): TurnProofDto {
  const base: TurnProofDto = {
    correlationId: aCorrelationId(7),
    firstSeq: 412,
    lastSeq: 415,
    status: 'applied',
    revertedBy: null,
    move: {
      eventSeq: 412,
      moveId: 'face-danger',
      attribute: 'fer',
      bonus: 0,
      label: 'Affronter le danger',
    },
    roll: {
      eventSeq: 413,
      rngStream: 'action',
      rngDrawIndex: 118,
      action: 7,
      challenge: [3, 9],
      total: 11,
      outcome: 'partielle',
    },
    revision: null,
    effects: [{ eventSeq: 414, type: 'gauge', label: 'Vigueur −1' }],
    price: null,
    presage: null,
    narration: { eventSeq: 415, source: 'ai' },
  };
  return { ...base, ...overrides };
}
