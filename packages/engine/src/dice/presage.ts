/**
 * Presages: the twist the dice impose.
 *
 * Two rules live here, and deliberately in the same file:
 *
 * 1. WHEN a presage happens — the two challenge dice show the same face. That
 *    predicate is owned here rather than in `challenge.ts` so that the action
 *    roll and the progress roll read it from ONE place. Two copies of `a === b`
 *    is how two rolls end up disagreeing about what a presage is.
 * 2. WHAT the presage says — a draw on the `presages` content table, reserved
 *    to the engine. `roll_oracle` cannot reach it (ARCHITECTURE.md section 4.4):
 *    a presage is a consequence the rules impose, never a table the storyteller
 *    consults.
 *
 * The table itself is an ARGUMENT. The engine holds no game text.
 */

import type { Rng } from '../rng.js';
import type { OracleRoll, OracleTable, WeightedEntry } from './oracle.js';
import { rollOracle } from './oracle.js';

/**
 * The only identifier the presage table may carry, mirrored from
 * `PresageTableSchema` (03-donnees.md section 4.6). Checked rather than
 * assumed: without the check, `rollPresage` is a second, unguarded door onto
 * any table at all, and the one draw the storyteller is not allowed to ask for
 * becomes reachable through it.
 */
export const PRESAGE_TABLE_ID = 'presages';

/**
 * Do the challenge dice impose a twist?
 *
 * Equal faces, whatever the outcome. A presage rides on a clean success just
 * as it rides on a miss: that is why it is a separate field of the roll and
 * not a fourth outcome.
 */
export function isPresage(challengeDice: readonly [number, number]): boolean {
  return challengeDice[0] === challengeDice[1];
}

/** Thrown when a table that is not the presage table is handed to the engine. */
export class NotThePresageTable extends Error {
  readonly tableId: string;

  constructor(tableId: string) {
    super(
      `${JSON.stringify(tableId)} is not the presage table. Only ` +
        `${JSON.stringify(PRESAGE_TABLE_ID)} is drawn as a presage: that draw is a consequence ` +
        `the rules impose, not a table anyone may consult.`,
    );
    this.name = 'NotThePresageTable';
    this.tableId = tableId;
  }
}

/**
 * Draw the twist on the presage table.
 *
 * One draw. Which stream it belongs to (`presage`) and what its index is are
 * the caller's business: the engine only ever sees the `Rng` it was handed.
 */
export function rollPresage<TEntry extends WeightedEntry>(
  table: OracleTable<TEntry>,
  rng: Rng,
): OracleRoll<TEntry> {
  if (table.id !== PRESAGE_TABLE_ID) {
    throw new NotThePresageTable(table.id);
  }
  return rollOracle(table, rng);
}
