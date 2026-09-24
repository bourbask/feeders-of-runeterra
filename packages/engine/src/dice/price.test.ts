import { scriptedRng } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { OracleTable } from './oracle.js';
import type { PriceEntry } from './price.js';
import {
  NO_EFFECT_INDEX,
  NotThePriceTable,
  PRICE_DIE,
  PRICE_TABLE_ID,
  rollPrice,
} from './price.js';

interface Effect {
  readonly op: string;
}

interface Entry extends PriceEntry<Effect> {
  readonly severity: string;
}

/** Twelve entries, one per face, so the table is the real shape. */
function priceTable(effectsByFace: readonly (readonly Effect[])[]): OracleTable<Entry> {
  return {
    id: PRICE_TABLE_ID,
    die: PRICE_DIE,
    entries: Array.from({ length: PRICE_DIE }, (_unused, index) => ({
      id: `entree-${String(index + 1)}`,
      min: index + 1,
      max: index + 1,
      severity: 'legere',
      suggestedEffects: effectsByFace[index] ?? [],
    })),
  };
}

const ONE_EFFECT_EVERYWHERE = priceTable(
  Array.from({ length: PRICE_DIE }, () => [{ op: 'gauge' }] as const),
);

describe('rollPrice', () => {
  it('rolls the d12 and imposes the entry it landed on', () => {
    const rng = scriptedRng([7]);
    const roll = rollPrice(ONE_EFFECT_EVERYWHERE, rng);

    expect(roll.value).toBe(7);
    expect(roll.entry.id).toBe('entree-7');
    expect(rng.trace()).toEqual([{ sides: 12, value: 7 }]);
  });

  it('spends no second draw on a single effect', () => {
    // A draw nobody needs still advances the stream: every later draw of the
    // `price` stream would shift by one, and the journal would stop replaying.
    const rng = scriptedRng([3, 1]);
    const roll = rollPrice(ONE_EFFECT_EVERYWHERE, rng);

    expect(rng.consumed()).toBe(1);
    expect(roll.arbitrated).toBe(false);
    expect(roll.effectIndex).toBe(0);
    expect(roll.effect).toEqual({ op: 'gauge' });
  });

  it('arbitrates several effects with a second draw, and records the index', () => {
    const table = priceTable([[{ op: 'a' }, { op: 'b' }, { op: 'c' }]]);
    const rng = scriptedRng([1, 3]);
    const roll = rollPrice(table, rng);

    expect(rng.trace()).toEqual([
      { sides: 12, value: 1 },
      { sides: 3, value: 3 },
    ]);
    expect(roll.arbitrated).toBe(true);
    expect(roll.effectIndex).toBe(2);
    expect(roll.effect).toEqual({ op: 'c' });
  });

  it('maps every face of the arbitration die onto an effect', () => {
    const table = priceTable([[{ op: 'a' }, { op: 'b' }]]);
    expect(rollPrice(table, scriptedRng([1, 1])).effect).toEqual({ op: 'a' });
    expect(rollPrice(table, scriptedRng([1, 2])).effect).toEqual({ op: 'b' });
  });

  it('says there is nothing to apply rather than pointing at effect zero', () => {
    const table = priceTable([[]]);
    const roll = rollPrice(table, scriptedRng([1]));

    expect(roll.effectIndex).toBe(NO_EFFECT_INDEX);
    expect(roll.effect).toBeNull();
    expect(roll.arbitrated).toBe(false);
  });

  it('offers no way for anyone to choose the entry', () => {
    // ADR 0006. The shape of the result is the guard: there is no option list,
    // no `optionId`, and nothing a caller could pass in to steer the draw.
    const roll = rollPrice(ONE_EFFECT_EVERYWHERE, scriptedRng([4]));
    expect(Object.keys(roll).sort()).toEqual([
      'arbitrated',
      'effect',
      'effectIndex',
      'entry',
      'tableId',
      'value',
    ]);
    expect(rollPrice.length).toBe(2);
  });

  it('refuses a table that is not the price table', () => {
    const impostor: OracleTable<Entry> = { ...ONE_EFFECT_EVERYWHERE, id: 'oracle-des-noms' };
    expect(() => rollPrice(impostor, scriptedRng([1]))).toThrow(NotThePriceTable);
  });

  it('refuses the price table on the wrong die', () => {
    const wrongDie: OracleTable<Entry> = { ...ONE_EFFECT_EVERYWHERE, die: 20 };
    expect(() => rollPrice(wrongDie, scriptedRng([1]))).toThrow(NotThePriceTable);
  });

  it('refuses before spending a draw', () => {
    const rng = scriptedRng([1]);
    expect(() => rollPrice({ ...ONE_EFFECT_EVERYWHERE, id: 'autre' }, rng)).toThrow(
      NotThePriceTable,
    );
    expect(rng.consumed()).toBe(0);
  });
});
