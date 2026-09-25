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

import {
  BRIEF_PERCEIVABLE_FACTS_MAX,
  NARRATION_PROSE_MAX,
  zBriefPerceivableFact,
  zNarrationBrief,
  zNarrationOutput,
} from '../../src/ai/narration.js';

const ULID = '01J8Z9QKT4E6WQKQ2H2GJ2Q3ZA';
const CORRELATION = '6b1f2a7e-3c4d-4f5a-9b8c-7d6e5f4a3b2c';

const aFact = (id: string, kind: 'present' | 'absent') => ({
  kind,
  ref: { kind: 'character' as const, id },
  name: 'Katla',
  detail: kind === 'present' ? 'assise pres du feu mort' : 'parti',
  sinceSeq: 1479,
});

const brief = {
  correlationId: CORRELATION,
  sceneId: ULID,
  audience: { scope: 'table', recipients: null },
  perceivableFacts: [aFact('ref-a', 'present'), aFact('ref-b', 'absent')],
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

describe('zNarrationBrief : le brief est adresse (ADR 0008)', () => {
  const player = '01J8Z9QKT4E6WQKQ2H2GJ2Q3ZB';

  it('refuse un brief sans destinataire ni faits perceptibles', () => {
    // Les deux champs ne sont pas optionnels : un brief qui ne dit pas pour qui
    // il ecrit est exactement ce que la decision 3 interdit.
    const sans = (key: string): Record<string, unknown> =>
      Object.fromEntries(Object.entries(brief).filter(([name]) => name !== key));
    expect(zNarrationBrief.safeParse(sans('audience')).success).toBe(false);
    expect(zNarrationBrief.safeParse(sans('perceivableFacts')).success).toBe(false);
    // La soustraction mord : le meme objet, intact, passe.
    expect(zNarrationBrief.safeParse(sans('rien-de-ce-nom')).success).toBe(true);
  });

  it('LES DEUX SENS : recipients null exactement a la portee table', () => {
    expect(
      zNarrationBrief.safeParse({ ...brief, audience: { scope: 'subset', recipients: [player] } })
        .success,
    ).toBe(true);
    expect(
      zNarrationBrief.safeParse({ ...brief, audience: { scope: 'table', recipients: [player] } })
        .success,
    ).toBe(false);
    expect(
      zNarrationBrief.safeParse({ ...brief, audience: { scope: 'subset', recipients: null } })
        .success,
    ).toBe(false);
  });

  it('refuse une portee hors du tuple du moteur', () => {
    expect(
      zNarrationBrief.safeParse({ ...brief, audience: { scope: 'groupe', recipients: [player] } })
        .success,
    ).toBe(false);
  });

  it('refuse un genre de fait hors des deux listes de SceneState', () => {
    expect(zBriefPerceivableFact.safeParse(aFact('ref-a', 'present')).success).toBe(true);
    expect(
      zBriefPerceivableFact.safeParse({ ...aFact('ref-a', 'present'), kind: 'entendu' }).success,
    ).toBe(false);
  });

  it('BORNE : seize faits passent, dix-sept sont refuses', () => {
    // Seize, c'est huit presents plus huit partis : le critere d'acceptation
    // n° 3 de M0-05, ecrit en toutes lettres. `BRIEF_PERCEIVABLE_FACTS_MAX` est
    // compare au moteur dans exhaustive-union.test.ts, pas a lui-meme ici.
    expect(BRIEF_PERCEIVABLE_FACTS_MAX).toBe(16);
    const facts = (count: number) =>
      Array.from({ length: count }, (_unused, index) =>
        aFact(`ref-${String(index)}`, index % 2 === 0 ? 'present' : 'absent'),
      );
    expect(zNarrationBrief.safeParse({ ...brief, perceivableFacts: facts(16) }).success).toBe(true);
    expect(zNarrationBrief.safeParse({ ...brief, perceivableFacts: facts(17) }).success).toBe(
      false,
    );
  });

  it('AUCUN CHIFFRE DE JEU : cinq champs, et le miroir n’en laisse pas entrer un sixieme', () => {
    expect(Object.keys(zBriefPerceivableFact.shape).sort()).toStrictEqual([
      'detail',
      'kind',
      'name',
      'ref',
      'sinceSeq',
    ]);
    const FORBIDDEN = ['gauge', 'vigueur', 'momentum', 'segments', 'rank', 'ticks', 'outcome'];
    // Epinglee avant d’etre parcourue : une liste qui est sa propre source de
    // boucle ne prouve rien.
    expect(FORBIDDEN).toHaveLength(7);
    for (const name of FORBIDDEN) {
      expect(Object.keys(zBriefPerceivableFact.shape)).not.toContain(name);
    }
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
