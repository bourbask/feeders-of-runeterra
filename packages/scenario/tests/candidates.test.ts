/**
 * Le filtrage par période et le mélange sur le flux nommé.
 *
 * Les fixtures d'ordre portent QUATRE entrées dans un ordre NON NATUREL et les
 * assertions comparent le TABLEAU EXACT : une liste déjà triée, ou à un seul
 * élément, ne dit rien d'un critère qui parle d'ordre (mode 7 de la recette).
 */

import { describe, expect, it } from 'vitest';

import {
  encountersOfPeriod,
  figuresOfPeriod,
  frontsOfPeriod,
  hooksOfPeriod,
  isAbsentFaction,
  nodesOfPeriod,
  regionIdsOfPeriod,
  scenarioStreamSeed,
  shuffleFor,
} from '../src/candidates.js';

import {
  ANCIENT,
  AVAROSANS,
  CONTRADICTORY_FIGURE_ID,
  contradictoryFigureRegistry,
  corpusRegistry,
  LONG_NIGHT,
  MODERN,
  MODERN_REGIONS,
} from './corpus.js';

const registry = corpusRegistry();

describe('le mélange sur le flux nommé', () => {
  const DECK = ['delta', 'alpha', 'charlie', 'bravo'] as const;

  it('nomme son flux : graine|scenario|étape', () => {
    expect(scenarioStreamSeed('campagne-7', 'figure')).toBe('campagne-7|scenario|figure');
  });

  it('même graine, même étape : le même tableau exact', () => {
    const first = shuffleFor('campagne-7', 'figure', DECK);
    const second = shuffleFor('campagne-7', 'figure', DECK);
    expect([...first]).toEqual([...second]);
    expect([...first].sort()).toEqual([...DECK].sort());
  });

  it('deux étapes de la même campagne ne tombent pas sur le même ordre', () => {
    // Sans sous-flux par étape, toutes les questions d'une même campagne
    // partageraient le même mélange : le contenu paraîtrait trié.
    const ordres = new Set(
      ['periode', 'lieu', 'front', 'figure', 'noeud'].map((step) =>
        shuffleFor('campagne-7', step, DECK).join('|'),
      ),
    );
    expect(ordres.size).toBeGreaterThan(1);
  });

  it('deux graines donnent deux ordres', () => {
    const ordres = new Set(
      ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((seed) =>
        shuffleFor(seed, 'figure', DECK).join('|'),
      ),
    );
    expect(ordres.size).toBeGreaterThan(1);
  });

  it('mélanger zéro ou un élément ne casse rien', () => {
    expect(shuffleFor('g', 'e', [])).toEqual([]);
    expect(shuffleFor('g', 'e', ['seul'])).toEqual(['seul']);
  });
});

describe('tout se filtre par la période', () => {
  it('les fronts, les nœuds, les figures, les ressorts et les rencontres', () => {
    for (const front of frontsOfPeriod(registry, MODERN)) expect(front.periodId).toBe(MODERN);
    for (const node of nodesOfPeriod(registry, MODERN)) expect(node.periodId).toBe(MODERN);
    for (const hook of hooksOfPeriod(registry, registry.getPeriod(MODERN))) {
      expect(hook.periodId).toBe(MODERN);
    }
    for (const rencontre of encountersOfPeriod(registry, MODERN)) {
      expect(rencontre.periodId).toBe(MODERN);
    }
  });

  it('une période ancienne ne propose AUCUNE figure moderne', () => {
    const anciennes = figuresOfPeriod(registry, registry.getPeriod(ANCIENT));
    expect(anciennes.length).toBeGreaterThan(0);
    const modernes = new Set(
      registry
        .listFigures()
        .filter((figure) => figure.periodId === MODERN)
        .map((figure) => figure.id),
    );
    expect(modernes.size).toBeGreaterThan(0);
    for (const figure of anciennes) expect(modernes.has(figure.id)).toBe(false);
  });

  it('une faction déclarée absente écarte la figure qui la porte', () => {
    // `la-longue-nuit` déclare les Avarosans absents. Ce corpus-là porte
    // EXPRÈS une figure avarosane sur cette période : sans elle, la boucle
    // ci-dessous tournait à vide et retirer le filtre laissait tout vert.
    const contradictoire = contradictoryFigureRegistry();
    const periode = contradictoire.getPeriod(LONG_NIGHT);
    expect(isAbsentFaction(periode, AVAROSANS)).toBe(true);
    expect(isAbsentFaction(periode, null)).toBe(false);
    expect(contradictoire.getFigure(CONTRADICTORY_FIGURE_ID).periodId).toBe(LONG_NIGHT);
    const proposées = figuresOfPeriod(contradictoire, periode).map((figure) => figure.id);
    expect(proposées.length).toBeGreaterThan(0);
    expect(proposées).not.toContain(CONTRADICTORY_FIGURE_ID);
  });

  it('un ressort accroché à une faction absente est écarté, les autres restent', () => {
    const periode = registry.getPeriod(LONG_NIGHT);
    const gardes = hooksOfPeriod(registry, periode);
    expect(gardes.length).toBeGreaterThan(0);
    for (const hook of gardes) {
      if (hook.appliesTo.kind !== 'faction') continue;
      expect(isAbsentFaction(periode, hook.appliesTo.factionId)).toBe(false);
    }
  });

  it('les régions d’une période sont celles de ses fronts et de ses nœuds, triées', () => {
    expect(regionIdsOfPeriod(registry, MODERN)).toEqual([...MODERN_REGIONS].sort());
    expect(regionIdsOfPeriod(registry, ANCIENT)).toEqual(['freljord']);
  });
});
