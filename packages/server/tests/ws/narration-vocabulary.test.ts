/**
 * THE TWO NARRATION ENUMS, COMPARED MEMBER BY MEMBER — what `z.output<…>`
 * does NOT do.
 *
 * `connection.ts` exports `NarrationErrorCode` and `NarrationStatus` as
 * `z.output<typeof zNarration…>`. That is an ALIAS, not a mirror: the alias
 * NARROWS with the schema, so a member removed in `@for/contracts` leaves
 * every call site that does not spell it out perfectly green. Measured on this
 * branch, before this file existed:
 *
 *   - `aborted` removed from `zNarrationStatus` — `pnpm typecheck` 0 (17/17),
 *     `pnpm typecheck:tests` 0 (17/17), `vitest run tests/ws` 0;
 *   - `action_impossible` removed from `zNarrationErrorCode` — the same three
 *     zeroes;
 *   - `aborted` removed from `zNarrationErrorCode` — `pnpm typecheck` 1,
 *     `TS2345`, and only because `handlers.ts` writes that one member as a
 *     literal.
 *
 * It is the fourth mode of ADR 0007 — an enum narrowing in silence — and the
 * rule that ADR draws is the one applied here: A MIRROR IS ONLY GUARDED BY A
 * RUNTIME TEST THAT COMPARES THE TWO LISTS MEMBER BY MEMBER.
 *
 * THE TWO LISTS COME FROM TWO PLACES, which is the whole point — a list read
 * back from the schema it is meant to guard would be a number compared to
 * itself. The schema side is `.options`; the other side is written out in full
 * from the specs:
 *
 *   - the five error codes: `docs/design/01-architecture.md` §5.4, the
 *     `s2c.narration_error` row;
 *   - the narration statuses: `docs/design/02-mj-ia.md` §6.3 lists FIVE for
 *     the server, and the wire carries four of them — `finalizing` is the
 *     server's own in-flight status and never leaves the process.
 *
 * An enum's ORDER carries nothing here, so both sides are sorted and the exact
 * array is asserted. What is guarded is membership, in both directions: remove
 * a member from a schema and the runtime assertion falls (and, for the members
 * the tuples pin, `satisfies` falls at `pnpm typecheck:tests` too); add one and
 * the runtime assertion falls.
 */

import { zNarrationErrorCode, zNarrationStatus } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import type { NarrationErrorCode, NarrationStatus } from '../../src/ws/connection.js';

/**
 * `01-architecture.md` §5.4, the `s2c.narration_error` row, written out in
 * full. The `satisfies` is the compile-time half: a member that disappears
 * from the schema stops being assignable and `pnpm typecheck:tests` fails.
 */
const SPEC_NARRATION_ERROR_CODES = [
  'rate_limited',
  'refused',
  'engine_fallback',
  'aborted',
  'action_impossible',
] as const satisfies readonly NarrationErrorCode[];

/** `02-mj-ia.md` §6.3 — the five statuses a narration can stand in, server side. */
const SPEC_SERVER_NARRATION_STATUSES = [
  'streaming',
  'finalizing',
  'done',
  'aborted',
  'failed',
] as const;

/** The server's own in-flight status. It is not a wire word. */
const SERVER_ONLY_STATUS = 'finalizing';

/** The four of §6.3 that `s2c.narration_snapshot` may carry. */
const SPEC_WIRE_NARRATION_STATUSES = [
  'streaming',
  'done',
  'aborted',
  'failed',
] as const satisfies readonly NarrationStatus[];

const sorted = (values: readonly string[]): readonly string[] => [...values].sort();

describe('le vocabulaire de narration que `connection.ts` réexporte', () => {
  it("les codes d'erreur de narration sont ceux que la §5.4 écrit, membre à membre", () => {
    expect(sorted(zNarrationErrorCode.options)).toStrictEqual(sorted(SPEC_NARRATION_ERROR_CODES));
  });

  it('les statuts de narration du fil sont ceux de la §6.3, moins `finalizing`', () => {
    expect(sorted(zNarrationStatus.options)).toStrictEqual(sorted(SPEC_WIRE_NARRATION_STATUSES));
    expect(zNarrationStatus.options).not.toContain(SERVER_ONLY_STATUS);
    expect(sorted([...SPEC_WIRE_NARRATION_STATUSES, SERVER_ONLY_STATUS])).toStrictEqual(
      sorted(SPEC_SERVER_NARRATION_STATUSES),
    );
  });
});
