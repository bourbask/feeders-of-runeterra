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
 */
const ISO_INSTANT =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export interface FixedClock {
  /** The instant, canonical ISO-8601 UTC (`2024-01-01T00:00:00.000Z`). */
  now(): string;
  /** The same instant, milliseconds since the epoch. */
  nowMs(): number;
  /** The ONLY thing that moves this clock. */
  advance(durationMs: number): void;
}

/**
 * @param iso an ISO-8601 instant carrying a timezone (`Z` or `+hh:mm`). A
 * local-time string is refused: it would read differently on a machine in
 * another timezone, which is exactly the bug this file exists to prevent.
 * `now()` returns the CANONICAL form of that instant, so two spellings of the
 * same moment serialise identically.
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

  const parsed = Date.parse(iso);
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
