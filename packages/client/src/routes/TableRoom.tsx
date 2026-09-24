import type { ReactNode } from 'react';

import { Panel } from '../components/ui/Panel.js';
import { Journal } from '../features/table/Journal.js';
import { Presence } from '../features/table/Presence.js';
import { Clocks, Gauges, MoveBar, Sheet, Vows } from '../features/table/Shells.js';
import { useTable } from '../ws/context.js';

const ETAT_CONNEXION: Readonly<Record<string, string>> = {
  idle: 'en attente',
  connecting: 'connexion…',
  open: 'connectée',
  closed: 'coupée — reconnexion en cours',
};

/**
 * The table page the definition of done asks for: it connects, it shows the
 * welcome, the snapshot and the presence, and every scene of its journal
 * carries a folded « Pourquoi ? » (ARCHITECTURE.md section 7, point 2).
 *
 * IT HOLDS NO GAME STATE OF ITS OWN. Everything below comes from the store,
 * which is a mirror of the server and is overwritten by each snapshot. There
 * is no `useState` here on purpose.
 */
export function TableRoom(): ReactNode {
  const status = useTable((state) => state.status);
  const welcome = useTable((state) => state.welcome);
  const lastSeq = useTable((state) => state.lastSeq);
  const table = useTable((state) => state.table);

  return (
    <main className="fr-ecran fr-ecran--table">
      <header className="fr-table__entete">
        <h1>La table</h1>
        <p className="fr-table__etat">
          Liaison : {ETAT_CONNEXION[status] ?? status}
          {welcome === null
            ? null
            : ` · contenu ${welcome.contentVersion} · journal n° ${String(lastSeq)}`}
        </p>
      </header>

      <div className="fr-table__corps">
        <Panel titre="Le fil">
          <Journal />
        </Panel>

        <aside className="fr-table__cote">
          <Panel titre="À la table">
            <Presence />
          </Panel>
          <Sheet />
          <Gauges />
          <Clocks />
          <Vows />
          <MoveBar />
        </aside>
      </div>

      {table === null ? (
        <p className="fr-vide">L’instantané de la table n’est pas encore arrivé.</p>
      ) : null}
    </main>
  );
}
