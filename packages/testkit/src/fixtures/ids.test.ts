/**
 * Le piège que ce fichier existe pour fermer : `counterIds('ev')` rend `ev-1`,
 * et `zEventId` le refuse. Un identifiant de fixture doit avoir la FORME d'un
 * ULID, sinon l'état construit échoue au parse sur sa première clé.
 */
import { ULID_PATTERN } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { aCorrelationId, anId } from './ids.js';

describe('anId', () => {
  it('rend un identifiant qui passe le motif ULID des contrats', () => {
    expect(anId('character')).toMatch(ULID_PATTERN);
    expect(anId('event', 4096)).toMatch(ULID_PATTERN);
    expect(anId('aicall', 0)).toMatch(ULID_PATTERN);
  });

  it('reste lisible : le genre se lit en clair dans l’identifiant', () => {
    expect(anId('character')).toBe('0CHARACTER0000000000000001');
    expect(anId('track', 2)).toBe('0TRACK00000000000000000002');
  });

  it('deux appels identiques donnent le même identifiant', () => {
    expect(anId('player', 7)).toBe(anId('player', 7));
  });

  it('deux index différents donnent deux identifiants différents', () => {
    expect(anId('player', 7)).not.toBe(anId('player', 8));
  });

  it('refuse un index hors bornes plutôt que de rendre une chaîne trop longue', () => {
    expect(() => anId('event', -1)).toThrow(RangeError);
    expect(() => anId('event', 1.5)).toThrow(RangeError);
    expect(() => anId('event', 32 ** 8)).toThrow(RangeError);
  });

  it('les lettres que Crockford ne connaît pas sont relues, pas laissées passer', () => {
    // `roll` porte un `O`, que Crockford lit `0`, et deux `L`, qu'il lit `1`.
    expect(anId('roll')).toMatch(ULID_PATTERN);
    expect(anId('roll').startsWith('0R011')).toBe(true);
    // `session` porte un `I`, lu `1`.
    expect(anId('session').startsWith('0SESS10N')).toBe(true);
  });
});

describe('aCorrelationId', () => {
  it('rend un UUID, pas un ULID : c’est le client qui le frappe', () => {
    expect(aCorrelationId(1)).toBe('00000000-0000-4000-8000-000000000001');
    expect(aCorrelationId(255)).toBe('00000000-0000-4000-8000-0000000000ff');
  });

  it('refuse un index hors bornes', () => {
    expect(() => aCorrelationId(-1)).toThrow(RangeError);
    expect(() => aCorrelationId(2 ** 48)).toThrow(RangeError);
  });
});
