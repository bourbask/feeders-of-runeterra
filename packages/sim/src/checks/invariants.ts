/**
 * The state has to be valid after EVERY entry, not just at the end.
 *
 * §7.4: "Apres CHAQUE evenement : `checkInvariants(state)` ; toute violation
 * arrete le scenario avec le `seq` fautif et le dernier intent." A check that
 * only looked at the final state would miss a gauge that went to -1 at seq 14
 * and came back to 2 at seq 20 — which is precisely the kind of reducer bug a
 * final-state comparison cannot see.
 *
 * ── WHERE EACH BOUND COMES FROM, AND WHY NOT FROM HERE ───────────────────
 * `GAUGE_MIN`, `GAUGE_MAX` and `MAX_PROGRESS_TICKS` are READ FROM THE ENGINE.
 * Writing `0` and `5` out here would be a second copy of a rule, and the
 * repository's own rule says a number that comes from the engine is compared
 * to the engine. The momentum bounds are read from the CHARACTER, not from
 * `DEFAULT_MOMENTUM_BOUNDS`: a content asset may move them (`gauges.ts`), so
 * comparing to the default would fail on a character nobody had broken.
 *
 * ── WHAT `expectValidState` ADDS THAT THE SCHEMA CANNOT ──────────────────
 * A character filed under somebody else's identifier parses cleanly and lies
 * (`@for/testkit`, `assertions.ts`). That assertion is reused rather than
 * reimplemented — it is the tool the rest of the repository proves its
 * guardrails with.
 */

import { GAUGE_MAX, GAUGE_MIN, MAX_PROGRESS_TICKS, reduceAll } from '@for/engine';
import { expectSeqContiguous, expectValidState } from '@for/testkit';

import type { CampaignState, GameEvent } from '@for/engine';

/** One thing that was wrong, and the entry it was wrong at. */
export interface InvariantViolation {
  readonly seq: number;
  readonly type: string;
  readonly issue: string;
}

/** Everything wrong with one state. Empty means nothing was. */
export function stateIssues(state: CampaignState): readonly string[] {
  const issues: string[] = [];

  try {
    expectValidState(state);
  } catch (error) {
    // ONE ISSUE IS DROPPED, AND ONLY WHILE THE TABLE IS EMPTY.
    // `expectValidState` requires `party.ownerPlayerId` to sit in
    // `party.memberPlayerIds`. That is right for a table, and FALSE BY
    // CONSTRUCTION for the first entries of any journal: `campaign.created`
    // names the owner and `party.member_joined` is what puts them in the
    // list, two entries later. A per-entry check that refused the prefix
    // would refuse every campaign ever written — including the seed's. So
    // the rule is suspended exactly while the list is EMPTY, and applies in
    // full from the first join onwards. Held in both directions by
    // `tests/checks.test.ts`, « laisse passer le préambule d'un journal, et
    // refuse un propriétaire hors de sa table une fois la table peuplée ».
    const empty = state.party.memberPlayerIds.length === 0;
    const lines = (error instanceof Error ? error.message : String(error))
      .split('\n')
      .filter((line) => !(empty && line.includes('party.ownerPlayerId')));
    if (lines.some((line) => line.trim().startsWith('- '))) issues.push(lines.join('\n'));
  }

  for (const character of Object.values(state.characters)) {
    for (const [gauge, value] of Object.entries(character.gauges)) {
      if (value < GAUGE_MIN || value > GAUGE_MAX) {
        issues.push(
          `${character.id}.${gauge} = ${String(value)}, hors des bornes du moteur ` +
            `[${String(GAUGE_MIN)}, ${String(GAUGE_MAX)}]`,
        );
      }
    }
    const bounds = character.momentumBounds;
    if (character.momentum < bounds.min || character.momentum > bounds.max) {
      issues.push(
        `${character.id}.souffle = ${String(character.momentum)}, hors de ses propres bornes ` +
          `[${String(bounds.min)}, ${String(bounds.max)}]`,
      );
    }
    if (character.xpSpent > character.xpEarned) {
      issues.push(
        `${character.id} a dépensé ${String(character.xpSpent)} d'expérience pour ` +
          `${String(character.xpEarned)} gagnés`,
      );
    }
  }

  for (const track of Object.values(state.tracks)) {
    if (track.ticks < 0 || track.ticks > MAX_PROGRESS_TICKS) {
      issues.push(
        `piste ${track.id} à ${String(track.ticks)} crans, hors de [0, ${String(MAX_PROGRESS_TICKS)}]`,
      );
    }
  }

  for (const clock of Object.values(state.clocks)) {
    if (clock.filled < 0 || clock.filled > clock.segments) {
      issues.push(
        `horloge ${clock.id} à ${String(clock.filled)}/${String(clock.segments)} segments`,
      );
    }
  }

  return issues;
}

/**
 * Replays the journal entry by entry and checks the state after each one.
 *
 * It STOPS at the first violation, as §7.4 asks: a scenario that kept going
 * would report fifty consequences of one cause.
 */
export function checkInvariants(
  initial: CampaignState,
  journal: readonly GameEvent[],
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  try {
    expectSeqContiguous(journal, { from: 1 });
  } catch (error) {
    violations.push({
      seq: 0,
      type: '<journal>',
      issue: error instanceof Error ? error.message : String(error),
    });
    return violations;
  }

  // `reduceAll` on a PREFIX rather than `reduce` on one entry, and the
  // difference is `system.reverted`: the production replay SKIPS a cancelled
  // entry while still advancing its draw stream, and a per-entry `reduce`
  // would apply what the journal says was undone. A prefix of an append-only
  // log is exactly what the server itself replays.
  for (const [at, event] of journal.entries()) {
    const state = reduceAll(initial, journal.slice(0, at + 1));
    const issues = stateIssues(state);
    if (issues.length > 0) {
      for (const issue of issues) violations.push({ seq: event.seq, type: event.type, issue });
      return violations;
    }
  }
  return violations;
}
