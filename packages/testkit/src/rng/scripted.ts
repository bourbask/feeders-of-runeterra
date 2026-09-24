/**
 * Scripted randomness.
 *
 * A test that needs dice hands the engine a `scriptedRng([6, 3, 9])`: the first
 * `roll()` returns 6, the second 3, the third 9. There is no fourth.
 *
 * The two refusals below are the whole point of the file. A scripted generator
 * that quietly kept producing numbers once its script ran out — by wrapping
 * around, by falling back to a real generator, by returning 0 — would turn a
 * test that draws more dice than it meant to into a GREEN test asserting on
 * values nobody wrote. Same for a value that cannot come out of the die that
 * was asked for: a `9` handed back for a d6 is a fact the rules can never
 * produce, and every assertion downstream of it measures fiction.
 *
 * So: exhaustion throws, out-of-range throws, and the exhaustion message says
 * how many draws were consumed, which is the number a test author needs.
 */

import type { RngDraw, TracingRng } from '@for/engine';

/** Thrown when more draws are asked for than the script holds. */
export class ScriptedRngExhausted extends Error {
  /** Draws served before this one. */
  readonly consumed: number;
  /** Length of the script it was built with. */
  readonly scripted: number;
  /** Sides of the die that was asked for when the script ran out. */
  readonly sides: number;

  constructor(consumed: number, scripted: number, sides: number) {
    super(
      `${String(consumed)} draw(s) consumed out of ` +
        `${String(scripted)} scripted, and a d${String(sides)} was asked for. A scripted ` +
        `generator never falls back to real randomness. Either script the missing value, ` +
        `or fix the code under test: it rolls more dice than the test expects.`,
    );
    this.name = 'ScriptedRngExhausted';
    this.consumed = consumed;
    this.scripted = scripted;
    this.sides = sides;
  }
}

/** Thrown when the scripted value cannot come out of the die that was asked for. */
export class ScriptedRngOutOfRange extends Error {
  readonly index: number;
  readonly value: number;
  readonly sides: number;

  constructor(index: number, value: number, sides: number) {
    super(
      `scripted value ${String(value)} at index ${String(index)} ` +
        `cannot come out of a d${String(sides)} (expected 1..${String(sides)}). A test fed an ` +
        `impossible die result proves nothing about the rules.`,
    );
    this.name = 'ScriptedRngOutOfRange';
    this.index = index;
    this.value = value;
    this.sides = sides;
  }
}

export interface ScriptedRng extends TracingRng {
  /** Draws already served. */
  consumed(): number;
  /** Draws still in the script. Zero means the next `roll()` throws. */
  remaining(): number;
}

/**
 * Deterministic `Rng` serving the given values, in order.
 *
 * @param values each one must be a positive integer. The check happens at
 * construction, so a typo surfaces on the line that wrote it rather than fifty
 * frames deeper inside a move.
 */
export function scriptedRng(values: readonly number[]): ScriptedRng {
  for (const [index, value] of values.entries()) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(
        `scriptedRng: value at index ${String(index)} must be an integer >= 1, ` +
          `got ${String(value)}`,
      );
    }
  }

  const script = [...values];
  const draws: RngDraw[] = [];
  let index = 0;

  return {
    roll(sides: number): number {
      if (!Number.isInteger(sides) || sides < 1) {
        throw new RangeError(`sides must be an integer >= 1, got ${String(sides)}`);
      }
      const value = script[index];
      if (value === undefined) {
        throw new ScriptedRngExhausted(index, script.length, sides);
      }
      if (value > sides) {
        throw new ScriptedRngOutOfRange(index, value, sides);
      }
      index += 1;
      draws.push({ sides, value });
      return value;
    },
    trace(): readonly RngDraw[] {
      return [...draws];
    },
    consumed(): number {
      return index;
    },
    remaining(): number {
      return script.length - index;
    },
  };
}
