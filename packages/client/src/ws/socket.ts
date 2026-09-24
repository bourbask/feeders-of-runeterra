/**
 * The socket: connect, survive a cut, come back where we left off
 * (01-architecture.md section 5, ADR 0010).
 *
 * EVERYTHING THAT VARIES IS INJECTED — the way a socket is opened, the way a
 * delay is scheduled. Not for elegance: a reconnection test that waits real
 * seconds is a test nobody runs, and a backoff nobody measures is a backoff
 * that hammers the server.
 *
 * NOT EVERY CLOSE DESERVES A RETRY. Four of the eight close codes say the
 * connection will never succeed as it stands — wrong protocol version, not
 * signed in, not a member, no such table — and retrying them turns a clear
 * refusal into an infinite loop against a server that is working correctly.
 * The split is written against `WS_CLOSE_REASONS` from `@for/contracts`, and
 * `socket.test.ts` demands the two halves cover it exactly: a close code added
 * upstream must be classified, not silently retried.
 *
 * THE RESUME CURSOR IS `deliverySeq`, never `seq`. See `ws/store.ts`.
 */

import type { WsCloseReason } from '@for/contracts';
import { WS_CLOSE_CODES, WS_CLOSE_REASONS } from '@for/contracts';

/** First wait after a drop. Short enough that a blip is invisible. */
export const RECONNECT_BASE_MS = 500;
/** Ceiling. A server that is down does not need a client knocking every second. */
export const RECONNECT_MAX_MS = 30_000;

/** Closes after which reconnecting cannot work. Typed: a typo does not compile. */
export const FATAL_CLOSE_REASONS = [
  'protocol_version',
  'unauthenticated',
  'forbidden_campaign',
  'campaign_not_found',
] as const satisfies readonly WsCloseReason[];

/** Closes that are worth waiting out. */
export const RETRYABLE_CLOSE_REASONS = [
  'rate_limited',
  'payload_too_large',
  'server_shutdown',
  'campaign_rebuilding',
] as const satisfies readonly WsCloseReason[];

const FATAL_CODES: readonly number[] = FATAL_CLOSE_REASONS.map((reason) => WS_CLOSE_CODES[reason]);

/** `500, 1000, 2000, …` capped at 30 s. Exponential, and bounded. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
}

/** A close the client must not retry. */
export function isFatalClose(code: number): boolean {
  return FATAL_CODES.includes(code);
}

/** The slice of `WebSocket` this module uses. Narrow, so a fake is honest. */
export interface SocketLike {
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
}

export interface SocketDeps {
  readonly url: string;
  readonly open: (url: string) => SocketLike;
  readonly schedule: (run: () => void, delayMs: number) => void;
  /** Raw JSON, already decoded. The store does the validating, not this file. */
  readonly onFrame: (raw: unknown) => void;
  readonly onStatus: (status: 'connecting' | 'open' | 'closed') => void;
  /** Sent on every open, including after a reconnection. */
  readonly onOpen: (send: (frame: unknown) => void) => void;
}

export interface SocketHandle {
  readonly send: (frame: unknown) => void;
  readonly close: () => void;
  readonly attempts: () => number;
}

export function connect(deps: SocketDeps): SocketHandle {
  let socket: SocketLike | null = null;
  let attempts = 0;
  let stopped = false;

  const send = (frame: unknown): void => {
    socket?.send(JSON.stringify(frame));
  };

  const openOnce = (): void => {
    if (stopped) return;
    deps.onStatus('connecting');
    const next = deps.open(deps.url);
    socket = next;

    next.onopen = (): void => {
      attempts = 0;
      deps.onStatus('open');
      deps.onOpen(send);
    };

    next.onmessage = (event: { data: string }): void => {
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        // Not even JSON. Hand it to the store anyway: refusing a frame is the
        // store's job, and it counts what it refused.
        raw = event.data;
      }
      deps.onFrame(raw);
    };

    next.onclose = (event: { code: number }): void => {
      socket = null;
      deps.onStatus('closed');
      if (stopped || isFatalClose(event.code)) return;
      const delay = backoffDelayMs(attempts);
      attempts += 1;
      deps.schedule(openOnce, delay);
    };

    next.onerror = (): void => {
      // A browser fires `error` then `close`; the retry belongs to `close`
      // alone, or one drop would schedule two reconnections.
    };
  };

  openOnce();

  return {
    send,
    close: (): void => {
      stopped = true;
      socket?.close();
    },
    attempts: () => attempts,
  };
}

/** Exported for the test that demands the two halves cover the whole list. */
export const ALL_CLOSE_REASONS: readonly WsCloseReason[] = WS_CLOSE_REASONS;

/**
 * The browser's `WebSocket`, narrowed to `SocketLike`. The adapter exists
 * because the DOM's handler signatures take an event this module never reads;
 * wrapping them here keeps the fake in the tests honest — it implements the
 * four handlers and nothing more.
 */
export function openBrowserSocket(url: string): SocketLike {
  const raw = new WebSocket(url);
  const adapter: SocketLike = {
    send: (data: string) => {
      raw.send(data);
    },
    close: () => {
      raw.close();
    },
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
  };
  raw.addEventListener('open', () => adapter.onopen?.());
  raw.addEventListener('close', (event) => adapter.onclose?.({ code: event.code }));
  raw.addEventListener('message', (event) => {
    adapter.onmessage?.({ data: String((event as MessageEvent<unknown>).data) });
  });
  raw.addEventListener('error', () => adapter.onerror?.());
  return adapter;
}
