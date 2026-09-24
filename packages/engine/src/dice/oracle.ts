/**
 * Weighted table draws.
 *
 * "The tables come in as an argument" (01-architecture.md section 2.3) is not a
 * convenience: a table baked into the engine would be French text inside a pure
 * package, and it would make a content fix a code release.
 *
 * So the shapes below are STRUCTURAL. They name the two fields a draw needs —
 * a span `[min, max]` and the die the spans cover — and nothing else. An
 * `OracleTable<TEntry>` accepts any entry that carries them, so `@for/content`
 * can hand over its own richer entries (text, tags, chain, severity) and get
 * them back, typed, in `OracleRoll.entry`. The engine never reads the text it
 * returns.
 *
 * What the engine does NOT re-verify: that the spans cover the die without a
 * gap or an overlap. That is `coversDie` in `OracleTableSchema`, run by the
 * content loader before the server starts (03-donnees.md section 4.6). Checking
 * it again on every draw would be a second, divergent copy of the rule. What
 * the engine does instead is refuse to INVENT: a value that lands in no span
 * throws instead of returning `undefined`, because an `undefined` entry travels
 * silently all the way into the storyteller's prompt.
 */

import type { Rng } from '../rng.js';

/** The span an entry covers on its table's die. Both ends inclusive. */
export interface WeightedEntry {
  readonly id: string;
  readonly min: number;
  readonly max: number;
}

export interface OracleTable<TEntry extends WeightedEntry> {
  readonly id: string;
  /** Die the spans cover: 4, 6, 8, 10, 12, 20 or 100. */
  readonly die: number;
  readonly entries: readonly TEntry[];
}

export interface OracleRoll<TEntry extends WeightedEntry> {
  readonly tableId: string;
  readonly die: number;
  /** The face that came up, in [1, die]. */
  readonly value: number;
  readonly entry: TEntry;
}

/** Thrown when a drawn value lands in no entry of the table. */
export class OracleTableHasNoEntryFor extends Error {
  readonly tableId: string;
  readonly value: number;

  constructor(tableId: string, value: number) {
    super(
      `table ${JSON.stringify(tableId)} covers no entry for ${String(value)}. A table with a ` +
        `hole is refused by the content loader (coversDie); reaching this point means the ` +
        `table never went through it. Returning nothing here would send an undefined entry ` +
        `all the way into the prompt.`,
    );
    this.name = 'OracleTableHasNoEntryFor';
    this.tableId = tableId;
    this.value = value;
  }
}

/**
 * The entry whose span holds `value`, or a refusal.
 *
 * Exported because the price table needs the same lookup, and because a test
 * can then prove the refusal without having to force a die.
 */
export function entryFor<TEntry extends WeightedEntry>(
  table: OracleTable<TEntry>,
  value: number,
): TEntry {
  const found = table.entries.find((entry) => value >= entry.min && value <= entry.max);
  if (found === undefined) {
    throw new OracleTableHasNoEntryFor(table.id, value);
  }
  return found;
}

/**
 * One draw on the table's die, and the entry it lands on.
 *
 * The stream this draw belongs to (`oracle`, `price`, `presage`) is the
 * caller's business: the engine only ever sees an `Rng`, and `decide()` journals
 * the stream and the draw index alongside the event (03-donnees.md section 3.6).
 */
export function rollOracle<TEntry extends WeightedEntry>(
  table: OracleTable<TEntry>,
  rng: Rng,
): OracleRoll<TEntry> {
  const value = rng.roll(table.die);
  return { tableId: table.id, die: table.die, value, entry: entryFor(table, value) };
}
