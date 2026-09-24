/**
 * The TWELVE tools exposed to the model (02-mj-ia.md section 3), inputs and
 * outputs.
 *
 * ── THERE IS NO THIRTEENTH TOOL, AND ABOVE ALL NO PRICE TOOL ────────────────
 * P10 and ADR 0006 closed that circuit for good: when a move calls for "pay
 * the price", the engine rolls a d12 on the content table, applies the entry,
 * writes `roll.price_paid`, and hands the entry to the storyteller as an
 * IMPOSED FACT. Nobody chooses — not the model, not the player. Reopening it
 * would take an ADR, a thirteenth tool, a `TOOLS_VERSION` bump and the
 * invalidation of every campaign's prompt cache. That price is the guard.
 *
 * ── WHAT THE INPUT SCHEMAS ARE FOR ──────────────────────────────────────────
 * They are the model → server direction, which is the only direction where
 * invariant 1 can be lost. Every one is `.strict()` and has no optional field,
 * so its JSON Schema carries `additionalProperties: false` and a COMPLETE
 * `required` (section 3.1). `tests/ai/tools.test.ts` converts each of the
 * twelve and walks the tree for both properties rather than trusting the
 * author — a tool that "looks strict" is not a tool that is.
 *
 * Absent fields are written `z.string().nullable()`, never `.optional()`: an
 * optional field disappears from `required`, and half the providers then treat
 * it as free to omit while the other half invent a value.
 *
 * ── `propose_scene_transition` HAS NO `time_shift` (P11) ─────────────────────
 * The earlier version let the model pick a time band from which the engine
 * derived a rations cost. The engine still applied the cost — the letter of
 * invariant 1 was safe — but the model picked the entry that DETERMINED the
 * cost, so `character.gauge_changed` became reachable from a proposal circuit
 * whose closed list holds only `entity.*`, `clock.*` and `scene.*`. Elapsed
 * time now follows exclusively from the move played, computed by the engine.
 * No time value comes from the model: not in the schema, not in the
 * description, not in the handler.
 *
 * ── THE ONE READ TOOL THAT WRITES ───────────────────────────────────────────
 * `roll_oracle` appends an oracle event to the journal for traceability, and
 * touches no game value. P12 made that exception TYPED rather than
 * conventional: `ReadOnlyTool.journalOnly` is empty for every tool but this
 * one. Without it, `roll_oracle` would be a third write path standing outside
 * the invariant-1 guard.
 *
 * ── WHAT IS DERIVED RATHER THAN RETYPED ─────────────────────────────────────
 * ADR 0007, applied to tool vocabulary. Wherever a tool enum is the engine's
 * list, it is BUILT from the mirror instead of being typed again:
 * `likelihood` = `zLikelihood.options` + `sans-objet`, `segments` =
 * `zClockSegmentCount`, `rank` = `zProgressRank`. The three tuples that have
 * no engine counterpart — oracle table ids, lore kinds, the dispositions of
 * `propose_npc_introduce` — are written here and compared by the tests to what
 * they are supposed to track.
 *
 * REPORTED, NOT WORKED AROUND: `propose_npc_introduce.disposition` is the
 * five-value list of section 3.3 (`hostile mefiant neutre curieux allie`),
 * while the engine's `EntityDisposition` holds four (`allie neutre hostile
 * inconnu`). `mefiant` and `curieux` have no engine value to land in and
 * `inconnu` cannot be proposed. The specification is authoritative and is
 * implemented as written; the mapping is M0-24's problem and is flagged in the
 * pull request rather than silently reconciled here.
 */

import { z } from 'zod';

import type { GameEventType } from '@for/engine';

import { CLOCK_ADVANCE_MAX, CLOCK_ADVANCE_MIN } from '../core/clock.js';
import { zClockSegmentCount, zLikelihood, zProgressRank } from '../core/enums.js';
import { zSceneState } from '../core/scene-state.js';
import { zEventSeq } from '../primitives.js';
import { ORACLE_JOURNAL_ONLY_EVENT_TYPES } from './narrator-port.js';

// ------------------------------------------------------------- the twelve

/** Reads. Nothing here changes a game value. */
export const READ_ONLY_TOOL_NAMES = [
  'get_state',
  'get_lore',
  'get_chronicle',
  'check_name_allowed',
  'roll_oracle',
] as const;

/** Proposals. The server validates, adjusts or refuses, then applies. */
export const PROPOSAL_TOOL_NAMES = [
  'propose_npc_introduce',
  'propose_clock_create',
  'propose_clock_advance',
  'propose_thread_open',
  'propose_lore_fact',
  'propose_scene_transition',
  'propose_vow_hook',
] as const;

/**
 * The FROZEN ORDER of section 3.4. It is position 0 of every request, so a
 * table that varies destroys the prompt cache of every campaign at once.
 */
export const TOOL_NAMES = [...READ_ONLY_TOOL_NAMES, ...PROPOSAL_TOOL_NAMES] as const;

export type ReadOnlyToolName = (typeof READ_ONLY_TOOL_NAMES)[number];
export type ProposalToolName = (typeof PROPOSAL_TOOL_NAMES)[number];
export type ToolName = ReadOnlyToolName | ProposalToolName;

/**
 * Names that must never become a tool. The list lives here, next to the
 * definitions, and `packages/ai/tests/tool-surface.test.ts` fails if one of
 * them appears in `TOOL_DEFINITIONS`.
 */
export const FORBIDDEN_TOOL_NAMES = [
  'apply_damage',
  'set_gauge',
  'resolve_move',
  'roll_dice',
  'kill_character',
  'advance_vow',
  'spend_momentum',
] as const;

// --------------------------------------------------------------- read: input

export const GET_STATE_SCOPES = [
  'table',
  'character',
  'clocks',
  'vows',
  'inventory',
  'scene',
] as const;

export const GetStateInputSchema = z
  .object({
    scope: z.enum(GET_STATE_SCOPES),
    /** Required by `character` and `inventory`, null otherwise. */
    character_id: z.string().nullable(),
  })
  .strict();

export const GET_LORE_KINDS = [
  'any',
  'region',
  'place',
  'faction',
  'custom',
  'champion',
  'creature',
] as const;

export const GetLoreInputSchema = z
  .object({
    query: z.string(),
    kind: z.enum(GET_LORE_KINDS),
    limit: z.literal([1, 2, 3, 4, 5]),
  })
  .strict();

export const GET_CHRONICLE_SECTIONS = [
  'arcs',
  'npcs',
  'places',
  'facts',
  'open_threads',
  'archived_facts',
  'character',
] as const;

export const GetChronicleInputSchema = z
  .object({
    section: z.enum(GET_CHRONICLE_SECTIONS),
    subject_id: z.string().nullable(),
    limit: z.literal([1, 3, 5, 10]),
  })
  .strict();

export const CheckNameAllowedInputSchema = z.object({ name: z.string() }).strict();

/**
 * The oracle tables the model may consult.
 *
 * `pay-the-price` AND `presages` ARE ABSENT, and that absence is mechanical
 * rather than editorial: both are rolled by the engine as a CONSEQUENCE of a
 * move, never on request. A model that could draw a price would be choosing
 * its own consequence, which is the exact circuit ADR 0006 closed.
 *
 * The ids are the file names of `content/oracles/` (03-donnees.md section 4.1).
 * They are hard-coded because the tool table must stay byte-identical for the
 * cache (section 3.4); a CI check in M0-16 verifies they remain a subset of
 * the oracle ids actually present in the content bundle.
 */
export const ORACLE_TABLE_IDS = [
  'yes-no',
  'action-theme',
  'place-features',
  'npc-names-freljord',
  'npc-roles',
  'npc-goals',
  'settlement-troubles',
  'freljord-weather',
  'complication',
] as const;

/**
 * The engine's five likelihoods, plus the `sans-objet` the tool needs because
 * eight of the nine tables ignore the field and `required` is complete.
 * DERIVED from the mirror: a sixth engine likelihood lands here on its own.
 */
export const ORACLE_LIKELIHOODS = [...zLikelihood.options, 'sans-objet'] as const;

export const RollOracleInputSchema = z
  .object({
    table_id: z.enum(ORACLE_TABLE_IDS),
    /** In French. Empty string when the table is not `yes-no`. */
    question: z.string(),
    likelihood: z.enum(ORACLE_LIKELIHOODS),
  })
  .strict();

// -------------------------------------------------------- proposals: input

/**
 * Section 3.3's five values. See the header: this list and the engine's
 * `EntityDisposition` do not coincide, and that is reported rather than
 * papered over.
 */
export const NPC_PROPOSAL_DISPOSITIONS = [
  'hostile',
  'mefiant',
  'neutre',
  'curieux',
  'allie',
] as const;

export const ProposeNpcIntroduceInputSchema = z
  .object({
    name: z.string(),
    role: z.string(),
    /** One characterising sentence, no figure, no rule term. */
    one_line: z.string(),
    place_id: z.string(),
    disposition: z.enum(NPC_PROPOSAL_DISPOSITIONS),
  })
  .strict();

/** Tool-side vocabulary: the engine has no clock kind. */
export const CLOCK_PROPOSAL_KINDS = ['scene', 'menace', 'campagne'] as const;

export const ProposeClockCreateInputSchema = z
  .object({
    name: z.string(),
    /** Derived from the engine tuple, not retyped. */
    segments: zClockSegmentCount,
    kind: z.enum(CLOCK_PROPOSAL_KINDS),
    rationale: z.string(),
  })
  .strict();

export const ProposeClockAdvanceInputSchema = z
  .object({
    clock_id: z.string(),
    /**
     * 1 to 3 — and the engine still caps it by outcome
     * (`MAX_CLOCK_ADVANCE_BY_OUTCOME`). The schema bounds what may be ASKED;
     * the engine decides what is applied. An over-ask is adjusted, not refused.
     */
    segments: z.number().int().min(CLOCK_ADVANCE_MIN).max(CLOCK_ADVANCE_MAX),
    rationale: z.string(),
  })
  .strict();

export const THREAD_TIE_KINDS = ['npc', 'place', 'vow', 'character', 'none'] as const;

export const ProposeThreadOpenInputSchema = z
  .object({
    title: z.string(),
    /** One or two sentences, no figure. */
    summary: z.string(),
    tied_to_kind: z.enum(THREAD_TIE_KINDS),
    /** Empty string when `tied_to_kind` is `none`. */
    tied_to_id: z.string(),
  })
  .strict();

export const LORE_FACT_TIE_KINDS = [
  'npc',
  'place',
  'region',
  'faction',
  'character',
  'none',
] as const;

/** Section 3.3: a rejected `statement` is never rewritten by the server. */
export const LORE_FACT_STATEMENT_MAX = 200;

export const ProposeLoreFactInputSchema = z
  .object({
    /** One affirmative sentence, no figure, no rule term. */
    statement: z.string().max(LORE_FACT_STATEMENT_MAX),
    tied_to_kind: z.enum(LORE_FACT_TIE_KINDS),
    tied_to_id: z.string(),
  })
  .strict();

/**
 * EXACTLY TWO KEYS. P11 removed `time_shift`, and the acceptance criterion of
 * M0-12 reads this schema's key set to make sure it stayed removed.
 */
export const ProposeSceneTransitionInputSchema = z
  .object({
    /** An existing place, or the empty string when proposing a new one. */
    to_place_id: z.string(),
    /** The new place's name, or the empty string. */
    new_place_name: z.string(),
  })
  .strict();

export const ProposeVowHookInputSchema = z
  .object({
    title: z.string(),
    /** Derived from the engine's rank tuple. */
    rank: zProgressRank,
    why_now: z.string(),
  })
  .strict();

/** The twelve input schemas, in the frozen order. */
export const TOOL_INPUT_SCHEMAS = {
  get_state: GetStateInputSchema,
  get_lore: GetLoreInputSchema,
  get_chronicle: GetChronicleInputSchema,
  check_name_allowed: CheckNameAllowedInputSchema,
  roll_oracle: RollOracleInputSchema,
  propose_npc_introduce: ProposeNpcIntroduceInputSchema,
  propose_clock_create: ProposeClockCreateInputSchema,
  propose_clock_advance: ProposeClockAdvanceInputSchema,
  propose_thread_open: ProposeThreadOpenInputSchema,
  propose_lore_fact: ProposeLoreFactInputSchema,
  propose_scene_transition: ProposeSceneTransitionInputSchema,
  propose_vow_hook: ProposeVowHookInputSchema,
} as const satisfies Record<ToolName, z.ZodType>;

// ------------------------------------------------------------------ outputs

/**
 * The `tool_result` shapes.
 *
 * They travel server → model, which is why they are NOT converted to JSON
 * Schema and NOT required to be strict-with-complete-required: nothing about
 * them crosses a provider's validator. What they must be is BOUNDED, so a
 * result cannot blow the context budget of section 4.3, and free of anything
 * the model could read as a decision it gets to make.
 */

const zGaugeTriplet = z
  .object({
    vigueur: z.number().int(),
    ame: z.number().int(),
    vivres: z.number().int(),
  })
  .strict();

const zToolCharacter = z
  .object({
    character_id: z.string(),
    name: z.string(),
    gauges: zGaugeTriplet,
    momentum: z.number().int(),
    conditions: z.array(z.string()).max(12),
    place_id: z.string(),
  })
  .strict();

const zToolClock = z
  .object({
    clock_id: z.string(),
    name: z.string(),
    segments: zClockSegmentCount,
    filled: z.number().int().nonnegative(),
  })
  .strict();

const zToolVow = z
  .object({
    track_id: z.string(),
    title: z.string(),
    rank: zProgressRank,
    filled_boxes: z.number().int().nonnegative(),
  })
  .strict();

const zToolAsset = z
  .object({ asset_id: z.string(), name: z.string(), text: z.string().max(200) })
  .strict();

export const GetStateOutputSchema = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('table'),
    characters: z.array(zToolCharacter).max(7),
    as_of_event_seq: zEventSeq,
  }),
  z.strictObject({
    scope: z.literal('character'),
    character: zToolCharacter,
    as_of_event_seq: zEventSeq,
  }),
  z.strictObject({
    scope: z.literal('clocks'),
    clocks: z.array(zToolClock).max(6),
    as_of_event_seq: zEventSeq,
  }),
  z.strictObject({
    scope: z.literal('vows'),
    vows: z.array(zToolVow).max(12),
    as_of_event_seq: zEventSeq,
  }),
  z.strictObject({
    scope: z.literal('inventory'),
    character_id: z.string(),
    assets: z.array(zToolAsset).max(24),
    as_of_event_seq: zEventSeq,
  }),
  z.strictObject({
    scope: z.literal('scene'),
    /** The already-mirrored projection, not a second shape. */
    scene: zSceneState.nullable(),
    as_of_event_seq: zEventSeq,
  }),
]);

/** Section 3.2: an excerpt is capped at 400 characters. */
export const LORE_EXCERPT_MAX = 400;

export const GetLoreOutputSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            source_id: z.string(),
            title: z.string(),
            text: z.string().max(LORE_EXCERPT_MAX),
          })
          .strict(),
      )
      .max(5),
    /**
     * Entries dropped because they named a reserved champion. Removed from the
     * model SILENTLY — the count never says which, so no table's roster leaks
     * into another's.
     */
    filtered_count: z.number().int().nonnegative(),
  })
  .strict();

export const GetChronicleOutputSchema = z
  .object({
    section: z.enum(GET_CHRONICLE_SECTIONS),
    entries: z.array(z.unknown()).max(20),
    chronicle_version: z.number().int().nonnegative(),
  })
  .strict();

export const CheckNameAllowedOutputSchema = z
  .object({
    name: z.string(),
    allowed: z.boolean(),
    /**
     * Null when allowed. `reserved_champion` never says WHICH champion: the
     * server does not leak another table's roster.
     */
    reason: z.string().nullable(),
    suggestion: z.string().nullable(),
  })
  .strict();

export const RollOracleOutputSchema = z.union([
  z.strictObject({
    table_id: z.literal('yes-no'),
    value: z.number().int(),
    answer: z.enum(['oui', 'non']),
    is_extreme: z.boolean(),
    event_seq: zEventSeq,
  }),
  z.strictObject({
    table_id: z.enum(ORACLE_TABLE_IDS),
    value: z.number().int(),
    entry_id: z.string(),
    text: z.string(),
    event_seq: zEventSeq,
  }),
]);

/**
 * The common return of every `propose_*`.
 *
 * THE MODEL WRITES FROM `applied`, NEVER FROM ITS REQUEST — that rule is in
 * the system prompt, and this shape is what makes it possible: `applied` is
 * what the server actually recorded, which may differ from what was asked
 * (`adjusted`) or be null (`rejected`).
 */
export const PROPOSAL_STATUSES = ['applied', 'adjusted', 'rejected'] as const;

export const ProposalOutputSchema = z
  .object({
    status: z.enum(PROPOSAL_STATUSES),
    reason: z.string().nullable(),
    /** The object as it now exists. Null when `status` is `rejected`. */
    applied: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

export const TOOL_OUTPUT_SCHEMAS = {
  get_state: GetStateOutputSchema,
  get_lore: GetLoreOutputSchema,
  get_chronicle: GetChronicleOutputSchema,
  check_name_allowed: CheckNameAllowedOutputSchema,
  roll_oracle: RollOracleOutputSchema,
  propose_npc_introduce: ProposalOutputSchema,
  propose_clock_create: ProposalOutputSchema,
  propose_clock_advance: ProposalOutputSchema,
  propose_thread_open: ProposalOutputSchema,
  propose_lore_fact: ProposalOutputSchema,
  propose_scene_transition: ProposalOutputSchema,
  propose_vow_hook: ProposalOutputSchema,
} as const satisfies Record<ToolName, z.ZodType>;

// ---------------------------------------------------- the two tool families

/**
 * P12, made into a type. `journalOnly` lists the journal entries a READ tool
 * may append — empty for four of the five, and exactly the two oracle
 * resolutions for `roll_oracle`. Typing it `readonly GameEventType[]` means a
 * misspelt event type does not compile, and the tuple itself lives in
 * `narrator-port.ts` with the other two closed lists of invariant 1.
 */
export interface ReadOnlyTool {
  readonly name: ReadOnlyToolName;
  readonly kind: 'read';
  readonly journalOnly: readonly GameEventType[];
}

export interface ProposalTool {
  readonly name: ProposalToolName;
  readonly kind: 'proposal';
}

export type ToolDescriptor = ReadOnlyTool | ProposalTool;

/**
 * Empty everywhere but `roll_oracle`. A registry rather than a comment: the
 * server's `proposal-surface.test.ts` reads it, and so does the tool handler.
 */
export const TOOL_JOURNAL_ONLY = {
  get_state: [],
  get_lore: [],
  get_chronicle: [],
  check_name_allowed: [],
  roll_oracle: ORACLE_JOURNAL_ONLY_EVENT_TYPES,
} as const satisfies Record<ReadOnlyToolName, readonly GameEventType[]>;

/** The twelve descriptors, in the frozen order of section 3.4. */
export const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  ...READ_ONLY_TOOL_NAMES.map((name): ReadOnlyTool => ({
    name,
    kind: 'read',
    journalOnly: TOOL_JOURNAL_ONLY[name],
  })),
  ...PROPOSAL_TOOL_NAMES.map((name): ProposalTool => ({ name, kind: 'proposal' })),
];
