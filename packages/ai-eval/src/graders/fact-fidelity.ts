/**
 * `fact-fidelity` — the prose says what the `<fait>` says, and decides nothing.
 *
 * This is invariant 1 read on the output. The engine rolled, settled the
 * outcome, moved the gauges, drew the price and wrote the journal BEFORE the
 * model was called. Four of the seven checks here are the mechanical half of
 * that: `no_outcome_decision` (the storyteller does not settle what the fact
 * has not settled), `no_rules_lexicon` (our vocabulary of mechanics never
 * reaches a player), `price_respected` (the drawn entry is not a menu, ADR
 * 0006) and `no_time_skip` (time that costs something comes from play).
 *
 * `no_pc_agency` belongs here for the same reason: a line of dialogue
 * attributed to a player character is the storyteller deciding for a player.
 *
 * `mentions_any` and `ends_concrete` are the two soft ones of section 8.5 —
 * reported, never a gate.
 */

import { runFamily, type Grader } from './kit.js';

export const FACT_FIDELITY_IDS: readonly string[] = [
  'no_rules_lexicon',
  'no_outcome_decision',
  'no_pc_agency',
  'price_respected',
  'no_time_skip',
  'mentions_any',
  'ends_concrete',
];

export const factFidelityGrader: Grader = {
  name: 'fact-fidelity',
  ids: FACT_FIDELITY_IDS,
  run: (input) => runFamily(FACT_FIDELITY_IDS, input),
};
