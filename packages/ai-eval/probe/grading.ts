/**
 * Scoring one answer with the SIXTEEN HARD RULES OF PRODUCTION (M0-31).
 *
 * ── NOT ONE RULE IS WRITTEN HERE ────────────────────────────────────────────
 * `HARD_ASSERTIONS` is imported from `@for/ai`: the very objects the
 * post-filter of section 8.6 consumes before `s2c.narration_done`. The
 * acceptance criterion greps this directory for a declared rule and demands
 * zero. What this file adds is the two things the eval needs and production
 * does not: the CONTEXT each rule is handed, and the question of whether the
 * rule had anything to say on this sample at all.
 *
 * ── A VACUOUS PASS IS NOT A PASS, AND THIS IS THE HEART OF THE FILE ─────────
 * Six of the sixteen pass unconditionally when their premise is missing:
 * `price_respected` on a turn with no price, `scene_block_consistent` when the
 * model wrote no `<scene_apres>` block, and so on. M0-32 measured
 * twenty-four local samples WITHOUT A SINGLE BLOCK. Counting those vacuous
 * passes as successes would make this report say « the model keeps the scene
 * coherent » about a model that never described a scene. So every sample is
 * scored as one of three states — `passed`, `failed`, `not_applicable` — and
 * the rate is `passed / applicable`. Held by `grading.test.ts` « un bloc
 * absent rend scene_block_consistent sans objet, pas réussie » and « le taux
 * se calcule sur les échantillons applicables ».
 *
 * ── THE PREMISE TABLE IS COMPLETE OR THE PROBE REFUSES TO RUN ───────────────
 * `PREMISES` is keyed by assertion identifier and `missingPremises()` names
 * every hard assertion it does not cover. Emptying the table therefore makes
 * the run stop, instead of silently declaring sixteen rules always applicable
 * (mode 6 of `docs/RECETTE.md`). Held by `grading.test.ts` « une table de
 * prémisses vidée nomme les seize » and, one level up, by `run-probe.test.ts`
 * « une prémisse manquante fait sortir en 1 ».
 */

import { DEFAULT_LIMITS, HARD_ASSERTIONS, readNarration } from '@for/ai';

import type { Assertion, AssertionContext, AssertionResult } from '@for/ai';
import type { SceneBlock } from '@for/contracts';
import type { ProbeCase } from './cases.js';

/** What one rule had to say about one sample. */
export type GradeState = 'passed' | 'failed' | 'not_applicable';

export interface SampleGrade {
  readonly id: string;
  readonly state: GradeState;
  /** The rule's own `detail`, quoted; empty when it had nothing to say. */
  readonly detail: string;
}

/**
 * What the model actually returned, split the way production splits it.
 *
 * `readNarration` is `@for/ai`'s, so prose and block are separated here
 * exactly as `turn.ts` separates them — including the case where the block is
 * missing, malformed or over its ceiling and comes back `null`.
 */
export interface Reading {
  readonly prose: string;
  readonly sceneBlock: SceneBlock | null;
  readonly proseTruncated: boolean;
}

export function readAnswer(answer: string, probeCase: ProbeCase): Reading {
  const read = readNarration(answer, probeCase.reservedChampions);
  return {
    prose: read.output.prose,
    sceneBlock: read.output.sceneBlock,
    proseTruncated: read.proseTruncated,
  };
}

/**
 * The grading context, built the way `turn.ts` builds it.
 *
 * Two departures, both written down rather than implied:
 *
 *  - `absentNames` and `sceneEntityNames` come from `probeCase.scene`, the
 *    server-side scene, NOT from `brief.perceivableFacts`. That is what
 *    production does, and it is also what makes the probe able to carry the
 *    case where somebody is in the scene and out of the brief.
 *  - `factHasTimeSkip` is false on every case of this corpus: no fixture
 *    carries a turn whose `<fait>` skips time, so `no_time_skip` is always
 *    applicable here. If one ever does, the field moves into the fixture.
 */
export function contextFor(probeCase: ProbeCase, reading: Reading): AssertionContext {
  return {
    reservedChampions: probeCase.reservedChampions,
    playerCharacterNames: probeCase.playerCharacterNames,
    absentNames: probeCase.scene.absentNames,
    sceneEntityNames: probeCase.scene.presentNames,
    priceKeywords: probeCase.priceKeywords,
    factHasTimeSkip: false,
    sceneBlock: reading.sceneBlock,
    refusal: null,
    expectedRefusal: null,
    toolCalls: [],
    allowedTools: [],
    mentionsAny: probeCase.mentionsAny,
    limits: DEFAULT_LIMITS,
  };
}

// ------------------------------------------------------------- the premises

/**
 * When each hard rule has something to say.
 *
 * Read the right-hand column against `packages/ai/src/assertions/`: every
 * `return pass(...)` that happens BEFORE the rule looks at the text is a
 * premise, and each one is listed here. The ten that are always applicable say
 * so explicitly rather than being left out — an absent key is a defect, not a
 * default.
 */
export const PREMISES: Readonly<Record<string, (ctx: AssertionContext) => boolean>> = Object.freeze(
  {
    // Always: they read the prose and nothing else.
    sentence_count: () => true,
    no_digits: () => true,
    no_rules_lexicon: () => true,
    no_outcome_decision: () => true,
    no_terminal_prompt: () => true,
    banned_style_lexicon: () => true,
    no_named_emotion: () => true,
    sentence_length_cap: () => true,
    max_one_dialogue_line: () => true,
    no_atmosphere_ending: () => true,
    // Conditional: each one passes vacuously without its premise.
    no_reserved_champion: (ctx) => ctx.reservedChampions.length > 0,
    no_pc_agency: (ctx) => ctx.playerCharacterNames.length > 0,
    price_respected: (ctx) => ctx.priceKeywords !== null,
    no_time_skip: (ctx) => !ctx.factHasTimeSkip,
    no_absent_reappearance: (ctx) => ctx.absentNames.length > 0,
    scene_block_consistent: (ctx) => ctx.sceneBlock !== null && ctx.absentNames.length > 0,
  },
);

/**
 * Every hard rule the premise table does not cover.
 *
 * Empty is the only acceptable answer, and `run-probe.ts` refuses to run
 * otherwise. The list is derived from `HARD_ASSERTIONS` — imported — so adding
 * a seventeenth hard rule in `@for/ai` stops this probe until somebody says
 * when it applies.
 */
export function missingPremises(
  rules: readonly Assertion[] = HARD_ASSERTIONS,
  premises: Readonly<Record<string, unknown>> = PREMISES,
): readonly string[] {
  return rules.filter((rule) => !(rule.id in premises)).map((rule) => rule.id);
}

// -------------------------------------------------------------- the scoring

/**
 * Score one answer: one `SampleGrade` per hard rule, in declaration order.
 *
 * The rule is run even when its premise is missing — its `detail` is the
 * cheapest explanation of WHY it was vacuous — and the verdict is then
 * downgraded to `not_applicable`. A rule that FAILS is never downgraded: a
 * failure means it had something to say, whatever the table thinks.
 */
export function gradeSample(
  probeCase: ProbeCase,
  reading: Reading,
  rules: readonly Assertion[] = HARD_ASSERTIONS,
  premises: Readonly<Record<string, (ctx: AssertionContext) => boolean>> = PREMISES,
): readonly SampleGrade[] {
  const ctx = contextFor(probeCase, reading);
  return rules.map((rule) => {
    const result: AssertionResult = rule.run(reading.prose, ctx);
    const applicable = premises[rule.id]?.(ctx) ?? true;
    const state: GradeState = result.passed ? (applicable ? 'passed' : 'not_applicable') : 'failed';
    return { id: rule.id, state, detail: result.detail };
  });
}
