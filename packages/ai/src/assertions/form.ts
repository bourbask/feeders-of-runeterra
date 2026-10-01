/**
 * The form assertions of 02-mj-ia.md section 8.4: length, person, ending,
 * language.
 *
 * Every one of them is a pure `(output, ctx) => AssertionResult`. THEY NEVER
 * READ A CLOCK, A FILE OR AN ENVIRONMENT VARIABLE, which is what lets the
 * same function be a CI grader and a production post-filter — held by
 * tests/no-env.test.ts « aucun fichier de src/ ne lit … » and « ni process
 * tout court, ni une variable … lue directement ». Both names are elided on
 * purpose: they contain the very literal the first one greps `src/` for, and
 * spelling it here made that test red. Measured, not guessed.
 */

import {
  ENGLISH_FUNCTION_WORDS,
  FRENCH_FUNCTION_WORDS,
  FRENCH_FUNCTION_WORD_RATIO_MIN,
  TERMINAL_PROMPT_PATTERN,
} from './lexicons.js';
import {
  countDialoguePairs,
  countWords,
  findTerms,
  matchLoosely,
  splitSentences,
  stripQuoted,
} from './text.js';
import { fail, pass, type Assertion } from './types.js';

export const sentenceCount: Assertion = {
  id: 'sentence_count',
  hard: true,
  run: (output, ctx) => {
    const count = splitSentences(output).length;
    const { sentenceMin, sentenceMax } = ctx.limits;
    return count >= sentenceMin && count <= sentenceMax
      ? pass('sentence_count', `${String(count)} phrases`)
      : fail(
          'sentence_count',
          `${String(count)} phrases, attendu entre ${String(sentenceMin)} et ${String(sentenceMax)}`,
        );
  },
};

export const maxChars: Assertion = {
  id: 'max_chars',
  hard: false,
  run: (output, ctx) =>
    output.length <= ctx.limits.maxChars
      ? pass('max_chars', `${String(output.length)} caractères`)
      : fail(
          'max_chars',
          `${String(output.length)} caractères, plafond ${String(ctx.limits.maxChars)}`,
        ),
};

/**
 * Not one numeric character. Rule 2 of the prompt, and the reason the `<fait>`
 * block spells its arithmetic in words: a digit in the context is a digit that
 * can be copied.
 */
export const noDigits: Assertion = {
  id: 'no_digits',
  hard: true,
  run: (output) => {
    const found = /[0-9]/u.exec(output);
    return found === null
      ? pass('no_digits')
      : fail('no_digits', `chiffre « ${found[0]} » à l’indice ${String(found.index)}`);
  },
};

export const secondPersonSingular: Assertion = {
  id: 'second_person_singular',
  hard: false,
  run: (output) => {
    const narration = stripQuoted(output);
    const singular = /\b(tu|te|t'|ton|ta|tes|toi)\b/iu.test(narration);
    const plural = matchLoosely(narration, /\b(vous|votre|vos)\b/iu);
    if (!singular) return fail('second_person_singular', 'aucune marque de deuxième personne');
    if (plural !== null) return fail('second_person_singular', `« ${plural} » hors guillemets`);
    return pass('second_person_singular');
  },
};

/**
 * Never hand the turn back. Section 2.1: « la main revient au joueur
 * d'elle-même, tu n'as pas à la lui rendre ». A question INSIDE quotes is an
 * NPC speaking, which is why the last sentence is read on `stripQuoted`.
 */
export const noTerminalPrompt: Assertion = {
  id: 'no_terminal_prompt',
  hard: true,
  run: (output) => {
    const sentences = splitSentences(stripQuoted(output));
    const last = sentences[sentences.length - 1] ?? '';
    if (last.includes('?')) return fail('no_terminal_prompt', `question finale : « ${last} »`);
    const matched = matchLoosely(last, TERMINAL_PROMPT_PATTERN);
    return matched === null
      ? pass('no_terminal_prompt')
      : fail('no_terminal_prompt', `« ${matched} » en fin de narration`);
  },
};

export const languageFr: Assertion = {
  id: 'language_fr',
  hard: false,
  run: (output) => {
    const words = output.match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) ?? [];
    if (words.length === 0) return fail('language_fr', 'aucun mot');
    const french = words.filter((word) => findTerms(word, FRENCH_FUNCTION_WORDS).length > 0).length;
    const ratio = french / words.length;
    const english = findTerms(output, ENGLISH_FUNCTION_WORDS);
    if (english.length > 0) return fail('language_fr', `mots anglais : ${english.join(', ')}`);
    return ratio >= FRENCH_FUNCTION_WORD_RATIO_MIN
      ? pass('language_fr', `ratio ${ratio.toFixed(2)}`)
      : fail(
          'language_fr',
          `ratio ${ratio.toFixed(2)} sous ${String(FRENCH_FUNCTION_WORD_RATIO_MIN)}`,
        );
  },
};

/** Section 2.1: « Aucune phrase de plus de trente mots. » */
export const sentenceLengthCap: Assertion = {
  id: 'sentence_length_cap',
  hard: true,
  run: (output, ctx) => {
    const tooLong = splitSentences(output).find(
      (sentence) => countWords(sentence) > ctx.limits.sentenceWordCap,
    );
    return tooLong === undefined
      ? pass('sentence_length_cap')
      : fail(
          'sentence_length_cap',
          `${String(countWords(tooLong))} mots : « ${tooLong.slice(0, 80)}… »`,
        );
  },
};

export const maxOneDialogueLine: Assertion = {
  id: 'max_one_dialogue_line',
  hard: true,
  run: (output, ctx) => {
    const pairs = countDialoguePairs(output);
    return pairs <= ctx.limits.dialogueMax
      ? pass('max_one_dialogue_line', `${String(pairs)} réplique(s)`)
      : fail(
          'max_one_dialogue_line',
          `${String(pairs)} répliques, plafond ${String(ctx.limits.dialogueMax)}`,
        );
  },
};
