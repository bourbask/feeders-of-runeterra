/**
 * The repositories: the only write path for game state (section 2).
 *
 * Every function takes a `SqliteConnection` rather than holding one. Section
 * 0.3 makes the process a single writer; a repository that owned a connection
 * would be a second place where that rule could be broken.
 *
 * `campaigns.ts` and `events.ts` both name a "sequence" function, so the two
 * are re-exported under the names they earn: `campaignSeq` reads the counter
 * and may say "no such campaign"; `lastSeq` is the journal's view of it and
 * raises instead.
 */

export * from './aiCalls.js';
export * from './campaigns.js';
export * from './characters.js';
export * from './chronicles.js';
export * from './events.js';
export * from './intents.js';
export * from './players.js';
export * from './rows.js';
