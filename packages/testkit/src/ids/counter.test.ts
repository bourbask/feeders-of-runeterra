import { describe, expect, it } from 'vitest';

import { counterIds } from './counter.js';

describe('counterIds', () => {
  it('numérote à partir de 1, derrière le préfixe', () => {
    const ids = counterIds('ev');

    expect([ids.next(), ids.next(), ids.next()]).toStrictEqual(['ev-1', 'ev-2', 'ev-3']);
  });

  it('compte ce qu’elle a distribué', () => {
    const ids = counterIds('ev');
    expect(ids.count()).toBe(0);

    ids.next();
    ids.next();

    expect(ids.count()).toBe(2);
  });

  it('a un préfixe par défaut', () => {
    expect(counterIds().next()).toBe('id-1');
  });

  it('donne deux fois la même suite, ce qu’un ULID ne ferait jamais', () => {
    const première = counterIds('ev');
    const seconde = counterIds('ev');

    expect(première.next()).toBe(seconde.next());
  });

  it('donne des fabriques indépendantes', () => {
    const première = counterIds('ev');
    const seconde = counterIds('ch');
    première.next();

    expect(seconde.next()).toBe('ch-1');
  });

  it('refuse un préfixe qui ferait un identifiant illisible', () => {
    expect(() => counterIds('')).toThrow(RangeError);
    expect(() => counterIds('1ev')).toThrow(RangeError);
    expect(() => counterIds('ev ')).toThrow(RangeError);
    expect(() => counterIds('ev/1')).toThrow(RangeError);
  });
});
