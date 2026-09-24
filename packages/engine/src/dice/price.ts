/**
 * "Pay the price" — ADR 0006, one mode and only one.
 *
 * The engine rolls the d12, reads the entry the die landed on, and hands it
 * over as an imposed fact. Nobody chooses: not the storyteller, not the player.
 * There is no `optionId`, no `playerChoices`, no second door.
 *
 * The one place a choice could have crept back in is an entry that declares
 * several effects. It does not: a SECOND draw, on the same `price` stream,
 * picks the index, and `effectIndex` records it so the whole thing replays
 * identically (03-donnees.md section 4.6). The draw only happens when there is
 * something to arbitrate — a single effect is taken as it stands, and no die is
 * spent on a one-horse race. That matters beyond elegance: a draw nobody needs
 * still advances the stream, and every later draw of that stream would shift by
 * one.
 */

import type { Rng } from '../rng.js';
import type { OracleTable, WeightedEntry } from './oracle.js';
import { entryFor } from './oracle.js';

/** Mirrored from `PriceTableSchema` (03-donnees.md section 4.6). */
export const PRICE_TABLE_ID = 'pay-the-price';

/** The die, and therefore the number of entries the table must hold: twelve. */
export const PRICE_DIE = 12;

/**
 * `effectIndex` when the drawn entry carries no effect at all.
 *
 * Zero would have been wrong: it designates the first effect of a list that
 * has none, and a caller that trusts it reads `entries[0]` as `undefined`.
 * A value outside any index says "there is nothing to apply" and cannot be
 * mistaken for a position.
 */
export const NO_EFFECT_INDEX = -1;

/** An entry of the price table: a span, plus the effects it may impose. */
export interface PriceEntry<TEffect> extends WeightedEntry {
  readonly suggestedEffects: readonly TEffect[];
}

export interface PriceRoll<TEntry extends PriceEntry<TEffect>, TEffect> {
  readonly tableId: string;
  /** The face of the d12. */
  readonly value: number;
  readonly entry: TEntry;
  /** Index into `entry.suggestedEffects`, or `NO_EFFECT_INDEX`. */
  readonly effectIndex: number;
  /** `null` only when the entry carries no effect. */
  readonly effect: TEffect | null;
  /** Whether a second draw was spent picking between several effects. */
  readonly arbitrated: boolean;
}

/** Thrown when the table handed over is not the twelve-entry price table. */
export class NotThePriceTable extends Error {
  readonly tableId: string;
  readonly die: number;

  constructor(tableId: string, die: number) {
    super(
      `${JSON.stringify(tableId)} on a d${String(die)} is not the price table: expected ` +
        `${JSON.stringify(PRICE_TABLE_ID)} on a d${String(PRICE_DIE)}. Paying the price is the ` +
        `one table the engine draws on its own behalf; letting another table through here ` +
        `would make content able to replace the consequence of a miss.`,
    );
    this.name = 'NotThePriceTable';
    this.tableId = tableId;
    this.die = die;
  }
}

/**
 * Roll the price, and pick its effect.
 *
 * Draw order, which the journal replays: the d12 first, then — only if the
 * entry offers more than one effect — a d(n) over the effects.
 */
export function rollPrice<TEffect, TEntry extends PriceEntry<TEffect>>(
  table: OracleTable<TEntry>,
  rng: Rng,
): PriceRoll<TEntry, TEffect> {
  if (table.id !== PRICE_TABLE_ID || table.die !== PRICE_DIE) {
    throw new NotThePriceTable(table.id, table.die);
  }

  const value = rng.roll(PRICE_DIE);
  const entry = entryFor(table, value);
  const effects = entry.suggestedEffects;

  if (effects.length === 0) {
    return {
      tableId: table.id,
      value,
      entry,
      effectIndex: NO_EFFECT_INDEX,
      effect: null,
      arbitrated: false,
    };
  }

  const arbitrated = effects.length > 1;
  const effectIndex = arbitrated ? rng.roll(effects.length) - 1 : 0;
  // `noUncheckedIndexedAccess` is on, and rightly: the index comes from a die.
  // It is in range by construction, and the assertion says so once rather than
  // leaking `TEffect | undefined` into every caller.
  const effect = effects[effectIndex] as TEffect;

  return { tableId: table.id, value, entry, effectIndex, effect, arbitrated };
}
