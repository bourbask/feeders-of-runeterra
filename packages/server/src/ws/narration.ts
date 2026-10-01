/**
 * The seam between the narration buffer (M0-29, `ai/broadcast.ts`) and a
 * socket (M0-25, `connection.ts`).
 *
 * `NarrationBroadcast` writes to a `NarrationSink`: five methods, a
 * `playerId`, and no idea what a WebSocket is. `TableConnection` writes
 * frames. This file is the ten lines that join them, and it is the whole of
 * what M0-29 called "the wiring, in M0-30".
 *
 * ══ THE FAKE'S SIGNATURE IS THE REAL ONE ══════════════════════════════════
 *
 * Every method below takes its payload WHOLE and hands it over WHOLE. That is
 * not style: TypeScript accepts a function declared with fewer parameters
 * than the one it replaces, so a sink written as `started: () => {…}` would
 * compile, drop the payload, and be invisible to every test that only counts
 * frames. `tests/ws/narration-frames.test.ts`, « le puits porte les cinq
 * méthodes du diffuseur, et chacune rend ce qu'elle a reçu », reads the BYTES
 * on the transport for each of the five and compares them to the payload the
 * broadcast emitted.
 */

import type {
  NarrationDeltaPayload,
  NarrationDonePayload,
  NarrationErrorPayload,
  NarrationSink,
  NarrationSnapshotPayload,
  NarrationStartedPayload,
} from '../ai/broadcast.js';
import type { TableConnection } from './connection.js';

/** One socket, seen as a reader of one campaign's narration stream. */
export function narrationSinkFor(connection: TableConnection): NarrationSink {
  return {
    playerId: connection.session.playerId,
    started: (payload: NarrationStartedPayload): void => {
      connection.sendNarrationStarted(payload);
    },
    delta: (payload: NarrationDeltaPayload): void => {
      connection.sendNarrationDelta(payload);
    },
    snapshot: (payload: NarrationSnapshotPayload): void => {
      connection.sendNarrationSnapshot(payload);
    },
    done: (payload: NarrationDonePayload): void => {
      connection.sendNarrationDone(payload);
    },
    error: (payload: NarrationErrorPayload): void => {
      connection.sendNarrationError(payload.narrationId, payload.code);
    },
  };
}
