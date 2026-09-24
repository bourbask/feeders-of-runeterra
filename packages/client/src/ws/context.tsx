/**
 * How a component reaches the socket store.
 *
 * THROUGH A CONTEXT, NEVER A MODULE SINGLETON. A singleton store would be
 * shared between two tests and between two tables, and « le store se fait
 * écraser par chaque instantané » is only safe when there is exactly one store
 * per connection. The provider is also what lets a test drive the store
 * directly and then assert on what the screen shows.
 */

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { TableState } from './store.js';

const TableStoreContext = createContext<StoreApi<TableState> | null>(null);

export function TableStoreProvider(props: {
  readonly store: StoreApi<TableState>;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <TableStoreContext.Provider value={props.store}>{props.children}</TableStoreContext.Provider>
  );
}

export function useTableStoreApi(): StoreApi<TableState> {
  const store = useContext(TableStoreContext);
  if (store === null) {
    throw new Error('useTableStore hors de <TableStoreProvider>');
  }
  return store;
}

export function useTable<TSlice>(selector: (state: TableState) => TSlice): TSlice {
  return useStore(useTableStoreApi(), selector);
}
