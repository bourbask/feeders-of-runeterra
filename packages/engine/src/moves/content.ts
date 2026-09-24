/**
 * The CONTENT PORT of the engine: the shape of the versioned game content the
 * rules need in order to run, and nothing more.
 *
 * Why it exists at all. `03-donnees.md` section 3.3, rule 4: content the engine
 * needs arrives as a FROZEN ARGUMENT, at the version the campaign pins, never
 * loaded from the current disk. The engine cannot import `@for/content` or
 * `@for/contracts` (it declares zero dependencies), so the shapes below are
 * STRUCTURAL: they name the fields the rules read and stay silent about the
 * rest. `@for/content` hands over its own richer objects and they fit.
 *
 * What it deliberately does NOT carry: any French sentence the engine would
 * read, compare or build. The engine copies `text` and `label` verbatim into
 * payloads and never looks inside them.
 */

import type { OracleTable, WeightedEntry } from '../dice/oracle.js';
import type { PriceEntry } from '../dice/price.js';
import type { AttributeId } from '../types/attributes.js';
import type { EngineEffect } from '../types/effects.js';
import type { MoveId, Outcome } from '../types/moves.js';

/** `MoveSchema.rollKind` (03-donnees.md section 4.4). */
export type MoveRollKind = 'action' | 'progress' | 'none';

/**
 * One outcome of a move, seen by the engine: the effects it runs.
 *
 * `text` and `gmGuidance` exist in the content schema and are NOT read here.
 * They are the storyteller's material, assembled in `@for/ai`.
 */
export interface MoveOutcomeDefinition {
  readonly effects: readonly EngineEffect[];
}

/**
 * A move, seen by the engine.
 *
 * CONTENT DECIDES THE CONSEQUENCES, code decides the arithmetic. Everything a
 * move does on a given outcome is declared here as `EngineEffect`s; the handler
 * in `moves/<id>.ts` contributes only what a JSON file cannot express — which
 * attribute is forced, which track the roll targets, which state must hold.
 */
export interface MoveDefinition {
  readonly id: MoveId;
  readonly rollKind: MoveRollKind;
  readonly attributeOptions: readonly AttributeId[];
  readonly allowsMomentumBurn: boolean;
  readonly outcomes: Readonly<Record<Outcome, MoveOutcomeDefinition>>;
}

/** An entry of an oracle table or of the presage table. */
export interface OracleEntryDefinition extends WeightedEntry {
  readonly text: string;
  readonly tags?: readonly string[] | undefined;
}

/** A table, plus the version the journal records alongside the draw. */
export interface OracleTableDefinition extends OracleTable<OracleEntryDefinition> {
  readonly version: string;
}

/**
 * An entry of `pay-the-price`. Several `suggestedEffects` are arbitrated by a
 * SECOND draw on the `price` stream, never by a choice (ADR 0006).
 */
export interface PriceEntryDefinition extends PriceEntry<EngineEffect> {
  readonly text: string;
  readonly severity: string;
}

/** A condition, whose label the journal copies at the moment it is applied. */
export interface ConditionDefinition {
  readonly id: string;
  readonly label: string;
}

/**
 * Everything the engine reads from the content bundle, in one frozen argument.
 *
 * `moves` is PARTIAL on purpose: a bundle that is missing a move must produce
 * `unknown_move`, which is a rule violation the caller can render, rather than
 * an `undefined` travelling into a payload.
 */
export interface EngineContent {
  readonly moves: Readonly<Partial<Record<MoveId, MoveDefinition>>>;
  readonly oracles: Readonly<Record<string, OracleTableDefinition>>;
  readonly priceTable: OracleTable<PriceEntryDefinition>;
  readonly presageTable: OracleTableDefinition;
  readonly conditions: Readonly<Record<string, ConditionDefinition>>;
}
