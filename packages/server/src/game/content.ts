/**
 * The content bundle, seen by the engine.
 *
 * WHY THIS ADAPTER EXISTS AT ALL. `decide()` takes `ctx.content: EngineContent`
 * — a STRUCTURAL port declared in `@for/engine/moves/content.ts`, naming the
 * fields the rules read and staying silent about the rest (03-donnees.md
 * section 3.3, rule 4: content arrives as a frozen argument). `@for/content`
 * hands out `ContentRegistry`, whose shapes are the Zod ones. Nothing in the
 * repository joined the two before this file: M0-14 delivered the registry,
 * M0-13 delivered the port, and each was tested against a fixture of its own.
 * Reported as a gap rather than discovered again by the next task.
 *
 * IT COPIES, IT DOES NOT DECIDE. Every value below is read from the bundle and
 * carried over unchanged. The one JUDGEMENT it makes is which moves exist:
 * `EngineContent.moves` is keyed by `MoveId`, a closed tuple of eleven, while
 * the bundle's keys are free slugs. A slug that is not a `MoveId` is DROPPED
 * here rather than cast, and `unknown_move` — a rule violation the player can
 * be shown — is what the engine then answers. A cast would have put a string
 * the engine has no handler for into a payload.
 *
 * THE BUNDLE IS VALIDATED BEFORE THIS RUNS. `staticContent()` throws on a
 * bundle that would fail `pnpm content:check`, so nothing here re-checks a
 * shape; re-checking would be a second validator to keep in step with the
 * first.
 */

import { MOVE_IDS } from '@for/engine';

import type { ContentRegistry } from '@for/content';
import type {
  ConditionContent,
  MoveContent,
  OracleTableContent,
  PriceTableContent,
} from '@for/contracts';
import type {
  ConditionDefinition,
  EngineContent,
  MoveDefinition,
  MoveId,
  OracleTable,
  OracleTableDefinition,
  PriceEntryDefinition,
} from '@for/engine';

const MOVE_ID_SET: ReadonlySet<string> = new Set<string>(MOVE_IDS);

/** `true` when this slug is one of the eleven the engine has a handler for. */
function isMoveId(id: string): id is MoveId {
  return MOVE_ID_SET.has(id);
}

function toMoveDefinition(id: MoveId, move: MoveContent): MoveDefinition {
  return {
    id,
    rollKind: move.rollKind,
    attributeOptions: move.attributeOptions,
    allowsMomentumBurn: move.allowsMomentumBurn,
    outcomes: {
      franche: { effects: move.outcomes.franche.effects },
      partielle: { effects: move.outcomes.partielle.effects },
      echec: { effects: move.outcomes.echec.effects },
    },
  };
}

/**
 * `version` is the BUNDLE's version, not the table's.
 *
 * `roll.oracle_resolved.tableVersion` records "which version of the content
 * answered this", and a table file carries no version of its own: the bundle
 * is versioned as a whole and pinned per campaign
 * (`campaigns.content_pack_version`). Said here rather than left to be guessed
 * from a field name.
 */
function toOracleDefinition(table: OracleTableContent, version: string): OracleTableDefinition {
  return {
    id: table.id,
    die: table.die,
    version,
    entries: table.entries.map((entry) => ({
      id: entry.id,
      min: entry.min,
      max: entry.max,
      text: entry.text,
      tags: entry.tags,
    })),
  };
}

function toPriceTable(table: PriceTableContent): OracleTable<PriceEntryDefinition> {
  return {
    id: table.id,
    die: table.die,
    entries: table.entries.map((entry) => ({
      id: entry.id,
      min: entry.min,
      max: entry.max,
      text: entry.text,
      severity: entry.severity,
      suggestedEffects: entry.suggestedEffects,
    })),
  };
}

/** `label` is the condition's `name`: what the journal copies when it applies one. */
function toCondition(condition: ConditionContent): ConditionDefinition {
  return { id: condition.id, label: condition.name };
}

/** The whole bundle, in the shape `decide()` reads. */
export function toEngineContent(registry: ContentRegistry): EngineContent {
  const { bundle } = registry;

  const moves: Partial<Record<MoveId, MoveDefinition>> = {};
  for (const move of registry.listMoves()) {
    if (isMoveId(move.id)) moves[move.id] = toMoveDefinition(move.id, move);
  }

  const oracles: Record<string, OracleTableDefinition> = {};
  for (const table of registry.listOracles()) {
    oracles[table.id] = toOracleDefinition(table, bundle.version);
  }

  const conditions: Record<string, ConditionDefinition> = {};
  for (const condition of registry.listConditions()) {
    conditions[condition.id] = toCondition(condition);
  }

  return {
    moves,
    oracles,
    priceTable: toPriceTable(bundle.priceTable),
    presageTable: toOracleDefinition(bundle.presages, bundle.version),
    conditions,
  };
}
