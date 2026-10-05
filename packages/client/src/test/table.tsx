import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';

import type { Largeur } from '../features/table/largeur.js';
import { EcranDeTable } from '../routes/TableRoom.js';
import { TableStoreProvider } from '../ws/context.js';
import type { TableState } from '../ws/store.js';
import { createTableStore } from '../ws/store.js';

/**
 * Le gréement commun aux tests de l'écran de table.
 *
 * `newId` est un compteur, pas `crypto.randomUUID()` : une trame dont
 * l'identifiant change à chaque exécution est une trame qu'aucune assertion ne
 * peut citer.
 */
export function unStore(envoyes: unknown[] = []): StoreApi<TableState> {
  let compteur = 0;
  return createTableStore({
    send: (frame) => envoyes.push(frame),
    newId: () => {
      compteur += 1;
      return `00000000-0000-4000-8000-${compteur.toString(16).padStart(12, '0')}`;
    },
    clientVersion: 'test',
  });
}

/**
 * Rend l'écran À UNE LARGEUR DONNÉE. La largeur est une valeur, pas une
 * fenêtre : `05-interface.md` §4.2 dit que les quatre premiers paliers ne sont
 * pas des media queries mais des seuils, « elles ont un TEST ». C'est celui-là
 * qui les lit, et il ne peut le faire que si la forme est un argument.
 */
export function rendreTable(options: {
  readonly largeur?: Largeur;
  readonly store?: StoreApi<TableState>;
}): StoreApi<TableState> {
  const store = options.store ?? unStore();
  render(
    <TableStoreProvider store={store}>
      <EcranDeTable largeur={options.largeur ?? 'assise'} />
    </TableStoreProvider>,
  );
  return store;
}

/** Les panneaux ouverts, tiroirs compris : ce que la règle 7 plafonne à un. */
export function panneauxOuverts(): readonly Element[] {
  return [
    ...new Set([
      ...globalThis.document.querySelectorAll('[role="dialog"]'),
      ...globalThis.document.querySelectorAll('[aria-modal="true"]'),
    ]),
  ];
}

export function envelopper(store: StoreApi<TableState>, enfant: ReactNode): ReactNode {
  return <TableStoreProvider store={store}>{enfant}</TableStoreProvider>;
}
