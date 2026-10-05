import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

/**
 * A layer, born at the centre and nowhere else (05-interface.md rule 8, §4.5).
 *
 * THERE IS NO PORTAL HERE, AND THAT IS THE POINT. Rule 8 says « toute modale
 * naît au centre » and §10 forbids « une modale qui naît hors du centre, ou
 * au-dessus d'un tiroir ». A `createPortal` to `document.body` would make the
 * rule untestable from the tree — the modal would have no parent column at
 * all. Rendered in place, inside the centre column, the rule becomes a fact a
 * test can read: `atMostOneDialog.test.tsx` walks up from the dialog and
 * demands it find `[data-colonne="centre"]`, never a side one.
 *
 * ONE AT A TIME is not this component's business — it is `calques.ts`'s, which
 * has one slot for a layer and empties the drawer slot when it fills it.
 *
 * FOCUS: taken on opening, given back on closing (§9, « piégeage du focus à
 * l'entrée, restitution à la sortie »). The trap itself is not written: a half
 * trap is worse than none, and the honest statement is that focus MOVES here
 * and comes back. `Escape` closes.
 */
export function Modale(props: {
  readonly titre: string;
  readonly onFermer: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const { onFermer } = props;
  const fermeture = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const precedent = globalThis.document.activeElement;
    fermeture.current?.focus();

    const auClavier = (evenement: KeyboardEvent): void => {
      if (evenement.key === 'Escape') onFermer();
    };
    globalThis.document.addEventListener('keydown', auClavier);

    return () => {
      globalThis.document.removeEventListener('keydown', auClavier);
      if (precedent instanceof HTMLElement) precedent.focus();
    };
  }, [onFermer]);

  return (
    <div className="fr-calque">
      <section className="fr-modale" role="dialog" aria-modal="true" aria-label={props.titre}>
        <header className="fr-modale__entete">
          <h2 className="fr-modale__titre">{props.titre}</h2>
          <button
            type="button"
            className="fr-bouton fr-bouton--discret"
            onClick={onFermer}
            ref={fermeture}
          >
            Fermer
          </button>
        </header>
        {props.children}
      </section>
    </div>
  );
}
