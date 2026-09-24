/**
 * Critère d'acceptation : un `op` inconnu dans `EffectSchema` est refusé.
 *
 * Le schéma lui-même vit dans `core/effects.ts` (M0-05, ADR 0006). Ce fichier
 * le mesure SOUS L'ANGLE DU CONTENU : un fichier JSON relu en PR peut écrire
 * n'importe quoi, et c'est ici que « n'importe quoi » s'arrête.
 */
import { describe, expect, it } from 'vitest';

import { MoveSchema } from '../../src/content/move.js';
import { EffectSchema } from '../../src/core/effects.js';

/** Le plus petit mouvement légal : tout le reste du test est une mutation de celui-ci. */
const minimalMove = (effects: unknown[]): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'strike',
  name: 'Frapper',
  category: 'combat',
  trigger: 'Quand tu frappes le premier…',
  rollKind: 'action',
  attributeOptions: ['fer'],
  outcomes: {
    franche: { text: 'Tu touches.', effects: [] },
    partielle: { text: 'Tu touches, mais.', effects: [] },
    echec: { text: 'Tu manques.', effects },
  },
});

describe('EffectSchema — le `op` est une liste close', () => {
  it.each([
    ['op inventé', { op: 'set_gauge', gauge: 'vigueur', value: 0 }],
    ['op vide', { op: '' }],
    ['op absent', { gauge: 'vigueur', delta: -1 }],
    ['casse différente', { op: 'GAUGE', gauge: 'vigueur', delta: -1 }],
  ])('refuse %s', (_name, effect) => {
    expect(EffectSchema.safeParse(effect).success).toBe(false);
  });

  it.each([
    ['gauge', { op: 'gauge', gauge: 'vivres', delta: -1, target: 'self' }],
    ['momentum', { op: 'momentum', delta: 1 }],
    ['pay_price', { op: 'pay_price', mode: 'roll' }],
    ['oracle', { op: 'oracle', tableId: 'freljord-weather' }],
  ])('accepte %s', (_name, effect) => {
    expect(EffectSchema.safeParse(effect).success).toBe(true);
  });

  it('refuse un `op` inconnu JUSQUE DANS un fichier de mouvement', () => {
    // La même mutation, à l'endroit où elle arriverait vraiment : au fond
    // d'un fichier de contenu. Un `op` refusé isolément mais accepté imbriqué
    // ne garderait rien.
    expect(MoveSchema.safeParse(minimalMove([{ op: 'pay_price', mode: 'roll' }])).success).toBe(
      true,
    );
    expect(
      MoveSchema.safeParse(minimalMove([{ op: 'set_gauge', gauge: 'vigueur', value: 0 }])).success,
    ).toBe(false);
  });
});
