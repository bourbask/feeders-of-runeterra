import type { ReactNode } from 'react';

/**
 * A shell that says what it is waiting for. M0 ships a table with no game
 * feature in it; a panel that renders nothing is indistinguishable from a
 * panel that is broken, and the difference matters on the day of the demo.
 */
export function EmptyState(props: { readonly children: ReactNode }): ReactNode {
  return <p className="fr-vide">{props.children}</p>;
}
