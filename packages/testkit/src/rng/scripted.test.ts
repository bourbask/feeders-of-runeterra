import { describe, expect, it } from 'vitest';

import { ScriptedRngExhausted, ScriptedRngOutOfRange, scriptedRng } from './scripted.js';

describe('scriptedRng', () => {
  it('rend exactement la suite fournie, dans l’ordre', () => {
    const rng = scriptedRng([6, 3, 1, 4]);

    expect([rng.roll(6), rng.roll(6), rng.roll(6), rng.roll(6)]).toStrictEqual([6, 3, 1, 4]);
  });

  it('trace chaque tirage avec le dé qui l’a produit', () => {
    const rng = scriptedRng([5, 2]);
    rng.roll(6);
    rng.roll(10);

    expect(rng.trace()).toStrictEqual([
      { sides: 6, value: 5 },
      { sides: 10, value: 2 },
    ]);
  });

  it('compte ce qui est consommé et ce qui reste', () => {
    const rng = scriptedRng([1, 2, 3]);
    expect([rng.consumed(), rng.remaining()]).toStrictEqual([0, 3]);

    rng.roll(6);
    rng.roll(6);

    expect([rng.consumed(), rng.remaining()]).toStrictEqual([2, 1]);
  });

  // LE garde-fou du fichier : épuisé, il refuse au lieu d'improviser.
  it('lève ScriptedRngExhausted une fois la suite épuisée, avec le nombre de tirages consommés', () => {
    const rng = scriptedRng([6, 3, 1]);
    rng.roll(6);
    rng.roll(6);
    rng.roll(6);

    let capturé: unknown;
    try {
      rng.roll(6);
    } catch (erreur: unknown) {
      capturé = erreur;
    }

    expect(capturé).toBeInstanceOf(ScriptedRngExhausted);
    const erreur = capturé as ScriptedRngExhausted;
    expect(erreur.name).toBe('ScriptedRngExhausted');
    expect(erreur.consumed).toBe(3);
    expect(erreur.scripted).toBe(3);
    expect(erreur.sides).toBe(6);
    // Le nombre de tirages consommés est DANS le message : c'est ce qu'on lit
    // dans une sortie de test, pas le champ de l'objet.
    expect(erreur.message).toMatch(/3 draw\(s\) consumed out of 3 scripted/);
  });

  it('refuse le premier tirage quand la suite est vide', () => {
    const rng = scriptedRng([]);

    expect(() => rng.roll(6)).toThrow(ScriptedRngExhausted);
  });

  // Un 9 rendu pour un d6 est un fait que les règles ne peuvent pas produire :
  // toute assertion en aval mesure une fiction.
  it('refuse une valeur impossible pour le dé demandé', () => {
    const rng = scriptedRng([9]);

    expect(() => rng.roll(6)).toThrow(ScriptedRngOutOfRange);
    expect(() => rng.roll(6)).toThrow(/cannot come out of a d6/);
  });

  it('accepte cette même valeur sur un dé assez grand', () => {
    expect(scriptedRng([9]).roll(10)).toBe(9);
  });

  it('refuse une suite contenant autre chose qu’un entier positif', () => {
    expect(() => scriptedRng([1, 0])).toThrow(RangeError);
    expect(() => scriptedRng([1, 2.5])).toThrow(/index 1/);
    expect(() => scriptedRng([-1])).toThrow(RangeError);
  });

  it('refuse un dé qui n’en est pas un', () => {
    const rng = scriptedRng([1]);

    expect(() => rng.roll(0)).toThrow(RangeError);
    expect(() => rng.roll(2.5)).toThrow(RangeError);
  });

  it('ne se laisse pas modifier par le tableau qu’on lui a passé', () => {
    const valeurs = [1, 2];
    const rng = scriptedRng(valeurs);
    valeurs.push(3);

    rng.roll(6);
    rng.roll(6);

    expect(() => rng.roll(6)).toThrow(ScriptedRngExhausted);
  });
});
