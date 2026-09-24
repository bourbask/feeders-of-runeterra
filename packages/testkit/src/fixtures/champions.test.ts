/**
 * Ce paquet sert à PROUVER les garde-fous des autres tâches. Une fixture qui
 * viole la règle qu'elle sert à tester rend vertes des vérifications qui ne
 * vérifient rien, ou rouges des vérifications saines — et c'est exactement ce
 * qui s'est produit : le personnage par défaut s'appelait « Braum », deuxième
 * entrée de `RESERVED_CHAMPIONS`, dans ce même paquet.
 *
 * Le test qui prétendait tenir la propriété épinglait la chaîne 'Braum'. Il
 * n'appelait jamais `expectNoReservedChampion`, donc il ne voyait rien.
 *
 * Ici, on APPELLE l'assertion, sur CHAQUE fixture livrée, et pas seulement sur
 * celle qu'on soupçonne : « une seule trouvée » n'est pas une preuve qu'il n'y
 * en a qu'une.
 */
import { describe, expect, it } from 'vitest';

import { ReservedChampionMentioned, expectNoReservedChampion } from '../assertions.js';
import { LONG_CAMPAIGN, aJournal } from './campaigns.js';
import { RESERVED_CHAMPIONS, reservedChampionNames } from './champions.js';
import { FIXTURE_CHAMPION, aCharacter } from './characters.js';
import { anEvent } from './events.js';
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

const reserves = reservedChampionNames();

/**
 * Toute fixture livrée par ce paquet, à son défaut, plus les compositions qui
 * en font entrer une dans une autre. `aChampionLock` est absente : c'est la
 * seule qui nomme un réservé exprès, et elle a son propre couple de tests.
 */
const FIXTURES_LIVREES: readonly (readonly [string, unknown])[] = [
  ['aCharacter()', aCharacter()],
  ['aTableState()', aTableState()],
  ['aTrack()', aTrack()],
  ['aVow()', aVow()],
  ['aClock()', aClock()],
  ['anEntity()', anEntity()],
  ['aTruth()', aTruth()],
  ['aCampaignSettings()', aCampaignSettings()],
  ['aScenePresence()', aScenePresence()],
  ['aSceneAbsence()', aSceneAbsence()],
  ['aScene()', aScene()],
  ['aTableState({ scene: aScene() })', aTableState({ scene: aScene() })],
  ['anEvent()', anEvent()],
  ['aJournal()', aJournal()],
  ['LONG_CAMPAIGN', LONG_CAMPAIGN],
];

/** Le nom du réservé cité, ou `undefined` si la fixture est propre. */
function citeUnReserve(valeur: unknown): string | undefined {
  try {
    expectNoReservedChampion(JSON.stringify(valeur), reserves);
    return undefined;
  } catch (erreur) {
    if (erreur instanceof ReservedChampionMentioned) return erreur.matched;
    throw erreur;
  }
}

describe('aucune fixture livrée ne cite un champion réservé', () => {
  it('le balayage passe sur les quinze, et nomme celles qui citent', () => {
    const fautives = FIXTURES_LIVREES.map(([nom, valeur]) => [nom, citeUnReserve(valeur)] as const)
      .filter(([, cite]) => cite !== undefined)
      .map(([nom, cite]) => `${nom} cite « ${String(cite)} »`);

    expect(fautives).toStrictEqual([]);
  });

  it('le balayage regarde bien quelque chose : sali, il rougit', () => {
    // La direction positive. Sans ce cas, un balayage sur liste vide, ou sur
    // des fixtures serialisees en `{}`, passerait tout aussi vert.
    const sali = aTableState({ characters: [aCharacter({ displayName: 'Sejuani' })] });

    expect(citeUnReserve(sali)).toBe('Sejuani');
  });

  it('un alias suffit à salir, pas seulement le nom d’affichage', () => {
    const sali = aTableState({
      scene: aScene({ present: [aScenePresence({ name: 'la Griffe de Givre' })] }),
    });

    expect(citeUnReserve(sali)).toBe('la Griffe de Givre');
  });
});

describe('FIXTURE_CHAMPION', () => {
  it('est absent de RESERVED_CHAMPIONS, par identifiant ET par nom', () => {
    // Le lien qui manquait entre les deux fixtures du paquet : le jour où
    // quelqu'un ajoute Ashe aux réservés, ou renomme le personnage par défaut
    // en réservé, c'est ici que ça rougit.
    expect(RESERVED_CHAMPIONS.map((champion) => champion.championId)).not.toContain(
      FIXTURE_CHAMPION.championId,
    );
    expect(reserves).not.toContain(FIXTURE_CHAMPION.displayName);
  });

  it('est le champion que porte réellement le personnage par défaut', () => {
    expect(aCharacter().championId).toBe(FIXTURE_CHAMPION.championId);
    expect(aScenePresence().name).toBe(FIXTURE_CHAMPION.displayName);
  });
});

describe('aChampionLock, la seule fixture qui nomme un réservé', () => {
  it('nomme un réservé, et c’est sa raison d’être', () => {
    const verrou = aChampionLock();

    expect(RESERVED_CHAMPIONS.map((champion) => champion.championId)).toContain(verrou.championId);
    expect(verrou.lockKind).toBe('reserved_pc');
  });

  it('mais la table par défaut n’en porte aucun, donc elle reste propre', () => {
    expect(Object.keys(aTableState().championLocks)).toStrictEqual([]);
    expect(citeUnReserve(aTableState())).toBeUndefined();
    expect(citeUnReserve(aTableState({ championLocks: [aChampionLock()] }))).toBe('Sejuani');
  });
});

describe('RESERVED_CHAMPIONS', () => {
  it('porte les quatre champions sur lesquels reposent les assertions', () => {
    expect(RESERVED_CHAMPIONS.map((champion) => champion.championId)).toStrictEqual([
      'sejuani',
      'braum',
      'lissandra',
      'ornn',
    ]);
  });

  it('porte les deux graphies de « Cœur », que la normalisation ne réunit pas', () => {
    const braum = RESERVED_CHAMPIONS.find((champion) => champion.championId === 'braum');

    expect(braum?.aliases).toContain('le Cœur du Freljord');
    expect(braum?.aliases).toContain('le Coeur du Freljord');
    expect(() => {
      expectNoReservedChampion('le Coeur du Freljord veille sur le col.', reserves);
    }).toThrow(ReservedChampionMentioned);
    expect(() => {
      expectNoReservedChampion('le Cœur du Freljord veille sur le col.', reserves);
    }).toThrow(ReservedChampionMentioned);
  });

  it('aucune entrée n’a une liste d’alias vide : le verrou repose entièrement dessus', () => {
    expect(RESERVED_CHAMPIONS.filter((champion) => champion.aliases.length === 0)).toStrictEqual(
      [],
    );
  });
});
