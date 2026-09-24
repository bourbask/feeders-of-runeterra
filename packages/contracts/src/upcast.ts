/**
 * Payload upcasters (03-donnees.md section 3.8).
 *
 * `payloadVersion` lets a payload shape change WITHOUT EVER REWRITING THE
 * JOURNAL. A campaign started in 2026 must still load in 2028, and rewriting
 * an append-only log to make it load would defeat the only thing an
 * append-only log is for (invariant 4).
 *
 * THREE RULES, and they are the whole contract:
 *
 *   1. AN UPCASTER IS PURE. It takes a payload, returns a payload. No clock,
 *      no randomness, no I/O, no lookup of anything current. Two runs on the
 *      same input give the same bytes.
 *   2. AN UPCASTER IS TESTED by a golden case holding the payload at the OLD
 *      version. A ten-line function per change is the price of invariant 4.
 *   3. AN UPCASTER IS NEVER DELETED. Not when the version is old, not when no
 *      campaign seems to use it. There is no way to know that from here.
 *
 * The table is empty today because `EVENT_SCHEMA_VERSION` is 1 and nothing has
 * shipped a second version yet. `upcast()` is written and tested anyway: the
 * first person who needs it should find a working chain, not a TODO. The
 * example the spec gives — `roll.action_resolved` version 1 gaining
 * `cappedAtTen` and `rawTotal` — is the shape a future entry takes.
 *
 * DECLARED DIVERGENCE FROM 03-donnees.md §3.7, read this before writing the
 * replay loop. The spec sketches the loop as:
 *
 *     state = reduce(state, GameEventSchema.parse(upcast(ev)));
 *
 * — that is, `upcast()` returning an EVENT, parsable as it stands. This
 * implementation returns an `UpcastResult { payload, payloadVersion, steps }`
 * instead, so `zGameEvent.parse(upcast(ev))` WOULD FAIL if written to the
 * letter. The real call is:
 *
 *     const { payload, payloadVersion } = upcast(ev);
 *     state = reduce(state, zGameEvent.parse({ ...ev, payload, payloadVersion }));
 *
 * The shape was chosen because `steps` is what a migration log needs and
 * because a gap must stop the loader loudly (`UpcastGapError`) rather than
 * arrive as an unparsable event — §3.8 gives only pseudo-code, so nothing is
 * contradicted. M0-11 and M0-12 carry the cost of the adaptation, which is
 * why it is written here rather than left to be discovered. The spec is NOT
 * edited by this task: an ADR is proposed to the lead instead.
 */

import type { GameEventType } from '@for/engine';

import { EVENT_SCHEMA_VERSION } from './version.js';

/** Pure. Takes the payload at version `n`, returns it at version `n + 1`. */
export type Upcaster = (payload: unknown) => unknown;

/** Event type -> source version -> the step that brings it to the next one. */
export type UpcasterTable = Readonly<
  Partial<Record<GameEventType, Readonly<Record<number, Upcaster>>>>
>;

/**
 * The chain. Keyed by the version the payload IS AT, not the one it becomes:
 * `UPCASTERS['roll.action_resolved'][1]` turns a version-1 payload into a
 * version-2 one.
 */
export const UPCASTERS: UpcasterTable = {};

/** A journal row as it comes out of the database, before validation. */
export interface RawEventRow {
  readonly type: string;
  readonly payloadVersion: number;
  readonly payload: unknown;
}

/** What an upcast produced: the payload, and the version it now is at. */
export interface UpcastResult {
  readonly payload: unknown;
  readonly payloadVersion: number;
  /** How many steps ran. Zero means the row was already current. */
  readonly steps: number;
}

/**
 * Thrown when a row is at a version this build cannot reach — either a gap in
 * the chain, or a payload written by a NEWER build than the one reading it.
 *
 * It throws rather than returning a `Result` because it is not a game outcome:
 * it means the deployment is wrong, and the loader must stop loudly rather
 * than replay a campaign with half its history misread.
 */
export class UpcastGapError extends Error {
  constructor(
    readonly eventType: string,
    readonly fromVersion: number,
    readonly targetVersion: number,
  ) {
    super(
      `aucun upcaster pour ${eventType} v${String(fromVersion)} (cible v${String(targetVersion)})`,
    );
    this.name = 'UpcastGapError';
  }
}

/**
 * Applies the chain until the payload reaches `EVENT_SCHEMA_VERSION`.
 *
 * A row already at the current version comes back untouched, with `steps: 0` —
 * the common case, and it must cost nothing.
 */
export function upcast(row: RawEventRow, table: UpcasterTable = UPCASTERS): UpcastResult {
  const target = EVENT_SCHEMA_VERSION;

  if (row.payloadVersion > target) {
    throw new UpcastGapError(row.type, row.payloadVersion, target);
  }

  let payload = row.payload;
  let version = row.payloadVersion;
  let steps = 0;

  while (version < target) {
    const step = table[row.type as GameEventType]?.[version];
    if (step === undefined) {
      throw new UpcastGapError(row.type, version, target);
    }
    payload = step(payload);
    version += 1;
    steps += 1;
  }

  return { payload, payloadVersion: version, steps };
}
