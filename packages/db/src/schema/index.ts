/**
 * The 21 tables of 03-donnees.md section 1, in the four zones of section 0.4.
 *
 * | Zone | What it holds | Rebuildable? |
 * |---|---|---|
 * | A — platform | `players`, `auth_sessions`, `oauth_states`, `campaigns`, `campaign_members`, `play_sessions`, `intents`, `content_packs` | no, back it up |
 * | B — journal | `events` | no, it IS the backup |
 * | C — caches | `snapshots`, `characters`, `progress_tracks`, `clocks`, `entities`, `scene_state`, `campaign_champion_locks` | yes, `pnpm db:rebuild` |
 * | D — AI memory | `chronicles`, `chronicle_jobs`, `ai_turn_renders`, `champion_sheets`, `ai_calls` | no, but not critical |
 *
 * This is the file `drizzle.config.ts` points at, so a table absent from this
 * barrel is a table absent from the migrations.
 *
 * ONE DEPENDENCY THE ARCHITECTURE TABLE DOES NOT LIST, and why it is there.
 * `01-architecture.md` section 1.1 gives `@for/db` three runtime dependencies:
 * `drizzle-orm`, `better-sqlite3`, `@for/contracts`. That is still exactly
 * what `dependencies` holds. But the JSON columns are typed from the contracts
 * DTOs, as section 0.1 requires, and two of those DTOs — `CampaignStateDto`
 * and `IntentDto` — carry the engine's branded identifiers. TypeScript's
 * declaration emit then writes `import("@for/engine").Branded<"TrackId">` into
 * `dist/schema/*.d.ts`, and `pnpm depcruise` fails on an unresolvable edge.
 * `@for/engine` is therefore a DEV dependency here: type-only, erased at
 * runtime, exactly the nature of the `contracts -> engine` edge of section 1.2
 * rule 2. Reported rather than silently worked around with `unknown`.
 */

export * from './ai.js';
export * from './campaigns.js';
export * from './events.js';
export * from './intents.js';
export * from './players.js';
export * from './projections.js';

/** Every table name the DDL defines. `db:check-schema` counts against it. */
export const TABLE_NAMES = [
  'ai_calls',
  'ai_turn_renders',
  'auth_sessions',
  'campaign_champion_locks',
  'campaign_members',
  'campaigns',
  'champion_sheets',
  'characters',
  'chronicle_jobs',
  'chronicles',
  'clocks',
  'content_packs',
  'entities',
  'events',
  'intents',
  'oauth_states',
  'play_sessions',
  'players',
  'progress_tracks',
  'scene_state',
  'snapshots',
] as const;
