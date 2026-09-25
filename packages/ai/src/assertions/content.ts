/**
 * The content assertions of 02-mj-ia.md section 8.4: what the prose may say
 * about the RULES, the WORLD and the TURN.
 *
 * Four of them are the mechanical half of an invariant rather than a style
 * preference:
 *
 *  - `no_outcome_decision` — invariant 1 read on the output: the storyteller
 *    does not settle an outcome the `<fait>` has not already settled;
 *  - `no_reserved_champion` — the distribution lock, which is why a failure is
 *    ALWAYS logged as an alert, even when the retry succeeds (section 8.6);
 *  - `price_respected` — the imposed price is the content table's entry, not a
 *    menu (ADR 0006);
 *  - `no_time_skip` — time that costs something comes from what the characters
 *    play, never from the narration.
 */

import {
  OOC_LEXICON,
  OUTCOME_DECISION_LEXICON,
  PC_AGENCY_PATTERN,
  PRICE_EVASION_PATTERN,
  RULES_LEXICON,
  RULES_LEXICON_ACCENT_SENSITIVE,
  SENSORY_LEXICON,
  TIME_SKIP_PATTERN,
} from './lexicons.js';
import { findTerms, matchLoosely, normalize, splitSentences, stripQuoted } from './text.js';
import { fail, pass, type Assertion } from './types.js';

/**
 * No word of our rule vocabulary, outside character speech.
 *
 * ── ONE TERM IS SEARCHED WITH ITS ACCENTS, AND WHY ──────────────────────────
 * Section 8.4 says « recherche insensible casse/accents ». Applied literally
 * to `dé` and `dés`, that matches `de` and `des`, so this HARD assertion would
 * fail on every French sentence and take the production post-filter with it.
 * Those two are therefore searched accent-sensitively, and the departure is
 * reported rather than hidden — `tests/assertions.test.ts` pins both halves.
 *
 * ── AND ONE QUALIFIER CANNOT BE HELD ────────────────────────────────────────
 * The spec writes `âme (en contexte de jauge)`. « Context of gauge » is not
 * mechanically expressible, so this assertion is STRICTER than the spec on
 * that one word: any `âme` outside quotes fails. Said rather than implied, and
 * pinned by a test, because the cost is real — a legitimate `âme` in prose is
 * one engine fallback a player sees.
 */
export const noRulesLexicon: Assertion = {
  id: 'no_rules_lexicon',
  hard: true,
  run: (output) => {
    const narration = stripQuoted(output);
    const found = [
      ...findTerms(narration, RULES_LEXICON),
      ...findTerms(narration, RULES_LEXICON_ACCENT_SENSITIVE, 'strict'),
    ];
    return found.length === 0
      ? pass('no_rules_lexicon')
      : fail('no_rules_lexicon', `lexique de règle : ${found.join(', ')}`);
  },
};

export const noOutcomeDecision: Assertion = {
  id: 'no_outcome_decision',
  hard: true,
  run: (output) => {
    const found = findTerms(output, OUTCOME_DECISION_LEXICON);
    return found.length === 0
      ? pass('no_outcome_decision')
      : fail('no_outcome_decision', `décision d’issue : ${found.join(', ')}`);
  },
};

/**
 * Not one reserved champion, under any of its names.
 *
 * The aliases are searched as well as the display name: a lock that only knows
 * `Ashe` and not `la Reine du Gel` is a lock on a door with a second door
 * beside it.
 */
export const noReservedChampion: Assertion = {
  id: 'no_reserved_champion',
  hard: true,
  run: (output, ctx) => {
    const names = ctx.reservedChampions.flatMap((champion) => [
      champion.displayName,
      ...champion.aliases,
    ]);
    const found = findTerms(output, names);
    return found.length === 0
      ? pass('no_reserved_champion')
      : fail('no_reserved_champion', `champion réservé nommé : ${found.join(', ')}`);
  },
};

/**
 * The storyteller never makes a player character speak, think or decide.
 *
 * Two shapes, both from section 8.4: a line of dialogue ATTRIBUTED to a player
 * character, and the `tu décides` family on the narration.
 */
export const noPcAgency: Assertion = {
  id: 'no_pc_agency',
  hard: true,
  run: (output, ctx) => {
    for (const name of ctx.playerCharacterNames) {
      const folded = normalize(name);
      if (folded.length === 0) continue;
      const escaped = folded.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const attributed = new RegExp(
        `»[^.!?]{0,20}\\b(dit|repond|lance|murmure|crie|souffle)\\b[^.!?]{0,10}${escaped}` +
          `|${escaped}[^.!?]{0,20}\\b(dit|repond|lance|murmure|crie|souffle)\\b[^«]{0,10}«`,
        'u',
      );
      if (attributed.test(normalize(output))) {
        return fail('no_pc_agency', `réplique attribuée à ${name}`);
      }
    }
    const matched = matchLoosely(stripQuoted(output), PC_AGENCY_PATTERN);
    return matched === null
      ? pass('no_pc_agency')
      : fail('no_pc_agency', `décision prêtée au personnage : « ${matched} »`);
  },
};

export const noOocLexicon: Assertion = {
  id: 'no_ooc_lexicon',
  hard: false,
  run: (output) => {
    const found = findTerms(output, OOC_LEXICON);
    return found.length === 0
      ? pass('no_ooc_lexicon')
      : fail('no_ooc_lexicon', `vocabulaire hors monde : ${found.join(', ')}`);
  },
};

export const mentionsAny: Assertion = {
  id: 'mentions_any',
  hard: false,
  run: (output, ctx) => {
    if (ctx.mentionsAny.length === 0) return pass('mentions_any', 'aucune valeur demandée');
    const found = findTerms(output, ctx.mentionsAny);
    return found.length > 0
      ? pass('mentions_any', found.join(', '))
      : fail('mentions_any', `aucun de : ${ctx.mentionsAny.join(', ')}`);
  },
};

/**
 * The imposed price is staged, not dodged — and it is RECOGNISABLE.
 *
 * Two halves, and both are needed. The evasion pattern catches « mais tu en
 * sors indemne »; the keyword half catches the subtler failure, a narration
 * that simply writes something else. The keywords come from the versioned
 * content (`PriceTableSchema.entries[].keywords`, a MANDATORY field): without
 * them this hard assertion has nothing to score against and only tests half
 * its rule.
 */
export const priceRespected: Assertion = {
  id: 'price_respected',
  hard: true,
  run: (output, ctx) => {
    if (ctx.priceKeywords === null) return pass('price_respected', 'aucun prix imposé ce tour');
    if (ctx.priceKeywords.length === 0) {
      return fail('price_respected', "l'entrée tirée ne porte aucun keywords : rien à noter");
    }
    const evasion = matchLoosely(output, PRICE_EVASION_PATTERN);
    if (evasion !== null) return fail('price_respected', `évitement du prix : « ${evasion} »`);
    const found = findTerms(output, ctx.priceKeywords);
    return found.length > 0
      ? pass('price_respected', found.join(', '))
      : fail('price_respected', `aucun mot-clé de l’entrée : ${ctx.priceKeywords.join(', ')}`);
  },
};

export const noTimeSkip: Assertion = {
  id: 'no_time_skip',
  hard: true,
  run: (output, ctx) => {
    if (ctx.factHasTimeSkip) return pass('no_time_skip', 'saut porté par le <fait>');
    const matched = matchLoosely(stripQuoted(output), TIME_SKIP_PATTERN);
    return matched === null
      ? pass('no_time_skip')
      : fail('no_time_skip', `saut de temps non justifié : « ${matched} »`);
  },
};

/**
 * Tool calls stay inside the case's allow-list.
 *
 * In M0 that list is EMPTY (ADR 0011, prose-only): the request carries no
 * tools, so a tool call is impossible — and this assertion is what says so out
 * loud if one ever appears.
 */
export const toolCalls: Assertion = {
  id: 'tool_calls',
  hard: false,
  run: (_output, ctx) => {
    const outside = ctx.toolCalls.filter((name) => !ctx.allowedTools.includes(name));
    if (outside.length > 0) return fail('tool_calls', `outils hors liste : ${outside.join(', ')}`);
    return ctx.toolCalls.length <= ctx.limits.toolCallsMax
      ? pass('tool_calls', `${String(ctx.toolCalls.length)} appel(s)`)
      : fail(
          'tool_calls',
          `${String(ctx.toolCalls.length)} appels, plafond ${String(ctx.limits.toolCallsMax)}`,
        );
  },
};

/** Section 8.4, optional, reserved for the N2 judge when it is undecided. */
export const endsConcrete: Assertion = {
  id: 'ends_concrete',
  hard: false,
  optional: true,
  run: (output, ctx) => {
    const sentences = splitSentences(stripQuoted(output));
    const last = sentences[sentences.length - 1] ?? '';
    const found = [...findTerms(last, ctx.sceneEntityNames), ...findTerms(last, SENSORY_LEXICON)];
    return found.length > 0
      ? pass('ends_concrete', found.join(', '))
      : fail('ends_concrete', `fin sans entité ni détail sensoriel : « ${last} »`);
  },
};
