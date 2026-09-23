import { describe, expect, it } from 'vitest';

import { fixedClock } from './fixed.js';

describe('fixedClock', () => {
  it('rend l’instant qu’on lui a donné, sous forme canonique', () => {
    expect(fixedClock('2024-01-01T00:00:00.000Z').now()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('ramène deux écritures du même instant à la même chaîne', () => {
    const avecZ = fixedClock('2024-01-01T00:00:00Z');
    const avecDécalage = fixedClock('2024-01-01T01:00:00+01:00');

    expect(avecDécalage.now()).toBe(avecZ.now());
    expect(avecDécalage.nowMs()).toBe(avecZ.nowMs());
  });

  // LE garde-fou du fichier : rien d'autre qu'advance() ne la fait bouger.
  it('n’avance jamais toute seule', async () => {
    const horloge = fixedClock('2024-01-01T00:00:00.000Z');
    const premier = horloge.now();

    // Du temps réel passe pour de bon : une boucle d'attente, puis un tour de
    // boucle d'événements. Une horloge branchée sur Date.now() bougerait ici.
    const départ = Date.now();
    while (Date.now() - départ < 5) {
      /* on brûle du temps réel */
    }
    await new Promise((résoudre) => setTimeout(résoudre, 10));

    expect(Date.now() - départ).toBeGreaterThanOrEqual(10);
    expect(horloge.now()).toBe(premier);
    expect(horloge.now()).toBe('2024-01-01T00:00:00.000Z');
    expect(horloge.nowMs()).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
  });

  it('cent lectures d’affilée rendent la même chose', () => {
    const horloge = fixedClock('2024-03-05T12:30:00.000Z');
    const lectures = new Set(Array.from({ length: 100 }, () => horloge.now()));

    expect(lectures.size).toBe(1);
  });

  it('avance exactement de ce qu’on lui demande, et seulement là', () => {
    const horloge = fixedClock('2024-01-01T00:00:00.000Z');

    horloge.advance(1500);

    expect(horloge.now()).toBe('2024-01-01T00:00:01.500Z');
    expect(horloge.nowMs()).toBe(Date.parse('2024-01-01T00:00:01.500Z'));
  });

  it('refuse de reculer', () => {
    const horloge = fixedClock('2024-01-01T00:00:00.000Z');

    expect(() => {
      horloge.advance(-1);
    }).toThrow(RangeError);
    expect(() => {
      horloge.advance(1.5);
    }).toThrow(RangeError);
    expect(horloge.now()).toBe('2024-01-01T00:00:00.000Z');
  });

  // Sans fuseau, Date.parse lit l'heure LOCALE : le même test donnerait deux
  // instants sur deux machines. C'est précisément ce qu'on refuse.
  it('refuse un instant sans fuseau horaire explicite', () => {
    expect(() => fixedClock('2024-01-01T00:00:00')).toThrow(RangeError);
    expect(() => fixedClock('2024-01-01')).toThrow(/explicit timezone/);
    expect(() => fixedClock('1 janvier 2024')).toThrow(RangeError);
  });

  // Date.parse accepte le 31 février : il le lit comme le 2 mars, en silence.
  it('refuse une date qui n’existe pas', () => {
    expect(Date.parse('2024-02-31T00:00:00.000Z')).not.toBeNaN();

    expect(() => fixedClock('2024-02-31T00:00:00.000Z')).toThrow(/not a date that exists/);
    expect(() => fixedClock('2023-02-29T00:00:00.000Z')).toThrow(RangeError);
    expect(() => fixedClock('2024-13-01T00:00:00.000Z')).toThrow(RangeError);
    expect(() => fixedClock('2024-01-01T24:00:00.000Z')).toThrow(RangeError);
    expect(() => fixedClock('2024-01-01T00:60:00.000Z')).toThrow(RangeError);
  });

  it('accepte le 29 février d’une année bissextile', () => {
    expect(fixedClock('2024-02-29T00:00:00.000Z').now()).toBe('2024-02-29T00:00:00.000Z');
  });

  it('donne des horloges indépendantes', () => {
    const première = fixedClock('2024-01-01T00:00:00.000Z');
    const seconde = fixedClock('2024-01-01T00:00:00.000Z');

    première.advance(1000);

    expect(seconde.now()).toBe('2024-01-01T00:00:00.000Z');
  });
});
