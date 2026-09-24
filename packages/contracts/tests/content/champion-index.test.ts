/**
 * Critère d'acceptation : `ChampionIndexSchema` refuse deux champions qui
 * partageraient un alias APRÈS NORMALISATION.
 *
 * Un alias ambigu rend le verrouillage de distribution indécidable : la
 * question « ce nom est-il réservé ? » a deux réponses, et le post-filtre en
 * prend une au hasard.
 */
import { describe, expect, it } from 'vitest';

import {
  ChampionIndexEntrySchema,
  ChampionIndexSchema,
  normalizeAlias,
} from '../../src/content/champion-index.js';

const entry = (id: string, displayName: string, aliases: string[]): Record<string, unknown> => ({
  id,
  displayName,
  canonicalRegionId: 'freljord',
  aliases,
});

const index = (...champions: Record<string, unknown>[]): Record<string, unknown> => ({
  schemaVersion: 1,
  champions,
});

describe('normalizeAlias', () => {
  it('efface diacritiques, casse et bords', () => {
    expect(normalizeAlias('  Bràum ')).toBe('braum');
    expect(normalizeAlias('LE CŒUR')).toBe('le cœur');
    expect(normalizeAlias('Sejuâni')).toBe('sejuani');
  });
});

describe('ChampionIndexSchema', () => {
  it('accepte deux champions aux noms distincts', () => {
    const value = index(
      entry('braum', 'Braum', ['Le Cœur du Freljord']),
      entry('ashe', 'Ashe', ['La Archère de Glace']),
    );
    expect(ChampionIndexSchema.safeParse(value).success).toBe(true);
  });

  it('refuse deux champions qui partagent un alias à l’identique', () => {
    const value = index(
      entry('braum', 'Braum', ['Le Cœur du Freljord']),
      entry('ashe', 'Ashe', ['Le Cœur du Freljord']),
    );
    expect(ChampionIndexSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ['la casse', 'le cœur du freljord'],
    ['un accent', 'Le Cœur du Fréljord'],
    ['des espaces de bord', '  Le Cœur du Freljord  '],
  ])('refuse un alias qui ne diffère que par %s', (_name, alias) => {
    const value = index(
      entry('braum', 'Braum', ['Le Cœur du Freljord']),
      entry('ashe', 'Ashe', [alias]),
    );
    expect(ChampionIndexSchema.safeParse(value).success).toBe(false);
  });

  it('nomme l’alias fautif dans le message', () => {
    const value = index(
      entry('braum', 'Braum', ['Le Cœur du Freljord']),
      entry('ashe', 'Ashe', ['le cœur du freljord']),
    );
    const messages = ChampionIndexSchema.safeParse(value).error?.issues.map(
      (issue) => issue.message,
    );
    expect(messages).toContain('alias ambigu « le cœur du freljord » : partagé par deux champions');
  });

  it('compare AUSSI le nom d’affichage, pas seulement les alias', () => {
    // Un `displayName` collé à l'alias d'un autre est le même trou : c'est ce
    // nom-là que l'écran de choix affiche et que le post-filtre cherche.
    const value = index(
      entry('braum', 'Braum', ['Le Cœur']),
      entry('ashe', 'Le Cœur', ['La Archère']),
    );
    expect(ChampionIndexSchema.safeParse(value).success).toBe(false);
  });

  it('refuse un champion en double dans sa propre liste d’alias', () => {
    const value = index(entry('braum', 'Braum', ['Braum']));
    expect(ChampionIndexSchema.safeParse(value).success).toBe(false);
  });

  it('exige au moins un champion et au moins un alias', () => {
    expect(ChampionIndexSchema.safeParse(index()).success).toBe(false);
    expect(ChampionIndexSchema.safeParse(index(entry('braum', 'Braum', []))).success).toBe(false);
  });
});

describe('ChampionIndexEntrySchema', () => {
  it('accepte un champion hors de Runeterra connu (`canonicalRegionId` nul)', () => {
    const value = { ...entry('bard', 'Bard', ['Le Gardien']), canonicalRegionId: null };
    expect(ChampionIndexEntrySchema.safeParse(value).success).toBe(true);
  });

  it('rend `playable` vrai par défaut', () => {
    expect(ChampionIndexEntrySchema.parse(entry('braum', 'Braum', ['Le Cœur'])).playable).toBe(
      true,
    );
  });

  it('refuse une région qui n’est pas un slug', () => {
    const value = { ...entry('braum', 'Braum', ['Le Cœur']), canonicalRegionId: 'Freljord' };
    expect(ChampionIndexEntrySchema.safeParse(value).success).toBe(false);
  });
});
