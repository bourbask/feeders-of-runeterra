import { describe, expect, it } from 'vitest';

import { EffectSchema, PAY_PRICE_MODE, zEngineEffect, zPayPriceMode } from './effects.js';

describe('zEngineEffect — ADR 0006, « payer le prix » n’a qu’un mode', () => {
  it('zPayPriceMode n’accepte qu’une seule valeur, et c’est « roll »', () => {
    // Le test que l'ADR demande explicitement à M0-05 : il devient rouge le
    // jour où quelqu'un transforme ce littéral en énumération.
    expect([...zPayPriceMode.values]).toStrictEqual(['roll']);
    expect(PAY_PRICE_MODE).toBe('roll');
  });

  it('accepte pay_price en mode roll', () => {
    expect(zEngineEffect.safeParse({ op: 'pay_price', mode: 'roll' }).success).toBe(true);
  });

  it.each(['gm_choice', 'player_choice', 'choice', 'gm', 'player'])(
    'refuse pay_price en mode « %s »',
    (mode) => {
      expect(zEngineEffect.safeParse({ op: 'pay_price', mode }).success).toBe(false);
    },
  );

  it('borne 1 : un prix ne devient jamais un menu', () => {
    // `choice` n'est pas atteignable depuis `pay_price`. Un `options` glissé
    // dans un effet de prix n'est pas conservé : il ne ressort pas du parse,
    // donc aucun exécuteur ne peut le lire.
    const parsed = zEngineEffect.parse({
      op: 'pay_price',
      mode: 'roll',
      options: [{ id: 'a', label: 'A', effects: [] }],
    });
    expect(Object.keys(parsed).sort()).toStrictEqual(['mode', 'op']);
  });
});

describe('zEngineEffect — l’effet choice et ses bornes', () => {
  const option = (id: string) => ({ id, label: `Option ${id}`, effects: [] });

  it('accepte un choix à deux options', () => {
    const result = zEngineEffect.safeParse({
      op: 'choice',
      label: 'Perds des vivres ou encaisse',
      options: [option('vivres'), option('encaisse')],
    });
    expect(result.success).toBe(true);
  });

  it('applique pick = 1 par défaut', () => {
    const parsed = zEngineEffect.parse({
      op: 'choice',
      label: 'Choisis',
      options: [option('a'), option('b')],
    });
    expect(parsed).toMatchObject({ pick: 1 });
  });

  it('refuse un choix à une seule option', () => {
    const result = zEngineEffect.safeParse({
      op: 'choice',
      label: 'Choisis',
      options: [option('a')],
    });
    expect(result.success).toBe(false);
  });

  it('refuse un choix à sept options', () => {
    const result = zEngineEffect.safeParse({
      op: 'choice',
      label: 'Choisis',
      options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(option),
    });
    expect(result.success).toBe(false);
  });

  it('accepte des effets imbriqués dans une option', () => {
    const result = zEngineEffect.safeParse({
      op: 'choice',
      label: 'Choisis',
      options: [
        { id: 'a', label: 'A', effects: [{ op: 'gauge', gauge: 'vivres', delta: -1 }] },
        { id: 'b', label: 'B', effects: [{ op: 'momentum', delta: -2 }] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('refuse plus de six effets dans une option', () => {
    const six = Array.from({ length: 7 }, () => ({ op: 'momentum_reset' }));
    const result = zEngineEffect.safeParse({
      op: 'choice',
      label: 'Choisis',
      options: [
        { id: 'a', label: 'A', effects: six },
        { id: 'b', label: 'B', effects: [] },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('zEngineEffect — les autres opérations', () => {
  it('refuse un op inconnu', () => {
    expect(zEngineEffect.safeParse({ op: 'set_gauge', gauge: 'vigueur', value: 0 }).success).toBe(
      false,
    );
  });

  it('applique target = self par défaut sur gauge', () => {
    expect(zEngineEffect.parse({ op: 'gauge', gauge: 'vigueur', delta: -2 })).toMatchObject({
      target: 'self',
    });
  });

  it('borne le delta de jauge à ±5', () => {
    expect(zEngineEffect.safeParse({ op: 'gauge', gauge: 'vigueur', delta: -6 }).success).toBe(
      false,
    );
  });

  it('applique useRank = false par défaut sur track_tick', () => {
    expect(zEngineEffect.parse({ op: 'track_tick', trackKind: 'vow', ticks: 4 })).toMatchObject({
      useRank: false,
    });
  });

  it('refuse un track_create de type bond', () => {
    // `bond` est une piste de progression, mais aucun effet ne l'ouvre.
    expect(
      zEngineEffect.safeParse({ op: 'track_create', trackKind: 'bond', rankFrom: 'fixed' }).success,
    ).toBe(false);
  });

  it('borne clock_advance à 1..3 segments', () => {
    expect(zEngineEffect.safeParse({ op: 'clock_advance', segments: 3 }).success).toBe(true);
    expect(zEngineEffect.safeParse({ op: 'clock_advance', segments: 4 }).success).toBe(false);
    expect(zEngineEffect.safeParse({ op: 'clock_advance', segments: 0 }).success).toBe(false);
  });

  it('refuse un narrative au texte vide', () => {
    expect(zEngineEffect.safeParse({ op: 'narrative', prompt: '   ' }).success).toBe(false);
  });

  it('EffectSchema est le même schéma que zEngineEffect', () => {
    expect(EffectSchema).toBe(zEngineEffect);
  });
});
