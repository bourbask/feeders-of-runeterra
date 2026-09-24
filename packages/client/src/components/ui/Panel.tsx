import type { ReactNode } from 'react';

/** A titled region. Headings are real headings: a screen reader reads the table. */
export function Panel(props: { readonly titre: string; readonly children: ReactNode }): ReactNode {
  return (
    <section className="fr-panneau" aria-label={props.titre}>
      <h2 className="fr-panneau__titre">{props.titre}</h2>
      {props.children}
    </section>
  );
}
