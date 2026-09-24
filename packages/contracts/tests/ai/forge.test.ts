/**
 * `ForgeOutputSchema` — a DERIVATION of `ChampionSchema`, compared by key
 * SETS and never by a list typed here.
 *
 * A written list would be the defect it is meant to catch: add a field to the
 * champion sheet, forget to add it to the forge list, and the forge silently
 * stops filling it while every gate stays green. So the expected key set is
 * COMPUTED from `ChampionSchema.shape` minus `FORGE_OMITTED_FIELDS`.
 */
import { describe, expect, it } from 'vitest';

import { FORGE_OMITTED_FIELDS, ForgeOutputSchema } from '../../src/ai/forge.js';
import { ChampionSchema } from '../../src/content/champion.js';

const championKeys = Object.keys(ChampionSchema.shape);
const forgeKeys = Object.keys(ForgeOutputSchema.shape);

describe('ForgeOutputSchema', () => {
  it('omet exactement les six champs imposés par le serveur', () => {
    const missing = championKeys.filter((key) => !forgeKeys.includes(key));
    expect(missing.sort()).toStrictEqual([...FORGE_OMITTED_FIELDS].sort());
  });

  it('conserve TOUS les autres champs de ChampionSchema', () => {
    const expected = championKeys.filter(
      (key) => !(FORGE_OMITTED_FIELDS as readonly string[]).includes(key),
    );
    expect([...forgeKeys].sort()).toStrictEqual([...expected].sort());
  });

  it('n’invente aucun champ que ChampionSchema n’a pas', () => {
    expect(forgeKeys.filter((key) => !championKeys.includes(key))).toStrictEqual([]);
  });

  it('aliases est omis délibérément : un modèle ne choisit pas ses propres surnoms', () => {
    // Tout le verrouillage de distribution en dépend (no_reserved_champion,
    // check_name_allowed) : les alias viennent de content/champions-index.json.
    expect(forgeKeys).not.toContain('aliases');
    expect(championKeys).toContain('aliases');
  });

  it('ChampionSchema.omit() LÈVE : c’est pourquoi la dérivation passe par la forme', () => {
    // Mesuré, pas supposé. Zod 4 refuse `.omit()` sur un objet portant un
    // refinement, et `ChampionSchema` se termine par un `.superRefine()`. Si
    // une version future l'autorise, ce test rougit et la dérivation peut
    // redevenir littérale — ce qui est exactement l'information qu'on veut.
    expect(() => ChampionSchema.omit({ id: true })).toThrow(/refinement/i);
  });

  it('un objet forgé plausible passe le schéma', () => {
    const forged = {
      name: 'Hrafn',
      title: 'la Corneille des cols',
      origin: { regionId: 'freljord', homeText: 'Les cols de l’Est' },
      pitch: 'Un éclaireur qui lit le vent mieux que les hommes.',
      description: 'Né dans un clan de chasseurs, il a appris à marcher sans bruit.',
      attributes: { vif: 3, coeur: 2, fer: 2, ombre: 1, esprit: 1 },
      startingAssets: ['skis-de-frene'],
      signatureAsset: { id: 'arc-court', name: 'Arc court', text: 'Un arc usé.' },
      startingVow: {
        title: 'Retrouver ma sœur',
        rank: 'dangereux',
        description: 'Retrouver Ylva, partie vers le nord.',
      },
      voice: { register: 'sec', sampleLines: ['Le vent ment rarement.'] },
      loreHooks: ['Il connaît un col que personne n’emprunte.'],
    };
    const parsed = ForgeOutputSchema.safeParse(forged);
    expect(parsed.error?.issues ?? []).toStrictEqual([]);
    expect(parsed.success).toBe(true);
  });
});
