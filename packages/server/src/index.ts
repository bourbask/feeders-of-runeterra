/**
 * `@for/server` — its ONLY public surface.
 *
 * ── WHY THIS FILE GREW, AND WHY IT GREW EXACTLY THIS MUCH ────────────────
 * It held one constant until M0-28. `@for/sim` is the one package allowed to
 * depend on this one (01-architecture.md §1.1, an edge ARCHITECTURE.md §5
 * calls "assumée" in so many words: "un simulateur découplé ne prouverait
 * rien sur l'orchestration réelle ; celui-ci pilote le vrai
 * `CampaignService` via le vrai hub"). It cannot do that through a barrel
 * that exports a string.
 *
 * WHAT IS EXPORTED IS A LIST, NOT A `export *` OF THE PACKAGE, and the
 * difference is the point: every name below is one the simulator drives, and
 * adding a name here is a visible edit rather than a side effect of writing a
 * new module. The routes, the OAuth client, the session store, the rate
 * limiter and the write queue are NOT here — nothing outside this package
 * drives them, and `app.inject()` is how they are tested.
 *
 * THE GAME MODULES BELOW ARE EXPORTED FOR READING, NOT FOR WRITING. The one
 * write path is `CampaignService.submitIntent` (ARCHITECTURE.md §6, "toute PR
 * qui en ouvre un second doit être refusée"). `revertTurn` is the one way
 * back and is already the single mechanism its three callers share; the rest —
 * `readJournalSince`, `loadReplay`, `openBurnWindows` — read a committed
 * journal and write nothing.
 */

export const NOM = '@for/server' as const;

export { buildApp } from './app.js';
export { narratorConfig, readEnv } from './env.js';
export type { Env } from './env.js';
export { AppError } from './errors.js';

export {
  campaignRng,
  createUlidFactory,
  systemClock,
  type AppDeps,
  type AppPluginOptions,
  type RngSource,
  type TimeSource,
} from './deps.js';

export { buildNarrator, builtinSelector, type NarratorSelector } from './ai/narrator.js';

export { createCampaignService, type CampaignServiceOptions } from './game/campaign-service.js';
export { toEngineContent } from './game/content.js';
export {
  closeAllBurnWindows,
  openBurnWindows,
  runIntent,
  toAppendable,
  type GameDeps,
  type PipelineInput,
  type PipelineOutcome,
} from './game/intent-pipeline.js';
export { readCorrelationGroup, readJournalSince, toGameEvent } from './game/journal.js';
export { revertTurn, type RevertInput, type RevertResult } from './game/revert.js';
export { loadReplay, loadState } from './game/snapshots.js';
export { toTableState } from './game/table-state.js';
export type {
  CampaignService,
  PersistedEvent,
  SubmitIntentInput,
  SubmitIntentResult,
  TurnProofResult,
} from './game/types.js';

export {
  TableConnection,
  TableHub,
  WS_DELIVERY_TAIL_MAX,
  attachSocket,
  createTableHub,
  isVisibleTo,
  randomFrameIds,
  type AttachInput,
  type CampaignAccess,
  type ConnectionSession,
  type DeliveredEntry,
  type FrameIdSource,
  type HandshakeRequest,
  type PresenceMember,
  type WsLogger,
  type WsSocket,
} from './ws/index.js';
