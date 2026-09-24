import { scriptedRng } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { OracleTable } from './oracle.js';
import { isPresage, NotThePresageTable, PRESAGE_TABLE_ID, rollPresage } from './presage.js';

interface Entry {
  readonly id: string;
  readonly min: number;
  readonly max: number;
  readonly text: string;
}

const PRESAGES: OracleTable<Entry> = {
  id: PRESAGE_TABLE_ID,
  die: 6,
  entries: [
    { id: 'blizzard', min: 1, max: 3, text: 'le blizzard se leve' },
    { id: 'silence', min: 4, max: 6, text: 'le vent tombe d un coup' },
  ],
};

describe('isPresage', () => {
  it('is true on equal faces, for every face of the die', () => {
    for (let face = 1; face <= 10; face += 1) {
      expect(isPresage([face, face])).toBe(true);
    }
  });

  it('is false as soon as the faces differ, by one or by nine', () => {
    expect(isPresage([1, 2])).toBe(false);
    expect(isPresage([10, 9])).toBe(false);
    expect(isPresage([1, 10])).toBe(false);
  });
});

describe('rollPresage', () => {
  it('draws once on the presage table', () => {
    const rng = scriptedRng([5]);
    const roll = rollPresage(PRESAGES, rng);

    expect(roll.entry.id).toBe('silence');
    expect(roll.value).toBe(5);
    expect(rng.consumed()).toBe(1);
  });

  it('refuses any other table, by identifier', () => {
    // The presage table is reserved to the engine: `roll_oracle` cannot reach
    // it. Without this check, `rollPresage` is a second, unguarded door onto
    // exactly the table the storyteller is not allowed to consult.
    const ordinary: OracleTable<Entry> = { ...PRESAGES, id: 'ce-que-la-tempete-cache' };
    expect(() => rollPresage(ordinary, scriptedRng([1]))).toThrow(NotThePresageTable);
  });

  it('refuses before spending a draw', () => {
    const rng = scriptedRng([1]);
    expect(() => rollPresage({ ...PRESAGES, id: 'pay-the-price' }, rng)).toThrow(
      NotThePresageTable,
    );
    expect(rng.consumed()).toBe(0);
  });
});
