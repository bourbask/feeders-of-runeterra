/**
 * The WebSocket store: a MIRROR of what the server said, never an authority
 * (invariant 3, 01-architecture.md section 2.9).
 *
 * FIVE PROPERTIES THIS FILE EXISTS TO HOLD, each one tested by violating it:
 *
 *   1. EVERY FRAME IS `safeParse`D BEFORE IT IS LOOKED AT. A malformed frame
 *      raises nothing, changes no state and asks the server to repeat itself.
 *      A client that threw on a bad frame would take the table down with it.
 *   2. `s2c.snapshot` OVERWRITES EVERYTHING. Not a merge: the journal, the
 *      turns, the proofs and the open panels are all dropped and rebuilt. A
 *      merge would let a line the server no longer sends survive on a screen.
 *   3. A HOLE IN `deliverySeq` ASKS FOR A RESUME — never a hole in `seq`. This
 *      is ADR 0010 decision 1, and it is the opposite of what the M0-19 sheet
 *      asks for: since ADR 0008 an addressed event leaves a LEGITIMATE hole in
 *      `seq` for a player who was not a recipient, so watching `seq` would make
 *      the client resume forever on events it is not entitled to. Reported, not
 *      worked around: `store.test.ts` measures both directions.
 *   4. A REVERTED TURN IS MARKED, NEVER REMOVED (P22, 02-mj-ia.md 4.8.6 (b)).
 *      `revocations` is a map `seq -> RevokedMark`, applied by `journalLines()`
 *      at read time, so a `system.reverted` that arrives BEFORE the line it
 *      names still marks it when it comes. Nothing is ever spliced out.
 *   5. THE FEED READS IN `deliverySeq` ORDER, WHATEVER THE ARRIVAL ORDER. A
 *      catch-up batch can land after a live event that is already ahead of it,
 *      so insertion order is NOT reading order. `store.test.ts` delivers 3, 1,
 *      2 and expects [1, 2, 3]: drop the sort in `applyEvent` and it goes red.
 *
 * THE STORE NEVER RECOMPOSES A PROOF. `proofs` holds what `s2c.turn_proof`
 * delivered, verbatim. There is no code path from an event to a proof entry,
 * on purpose: a proof assembled from local state would be a client inventing
 * evidence about the server's dice.
 */

import type {
  C2SMessage,
  RejectionCode,
  S2CMessage,
  TableStateDto,
  TurnProofDto,
} from '@for/contracts';
import { zS2CEnvelope } from '@for/contracts';
import type { GameEvent } from '@for/engine';
import type { StoreApi } from 'zustand/vanilla';
import { createStore } from 'zustand/vanilla';

import type { JournalLine, RevokedMark } from './journal.js';
import { lineOfEvent } from './journal.js';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface WelcomeInfo {
  readonly playerId: string;
  readonly campaignId: string;
  readonly characterId: string | null;
  readonly contentVersion: string;
}

export interface PresenceMember {
  readonly playerId: string;
  readonly characterId: string | null;
  readonly online: boolean;
  readonly typing: boolean;
}

export interface NarrationStream {
  readonly narrationId: string;
  readonly eventSeq: number;
  readonly text: string;
  readonly status: 'streaming' | 'done' | 'failed' | 'aborted';
}

export interface StoredProof {
  readonly proof: TurnProofDto;
  readonly truncated: boolean;
}

export interface Rejection {
  readonly intentId: string;
  readonly code: RejectionCode;
}

export interface TableState {
  readonly status: ConnectionStatus;
  readonly welcome: WelcomeInfo | null;
  /** The server's projection. Replaced whole by each snapshot, never patched. */
  readonly table: TableStateDto | null;
  /** Journal head, for reading history. NOT the resume cursor. */
  readonly lastSeq: number;
  /** This player's dense delivery head (ADR 0010). THE resume cursor. */
  readonly lastDeliverySeq: number;
  readonly lines: readonly JournalLine[];
  /** `seq -> mark`. Applied at read time by `journalLines()`. */
  readonly revocations: Readonly<Record<number, RevokedMark>>;
  readonly presence: readonly PresenceMember[];
  readonly narrations: Readonly<Record<string, NarrationStream>>;
  /** Verbatim `s2c.turn_proof` payloads, keyed by turn. */
  readonly proofs: Readonly<Record<string, StoredProof>>;
  /** REPLIÉ PAR DÉFAUT : empty until a player opens one. */
  readonly openProofs: readonly string[];
  /** Turns whose `c2s.why` is in flight, so one click never sends twice. */
  readonly pendingProofs: readonly string[];
  readonly lastRejection: Rejection | null;
  /** Frames that did not parse. Observable, because silence is not a report. */
  readonly malformedFrames: number;
  /** How many times the client asked the server to repeat itself. */
  readonly resyncRequests: number;

  readonly receive: (raw: unknown) => void;
  readonly setStatus: (status: ConnectionStatus) => void;
  readonly hello: () => void;
  readonly toggleProof: (correlationId: string) => void;
  readonly requestResume: () => void;
}

export interface TableStoreDeps {
  /** Puts a frame on the wire. Injected, so a test reads what was sent. */
  readonly send: (frame: C2SMessage) => void;
  /** Mints the envelope `id`. Injected: a store does not own randomness. */
  readonly newId: () => string;
  readonly clientVersion: string;
}

const EMPTY: Omit<
  TableState,
  'receive' | 'setStatus' | 'hello' | 'toggleProof' | 'requestResume' | 'status' | 'welcome'
> = {
  table: null,
  lastSeq: 0,
  lastDeliverySeq: 0,
  lines: [],
  revocations: {},
  presence: [],
  narrations: {},
  proofs: {},
  openProofs: [],
  pendingProofs: [],
  lastRejection: null,
  malformedFrames: 0,
  resyncRequests: 0,
};

/**
 * The lines a screen shows, with revocations applied. A SELECTOR, not a stored
 * field: a line struck by a `system.reverted` that arrived before it still
 * comes out struck, and nothing is ever removed from `lines` to make it so.
 */
export function journalLines(state: Pick<TableState, 'lines' | 'revocations'>): JournalLine[] {
  return state.lines.map((line) => {
    const mark = state.revocations[line.seq];
    return mark === undefined ? line : { ...line, revoked: mark };
  });
}

/** Whether a turn is struck. Used by « Pourquoi ? », which survives the strike. */
export function turnRevocation(
  state: Pick<TableState, 'lines' | 'revocations'>,
  correlationId: string,
): RevokedMark | null {
  for (const line of state.lines) {
    if (line.correlationId !== correlationId) continue;
    const mark = state.revocations[line.seq];
    if (mark !== undefined) return mark;
  }
  return null;
}

export function createTableStore(deps: TableStoreDeps): StoreApi<TableState> {
  return createStore<TableState>()((set, get) => {
    const emit = (frame: C2SMessage): void => {
      deps.send(frame);
    };

    const requestResume = (): void => {
      set((state) => ({ resyncRequests: state.resyncRequests + 1 }));
      emit({
        v: 1,
        t: 'c2s.resume',
        id: deps.newId(),
        p: { sinceDeliverySeq: get().lastDeliverySeq },
      });
    };

    /** Applies one delivered event. Ignores a delivery already applied. */
    const applyEvent = (seq: number, deliverySeq: number, event: GameEvent): void => {
      set((state) => {
        if (state.lines.some((line) => line.deliverySeq === deliverySeq)) return {};

        // SORTED, NOT APPENDED. Arrival order is not reading order: a
        // catch-up batch lands after live events that are already ahead of it.
        const lines = [...state.lines, lineOfEvent(event, deliverySeq)].sort(
          (a, b) => a.deliverySeq - b.deliverySeq,
        );

        const revocations =
          event.type === 'system.reverted'
            ? {
                ...state.revocations,
                ...Object.fromEntries(
                  event.payload.targetSeqs.map((target) => [
                    target,
                    { bySeq: event.seq, reason: event.payload.reason },
                  ]),
                ),
              }
            : state.revocations;

        return {
          lines,
          revocations,
          lastSeq: Math.max(state.lastSeq, seq),
          lastDeliverySeq: Math.max(state.lastDeliverySeq, deliverySeq),
        };
      });
    };

    const handle = (frame: S2CMessage): void => {
      switch (frame.t) {
        case 's2c.welcome':
          set({
            welcome: {
              playerId: frame.p.playerId,
              campaignId: frame.p.campaignId,
              characterId: frame.p.you.characterId,
              contentVersion: frame.p.contentVersion,
            },
            lastSeq: frame.p.lastSeq,
            lastDeliverySeq: frame.p.lastDeliverySeq,
          });
          return;

        case 's2c.snapshot':
          // ÉCRASEMENT INTÉGRAL. Everything derived from events goes; only the
          // connection and the identity of the session survive.
          set({
            ...EMPTY,
            table: frame.p.state,
            lastSeq: frame.p.lastSeq,
            lastDeliverySeq: frame.p.lastDeliverySeq,
          });
          return;

        case 's2c.event': {
          const expected = get().lastDeliverySeq + 1;
          if (frame.deliverySeq > expected) requestResume();
          applyEvent(frame.seq, frame.deliverySeq, frame.p.event);
          return;
        }

        case 's2c.events_batch': {
          // THE HOLE IS CHECKED ON THE BATCH TOO, on its FIRST entry. A batch
          // is by construction the answer to a `c2s.resume`
          // (01-architecture.md section 6), but an answer that starts PAST the
          // cursor means the deliveries in between are gone, and saying
          // nothing would leave a hole no one ever notices. Asking once is
          // enough and cannot live-lock: the entries are applied right after,
          // so the cursor has moved by the time the server repeats itself —
          // `store.test.ts` measures that second batch asks for nothing.
          const first = frame.p.events[0];
          if (first !== undefined && first.deliverySeq > get().lastDeliverySeq + 1) {
            requestResume();
          }
          for (const entry of frame.p.events) {
            applyEvent(entry.seq, entry.deliverySeq, entry.event);
          }
          return;
        }

        case 's2c.presence':
          set({ presence: frame.p.members });
          return;

        case 's2c.narration_started':
          set((state) => ({
            narrations: {
              ...state.narrations,
              [frame.p.narrationId]: {
                narrationId: frame.p.narrationId,
                eventSeq: frame.p.eventSeq,
                text: '',
                status: 'streaming',
              },
            },
          }));
          return;

        case 's2c.narration_delta':
          set((state) => {
            const current = state.narrations[frame.p.narrationId];
            if (current === undefined) return {};
            return {
              narrations: {
                ...state.narrations,
                [frame.p.narrationId]: { ...current, text: current.text + frame.p.text },
              },
            };
          });
          return;

        case 's2c.narration_snapshot':
          set((state) => {
            const current = state.narrations[frame.p.narrationId];
            return {
              narrations: {
                ...state.narrations,
                [frame.p.narrationId]: {
                  narrationId: frame.p.narrationId,
                  eventSeq: current?.eventSeq ?? 0,
                  text: frame.p.text,
                  status: frame.p.status,
                },
              },
            };
          });
          return;

        case 's2c.narration_done':
          set((state) => ({
            narrations: {
              ...state.narrations,
              [frame.p.narrationId]: {
                narrationId: frame.p.narrationId,
                eventSeq: frame.p.eventSeq,
                text: frame.p.text,
                status: 'done',
              },
            },
          }));
          return;

        case 's2c.narration_error':
          set((state) => {
            const current = state.narrations[frame.p.narrationId];
            if (current === undefined) return {};
            return {
              narrations: {
                ...state.narrations,
                [frame.p.narrationId]: { ...current, status: 'failed' },
              },
            };
          });
          return;

        case 's2c.turn_proof':
          set((state) => ({
            proofs: {
              ...state.proofs,
              [frame.p.correlationId]: { proof: frame.p.proof, truncated: frame.p.truncated },
            },
            pendingProofs: state.pendingProofs.filter((id) => id !== frame.p.correlationId),
          }));
          return;

        case 's2c.rejected':
          set({ lastRejection: { intentId: frame.p.intentId, code: frame.p.code } });
          return;

        case 's2c.ping':
          emit({ v: 1, t: 'c2s.pong', id: deps.newId(), p: {} });
          return;

        case 's2c.resync_required':
          set({ ...EMPTY });
          emit({
            v: 1,
            t: 'c2s.hello',
            id: deps.newId(),
            p: { clientVersion: deps.clientVersion, lastDeliverySeq: null },
          });
          set((state) => ({ resyncRequests: state.resyncRequests + 1 }));
          return;

        case 's2c.error':
          return;
      }
    };

    return {
      status: 'idle',
      welcome: null,
      ...EMPTY,

      receive: (raw: unknown): void => {
        const parsed = zS2CEnvelope.safeParse(raw);
        if (!parsed.success) {
          // NI EXCEPTION NI ÉTAT MODIFIÉ. The frame is counted and the server
          // is asked to repeat itself from the last delivery we did understand.
          set((state) => ({ malformedFrames: state.malformedFrames + 1 }));
          requestResume();
          return;
        }
        handle(parsed.data);
      },

      setStatus: (status: ConnectionStatus): void => {
        set({ status });
      },

      hello: (): void => {
        const cursor = get().lastDeliverySeq;
        emit({
          v: 1,
          t: 'c2s.hello',
          id: deps.newId(),
          p: { clientVersion: deps.clientVersion, lastDeliverySeq: cursor === 0 ? null : cursor },
        });
      },

      requestResume,

      /**
       * Opens or closes « Pourquoi ? ». EXACTLY ONE `c2s.why` per opening, and
       * none at all for a proof already in hand or already asked for — a
       * double click must not cost two reads.
       */
      toggleProof: (correlationId: string): void => {
        const state = get();
        if (state.openProofs.includes(correlationId)) {
          set({ openProofs: state.openProofs.filter((id) => id !== correlationId) });
          return;
        }
        set({ openProofs: [...state.openProofs, correlationId] });
        if (state.proofs[correlationId] !== undefined) return;
        if (state.pendingProofs.includes(correlationId)) return;
        set({ pendingProofs: [...state.pendingProofs, correlationId] });
        emit({ v: 1, t: 'c2s.why', id: deps.newId(), p: { correlationId } });
      },
    };
  });
}
