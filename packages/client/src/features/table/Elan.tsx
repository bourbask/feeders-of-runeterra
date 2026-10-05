import type { ReactNode } from 'react';

/**
 * The momentum — « élan » in the product's own words (05-interface.md §11.1,
 * `docs/GLOSSAIRE.md`).
 *
 * IT IS NOT A GAUGE, and this file exists so that saying so costs nothing.
 * §6.3: « C'est une ressource qui se dépense, elle a une FENÊTRE, et une
 * fenêtre fermée ne peut plus être dépensée. Elle se rend comme un badge
 * chiffré près du tour, pas comme une barre : une barre invite à être cliquée,
 * et une fenêtre de jet n'a rien à faire d'un clic. »
 *
 * So: no tube, no pips, no fill, no `fr-jauge` class, and nothing clickable.
 * A number, a word, and — when the window is shut — the sentence that says the
 * number can no longer be spent. `Jauge.test.tsx` holds the other half: the
 * three gauges render no momentum at all.
 */
export function Elan(props: {
  readonly valeur: number;
  /** ADR 0009: a roll window. Closed, the value is inert and says so. */
  readonly fenetreOuverte: boolean;
}): ReactNode {
  return (
    <p className="fr-elan" data-fenetre={props.fenetreOuverte ? 'ouverte' : 'fermee'}>
      <span className="fr-elan__nom">Élan</span>{' '}
      <span className="fr-elan__valeur">{props.valeur}</span>
      {props.fenetreOuverte ? null : (
        <span className="fr-elan__fenetre"> — aucune fenêtre ouverte</span>
      )}
    </p>
  );
}
