/**
 * A clock that does not move.
 *
 * Nothing in a test may read the wall clock: two runs a millisecond apart
 * would serialise two different journals, and a golden corpus would never be
 * stable. `fixedClock` is the substitute handed to the injected time port.
 *
 * It moves on ONE condition: someone calls `advance()`. No timer, no read and
 * no amount of elapsed real time ever changes what `now()` returns — that is
 * the property `fixed.test.ts` proves. And `advance()` refuses a negative
 * duration: a clock that can go backwards lies as much as one that drifts.
 */

/**
 * ISO-8601 instant with an EXPLICIT timezone. Without one, `Date.parse` reads
 * local time, and the same test would then denote two different instants on two
 * machines. Fields are bounded here because `Date.parse` does NOT bound them:
 * `2024-02-31T00:00:00Z` parses happily, as March 2nd.
 *
 * The fraction runs to NINE digits and the offset is accepted in basic form
 * (`+0100`, `+01`) as well as extended (`+01:00`): `2024-01-01T00:00:00.123456Z`
 * is what SQLite and Postgres hand back for a microsecond timestamp column, and
 * M0-11 and M0-17 will read those straight into this constructor. Everything is
 * re-spelled canonically below before parsing, so nothing rests on the
 * implementation-defined half of `Date.parse`.
 */
const ISO_INSTANT =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?(?:[Zz]|([+-])([01]\d|2[0-3])(?::?([0-5]\d))?)$/;

export interface FixedClock {
  /** The instant, canonical ISO-8601 UTC (`2024-01-01T00:00:00.000Z`). */
  now(): string;
  /** The same instant, milliseconds since the epoch. */
  nowMs(): number;
  /** The ONLY thing that moves this clock. */
  advance(durationMs: number): void;
}

/**
 * @param iso an ISO-8601 instant carrying a timezone — `Z`, `+hh:mm`, `+hhmm`
 * or `+hh`. A local-time string is refused: it would read differently on a
 * machine in another timezone, which is exactly the bug this file exists to
 * prevent. Up to nine fractional digits are accepted; anything below the
 * MILLISECOND is TRUNCATED, as `Date.parse` does, because the clock counts in
 * milliseconds. The truncation is not hidden — `now()` returns the CANONICAL
 * three-decimal UTC form, so it is visible in the very first corpus, and two
 * spellings of the same moment serialise identically.
 */
export function fixedClock(iso: string): FixedClock {
  const champs = ISO_INSTANT.exec(iso);
  if (champs === null) {
    throw new RangeError(
      `fixedClock: expected an ISO-8601 instant with an explicit timezone ` +
        `(e.g. 2024-01-01T00:00:00.000Z), got ${JSON.stringify(iso)}`,
    );
  }

  // The 31st of February matches the regex and parses as March 2nd. A clock
  // built on a day that does not exist would be off by two days, silently.
  const year = Number(champs[1]);
  const month = Number(champs[2]);
  const day = Number(champs[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RangeError(
      `fixedClock: ${JSON.stringify(iso)} is not a date that exists — Date.parse would ` +
        `silently roll it over into the next month.`,
    );
  }

  // Re-spelled in the one form ECMA-262 REQUIRES every engine to parse, rather
  // than handed over as typed. `Date.parse` is only specified for the extended
  // format with at most three fractional digits; `2024-01-01T00:00:00+0100`
  // falls into its implementation-defined half, where V8 happens to be right
  // and nothing guarantees the next runtime will be.
  const fraction = (champs[7] ?? '').padEnd(3, '0').slice(0, 3);
  const offset =
    champs[8] === undefined ? 'Z' : `${champs[8]}${champs[9] ?? ''}:${champs[10] ?? '00'}`;
  const canonical = `${champs[1] ?? ''}-${champs[2] ?? ''}-${champs[3] ?? ''}T${champs[4] ?? ''}:${champs[5] ?? ''}:${champs[6] ?? ''}.${fraction}${offset}`;

  const parsed = Date.parse(canonical);
  // Unreachable after the two checks above; kept so that a change to the regex
  // cannot let an unparsable string through as `NaN` milliseconds.
  if (Number.isNaN(parsed)) {
    throw new RangeError(`fixedClock: ${JSON.stringify(iso)} is not a valid instant`);
  }

  let ms = parsed;

  return {
    now(): string {
      return new Date(ms).toISOString();
    },
    nowMs(): number {
      return ms;
    },
    advance(durationMs: number): void {
      if (!Number.isInteger(durationMs) || durationMs < 0) {
        throw new RangeError(
          `fixedClock.advance: expected a non-negative integer number of milliseconds, got ` +
            `${String(durationMs)}. A clock that goes backwards is not a clock.`,
        );
      }
      ms += durationMs;
    },
  };
}
