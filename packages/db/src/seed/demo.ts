/**
 * `pnpm db:seed` — « Le Pacte de la Griffe-de-Givre », the demo campaign.
 *
 * ONE SEED, FOUR USES (03-donnees.md section 7.1): starting the application
 * locally in one command, backing the end-to-end tests, serving as a migration
 * fixture, and handing the AI eval harness a realistic game state. Two seeds
 * would diverge inside a fortnight, which is why `--minimal` is a STOP MARK in
 * the same script and not a second script.
 *
 * ── THE JOURNAL IS THE ONLY WAY IN ───────────────────────────────────────
 * Nothing here writes a projection. The demo is built by APPENDING to the
 * journal and then calling `rebuildCampaign`, which is the same replay
 * `pnpm db:rebuild` runs — so `db:check` control 9 compares a state this file
 * never touched against a state the reducer rebuilt. A gauge posted straight
 * into `characters` would show up there as a divergence, and that is exactly
 * what invariant 4 buys.
 *
 * The platform rows this file DOES write — players, the campaign, membership,
 * play sessions, content packs, forged sheets, AI calls, chronicles, snapshots
 * — are zones A and B, not projections: they are not derivable from the
 * journal and `db:rebuild` does not touch them. Even so, every one that CAN be
 * derived IS derived: the play sessions come from `session.opened` /
 * `session.closed`, the chronicles from `chronicle.compacted`, the AI calls
 * from the entries that name one, the snapshots from the snapshot policy
 * applied to the journal. That is what keeps `--minimal` honest without a
 * second list to maintain.
 *
 * ── DETERMINISM, AND THE THREE THINGS IT RESTS ON ────────────────────────
 * Same ULIDs, same instants, same dice (section 7.2). They come from
 * `DEMO_SEED` and nothing else: `monotonicUlidFactory` for identifiers,
 * `epoch` plus a fixed step for instants, `createCampaignRng(rngSeed, seq,
 * stream)` for draws. No `Date.now()`, no `Math.random()`, no `crypto`
 * anywhere under `src/seed/**`. Two runs of `pnpm db:seed --force` therefore
 * give two files with the same sha256 after `VACUUM`, which
 * `tests/seed-deterministic.test.ts` measures rather than assumes.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { stateHash } from '../check.js';
import type { SqliteConnection } from '../client.js';
import { openSqlite } from '../client.js';
import { migrateFile } from '../migrate.js';
import { rebuildCampaign, replayCampaign, replayJournal } from '../rebuild.js';
import { readSince } from '../repositories/events.js';
import type { JournalEvent } from '../repositories/rows.js';
import {
  DEMO_CHARACTERS,
  DEMO_DISCORD_BASE,
  DEMO_ENTITIES,
  DEMO_PLAYERS,
  FORGED_SHEETS,
} from './cast.js';
import { CHRONICLE_VERSIONS } from './chronicles.js';
import { DemoStopped, Director } from './director.js';
import type { DemoContent } from './engine-content.js';
import { demoContent, previousPackHash, previousPackVersion } from './engine-content.js';
import { monotonicUlidFactory } from './ids.js';
import type { DemoStage, RegisteredAiCall } from './script.js';
import { FIRST_SCENE_MARK, playDemoCampaign } from './script.js';

import { zChronicleDoc } from '@for/contracts';
import type {
  AiCallId,
  CampaignId,
  CharacterId,
  ChronicleId,
  EntityId,
  IdFactory,
  PlayerId,
  PlaySessionId,
} from '@for/engine';
import { createInitialCampaignState } from '@for/engine';

/**
 * The seed of every number in this campaign (03-donnees.md section 7.2).
 *
 * `epoch` is a fixed instant, not "now minus something": a relative instant
 * would make two runs differ and the sha256 criterion untestable.
 */
export const DEMO_SEED = {
  /** Campaign master seed. Every die derives from it. */
  rngSeed: '00'.repeat(32),
  /** 15 January 2026, 20:00 UTC — the evening the table first met. */
  epoch: Date.UTC(2026, 0, 15, 20, 0, 0),
  /** First identifier handed out. Everything else is this one, incremented. */
  ulidSeed: '01JQ0000000000000000000000',
  /** Milliseconds between two beats of the script. */
  step: 90_000,
  /** Between the two play sessions, a week goes by. */
  betweenSessions: 7 * 24 * 60 * 60 * 1000,
} as const;

export const DEMO_CAMPAIGN_SLUG = 'pacte-griffe-de-givre';
export const DEMO_CAMPAIGN_NAME = 'Le Pacte de la Griffe-de-Givre';
export const DEMO_CAMPAIGN_PITCH =
  "Trois clans, un col qui se referme, et un serment que personne n'a envie de jurer le premier.";

/**
 * How many entries `pnpm db:seed --minimal` writes.
 *
 * SPELLED OUT, NOT COMPUTED, and that is the whole point of the acceptance
 * criterion: « ≈ 40 » cannot be checked, a constant can. It is a CONTRACT other
 * tasks may rely on, so the test compares `SELECT count(*) FROM events` against
 * this number — two independent paths, one literal and one query. Deriving it
 * from the script would make the assertion compare the script to itself.
 */
export const DEMO_MINIMAL_EVENT_COUNT = 44;

/** The snapshot cadence of ARCHITECTURE.md section 4.5: one every 200 entries. */
export const SNAPSHOT_EVERY = 200;

export interface SeedOptions {
  /** Stop at the end of the first scene. */
  readonly minimal?: boolean;
}

export interface SeedReport {
  readonly campaignId: string;
  readonly events: number;
  /** Distinct event types the journal holds. */
  readonly types: number;
  readonly characters: number;
  readonly sessions: number;
  readonly chronicles: number;
  readonly snapshots: number;
  readonly minimal: boolean;
}

/** Raised when the base already holds the demo campaign. */
export class AlreadySeededError extends Error {
  constructor(readonly campaignId: string) {
    super(`la campagne de démonstration est déjà en base (${campaignId})`);
    this.name = 'AlreadySeededError';
  }
}

// ---------------------------------------------------------------- identities

/** Every identifier of the campaign, minted before the first journal entry. */
export interface DemoIdentities {
  readonly campaignId: CampaignId;
  readonly players: ReadonlyMap<string, PlayerId>;
  readonly characters: ReadonlyMap<string, CharacterId>;
  readonly entities: ReadonlyMap<string, EntityId>;
  readonly sessions: readonly PlaySessionId[];
  readonly chronicles: readonly ChronicleId[];
}

function mintIdentities(ids: IdFactory): DemoIdentities {
  const campaignId = ids.next() as CampaignId;
  const players = new Map<string, PlayerId>();
  for (const player of DEMO_PLAYERS) players.set(player.handle, ids.next() as PlayerId);
  const characters = new Map<string, CharacterId>();
  for (const character of DEMO_CHARACTERS) characters.set(character.key, ids.next() as CharacterId);
  const entities = new Map<string, EntityId>();
  for (const entity of DEMO_ENTITIES) entities.set(entity.key, ids.next() as EntityId);
  const sessions = [ids.next() as PlaySessionId, ids.next() as PlaySessionId];
  const chronicles = CHRONICLE_VERSIONS.map(() => ids.next() as ChronicleId);
  return { campaignId, players, characters, entities, sessions, chronicles };
}

// --------------------------------------------------------------- the seeding

/**
 * Writes the demo campaign into an already-migrated, empty base.
 *
 * Refuses a base that already holds it: `pnpm db:seed` is idempotent by
 * refusal rather than by overwrite, because the journal is append-only and
 * "re-seed" is not a thing one can do to it. `--force` recreates the FILE.
 */
/** A map lookup that names what was missing instead of handing back `undefined`. */
function demand<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`identité manquante : ${what}`);
  return value;
}

export function seedDemo(connection: SqliteConnection, options: SeedOptions = {}): SeedReport {
  const existing = connection
    .prepare(`SELECT id FROM campaigns WHERE slug = ?`)
    .get(DEMO_CAMPAIGN_SLUG) as { id: string } | undefined;
  if (existing !== undefined) throw new AlreadySeededError(existing.id);

  const minimal = options.minimal ?? false;
  const content = demoContent();
  const ids = monotonicUlidFactory(DEMO_SEED.ulidSeed);
  const identities = mintIdentities(ids);
  const aiCalls: RegisteredAiCall[] = [];

  writePlatformRows(connection, identities, content);

  const director = new Director({
    connection,
    campaignId: identities.campaignId,
    ownerPlayerId: demand(identities.players.get('demo-mj'), 'demo-mj'),
    seed: DEMO_SEED.rngSeed,
    content: content.engine,
    ids,
    epoch: DEMO_SEED.epoch,
    step: DEMO_SEED.step,
    initialState: createInitialCampaignState({
      campaignId: identities.campaignId,
      ownerPlayerId: demand(identities.players.get('demo-mj'), 'demo-mj'),
      seed: DEMO_SEED.rngSeed,
      contentPackHash: content.hash,
    }),
    stopAt: minimal ? FIRST_SCENE_MARK : null,
  });

  const stage: DemoStage = {
    director,
    ids,
    content,
    identities,
    registerAiCall(call: RegisteredAiCall): AiCallId {
      aiCalls.push(call);
      return call.id;
    },
  };

  try {
    playDemoCampaign(stage);
  } catch (error) {
    if (!(error instanceof DemoStopped)) throw error;
  }

  const journal = readSince(connection, identities.campaignId, 0);
  writeDerivedRows(connection, identities, content, journal, aiCalls);
  rebuildCampaign(connection, identities.campaignId);

  return {
    campaignId: identities.campaignId,
    events: journal.length,
    types: new Set(journal.map((event) => event.type)).size,
    characters: journal.filter((event) => event.type === 'character.created').length,
    sessions: journal.filter((event) => event.type === 'session.opened').length,
    chronicles: journal.filter((event) => event.type === 'chronicle.compacted').length,
    snapshots: (
      connection
        .prepare(`SELECT count(*) AS n FROM snapshots WHERE campaign_id = ?`)
        .get(identities.campaignId) as { n: number }
    ).n,
    minimal,
  };
}

/** Zone A and zone B: what no replay could ever produce. */
function writePlatformRows(
  connection: SqliteConnection,
  identities: DemoIdentities,
  content: DemoContent,
): void {
  const at = DEMO_SEED.epoch;

  const insertPlayer = connection.prepare(
    `INSERT INTO players (id, discord_user_id, discord_username, discord_global_name,
       discord_avatar_hash, discord_email, locale, is_admin, created_at, updated_at,
       last_seen_at, deleted_at)
     VALUES (?, ?, ?, ?, NULL, NULL, 'fr', ?, ?, ?, ?, NULL)`,
  );
  for (const [index, player] of DEMO_PLAYERS.entries()) {
    insertPlayer.run(
      identities.players.get(player.handle),
      (DEMO_DISCORD_BASE + BigInt(index)).toString(),
      player.handle,
      player.displayName,
      index === 0 ? 1 : 0,
      at,
      at,
      at,
    );
  }

  // Two packs: the one the campaign opened on, and the one it moved to between
  // the sessions (`campaign.content_pack_changed`). Control 12 requires the
  // campaign's CURRENT hash to be one of them.
  const insertPack = connection.prepare(
    `INSERT INTO content_packs (hash, version, file_count, manifest_json, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertPack.run(
    previousPackHash(content.hash),
    previousPackVersion(content.version),
    content.fileCount,
    JSON.stringify({
      version: previousPackVersion(content.version),
      note: 'pack de la première séance',
    }),
    at,
    at,
  );
  insertPack.run(
    content.hash,
    content.version,
    content.fileCount,
    JSON.stringify({ version: content.version, rulesVersion: content.rulesVersion }),
    at,
    at,
  );

  connection
    .prepare(
      `INSERT INTO campaigns (id, slug, name, pitch, owner_player_id, status,
         content_pack_version, content_pack_hash, rules_version, reducer_version, rng_seed,
         seq, settings_json, truths_json, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, 0, '{}', '[]', ?, ?, NULL)`,
    )
    .run(
      identities.campaignId,
      DEMO_CAMPAIGN_SLUG,
      DEMO_CAMPAIGN_NAME,
      DEMO_CAMPAIGN_PITCH,
      identities.players.get('demo-mj'),
      previousPackVersion(content.version),
      previousPackHash(content.hash),
      content.rulesVersion,
      1,
      DEMO_SEED.rngSeed,
      at,
      at,
    );
}

/** Everything the journal itself dictates: sessions, calls, chronicles, snapshots. */
function writeDerivedRows(
  connection: SqliteConnection,
  identities: DemoIdentities,
  content: DemoContent,
  journal: readonly JournalEvent[],
  aiCalls: readonly RegisteredAiCall[],
): void {
  const { campaignId } = identities;
  const at = DEMO_SEED.epoch;

  // ---- membership. `character_id` names the character the player ENDED with.
  const owner = demand(identities.players.get('demo-mj'), 'demo-mj');
  const active = new Map<string, string>();
  for (const event of journal) {
    if (event.type !== 'character.created') continue;
    const payload = event.payload as { playerId: string; characterId: string };
    if (!active.has(payload.playerId)) active.set(payload.playerId, payload.characterId);
  }
  const insertMember = connection.prepare(
    `INSERT INTO campaign_members (id, campaign_id, player_id, role, character_id, invited_by,
       joined_at, left_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  );
  for (const [index, player] of DEMO_PLAYERS.entries()) {
    const playerId = demand(identities.players.get(player.handle), player.handle);
    insertMember.run(
      `${campaignId}-m${String(index)}`,
      campaignId,
      playerId,
      index === 0 ? 'owner' : 'player',
      active.get(playerId) ?? null,
      index === 0 ? null : owner,
      at,
      at,
      at,
    );
  }

  // ---- play sessions, read off `session.opened` / `session.closed`.
  const insertSession = connection.prepare(
    `INSERT INTO play_sessions (id, campaign_id, ordinal, title, status, discord_channel_id,
       scheduled_for, started_at, ended_at, first_event_seq, last_event_seq, recap_chronicle_id,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const event of journal) {
    if (event.type !== 'session.opened') continue;
    const payload = event.payload as { playSessionId: string; ordinal: number; title?: string };
    const closing = journal.find(
      (candidate) =>
        candidate.type === 'session.closed' &&
        (candidate.payload as { playSessionId: string }).playSessionId === payload.playSessionId,
    );
    const closed = closing?.payload as
      { firstSeq: number; lastSeq: number; recapChronicleId?: string } | undefined;
    insertSession.run(
      payload.playSessionId,
      campaignId,
      payload.ordinal,
      payload.title ?? null,
      closed === undefined ? 'live' : 'ended',
      event.createdAt,
      closing?.createdAt ?? null,
      closed?.firstSeq ?? event.seq,
      closed?.lastSeq ?? journal[journal.length - 1]?.seq ?? event.seq,
      closed?.recapChronicleId ?? null,
      at,
      at,
    );
  }

  // ---- forged sheets, for the two characters whose sheet is not in `content/`.
  const insertSheet = connection.prepare(
    `INSERT INTO champion_sheets (id, champion_id, campaign_id, schema_version, prompt_version,
       sheet_json, raw_output_json, repairs_json, content_hash, status, forged_by_player_id,
       model, ai_call_id, review_notes, created_at, reviewed_at)
     VALUES (?, ?, ?, 1, 'forge/1.0.0', ?, NULL, ?, ?, 'active', ?, 'stub', NULL, ?, ?, ?)`,
  );
  const created = new Set(
    journal
      .filter((event) => event.type === 'character.created')
      .map((event) => (event.payload as { championId: string }).championId),
  );
  for (const [championId, sheet] of Object.entries(FORGED_SHEETS)) {
    if (!created.has(championId)) continue;
    const json = JSON.stringify(sheet);
    insertSheet.run(
      `${campaignId}-sheet-${championId}`,
      championId,
      campaignId,
      json,
      JSON.stringify([{ pass: 1, field: 'voice.tics', note: 'deux tics au lieu de trois' }]),
      createHash('sha256').update(json).digest('hex'),
      owner,
      'fiche forgée, relue par le propriétaire de la table',
      at,
      at,
    );
  }

  // ---- AI calls: only those an entry of the journal actually names.
  const referenced = new Set<string>();
  for (const event of journal) {
    const payload = event.payload as { aiCallId?: string };
    if (typeof payload.aiCallId === 'string') referenced.add(payload.aiCallId);
  }
  const insertCall = connection.prepare(
    `INSERT INTO ai_calls (id, campaign_id, purpose, provider, model, prompt_version, system_hash,
       request_json, response_text, tool_calls_json, finish_reason, error_code, repair_passes,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, latency_ms,
       trim_level, context_hash, status, error_text, resulting_event_seq, eval_tags_json,
       created_at)
     VALUES (?, ?, ?, 'stub', ?, ?, ?, NULL, ?, NULL, ?, ?, 0, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, '[]', ?)`,
  );
  for (const call of aiCalls) {
    if (!referenced.has(call.id)) continue;
    insertCall.run(
      call.id,
      campaignId,
      call.purpose,
      call.model,
      call.promptVersion,
      createHash('sha256').update(`${call.promptVersion}|${content.hash}`).digest('hex'),
      call.responseText,
      call.finishReason,
      call.errorCode,
      call.inputTokens,
      call.outputTokens,
      call.latencyMs,
      call.trimLevel,
      createHash('sha256').update(`${call.id}|contexte`).digest('hex'),
      call.status,
      call.errorText,
      call.resultingEventSeq,
      call.createdAt,
    );
  }

  // ---- chronicles: one row per `chronicle.compacted`, doc written by hand.
  const insertChronicle = connection.prepare(
    `INSERT INTO chronicles (id, campaign_id, version, kind, source_event_seq, doc_json,
       rendered_md, token_count, model, prompt_version, ai_call_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stub', 'chronique/1.0.0', ?, ?)`,
  );
  for (const event of journal) {
    if (event.type !== 'chronicle.compacted') continue;
    const payload = event.payload as {
      chronicleId: string;
      version: number;
      kind: string;
      sourceEventSeq: number;
      aiCallId: string;
      tokenCount: number;
    };
    const written = CHRONICLE_VERSIONS[payload.version - 1];
    if (written === undefined) {
      throw new Error(`aucune chronique écrite pour la version ${String(payload.version)}`);
    }
    // PROVENANCE, CHECKED RATHER THAN PROMISED. A hand-written chronicle is a
    // hand-written document: nothing stops it from citing a sequence that does
    // not exist, and a fact with no journal line behind it is exactly the
    // invention 02-mj-ia.md section 5.2 exists to stop. Both halves are
    // measured — the shape against `zChronicleDoc`, the provenance against
    // this journal.
    const parsed = zChronicleDoc.safeParse(written.doc);
    if (!parsed.success) {
      throw new Error(
        `chronique v${String(payload.version)} invalide : ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join(' ; ')}`,
      );
    }
    for (const fact of written.doc.facts) {
      if (fact.event_seq < 1 || fact.event_seq > payload.sourceEventSeq) {
        throw new Error(
          `chronique v${String(payload.version)} : le fait ${fact.fact_id} cite la séquence ` +
            `${String(fact.event_seq)}, hors de 1..${String(payload.sourceEventSeq)}`,
        );
      }
    }
    insertChronicle.run(
      payload.chronicleId,
      campaignId,
      payload.version,
      payload.kind,
      payload.sourceEventSeq,
      JSON.stringify(written.doc),
      written.renderedMd,
      payload.tokenCount,
      payload.aiCallId,
      event.createdAt,
    );
  }

  // ---- snapshots: the cadence of section 4.5, applied to this journal.
  const insertSnapshot = connection.prepare(
    `INSERT INTO snapshots (id, campaign_id, seq, reducer_version, state_json, state_hash,
       size_bytes, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const milestones: { seq: number; kind: 'rolling' | 'session_end' }[] = [];
  for (let seq = SNAPSHOT_EVERY; seq <= journal.length; seq += SNAPSHOT_EVERY) {
    milestones.push({ seq, kind: 'rolling' });
  }
  for (const event of journal) {
    if (event.type !== 'session.closed') continue;
    const lastSeq = (event.payload as { lastSeq: number }).lastSeq;
    if (!milestones.some((milestone) => milestone.seq === lastSeq)) {
      milestones.push({ seq: lastSeq, kind: 'session_end' });
    }
  }
  milestones.sort((a, b) => a.seq - b.seq);
  const replay = replayCampaign(connection, campaignId);
  for (const milestone of milestones) {
    const upTo = journal.filter((event) => event.seq <= milestone.seq);
    const state =
      upTo.length === journal.length ? replay.state : replayJournal(campaignId, upTo).state;
    const json = JSON.stringify(state);
    insertSnapshot.run(
      `${campaignId}-snap-${String(milestone.seq)}`,
      campaignId,
      milestone.seq,
      state.reducerVersion,
      json,
      stateHash(state),
      json.length,
      milestone.kind,
      at,
    );
  }

  // ---- zone A fields the journal decided: status, settings, truths, pack.
  const final = replay.state;
  connection
    .prepare(
      `UPDATE campaigns SET status = ?, settings_json = ?, truths_json = ?,
         content_pack_hash = ?, content_pack_version = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      final.status,
      JSON.stringify(final.settings),
      JSON.stringify(final.truths),
      final.contentPackHash,
      final.contentPackHash === content.hash
        ? content.version
        : previousPackVersion(content.version),
      journal[journal.length - 1]?.createdAt ?? at,
      campaignId,
    );
}

// ---------------------------------------------------------------- file level

export interface SeedFileOptions extends SeedOptions {
  /** Delete the file first. The journal is append-only: there is no re-seed. */
  readonly force?: boolean;
}

/**
 * `pnpm db:seed` on a path: migrate if needed, seed, checkpoint, `VACUUM`.
 *
 * The `VACUUM` is not cosmetic. The sha256 criterion compares two FILES, and a
 * WAL left beside the base would make the comparison depend on when the last
 * checkpoint happened rather than on the content.
 */
export function seedDemoFile(path: string, options: SeedFileOptions = {}): SeedReport {
  const target = resolve(path);
  if (options.force === true) removeDatabaseFiles(target);
  mkdirSync(dirname(target), { recursive: true });

  const connection = migrateFile(target);
  try {
    const report = seedDemo(connection, options);
    connection.pragma('wal_checkpoint(TRUNCATE)');
    connection.exec('VACUUM');
    return report;
  } finally {
    connection.close();
  }
}

/** The base and its two sidecars. Removing only the first leaves a live WAL. */
export function removeDatabaseFiles(target: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${target}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }
}

/** Opens a base read-only and answers whether the demo campaign is in it. */
export function isSeeded(target: string): boolean {
  if (!existsSync(target)) return false;
  const connection = openSqlite(target, { readonly: true });
  try {
    const row = connection
      .prepare(`SELECT id FROM campaigns WHERE slug = ?`)
      .get(DEMO_CAMPAIGN_SLUG) as { id: string } | undefined;
    return row !== undefined;
  } finally {
    connection.close();
  }
}
