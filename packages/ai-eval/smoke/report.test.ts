import { describe, expect, it } from 'vitest';

import { formatReport, frNumber, type SmokeSummary } from './report.js';

const base: SmokeSummary = {
  promptVersion: 'conteur/2.0.0',
  promptFingerprint: 'a1b2c3d4e5f6',
  promptEstimatedTokens: 2213,
  providerId: 'openai-compatible',
  model: 'un-modele-gratuit-v1',
  caseCount: 3,
  samplesPerCase: 2,
  callCount: 6,
  checkTotal: 7,
  fallen: [],
  estimatedInputTokens: 2900,
  measuredInputTokens: 3011,
};

describe('formatReport', () => {
  it('lit le total dans le sommaire, il ne l’écrit pas', () => {
    // Le sommaire annonce SIX règles chargées et une tombée : si le rapport
    // portait la constante 7, cette ligne dirait « 5 / 7 ».
    const rendu = formatReport({
      ...base,
      checkTotal: 6,
      fallen: [{ id: 'no_final_question', failedSamples: 2, detail: '« Que fais-tu ? »' }],
    });
    expect(rendu).toContain('assertions  : 5 / 6');
    expect(rendu).not.toContain('/ 7');
  });

  it('tient en moins de vingt lignes quand TOUTES les règles tombent', () => {
    // La borne « moins de vingt lignes » vient du critère d'acceptation de
    // M0-32 : elle s'écrit en toutes lettres ici, elle ne se relit pas du code.
    const toutesTombees = [
      'length_in_range',
      'second_person_singular',
      'no_outcome_decision',
      'no_locked_champion',
      'no_final_question',
      'scene_block_present',
      'scene_block_wellformed',
    ].map((id) => ({
      id,
      failedSamples: 6,
      detail: 'un extrait assez long pour occuper toute la largeur utile de la ligne du rapport…',
    }));
    const lignes = formatReport({ ...base, fallen: toutesTombees }).split('\n');
    expect(lignes.length).toBeLessThan(20);
    expect(lignes).toHaveLength(16);
  });

  it('porte le fournisseur, le modèle, les appels puis le compte, dans cet ordre', () => {
    const rendu = formatReport(base);
    const at = (aiguille: string): number => rendu.indexOf(aiguille);
    expect(at('fournisseur')).toBeGreaterThan(-1);
    expect(at('fournisseur')).toBeLessThan(at('modèle'));
    expect(at('modèle')).toBeLessThan(at('appels'));
    expect(at('appels')).toBeLessThan(at('assertions'));
    expect(at('assertions')).toBeLessThan(at('tombées'));
  });

  it('porte la version du prompt et le nom de modèle exact', () => {
    const rendu = formatReport(base);
    expect(rendu).toContain('conteur/2.0.0');
    expect(rendu).toContain('un-modele-gratuit-v1');
  });

  it('dit quand le fournisseur ne renvoie pas de nom de modèle', () => {
    expect(formatReport({ ...base, model: '' })).toContain('(non renvoyé par le fournisseur)');
  });

  it('dit quand le fournisseur ne compte pas les tokens d’entrée', () => {
    const rendu = formatReport({ ...base, measuredInputTokens: null });
    expect(rendu).toContain('non comptée par le fournisseur');
    expect(rendu).toContain('2 900 t estimés');
  });

  it('refuse de conclure sur le stub, qui n’est pas un modèle', () => {
    const rendu = formatReport({ ...base, providerId: 'stub', fallen: [] });
    expect(rendu).toContain('le stub n’est pas un modèle');
    expect(rendu).not.toContain('tient sur ce fournisseur');
  });

  it('conclut favorablement quand rien ne tombe sur un vrai fournisseur', () => {
    expect(formatReport(base)).toContain('le prompt contraint tient sur ce fournisseur.');
  });
});

describe('frNumber', () => {
  it('groupe les milliers par espace fine insécable', () => {
    expect([frNumber(7), frNumber(900), frNumber(2900), frNumber(14_000)]).toEqual([
      '7',
      '900',
      '2 900',
      '14 000',
    ]);
  });
});
