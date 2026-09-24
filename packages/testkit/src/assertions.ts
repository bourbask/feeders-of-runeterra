/**
 * Domain assertions.
 *
 * These three are the tools other tasks prove their own guardrails with, so
 * the bar here is not "it passes on a good value": it is that it FAILS on a
 * bad one. An assertion that accepts an invalid state is not a small defect —
 * it turns every check that leans on it green while checking nothing, which is
 * how two tasks were sent back in recette.
 *
 * Hence three refusals that look over-zealous and are not:
 *
 *   - `expectSeqContiguous([])` THROWS. An empty journal has no hole, so a
 *     permissive version would pass — and pass forever the day a test builds
 *     its journal from a filter that matches nothing. `{ allowEmpty: true }`
 *     says it on purpose.
 *   - `expectNoReservedChampion(text, [])` THROWS. Searching for nothing finds
 *     nothing. An empty reserved list is a caller bug, never a clean run.
 *   - `expectValidState` checks MORE than the schema, because the schema
 *     cannot see it: `zCampaignState` reads `characters` as a record of ULID
 *     to character and is perfectly happy with a character filed under
 *     somebody else's identifier. That state parses and lies.
 *
 * They throw named errors rather than calling `expect`: `@for/testkit` carries
 * no runner dependency, exactly like `expectGolden`.
 */

import type { CampaignStateDto } from '@for/contracts';
import { zCampaignState } from '@for/contracts';

/** Thrown when a value is not a campaign state, or is an incoherent one. */
export class InvalidTableState extends Error {
  /** One line per problem, in the order they were found. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`état de table invalide :\n  - ${issues.join('\n  - ')}`);
    this.name = 'InvalidTableState';
    this.issues = issues;
  }
}

/** Thrown when journal sequence numbers are not dense and ascending. */
export class SeqNotContiguous extends Error {
  readonly index: number;
  readonly expected: number;
  readonly found: number | undefined;

  constructor(message: string, index: number, expected: number, found: number | undefined) {
    super(message);
    this.name = 'SeqNotContiguous';
    this.index = index;
    this.expected = expected;
    this.found = found;
  }
}

/** Thrown when a reserved champion is named, by display name or by alias. */
export class ReservedChampionMentioned extends Error {
  /** The reserved string that matched, as it was given. */
  readonly matched: string;

  constructor(matched: string) {
    super(`champion réservé cité : « ${matched} »`);
    this.name = 'ReservedChampionMentioned';
    this.matched = matched;
  }
}

// ------------------------------------------------------------------- state

/**
 * Checks that each entry of a keyed collection is filed under its own
 * identifier. `zCampaignState` cannot: both sides are valid ULIDs, so a
 * character filed under someone else's identifier parses cleanly and lies.
 */
function keysMatchIds(
  label: string,
  collection: Readonly<Record<string, unknown>>,
  field = 'id',
): readonly string[] {
  const issues: string[] = [];
  for (const [key, value] of Object.entries(collection)) {
    const own = (value as Record<string, unknown>)[field];
    if (own !== key) {
      issues.push(
        `${label}.${key} est classé sous une clé qui n’est pas son ${field} (${String(own)})`,
      );
    }
  }
  return issues;
}

/**
 * Parses `value` as a campaign state and checks the coherences the schema
 * cannot express.
 *
 * @returns the parsed state, so a test can chain on it.
 * @throws InvalidTableState with every problem listed, not just the first.
 */
export function expectValidState(value: unknown): CampaignStateDto {
  const parsed = zCampaignState.safeParse(value);
  if (!parsed.success) {
    throw new InvalidTableState(
      parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join('.') || '<racine>'} : ${issue.message}`,
      ),
    );
  }

  const state = parsed.data;
  const issues: string[] = [
    ...keysMatchIds('characters', state.characters),
    ...keysMatchIds('tracks', state.tracks),
    ...keysMatchIds('clocks', state.clocks),
    ...keysMatchIds('entities', state.entities),
    ...keysMatchIds('championLocks', state.championLocks, 'championId'),
  ];

  if (!state.party.memberPlayerIds.includes(state.party.ownerPlayerId)) {
    issues.push(
      `party.ownerPlayerId (${state.party.ownerPlayerId}) n'est pas dans party.memberPlayerIds`,
    );
  }

  if (issues.length > 0) {
    throw new InvalidTableState(issues);
  }
  return state;
}

// ----------------------------------------------------------------- journal

/** Anything carrying a journal sequence number. */
export interface HasSeq {
  readonly seq: number;
}

export interface SeqContiguousOptions {
  /** The sequence number the first entry must carry. `1` for a whole journal. */
  readonly from?: number;
  /** Accept an empty list. Off by default: an empty list is a silent pass. */
  readonly allowEmpty?: boolean;
}

/**
 * Checks that `entries` carry `from`, `from + 1`, … with no hole, no repeat
 * and no step backwards.
 *
 * @throws SeqNotContiguous naming the index, what was expected and what was
 * found — a message that says "there is a hole" and not where costs the reader
 * the whole benefit.
 */
export function expectSeqContiguous(
  entries: readonly HasSeq[],
  options: SeqContiguousOptions = {},
): void {
  const from = options.from ?? 1;
  const allowEmpty = options.allowEmpty ?? false;

  if (entries.length === 0) {
    if (allowEmpty) return;
    throw new SeqNotContiguous(
      'expectSeqContiguous: liste vide. Une liste vide n’a pas de trou, donc elle passerait ' +
        'toujours : passe { allowEmpty: true } si c’est vraiment ce que tu veux vérifier.',
      0,
      from,
      undefined,
    );
  }

  for (const [index, entry] of entries.entries()) {
    const expected = from + index;
    if (entry.seq !== expected) {
      throw new SeqNotContiguous(
        `seq non contigus à l’index ${String(index)} : attendu ${String(expected)}, trouvé ${String(entry.seq)}`,
        index,
        expected,
        entry.seq,
      );
    }
  }
}

// --------------------------------------------------------------- champions

/**
 * The normalisation of 02-mj-ia.md section 8.4: NFD, diacritics dropped,
 * lower case, runs of spaces and hyphens folded into one space.
 *
 * « LA GRIFFE-DE-GIVRE » and « la griffe de givre » therefore become the same
 * string, which is the point: a reserved name is not made safe by shouting it
 * or by hyphenating it.
 *
 * WHAT IT DOES NOT FOLD: the ligature `œ`. It is not a diacritic and NFD
 * leaves it alone, so `Cœur` and `Coeur` stay two different strings. Content
 * has to list both spellings (see `RESERVED_CHAMPIONS`).
 */
export function normaliseChampionName(text: string): string {
  return text
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036F]/gu, '')
    .toLowerCase()
    .replaceAll(/[\s\u2010-\u2015_-]+/gu, ' ')
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/**
 * Checks that no reserved champion is named — by display name OR by alias.
 *
 * @param text what the storyteller wrote.
 * @param reserved every forbidden spelling, flattened. `reservedChampionNames()`
 * builds it from the fixture; a campaign passes its own three.
 * @throws ReservedChampionMentioned naming which spelling matched.
 */
export function expectNoReservedChampion(text: string, reserved: readonly string[]): void {
  if (reserved.length === 0) {
    throw new RangeError(
      'expectNoReservedChampion: liste réservée vide. Chercher zéro nom ne trouve jamais rien ' +
        'et rendrait cette assertion inerte.',
    );
  }

  const haystack = normaliseChampionName(text);

  for (const name of reserved) {
    const needle = normaliseChampionName(name);
    if (needle === '') {
      throw new RangeError(
        `expectNoReservedChampion: « ${name} » se normalise en chaîne vide et matcherait partout.`,
      );
    }
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u');
    if (pattern.test(haystack)) {
      throw new ReservedChampionMentioned(name);
    }
  }
}
