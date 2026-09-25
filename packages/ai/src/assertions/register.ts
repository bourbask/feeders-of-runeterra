/**
 * The register assertions of 02-mj-ia.md section 8.4 — teaching 1.
 *
 * The verdict on `conteur/1.0.0` was « fade et trop flou, on a du mal à s'y
 * plonger ». Asking for an « âpre, sensoriel, concret » tone changed nothing:
 * it is the TURNS OF PHRASE that make a register, not the adjectives in the
 * instruction. These measure the turns of phrase.
 *
 * ── THREE OF THEM ARE SOFT, AND THAT IS A DECISION ──────────────────────────
 * `adverb_budget`, `no_triads` and `no_anonymous_recurrent` lean on French
 * morphology, which ARCHITECTURE.md names as risk 4 alongside segmentation.
 * Their heuristics are good without being perfect, and making them block would
 * trade a marginal gain in style for engine fallbacks players see. The
 * opposite call was made for `banned_style_lexicon`: a closed list, no
 * morphological ambiguity, and the measured lever right after the examples.
 *
 * Held by tests/assertions.test.ts « adverb_budget, no_triads et
 * no_anonymous_recurrent restent souples » for the classification, and by
 * tests/degradation.test.ts « ne consomme que les assertions dures, pas les
 * souples » for what it buys: a soft failure does not cost a turn.
 */

import {
  ANONYMOUS_TERMS,
  ATMOSPHERE_ENDINGS,
  BANNED_STYLE_LEXICON,
  NAMED_EMOTIONS,
} from './lexicons.js';
import { countTerm, findTerms, matchLoosely, splitSentences, stripQuoted } from './text.js';
import { fail, pass, type Assertion } from './types.js';

export const bannedStyleLexicon: Assertion = {
  id: 'banned_style_lexicon',
  hard: true,
  run: (output) => {
    const found = findTerms(stripQuoted(output), BANNED_STYLE_LEXICON);
    return found.length === 0
      ? pass('banned_style_lexicon')
      : fail('banned_style_lexicon', `lexique interdit : ${found.join(', ')}`);
  },
};

/**
 * The emotion is never named; it is shown in the body.
 *
 * Three shapes, exactly as section 8.4 writes them. The second is bounded to
 * six words after `tu sens …` so that « tu sens la corde » — a fact of the
 * body — is not caught by a feeling that appears two sentences later. Held by
 * tests/assertions.test.ts « no_named_emotion refuse « tu ressens » et « tu
 * sens monter la peur » ».
 */
export const noNamedEmotion: Assertion = {
  id: 'no_named_emotion',
  hard: true,
  run: (output) => {
    const narration = stripQuoted(output);
    const direct = matchLoosely(narration, /\btu (ressens|éprouves)\b/iu);
    if (direct !== null) return fail('no_named_emotion', `« ${direct} »`);
    const heart = matchLoosely(narration, /\bton c(œ|oe)ur se serre\b/iu);
    if (heart !== null) return fail('no_named_emotion', `« ${heart} »`);
    const feeling = new RegExp(
      `\\btu sens (la|le|une|un|l'|monter|naitre|croitre)\\b(?:\\s+[\\p{L}'’]+){0,6}`,
      'iu',
    );
    const window = matchLoosely(narration, feeling);
    if (window !== null) {
      const named = findTerms(window, NAMED_EMOTIONS);
      if (named.length > 0) return fail('no_named_emotion', `« ${window.trim()} »`);
    }
    return pass('no_named_emotion');
  },
};

export const noAtmosphereEnding: Assertion = {
  id: 'no_atmosphere_ending',
  hard: true,
  run: (output) => {
    const sentences = splitSentences(stripQuoted(output));
    const last = sentences[sentences.length - 1] ?? '';
    const found = findTerms(last, ATMOSPHERE_ENDINGS);
    return found.length === 0
      ? pass('no_atmosphere_ending')
      : fail('no_atmosphere_ending', `fin d’atmosphère : ${found.join(', ')}`);
  },
};

/**
 * At most one adverb in `-ment` in the whole answer.
 *
 * The exclusion heuristic of section 8.4: a word in `-ment` PRECEDED by a
 * determiner or an adjective is a noun — `le hurlement`, `un craquement`,
 * `son serment`. Soft, precisely because that heuristic is the risk.
 */
export const adverbBudget: Assertion = {
  id: 'adverb_budget',
  hard: false,
  run: (output, ctx) => {
    const narration = stripQuoted(output);
    const determiners = new Set([
      'le',
      'la',
      'les',
      'un',
      'une',
      'des',
      'du',
      'de',
      'ce',
      'cet',
      'cette',
      'ces',
      'son',
      'sa',
      'ses',
      'ton',
      'ta',
      'tes',
      'mon',
      'ma',
      'mes',
      'leur',
      'leurs',
      'au',
      'aux',
      'ancien',
      'vieux',
      'long',
      'dernier',
      'premier',
      'meme',
      'seul',
      'grand',
      'petit',
    ]);
    const words = narration.match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) ?? [];
    const adverbs: string[] = [];
    for (let at = 0; at < words.length; at += 1) {
      const word = words[at] ?? '';
      if (!/ment$/iu.test(word) || word.length <= 4) continue;
      const before = (words[at - 1] ?? '').normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase();
      if (determiners.has(before)) continue;
      adverbs.push(word);
    }
    return adverbs.length <= ctx.limits.adverbMax
      ? pass('adverb_budget', adverbs.join(', '))
      : fail('adverb_budget', `${String(adverbs.length)} adverbes : ${adverbs.join(', ')}`);
  },
};

/**
 * No three-term enumerations. « Deux suffisent toujours. »
 *
 * A group is one to three words with no conjugated verb; the heuristic for
 * « no conjugated verb » is a short list of frequent endings, which is exactly
 * why this one is soft.
 */
export const noTriads: Assertion = {
  id: 'no_triads',
  hard: false,
  run: (output) => {
    const group = String.raw`[\p{L}'’]+(?:\s+[\p{L}'’]+){0,2}`;
    const triad = new RegExp(`${group},\\s*${group}\\s+et\\s+${group}`, 'u');
    for (const sentence of splitSentences(stripQuoted(output))) {
      const matched = triad.exec(sentence);
      if (matched === null) continue;
      const hasVerb = /\b[\p{L}]+(?:ait|aient|èrent|erent|ons|ez|ent|ait)\b/u.test(matched[0]);
      if (!hasVerb) return fail('no_triads', `énumération à trois termes : « ${matched[0]} »`);
    }
    return pass('no_triads');
  },
};

export const noAnonymousRecurrent: Assertion = {
  id: 'no_anonymous_recurrent',
  hard: false,
  run: (output) => {
    const repeated = ANONYMOUS_TERMS.filter((term) => countTerm(output, term) >= 2);
    return repeated.length === 0
      ? pass('no_anonymous_recurrent')
      : fail('no_anonymous_recurrent', `anonyme récurrent : ${repeated.join(', ')}`);
  },
};
