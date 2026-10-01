/**
 * Le corpus de test lui-même : il charge, et il a la taille annoncée.
 *
 * Sans ce fichier, un corpus qui se serait vidé en silence laisserait toutes
 * les autres mesures vertes sur trois pièces. Les comptes sont écrits EN
 * TOUTES LETTRES parce qu'ils viennent de la fiche S-03, pas du corpus.
 */

import { describe, expect, it } from 'vitest';

import { corpusRegistry, MODERN } from './corpus.js';

describe('le corpus de S-04 a la taille que S-03 promet', () => {
  const registry = corpusRegistry();

  it('six périodes, six fronts, vingt nœuds modernes, douze figures, dix ressorts, quinze rencontres', () => {
    expect(registry.listPeriods()).toHaveLength(6);
    expect(registry.listFronts()).toHaveLength(6);
    expect(registry.listNodes().filter((node) => node.periodId === MODERN)).toHaveLength(20);
    expect(registry.listFigures()).toHaveLength(12);
    expect(registry.listHooks()).toHaveLength(10);
    expect(registry.listEncounters()).toHaveLength(15);
  });

  it('trois fronts modernes, et leurs trois enjeux sont distincts', () => {
    const modern = registry.listFronts().filter((front) => front.periodId === MODERN);
    expect(modern).toHaveLength(3);
    expect(new Set(modern.map((front) => front.stake)).size).toBe(3);
  });

  it('chaque nœud porte trois destinations distinctes, aucune vers lui-même', () => {
    for (const node of registry.listNodes()) {
      const destinations = new Set(node.leads.map((lead) => lead.toNodeId));
      expect(destinations.size).toBeGreaterThanOrEqual(3);
      expect(destinations.has(node.id)).toBe(false);
    }
  });
});
