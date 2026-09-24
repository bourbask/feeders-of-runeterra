/**
 * `MoveSchema` (§4.4). La règle qui compte : les attributs vont avec le jet
 * d'action, et seulement avec lui.
 *
 * VALEUR DE RÉFÉRENCE LOCALE, et non un module `fixtures.ts` partagé. Deux
 * raisons mesurées :
 *   - un `fixtures.ts` dans `tests/` n'appartient à aucun programme
 *     TypeScript (le tsconfig de build exclut `tests/`, et `eslint.config.js`
 *     ne rattache `tsconfig.test.json` qu'aux fichiers nommés en `.test.ts`) :
 *     `eslint .` s'arrête sur « was not found by the project service » ;
 *   - le renommer en `.test.ts` le fait importer par chaque consommateur, et
 *     vitest rejoue alors son `describe` dans CHACUN d'eux — mesuré, sept
 *     tests dupliqués six fois.
 * Les fixtures partagées sont l'affaire de `@for/testkit` (M0-10), livré dans
 * la même vague.
 */
import { describe, expect, it } from 'vitest';

import { MoveSchema } from '../../src/content/move.js';

const validMove = (): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'endure-cold',
  name: 'Endurer le froid',
  category: 'survie',
  trigger: 'Quand tu traverses une étendue gelée sans abri ni feu…',
  rollKind: 'action',
  attributeOptions: ['fer', 'esprit'],
  allowsMomentumBurn: true,
  outcomes: {
    franche: {
      text: 'Tu tiens bon. Le froid ne te prend rien.',
      effects: [{ op: 'momentum', delta: 1 }],
    },
    partielle: {
      text: 'Tu passes, mais le gel prélève sa part.',
      effects: [{ op: 'gauge', gauge: 'vivres', delta: -1, target: 'self' }],
    },
    echec: {
      text: 'Le froid entre en toi.',
      effects: [{ op: 'pay_price', mode: 'roll' }],
    },
  },
  presage: { text: 'Le blizzard se lève.', tableId: 'presages' },
  tags: ['froid', 'voyage'],
});

describe('MoveSchema', () => {
  it('accepte le mouvement de référence', () => {
    const parsed = MoveSchema.safeParse(validMove());
    expect(parsed.error?.issues ?? []).toStrictEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("refuse un jet d'action sans attribut, et l'accepte avec un seul", () => {
    expect(MoveSchema.safeParse({ ...validMove(), attributeOptions: [] }).success).toBe(false);
    expect(MoveSchema.safeParse({ ...validMove(), attributeOptions: ['fer'] }).success).toBe(true);
  });

  it("refuse des attributs hors jet d'action, et accepte le même mouvement sans eux", () => {
    const progress = { ...validMove(), rollKind: 'progress' };
    expect(MoveSchema.safeParse(progress).success).toBe(false);
    expect(MoveSchema.safeParse({ ...progress, attributeOptions: [] }).success).toBe(true);
  });

  it('refuse un attribut inventé', () => {
    expect(MoveSchema.safeParse({ ...validMove(), attributeOptions: ['force'] }).success).toBe(
      false,
    );
  });

  it('exige les trois issues', () => {
    const outcomes = validMove()['outcomes'] as Record<string, unknown>;
    delete outcomes['partielle'];
    expect(MoveSchema.safeParse({ ...validMove(), outcomes }).success).toBe(false);
  });

  it('refuse une catégorie hors liste', () => {
    expect(MoveSchema.safeParse({ ...validMove(), category: 'exploration' }).success).toBe(false);
  });

  it('applique les défauts : brûlure d’élan autorisée, effets vides, tags vides', () => {
    const move = validMove();
    delete move['allowsMomentumBurn'];
    delete move['tags'];
    const parsed = MoveSchema.parse(move);
    expect(parsed.allowsMomentumBurn).toBe(true);
    expect(parsed.tags).toStrictEqual([]);
  });

  it('plafonne une issue à huit effets', () => {
    const effect = { op: 'momentum', delta: 1 };
    const build = (count: number): Record<string, unknown> => ({
      ...validMove(),
      outcomes: {
        ...(validMove()['outcomes'] as Record<string, unknown>),
        franche: { text: 'Tu tiens bon.', effects: Array.from({ length: count }, () => effect) },
      },
    });
    expect(MoveSchema.safeParse(build(8)).success).toBe(true);
    expect(MoveSchema.safeParse(build(9)).success).toBe(false);
  });
});
