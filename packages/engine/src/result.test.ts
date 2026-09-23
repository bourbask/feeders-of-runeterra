import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, ok, type Result } from './result.js';

describe('Result', () => {
  it('carries a value on success', () => {
    const result = ok(7);
    expect(result).toEqual({ ok: true, value: 7 });
  });

  it('carries an error on failure', () => {
    const result = err({ code: 'unknown_move' });
    expect(result).toEqual({ ok: false, error: { code: 'unknown_move' } });
  });

  it('narrows through isOk and isErr', () => {
    const results: Result<number, string>[] = [ok(1), err('boum')];
    const values: number[] = [];
    const errors: string[] = [];
    for (const result of results) {
      if (isOk(result)) values.push(result.value);
      if (isErr(result)) errors.push(result.error);
    }
    expect(values).toEqual([1]);
    expect(errors).toEqual(['boum']);
  });
});
