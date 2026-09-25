/**
 * Every move of the registry has to be played by at least one scenario.
 *
 * §7.4: "la couverture (chaque mouvement du registre exerce par au moins un
 * scenario — sinon echec `move_not_covered`)".
 *
 * ── THE LIST IS WALKED, NEVER PINNED ────────────────────────────────────
 * The expected set is `Object.keys(MOVE_REGISTRY)` — the engine's own record,
 * read at runtime. A twelfth move added there is immediately uncovered, and a
 * move deleted there stops being demanded. A constant written out in this
 * file would be a copy that goes stale the day the engine grows, which is
 * mode 6 of the standard probe: a list that is its own source of truth keeps
 * nothing.
 *
 * ── WHERE THE OBSERVED SET COMES FROM ───────────────────────────────────
 * From `move.declared` entries READ OFF THE JOURNAL, not from the scenario
 * files. A scenario that declares `move.strike` and is refused
 * `target_not_present` has exercised nothing, and a coverage check that
 * counted intents would have called it covered. Two origins, again: the
 * engine's registry against the journal the run produced.
 */

import { MOVE_REGISTRY } from '@for/engine';

/** What the coverage check answers. `missing` empty means covered. */
export interface CoverageReport {
  readonly code: 'move_not_covered' | null;
  readonly expected: readonly string[];
  readonly played: readonly string[];
  readonly missing: readonly string[];
  /** Played but unknown to the registry — a scenario naming a ghost. */
  readonly unexpected: readonly string[];
}

export function checkMoveCoverage(played: Iterable<string>): CoverageReport {
  const expected = Object.keys(MOVE_REGISTRY).sort((a, b) => a.localeCompare(b, 'en'));
  const seen = new Set(played);
  const missing = expected.filter((move) => !seen.has(move));
  const unexpected = [...seen]
    .filter((move) => !expected.includes(move))
    .sort((a, b) => a.localeCompare(b, 'en'));
  return {
    code: missing.length > 0 || unexpected.length > 0 ? 'move_not_covered' : null,
    expected,
    played: [...seen].sort((a, b) => a.localeCompare(b, 'en')),
    missing,
    unexpected,
  };
}
