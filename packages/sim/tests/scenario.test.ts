/**
 * The loader refuses, rather than reading a scenario half-way.
 *
 * Every refusal below is a way a scenario file could have gone green while
 * measuring nothing: an intent the protocol does not declare, a symbol that
 * pads into an identifier the engine refuses, a step kind nobody implements,
 * a selector that matches no file.
 */

import { describe, expect, it } from 'vitest';

import {
  ScenarioUnreadable,
  expandUlid,
  loadScenarios,
  parseScenario,
  scenarioFileName,
  selectScenarios,
} from '../src/scenario.js';

const MINIMAL = {
  id: '99-essai',
  title: 'Essai',
  seed: 'essai',
  startedAt: '2026-01-01T00:00:00.000Z',
  players: [
    {
      symbol: 'PYRA',
      displayName: 'Alice',
      character: {
        symbol: 'CHRA',
        championId: 'ashe',
        displayName: 'Ashe',
        attributes: { vif: 1, coeur: 1, fer: 1, ombre: 1, esprit: 1 },
        gauges: { vigueur: 5, ame: 5, vivres: 5 },
        momentum: 2,
      },
    },
  ],
  entities: [],
  scene: null,
  steps: [] as unknown[],
};

function withSteps(steps: unknown[]): string {
  return JSON.stringify({ ...MINIMAL, steps });
}

describe('le chargeur de scénarios', () => {
  it('lit un scénario minimal', () => {
    const scenario = parseScenario(withSteps([]), 'essai.json');
    expect(scenario.id).toBe('99-essai');
    expect(scenario.players).toHaveLength(1);
    expect(scenario.steps).toEqual([]);
  });

  it('refuse une intention que `zIntent` ne déclare pas', () => {
    expect(() =>
      parseScenario(
        withSteps([{ kind: 'intent', player: 'PYRA', intent: { type: 'move.danser' } }]),
        'essai.json',
      ),
    ).toThrow(ScenarioUnreadable);
  });

  it('refuse un symbole hors de l’alphabet Crockford', () => {
    // `O` is not in Crockford base32: padded, it makes an identifier
    // `zPlayerId` refuses, three steps later and far from the file.
    expect(() =>
      parseScenario(withSteps([{ kind: 'reconnect', player: 'BOB' }]), 'essai.json'),
    ).toThrow(/Crockford/u);
  });

  it('refuse un genre d’étape inconnu, et une clé d’attente inconnue', () => {
    expect(() => parseScenario(withSteps([{ kind: 'danser' }]), 'essai.json')).toThrow(/inconnu/u);
    expect(() =>
      parseScenario(
        withSteps([{ kind: 'reconnect', player: 'PYRA', expect: { jauges: {} } }]),
        'essai.json',
      ),
    ).toThrow(/clés inconnues/u);
  });

  it('refuse du JSON invalide, et un champ manquant', () => {
    expect(() => parseScenario('{ pas du json', 'essai.json')).toThrow(ScenarioUnreadable);
    expect(() => parseScenario(JSON.stringify({ id: '99' }), 'essai.json')).toThrow(
      ScenarioUnreadable,
    );
  });

  it('refuse un sélecteur qui ne nomme aucun scénario', () => {
    const all = loadScenarios();
    expect(() => selectScenarios(all, 'zz')).toThrow(/aucun scénario/u);
    expect(selectScenarios(all, null)).toHaveLength(all.length);
    expect(selectScenarios(all, '04')).toHaveLength(1);
  });

  it('`expandUlid` rend un ULID, et le même pour le même symbole', () => {
    expect(expandUlid('PYRA')).toBe('0000000000000000000000PYRA');
    expect(expandUlid('PYRA')).toHaveLength(26);
    expect(expandUlid('PYRA')).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u);
  });

  it('les sept fichiers portent le suffixe attendu et se chargent tous', () => {
    const all = loadScenarios();
    expect(all).toHaveLength(7);
    for (const scenario of all) {
      expect(scenarioFileName(scenario)).toMatch(/\.scenario\.json$/u);
      expect(scenario.steps.length).toBeGreaterThan(0);
    }
  });
});
