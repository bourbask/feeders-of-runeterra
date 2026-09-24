/**
 * The reserved-champion fixture: who the storyteller may not name.
 *
 * WHY THE LIST IS HARD-CODED HERE, and not read from content. `@for/testkit`
 * ships in wave 4; `content/champions/` and `@for/content` ship in wave 6.
 * A dependency on them would be a cycle in time, so the fixture carries its
 * own short list — enough to prove the assertion, never a substitute for the
 * real index (`content/champions-index.json`, M0-16).
 *
 * `expectNoReservedChampion` therefore TAKES THE LIST AS AN ARGUMENT. It never
 * reaches for a global one: an assertion that guesses its own reference data is
 * an assertion nobody can aim.
 *
 * Aliases are content data, not AI data (02-mj-ia.md section 2.2): nicknames,
 * titles, epithets, French and English. A missing nickname is a silent hole —
 * which is why the real list is a CONTENT job, tracked at 02-mj-ia.md
 * section 9, item 5.
 *
 * ON THE `Cœur` / `Coeur` PAIR. The normalisation of 02-mj-ia.md section 8.4
 * is NFD plus diacritic removal, and the ligature `œ` is NOT a diacritic: it
 * does not decompose, so `Cœur` and `Coeur` normalise to two different
 * strings. Both spellings are listed, as the real content files will have to.
 */

/** One champion the storyteller may not name, with every way of naming them. */
export interface ReservedChampion {
  /** kebab-case, as `content/champions/<id>.json` is named. */
  readonly championId: string;
  readonly displayName: string;
  /** Nicknames, titles, epithets. Never empty: the lock rests entirely on it. */
  readonly aliases: readonly string[];
}

/**
 * Four champions, with the aliases the acceptance criteria name. Small on
 * purpose: a fixture is read by people.
 */
export const RESERVED_CHAMPIONS: readonly ReservedChampion[] = [
  {
    championId: 'sejuani',
    displayName: 'Sejuani',
    aliases: ['la Griffe de Givre', 'la Fureur du Nord', 'Sejuani Avarosan'],
  },
  {
    championId: 'braum',
    displayName: 'Braum',
    aliases: ['le Cœur du Freljord', 'le Coeur du Freljord', 'the Heart of the Freljord'],
  },
  {
    championId: 'lissandra',
    displayName: 'Lissandra',
    aliases: ['la Sorcière de Glace', 'la Gardienne de Glace'],
  },
  {
    championId: 'ornn',
    displayName: 'Ornn',
    aliases: ['le Feu sous la Montagne', 'the Fire below the Mountain'],
  },
];

/**
 * Every string that must not appear: display names AND aliases, flattened.
 *
 * Flattened here rather than inside the assertion so that a caller can pass a
 * narrower list — one campaign reserves three champions, not the whole index.
 */
export function reservedChampionNames(
  champions: readonly ReservedChampion[] = RESERVED_CHAMPIONS,
): readonly string[] {
  return champions.flatMap((champion) => [champion.displayName, ...champion.aliases]);
}
