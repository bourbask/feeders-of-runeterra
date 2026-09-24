/**
 * Le critère d'acceptation littéral : `aTableState()` passe
 * `zCampaignState.parse` SANS AUCUNE OPTION. Et chaque sous-constructeur passe
 * son propre schéma, sans argument non plus — sinon « valeurs par défaut
 * complètes » ne veut rien dire au premier niveau imbriqué.
 */
import {
  zCampaignSettings,
  zCampaignState,
  zCampaignTruth,
  zChampionLock,
  zClockState,
  zEntityState,
  zProgressTrack,
  zSceneAbsence,
  zScenePresence,
  zSceneState,
} from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { aCharacter } from './characters.js';
import { anId } from './ids.js';
import {
  aCampaignSettings,
  aChampionLock,
  aClock,
  aScene,
  aSceneAbsence,
  aScenePresence,
  aTableState,
  aTrack,
  aTruth,
  aVow,
  anEntity,
} from './table.js';

describe('aTableState', () => {
  it('sans aucune option, passe zCampaignState.parse', () => {
    expect(() => zCampaignState.parse(aTableState())).not.toThrow();
  });

  it('la table par défaut est vide : un personnage, rien d’autre', () => {
    const table = aTableState();

    expect(Object.keys(table.characters)).toHaveLength(1);
    expect(Object.keys(table.tracks)).toHaveLength(0);
    expect(Object.keys(table.clocks)).toHaveLength(0);
    expect(Object.keys(table.entities)).toHaveLength(0);
    expect(table.scene).toBeNull();
    expect(table.seq).toBe(0);
  });

  it('les collections arrivent en tableaux et sortent indexées par leur propre id', () => {
    const deuxieme = aCharacter({ id: anId('character', 2), playerId: anId('player', 2) });
    const table = aTableState({
      characters: [aCharacter(), deuxieme],
      tracks: [aVow()],
      clocks: [aClock()],
      entities: [anEntity()],
      championLocks: [aChampionLock()],
    });

    expect(Object.keys(table.characters)).toStrictEqual([anId('character'), anId('character', 2)]);
    expect(table.characters[anId('character', 2)]).toStrictEqual(deuxieme);
    expect(Object.keys(table.tracks)).toStrictEqual([anId('track')]);
    expect(Object.keys(table.clocks)).toStrictEqual([anId('clock')]);
    expect(Object.keys(table.entities)).toStrictEqual([anId('entity')]);
    expect(Object.keys(table.championLocks)).toStrictEqual(['sejuani']);
    expect(() => zCampaignState.parse(table)).not.toThrow();
  });

  it('la bande se déduit des personnages, et le propriétaire en fait partie', () => {
    const table = aTableState({
      characters: [
        aCharacter(),
        aCharacter({ id: anId('character', 2), playerId: anId('player', 2) }),
      ],
    });

    expect(table.party.memberPlayerIds).toStrictEqual([anId('player'), anId('player', 2)]);
    expect(table.party.memberPlayerIds).toContain(table.party.ownerPlayerId);
  });

  it('une scène ouverte passe encore le schéma', () => {
    expect(() => zCampaignState.parse(aTableState({ scene: aScene() }))).not.toThrow();
  });

  it('deux appels donnent la même table', () => {
    expect(aTableState()).toStrictEqual(aTableState());
  });

  /**
   * Les surcharges SCALAIRES de la racine — celles qui ne passent pas par
   * `keyById` et que rien ne mesurait. `settings`, `status`, `seq` et `truths`
   * pouvaient chacune être ignorées en silence, et `reducerVersion`,
   * `contentPackHash`, `rng`, `campaignId`, `scene` et `party` avec elles.
   *
   * Un seul `it` par champ : le message d'échec nomme alors le champ, au lieu
   * d'annoncer qu'« une surcharge » ne passe pas.
   */
  describe('les surcharges de la racine', () => {
    const demandes = {
      campaignId: anId('campaign', 7),
      seq: 42,
      reducerVersion: 3,
      contentPackHash: 'sha256:autre',
      status: 'archived',
      settings: aCampaignSettings({ gmVerbosity: 'sobre' }),
      truths: [aTruth({ truthId: 'le-col' })],
      scene: aScene(),
      party: { memberPlayerIds: [anId('player', 5)], ownerPlayerId: anId('player', 5) },
      rng: { seed: 'graine-de-test', draws: { action: 4 } },
    } as const;

    it.each(Object.keys(demandes))('« %s » est reprise telle quelle', (champ) => {
      const attendu = (demandes as Record<string, unknown>)[champ];
      const table = aTableState({ [champ]: attendu }) as unknown as Record<string, unknown>;

      expect(table[champ]).toStrictEqual(attendu);
      // Et la table reste analysable : une surcharge prise mais qui casse le
      // schéma ne serait pas une surcharge tenue.
      expect(() => zCampaignState.parse(table)).not.toThrow();
    });

    it.each(Object.keys(demandes))(
      '« %s » surchargée ne déplace aucun autre champ de la racine',
      (champ) => {
        const attendu = (demandes as Record<string, unknown>)[champ];
        const parDefaut = aTableState() as unknown as Record<string, unknown>;
        const table = aTableState({ [champ]: attendu }) as unknown as Record<string, unknown>;

        for (const autre of Object.keys(parDefaut).filter((cle) => cle !== champ)) {
          expect({ [autre]: table[autre] }).toStrictEqual({ [autre]: parDefaut[autre] });
        }
      },
    );

    it('chaque valeur demandée diffère bien du défaut — sinon le test ci-dessus est inerte', () => {
      const parDefaut = aTableState() as unknown as Record<string, unknown>;

      for (const [champ, attendu] of Object.entries(demandes)) {
        expect({ [champ]: parDefaut[champ] }).not.toStrictEqual({ [champ]: attendu });
      }
    });
  });
});

describe('les sous-constructeurs', () => {
  it('passent chacun leur schéma sans un seul argument', () => {
    expect(() => zCampaignSettings.parse(aCampaignSettings())).not.toThrow();
    expect(() => zProgressTrack.parse(aTrack())).not.toThrow();
    expect(() => zProgressTrack.parse(aVow())).not.toThrow();
    expect(() => zClockState.parse(aClock())).not.toThrow();
    expect(() => zEntityState.parse(anEntity())).not.toThrow();
    expect(() => zChampionLock.parse(aChampionLock())).not.toThrow();
    expect(() => zCampaignTruth.parse(aTruth())).not.toThrow();
    expect(() => zScenePresence.parse(aScenePresence())).not.toThrow();
    expect(() => zSceneAbsence.parse(aSceneAbsence())).not.toThrow();
    expect(() => zSceneState.parse(aScene())).not.toThrow();
  });

  it('aVow impose le genre « vow », même si on tente autre chose', () => {
    expect(aVow({ kind: 'combat' }).kind).toBe('vow');
  });

  /**
   * LE MODE DE PANNE LE PLUS DANGEREUX D'UNE BIBLIOTHÈQUE DE FIXTURES : un
   * constructeur qui jette silencieusement l'argument qu'on lui tend. Tout
   * test aval qui écrit `aClock({ segments: 4 })` passe alors au vert pour la
   * mauvaise raison — il mesure le défaut, pas ce qu'il a demandé.
   *
   * Cinq sous-constructeurs pouvaient ignorer entièrement leur objet
   * `overrides` sans qu'un test bronche. Chaque ligne ci-dessous tient les
   * DEUX moitiés de la plomberie : la surcharge est PRISE, et le reste du
   * défaut TIENT (un constructeur qui rendrait `{ ...overrides }` seul est
   * tout aussi cassé qu'un qui rendrait `{ ...base }` seul).
   */
  describe('la plomberie des surcharges', () => {
    const plomberie = [
      {
        nom: 'aTrack',
        defaut: () => aTrack() as unknown as Record<string, unknown>,
        surcharge: () =>
          aTrack({ rank: 'redoutable', ticks: 6 }) as unknown as Record<string, unknown>,
        pris: { rank: 'redoutable', ticks: 6 },
        intact: ['id', 'kind', 'title', 'status', 'visibility', 'createdSeq'],
        schema: zProgressTrack,
      },
      {
        nom: 'aClock',
        defaut: () => aClock() as unknown as Record<string, unknown>,
        surcharge: () => aClock({ segments: 4, filled: 3 }) as unknown as Record<string, unknown>,
        pris: { segments: 4, filled: 3 },
        intact: ['id', 'title', 'description', 'status', 'visibility', 'consequence'],
        schema: zClockState,
      },
      {
        nom: 'anEntity',
        defaut: () => anEntity() as unknown as Record<string, unknown>,
        surcharge: () =>
          anEntity({ kind: 'faction', disposition: 'hostile' }) as unknown as Record<
            string,
            unknown
          >,
        pris: { kind: 'faction', disposition: 'hostile' },
        intact: ['id', 'slug', 'name', 'summary', 'regionId', 'status', 'firstSeenSeq'],
        schema: zEntityState,
      },
      {
        nom: 'aCampaignSettings',
        defaut: () => aCampaignSettings() as unknown as Record<string, unknown>,
        surcharge: () =>
          aCampaignSettings({
            gmVerbosity: 'ample',
            allowForgedChampions: true,
          }) as unknown as Record<string, unknown>,
        pris: { gmVerbosity: 'ample', allowForgedChampions: true },
        intact: ['schemaVersion', 'models', 'oracleBias', 'safety', 'requireForgeReview'],
        schema: zCampaignSettings,
      },
      {
        nom: 'aChampionLock',
        defaut: () => aChampionLock() as unknown as Record<string, unknown>,
        surcharge: () =>
          aChampionLock({ championId: 'lissandra', lockKind: 'banned' }) as unknown as Record<
            string,
            unknown
          >,
        pris: { championId: 'lissandra', lockKind: 'banned' },
        intact: ['reason', 'setSeq'],
        schema: zChampionLock,
      },
      {
        nom: 'aTruth',
        defaut: () => aTruth() as unknown as Record<string, unknown>,
        surcharge: () =>
          aTruth({
            optionId: 'le-froid-endort',
            customText: 'Le froid endort.',
          }) as unknown as Record<string, unknown>,
        pris: { optionId: 'le-froid-endort', customText: 'Le froid endort.' },
        intact: ['truthId'],
        schema: zCampaignTruth,
      },
      {
        nom: 'aScenePresence',
        defaut: () => aScenePresence() as unknown as Record<string, unknown>,
        surcharge: () =>
          aScenePresence({ name: 'Le vieux guide', sinceSeq: 9 }) as unknown as Record<
            string,
            unknown
          >,
        pris: { name: 'Le vieux guide', sinceSeq: 9 },
        intact: ['ref', 'state'],
        schema: zScenePresence,
      },
      {
        nom: 'aSceneAbsence',
        defaut: () => aSceneAbsence() as unknown as Record<string, unknown>,
        surcharge: () =>
          aSceneAbsence({ cause: 'hors_de_portee', sinceSeq: 9 }) as unknown as Record<
            string,
            unknown
          >,
        pris: { cause: 'hors_de_portee', sinceSeq: 9 },
        intact: ['ref', 'name'],
        schema: zSceneAbsence,
      },
      {
        nom: 'aScene',
        defaut: () => aScene() as unknown as Record<string, unknown>,
        surcharge: () =>
          aScene({ placeName: 'La halle des brumes', updatedSeq: 12 }) as unknown as Record<
            string,
            unknown
          >,
        pris: { placeName: 'La halle des brumes', updatedSeq: 12 },
        intact: ['sceneId', 'placeId', 'timeOfDay', 'present', 'absent'],
        schema: zSceneState,
      },
    ] as const;

    it.each(plomberie)('$nom prend ses surcharges', ({ surcharge, pris }) => {
      const construit = surcharge();

      for (const [champ, valeur] of Object.entries(pris)) {
        expect({ [champ]: construit[champ] }).toStrictEqual({ [champ]: valeur });
      }
    });

    it.each(plomberie)('$nom garde le reste de son défaut', ({ defaut, surcharge, intact }) => {
      const parDefaut = defaut();
      const construit = surcharge();

      for (const champ of intact) {
        expect({ [champ]: construit[champ] }).toStrictEqual({ [champ]: parDefaut[champ] });
      }
    });

    it.each(plomberie)(
      '$nom passe encore son schéma une fois surchargé',
      ({ surcharge, schema }) => {
        expect(() => schema.parse(surcharge())).not.toThrow();
      },
    );
  });

  it('aScene trie présents et absents par ref.id, comme le prompt l’exige', () => {
    const scene = aScene({
      present: [
        aScenePresence({ ref: { kind: 'character', id: anId('character', 9) }, name: 'Z' }),
        aScenePresence({ ref: { kind: 'character', id: anId('character', 1) }, name: 'A' }),
      ],
      absent: [
        aSceneAbsence({ ref: { kind: 'entity', id: anId('entity', 5) }, name: 'E5' }),
        aSceneAbsence({ ref: { kind: 'entity', id: anId('entity', 2) }, name: 'E2' }),
      ],
    });

    expect(scene.present.map((p) => p.name)).toStrictEqual(['A', 'Z']);
    expect(scene.absent.map((a) => a.name)).toStrictEqual(['E2', 'E5']);
  });
});
