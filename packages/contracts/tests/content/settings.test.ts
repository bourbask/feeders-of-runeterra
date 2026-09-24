/**
 * Critère d'acceptation : une clé inconnue dans `CampaignSettings` lève.
 *
 * MESURÉ DANS LES DEUX SENS, parce qu'un réglage qui prétend interdire doit
 * échouer AVEC la violation et passer SANS elle : le même objet, moins la clé
 * parasite, est accepté. Un `.strict()` mesuré d'un seul côté pourrait très
 * bien ne rien refuser du tout.
 */
import { describe, expect, it } from 'vitest';

import { CampaignSettingsSchema } from '../../src/content/settings.js';

const validSettings = (): Record<string, unknown> => ({
  schemaVersion: 1,
  models: { narration: null, structured: null },
  gmVerbosity: 'standard',
  oracleBias: 'neutre',
  safety: { lines: [], veils: [] },
  allowForgedChampions: true,
  requireForgeReview: true,
});

describe('CampaignSettingsSchema — `.strict()`', () => {
  it('accepte le réglage de référence', () => {
    expect(CampaignSettingsSchema.safeParse(validSettings()).success).toBe(true);
  });

  it('LÈVE sur une clé inconnue, et passe sur le même objet sans elle', () => {
    const parasite = { ...validSettings(), gmVerbosite: 'ample' };
    expect(() => CampaignSettingsSchema.parse(parasite)).toThrow();
    expect(() => CampaignSettingsSchema.parse(validSettings())).not.toThrow();
  });

  it.each([
    ['une faute de frappe', 'gmVerbosite'],
    ['un réglage supprimé', 'aiEnabled'],
    ['un identifiant de fournisseur', 'anthropicApiKey'],
  ])('refuse %s', (_name, key) => {
    expect(CampaignSettingsSchema.safeParse({ ...validSettings(), [key]: 'x' }).success).toBe(
      false,
    );
  });

  it('est strict AUSSI dans les objets imbriqués', () => {
    const settings = validSettings();
    expect(
      CampaignSettingsSchema.safeParse({
        ...settings,
        models: { narration: null, structured: null, forge: null },
      }).success,
    ).toBe(false);
    expect(
      CampaignSettingsSchema.safeParse({
        ...settings,
        safety: { lines: [], veils: [], voiles: [] },
      }).success,
    ).toBe(false);
  });

  it.each([
    ['gmVerbosity', 'bavard'],
    ['oracleBias', 'gentil'],
  ])('refuse une valeur hors liste pour %s', (key, value) => {
    expect(CampaignSettingsSchema.safeParse({ ...validSettings(), [key]: value }).success).toBe(
      false,
    );
  });

  it('refuse une clé manquante : un réglage stocké est complet', () => {
    const settings = validSettings();
    delete settings['gmVerbosity'];
    expect(CampaignSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it('accepte une surcharge de modèle, qui est une donnée d’adaptateur', () => {
    expect(
      CampaignSettingsSchema.safeParse({
        ...validSettings(),
        models: { narration: 'un-modele-local', structured: null },
      }).success,
    ).toBe(true);
  });
});
