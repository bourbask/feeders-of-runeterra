import type { TurnProofDto } from '@for/contracts';
import type { ReactNode } from 'react';

import { proofLines } from './proof-lines.js';

/**
 * The unfolded proof. It renders `proofLines(proof)` and NOTHING ELSE: the
 * component takes no store, so there is no path by which a missing field could
 * be filled in from local state.
 *
 * `truncated` sends the reader to the full journal rather than showing a
 * shortened proof: a proof that quietly dropped rows would be worse than a
 * proof that says it is incomplete.
 */
export function ProofPanel(props: {
  readonly proof: TurnProofDto;
  readonly truncated: boolean;
}): ReactNode {
  const lignes = proofLines(props.proof);

  return (
    <div className="fr-preuve">
      {props.proof.status === 'reverted' && props.proof.revertedBy !== null ? (
        <p className="fr-preuve__annule">
          Tour annulé (journal n° {props.proof.revertedBy.seq}) — {props.proof.revertedBy.reason}
        </p>
      ) : null}

      {lignes.length === 0 ? (
        <p className="fr-vide">Le serveur n’a rien à montrer pour ce tour.</p>
      ) : (
        <dl className="fr-preuve__liste">
          {lignes.map((ligne) => (
            <div
              key={`${ligne.libelle}-${String(ligne.eventSeq)}-${ligne.valeur}`}
              className="fr-preuve__ligne"
            >
              <dt>{ligne.libelle}</dt>
              <dd>
                {ligne.valeur}{' '}
                <span className="fr-preuve__source">journal n° {ligne.eventSeq}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {props.truncated ? (
        <p className="fr-preuve__tronque">
          Preuve trop longue pour la socket : ouvre le journal complet de la campagne.
        </p>
      ) : null}
    </div>
  );
}
