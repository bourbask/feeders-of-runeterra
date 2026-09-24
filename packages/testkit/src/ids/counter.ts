/**
 * Counted identifiers.
 *
 * The engine never mints an identifier: it receives an `IdFactory`
 * (`@for/engine`, `ids.ts`). In production that factory makes ULIDs, which are
 * derived from time and randomness and are therefore unusable in a golden
 * corpus. Here it counts: `counterIds('ev')` gives `ev-1`, `ev-2`, `ev-3`.
 *
 * Legible in a diff, stable across runs — the two properties a golden file needs.
 */

import type { IdFactory } from '@for/engine';

const PREFIX = /^[A-Za-z][A-Za-z0-9_-]*$/;

export interface CounterIdFactory extends IdFactory {
  next(): string;
  /** Identifiers handed out so far. */
  count(): number;
}

/**
 * @param prefix what every identifier starts with, before the dash. Kept to
 * `[A-Za-z][A-Za-z0-9_-]*` so the result stays a legible token in a golden file.
 */
export function counterIds(prefix = 'id'): CounterIdFactory {
  if (!PREFIX.test(prefix)) {
    throw new RangeError(
      `counterIds: prefix must match ${String(PREFIX)}, got ${JSON.stringify(prefix)}`,
    );
  }

  let issued = 0;

  return {
    next(): string {
      issued += 1;
      return `${prefix}-${String(issued)}`;
    },
    count(): number {
      return issued;
    },
  };
}
