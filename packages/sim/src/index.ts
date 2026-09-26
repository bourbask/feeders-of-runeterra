/**
 * `@for/sim` — the headless table simulator.
 *
 * This file is the ONLY public surface of the package. Nothing depends on it
 * today: `@for/sim` is layer 5 and the top of the graph. It exists so that the
 * tests, the CLI and a future `db:check` control import one name each rather
 * than a path into `src/`.
 */

export const NOM = '@for/sim' as const;

export { SIM_SLOW_LIMIT_MS, main, parseArgs, type CliFlags } from './cli.js';
export {
  SIM_STEP_MS,
  campaignIdOf,
  counterUlids,
  counterUuids,
  createSimHarness,
  fallbackTemplates,
  sceneIdOf,
  simSocket,
  symbolsOf,
  type CapturedFrame,
  type HarnessOptions,
  type PlayerTape,
  type SimHarness,
  type StepOutcome,
} from './harness.js';
export { anIntent, fuzz, replayDatabase, type FuzzOptions, type ModeOutcome } from './modes.js';
export { renderJson, renderList, renderPretty } from './report.js';
export {
  GOLDEN_DIR,
  runAll,
  runScenario,
  type RunOptions,
  type ScenarioResult,
  type SimRunReport,
} from './run.js';
export {
  SCENARIO_DIR,
  ScenarioUnreadable,
  expandUlid,
  loadScenarios,
  parseScenario,
  scenarioFileName,
  selectScenarios,
  type Scenario,
  type ScenarioExpectation,
  type ScenarioStep,
} from './scenario.js';
export {
  SCRIPTED_PROVIDER_MODEL,
  createScriptedNarrator,
  scriptedNarration,
  type ScriptedNarratorOptions,
} from './scripted-narrator.js';

export { checkMoveCoverage, type CoverageReport } from './checks/coverage.js';
export {
  actionDraws,
  checkDeterminism,
  checkDrawCounter,
  checkRerollAfterRevert,
  type DeterminismIssue,
} from './checks/determinism.js';
export { checkInvariants, stateIssues, type InvariantViolation } from './checks/invariants.js';
export {
  checkLockout,
  narrationSeenBy,
  reservedFor,
  type LockoutBreach,
} from './checks/lockout.js';
export {
  checkReplayEquivalence,
  deliveredTo,
  type ReplayInput,
  type ReplayMismatch,
} from './checks/replay-equivalence.js';
