import type { ReactNode } from 'react';

import { EmptyState } from '../../components/ui/EmptyState.js';
import { Panel } from '../../components/ui/Panel.js';
import { useTable } from '../../ws/context.js';

/**
 * The empty shells M0 asks for: the panels of the table page exist, named and
 * placed, and each one says which task fills it. A screen that hides what is
 * missing is a screen that makes the milestone look further along than it is.
 *
 * WHAT THEY READ, THEY READ FROM THE SNAPSHOT. `s2c.snapshot` carries the
 * server's projection; the shells display counts from it and compute nothing.
 */

export function Sheet(): ReactNode {
  const personnages = useTable((state) => state.table?.characters.length ?? 0);
  return (
    <Panel titre="Fiche">
      <EmptyState>
        {personnages === 0
          ? 'Aucun personnage à cette table pour l’instant.'
          : `${String(personnages)} personnage(s) à la table. La fiche arrive avec M0-21.`}
      </EmptyState>
    </Panel>
  );
}

export function Gauges(): ReactNode {
  return (
    <Panel titre="Jauges">
      <EmptyState>
        Vigueur, âme et vivres s’affichent quand un personnage rejoint la table.
      </EmptyState>
    </Panel>
  );
}

export function MoveBar(): ReactNode {
  return (
    <Panel titre="Mouvements">
      <EmptyState>
        Le client n’envoie que des intentions : la barre de mouvements arrive avec le pipeline
        d’intentions (M0-21).
      </EmptyState>
    </Panel>
  );
}

export function Clocks(): ReactNode {
  const horloges = useTable((state) => state.table?.clocks.length ?? 0);
  return (
    <Panel titre="Horloges">
      <EmptyState>
        {horloges === 0 ? 'Aucune horloge ne tourne.' : `${String(horloges)} horloge(s) en cours.`}
      </EmptyState>
    </Panel>
  );
}

export function Vows(): ReactNode {
  const serments = useTable(
    (state) => state.table?.tracks.filter((piste) => piste.kind === 'vow').length ?? 0,
  );
  return (
    <Panel titre="Serments">
      <EmptyState>
        {serments === 0 ? 'Aucun serment prêté.' : `${String(serments)} serment(s) en cours.`}
      </EmptyState>
    </Panel>
  );
}
