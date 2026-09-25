/**
 * The turn budget and the truncation ladder T1 → T8 (02-mj-ia.md section 4.3
 * and 4.4, AMENDED BY ADR 0011).
 *
 * ── THE NUMBER THAT MOVED, AND WHY ──────────────────────────────────────────
 * The target was `min(14 000, contextWindowTokens x 0,6)`. ADR 0011 makes it
 * `min(7 000, contextWindowTokens x 0,6)`. The reason is not money: the
 * project runs on FREE providers, whose ceiling is DAILY, and the fixed block
 * is multiplied by every turn. At 14 000 per turn a 200 K/day allowance gives
 * fourteen turns; a session is sixty.
 *
 * Two of the fixed blocks were marked "figé, mesuré en CI" and nothing
 * measured them — the tool table weighed 2 112 against 900 announced, the
 * system prompt 4 279 against 2 400. ADR 0011's decision: prose-only mode
 * (tool table to zero, see `context/builder.ts`) and the prompt back to its
 * announced 2 400 (see `prompts/conteur.system.ts`).
 *
 * ── THE ESTIMATOR IS IMPORTED, NEVER REDECLARED ─────────────────────────────
 * `estimateTokens` lives in `prompts/estimate.ts` and is imported here. Two
 * estimators is how a budget and `prompt-size.test.ts` start disagreeing about
 * the same prompt. Held by `tests/context-budget.test.ts`, which reads every
 * file of `src/` and fails if a second one declares the ratio.
 *
 * ── WHAT THIS FILE DOES NOT DECIDE ──────────────────────────────────────────
 * It never calls a provider's token counter — that is a network call on the
 * critical path, and not every provider has one (section 4.3). The nightly
 * workflow compares the estimate to the real count and fails past eight per
 * cent of drift.
 */

import { estimateTokens } from '../prompts/estimate.js';

// ------------------------------------------------------------------ budget

/**
 * ADR 0011. The old 14 000 assumed 5 200 of fixed blocks; they weighed 8 291.
 * Written here once, spelled out in full letters again in
 * `tests/context-budget.test.ts` — a criterion's number is never read from
 * `src/` by the test that checks it.
 */
export const TURN_TOKEN_TARGET = 7000;

/** Section 4.3: the share of a narrow context window a turn may use. */
export const CONTEXT_WINDOW_SHARE = 0.6;

/** Section 4.3: the prose ceiling asked of the model, unchanged by ADR 0011. */
export const TURN_OUTPUT_TOKENS = 800;

/**
 * Per-segment ceilings of section 4.3, as amended. `tools` is GONE rather than
 * zero: prose-only mode is the absence of the segment, not a segment of size
 * zero, and `builder.ts` sends `tools: []`.
 */
export const SEGMENT_CEILINGS = {
  /** `system[0]`, ADR 0011: back to its announced target. */
  conteurSystemPrompt: 2400,
  /** `system[1]`, truncated by the builder. */
  campaignBlock: 900,
  chronicle: 2500,
  turnWindow: 3000,
  etat: 1200,
  scene: 900,
  lore: 1200,
  fait: 400,
  intention: 600,
} as const;

/**
 * The turn budget for a given context window.
 *
 * A window of 8 192 — the local-model case — gives 4 915, and the four
 * untouchable blocks now fit inside it, which was false with 8 291 of fixed
 * blocks (ADR 0011, "Conséquence mécanique").
 */
export function turnBudget(contextWindowTokens: number): number {
  return Math.min(TURN_TOKEN_TARGET, Math.floor(contextWindowTokens * CONTEXT_WINDOW_SHARE));
}

// ------------------------------------------------------------------ blocks

/** The chronicle, split along the seams T4 and T7 cut it at. */
export interface ChronicleParts {
  readonly premise: string;
  readonly openArcs: string;
  readonly otherArcs: string;
  readonly characters: string;
  /** NPCs present in the current scene. T4 keeps these. */
  readonly sceneNpcs: string;
  /** NPCs absent from the current scene. T4 drops these. */
  readonly otherNpcs: string;
  readonly places: string;
  /** Facts tied to an entity of the current scene. T7 keeps these. */
  readonly sceneFacts: string;
  readonly otherFacts: string;
  readonly openThreads: string;
  readonly recentDigest: string;
}

/** The `<etat>` block, split along the seam T2 cuts it at. */
export interface EtatParts {
  /** Actor, others, active clocks, vows. */
  readonly core: string;
  /** Inventory and idle clocks. T2 drops these. */
  readonly inventoryAndIdleClocks: string;
}

/**
 * Everything the ladder is allowed to touch.
 *
 * The four untouchable blocks of section 4.4 — `<fait>`, `<intention>`,
 * `<scene>` and the system prompt — are NOT in this type. That is the
 * mechanical form of "intouchables par définition": the ladder cannot cut what
 * it was never handed.
 */
export interface TrimmableContext {
  /** At most three, section 4.3. */
  readonly lore: readonly string[];
  readonly etat: EtatParts;
  /** Rendered past turns, OLDEST FIRST, at most twelve. */
  readonly turns: readonly string[];
  readonly chronicle: ChronicleParts;
}

/** What the ladder may never cut, weighed all the same. */
export interface FixedContext {
  readonly systemPrompt: string;
  readonly campaignBlock: string;
  readonly scene: string;
  readonly fait: string;
  readonly intention: string;
}

// ------------------------------------------------------------------ ladder

export const TRIM_LEVEL_IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'] as const;

export type TrimLevelId = (typeof TRIM_LEVEL_IDS)[number];

export interface TrimLevel {
  readonly id: TrimLevelId;
  /** The action of section 4.4's table, in the words of the table. */
  readonly action: string;
  readonly apply: (context: TrimmableContext) => TrimmableContext;
}

const keepLastTurns =
  (howMany: number) =>
  (context: TrimmableContext): TrimmableContext => ({
    ...context,
    turns: context.turns.slice(Math.max(0, context.turns.length - howMany)),
  });

/**
 * Section 4.4, in order. The order IS the specification: the ladder stops as
 * soon as the budget passes, so a reordering changes what a player loses.
 */
export const TRIM_LADDER: readonly TrimLevel[] = [
  {
    id: 'T1',
    action: '<lore> : 3 extraits → 1',
    apply: (context) => ({ ...context, lore: context.lore.slice(0, 1) }),
  },
  {
    id: 'T2',
    action: '<etat> : retirer l’inventaire et les horloges inactives',
    apply: (context) => ({
      ...context,
      etat: { ...context.etat, inventoryAndIdleClocks: '' },
    }),
  },
  { id: 'T3', action: 'fenêtre de tours : 12 → 8', apply: keepLastTurns(8) },
  {
    id: 'T4',
    action: '<chronique> : retirer places et les npcs absents de la scène',
    apply: (context) => ({
      ...context,
      chronicle: { ...context.chronicle, places: '', otherNpcs: '' },
    }),
  },
  { id: 'T5', action: 'fenêtre de tours : 8 → 4', apply: keepLastTurns(4) },
  {
    id: 'T6',
    action: '<lore> : 1 → 0',
    apply: (context) => ({ ...context, lore: [] }),
  },
  {
    id: 'T7',
    action: '<chronique> : premise, arcs ouverts, open_threads, facts de la scène',
    apply: (context) => ({
      ...context,
      chronicle: {
        ...context.chronicle,
        otherArcs: '',
        characters: '',
        sceneNpcs: '',
        otherNpcs: '',
        places: '',
        otherFacts: '',
        recentDigest: '',
      },
    }),
  },
  { id: 'T8', action: 'fenêtre de tours : 4 → 1', apply: keepLastTurns(1) },
];

// ------------------------------------------------------------------ weighing

const joinNonEmpty = (parts: readonly string[]): string =>
  parts.filter((part) => part.length > 0).join('\n');

export const renderChronicle = (chronicle: ChronicleParts): string =>
  joinNonEmpty([
    chronicle.premise,
    chronicle.openArcs,
    chronicle.otherArcs,
    chronicle.characters,
    chronicle.sceneNpcs,
    chronicle.otherNpcs,
    chronicle.places,
    chronicle.sceneFacts,
    chronicle.otherFacts,
    chronicle.openThreads,
    chronicle.recentDigest,
  ]);

export const renderEtat = (etat: EtatParts): string =>
  joinNonEmpty([etat.core, etat.inventoryAndIdleClocks]);

/** Everything the ladder can touch, as the bytes that will be sent. */
export function trimmableText(context: TrimmableContext): string {
  return joinNonEmpty([
    renderChronicle(context.chronicle),
    ...context.turns,
    renderEtat(context.etat),
    ...context.lore,
  ]);
}

export function fixedText(fixed: FixedContext): string {
  return joinNonEmpty([
    fixed.systemPrompt,
    fixed.campaignBlock,
    fixed.scene,
    fixed.fait,
    fixed.intention,
  ]);
}

export interface TrimOutcome {
  /** The context as it will be sent. */
  readonly context: TrimmableContext;
  /** 0 when nothing was cut; otherwise the last level applied. */
  readonly trimLevel: number;
  /**
   * The levels applied, IN ORDER. Always a prefix of `TRIM_LADDER`: the ladder
   * never skips a rung, and a test can say so rather than trust it.
   */
  readonly applied: readonly TrimLevelId[];
  readonly estimatedTokens: number;
  readonly budget: number;
  /**
   * True when T8 was not enough. Section 4.4: that is a bug, the server raises
   * `context_overflow` and falls back to engine narration — it never cuts one
   * of the four untouchable blocks.
   */
  readonly overflow: boolean;
}

/**
 * Apply the ladder until the estimate fits, and say exactly how far it went.
 *
 * Pure. `trimLevel` is what goes into `ai_calls.trim_level`.
 */
export function applyTrimLadder(
  fixed: FixedContext,
  context: TrimmableContext,
  budget: number,
): TrimOutcome {
  const fixedTokens = estimateTokens(fixedText(fixed));
  const weigh = (candidate: TrimmableContext): number =>
    fixedTokens + estimateTokens(trimmableText(candidate));

  let current = context;
  const applied: TrimLevelId[] = [];
  let estimated = weigh(current);

  for (const level of TRIM_LADDER) {
    if (estimated <= budget) break;
    current = level.apply(current);
    applied.push(level.id);
    estimated = weigh(current);
  }

  return {
    context: current,
    trimLevel: applied.length,
    applied,
    estimatedTokens: estimated,
    budget,
    overflow: estimated > budget,
  };
}
