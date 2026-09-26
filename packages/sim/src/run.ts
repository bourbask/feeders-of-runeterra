/**
 * One scenario, from its file to a verdict — and the five checks it has to
 * pass.
 *
 * A FILE THE TASK SHEET DOES NOT LIST, and said so rather than smuggled into
 * `harness.ts`: the sheet names `{cli,harness,scripted-narrator,scenario,report}`
 * plus four checks. `harness.ts` DRIVES a table and `report.ts` RENDERS a
 * verdict; the thing that decides what a verdict is belongs to neither, and
 * putting it in either would make that file the one everything imports. The
 * sixth check, `checks/coverage.ts`, is the other addition, for the same
 * reason: §7.4 asks for `move_not_covered` and none of the four listed files
 * is about the registry.
 *
 * ── THE ORDER OF THE CHECKS IS THE ORDER OF THE INVARIANTS ──────────────
 *   1. the expectations the scenario wrote down (a reader's view);
 *   2. `checkInvariants` — a valid state after every entry;
 *   3. `checkReplayEquivalence` — invariant 4, table AND player;
 *   4. `checkLockout` — the distribution lock, on what each player was told;
 *   5. the golden corpus — the final state, the RNG trace and every player's
 *      delivered thread.
 *
 * Determinism (two runs, one seed) and the anti-repetition rule (a cancelled
 * turn does not give back its dice) are run by `runAll`, because both need
 * MORE THAN ONE RUN and a per-scenario function cannot see a second one.
 */

import { expectGolden, goldenUpdateRequested } from '@for/testkit';

import { checkMoveCoverage } from './checks/coverage.js';
import {
  actionDraws,
  checkDeterminism,
  checkDrawCounter,
  checkRerollAfterRevert,
} from './checks/determinism.js';
import { checkInvariants } from './checks/invariants.js';
import { checkLockout } from './checks/lockout.js';
import { checkReplayEquivalence } from './checks/replay-equivalence.js';
import { createSimHarness, symbolsOf, type HarnessOptions } from './harness.js';
import { expandUlid, loadScenarios, selectScenarios } from './scenario.js';

import { staticContent } from '@for/content';
import { createInitialCampaignState } from '@for/engine';

import type { PlayerId } from '@for/engine';
import type { CoverageReport } from './checks/coverage.js';
import type { Scenario } from './scenario.js';

/** Where the golden corpora live. Anchored to THIS file, never to the cwd. */
export const GOLDEN_DIR = new URL('../tests/golden', import.meta.url);

export interface ScenarioResult {
  readonly id: string;
  readonly title: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly eventCount: number;
  readonly journalHash: string;
  readonly moves: readonly string[];
  readonly steps: readonly {
    readonly index: number;
    readonly kind: string;
    readonly note: string | null;
    readonly appended: readonly string[];
    readonly rejected: string | null;
  }[];
  readonly failures: readonly string[];
  /** `true` when this scenario exercised the cancel-then-replay path. */
  readonly exercisedRevert: boolean;
}

export interface RunOptions {
  readonly seed?: string;
  readonly scenarioDir?: string;
  readonly selector?: string | null;
  /** Rewrites the corpora instead of comparing. `pnpm sim record`. */
  readonly record?: boolean;
  /**
   * Where the corpora are read from. `GOLDEN_DIR` unless a caller says
   * otherwise, and the only caller that says otherwise is the counter-probe
   * of `tests/scenarios.test.ts`: it hands a COPY of a corpus with one number
   * changed, and requires the run to go red on it. Altering the real corpus
   * in place to prove the same thing would leave the tree dirty the day the
   * test fails.
   */
  readonly goldenDir?: string | URL;
}

/**
 * The shape the golden corpus pins.
 *
 * FOUR PARTS, and each one catches something the others cannot:
 *   - `state` catches a rule that changed a number AND SURVIVED to the end;
 *   - `rng` catches a draw taken, skipped or taken on the wrong stream —
 *     §7.4 asks for the trace by name;
 *   - `journal` catches an entry that stopped being written, a new one, and
 *     — since it pins `payload` — a number that changed INSIDE an entry;
 *   - `threads` catches ADR 0008: who was told what, in which order, AND WITH
 *     WHAT IN IT.
 *
 * ── WHY `payload` IS PINNED, AND WHAT IT COST TO LEARN ───────────────────
 * The first version of this corpus pinned `{seq, type}` and nothing else. A
 * simulator built that way is WORSE THAN NO SIMULATOR, because it hands out a
 * confidence it has not earned: measured on this very file, `ACTION_SCORE_CAP`
 * taken from 10 to 8 turned `total: 9` into `total: 8` and `cappedAtTen:
 * false` into `true` in `roll.action_resolved` — five engine unit tests went
 * red, `pnpm test:golden` went red, and `pnpm sim run` stayed GREEN in 0,55 s.
 * A rule that changes a number without reaching the final state was invisible.
 * Held by `tests/scenarios.test.ts` « une charge utile qui change fait rougir
 * le corpus doré, même quand l'état final ne bouge pas ».
 *
 * ── WHAT IS NOT PINNED, AND WHY IT WOULD NOT SURVIVE ─────────────────────
 * `createdAt` is absent, for the same reason `journalHash` leaves it out: the
 * clock is injected and fixed, so it adds no signal. Named identifiers are
 * replaced by their scenario symbol (`symbolsOf`) — exact, reversible, and it
 * removes twenty-two leading zeros per line from a corpus a human has to read
 * when it goes red.
 */
interface GoldenShape {
  readonly state: unknown;
  readonly rng: unknown;
  readonly journal: readonly {
    readonly seq: number;
    readonly type: string;
    readonly payload: unknown;
  }[];
  readonly threads: Readonly<
    Record<
      string,
      readonly {
        readonly deliverySeq: number;
        readonly seq: number;
        readonly type: string;
        readonly payload: unknown;
      }[]
    >
  >;
}

/**
 * `value` with every SYMBOL-MINTED identifier replaced by its symbol.
 *
 * Structural, not field-by-field: a payload field added tomorrow is covered
 * without anyone remembering to add it to a list. Only whole strings are
 * substituted — an identifier embedded in a narration line stays where it is,
 * because a partial rewrite of prose would hide a change in the prose.
 */
function withSymbols(value: unknown, symbols: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return symbols.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => withSymbols(item, symbols));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = withSymbols(item, symbols);
    return out;
  }
  return value;
}

export async function runScenario(
  scenario: Scenario,
  options: RunOptions = {},
): Promise<ScenarioResult> {
  const started = Date.now();
  const failures: string[] = [];
  const harnessOptions: HarnessOptions = {
    scenario,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    tmpPrefix: `for-sim-${scenario.id}-`,
  };
  const harness = createSimHarness(harnessOptions);

  try {
    await harness.run();

    // 1 — what the scenario itself wrote down.
    for (const step of harness.steps) failures.push(...step.failures);

    const journal = harness.journal();
    const state = harness.state();
    const owner = scenario.players[0];
    const ownerId = expandUlid(owner?.symbol ?? '0') as PlayerId;

    // 2 — a valid state after every entry.
    for (const violation of checkInvariants(
      createInitialCampaignState({
        campaignId: harness.campaignId,
        ownerPlayerId: ownerId,
        seed: options.seed ?? scenario.seed,
      }),
      journal,
    )) {
      failures.push(
        `invariant rompu au seq ${String(violation.seq)} (${violation.type}) : ${violation.issue}`,
      );
    }

    // 3 — invariant 4, both halves.
    const snapshot = await harness.service.getSnapshot(harness.campaignId, ownerId);
    for (const mismatch of checkReplayEquivalence({
      campaignId: harness.campaignId,
      ownerPlayerId: ownerId,
      seed: options.seed ?? scenario.seed,
      journal,
      snapshot: snapshot.state,
      tapes: harness.tapes,
      threadOf: harness.threadOf,
    })) {
      failures.push(
        mismatch.playerSymbol === null
          ? `rejeu : ${mismatch.issue}`
          : `rejeu de ${mismatch.playerSymbol} : ${mismatch.issue}`,
      );
    }

    // 4 — the distribution lock, per recipient.
    for (const breach of checkLockout(state, staticContent(), harness.tapes)) {
      failures.push(`verrou de distribution, ${breach.playerSymbol} : ${breach.issue}`);
    }

    // 5 — the golden corpus.
    const symbols = symbolsOf(scenario);
    const threads: Record<
      string,
      readonly { deliverySeq: number; seq: number; type: string; payload: unknown }[]
    > = {};
    for (const [symbol, tape] of harness.tapes) {
      const rows = harness.threadOf(tape.playerId);
      threads[symbol] = rows.map((row, at) => ({
        deliverySeq: at + 1,
        seq: row.seq,
        type: row.type,
        // The payload AS THIS PLAYER RECEIVED IT, not the table's copy of it.
        // Re-reading the journal here instead would pin one payload twice and
        // prove nothing about the second half of invariant 4.
        payload: withSymbols(row.payload, symbols),
      }));
    }
    const golden: GoldenShape = {
      state: withSymbols(snapshot.state, symbols),
      rng: withSymbols(state.rng, symbols),
      journal: journal.map((event) => ({
        seq: event.seq,
        type: event.type,
        payload: withSymbols(event.payload, symbols),
      })),
      threads,
    };
    try {
      expectGolden(scenario.id, golden, { dir: options.goldenDir ?? GOLDEN_DIR });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    const exercisedRevert = journal.some((event) => event.type === 'system.reverted');

    return {
      id: scenario.id,
      title: scenario.title,
      ok: failures.length === 0,
      durationMs: Date.now() - started,
      eventCount: journal.length,
      journalHash: harness.journalHash(),
      moves: harness.steps.flatMap((step) => step.moves),
      steps: harness.steps.map((step) => ({
        index: step.index,
        kind: step.kind,
        note: step.note,
        appended: step.appended,
        rejected: step.rejected,
      })),
      failures,
      exercisedRevert,
    };
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name} : ${error.message}` : String(error));
    return {
      id: scenario.id,
      title: scenario.title,
      ok: false,
      durationMs: Date.now() - started,
      eventCount: 0,
      journalHash: '',
      moves: [],
      steps: [],
      failures,
      exercisedRevert: false,
    };
  } finally {
    harness.close();
  }
}

export interface SimRunReport {
  readonly ok: boolean;
  readonly durationMs: number;
  readonly scenarios: readonly ScenarioResult[];
  readonly coverage: CoverageReport;
  /** Failures that belong to the run as a whole, not to one scenario. */
  readonly failures: readonly string[];
}

/**
 * Runs the selected scenarios, then the two checks that need a second run.
 *
 * DETERMINISM IS MEASURED ON ONE SCENARIO, NOT ON ALL SEVEN, and that is a
 * cost decision written down rather than hidden: a second full pass would
 * double the wall clock of a target budgeted at 20 seconds. The scenario it
 * runs twice is the LONGEST of the selection — the one with the most draws to
 * disagree about.
 */
export async function runAll(options: RunOptions = {}): Promise<SimRunReport> {
  const started = Date.now();
  if (options.record === true && !goldenUpdateRequested()) {
    throw new Error(
      'runAll({ record: true }) sans GOLDEN_UPDATE=1 : le runner doré ne réécrirait rien et ' +
        'rendrait un vert qui ne prouve rien',
    );
  }

  const all = loadScenarios(options.scenarioDir);
  const selected = selectScenarios(all, options.selector ?? null);

  const scenarios: ScenarioResult[] = [];
  for (const scenario of selected) scenarios.push(await runScenario(scenario, options));

  const failures: string[] = [];

  // Move coverage, across the whole selection.
  const coverage = checkMoveCoverage(scenarios.flatMap((result) => result.moves));
  if (coverage.code !== null) {
    failures.push(
      `${coverage.code} : ${coverage.missing.join(', ') || '—'}` +
        (coverage.unexpected.length > 0 ? ` ; inconnus : ${coverage.unexpected.join(', ')}` : ''),
    );
  }

  // Determinism, and the anti-repetition rule beside it.
  if (options.record !== true && selected.length > 0) {
    const longest = [...scenarios].sort((a, b) => b.eventCount - a.eventCount)[0];
    const again = selected.find((scenario) => scenario.id === longest?.id);
    if (again !== undefined && longest !== undefined) {
      const second = await runScenario(again, { ...options, seed: options.seed ?? again.seed });
      for (const issue of checkDeterminism(longest.journalHash, second.journalHash)) {
        failures.push(`déterminisme (${again.id}) : ${issue.issue}`);
      }
    }

    const reverting = selected.filter((scenario) =>
      scenario.steps.some((step) => step.kind === 'revert'),
    );
    if (reverting.length === 0) {
      // THE LIST EMPTIED, DELIBERATELY: if no scenario cancels a turn, this
      // check keeps NOTHING, and a run that stayed green would be green over
      // nothing. Standard probe, mode 6.
      failures.push(
        'aucun scénario n’annule un tour : le contrôle « annuler ne relance pas les mêmes dés » ' +
          'ne garde rien',
      );
    }
    for (const scenario of reverting) {
      failures.push(...(await rerollIssues(scenario, options)));
    }
  }

  return {
    ok: failures.length === 0 && scenarios.every((result) => result.ok),
    durationMs: Date.now() - started,
    scenarios,
    coverage,
    failures,
  };
}

/**
 * Replays a scenario that cancels a turn, and requires the dice to have moved.
 *
 * The two operands come from DIFFERENT ROWS of the journal: the action roll
 * whose `seq` the `system.reverted` names, and the first action roll written
 * after it. Comparing a roll with itself would answer "equal" for ever.
 */
async function rerollIssues(scenario: Scenario, options: RunOptions): Promise<readonly string[]> {
  const harnessOptions: HarnessOptions = {
    scenario,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    tmpPrefix: `for-sim-revert-${scenario.id}-`,
  };
  const harness = createSimHarness(harnessOptions);
  try {
    await harness.run();
    const journal = harness.journal();
    const reverted = journal.find((event) => event.type === 'system.reverted');
    if (reverted?.type !== 'system.reverted') {
      return [`${scenario.id} : aucune annulation dans le journal, le contrôle ne prouve rien`];
    }
    const cancelled = new Set(reverted.payload.targetSeqs);
    const draws = actionDraws(journal);
    const before = draws.find((draw) => cancelled.has(draw.seq));
    const after = draws.find((draw) => draw.seq > reverted.seq);
    return [
      ...checkRerollAfterRevert(before, after),
      ...checkDrawCounter(journal, harness.state().rng.draws),
    ].map((issue) => `annulation (${scenario.id}) : ${issue.issue}`);
  } finally {
    harness.close();
  }
}
