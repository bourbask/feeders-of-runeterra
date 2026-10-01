import { describe, expect, it } from 'vitest';

import { CASES_DIR, loadCases } from '../cases.js';
import { proveFor } from '../context.js';
import { fixtureLoader } from '../fixtures.js';
import { loadRecorded } from '../recorded.js';
import {
  invertOutcome,
  refusalBlindness,
  type BlindnessEntry,
  type RefusalProver,
} from './refusal-blindness.js';

const fixtureOf = fixtureLoader();
const entriesOf = (ids?: readonly string[]): BlindnessEntry[] =>
  loadCases(CASES_DIR)
    .filter((one) => ids === undefined || ids.includes(one.id))
    .map((evalCase) => ({
      evalCase,
      fixture: fixtureOf(evalCase.fixture),
      recorded: loadRecorded(evalCase.id, CASES_DIR),
    }));

describe('l’inversion des issues', () => {
  it('échange franche et echec, et laisse le reste intact', () => {
    expect(invertOutcome('franche')).toBe('echec');
    expect(invertOutcome('echec')).toBe('franche');
    expect(invertOutcome('partielle')).toBe('partielle');
    expect(invertOutcome(null)).toBeNull();
  });
});

describe('refusal_is_outcome_blind', () => {
  it('passe sur le corpus livré, et la sonde n’est pas vide', () => {
    const verdict = refusalBlindness(entriesOf());
    expect(verdict.ok).toBe(true);
    expect(verdict.straight.length).toBeGreaterThan(0);
    expect(verdict.straight).toEqual(verdict.inverted);
  });

  it('un corpus sans aucun refus retenu est un échec, pas un succès', () => {
    // Deux ensembles vides sont égaux : sans ce garde-fou, la sonde serait verte sur rien.
    const verdict = refusalBlindness(entriesOf(['01-issue-franche', '08-bloc-absent']));
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/deux ensembles vides/u);
  });

  it('rougit dès qu’une preuve lit l’issue — et nomme les cas qui ont divergé', () => {
    /**
     * The double has `proveFor`'s FIVE parameters, so the outcome it reads is
     * the one the real function is handed. Declared with four it would
     * compile, and the thing under test would vanish.
     */
    const readsTheDice: RefusalProver = (evalCase, fixture, refusal, declaredCount, outcome) =>
      outcome === 'echec'
        ? proveFor(evalCase, fixture, refusal, declaredCount, outcome)
        : { rejected: 'refusal_unproven' };
    const verdict = refusalBlindness(entriesOf(), readsTheDice);
    expect(verdict.ok).toBe(false);
    expect(verdict.diverged.length).toBeGreaterThan(0);
    expect(verdict.detail).toMatch(/09-refus-cible-absente/u);
  });

  it('le cas qui tient la sonde porte bien une issue que l’inversion déplace', () => {
    // Sinon la preuve lirait l'issue sans que rien ne bouge : la sonde serait creuse.
    const upheld = entriesOf(['09-refus-cible-absente'])[0];
    expect(upheld).toBeDefined();
    expect(upheld?.evalCase.turn.fact.outcome).toBe('echec');
    expect(invertOutcome(upheld?.evalCase.turn.fact.outcome ?? null)).toBe('franche');
  });
});
