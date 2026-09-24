/**
 * « Valeurs par défaut complètes » n'est pas une intention : c'est que
 * `aCharacter()`, sans un seul argument, passe `zCharacterState.parse`.
 */
import { zAttributeSpread, zCharacterState } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { FIXTURE_ATTRIBUTES, aCharacter } from './characters.js';
import { anId } from './ids.js';

describe('aCharacter', () => {
  it('sans aucun argument, passe zCharacterState.parse', () => {
    expect(() => zCharacterState.parse(aCharacter())).not.toThrow();
  });

  it('porte la seule répartition d’attributs légale, 3/2/2/1/1', () => {
    expect(() => zAttributeSpread.parse(FIXTURE_ATTRIBUTES)).not.toThrow();
    expect(() => zAttributeSpread.parse(aCharacter().attributes)).not.toThrow();
  });

  it('porte les trois jauges, pas deux', () => {
    expect(Object.keys(aCharacter().gauges).sort()).toStrictEqual(['ame', 'vigueur', 'vivres']);
  });

  it('porte les bornes de souffle des règles', () => {
    expect(aCharacter().momentumBounds).toStrictEqual({ min: -6, max: 10, reset: 2 });
  });

  it('n’emprunte pas le nom d’un champion réservé', () => {
    // Un personnage nommé « Sejuani » ferait exploser expectNoReservedChampion
    // sur la moitié de la suite.
    expect(aCharacter().displayName).toBe('Braum');
  });

  it('les surcharges remplacent, le reste tient', () => {
    const personnage = aCharacter({ id: anId('character', 3), momentum: -2, status: 'dead' });

    expect(personnage.id).toBe(anId('character', 3));
    expect(personnage.momentum).toBe(-2);
    expect(personnage.status).toBe('dead');
    expect(personnage.gauges).toStrictEqual(aCharacter().gauges);
    expect(() => zCharacterState.parse(personnage)).not.toThrow();
  });

  it('deux appels donnent le même personnage : rien n’est tiré au hasard', () => {
    expect(aCharacter()).toStrictEqual(aCharacter());
  });
});
