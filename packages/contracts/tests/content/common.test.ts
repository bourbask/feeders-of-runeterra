/**
 * Shared primitives of section 4.2, and the two names that live in `core/`.
 *
 * Every rule is measured in BOTH DIRECTIONS. A schema that refuses everything
 * would pass a one-sided test of "it refuses X" without refusing X for the
 * stated reason.
 */
import { describe, expect, it } from 'vitest';

import {
  FrTextSchema,
  RANK_TICKS,
  RankSchema,
  RefSchema,
  SlugSchema,
  TagsSchema,
} from '../../src/content/common.js';
import { AttributeSpreadSchema } from '../../src/core/attributes.js';

describe('SlugSchema', () => {
  it.each(['braum', 'griffe-de-givre', 'pay-the-price', 'a1-b2'])('accepte « %s »', (slug) => {
    expect(SlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each(['Braum', 'griffe_de_givre', '-braum', 'braum-', 'griffe--de', 'gel é', ''])(
    'refuse « %s »',
    (slug) => {
      expect(SlugSchema.safeParse(slug).success).toBe(false);
    },
  );
});

describe('FrTextSchema', () => {
  it('rogne les bords et refuse le vide', () => {
    expect(FrTextSchema.parse('  Le gel.  ')).toBe('Le gel.');
    expect(FrTextSchema.safeParse('   ').success).toBe(false);
    expect(FrTextSchema.safeParse('').success).toBe(false);
  });
});

describe('TagsSchema', () => {
  it('vaut [] par défaut et plafonne à 12', () => {
    expect(TagsSchema.parse(undefined)).toStrictEqual([]);
    expect(TagsSchema.safeParse(Array.from({ length: 12 }, () => 'froid')).success).toBe(true);
    expect(TagsSchema.safeParse(Array.from({ length: 13 }, () => 'froid')).success).toBe(false);
  });
});

describe('RefSchema', () => {
  it('porte le marqueur `ref:<kind>` que la passe 3 du chargeur cherche', () => {
    // Sans ce marqueur, la référence compile, passe la validation, et n'est
    // résolue par personne au démarrage (§4.8, passe 3).
    expect(RefSchema('region').description).toBe('ref:region');
    expect(RefSchema('oracle').description).toBe('ref:oracle');
  });

  it('reste un slug', () => {
    expect(RefSchema('region').safeParse('freljord').success).toBe(true);
    expect(RefSchema('region').safeParse('Freljord').success).toBe(false);
  });
});

describe('RANK_TICKS', () => {
  it('porte les cinq rangs et rien d’autre', () => {
    expect(Object.keys(RANK_TICKS).sort()).toStrictEqual([...RankSchema.options].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Critère d'acceptation : la répartition 3/2/2/1/1.
// Le schéma vit dans `core/attributes.ts` (M0-05) ; §4.2 le nomme
// `AttributeSpreadSchema`, et c'est ce nom que le contenu utilise.
describe('AttributeSpreadSchema — la répartition 3/2/2/1/1', () => {
  it('refuse [3,3,2,1,1]', () => {
    const refused = AttributeSpreadSchema.safeParse({
      vif: 3,
      coeur: 3,
      fer: 2,
      ombre: 1,
      esprit: 1,
    });
    expect(refused.success).toBe(false);
  });

  it.each([
    ['vif fort', { vif: 3, coeur: 2, fer: 2, ombre: 1, esprit: 1 }],
    ['esprit fort', { vif: 1, coeur: 1, fer: 2, ombre: 2, esprit: 3 }],
    ['ombre fort', { vif: 2, coeur: 1, fer: 1, ombre: 3, esprit: 2 }],
  ])('accepte [3,2,2,1,1] — %s', (_name, spread) => {
    expect(AttributeSpreadSchema.safeParse(spread).success).toBe(true);
  });

  it('refuse une somme légale mal répartie et une valeur hors bornes', () => {
    expect(
      AttributeSpreadSchema.safeParse({ vif: 2, coeur: 2, fer: 2, ombre: 2, esprit: 1 }).success,
    ).toBe(false);
    expect(
      AttributeSpreadSchema.safeParse({ vif: 4, coeur: 2, fer: 1, ombre: 1, esprit: 1 }).success,
    ).toBe(false);
  });
});
