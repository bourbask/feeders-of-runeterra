/**
 * State builders (`01-architecture.md` section 7.2).
 *
 * The transverse rule they serve: **every test that needs a table state goes
 * through a builder here**. No literal state object in a test file — otherwise
 * one field added to the engine means fifty files to edit, and the fiftieth is
 * the one nobody edits.
 *
 * Five files, one job each:
 *
 *   ids.ts        identifiers that parse (`zEventId` refuses `ev-1`)
 *   characters.ts `aCharacter()`
 *   table.ts      `aTableState()` and everything it contains
 *   events.ts     `anEvent()`
 *   campaigns.ts  `aJournal()` and `LONG_CAMPAIGN`
 *   champions.ts  the reserved-champion list the lock assertion needs
 */

export { RESERVED_CHAMPIONS, reservedChampionNames } from './champions.js';
export type { ReservedChampion } from './champions.js';

export { JOURNAL_TURN_LENGTH, LONG_CAMPAIGN, LONG_CAMPAIGN_LENGTH, aJournal } from './campaigns.js';
export type { JournalOptions } from './campaigns.js';

export {
  FIXTURE_ATTRIBUTES,
  FIXTURE_GAUGES,
  FIXTURE_MOMENTUM_BOUNDS,
  aCharacter,
} from './characters.js';
export type { CharacterOverrides } from './characters.js';

export { FIXTURE_EPOCH, FIXTURE_TICK_MS, anEvent, fixtureCreatedAt } from './events.js';
export type { EnvelopeOverrides, EventOverrides } from './events.js';

export { aCorrelationId, anId } from './ids.js';
export type { FixtureIdKind } from './ids.js';

export {
  aCampaignSettings,
  aChampionLock,
  aClock,
  aScene,
  aSceneAbsence,
  aScenePresence,
  aTableState,
  aTrack,
  aTruth,
  aVow,
  anEntity,
} from './table.js';
export type { TableStateOverrides } from './table.js';
