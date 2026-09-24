/**
 * `s2c.turn_proof` turned into readable lines — AND NOTHING ELSE
 * (02-mj-ia.md section 4.8.6 (c), P22).
 *
 * THE FUNCTION TAKES THE PAYLOAD AND NOTHING ELSE, and that signature is the
 * guard. There is no state parameter, no store, no event list: the client
 * CANNOT recompose a proof from what it holds locally, because the only thing
 * this function can read is what the server sent. Remove `roll` from the
 * payload and the « jet » line disappears — it does not get rebuilt from the
 * `roll.action_resolved` sitting in the journal.
 *
 * EVERY LINE CARRIES ITS `eventSeq`. That is what makes the proof checkable:
 * one walks back from a label to the journal line that establishes it. A line
 * without one would be data fabricated for display.
 */

import type { TurnProofDto } from '@for/contracts';

export interface ProofLine {
  /** Stable key, and the French label of the row. */
  readonly libelle: string;
  /** What the server said. Never computed here. */
  readonly valeur: string;
  /** The journal entry this row comes from. */
  readonly eventSeq: number;
}

/** The rows of a proof, in reading order. Absent fields produce no row. */
export function proofLines(proof: TurnProofDto): ProofLine[] {
  const lignes: ProofLine[] = [];

  if (proof.move !== null) {
    const attribut = proof.move.attribute === null ? '' : ` · ${proof.move.attribute}`;
    const bonus =
      proof.move.bonus === null || proof.move.bonus === 0
        ? ''
        : ` · bonus ${String(proof.move.bonus)}`;
    lignes.push({
      libelle: 'Mouvement',
      valeur: `${proof.move.label}${attribut}${bonus}`,
      eventSeq: proof.move.eventSeq,
    });
  }

  if (proof.roll !== null) {
    const [d1, d2] = proof.roll.challenge;
    lignes.push({
      libelle: 'Jet',
      valeur:
        `action ${String(proof.roll.action)} · total ${String(proof.roll.total)} ` +
        `contre ${String(d1)} et ${String(d2)} — ${proof.roll.outcome}`,
      eventSeq: proof.roll.eventSeq,
    });
    lignes.push({
      libelle: 'Tirage',
      valeur: `flux ${proof.roll.rngStream} · tirage n° ${String(proof.roll.rngDrawIndex)}`,
      eventSeq: proof.roll.eventSeq,
    });
  }

  if (proof.revision !== null) {
    lignes.push({
      libelle: 'Souffle brûlé',
      valeur: proof.revision.label,
      eventSeq: proof.revision.eventSeq,
    });
  }

  for (const effet of proof.effects) {
    lignes.push({ libelle: 'Effet', valeur: effet.label, eventSeq: effet.eventSeq });
  }

  if (proof.price !== null) {
    lignes.push({ libelle: 'Prix payé', valeur: proof.price.text, eventSeq: proof.price.eventSeq });
  }

  if (proof.presage !== null) {
    lignes.push({
      libelle: 'Présage',
      valeur: proof.presage.text,
      eventSeq: proof.presage.eventSeq,
    });
  }

  if (proof.narration !== null) {
    lignes.push({
      libelle: 'Narration',
      valeur: proof.narration.source === 'ai' ? 'écrite par le conteur' : 'repli du moteur',
      eventSeq: proof.narration.eventSeq,
    });
  }

  return lignes;
}
