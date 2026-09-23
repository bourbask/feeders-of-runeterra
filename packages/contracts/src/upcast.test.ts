import { describe, expect, it } from 'vitest';

import { upcast, UPCASTERS, UpcastGapError, type UpcasterTable } from './upcast.js';
import { EVENT_SCHEMA_VERSION } from './version.js';

/**
 * Runs `call`, expects an `UpcastGapError`, hands it back. Written this way
 * because `expect` inside a `catch` is a conditional assertion: if the call
 * stopped throwing, a try/catch version would pass in silence.
 */
function captureUpcastGap(call: () => unknown): UpcastGapError {
  let thrown: unknown;
  try {
    call();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(UpcastGapError);
  return thrown as UpcastGapError;
}

const row = (over: Record<string, unknown> = {}) => ({
  type: 'roll.action_resolved',
  payloadVersion: EVENT_SCHEMA_VERSION,
  payload: { total: 10 },
  ...over,
});

describe('upcast — versionnement des payloads (03-donnees.md §3.8)', () => {
  it('laisse passer une ligne déjà à la version courante, sans aucune étape', () => {
    const result = upcast(row());
    expect(result.steps).toBe(0);
    expect(result.payloadVersion).toBe(EVENT_SCHEMA_VERSION);
    expect(result.payload).toStrictEqual({ total: 10 });
  });

  it('lève UpcastGapError quand la ligne vient d’une version plus récente', () => {
    expect(() => upcast(row({ payloadVersion: EVENT_SCHEMA_VERSION + 1 }))).toThrow(UpcastGapError);
  });

  it('le message de la faille nomme le type et les deux versions', () => {
    const thrown = captureUpcastGap(() => upcast(row({ payloadVersion: 9 })));
    expect(thrown.eventType).toBe('roll.action_resolved');
    expect(thrown.fromVersion).toBe(9);
    expect(thrown.targetVersion).toBe(EVENT_SCHEMA_VERSION);
    expect(thrown.message).toContain('roll.action_resolved');
    expect(thrown.message).toContain('v9');
  });

  it('la table livrée est vide, et c’est la vérité d’aujourd’hui', () => {
    expect(Object.keys(UPCASTERS)).toHaveLength(0);
  });
});

describe('upcast — la chaîne, mesurée sur une cible plus haute', () => {
  /**
   * `upcast` vise `EVENT_SCHEMA_VERSION`, qui vaut 1. Pour prouver que la
   * boucle fonctionne il faut une ligne EN DESSOUS de la cible, donc une
   * version 0. C'est artificiel, et c'est le seul moyen de ne pas livrer une
   * boucle jamais exécutée.
   */
  it('enchaîne les étapes et compte celles qu’elle applique', () => {
    const table: UpcasterTable = {
      'system.note': {
        0: (p) => ({ ...(p as Record<string, unknown>), migre: true }),
      },
    };
    const result = upcast(
      { type: 'system.note', payloadVersion: 0, payload: { text: 'salut' } },
      table,
    );
    expect(result.steps).toBe(1);
    expect(result.payloadVersion).toBe(EVENT_SCHEMA_VERSION);
    expect(result.payload).toStrictEqual({ text: 'salut', migre: true });
  });

  it('lève quand une étape manque au milieu de la chaîne', () => {
    expect(() => upcast({ type: 'system.note', payloadVersion: 0, payload: {} }, {})).toThrow(
      UpcastGapError,
    );
  });
});
