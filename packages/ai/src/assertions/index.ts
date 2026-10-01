/**
 * The twenty-eight assertions, in one place (02-mj-ia.md section 8.4).
 *
 * ── WHY TWENTY-EIGHT AND NOT TWENTY-NINE ────────────────────────────────────
 * Section 8.4 lists twenty-nine identifiers: sixteen in the main table, eight
 * of register, two of scene coherence, three of refusal.
 * `refusal_is_outcome_blind` is NOT one of them here — it is a CORPUS grader
 * (`packages/ai-eval/src/graders/refusal-blindness.ts`, M0-27), which replays
 * the whole corpus with the dice inverted. It is not a `(output, ctx)`
 * function and it cannot be one. 29 − 1 = 28. Held by
 * tests/assertions.test.ts « il y en a vingt-huit, et
 * refusal_is_outcome_blind n'en est pas ».
 *
 * ── THE HARD SET IS THE PRODUCTION FILTER ───────────────────────────────────
 * `hard: true` means « consumed by the post-filter of section 8.6 », and the
 * list there is closed and named. tests/assertions.test.ts « les dures sont
 * exactement les post-filtres du §8.6 » spells it out in full letters and
 * compares — a number read from this file and checked against itself would
 * prove nothing (ADR 0007). The other direction, that the filter consumes
 * NOTHING ELSE, is tests/degradation.test.ts « ne consomme que les
 * assertions dures, pas les souples ».
 */

import {
  endsConcrete,
  mentionsAny,
  noOocLexicon,
  noOutcomeDecision,
  noPcAgency,
  noReservedChampion,
  noRulesLexicon,
  noTimeSkip,
  priceRespected,
  toolCalls,
} from './content.js';
import {
  languageFr,
  maxChars,
  maxOneDialogueLine,
  noDigits,
  noTerminalPrompt,
  secondPersonSingular,
  sentenceCount,
  sentenceLengthCap,
} from './form.js';
import {
  adverbBudget,
  bannedStyleLexicon,
  noAnonymousRecurrent,
  noAtmosphereEnding,
  noNamedEmotion,
  noTriads,
} from './register.js';
import { noAbsentReappearance, noRefusal, refusalMatches, sceneBlockConsistent } from './scene.js';
import type { Assertion, AssertionContext, AssertionResult } from './types.js';

export * from './lexicons.js';
export * from './text.js';
export * from './types.js';

const ALL: readonly Assertion[] = [
  // Section 8.4, main table — sixteen.
  sentenceCount,
  maxChars,
  noDigits,
  noRulesLexicon,
  noOutcomeDecision,
  noReservedChampion,
  secondPersonSingular,
  noPcAgency,
  noTerminalPrompt,
  languageFr,
  noOocLexicon,
  mentionsAny,
  priceRespected,
  noTimeSkip,
  toolCalls,
  endsConcrete,
  // Register — eight.
  bannedStyleLexicon,
  noNamedEmotion,
  sentenceLengthCap,
  maxOneDialogueLine,
  noAtmosphereEnding,
  adverbBudget,
  noTriads,
  noAnonymousRecurrent,
  // Scene coherence — two.
  noAbsentReappearance,
  sceneBlockConsistent,
  // Refusal, case level — two.
  noRefusal,
  refusalMatches,
];

/** Keyed by `id`. The sheet's count command reads `Object.keys(...).length`. */
export const ASSERTIONS: Readonly<Record<string, Assertion>> = Object.fromEntries(
  ALL.map((assertion) => [assertion.id, assertion]),
);

/** The assertions the production post-filter consumes (section 8.6). */
export const HARD_ASSERTIONS: readonly Assertion[] = ALL.filter((assertion) => assertion.hard);

export const ASSERTION_IDS: readonly string[] = ALL.map((assertion) => assertion.id);

/** Run every assertion, in declaration order. */
export function runAssertions(
  output: string,
  ctx: AssertionContext,
  which: readonly Assertion[] = ALL,
): readonly AssertionResult[] {
  return which.map((assertion) => assertion.run(output, ctx));
}

export {
  adverbBudget,
  bannedStyleLexicon,
  endsConcrete,
  languageFr,
  maxChars,
  maxOneDialogueLine,
  mentionsAny,
  noAbsentReappearance,
  noAnonymousRecurrent,
  noAtmosphereEnding,
  noDigits,
  noNamedEmotion,
  noOocLexicon,
  noOutcomeDecision,
  noPcAgency,
  noRefusal,
  noReservedChampion,
  noRulesLexicon,
  noTerminalPrompt,
  noTimeSkip,
  noTriads,
  priceRespected,
  refusalMatches,
  sceneBlockConsistent,
  secondPersonSingular,
  sentenceCount,
  sentenceLengthCap,
  toolCalls,
};
