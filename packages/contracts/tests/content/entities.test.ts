/**
 * Région, atout, condition, vérités, manifeste (§4.7).
 *
 * Un test par schéma, chacun mesuré dans les deux sens : la valeur de
 * référence passe, et une seule mutation la fait tomber.
 */
import { describe, expect, it } from 'vitest';

import { AssetSchema } from '../../src/content/asset.js';
import { ConditionSchema, ConditionsFileSchema } from '../../src/content/condition.js';
import { ManifestSchema } from '../../src/content/manifest.js';
import { RegionSchema } from '../../src/content/region.js';
import { TruthSchema, TruthsFileSchema } from '../../src/content/truth.js';

const region = (): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'avarosa-reach',
  name: 'La Portée d’Avarosa',
  parentId: 'freljord',
  kind: 'territoire',
  summary: 'Des plaines de glace où le vent ne tombe jamais.',
  description: 'Le vent y travaille la neige comme une lime.',
  dangerRank: 'dangereux',
  climate: 'Glacial, sec, sans pitié.',
  hooks: ['Une caravane n’est jamais arrivée.'],
});

const asset = (): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'companion-poro',
  name: 'Poro de compagnie',
  category: 'compagnon',
  text: 'Il suit, il mange, il réconforte.',
  abilities: [{ text: 'Il trouve de quoi manger.', xpCost: 1, effects: [] }],
});

const condition = (): Record<string, unknown> => ({
  id: 'transi',
  name: 'Transi',
  kind: 'physique',
  text: 'Le froid ne te quitte plus.',
  clearMoveHint: 'Trouve un feu et reste immobile.',
});

const truth = (): Record<string, unknown> => ({
  id: 'avarosa',
  question: 'Que reste-t-il d’Avarosa ?',
  options: [
    { id: 'un-tombeau', text: 'Un tombeau.', questHint: 'Le retrouver.' },
    { id: 'une-lignee', text: 'Une lignée.', questHint: 'La protéger.' },
  ],
});

const manifest = (): Record<string, unknown> => ({
  schemaVersion: 1,
  version: '0.1.0',
  rulesVersion: 1,
  expectedCounts: { moves: 11, champions: 3, regions: 4, oracles: 9, tables: 2, assets: 5 },
});

describe('RegionSchema', () => {
  it('accepte la région de référence et une racine sans parent', () => {
    expect(RegionSchema.safeParse(region()).success).toBe(true);
    expect(RegionSchema.safeParse({ ...region(), parentId: null }).success).toBe(true);
  });

  it('exige au moins une amorce', () => {
    expect(RegionSchema.safeParse({ ...region(), hooks: [] }).success).toBe(false);
  });

  it('refuse un genre hors liste et un rang hors liste', () => {
    expect(RegionSchema.safeParse({ ...region(), kind: 'continent' }).success).toBe(false);
    expect(RegionSchema.safeParse({ ...region(), dangerRank: 'mortel' }).success).toBe(false);
  });

  it('plafonne le résumé à 400 caractères', () => {
    expect(RegionSchema.safeParse({ ...region(), summary: 'a'.repeat(400) }).success).toBe(true);
    expect(RegionSchema.safeParse({ ...region(), summary: 'a'.repeat(401) }).success).toBe(false);
  });
});

describe('AssetSchema', () => {
  it('accepte l’atout de référence', () => {
    expect(AssetSchema.safeParse(asset()).success).toBe(true);
  });

  it('exige entre une et trois capacités', () => {
    expect(AssetSchema.safeParse({ ...asset(), abilities: [] }).success).toBe(false);
    const ability = { text: 'Une capacité.', xpCost: 1, effects: [] };
    expect(
      AssetSchema.safeParse({ ...asset(), abilities: [ability, ability, ability, ability] })
        .success,
    ).toBe(false);
  });

  it('refuse une piste à zéro case et en accepte une à cinq', () => {
    expect(AssetSchema.safeParse({ ...asset(), track: { label: 'Faim', max: 0 } }).success).toBe(
      false,
    );
    expect(AssetSchema.safeParse({ ...asset(), track: { label: 'Faim', max: 5 } }).success).toBe(
      true,
    );
  });

  it('refuse un `op` inconnu dans une capacité', () => {
    const abilities = [{ text: 'Une capacité.', effects: [{ op: 'set_gauge' }] }];
    expect(AssetSchema.safeParse({ ...asset(), abilities }).success).toBe(false);
  });
});

describe('ConditionSchema', () => {
  it('accepte la condition de référence et applique ses défauts', () => {
    const parsed = ConditionSchema.parse(condition());
    expect(parsed.blocksMomentumReset).toBe(false);
    expect(parsed.momentumMaxPenalty).toBe(1);
  });

  it('refuse un genre hors liste et une pénalité hors bornes', () => {
    expect(ConditionSchema.safeParse({ ...condition(), kind: 'magique' }).success).toBe(false);
    expect(ConditionSchema.safeParse({ ...condition(), momentumMaxPenalty: 5 }).success).toBe(
      false,
    );
  });

  it('exige au moins une condition dans le fichier', () => {
    expect(ConditionsFileSchema.safeParse({ schemaVersion: 1, conditions: [] }).success).toBe(
      false,
    );
    expect(
      ConditionsFileSchema.safeParse({ schemaVersion: 1, conditions: [condition()] }).success,
    ).toBe(true);
  });
});

describe('TruthSchema', () => {
  it('exige entre deux et cinq options', () => {
    expect(TruthSchema.safeParse(truth()).success).toBe(true);
    const options = truth()['options'] as unknown[];
    expect(TruthSchema.safeParse({ ...truth(), options: options.slice(0, 1) }).success).toBe(false);
  });

  it('plafonne les amorces d’entités à quatre et refuse un genre inventé', () => {
    const seed = { kind: 'npc', name: 'Un vieux', summary: 'Il sait.' };
    const withSeeds = (seeds: unknown[]): Record<string, unknown> => ({
      ...truth(),
      options: [
        { id: 'un-tombeau', text: 'Un tombeau.', questHint: 'Le retrouver.', entitySeeds: seeds },
        { id: 'une-lignee', text: 'Une lignée.', questHint: 'La protéger.' },
      ],
    });
    expect(TruthSchema.safeParse(withSeeds([seed, seed, seed, seed])).success).toBe(true);
    expect(TruthSchema.safeParse(withSeeds([seed, seed, seed, seed, seed])).success).toBe(false);
    expect(TruthSchema.safeParse(withSeeds([{ ...seed, kind: 'bete' }])).success).toBe(false);
  });

  it('exige au moins une vérité dans le fichier', () => {
    expect(TruthsFileSchema.safeParse({ schemaVersion: 1, truths: [] }).success).toBe(false);
    expect(TruthsFileSchema.safeParse({ schemaVersion: 1, truths: [truth()] }).success).toBe(true);
  });
});

describe('ManifestSchema', () => {
  it('accepte le manifeste de référence', () => {
    expect(ManifestSchema.safeParse(manifest()).success).toBe(true);
  });

  it.each(['0.1', 'v0.1.0', '0.1.0-rc1', ''])('refuse la version « %s »', (version) => {
    expect(ManifestSchema.safeParse({ ...manifest(), version }).success).toBe(false);
  });

  it('refuse un compte nul : un inventaire à zéro ne prouve rien', () => {
    const counts = manifest()['expectedCounts'] as Record<string, number>;
    expect(
      ManifestSchema.safeParse({ ...manifest(), expectedCounts: { ...counts, champions: 0 } })
        .success,
    ).toBe(false);
  });

  it('porte le seuil de fiches dans le contenu, jamais en dur', () => {
    // P1 : 3 en M0, 20 en V1, sans toucher au code.
    const counts = manifest()['expectedCounts'] as Record<string, number>;
    expect(
      ManifestSchema.parse({ ...manifest(), expectedCounts: { ...counts, champions: 20 } })
        .expectedCounts.champions,
    ).toBe(20);
  });

  it('refuse un `generatedAt` qui n’est pas une date ISO', () => {
    expect(ManifestSchema.safeParse({ ...manifest(), generatedAt: '2026-09-24' }).success).toBe(
      false,
    );
    expect(
      ManifestSchema.safeParse({ ...manifest(), generatedAt: '2026-09-24T10:00:00Z' }).success,
    ).toBe(true);
  });
});
