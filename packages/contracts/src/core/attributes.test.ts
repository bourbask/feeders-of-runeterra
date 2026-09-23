import { describe, expect, it } from 'vitest';

import { AttributeSpreadSchema, zAttributeMap, zAttributeSpread } from './attributes.js';

const spread = (vif: number, coeur: number, fer: number, ombre: number, esprit: number) => ({
  vif,
  coeur,
  fer,
  ombre,
  esprit,
});

describe('zAttributeSpread — 3/2/2/1/1, et rien d’autre', () => {
  it.each([
    ['3,2,2,1,1 dans l’ordre', spread(3, 2, 2, 1, 1)],
    ['le 3 sur esprit', spread(1, 1, 2, 2, 3)],
    ['le 3 sur fer', spread(2, 1, 3, 1, 2)],
  ])('accepte %s', (_label, value) => {
    expect(zAttributeSpread.safeParse(value).success).toBe(true);
  });

  it.each([
    ['3,3,2,1,1', spread(3, 3, 2, 1, 1)],
    ['2,2,2,2,2', spread(2, 2, 2, 2, 2)],
    ['3,2,2,2,1', spread(3, 2, 2, 2, 1)],
    ['une valeur hors bornes', spread(4, 2, 2, 1, 1)],
    ['un zéro', spread(3, 2, 2, 1, 0)],
  ])('refuse %s', (_label, value) => {
    expect(zAttributeSpread.safeParse(value).success).toBe(false);
  });

  it('refuse une répartition à laquelle il manque un attribut', () => {
    expect(zAttributeSpread.safeParse({ vif: 3, coeur: 2, fer: 2, ombre: 1 }).success).toBe(false);
  });

  it('dit dans son message ce qu’elle attendait', () => {
    const result = zAttributeSpread.safeParse(spread(3, 3, 2, 1, 1));
    expect(JSON.stringify(result.error?.issues)).toContain('3,2,2,1,1');
  });

  it('AttributeSpreadSchema est le même schéma', () => {
    expect(AttributeSpreadSchema).toBe(zAttributeSpread);
  });
});

describe('zAttributeMap — une valeur par attribut', () => {
  it('accepte les cinq attributs', () => {
    expect(zAttributeMap.safeParse(spread(1, 1, 1, 1, 1)).success).toBe(true);
  });

  it('refuse un attribut manquant', () => {
    expect(zAttributeMap.safeParse({ vif: 1, coeur: 1, fer: 1, ombre: 1 }).success).toBe(false);
  });

  it('refuse un attribut inconnu', () => {
    expect(zAttributeMap.safeParse({ ...spread(1, 1, 1, 1, 1), force: 2 }).success).toBe(false);
  });
});
