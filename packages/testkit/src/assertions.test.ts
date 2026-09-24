/**
 * Ce fichier ne vérifie pas que les assertions PASSENT. Il vérifie qu'elles
 * REFUSENT — et chaque refus est mesuré à côté du cas propre correspondant,
 * parce qu'une assertion qui refuse tout ne vaut pas mieux qu'une qui accepte
 * tout. Dans les deux sens, à chaque fois.
 */
import type { CharacterState } from '@for/engine';
import { describe, expect, it } from 'vitest';

import {
  InvalidTableState,
  ReservedChampionMentioned,
  SeqNotContiguous,
  expectNoReservedChampion,
  expectSeqContiguous,
  expectValidState,
  normaliseChampionName,
} from './assertions.js';
import { RESERVED_CHAMPIONS, reservedChampionNames } from './fixtures/champions.js';
import { aCharacter } from './fixtures/characters.js';
import { anEvent } from './fixtures/events.js';
import { anId } from './fixtures/ids.js';
import { aChampionLock, aClock, aTableState, aTrack, anEntity } from './fixtures/table.js';

/**
 * Rend l'erreur levée, ou `undefined`. Existe pour que les `expect` restent
 * HORS d'un `catch` : une assertion à l'intérieur d'un `catch` ne s'exécute
 * pas quand rien n'est levé, et le test passe alors sans avoir rien vérifié —
 * exactement le vert menteur que ce paquet sert à empêcher.
 */
function capture(action: () => void): unknown {
  try {
    action();
  } catch (erreur) {
    return erreur;
  }
  return undefined;
}

describe('expectValidState', () => {
  it('accepte l’état du constructeur, et rend l’état analysé', () => {
    const etat = expectValidState(aTableState());

    expect(etat.campaignId).toBe(anId('campaign'));
  });

  it('refuse un champ manquant, en nommant le chemin', () => {
    const ampute = Object.fromEntries(
      Object.entries(aTableState()).filter(([cle]) => cle !== 'seq'),
    );

    const erreur = capture(() => {
      expectValidState(ampute);
    });

    expect(erreur).toBeInstanceOf(InvalidTableState);
    expect((erreur as InvalidTableState).issues.join('\n')).toContain('seq');
  });

  it('refuse une jauge hors bornes — la validation de valeur mord, pas seulement celle de forme', () => {
    const horsBornes = aTableState({
      characters: [aCharacter({ gauges: { vigueur: 9, ame: 5, vivres: 5 } })],
    });

    expect(() => {
      expectValidState(horsBornes);
    }).toThrow(InvalidTableState);
  });

  it('refuse un jeu de jauges incomplet', () => {
    const incomplet = aTableState({
      // `zGaugeSet` exige les trois : un jeu partiel est refusé.
      characters: [aCharacter({ gauges: { vigueur: 5, ame: 5 } as CharacterState['gauges'] })],
    });

    expect(() => {
      expectValidState(incomplet);
    }).toThrow(InvalidTableState);
  });

  it('refuse un personnage classé sous une clé qui n’est pas son id — ce que le schéma laisse passer', () => {
    const personnage = aCharacter();
    const menteur = {
      ...aTableState(),
      characters: { [anId('character', 42)]: personnage },
    };

    // Le schéma seul accepte : les deux côtés sont des ULID valides.
    expect(() => {
      expectValidState({ ...menteur, characters: {} });
    }).not.toThrow();
    expect(() => {
      expectValidState(menteur);
    }).toThrow(/classé sous une clé qui n’est pas son id/);
  });

  /**
   * Le contrôle clé/identifiant porte sur CINQ collections. Quatre d'entre
   * elles n'étaient mesurées par rien : supprimer leur appel à `keysMatchIds`
   * laissait la suite verte. Un garde-fou supprimable en silence est absent.
   *
   * Chaque ligne porte son cas propre à côté de son cas sali : une assertion
   * qui refuse tout ne vaut pas mieux qu'une qui accepte tout.
   */
  describe('le contrôle clé/identifiant tient sur les CINQ collections', () => {
    const table = aTableState({
      characters: [aCharacter()],
      tracks: [aTrack()],
      clocks: [aClock()],
      entities: [anEntity()],
      championLocks: [aChampionLock()],
    });

    /** Reclasse l'unique entrée de `collection` sous `fausseCle`. */
    function reclasse(collection: keyof typeof table, fausseCle: string): unknown {
      const entrees = Object.values(table[collection] as Record<string, unknown>);
      return { ...table, [collection]: { [fausseCle]: entrees[0] } };
    }

    const cas = [
      ['characters', anId('character', 42), 'id'],
      ['tracks', anId('track', 42), 'id'],
      ['clocks', anId('clock', 42), 'id'],
      ['entities', anId('entity', 42), 'id'],
      ['championLocks', 'lissandra', 'championId'],
    ] as const;

    it('accepte la table propre, dont les cinq collections sont peuplées', () => {
      expect(() => {
        expectValidState(table);
      }).not.toThrow();
    });

    it.each(cas)(
      'refuse une entrée de %s classée sous une clé étrangère',
      (collection, fausseCle, champ) => {
        const erreur = capture(() => {
          expectValidState(reclasse(collection, fausseCle));
        });

        expect(erreur).toBeInstanceOf(InvalidTableState);
        expect((erreur as InvalidTableState).issues).toStrictEqual([
          expect.stringContaining(`${collection}.${fausseCle}`) as unknown as string,
        ]);
        // Le nom du champ comparé fait partie du garde-fou : `championLocks` est
        // la seule collection classée sur autre chose qu'`id`, et une faute de
        // frappe sur ce nom n'était rattrapée par rien.
        expect((erreur as InvalidTableState).issues[0]).toContain(`n’est pas son ${champ}`);
      },
    );

    it.each(cas)('et accepte la même entrée classée sous sa propre clé (%s)', (collection) => {
      expect(() => {
        expectValidState({ ...table, [collection]: table[collection] });
      }).not.toThrow();
    });
  });

  it('refuse un propriétaire de bande qui n’est pas membre', () => {
    const table = aTableState();
    const orphelin = {
      ...table,
      party: { memberPlayerIds: [anId('player', 2)], ownerPlayerId: anId('player', 3) },
    };

    expect(() => {
      expectValidState(orphelin);
    }).toThrow(/ownerPlayerId/);
    expect(() => {
      expectValidState({
        ...table,
        party: { memberPlayerIds: [anId('player', 3)], ownerPlayerId: anId('player', 3) },
      });
    }).not.toThrow();
  });

  it('refuse une valeur qui n’est pas un objet', () => {
    for (const valeur of [null, 42, 'un état', []]) {
      expect(() => {
        expectValidState(valeur);
      }).toThrow(InvalidTableState);
    }
  });
});

describe('expectSeqContiguous', () => {
  const journal = [anEvent({ seq: 1 }), anEvent({ seq: 2 }), anEvent({ seq: 3 })];

  it('accepte une suite dense à partir de 1', () => {
    expect(() => {
      expectSeqContiguous(journal);
    }).not.toThrow();
  });

  it('détecte un trou introduit volontairement, et dit où', () => {
    const troue = [journal[0], journal[1], anEvent({ seq: 5 })].filter((e) => e !== undefined);

    const erreur = capture(() => {
      expectSeqContiguous(troue);
    });

    expect(erreur).toBeInstanceOf(SeqNotContiguous);
    expect((erreur as SeqNotContiguous).index).toBe(2);
    expect((erreur as SeqNotContiguous).expected).toBe(3);
    expect((erreur as SeqNotContiguous).found).toBe(5);
  });

  it('détecte un doublon et un pas en arrière', () => {
    expect(() => {
      expectSeqContiguous([anEvent({ seq: 1 }), anEvent({ seq: 1 })]);
    }).toThrow(SeqNotContiguous);
    expect(() => {
      expectSeqContiguous([anEvent({ seq: 1 }), anEvent({ seq: 3 }), anEvent({ seq: 2 })]);
    }).toThrow(SeqNotContiguous);
  });

  it('refuse une liste vide : elle n’a pas de trou et passerait toujours', () => {
    expect(() => {
      expectSeqContiguous([]);
    }).toThrow(SeqNotContiguous);
    expect(() => {
      expectSeqContiguous([], { allowEmpty: true });
    }).not.toThrow();
  });

  it('une tranche de journal se vérifie avec « from »', () => {
    const tranche = [anEvent({ seq: 7 }), anEvent({ seq: 8 })];

    expect(() => {
      expectSeqContiguous(tranche, { from: 7 });
    }).not.toThrow();
    expect(() => {
      expectSeqContiguous(tranche);
    }).toThrow(SeqNotContiguous);
  });
});

describe('expectNoReservedChampion', () => {
  const reserves = reservedChampionNames();

  it('laisse passer une narration qui ne cite personne', () => {
    expect(() => {
      expectNoReservedChampion('Le vent tombe, la crête se découvre, la neige craque.', reserves);
    }).not.toThrow();
  });

  it('détecte un ALIAS, pas seulement le nom d’affichage', () => {
    // « Sejuani » n'apparaît nulle part dans cette phrase.
    const narration = 'Au bout du col, la Griffe de Givre attend, immobile.';

    expect(narration).not.toContain('Sejuani');

    const erreur = capture(() => {
      expectNoReservedChampion(narration, reserves);
    });

    expect(erreur).toBeInstanceOf(ReservedChampionMentioned);
    expect((erreur as ReservedChampionMentioned).matched).toBe('la Griffe de Givre');
  });

  it('détecte le nom d’affichage aussi', () => {
    expect(() => {
      expectNoReservedChampion('Sejuani descend du col.', reserves);
    }).toThrow(ReservedChampionMentioned);
  });

  it('« LA GRIFFE-DE-GIVRE » et « la griffe de givre » sont le même alias', () => {
    expect(normaliseChampionName('LA GRIFFE-DE-GIVRE')).toBe(
      normaliseChampionName('la griffe de givre'),
    );
    for (const graphie of [
      'LA GRIFFE-DE-GIVRE',
      'la griffe de givre',
      'La   Griffe—de—Givre',
      'la Griffe De Givre',
    ]) {
      expect(() => {
        expectNoReservedChampion(`Et là, ${graphie}.`, reserves);
      }).toThrow(ReservedChampionMentioned);
    }
  });

  it('les accents ne protègent rien', () => {
    expect(() => {
      expectNoReservedChampion('la Sorciere de Glace passe', reserves);
    }).toThrow(ReservedChampionMentioned);
  });

  it('ne se déclenche pas sur un mot qui contient le nom — la frontière de mot tient', () => {
    expect(() => {
      expectNoReservedChampion('Braumont domine la vallée.', reserves);
    }).not.toThrow();
    expect(() => {
      expectNoReservedChampion('Le givre couvre la pierre.', reserves);
    }).not.toThrow();
  });

  it('prend sa liste en argument : une campagne peut n’en réserver qu’un', () => {
    const seulOrnn = reservedChampionNames(
      RESERVED_CHAMPIONS.filter((champion) => champion.championId === 'ornn'),
    );

    expect(() => {
      expectNoReservedChampion('Sejuani descend du col.', seulOrnn);
    }).not.toThrow();
    expect(() => {
      expectNoReservedChampion('le Feu sous la Montagne gronde.', seulOrnn);
    }).toThrow(ReservedChampionMentioned);
  });

  it('refuse une liste réservée vide : chercher zéro nom ne trouve jamais rien', () => {
    expect(() => {
      expectNoReservedChampion('Sejuani descend du col.', []);
    }).toThrow(RangeError);
  });

  it('refuse un nom qui se normalise en chaîne vide', () => {
    expect(() => {
      expectNoReservedChampion('peu importe', ['  ']);
    }).toThrow(RangeError);
  });
});
