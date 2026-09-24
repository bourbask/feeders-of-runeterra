import type { ReactNode } from 'react';

import { Button } from '../../../components/ui/Button.js';
import { useTable, useTableStoreApi } from '../../../ws/context.js';
import { ProofPanel } from './ProofPanel.js';

/**
 * « Pourquoi ? » — P22, and the one command of this screen with a rule of its
 * own (02-mj-ia.md section 4.8.6).
 *
 *   REPLIÉ PAR DÉFAUT. Nothing mechanical is on the screen until someone asks:
 *   no die, no total, no effect, no price, no presage. The component renders
 *   the button alone until `openProofs` names this turn.
 *
 *   ONE CLICK, ONE `c2s.why`. The store refuses to send a second read for a
 *   proof it already holds or has already asked for, so a double click costs
 *   one frame, and folding back costs none.
 *
 *   A CANCELLED TURN KEEPS ITS COMMAND. That is the point of 4.8.6 (b): the
 *   turn stays on the screen, struck, and one can still read what had been
 *   rolled and why it fell. The button is never hidden for a reverted turn.
 */
export function ProofCommand(props: { readonly correlationId: string }): ReactNode {
  const store = useTableStoreApi();
  const ouverte = useTable((state) => state.openProofs.includes(props.correlationId));
  const preuve = useTable((state) => state.proofs[props.correlationId]);

  return (
    <div className="fr-pourquoi">
      <Button
        variant="discret"
        expanded={ouverte}
        onClick={() => {
          store.getState().toggleProof(props.correlationId);
        }}
      >
        {ouverte ? 'Masquer' : 'Pourquoi ?'}
      </Button>

      {ouverte ? (
        preuve === undefined ? (
          <p className="fr-vide">Le serveur prépare la preuve…</p>
        ) : (
          <ProofPanel proof={preuve.proof} truncated={preuve.truncated} />
        )
      ) : null}
    </div>
  );
}
