/**
 * The real content bundle, in the shape `decide()` reads.
 *
 * THE DEMO CAMPAIGN PLAYS THE CONTENT THE GAME SHIPS, not a fixture. That is
 * the whole reason this adapter exists: a seed built on a hand-written bundle
 * would produce a journal no live table could ever produce, and the eval
 * harness, the migration fixture and the end-to-end tests would all be
 * measuring something that does not exist (03-donnees.md section 7.1, the four
 * uses of the seed).
 *
 * The mapping is nearly the identity, by design: `EngineContent` is
 * STRUCTURAL (`engine/src/moves/content.ts`) and `@for/content` hands over
 * richer objects that fit it. Exactly three things have to be said out loud:
 *
 *   - `MoveContent.id` is a `SlugSchema` string and `MoveDefinition.id` is the
 *     closed `MoveId` union, so the eleven moves are keyed through `MOVE_IDS`
 *     and a bundle missing one is refused HERE rather than producing an
 *     `unknown_move` half way through a demo turn;
 *   - `OracleTableDefinition` wants a `version` that no oracle file carries.
 *     The bundle's own version is used — it is what `roll.oracle_resolved`
 *     records and what `content_packs.version` pins, so the three agree;
 *   - `ConditionDefinition.label` is `ConditionContent.name`. The engine copies
 *     that label verbatim into `character.condition_added` and never reads
 *     inside it.
 *
 * ── A DECLARED DEPENDENCY, LIKE THE ONE M0-17 DECLARED ───────────────────
 * ARCHITECTURE.md section 5 lists the runtime dependencies of `@for/db`; it
 * does not list `@for/content`. The edge is a DEV dependency and is reachable
 * from nowhere but `src/seed/**`, which `src/index.ts` does not export: the
 * demo campaign is a development artefact, `pnpm db:seed` refuses to run under
 * `NODE_ENV=production`, and no consumer of `@for/db` can reach this file.
 * No `dependency-cruiser` rule forbids `db -> content`. Reported, not
 * smuggled: `docs/` is not this task's to edit.
 */

import { createHash } from 'node:crypto';

import { GENERATED_FILES, staticContent } from '@for/content';
import type {
  ConditionDefinition,
  EngineContent,
  MoveDefinition,
  MoveId,
  OracleTableDefinition,
  PriceEntryDefinition,
} from '@for/engine';
import { MOVE_IDS, PRICE_TABLE_ID } from '@for/engine';

/** The presage table's pinned identifier (`PresageTableSchema`). */
export const PRESAGE_TABLE_ID = 'presages';

/** Raised when the bundle cannot serve a rule the engine needs. */
export class DemoContentIncomplete extends Error {
  constructor(detail: string) {
    super(`contenu insuffisant pour la campagne de démonstration : ${detail}`);
    this.name = 'DemoContentIncomplete';
  }
}

export interface DemoContent {
  readonly engine: EngineContent;
  /** `manifest.json` version. Written into `campaign.created` and `content_packs`. */
  readonly version: string;
  /** sha256 of the canonical bundle. `campaigns.content_pack_hash`. */
  readonly hash: string;
  readonly rulesVersion: number;
  /** How many JSON files the pack holds. `content_packs.file_count`. */
  readonly fileCount: number;
  /** The three hand-written champion sheets, frozen into `character.created`. */
  championSheet(championId: string): Readonly<Record<string, unknown>>;
}

/** The bundle compiled into `@for/content`, adapted once. */
export function demoContent(): DemoContent {
  const registry = staticContent();
  const bundle = registry.bundle;

  const moves: Partial<Record<MoveId, MoveDefinition>> = {};
  for (const id of MOVE_IDS) {
    const move = bundle.moves.get(id);
    if (move === undefined) throw new DemoContentIncomplete(`mouvement « ${id} » absent`);
    moves[id] = {
      id,
      rollKind: move.rollKind,
      attributeOptions: move.attributeOptions,
      allowsMomentumBurn: move.allowsMomentumBurn,
      outcomes: move.outcomes,
    };
  }

  const oracles: Record<string, OracleTableDefinition> = {};
  for (const [id, table] of bundle.oracles) {
    oracles[id] = { id, die: table.die, entries: table.entries, version: bundle.version };
  }

  const conditions: Record<string, ConditionDefinition> = {};
  for (const [id, condition] of bundle.conditions) {
    conditions[id] = { id, label: condition.name };
  }

  const priceEntries: readonly PriceEntryDefinition[] = bundle.priceTable.entries.map((entry) => ({
    id: entry.id,
    min: entry.min,
    max: entry.max,
    text: entry.text,
    severity: entry.severity,
    suggestedEffects: entry.suggestedEffects,
  }));

  const engine: EngineContent = {
    moves,
    oracles,
    priceTable: { id: PRICE_TABLE_ID, die: bundle.priceTable.die, entries: priceEntries },
    presageTable: {
      id: PRESAGE_TABLE_ID,
      die: bundle.presages.die,
      entries: bundle.presages.entries,
      version: bundle.version,
    },
    conditions,
  };

  return {
    engine,
    version: bundle.version,
    hash: bundle.hash,
    rulesVersion: bundle.rulesVersion,
    fileCount: Object.keys(GENERATED_FILES).length,
    championSheet(championId: string): Readonly<Record<string, unknown>> {
      const champion = bundle.champions.get(championId);
      if (champion === undefined) {
        throw new DemoContentIncomplete(`fiche de champion « ${championId} » absente`);
      }
      return champion;
    },
  };
}

/**
 * The pack the campaign OPENED on, one patch below the shipped one.
 *
 * Derived from the real version and the real hash rather than written out
 * twice: `campaign.content_pack_changed` names the pair in the journal and
 * `content_packs` holds a row for it, and the two must agree or `db:check`
 * control 12 says so. One function, two callers, nothing to keep in step.
 */
export function previousPackVersion(version: string): string {
  const [major = '0', minor = '0', patch = '0'] = version.split('.');
  if (Number(patch) > 0) return `${major}.${minor}.${String(Number(patch) - 1)}`;
  if (Number(minor) > 0) return `${major}.${String(Number(minor) - 1)}.9`;
  return `${String(Math.max(0, Number(major) - 1))}.9.9`;
}

export function previousPackHash(hash: string): string {
  return createHash('sha256').update(`pack-precedent|${hash}`).digest('hex');
}
