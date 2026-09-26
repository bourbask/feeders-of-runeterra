/**
 * Ce qui rend une réponse recevable (décision 1 de l'ADR 0012).
 *
 * Le `3` des trois tentatives n'est PAS lu depuis `ATTEMPTS_BEFORE_DEFAULT` :
 * il vient du critère d'acceptation, donc il s'écrit en toutes lettres — un
 * chiffre comparé à lui-même passe toujours (ADR 0007). Le garde-fou est dans
 * `build.test.ts`, qui compte les questions posées.
 */

import { describe, expect, it } from 'vitest';

import type { ScenarioCandidate } from './types.js';
import { defaultCandidate, NO_REASON_GIVEN, verifyChoice } from './validate.js';

const CANDIDATES: readonly ScenarioCandidate[] = [
  { id: 'la-gardienne-du-grain', label: 'La gardienne du grain', detail: 'veut le grenier' },
  { id: 'le-scribe-sans-nom', label: 'Le scribe sans nom', detail: 'sait lire' },
];

describe('verifyChoice', () => {
  it('accepte un identifiant de la liste, et rend celui du contenu', () => {
    const verdict = verifyChoice({ choiceId: 'le-scribe-sans-nom', why: 'il écrit.' }, CANDIDATES);
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) throw new Error('inatteignable');
    expect(verdict.chosenId).toBe('le-scribe-sans-nom');
    expect(verdict.why).toBe('il écrit.');
  });

  it('détoure les blancs autour de l’identifiant', () => {
    const verdict = verifyChoice({ choiceId: '  le-scribe-sans-nom \n', why: ' x ' }, CANDIDATES);
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) throw new Error('inatteignable');
    expect(verdict.chosenId).toBe('le-scribe-sans-nom');
    expect(verdict.why).toBe('x');
  });

  it('refuse un identifiant inventé, et le nomme', () => {
    const verdict = verifyChoice(
      { choiceId: 'figure-qui-nexiste-pas', why: 'parce que.' },
      CANDIDATES,
    );
    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) throw new Error('inatteignable');
    expect(verdict.reason).toContain('figure-qui-nexiste-pas');
    expect(verdict.reason).toContain('2 candidat(s)');
  });

  it('refuse une réponse vide', () => {
    const verdict = verifyChoice({ choiceId: '   ', why: 'rien' }, CANDIDATES);
    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) throw new Error('inatteignable');
    expect(verdict.reason).toContain('réponse vide');
  });

  it('n’a JAMAIS de repêchage : le plus proche voisin n’est pas accepté', () => {
    // `la-gardienne-du-grai` est à une lettre du vrai. Une correction
    // silencieuse serait une pièce choisie par le code, pas par le modèle.
    const verdict = verifyChoice({ choiceId: 'la-gardienne-du-grai', why: '' }, CANDIDATES);
    expect(verdict.accepted).toBe(false);
  });

  it('accepte une justification vide sans dépenser une tentative', () => {
    const verdict = verifyChoice({ choiceId: 'le-scribe-sans-nom', why: '   ' }, CANDIDATES);
    expect(verdict.accepted).toBe(true);
    expect(verdict.why).toBe(NO_REASON_GIVEN);
  });
});

describe('defaultCandidate', () => {
  it('rend le premier candidat — celui du mélange, donc fonction de la graine', () => {
    expect(defaultCandidate(CANDIDATES)?.id).toBe('la-gardienne-du-grain');
  });

  it('rend undefined quand il n’y a aucun candidat : le défaut n’existe pas', () => {
    expect(defaultCandidate([])).toBeUndefined();
  });
});
