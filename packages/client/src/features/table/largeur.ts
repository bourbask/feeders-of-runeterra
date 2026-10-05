/**
 * The four shapes of the table screen, and the widths at which it changes
 * shape (05-interface.md §4.2).
 *
 * « Une seule de ces cinq lignes est un point de rupture CSS, et c'est la
 * dernière : les quatre premières sont des SEUILS de largeur, pas des media
 * queries. Elles n'ont pas de code CSS, elles ont un TEST qui vérifie qu'en
 * dessous du seuil le contenu est bien dans un tiroir. »
 *
 * So the thresholds are a VALUE a test can read, and the shape is a pure
 * function of the width. The alternative — four `@media` blocks — would put
 * the rule somewhere no test can ask a question.
 *
 * THE NUMBERS ARE A MIRROR OF `tokens.css`, NOT A SECOND SOURCE. The design
 * owns them; this file repeats them because `@media (max-width: var(--x))` is
 * not a thing a browser supports. `screens.test.tsx` reads `tokens.css` and
 * compares the two, so the day someone moves a threshold in the stylesheet and
 * forgets this file, the comparison goes red instead of the screen going wrong.
 */

export type Largeur =
  /** Rangs 1 et 2 du §4.2 : les quatre colonnes, les marges cèdent d'abord. */
  | 'assise'
  /** Rang 3 : la fiche passe en tiroir gauche. */
  | 'tiroir-fiche'
  /** Rang 4 : le carnet passe en tiroir droit. Les deux sont des tiroirs. */
  | 'tiroirs'
  /** Rang 5 : les jauges passent horizontales en tête. */
  | 'portable';

/** The token each threshold mirrors. Read by the test, not by the code. */
export const JETONS_DES_SEUILS = {
  ficheEnTiroir: '--seuil-tiroir-fiche',
  carnetEnTiroir: '--seuil-tiroir-carnet',
  toutEnTiroir: '--seuil-tiroir-tout',
} as const;

/** In `rem`, so the screen follows the reader's own text size. */
export const SEUILS_REM = {
  ficheEnTiroir: 56.25,
  carnetEnTiroir: 43.75,
  toutEnTiroir: 35,
} as const;

/** Which shape a viewport of `largeurRem` gets. Total, and monotonic. */
export function largeurDe(largeurRem: number): Largeur {
  if (largeurRem >= SEUILS_REM.ficheEnTiroir) return 'assise';
  if (largeurRem >= SEUILS_REM.carnetEnTiroir) return 'tiroir-fiche';
  if (largeurRem >= SEUILS_REM.toutEnTiroir) return 'tiroirs';
  return 'portable';
}

/** Whether the sheet is a drawer at this width. §4.2 rank 3 and below. */
export function ficheEnTiroir(largeur: Largeur): boolean {
  return largeur !== 'assise';
}

/** Whether the right column is a drawer at this width. §4.2 rank 4 and below. */
export function coteEnTiroir(largeur: Largeur): boolean {
  return largeur === 'tiroirs' || largeur === 'portable';
}
