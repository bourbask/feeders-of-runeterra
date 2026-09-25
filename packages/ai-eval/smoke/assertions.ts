/**
 * The seven hand-written checks of the smoke probe (M0-32), FROZEN.
 *
 * THE ONE AUTHORISED DUPLICATION of the production corpus, and it is bounded:
 * it lives here, it does not grow, nobody imports it. `ARCHITECTURE.md` §5
 * names this exception and says why — these checks must exist BEFORE the
 * production corpus in order to give the early signal at all. M0-27 and M0-31
 * score with `@for/ai`'s own checks and with nothing else.
 *
 * WHAT EACH ONE MEASURES, AND WHAT IT DOES NOT. Every rule below is a regular
 * expression over the model's output. None of them judges quality: the probe
 * answers "does the constrained prompt stand up", not "is the prose good".
 *
 * THE BOUNDS ARE HERE AND THE CHECK IS IN `run-smoke.ts`. Six to eight, from
 * the M0-32 sheet. A ninth check added below makes `pnpm eval:smoke` exit 1 —
 * proved by adding one, not by reading this sentence:
 * `run-smoke.test.ts` « le compte hors bornes fait sortir en 1 ».
 */

import { SceneBlockSchema } from '@for/contracts';

import type { SmokeCase } from './cases.js';

/** M0-32 sheet: at least six checks, at most eight. */
export const SMOKE_ASSERTIONS_MIN = 6;
export const SMOKE_ASSERTIONS_MAX = 8;

/** 02-mj-ia.md §2.1, "Forme de ta réponse": between three and five sentences. */
export const SMOKE_SENTENCES_MIN = 3;
export const SMOKE_SENTENCES_MAX = 5;

export interface SmokeCheckResult {
  readonly id: string;
  readonly passed: boolean;
  /** The offending excerpt, or '' when the rule passed. Read straight into the report. */
  readonly detail: string;
}

export interface SmokeCheck {
  readonly id: string;
  readonly run: (output: string, smokeCase: SmokeCase) => SmokeCheckResult;
}

// ------------------------------------------------------------------ helpers

const OPEN_TAG = '<scene_apres>';
const CLOSE_TAG = '</scene_apres>';

/** Both apostrophes collapse to one, so a rule written with `'` also catches `’`. */
const normaliseApostrophes = (text: string): string => text.replaceAll('’', "'");

/**
 * The prose is what precedes the block. A model that writes no block gets its
 * whole output read as prose, which is what makes `scene_block_present` the
 * check that fails rather than `length_in_range`.
 */
export function prose(output: string): string {
  const at = output.indexOf(OPEN_TAG);
  return (at === -1 ? output : output.slice(0, at)).trim();
}

/** The text between the first pair of tags, or null when there is no closed pair. */
export function sceneBlockBody(output: string): string | null {
  const open = output.indexOf(OPEN_TAG);
  if (open === -1) return null;
  const close = output.indexOf(CLOSE_TAG, open + OPEN_TAG.length);
  if (close === -1) return null;
  return output.slice(open + OPEN_TAG.length, close);
}

/**
 * Drops what is inside French quotation marks: an NPC speaking is held to
 * different rules than the narration (02-mj-ia.md §8.4, `stripQuoted`).
 */
export function stripQuoted(text: string): string {
  return text.replaceAll(/«[^»]*»?/gu, ' ');
}

const ABBREVIATION_GUARD = /\b(M|Mme|Mlle|MM|St|Ste|cf|etc)\./gu;
const GUARD = '\u0000';

/**
 * Sentence segmentation on `[.!?…]` followed by whitespace or end of text,
 * with the abbreviations of §8.4 protected first. Returns the trimmed,
 * non-empty pieces.
 */
export function sentences(text: string): readonly string[] {
  const guarded = text.replaceAll(ABBREVIATION_GUARD, (match) => match.replace('.', GUARD));
  const pieces = guarded.match(/[^.!?…]+(?:[.!?…]+|$)/gu) ?? [];
  return pieces
    .map((piece) => piece.replaceAll(GUARD, '.').trim())
    .filter((piece) => piece.length > 0);
}

/**
 * A word-boundary matcher that works on accented French. `\b` is ASCII-only:
 * `/\bdé\b/` never matches, because `é` is not a word character for it — so
 * the rule that forbids `dé` would have been silently inert.
 */
function wordPattern(terms: readonly string[]): RegExp {
  const body = terms.map((term) => term.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
  // NO `g` FLAG, ON PURPOSE: these patterns are module-level constants and a
  // sticky `lastIndex` would make the SECOND call on the same pattern start
  // mid-text — a rule that passes because it already matched once.
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'iu');
}

/** NFD, diacritics dropped, lowercased. Used only where accents must not matter. */
export function fold(text: string): string {
  return normaliseApostrophes(text)
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

const excerpt = (text: string, size = 70): string => {
  const flat = text.replaceAll(/\s+/gu, ' ').trim();
  return flat.length <= size ? flat : `${flat.slice(0, size)}…`;
};

const ok = (id: string): SmokeCheckResult => ({ id, passed: true, detail: '' });
const ko = (id: string, detail: string): SmokeCheckResult => ({ id, passed: false, detail });

// ------------------------------------------------------------- the checks

const lengthInRange: SmokeCheck = {
  id: 'length_in_range',
  run: (output) => {
    const count = sentences(prose(output)).length;
    return count >= SMOKE_SENTENCES_MIN && count <= SMOKE_SENTENCES_MAX
      ? ok('length_in_range')
      : ko('length_in_range', `${String(count)} phrases`);
  },
};

const SECOND_PERSON = wordPattern(['tu', 'te', "t'", 'ton', 'ta', 'tes', 'toi']);
const SECOND_PERSON_PLURAL = wordPattern(['vous', 'votre', 'vos']);

const secondPersonSingular: SmokeCheck = {
  id: 'second_person_singular',
  run: (output) => {
    const text = normaliseApostrophes(stripQuoted(prose(output)));
    const plural = SECOND_PERSON_PLURAL.exec(text);
    if (plural !== null) return ko('second_person_singular', `« ${plural[0]} » hors guillemets`);
    return SECOND_PERSON.test(text)
      ? ok('second_person_singular')
      : ko('second_person_singular', 'aucun « tu » hors guillemets');
  },
};

/** M0-32 sheet: no numeric character, and no roll vocabulary. */
const ROLL_LEXICON = wordPattern([
  'jet',
  'jets',
  'dé',
  'dés',
  'réussis',
  'réussit',
  'échoues',
  'échoue',
]);

const noOutcomeDecision: SmokeCheck = {
  id: 'no_outcome_decision',
  run: (output) => {
    const text = prose(output);
    const digit = /\p{Nd}/u.exec(text);
    if (digit !== null) return ko('no_outcome_decision', `chiffre « ${digit[0]} » dans la prose`);
    const word = ROLL_LEXICON.exec(text);
    return word === null ? ok('no_outcome_decision') : ko('no_outcome_decision', `« ${word[0]} »`);
  },
};

const noLockedChampion: SmokeCheck = {
  id: 'no_locked_champion',
  run: (output, smokeCase) => {
    const hay = fold(output);
    for (const champion of smokeCase.lockedChampions) {
      for (const term of [champion.name, ...champion.aliases]) {
        const found = wordPattern([fold(term)]).exec(hay);
        if (found !== null) return ko('no_locked_champion', `« ${term} »`);
      }
    }
    return ok('no_locked_champion');
  },
};

const TERMINAL_PROMPT =
  /que fais[- ]tu|qu'est[- ]ce que tu (fais|décides)|que décides[- ]tu|comment réagis[- ]tu|à toi de jouer|c'est à toi/iu;

const noFinalQuestion: SmokeCheck = {
  id: 'no_final_question',
  run: (output) => {
    const unquoted = sentences(normaliseApostrophes(stripQuoted(prose(output))));
    const last = unquoted.at(-1);
    if (last === undefined) return ok('no_final_question');
    if (last.includes('?')) return ko('no_final_question', excerpt(last));
    return TERMINAL_PROMPT.test(last)
      ? ko('no_final_question', excerpt(last))
      : ok('no_final_question');
  },
};

const sceneBlockPresent: SmokeCheck = {
  id: 'scene_block_present',
  run: (output) => {
    const opens = output.split(OPEN_TAG).length - 1;
    const closes = output.split(CLOSE_TAG).length - 1;
    if (opens === 0)
      return ko('scene_block_present', `fin de sortie : ${excerpt(output.slice(-70))}`);
    if (opens > 1) return ko('scene_block_present', `${String(opens)} ouvertures`);
    if (closes !== 1) return ko('scene_block_present', `${String(closes)} fermetures`);
    return ok('scene_block_present');
  },
};

const sceneBlockWellformed: SmokeCheck = {
  id: 'scene_block_wellformed',
  run: (output) => {
    const body = sceneBlockBody(output);
    if (body === null) return ko('scene_block_wellformed', 'aucun bloc fermé à valider');
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return ko('scene_block_wellformed', `JSON illisible : ${excerpt(body)}`);
    }
    const result = SceneBlockSchema.safeParse(parsed);
    if (result.success) return ok('scene_block_wellformed');
    const issue = result.error.issues[0];
    const path = issue === undefined ? '' : issue.path.join('.');
    const message = issue === undefined ? 'forme refusée' : issue.message;
    return ko('scene_block_wellformed', `${path === '' ? '(racine)' : path} : ${message}`);
  },
};

/**
 * The frozen table. Order is the report's order, so two runs list the fallen
 * checks the same way.
 */
export const SMOKE_ASSERTIONS: readonly SmokeCheck[] = Object.freeze([
  lengthInRange,
  secondPersonSingular,
  noOutcomeDecision,
  noLockedChampion,
  noFinalQuestion,
  sceneBlockPresent,
  sceneBlockWellformed,
]);
