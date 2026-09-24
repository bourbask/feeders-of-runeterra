import { scriptedRng } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { OracleTable } from './oracle.js';
import { entryFor, OracleTableHasNoEntryFor, rollOracle } from './oracle.js';

interface Entry {
  readonly id: string;
  readonly min: number;
  readonly max: number;
  readonly text: string;
}

const D6: OracleTable<Entry> = {
  id: 'ce-que-la-tempete-cache',
  die: 6,
  entries: [
    { id: 'rien', min: 1, max: 3, text: 'rien du tout' },
    { id: 'trace', min: 4, max: 5, text: 'une trace' },
    { id: 'silhouette', min: 6, max: 6, text: 'une silhouette' },
  ],
};

describe('entryFor', () => {
  it('finds the entry whose span holds the value, at both ends', () => {
    expect(entryFor(D6, 1).id).toBe('rien');
    expect(entryFor(D6, 3).id).toBe('rien');
    expect(entryFor(D6, 4).id).toBe('trace');
    expect(entryFor(D6, 6).id).toBe('silhouette');
  });

  it('refuses out loud rather than returning nothing', () => {
    // An undefined entry travels silently into the prompt. This is the whole
    // reason the lookup is a function and not an array index.
    expect(() => entryFor(D6, 7)).toThrow(OracleTableHasNoEntryFor);
    expect(() => entryFor(D6, 0)).toThrow(OracleTableHasNoEntryFor);
  });

  it('names the table and the value in its refusal', () => {
    expect(() => entryFor(D6, 9)).toThrow(/ce-que-la-tempete-cache/);
    expect(() => entryFor(D6, 9)).toThrow(/9/);
  });
});

describe('rollOracle', () => {
  it('draws on the table die and returns the entry it landed on', () => {
    const rng = scriptedRng([5]);
    const roll = rollOracle(D6, rng);

    expect(roll).toEqual({
      tableId: 'ce-que-la-tempete-cache',
      die: 6,
      value: 5,
      entry: D6.entries[1],
    });
    expect(rng.trace()).toEqual([{ sides: 6, value: 5 }]);
  });

  it('spends exactly one draw', () => {
    const rng = scriptedRng([2, 2]);
    rollOracle(D6, rng);
    expect(rng.consumed()).toBe(1);
  });

  it('hands back the content entry whole, text included', () => {
    // The engine holds no game text: what it returns is what it was given.
    expect(rollOracle(D6, scriptedRng([6])).entry.text).toBe('une silhouette');
  });

  it('works on any die size the content declares', () => {
    const d100: OracleTable<Entry> = {
      id: 'noms',
      die: 100,
      entries: [{ id: 'tout', min: 1, max: 100, text: 'un nom' }],
    };
    expect(rollOracle(d100, scriptedRng([73])).value).toBe(73);
  });
});
