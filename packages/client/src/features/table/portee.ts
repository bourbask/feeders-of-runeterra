/**
 * The three scopes of ADR 0008, as the feed renders them (05-interface.md §5.2).
 *
 * THREE CHANNELS, NEVER TWO. A block carries its scope through the rail, the
 * indentation AND the glyph — plus `libelle`, which is written as TEXT on every
 * block, whatever the scope. That last one is the point of this file:
 *
 *   « Un bloc restreint est rouge, un bloc public n'est pas rouge : l'ABSENCE
 *     de rouge porterait le sens, ce qui est le pire support pour un
 *     daltonien. » (§5.3)
 *
 * So the colour is a REDUNDANCY. A player who cannot see `--portee-restreinte`
 * still reads « à ce groupe » in letters, and that is what stops the accident
 * no undo repairs. HELD BY `Journal.test.tsx` « chaque portée a un glyphe ET un
 * libellé en texte » and by the colour-stripped render in `screens.test.tsx`.
 *
 * `niveau` is a DEPTH, not a length: 0, 1, 2. The stylesheet turns it into the
 * 0 / 2rem / 4rem of §5.2, because a component does not write a length.
 */

import type { EventScope } from '@for/engine';

export interface PorteeVue {
  readonly scope: EventScope;
  /** Reading depth. `table.css` maps it to 0, `--e-7` (2rem), `--e-10` (4rem). */
  readonly niveau: 0 | 1 | 2;
  /** Decorative, `aria-hidden`. NEVER the only carrier of the scope. */
  readonly glyphe: string;
  /** ALWAYS rendered, as text, on every block. The channel that never lies. */
  readonly libelle: string;
}

/**
 * `satisfies Record<EventScope, …>` catches BOTH directions at compile time: a
 * scope added to the engine leaves a key missing, a scope removed leaves an
 * excess key. It does NOT catch the engine's tuple shrinking under a cast,
 * which is why `Journal.test.tsx` compares the keys to `EVENT_SCOPES` at
 * runtime too (ADR 0007, probe 4).
 */
export const PORTEES = {
  table: { scope: 'table', niveau: 0, glyphe: '┃', libelle: 'à toute la table' },
  subset: { scope: 'subset', niveau: 1, glyphe: '┃', libelle: 'à ce groupe' },
  private: { scope: 'private', niveau: 2, glyphe: '╏', libelle: 'à toi seul' },
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
