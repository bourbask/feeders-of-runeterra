/**
 * `NarrationBroadcast` — one generation, many readers (02-mj-ia.md section 6).
 *
 * One call to the port per turn for the whole table. Players never consume a
 * provider's stream; they consume a buffer this process holds, in fragments,
 * with a snapshot for whoever arrives mid-generation.
 *
 * ── THE `<scene_apres>` BLOCK NEVER GETS OUT ──────────────────────────────
 * Section 6.2: the dispatcher HOLDS BACK the last `len("<scene_apres>")`
 * characters while they could still be the beginning of the opening tag; the
 * moment the tag completes it STOPS EMITTING and swallows the rest. What
 * follows is parsed (section 2.3) and never broadcast, never persisted in
 * `narration.gm_message.text`.
 *
 * Both halves are measured, because only one of them is obvious. That nothing
 * emitted carries the tag: `tests/ai/broadcast.test.ts`, « aucun fragment ne
 * porte la balise, même coupée en deux ». That the withheld prefix is not
 * LOST when the tag never comes: « et ce qui ressemblait à la balise sans
 * l'être finit par sortir » — a dispatcher that dropped its reserve would eat
 * the last twelve characters of every scene that ends on a « < ».
 *
 * ── TWO COUNTERS, AND THEY ARE NOT THE SAME ONE ───────────────────────────
 * `seq` is the journal's clock and lives on `s2c.event` alone. `chunk` is a
 * fragment number inside one narration, and it exists only for the catch-up:
 * the BUFFER is the truth, `chunk` is how a client says how far it got
 * (ARCHITECTURE.md section 4.4). `narrationId` derives from the `eventSeq`
 * that opened the turn, which is what makes a generation idempotent by
 * construction — a reconnection, a reload or a second tab cannot open a second
 * one.
 *
 * ── COALESCENCE WITHOUT A TIMER ───────────────────────────────────────────
 * Section 6.2 asks for 50 ms windows. The window is driven by the CALLER'S
 * clock through `pump(now)`, not by `setInterval`: a test that had to wait
 * real milliseconds would be a slow test measuring the event loop, and the
 * server already carries an injected `TimeSource` for exactly this. Held by
 * `tests/ai/broadcast.test.ts`, « coalesce en fenêtres de 50 ms, et n'émet
 * pas un message par jeton ».
 *
 * ── WHAT IT IS NOT ────────────────────────────────────────────────────────
 * It decides nothing, rolls nothing and writes nothing to the journal. It
 * holds text and hands it to sockets.
 */

import { SCENE_OPEN_TAG } from '@for/ai';

import type { z } from 'zod';

import type { zNarrationErrorCode, zNarrationStatus } from '@for/contracts';

/**
 * The two protocol enumerations, as TYPES.
 *
 * `@for/contracts` exports the schemas and not the types — `connection.ts`
 * derives its own the same way, and deriving is the point: a type written by
 * hand beside a schema is the mirror ADR 0007 is about. Two derivations of one
 * schema agree by construction.
 */
export type NarrationStatus = z.output<typeof zNarrationStatus>;
export type NarrationErrorCode = z.output<typeof zNarrationErrorCode>;

/** Section 6.2: one message per 50 ms at worst, not one per token. */
export const NARRATION_COALESCE_MS = 50;

/** Section 6.3: the buffer outlives `s2c.narration_done` by five minutes. */
export const NARRATION_BUFFER_TTL_MS = 5 * 60_000;

// ------------------------------------------------------------- the payloads

/**
 * The five narration payloads of section 6.2.
 *
 * Declared here rather than inferred from `@for/contracts`, and pinned
 * against it at run time: `tests/ai/broadcast.test.ts`, « chaque charge émise
 * est acceptée par le schéma du protocole », wraps every frame this module
 * produces in an envelope and parses it with `zS2CNarration*`. A shape that
 * drifted from the protocol would redden there rather than on a socket.
 */
export interface NarrationStartedPayload {
  readonly narrationId: string;
  readonly eventSeq: number;
  readonly actorCharacterId: string | null;
  /** Literally 0: section 5.4 pins the value, and the stream opens here. */
  readonly chunk: 0;
}

export interface NarrationDeltaPayload {
  readonly narrationId: string;
  readonly chunk: number;
  readonly text: string;
}

export interface NarrationSnapshotPayload {
  readonly narrationId: string;
  readonly chunk: number;
  readonly text: string;
  readonly status: NarrationStatus;
}

export interface NarrationDonePayload {
  readonly narrationId: string;
  readonly eventSeq: number;
  readonly text: string;
  readonly model: string;
  readonly source: 'ai' | 'engine';
}

export interface NarrationErrorPayload {
  readonly narrationId: string;
  readonly code: NarrationErrorCode;
}

/**
 * One socket, from this module's point of view.
 *
 * A REPORTED GAP, and it is why this is an interface rather than a call on
 * `TableConnection`: that class ships `sendNarrationSnapshot` and
 * `sendNarrationError` (M0-25) and NOTHING for `started`, `delta` or `done` —
 * the three frames a generation actually emits. `packages/server/src/ws/` is
 * not this task's to reopen (the sheet's file list), so the seam is declared
 * here and the three methods land on `TableConnection` with the wiring, in
 * M0-30. Nothing below assumes anything about the transport.
 */
export interface NarrationSink {
  readonly playerId: string;
  started(payload: NarrationStartedPayload): void;
  delta(payload: NarrationDeltaPayload): void;
  snapshot(payload: NarrationSnapshotPayload): void;
  done(payload: NarrationDonePayload): void;
  error(payload: NarrationErrorPayload): void;
}

/**
 * Who a narration is for — ADR 0008, carried by `NarrationBrief.audience`.
 *
 * `recipients` is null exactly at table scope. THE FILTER IS APPLIED HERE for
 * the narration channel, for the same reason the hub applies it to
 * `s2c.event`: the intent path hands its events over unfiltered, so the layer
 * that owns the sockets is the one that must answer "who may see this". Latent
 * in M0 — the engine only ever writes `('table', null)` — real in M1.
 */
export interface NarrationAudience {
  readonly scope: 'table' | 'subset' | 'private';
  readonly recipients: readonly string[] | null;
}

export const TABLE_AUDIENCE: NarrationAudience = { scope: 'table', recipients: null };

/**
 * ONE READING OF THE SCOPE on this path, exactly as `hub.isVisibleTo` is the
 * one reading on the event path. Two expressions of one rule, said out loud
 * rather than promised: nothing here compares itself to the hub's.
 *
 * The default of the two addressed scopes is REFUSAL — an absent or empty
 * recipient list reaches nobody. Held by `tests/ai/broadcast.test.ts`, « une
 * narration `private` ne part qu'aux destinataires, et une liste vide ne part
 * à personne ».
 */
export function narrationVisibleTo(audience: NarrationAudience, playerId: string): boolean {
  switch (audience.scope) {
    case 'table':
      return true;
    case 'subset':
    case 'private':
      return audience.recipients?.includes(playerId) ?? false;
  }
}

// ------------------------------------------------------- withholding the tag

/**
 * How many characters at the end of `text` could still be the beginning of
 * the opening tag.
 *
 * The answer is a LENGTH and not a boolean because the dispatcher has to keep
 * exactly that many back and emit the rest. A model that writes « … le vent <
 * » ends the turn with one withheld character, which comes out with the next
 * fragment or at the end of the stream.
 */
export function withheldSuffixLength(text: string): number {
  const max = Math.min(text.length, SCENE_OPEN_TAG.length - 1);
  for (let size = max; size > 0; size -= 1) {
    if (text.endsWith(SCENE_OPEN_TAG.slice(0, size))) return size;
  }
  return 0;
}

// ---------------------------------------------------------------- the buffer

interface Subscriber {
  readonly sink: NarrationSink;
}

/**
 * One turn's stream: the text, the fragment number, the status, the readers.
 *
 * `raw` is EVERYTHING the model produced, block included — that is what
 * `readNarration` parses. `emitted` is what players got, which stops before
 * the tag. Two fields because they are two different truths, and a single one
 * would have to be either broadcast with the block in it or parsed without it.
 */
export class NarrationBroadcast {
  readonly narrationId: string;

  readonly eventSeq: number;

  readonly actorCharacterId: string | null;

  readonly audience: NarrationAudience;

  private status: NarrationStatus = 'streaming';

  /** Everything the model produced, tag and block included. */
  private raw = '';

  /** What players have received, or are about to. Never carries the tag. */
  private emitted = '';

  /** Emitted-but-not-yet-flushed text, waiting for the 50 ms window. */
  private queued = '';

  /** Held back because it could still be the start of the tag. */
  private reserve = '';

  /** True once the opening tag has been seen: nothing more is emitted. */
  private sealed = false;

  private chunk = 0;

  private lastFlushAt: number;

  private doneAt: number | null = null;

  private readonly subscribers = new Set<Subscriber>();

  constructor(input: {
    readonly narrationId: string;
    readonly eventSeq: number;
    readonly actorCharacterId: string | null;
    readonly audience: NarrationAudience;
    readonly now: number;
  }) {
    this.narrationId = input.narrationId;
    this.eventSeq = input.eventSeq;
    this.actorCharacterId = input.actorCharacterId;
    this.audience = input.audience;
    this.lastFlushAt = input.now;
  }

  // ------------------------------------------------------------- the readers

  /**
   * A socket joins. Section 6.3: mid-generation it gets the WHOLE buffer at
   * once, then the deltas from `chunk + 1`; a finished one gets the final
   * snapshot. No second generation is ever started, here or anywhere.
   */
  subscribe(sink: NarrationSink): void {
    if (!narrationVisibleTo(this.audience, sink.playerId)) return;
    this.subscribers.add({ sink });
    sink.snapshot({
      narrationId: this.narrationId,
      chunk: this.chunk,
      text: this.emitted,
      status: this.status,
    });
  }

  unsubscribe(sink: NarrationSink): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.sink === sink) this.subscribers.delete(subscriber);
    }
  }

  private toAll(write: (sink: NarrationSink) => void): void {
    for (const subscriber of this.subscribers) write(subscriber.sink);
  }

  // ------------------------------------------------------------- the writing

  /** Before the first token. `chunk` is literally 0 (section 5.4). */
  open(): void {
    this.toAll((sink) => {
      sink.started({
        narrationId: this.narrationId,
        eventSeq: this.eventSeq,
        actorCharacterId: this.actorCharacterId,
        chunk: 0,
      });
    });
  }

  /**
   * One `delta` from the port.
   *
   * Nothing is written to a socket here: the text joins the queue and waits
   * for `pump`. That is what makes the coalescing a property of the module
   * rather than of the provider's chunk size.
   */
  push(text: string): void {
    this.raw += text;
    if (this.sealed) return;

    const pending = this.reserve + text;
    const at = pending.indexOf(SCENE_OPEN_TAG);
    if (at >= 0) {
      // The tag is complete. Everything before it is prose; everything from
      // it on is the block, and the block never leaves the server.
      this.accept(pending.slice(0, at));
      this.reserve = '';
      this.sealed = true;
      return;
    }

    const held = withheldSuffixLength(pending);
    this.accept(pending.slice(0, pending.length - held));
    this.reserve = held === 0 ? '' : pending.slice(pending.length - held);
  }

  private accept(text: string): void {
    if (text.length === 0) return;
    this.emitted += text;
    this.queued += text;
  }

  /**
   * Flush the queue if the 50 ms window has elapsed. Answers whether a frame
   * was written, so a caller can count them.
   */
  pump(now: number): boolean {
    if (this.queued.length === 0) return false;
    if (now - this.lastFlushAt < NARRATION_COALESCE_MS) return false;
    this.flush(now);
    return true;
  }

  /** Write whatever is queued, window or no window. */
  flush(now: number): void {
    if (this.queued.length === 0) return;
    this.chunk += 1;
    const text = this.queued;
    this.queued = '';
    this.lastFlushAt = now;
    this.toAll((sink) => {
      sink.delta({ narrationId: this.narrationId, chunk: this.chunk, text });
    });
  }

  // --------------------------------------------------------------- the close

  /**
   * The stream is over.
   *
   * The reserve comes out HERE, and that is the half nobody thinks of: a
   * narration ending on « < » withheld one character that no later delta will
   * ever release. Sealed streams keep it — those characters are the tag.
   */
  seal(now: number): void {
    if (!this.sealed && this.reserve.length > 0) {
      this.accept(this.reserve);
      this.reserve = '';
    }
    this.flush(now);
  }

  /**
   * Section 6.4: `s2c.narration_done` is emitted only once
   * `narration.gm_message` is committed, so a client may treat it as the
   * point of truth. This class does not commit anything — the caller does, and
   * then calls this.
   */
  complete(payload: Omit<NarrationDonePayload, 'narrationId'>, now: number): void {
    this.seal(now);
    this.status = 'done';
    this.doneAt = now;
    this.toAll((sink) => {
      sink.done({ ...payload, narrationId: this.narrationId });
    });
  }

  /**
   * `s2c.narration_error`. It does NOT close the stream on its own: section
   * 6.2 emits `action_impossible` AFTER `s2c.narration_done`, because the
   * prose is valid and must be shown — it is the TURN that is cancelled.
   */
  fail(code: NarrationErrorCode, now: number, status?: 'failed' | 'aborted'): void {
    if (status !== undefined) {
      this.status = status;
      this.doneAt = now;
    }
    this.toAll((sink) => {
      sink.error({ narrationId: this.narrationId, code });
    });
  }

  // --------------------------------------------------------------- the reads

  /** Everything the model produced, block included. What `readNarration` parses. */
  rawText(): string {
    return this.raw;
  }

  /** What players received. Stops before the tag, always. */
  emittedText(): string {
    return this.emitted;
  }

  currentStatus(): NarrationStatus {
    return this.status;
  }

  currentChunk(): number {
    return this.chunk;
  }

  expiredAt(now: number): boolean {
    return this.doneAt !== null && now - this.doneAt >= NARRATION_BUFFER_TTL_MS;
  }

  snapshotPayload(): NarrationSnapshotPayload {
    return {
      narrationId: this.narrationId,
      chunk: this.chunk,
      text: this.emitted,
      status: this.status,
    };
  }
}

// ----------------------------------------------------------- the dispatcher

/**
 * One broadcast in flight per campaign — the `single-flight` of section 6.4.
 *
 * It bounds the NARRATION, not the game: the moteur keeps resolving and
 * broadcasting `s2c.event` while a text is being written. That distinction is
 * the reason this class holds no lock on anything but a string.
 */
export class NarrationDispatcher {
  private readonly live = new Map<string, NarrationBroadcast>();

  /** Sinks that joined before a generation started, by campaign. */
  private readonly waiting = new Map<string, Set<NarrationSink>>();

  /** `narrationId` derives from the `eventSeq` that opened the turn. */
  static narrationIdFor(campaignId: string, eventSeq: number): string {
    return `${campaignId}:${String(eventSeq)}`;
  }

  current(campaignId: string): NarrationBroadcast | undefined {
    return this.live.get(campaignId);
  }

  /**
   * Opens the turn's stream, or hands back the one already open for that very
   * turn.
   *
   * IDEMPOTENT ON `narrationId`, which is what section 6.4 means by "une
   * reconnexion, un rechargement de page, un second onglet ne déclenchent
   * jamais un second appel au port": the identifier is derived from the
   * journal sequence, so asking twice for the same turn answers the same
   * buffer.
   */
  open(input: {
    readonly campaignId: string;
    readonly eventSeq: number;
    readonly actorCharacterId: string | null;
    readonly audience: NarrationAudience;
    readonly now: number;
  }): NarrationBroadcast {
    const narrationId = NarrationDispatcher.narrationIdFor(input.campaignId, input.eventSeq);
    const existing = this.live.get(input.campaignId);
    if (existing?.narrationId === narrationId) return existing;

    const broadcast = new NarrationBroadcast({ ...input, narrationId });
    this.live.set(input.campaignId, broadcast);
    for (const sink of this.waiting.get(input.campaignId) ?? []) broadcast.subscribe(sink);
    broadcast.open();
    return broadcast;
  }

  /** A socket attaches to a campaign, generation in flight or not. */
  attach(campaignId: string, sink: NarrationSink): void {
    const set = this.waiting.get(campaignId) ?? new Set<NarrationSink>();
    set.add(sink);
    this.waiting.set(campaignId, set);
    this.live.get(campaignId)?.subscribe(sink);
  }

  detach(campaignId: string, sink: NarrationSink): void {
    this.waiting.get(campaignId)?.delete(sink);
    this.live.get(campaignId)?.unsubscribe(sink);
  }

  /** Section 6.3: buffers are freed five minutes after `narration_done`. */
  sweep(now: number): void {
    for (const [campaignId, broadcast] of [...this.live]) {
      if (broadcast.expiredAt(now)) this.live.delete(campaignId);
    }
  }

  /**
   * `c2s.resume_narration` — the `NarrationReplay` port of `ws/handlers.ts`.
   *
   * It REPLAYS, and it is incapable of doing anything else: there is no path
   * from here to the port. `null` means the buffer is gone, and the caller
   * answers `aborted`. A `narrationId` for another turn gets the current
   * snapshot rather than nothing — a client one turn behind needs the turn it
   * is on, not silence.
   *
   * `lastChunk` IS READ AND DELIBERATELY NOT USED, which is worth a line.
   * Section 6.3 offers two answers — the missing slice, or a full snapshot —
   * and the port M0-25 froze (`NarrationReplay` in `ws/handlers.ts`) has ONE
   * return shape, which `TableConnection` writes as
   * `s2c.narration_snapshot`. A sliced text sent in a snapshot frame would
   * tell the client "this is the whole buffer" about a fragment, and the
   * client would truncate its own text. So the answer is always the whole
   * buffer, which is always correct and sometimes larger than necessary. The
   * slice needs a `s2c.narration_delta` on the reply path; that is a protocol
   * change, not this task's.
   */
  replay(input: {
    readonly campaignId: string;
    readonly playerId: string;
    readonly narrationId: string;
    readonly lastChunk: number;
  }): Promise<NarrationSnapshotPayload | null> {
    const broadcast = this.live.get(input.campaignId);
    if (broadcast === undefined) return Promise.resolve(null);
    if (!narrationVisibleTo(broadcast.audience, input.playerId)) return Promise.resolve(null);
    return Promise.resolve(broadcast.snapshotPayload());
  }
}
