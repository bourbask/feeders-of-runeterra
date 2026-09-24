import { describe, expect, it } from 'vitest';

import { aTurnProof } from '../../../test/frames.js';
import { proofLines } from './proof-lines.js';

const libelles = (proof: Parameters<typeof proofLines>[0]) =>
  proofLines(proof).map((ligne) => ligne.libelle);

describe('la preuve ne rend que ce que le serveur a envoyé', () => {
  it('une preuve complète donne mouvement, jet, tirage, effet et narration', () => {
    expect(libelles(aTurnProof())).toEqual(['Mouvement', 'Jet', 'Tirage', 'Effet', 'Narration']);
  });

  it('sans `roll`, la ligne « Jet » disparaît — elle n’est pas reconstruite', () => {
    const sansJet = aTurnProof({ roll: null });
    expect(libelles(sansJet)).not.toContain('Jet');
    expect(libelles(sansJet)).not.toContain('Tirage');
    expect(JSON.stringify(proofLines(sansJet))).not.toContain('118');
  });

  it.each([
    ['move', 'Mouvement'],
    ['revision', 'Souffle brûlé'],
    ['price', 'Prix payé'],
    ['presage', 'Présage'],
    ['narration', 'Narration'],
  ])('sans « %s », la ligne « %s » n’apparaît pas', (champ, libelle) => {
    const complet = aTurnProof({
      revision: { eventSeq: 414, label: 'Souffle brûlé : 6' },
      price: { eventSeq: 415, entryId: 'p-3', text: 'Un allié paie', value: 3, effectIndex: 0 },
      presage: { eventSeq: 416, entryId: 'o-1', text: 'Le vent tourne' },
    });
    expect(libelles(complet)).toContain(libelle);
    expect(libelles({ ...complet, [champ]: null })).not.toContain(libelle);
  });

  it('un tour sans rien du tout ne rend aucune ligne', () => {
    const vide = aTurnProof({ move: null, roll: null, effects: [], narration: null });
    expect(proofLines(vide)).toEqual([]);
  });

  it('chaque ligne porte le numéro de journal dont elle est issue', () => {
    for (const ligne of proofLines(aTurnProof())) {
      expect(ligne.eventSeq).toBeGreaterThan(0);
    }
  });

  it('la fonction ne prend que la charge utile : rien d’autre ne peut la remplir', () => {
    expect(proofLines).toHaveLength(1);
  });
});
