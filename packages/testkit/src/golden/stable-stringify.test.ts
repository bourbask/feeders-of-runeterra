import { describe, expect, it } from 'vitest';

import { GoldenSerialisationError, stableStringify } from './stable-stringify.js';

describe('stableStringify', () => {
  // LE garde-fou du fichier : sans lui, un corpus signale une dérive là où il
  // n'y a qu'un ordre d'insertion différent.
  it('donne le même octet pour deux objets aux clés permutées', () => {
    const premier = stableStringify({ b: 1, a: { d: 4, c: 3 }, z: [{ y: 1, x: 2 }] });
    const second = stableStringify({ z: [{ x: 2, y: 1 }], a: { c: 3, d: 4 }, b: 1 });

    expect(premier).toBe(second);
    expect(Buffer.from(premier)).toStrictEqual(Buffer.from(second));
  });

  it('trie les clés, indente de deux espaces et termine par un saut de ligne', () => {
    const texte = stableStringify({ b: 1, a: 2 });

    expect(texte).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
    expect(texte.endsWith('\n')).toBe(true);
    expect(texte.endsWith('\n\n')).toBe(false);
  });

  it('termine par un saut de ligne même sur une valeur nue', () => {
    expect(stableStringify(1)).toBe('1\n');
    expect(stableStringify('a')).toBe('"a"\n');
    expect(stableStringify(null)).toBe('null\n');
    expect(stableStringify(true)).toBe('true\n');
  });

  it('écrit les structures vides sur une ligne', () => {
    expect(stableStringify({ a: [], b: {} })).toBe('{\n  "a": [],\n  "b": {}\n}\n');
  });

  it('indente les tableaux comme les objets', () => {
    expect(stableStringify([1, [2]])).toBe('[\n  1,\n  [\n    2\n  ]\n]\n');
  });

  it('normalise -0 en 0', () => {
    expect(stableStringify({ delta: -0 })).toBe(stableStringify({ delta: 0 }));
    expect(stableStringify(-0)).toBe('0\n');
  });

  // JSON.stringify écrirait `null` ici, en silence : le corpus enregistrerait
  // une valeur que les règles n'ont jamais produite.
  it('refuse NaN et les infinis au lieu d’écrire null', () => {
    expect(() => stableStringify({ a: Number.NaN })).toThrow(GoldenSerialisationError);
    expect(() => stableStringify({ a: Number.POSITIVE_INFINITY })).toThrow(/\$\.a/);
    expect(() => stableStringify([1, Number.NEGATIVE_INFINITY])).toThrow(/\$\[1\]/);
    expect(JSON.stringify({ a: Number.NaN })).toBe('{"a":null}');
  });

  it('refuse ce qui n’a pas de représentation JSON', () => {
    expect(() => stableStringify({ a: 1n })).toThrow(GoldenSerialisationError);
    expect(() => stableStringify({ a: Symbol('a') })).toThrow(GoldenSerialisationError);
    expect(() => stableStringify([undefined])).toThrow(GoldenSerialisationError);
    expect(() => stableStringify(undefined)).toThrow(GoldenSerialisationError);
  });

  it('refuse une référence circulaire en la nommant', () => {
    const boucle: { a: number; soi?: unknown } = { a: 1 };
    boucle.soi = boucle;

    expect(() => stableStringify(boucle)).toThrow(/circular reference/);
  });

  it('omet une propriété explicitement undefined, comme JSON.stringify', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{\n  "a": 1\n}\n');
  });

  it('sérialise une date par son toJSON', () => {
    expect(stableStringify({ at: new Date('2024-01-01T00:00:00.000Z') })).toBe(
      '{\n  "at": "2024-01-01T00:00:00.000Z"\n}\n',
    );
  });

  it('accepte le même objet à deux endroits — ce n’est pas un cycle', () => {
    const partagé = { a: 1 };

    expect(stableStringify([partagé, partagé])).toBe(
      '[\n  {\n    "a": 1\n  },\n  {\n    "a": 1\n  }\n]\n',
    );
  });

  it('échappe les clés et les valeurs', () => {
    expect(stableStringify({ 'a"b': 'c\nd' })).toBe('{\n  "a\\"b": "c\\nd"\n}\n');
  });

  it('est idempotent : relire puis réécrire ne bouge pas', () => {
    const valeur = { b: [3, 2, 1], a: { z: -0, y: 'é' } };
    const texte = stableStringify(valeur);

    expect(stableStringify(JSON.parse(texte) as unknown)).toBe(texte);
  });
  // ── Map, Set et compagnie : la dérive que « {} » rendait invisible ──────────
  //
  // Object.keys() ne voit aucune clé propre sur une Map ni sur un Set : sans ce
  // refus, deux états de table qui diffèrent sur TOUTES les jauges donnent le
  // même octet, et le corpus passe au vert sur une dérive qu'il n'a pas vue.

  interface ÉtatDeTable {
    readonly character: string;
    readonly gauges: ReadonlyMap<string, number>;
    readonly covered: ReadonlySet<string>;
  }

  const étatDeTable = (
    vivres: number,
    souffle: number,
    couverts: readonly string[],
  ): ÉtatDeTable => ({
    character: 'ashe',
    gauges: new Map([
      ['vivres', vivres],
      ['souffle', souffle],
    ]),
    covered: new Set(couverts),
  });

  it('refuse une Map au lieu de la sérialiser en « {} »', () => {
    expect(() => stableStringify({ gauges: new Map([['vivres', 3]]) })).toThrow(
      GoldenSerialisationError,
    );
    expect(() => stableStringify({ gauges: new Map([['vivres', 3]]) })).toThrow(
      /at \$\.gauges: a Map has no own enumerable keys/,
    );
  });

  it('refuse un Set au lieu de le sérialiser en « {} »', () => {
    expect(() => stableStringify({ covered: new Set(['endure-cold']) })).toThrow(
      /at \$\.covered: a Set has no own enumerable keys/,
    );
  });

  it('refuse une Map imbriquée, avec son chemin exact', () => {
    expect(() => stableStringify({ events: [{ delta: new Map() }] })).toThrow(
      /at \$\.events\[0\]\.delta: a Map/,
    );
  });

  it('la dérive que le silence cachait : deux états distincts ne passent plus', () => {
    // Sans le refus, ces deux valeurs sérialisaient octet pour octet en
    // '{\n  "character": "ashe",\n  "covered": {},\n  "gauges": {}\n}\n'.
    expect(() => stableStringify(étatDeTable(3, 2, ['endure-cold']))).toThrow(
      GoldenSerialisationError,
    );
    expect(() =>
      stableStringify(étatDeTable(0, -6, ['endure-cold', 'forage', 'undertake-journey'])),
    ).toThrow(GoldenSerialisationError);
  });

  it('une Map convertie en objet trié repasse au vert, et les deux états diffèrent', () => {
    const aplati = (état: ÉtatDeTable): string =>
      stableStringify({
        ...état,
        gauges: Object.fromEntries(état.gauges),
        covered: [...état.covered].sort(),
      });

    const avant = aplati(étatDeTable(3, 2, ['endure-cold']));
    const après = aplati(étatDeTable(0, -6, ['endure-cold', 'forage', 'undertake-journey']));

    expect(avant).toContain('"vivres": 3');
    expect(après).toContain('"vivres": 0');
    expect(avant).not.toBe(après);
  });

  it('refuse une instance de classe, dont l’état privé ne serait pas sérialisé', () => {
    class ÉtatDeCampagne {
      readonly #secret = 42;
      constructor(readonly visible: string) {}
      lire(): number {
        return this.#secret;
      }
    }

    expect(() => stableStringify(new ÉtatDeCampagne('ashe'))).toThrow(
      /at \$: an instance of `ÉtatDeCampagne` is not a plain object/,
    );
  });

  it('accepte encore un objet sans prototype et un tableau simple', () => {
    const sansPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });

    expect(stableStringify(sansPrototype)).toBe('{\n  "a": 1\n}\n');
    expect(stableStringify([1, 2])).toBe('[\n  1,\n  2\n]\n');
  });
});
