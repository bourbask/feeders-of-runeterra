import type { ReactNode } from 'react';
import { useEffect } from 'react';

import type { CoteTiroir } from './calques.js';

/**
 * A drawer, and the push-button that opens it (05-interface.md §4.4, §9).
 *
 * A DRAWER IS NOT A PANEL THAT SLIDES OVER ANOTHER. §4.4: « c'est un panneau
 * qui prend la place d'une colonne qui n'a plus de place ». So the markup is a
 * single region that the grid puts where the column used to be, and never a
 * floating layer — `table.css` gives it a grid track, not a `position: fixed`.
 *
 * WHY IT IS A `dialog` ALL THE SAME. `atMostOneDialog.test.tsx` counts the
 * `dialog` roles in the tree and demands at most one, « tiroirs compris ».
 * Giving the drawer the role is what puts it UNDER that count instead of
 * beside it — a drawer that called itself a `<div>` would make the test green
 * while two panels sat on screen. It carries no `aria-modal`: it replaces a
 * column, it does not trap the screen, and claiming otherwise would be a
 * promise no focus handling keeps.
 *
 * A CLOSED DRAWER ANNOUNCES ITS CONTENT (§9). « Un bouton-poussoir nu est un
 * bouton dont on ne devine pas l'usage ; il porte le nombre d'objets qu'il
 * contient, parce que c'est le seul chiffre d'un tiroir qui compte. » Held by
 * `Tiroir.test.tsx` « le bouton-poussoir porte le compte ».
 */

export function BoutonTiroir(props: {
  readonly cote: CoteTiroir;
  readonly titre: string;
  /** What is inside, counted. Shown whether the drawer is open or shut. */
  readonly compte: number;
  readonly ouvert: boolean;
  readonly cible: string;
  readonly onBasculer: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="fr-bouton-tiroir"
      data-cote={props.cote}
      aria-expanded={props.ouvert}
      aria-controls={props.cible}
      onClick={props.onBasculer}
    >
      <span className="fr-bouton-tiroir__titre">{props.titre}</span>
      <span className="fr-bouton-tiroir__compte"> · {props.compte}</span>
    </button>
  );
}

export function Tiroir(props: {
  readonly cote: CoteTiroir;
  readonly id: string;
  readonly titre: string;
  readonly onFermer: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const { onFermer } = props;

  // `Échap` closes it (§4.4). Bound on the document rather than on the panel:
  // the focus may well be on the push-button, which is outside the panel.
  useEffect(() => {
    const auClavier = (evenement: KeyboardEvent): void => {
      if (evenement.key === 'Escape') onFermer();
    };
    globalThis.document.addEventListener('keydown', auClavier);
    return () => {
      globalThis.document.removeEventListener('keydown', auClavier);
    };
  }, [onFermer]);

  return (
    <section
      className="fr-tiroir"
      data-cote={props.cote}
      id={props.id}
      role="dialog"
      aria-label={props.titre}
    >
      <header className="fr-tiroir__entete">
        <h2 className="fr-tiroir__titre">{props.titre}</h2>
        <button type="button" className="fr-bouton fr-bouton--discret" onClick={onFermer}>
          Fermer
        </button>
      </header>
      {props.children}
    </section>
  );
}
