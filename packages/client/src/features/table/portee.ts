/**
 * The three scopes of ADR 0008, as the feed renders them (05-interface.md §5.2,
 * amended by the 5 October arbitrations).
 *
 * WHAT THE ARBITRATIONS CHANGED, AND WHAT THEY DID NOT.
 *
 *   - THREE TINTS, NOT TWO (arbitration A). `tokens.css` knew
 *     `--portee-publique` and `--portee-restreinte`; `--portee-personnelle` is
 *     new, and group and private no longer share a colour.
 *   - THE PRIVATE STROKE IS DASHED, the group one solid (arbitration B). That
 *     is a FOURTH channel and an uncoloured one: `trait` below, drawn by
 *     `table.css`.
 *   - PUBLIC CARRIES NOTHING AT ALL (correction 3): no rail, no indentation, no
 *     glyph, no band. « Le public est le défaut, et un défaut ne s'annonce
 *     pas. » So `marque` is false for `table`, and its glyph is the empty
 *     string — the one scope whose feed block is bare.
 *
 * WHY THAT DOES NOT COST THE §12 PROMISE. The promise is « la portée ne se lit
 * pas à la couleur seule », not « every block wears a label ». Strip every
 * colour and a restricted block still carries, in order: its band in letters,
 * its glyph, its indentation and a dashed-or-solid stroke; a public block
 * carries none of them, and the absence is itself legible to everyone,
 * colour-blind or not — which is exactly what §5.3 was protecting. The
 * colour-stripped renders of `screens.test.tsx` and `Journal.test.tsx` are what
 * hold it, and they assert the public block is bare AND that the two restricted
 * ones are not.
 *
 * `libelle` STAYS FOR ALL THREE because the COMPOSER needs three positions to
 * choose between (§7.1): a radio with no label is a radio nobody can tick.
 * `marque` is what separates « the composer names it » from « the feed marks
 * it ».
 *
 * `niveau` is a DEPTH, not a length: 0, 1, 2. The stylesheet turns it into the
 * 0 / 2rem / 4rem of §5.2, because a component does not write a length.
 */

import type { EventScope } from '@for/engine';

export interface PorteeVue {
  readonly scope: EventScope;
  /** Reading depth. `table.css` maps it to 0, `--e-7` (2rem), `--e-10` (4rem). */
  readonly niveau: 0 | 1 | 2;
  /** Decorative, `aria-hidden`. Empty for `table`: the default is not announced. */
  readonly glyphe: string;
  /** The words of the scope. Always rendered BY THE COMPOSER, whatever `marque`. */
  readonly libelle: string;
  /** Does a FEED block wear its scope? False for `table` only (correction 3). */
  readonly marque: boolean;
  /** Arbitration B: a third uncoloured channel, read by `table.css`. */
  readonly trait: 'aucun' | 'plein' | 'pointille';
}

/**
 * `satisfies Record<EventScope, …>` catches BOTH directions at compile time: a
 * scope added to the engine leaves a key missing, a scope removed leaves an
 * excess key. It does NOT catch the engine's tuple shrinking under a cast,
 * which is why `Journal.test.tsx` compares the keys to `EVENT_SCOPES` at
 * runtime too (ADR 0007, probe 4).
 */
export const PORTEES = {
  table: {
    scope: 'table',
    niveau: 0,
    glyphe: '',
    libelle: 'à toute la table',
    marque: false,
    trait: 'aucun',
  },
  subset: {
    scope: 'subset',
    niveau: 1,
    glyphe: '┃',
    libelle: 'à ce groupe',
    marque: true,
    trait: 'plein',
  },
  private: {
    scope: 'private',
    niveau: 2,
    glyphe: '╏',
    libelle: 'à toi seul',
    marque: true,
    trait: 'pointille',
  },
} as const satisfies Readonly<Record<EventScope, PorteeVue>>;

/** The three, in reading order: the whole table first, one player last. */
export const PORTEES_ORDONNEES: readonly PorteeVue[] = [
  PORTEES.table,
  PORTEES.subset,
  PORTEES.private,
];

export function porteeVue(scope: EventScope): PorteeVue {
  return PORTEES[scope];
}
