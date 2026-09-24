/**
 * `ChampionSchema` — le schéma UNIQUE d'une fiche, manuscrite ou forgée (§4.5),
 * et les atouts de perception de l'ADR 0009.
 *
 * Critère d'acceptation : la fiche SANS `aliases` est refusée, celle qui en
 * porte au moins un est acceptée. C'est la seule source du verrouillage de
 * distribution : un alias manquant, et un champion réservé sort sous un
 * surnom que personne n'a listé.
 */
import { describe, expect, it } from 'vitest';

import { ChampionSchema, PerceptionTraitSchema } from '../../src/content/champion.js';

const validChampion = (): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'braum',
  name: 'Braum',
  title: 'Le Cœur du Freljord',
  aliases: ['Le Cœur du Freljord', 'Heart of the Freljord'],
  origin: { regionId: 'freljord', homeText: 'Un hameau sous les pics.' },
  pitch: 'Un bouclier de porte et un rire plus large que la vallée.',
  description: 'Le plus grand cœur du Freljord, et le plus grand bouclier.',
  attributes: { vif: 1, coeur: 3, fer: 2, ombre: 1, esprit: 2 },
  startingAssets: ['bouclier-de-porte'],
  signatureAsset: {
    id: 'bouclier-de-porte',
    name: 'Bouclier de porte',
    text: 'Une porte de grange, portée comme un bouclier.',
    effects: [],
  },
  startingVow: { title: 'Protéger le village', rank: 'dangereux', description: 'Nul ne passe.' },
  voice: {
    register: 'chaleureux, bourru, protecteur',
    sampleLines: ['Approche, petit. Le bouclier tient.'],
  },
  loreHooks: ['Le bouclier a une histoire que Braum ne raconte jamais.'],
  source: 'handwritten',
});

/** ADR 0009. Les cinq champs, plus l'id dont le journal a besoin. */
const validPerceptionTrait = (): Record<string, unknown> => ({
  id: 'pressent-le-danger',
  domain: 'danger',
  trigger: {
    text: 'Une menace non perçue approche.',
    presentEntity: { kinds: ['npc', 'beast'], dispositions: ['hostile'] },
  },
  strength: 65,
  frequency: 'scene',
  effect: { kind: 'reveal', text: 'Braum sent que quelque chose vient du nord.' },
});

/** Le même objet moins une clé, sans `delete` : `no-dynamic-delete` est une erreur ici. */
const omitKey = (value: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

const without = (key: string): Record<string, unknown> => omitKey(validChampion(), key);

describe('ChampionSchema — `aliases`', () => {
  it('accepte la fiche de référence, qui porte deux alias', () => {
    const parsed = ChampionSchema.safeParse(validChampion());
    expect(parsed.error?.issues ?? []).toStrictEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('refuse la MÊME fiche sans `aliases`', () => {
    expect(ChampionSchema.safeParse(without('aliases')).success).toBe(false);
  });

  it('refuse une liste d’alias vide', () => {
    expect(ChampionSchema.safeParse({ ...validChampion(), aliases: [] }).success).toBe(false);
  });

  it('accepte un seul alias, et en refuse treize', () => {
    expect(ChampionSchema.safeParse({ ...validChampion(), aliases: ['Braum'] }).success).toBe(true);
    expect(
      ChampionSchema.safeParse({
        ...validChampion(),
        aliases: Array.from({ length: 13 }, (_unused, index) => `Alias ${String(index)}`),
      }).success,
    ).toBe(false);
  });

  it('refuse un alias vide dans une liste par ailleurs remplie', () => {
    expect(ChampionSchema.safeParse({ ...validChampion(), aliases: ['Braum', '  '] }).success).toBe(
      false,
    );
  });
});

describe('ChampionSchema — le reste de la fiche', () => {
  it('refuse une répartition [3,3,2,1,1] et accepte [3,2,2,1,1]', () => {
    expect(
      ChampionSchema.safeParse({
        ...validChampion(),
        attributes: { vif: 3, coeur: 3, fer: 2, ombre: 1, esprit: 1 },
      }).success,
    ).toBe(false);
    expect(
      ChampionSchema.safeParse({
        ...validChampion(),
        attributes: { vif: 3, coeur: 2, fer: 2, ombre: 1, esprit: 1 },
      }).success,
    ).toBe(true);
  });

  it('refuse un champion en relation avec lui-même', () => {
    const relation = { championId: 'braum', kind: 'allie', text: 'Lui-même.' };
    expect(ChampionSchema.safeParse({ ...validChampion(), relations: [relation] }).success).toBe(
      false,
    );
    expect(
      ChampionSchema.safeParse({
        ...validChampion(),
        relations: [{ ...relation, championId: 'ashe' }],
      }).success,
    ).toBe(true);
  });

  it('applique les valeurs par défaut de §4.5', () => {
    const parsed = ChampionSchema.parse(validChampion());
    expect(parsed.startingGauges).toStrictEqual({ vigueur: 5, ame: 5, vivres: 5 });
    expect(parsed.startingMomentum).toBe(2);
    expect(parsed.relations).toStrictEqual([]);
    expect(parsed.perceptionTraits).toStrictEqual([]);
  });

  it('n’accepte que `handwritten` et `forged` comme source', () => {
    expect(ChampionSchema.safeParse({ ...validChampion(), source: 'forged' }).success).toBe(true);
    expect(ChampionSchema.safeParse({ ...validChampion(), source: 'importe' }).success).toBe(false);
  });

  it('refuse un `portraitUrl` qui n’est pas une URL', () => {
    expect(
      ChampionSchema.safeParse({ ...validChampion(), portraitUrl: 'portraits/braum.png' }).success,
    ).toBe(false);
    expect(
      ChampionSchema.safeParse({
        ...validChampion(),
        portraitUrl: 'https://exemple.test/braum.png',
      }).success,
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ADR 0009 — la FORME d'un atout de perception. Les VALEURS seront équilibrées
// en jouant (M1) ; ce qui est mesuré ici, c'est que la forme refuse ce que
// l'ADR interdit et accepte ce qu'elle décrit.
describe('PerceptionTraitSchema — ADR 0009', () => {
  it('accepte un atout complet : les cinq champs, plus l’id du journal', () => {
    const parsed = PerceptionTraitSchema.parse(validPerceptionTrait());
    expect(Object.keys(parsed).sort()).toStrictEqual([
      'domain',
      'effect',
      'frequency',
      'id',
      'strength',
      'trigger',
    ]);
  });

  it.each(['domain', 'trigger', 'strength', 'frequency', 'effect', 'id'])(
    'refuse le même atout privé de `%s`',
    (key) => {
      expect(PerceptionTraitSchema.safeParse(omitKey(validPerceptionTrait(), key)).success).toBe(
        false,
      );
    },
  );

  // « Un atout qui se déclenche toujours n'est plus un atout, c'est une règle.
  //   Un atout qui ne se déclenche jamais n'existe pas. » — rendu mécanique.
  it.each([0, 100, -1, 101, 50.5])('refuse une force de %s', (strength) => {
    expect(PerceptionTraitSchema.safeParse({ ...validPerceptionTrait(), strength }).success).toBe(
      false,
    );
  });

  it.each([1, 50, 99])('accepte une force de %i', (strength) => {
    expect(PerceptionTraitSchema.safeParse({ ...validPerceptionTrait(), strength }).success).toBe(
      true,
    );
  });

  // LE DÉCLENCHEUR EST LA PIÈCE QUI ÉVITE LE RIDICULE. Un texte seul laisserait
  // le conteur décider si l'atout part : invariant 1 par la porte de derrière.
  it('refuse un déclencheur qui n’est QUE du texte', () => {
    const trait = {
      ...validPerceptionTrait(),
      trigger: { text: 'Rengar voit des gens au loin.' },
    };
    expect(PerceptionTraitSchema.safeParse(trait).success).toBe(false);
  });

  it('accepte le MÊME déclencheur dès qu’il porte une condition vérifiable', () => {
    const base = { text: 'Une cible désignée est à distance.' };
    expect(
      PerceptionTraitSchema.safeParse({
        ...validPerceptionTrait(),
        trigger: { ...base, presentEntity: { kinds: ['beast'], dispositions: ['hostile'] } },
      }).success,
    ).toBe(true);
    expect(
      PerceptionTraitSchema.safeParse({
        ...validPerceptionTrait(),
        trigger: { ...base, moveIds: ['gather-information'] },
      }).success,
    ).toBe(true);
  });

  it('refuse un `moveIds` hors de la liste close des onze mouvements', () => {
    const trait = {
      ...validPerceptionTrait(),
      trigger: { text: 'Quand tu traques.', moveIds: ['traquer-la-proie'] },
    };
    expect(PerceptionTraitSchema.safeParse(trait).success).toBe(false);
  });

  it('refuse une disposition ou un genre d’entité inventés', () => {
    const trigger = (presentEntity: unknown): Record<string, unknown> => ({
      ...validPerceptionTrait(),
      trigger: { text: 'Une menace approche.', presentEntity },
    });
    expect(
      PerceptionTraitSchema.safeParse(trigger({ kinds: ['dragon'], dispositions: ['hostile'] }))
        .success,
    ).toBe(false);
    expect(
      PerceptionTraitSchema.safeParse(trigger({ kinds: ['npc'], dispositions: ['menacant'] }))
        .success,
    ).toBe(false);
  });

  it.each(['scene', 'session', 'aventure'])('accepte la fréquence « %s »', (frequency) => {
    expect(PerceptionTraitSchema.safeParse({ ...validPerceptionTrait(), frequency }).success).toBe(
      true,
    );
  });

  it('refuse une fréquence hors des trois', () => {
    expect(
      PerceptionTraitSchema.safeParse({ ...validPerceptionTrait(), frequency: 'par tour' }).success,
    ).toBe(false);
  });

  // UN ATOUT NE PORTE AUCUN `EngineEffect`. Il révèle un fait, ou ouvre une
  // capacité. Accrocher une jauge à un atout probabiliste donnerait au contenu
  // versionné un chemin aléatoire vers les jauges, sans événement de journal
  // pour le dire : à rouvrir par ADR si M1 en a besoin.
  it('refuse un effet qui mute une jauge', () => {
    const trait = {
      ...validPerceptionTrait(),
      effect: { op: 'gauge', gauge: 'vigueur', delta: -1, target: 'self' },
    };
    expect(PerceptionTraitSchema.safeParse(trait).success).toBe(false);
  });

  it('accepte les deux formes d’effet : révéler, et ouvrir', () => {
    expect(
      PerceptionTraitSchema.safeParse({
        ...validPerceptionTrait(),
        effect: { kind: 'reveal', text: 'Un fait ajouté à la liste perceptible.' },
      }).success,
    ).toBe(true);
    expect(
      PerceptionTraitSchema.safeParse({
        ...validPerceptionTrait(),
        effect: { kind: 'grant', text: 'Une capacité ouverte.', moveIds: ['strike'] },
      }).success,
    ).toBe(true);
  });
});

describe('ChampionSchema — les atouts portés par la fiche', () => {
  it('accepte une fiche avec atouts, et en plafonne le nombre à six', () => {
    const trait = validPerceptionTrait();
    const many = (count: number): Record<string, unknown>[] =>
      Array.from({ length: count }, (_unused, index) => ({
        ...trait,
        id: `atout-${String(index)}`,
      }));
    expect(
      ChampionSchema.safeParse({ ...validChampion(), perceptionTraits: many(6) }).success,
    ).toBe(true);
    expect(
      ChampionSchema.safeParse({ ...validChampion(), perceptionTraits: many(7) }).success,
    ).toBe(false);
  });

  it('refuse deux atouts qui partagent le même id : le journal ne saurait lequel a parlé', () => {
    const trait = validPerceptionTrait();
    expect(
      ChampionSchema.safeParse({ ...validChampion(), perceptionTraits: [trait, { ...trait }] })
        .success,
    ).toBe(false);
    expect(
      ChampionSchema.safeParse({
        ...validChampion(),
        perceptionTraits: [trait, { ...trait, id: 'sent-le-mensonge' }],
      }).success,
    ).toBe(true);
  });
});
