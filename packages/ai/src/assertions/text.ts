/**
 * The text machinery every assertion shares: normalisation, quoted-speech
 * stripping, and sentence segmentation (02-mj-ia.md section 8.4).
 *
 * ── SEGMENTATION IS THE RISK, AND IT IS NAMED ───────────────────────────────
 * ARCHITECTURE.md risk 4: French sentence segmentation and French morphology
 * are the two known sources of FALSE failures, and a false failure on a hard
 * assertion is an engine fallback a player sees. `sentence_count` and
 * `sentence_length_cap` are both built on the function below, so it is held
 * by tests/assertions.test.ts « découpe les vingt-deux exemples comme un
 * lecteur les compte » and « ne coupe pas à l'intérieur d'une réplique » —
 * ellipses, abbreviations and quoted dialogue, the three shapes that break
 * naive splitting.
 */

/** Section 8.4: `«` … `»` is character speech, and follows other rules. */
export const QUOTE_OPEN = '«';
export const QUOTE_CLOSE = '»';

/**
 * Lowercase, diacritics removed, spaces and hyphens unified.
 *
 * The exact preparation section 8.4 prescribes for `no_reserved_champion`,
 * and reused by every lexicon search: a blacklist that misses `Étrange`
 * because it only knows `étrange` is a blacklist that guards nothing. Held by
 * tests/assertions.test.ts « no_reserved_champion attrape le nom ET l'alias »,
 * whose third case is `la sorciere de glace` — unaccented and lowercase.
 */
export function normalize(text: string): string {
  return fold(text, 'ignore');
}

/**
 * Remove the portions between French quotes — NPC speech.
 *
 * An unmatched opening quote takes everything after it: a model that opens a
 * quote and never closes it has written one long line of dialogue, and
 * treating the tail as narration would let every prose rule be bypassed by a
 * single stray `«`. Held by tests/assertions.test.ts « stripQuoted retire la
 * parole, et avale une ouverture non fermée ».
 */
export function stripQuoted(text: string): string {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === QUOTE_OPEN) {
      depth += 1;
      continue;
    }
    if (ch === QUOTE_CLOSE) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

/** Count matched `«` … `»` pairs. Section 8.4, `max_one_dialogue_line`. */
export function countDialoguePairs(text: string): number {
  let depth = 0;
  let pairs = 0;
  for (const ch of text) {
    if (ch === QUOTE_OPEN) depth += 1;
    else if (ch === QUOTE_CLOSE && depth > 0) {
      depth -= 1;
      pairs += 1;
    }
  }
  return pairs;
}

/**
 * Abbreviations that end in a full stop, in TWO families — and the split
 * matters more than the lists themselves.
 *
 * A TITLE (`M.`, `Mme`, `Dr`) is always followed by a proper noun, so the
 * capital that follows it means nothing: it never ends a sentence.
 * An INLINE abbreviation (`etc.`, `cf.`) ends sentences all the time —
 * « Le froid, la neige, etc. Rien ne bouge. » is two sentences, and a single
 * list that protected `etc.` unconditionally merged them into one. Measured on
 * the examples of `tests/assertions.test.ts`, which is why there are two sets:
 * for an inline abbreviation the boundary is decided by what FOLLOWS.
 */
const TITLE_ABBREVIATIONS = new Set(['m', 'mm', 'mme', 'mmes', 'mlle', 'mlles', 'dr', 'st', 'ste']);

const INLINE_ABBREVIATIONS = new Set([
  'etc',
  'cf',
  'env',
  'av',
  'apr',
  'ex',
  'p',
  'pp',
  'vs',
  'ibid',
  'art',
  'chap',
  'j',
  'c',
]);

const TERMINATORS = new Set(['.', '!', '?', '…']);

/** Closing marks allowed to sit between the terminator and the whitespace. */
const CLOSERS = new Set([QUOTE_CLOSE, '"', "'", ')', ']', '’']);

const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/u.test(ch);

/**
 * Split French prose into sentences.
 *
 * Four rules, each one answering an observed failure:
 *  1. a run of terminators (`...`, `?!`, `…`) is ONE boundary, not three;
 *  2. a full stop right after an abbreviation of the closed list is not one;
 *  3. a terminator inside `«` … `»` is not one — but the closing `»` that
 *     follows one IS, so a quoted line stands as its own sentence;
 *  4. the terminator must be followed by whitespace, or by closing marks and
 *     then whitespace, or by the end of the text.
 */
export function splitSentences(text: string): readonly string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let at = 0;

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) out.push(trimmed);
    current = '';
  };

  while (at < text.length) {
    const ch = text[at] ?? '';
    current += ch;

    if (ch === QUOTE_OPEN) {
      depth += 1;
      at += 1;
      continue;
    }

    if (ch === QUOTE_CLOSE) {
      const wasQuoted = depth > 0;
      depth = Math.max(0, depth - 1);
      // Rule 3: a closing quote that ends a quoted sentence closes ours too.
      const beforeQuote = current.slice(0, -1).trimEnd();
      const previous = beforeQuote[beforeQuote.length - 1];
      if (wasQuoted && depth === 0 && previous !== undefined && TERMINATORS.has(previous)) {
        flush();
      }
      at += 1;
      continue;
    }

    if (!TERMINATORS.has(ch)) {
      at += 1;
      continue;
    }

    // Rule 1: swallow the whole run of terminators.
    let end = at + 1;
    while (end < text.length && TERMINATORS.has(text[end] ?? '')) {
      current += text[end] ?? '';
      end += 1;
    }

    if (depth > 0) {
      at = end;
      continue;
    }

    // Rule 2: abbreviations, only for a lone full stop.
    if (ch === '.' && end === at + 1) {
      const before = current.slice(0, -1);
      const token = normalize(/([\p{L}]+)$/u.exec(before)?.[1] ?? '');
      if (TITLE_ABBREVIATIONS.has(token)) {
        at = end;
        continue;
      }
      if (INLINE_ABBREVIATIONS.has(token)) {
        const next = /[\p{L}]/u.exec(text.slice(end))?.[0] ?? '';
        // A lowercase continuation means the sentence goes on; a capital means
        // the abbreviation ended it, which is what `etc.` usually does.
        if (next !== '' && next === next.toLowerCase()) {
          at = end;
          continue;
        }
      }
    }

    // Rule 4: closing marks then whitespace, or the end.
    let after = end;
    while (after < text.length && CLOSERS.has(text[after] ?? '')) {
      current += text[after] ?? '';
      after += 1;
    }
    if (isSpace(text[after])) {
      flush();
      at = after;
      continue;
    }
    at = end;
  }

  flush();
  return out;
}

/** Words, for `sentence_length_cap`. Apostrophes join, hyphens do not. */
export function countWords(sentence: string): number {
  const matches = sentence.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
  return matches?.length ?? 0;
}

const escapeRegExp = (term: string): string => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * How a lexicon search treats accents.
 *
 * `'ignore'` is what section 8.4 prescribes — « recherche insensible
 * casse/accents ». `'strict'` exists because that instruction is FALSE BY
 * CONSTRUCTION for two terms of `RULES_LEXICON`: accent-insensitively, `dé`
 * matches `de` and `dés` matches `des`, so the hard assertion would fail on
 * every French sentence ever written. Reported in the pull request rather than
 * worked around silently; `tests/assertions.test.ts` pins both halves.
 */
export type AccentMode = 'ignore' | 'strict';

/** Case and spacing folded; accents kept when the caller asks. */
export function fold(text: string, accents: AccentMode): string {
  const base = accents === 'ignore' ? deaccent(text) : text;
  return base
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212-]/gu, ' ')
    .replace(/[\u2018\u2019\u02bc]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

const isLetter = (ch: string | undefined): boolean => ch !== undefined && /\p{L}/u.test(ch);

/**
 * A word-boundary matcher for one term.
 *
 * The lookarounds are attached only where the term ENDS IN A LETTER. Without
 * that, `quelque chose d'` — which ends in an apostrophe — never matches
 * `quelque chose d'étrange`, because the trailing lookahead refuses the `é`
 * that always follows it. Measured: the term was in the list and the list
 * caught nothing.
 */
function termPattern(needle: string, flags: string): RegExp {
  const before = isLetter(needle[0]) ? '(?<![\\p{L}])' : '';
  const after = isLetter(needle[needle.length - 1]) ? '(?![\\p{L}])' : '';
  return new RegExp(`${before}${escapeRegExp(needle)}${after}`, flags);
}

/**
 * Find the terms of a closed list that appear on a WORD BOUNDARY.
 *
 * A plain `includes` reports `paraissent` as present in `n'apparaissent`;
 * that shape of green has already been measured in this package
 * (`prompt-size.test.ts`). So: fold both sides, then match with letter-boundary
 * lookarounds, which is what section 8.4 prescribes.
 */
export function findTerms(
  text: string,
  terms: readonly string[],
  accents: AccentMode = 'ignore',
): readonly string[] {
  const haystack = fold(text, accents);
  return terms.filter((term) => {
    const needle = fold(term, accents);
    if (needle.length === 0) return false;
    return termPattern(needle, 'u').test(haystack);
  });
}

/** Number of word-boundary occurrences of one term. */
export function countTerm(text: string, term: string, accents: AccentMode = 'ignore'): number {
  const needle = fold(term, accents);
  if (needle.length === 0) return 0;
  return fold(text, accents).match(termPattern(needle, 'gu'))?.length ?? 0;
}

/** Diacritics removed, case preserved. Used to match a pattern loosely. */
export const deaccent = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/gu, '');

/**
 * Run one of section 8.4's patterns, and return what it matched.
 *
 * The pattern is tried against the text AS WRITTEN and, if that misses,
 * against both sides with diacritics removed. A model that writes « tu
 * decides » without the accent is doing the thing the rule forbids, and an
 * assertion that lets it through because of one missing acute accent is an
 * assertion that guards nothing.
 */
export function matchLoosely(text: string, pattern: RegExp): string | null {
  const direct = pattern.exec(text);
  if (direct !== null) return direct[0];
  const loose = new RegExp(deaccent(pattern.source), pattern.flags.replace('g', ''));
  const found = loose.exec(deaccent(text));
  return found === null ? null : found[0];
}
