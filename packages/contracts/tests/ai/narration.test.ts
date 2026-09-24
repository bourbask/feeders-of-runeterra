/**
 * The two ends of a narration, and the asymmetry between them.
 *
 * The brief carries the settled fact — outcome, effects, price. The output
 * carries prose and names. This file asserts that asymmetry as a key-set
 * comparison rather than leaving it to a reviewer's eye, because the failure
 * mode is not a typo: it is somebody adding, in good faith, an output field
 * the engine would then read to decide something. That is what `pay_price`
 * did, and it cost ADR 0006.
 */
import { describe, expect, it } from 'vitest';

import { NARRATION_PROSE_MAX, zNarrationBrief, zNarrationOutput } from '../../src/ai/narration.js';

const ULID = '01J8Z9QKT4E6WQKQ2H2GJ2Q3ZA';
const CORRELATION = '6b1f2a7e-3c4d-4f5a-9b8c-7d6e5f4a3b2c';

const brief = {
  correlationId: CORRELATION,
  sceneId: ULID,
  actorCharacterId: ULID,
  moveId: 'strike',
  outcome: 'partielle',
  isPresage: false,
  roll: {
    rollId: ULID,
    attribute: 'fer',
    attributeValue: 3,
    actionDie: 4,
    adds: [{ source: 'atout', value: 1 }],
    rawTotal: 8,
    total: 8,
    cappedAtTen: false,
    challengeDice: [5, 9],
    momentumNegated: false,
    burned: false,
  },
  appliedEffects: [
    {
      effect: { op: 'gauge', gauge: 'vigueur', delta: -1, target: 'self' },
      subjectCharacterId: ULID,
      trackId: null,
      eventSeq: 1481,
    },
  ],
  imposedPrice: {
    rollId: ULID,
    tableId: 'pay-the-price',
    value: 7,
    entryId: 'ptp-07',
    text: 'Un allié paie à ta place.',
    severity: 'moyenne',
    effectIndex: 0,
  },
  presage: null,
  playerInput: 'Je frappe le premier.',
  eventSeqs: [1480, 1481],
  fallbackTemplateId: 'strike-partielle',
};

describe('zNarrationBrief', () => {
  it('parse un brief complet', () => {
    const parsed = zNarrationBrief.safeParse(brief);
    expect(parsed.error?.issues ?? []).toStrictEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('parse un brief de tour sans jet (une scène qui s’ouvre)', () => {
    const parsed = zNarrationBrief.safeParse({
      ...brief,
      moveId: null,
      outcome: null,
      roll: null,
      imposedPrice: null,
      appliedEffects: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuse un mouvement ou une issue hors des tuples du moteur', () => {
    expect(zNarrationBrief.safeParse({ ...brief, moveId: 'super-frappe' }).success).toBe(false);
    expect(zNarrationBrief.safeParse({ ...brief, outcome: 'critique' }).success).toBe(false);
  });

  it('le prix imposé ne porte ni mode ni option : le moteur a tiré (ADR 0006)', () => {
    const price = brief.imposedPrice;
    expect(
      zNarrationBrief.safeParse({ ...brief, imposedPrice: { ...price, mode: 'roll' } }).success,
    ).toBe(true);
    // Le schéma du prix ne DÉCLARE pas de mode : une clé en trop est ignorée
    // (le brief n'est pas strict, c'est un miroir du moteur), mais elle ne
    // ressort jamais du parse. C'est ça qu'on vérifie — rien de ce genre
    // n'atteint le consommateur.
    const parsed = zNarrationBrief.parse({
      ...brief,
      imposedPrice: { ...price, mode: 'gm_choice' },
    });
    expect(parsed.imposedPrice).not.toHaveProperty('mode');
  });
});

describe('zNarrationOutput', () => {
  it('parse une sortie ordinaire, bloc de scène absent', () => {
    const parsed = zNarrationOutput.safeParse({ prose: 'La corde tient.', sceneBlock: null });
    expect(parsed.success).toBe(true);
  });

  it('refuse une clé inconnue', () => {
    expect(
      zNarrationOutput.safeParse({ prose: 'x', sceneBlock: null, outcome: 'franche' }).success,
    ).toBe(false);
  });

  it('refuse une prose au-delà du plafond de sortie', () => {
    // Épinglé en toutes lettres, comme les plafonds de la chronique : borner
    // avec la constante qu'on vérifie laisse le test vert quand on la déplace.
    expect(NARRATION_PROSE_MAX).toBe(4000);
    expect(zNarrationOutput.safeParse({ prose: 'a'.repeat(4000), sceneBlock: null }).success).toBe(
      true,
    );
    expect(zNarrationOutput.safeParse({ prose: 'a'.repeat(4001), sceneBlock: null }).success).toBe(
      false,
    );
  });

  it('INVARIANT 1 : la sortie du modèle ne porte aucun champ de décision', () => {
    // Le brief en porte trois ; la sortie n'en porte aucun. C'est la même
    // frontière que `pay_price` avait ouverte par la bande : un champ de
    // sortie que le moteur convertit ensuite en conséquence.
    expect(Object.keys(zNarrationOutput.shape).sort()).toStrictEqual(['prose', 'sceneBlock']);
    for (const forbidden of [
      'outcome',
      'gauge',
      'effects',
      'effect',
      'damage',
      'momentum',
      'segments',
      'price',
      'roll',
      'optionId',
      'mode',
    ]) {
      expect(Object.keys(zNarrationOutput.shape)).not.toContain(forbidden);
    }
    for (const decided of ['outcome', 'appliedEffects', 'imposedPrice', 'roll']) {
      expect(Object.keys(zNarrationBrief.shape)).toContain(decided);
    }
  });
});
