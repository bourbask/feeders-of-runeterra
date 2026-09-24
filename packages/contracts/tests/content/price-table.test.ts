/**
 * Critère d'acceptation : `PriceTableSchema` refuse une entrée SANS
 * `keywords`, et une entrée dont un `keywords` contient un chiffre (§4.6).
 *
 * Pourquoi ce champ est obligatoire : l'assertion DURE `price_respected` —
 * qui est aussi un post-filtre de PRODUCTION — n'a aucune autre source contre
 * laquelle vérifier que le prix imposé a bien été mis en scène. Sans la liste,
 * l'assertion ne note rien et le conteur peut remplacer le prix tiré par autre
 * chose sans que rien ne bronche.
 */
import { describe, expect, it } from 'vitest';

import { PriceTableSchema } from '../../src/content/price-table.js';

/** Un d12 sans trou : une entrée par face. */
const priceEntries = (): Record<string, unknown>[] =>
  Array.from({ length: 12 }, (_unused, index) => ({
    id: `prix-${String(index + 1)}`,
    min: index + 1,
    max: index + 1,
    text: 'Le froid prélève sa part.',
    severity: 'legere',
    suggestedEffects: [],
    keywords: ['gel'],
  }));

const validPriceTable = (): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'pay-the-price',
  kind: 'price',
  die: 12,
  entries: priceEntries(),
  tags: [],
});

/** Le même objet moins une clé, sans `delete` : `no-dynamic-delete` est une erreur ici. */
const omitKey = (value: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

/** La table de référence, avec une seule entrée modifiée. */
const withEntry = (index: number, patch: Record<string, unknown>): Record<string, unknown> => {
  const entries = priceEntries();
  entries[index] = { ...entries[index], ...patch };
  return { ...validPriceTable(), entries };
};

/** La table de référence, avec une clé retirée d'une seule entrée. */
const withoutKey = (index: number, key: string): Record<string, unknown> => {
  const entries = priceEntries();
  entries[index] = omitKey(entries[index]!, key);
  return { ...validPriceTable(), entries };
};

describe('PriceTableSchema', () => {
  it('accepte la table de référence : douze entrées, d12 couvert', () => {
    const parsed = PriceTableSchema.safeParse(validPriceTable());
    expect(parsed.error?.issues ?? []).toStrictEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('refuse une entrée sans `keywords`', () => {
    expect(PriceTableSchema.safeParse(withoutKey(6, 'keywords')).success).toBe(false);
  });

  it('refuse une liste `keywords` vide', () => {
    expect(PriceTableSchema.safeParse(withEntry(6, { keywords: [] })).success).toBe(false);
  });

  it.each([
    ['un chiffre isolé', ['2 vivres']],
    ['un chiffre collé', ['gel-1']],
    ['un chiffre au milieu de la liste', ['gel', 'morsure3', 'nuit']],
  ])('refuse un mot-clé qui contient %s', (_name, keywords) => {
    expect(PriceTableSchema.safeParse(withEntry(6, { keywords })).success).toBe(false);
  });

  it.each([
    ['un mot', ['gel']],
    ['plusieurs mots', ['gel', 'morsure', 'nuit blanche']],
    ['six mots', ['a', 'b', 'c', 'd', 'e', 'f']],
  ])('accepte %s — la même table, seule la liste change', (_name, keywords) => {
    expect(PriceTableSchema.safeParse(withEntry(6, { keywords })).success).toBe(true);
  });

  it('plafonne à six mots-clés et à quarante caractères', () => {
    expect(
      PriceTableSchema.safeParse(withEntry(6, { keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }))
        .success,
    ).toBe(false);
    expect(PriceTableSchema.safeParse(withEntry(6, { keywords: ['g'.repeat(41)] })).success).toBe(
      false,
    );
    expect(PriceTableSchema.safeParse(withEntry(6, { keywords: ['g'.repeat(40)] })).success).toBe(
      true,
    );
  });

  it('exige exactement douze entrées', () => {
    const eleven = { ...validPriceTable(), entries: priceEntries().slice(0, 11) };
    expect(PriceTableSchema.safeParse(eleven).success).toBe(false);
  });

  it('refuse un trou dans le d12 : le message nomme la face manquante', () => {
    const shifted = priceEntries();
    shifted[8] = { ...shifted[8], min: 13, max: 13 };
    const issues = PriceTableSchema.safeParse({
      ...validPriceTable(),
      entries: shifted,
    }).error?.issues.map((issue) => issue.message);
    expect(issues).toContain('trou dans la table : 9..9 non couvert');
  });

  it('refuse une severity hors des trois valeurs', () => {
    expect(PriceTableSchema.safeParse(withEntry(0, { severity: 'mortelle' })).success).toBe(false);
    expect(PriceTableSchema.safeParse(withEntry(0, { severity: 'grave' })).success).toBe(true);
  });

  it('plafonne `suggestedEffects` à trois, et refuse un `op` inconnu', () => {
    const effect = { op: 'gauge', gauge: 'vivres', delta: -1, target: 'self' };
    expect(
      PriceTableSchema.safeParse(withEntry(0, { suggestedEffects: [effect, effect, effect] }))
        .success,
    ).toBe(true);
    expect(
      PriceTableSchema.safeParse(
        withEntry(0, { suggestedEffects: [effect, effect, effect, effect] }),
      ).success,
    ).toBe(false);
    expect(
      PriceTableSchema.safeParse(withEntry(0, { suggestedEffects: [{ op: 'set_gauge' }] })).success,
    ).toBe(false);
  });
});
