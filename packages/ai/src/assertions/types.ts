/**
 * What an assertion is, and what it is handed (02-mj-ia.md section 8.4).
 *
 * ── WHY THEY LIVE IN `@for/ai` AND NOT IN `@for/ai-eval` ────────────────────
 * They are used TWICE: as eval graders, and as the production post-filter
 * before `s2c.narration_done` is emitted (section 8.6). Putting them in the
 * eval package would create a cycle `ai ↔ ai-eval`, which `dependency-cruiser`
 * refuses. CLAUDE.md states the same rule.
 *
 * ── THE CONSEQUENCE, SAID OUT LOUD ──────────────────────────────────────────
 * Hardening an assertion for CI hardens the production filter in the same
 * commit, and a stricter filter means more engine fallbacks that players
 * actually see. That is why three of the register assertions stay SOFT
 * (`adverb_budget`, `no_triads`, `no_anonymous_recurrent`): their heuristics
 * on French morphology are good without being perfect, and a blocking gate is
 * not built on that.
 */

import type { SceneBlock } from '@for/contracts';

export interface AssertionResult {
  readonly id: string;
  readonly passed: boolean;
  /** Quotes the offending excerpt, so a failure reads without the transcript. */
  readonly detail: string;
}

/** A reserved champion, with every name it answers to. */
export interface ReservedChampion {
  readonly displayName: string;
  readonly aliases: readonly string[];
}

/** What `proveRefusal` said about this turn, when it ran. */
export interface RefusalObservation {
  readonly verdict: 'upheld' | 'rejected';
  readonly cause: string | null;
  readonly target: string | null;
}

/** The numbers a case may override. Spelled here, never hidden in a regex. */
export interface AssertionLimits {
  /** Section 2.1, « Forme de ta réponse ». */
  readonly sentenceMin: number;
  readonly sentenceMax: number;
  /** `NARRATION_PROSE_MAX` by default. */
  readonly maxChars: number;
  /** Section 8.4, `sentence_length_cap`. */
  readonly sentenceWordCap: number;
  /** Section 8.4, `adverb_budget`. */
  readonly adverbMax: number;
  /** Section 8.4, `max_one_dialogue_line`. */
  readonly dialogueMax: number;
  /** Section 8.4, `tool_calls`. */
  readonly toolCallsMax: number;
}

export interface AssertionContext {
  readonly reservedChampions: readonly ReservedChampion[];
  /** Player character names, for `no_pc_agency`. */
  readonly playerCharacterNames: readonly string[];
  /** `scene_in.absent` names, for `no_absent_reappearance`. */
  readonly absentNames: readonly string[];
  /** Named entities of the current scene, for `ends_concrete`. */
  readonly sceneEntityNames: readonly string[];
  /** `keywords` of the drawn price entry; `null` when the turn imposes none. */
  readonly priceKeywords: readonly string[] | null;
  /** True when `<fait>` itself carries a time skip. */
  readonly factHasTimeSkip: boolean;
  /** The parsed `<scene_apres>`, or `null` when there was no usable block. */
  readonly sceneBlock: SceneBlock | null;
  /** What the server's proof said, when a refusal was declared. */
  readonly refusal: RefusalObservation | null;
  /** What the case expects the proof to say. */
  readonly expectedRefusal: RefusalObservation | null;
  /** Tool names actually called this turn. Empty in prose-only mode. */
  readonly toolCalls: readonly string[];
  /** Tool names this case allows. Empty in prose-only mode. */
  readonly allowedTools: readonly string[];
  /** Values for `mentions_any`. */
  readonly mentionsAny: readonly string[];
  readonly limits: AssertionLimits;
}

export interface Assertion {
  readonly id: string;
  /**
   * `true` ⇒ consumed by the production post-filter (section 8.6). The set of
   * hard assertions IS that list, and `tests/assertions.test.ts` compares the
   * two spelled out in full letters.
   */
  readonly hard: boolean;
  /** Section 8.4: `ends_concrete` is reserved for the N2 judge. */
  readonly optional?: boolean;
  readonly run: (output: string, ctx: AssertionContext) => AssertionResult;
}

export const DEFAULT_LIMITS: AssertionLimits = {
  sentenceMin: 3,
  sentenceMax: 5,
  maxChars: 4000,
  sentenceWordCap: 30,
  adverbMax: 1,
  dialogueMax: 1,
  toolCallsMax: 3,
};

/** A context with nothing in it, for the cases that need only part of one. */
export const EMPTY_ASSERTION_CONTEXT: AssertionContext = {
  reservedChampions: [],
  playerCharacterNames: [],
  absentNames: [],
  sceneEntityNames: [],
  priceKeywords: null,
  factHasTimeSkip: false,
  sceneBlock: null,
  refusal: null,
  expectedRefusal: null,
  toolCalls: [],
  allowedTools: [],
  mentionsAny: [],
  limits: DEFAULT_LIMITS,
};

export const assertionContext = (over: Partial<AssertionContext> = {}): AssertionContext => ({
  ...EMPTY_ASSERTION_CONTEXT,
  ...over,
  limits: { ...DEFAULT_LIMITS, ...(over.limits ?? {}) },
});

export const pass = (id: string, detail = ''): AssertionResult => ({ id, passed: true, detail });

export const fail = (id: string, detail: string): AssertionResult => ({
  id,
  passed: false,
  detail,
});
