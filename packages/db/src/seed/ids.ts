/**
 * The two identifier sources of the demo campaign, both of them functions of
 * nothing but a counter.
 *
 * WHY TWO, AND NOT ONE. The journal carries two families of identifier and
 * `@for/contracts` refuses to confuse them: `zEventId`, `zPlayerId` and the
 * eleven other `zBrandedId` want a 26-character Crockford ULID, while
 * `zCorrelationId` is `z.uuid()` — "a UUID, not a ULID: it is minted by the
 * client for idempotence and by the server for engine-born turns"
 * (01-architecture.md section 5.4).
 *
 * THAT DISTINCTION IS WHY THE SEED RE-STAMPS `correlationId`, and it is a
 * REPORTED DIVERGENCE rather than a local trick. `decide()` builds a turn with
 * `const correlationId = ctx.ids.next()` and mints each event id from the SAME
 * `IdFactory` (`decide.ts`, `createTurn`). One factory cannot satisfy both
 * schemas, so every event `decide()` produces today carries a correlation
 * identifier that `zEventEnvelope` rejects — which makes `db:check` control 10
 * red and `replayJournal` throw, since both parse with `zGameEvent`. The seed
 * therefore does what the specification says the SERVER does: it stamps the
 * turn's correlation identifier itself. See `script.ts`.
 */

import type { IdFactory } from '@for/engine';

/** Crockford base32: no I, L, O or U. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID is 26 characters. `ULID_PATTERN` in `@for/contracts` says so too. */
export const ULID_LENGTH = 26;

/**
 * `seed`, then `seed + 1`, then `seed + 2` … in Crockford base32.
 *
 * Monotone and total: the counter walks the string from the right, carrying,
 * and a carry that runs off the left end is a programming error rather than a
 * silent wrap — a wrapped factory would hand out an identifier it has already
 * handed out, and the journal's primary key would abort on it much later.
 */
export function monotonicUlidFactory(seed: string): IdFactory {
  if (seed.length !== ULID_LENGTH) {
    throw new RangeError(`graine ULID de ${String(seed.length)} caractères, 26 attendus`);
  }
  // `split('')` rather than a spread: a ULID is ASCII by construction
  // (`ULID_PATTERN`), and the spread operator walks Unicode code points, which
  // the lint refuses on a string for good reasons that do not apply here.
  const current = seed.split('');
  let handedOut = false;

  return {
    next(): string {
      if (handedOut) increment(current);
      handedOut = true;
      return current.join('');
    },
  };

  function increment(digits: string[]): void {
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      const digit = digits[index] ?? '';
      const position = CROCKFORD.indexOf(digit);
      if (position < 0) {
        throw new RangeError(`caractère « ${digit} » hors de la base 32`);
      }
      const next = CROCKFORD[position + 1];
      if (next !== undefined) {
        digits[index] = next;
        return;
      }
      digits[index] = '0';
    }
    throw new RangeError('la fabrique d’ULID a débordé');
  }
}

/**
 * A UUID that depends only on `counter`.
 *
 * Shaped as a version 4 UUID — `4` in the version nibble, `8` in the variant
 * nibble — because `zCorrelationId` is `z.uuid()` and a bare hex string with
 * the right dashes is not one. Nothing about it is random, and that is the
 * point: two runs of the seed produce the same correlation groups, so the
 * « Pourquoi ? » projection of a demo turn is stable across rebuilds.
 */
export function demoCorrelationId(counter: number): string {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new RangeError(`compteur de corrélation invalide : ${String(counter)}`);
  }
  const tail = counter.toString(16).padStart(12, '0');
  if (tail.length > 12) {
    throw new RangeError(`compteur de corrélation trop grand : ${String(counter)}`);
  }
  return `00000000-0000-4000-8000-${tail}`;
}
