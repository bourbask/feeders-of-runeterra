import { aCharacter, anId } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import { aTableStateDto } from '../../test/frames.js';
import type { PresenceMember } from '../../ws/store.js';
import {
  cleDeGroupe,
  enumerer,
  groupeDe,
  joueurDuPersonnage,
  nomDuPersonnage,
  phraseDesManquants,
  phraseDuGroupe,
} from './destinataires.js';

/**
 * QUI LIT CE MESSAGE — les noms quand ils existent, l'identifiant mécanique
 * toujours (correction 8, et la remarque du porteur du 5 octobre).
 *
 * CE QUE CE FICHIER MESURE, ET QUI N'EST PAS « ça rend une chaîne » :
 *
 *   - le CLIENT NE FABRIQUE AUCUN NOM. Un destinataire que la jointure manque
 *     n'a pas de nom, et la phrase le dit.
 *   - la CLÉ EST STABLE : le même groupe, listé dans l'autre sens, donne la
 *     MÊME clé. Une fixture à un seul destinataire, ou déjà triée, ne mesure
 *     rien de ce critère (mode 7) — toutes celles d'ici ont au moins deux
 *     membres et sont écrites dans l'ordre NON naturel.
 *   - la CLÉ DISTINGUE : deux groupes différents n'ont jamais la même.
 */

const JOUEUR_1 = anId('player', 1);
const JOUEUR_2 = anId('player', 2);
const JOUEUR_3 = anId('player', 3);
const PERSO_1 = anId('character', 1);
const PERSO_2 = anId('character', 2);

function presence(...membres: readonly { id: string; perso: string | null }[]): PresenceMember[] {
  return membres.map((membre) => ({
    playerId: membre.id,
    characterId: membre.perso,
    online: true,
    typing: false,
  }));
}

/** Un instantané où deux personnages portent un nom affichable. */
function instantane() {
  return aTableStateDto({
    characters: [
      aCharacter({ id: PERSO_1, displayName: 'Kevin' }),
      aCharacter({ id: PERSO_2, playerId: anId('player', 2), displayName: 'Théo' }),
    ],
  });
}

describe('la clé mécanique d’un groupe', () => {
  it('ne dépend pas de l’ordre dans lequel le serveur a listé les membres', () => {
    // DEUX MEMBRES, DANS L'ORDRE INVERSE. À un seul membre, « l'ordre ne
    // compte pas » est vrai de n'importe quelle implémentation.
    expect(cleDeGroupe([JOUEUR_2, JOUEUR_1])).toBe(cleDeGroupe([JOUEUR_1, JOUEUR_2]));
  });

  it('ne dépend pas d’un doublon', () => {
    expect(cleDeGroupe([JOUEUR_1, JOUEUR_2, JOUEUR_1])).toBe(cleDeGroupe([JOUEUR_1, JOUEUR_2]));
  });

  it('change dès que la composition change, et c’est sa limite', () => {
    // C'EST LA PROPRIÉTÉ ET C'EST LE DÉFAUT, et il vaut mieux l'écrire ici que
    // de le découvrir en jeu : la clé suit la COMPOSITION. Un départ fait un
    // nouveau groupe aux yeux du client. Une clé qui survivrait à un départ
    // doit être frappée par le serveur — c'est l'issue 116.
    const trois = cleDeGroupe([JOUEUR_1, JOUEUR_2, JOUEUR_3]);
    const deux = cleDeGroupe([JOUEUR_1, JOUEUR_2]);
    expect(trois).not.toBe(deux);
  });

  it('a la forme annoncée, pour que l’écran puisse la montrer', () => {
    expect(cleDeGroupe([JOUEUR_1, JOUEUR_2])).toMatch(/^g-[\da-z]{6}$/u);
  });
});

describe('les noms d’un groupe', () => {
  it('joint la présence et l’instantané, et ne fabrique rien', () => {
    const groupe = groupeDe(
      [JOUEUR_2, JOUEUR_1],
      presence({ id: JOUEUR_1, perso: PERSO_1 }, { id: JOUEUR_2, perso: PERSO_2 }),
      instantane(),
    );
    // Le TABLEAU EXACT, dans l'ordre de la clé : deux noms, pas « au moins un ».
    expect(groupe.noms).toEqual(['Kevin', 'Théo']);
    expect(groupe.sansNom).toBe(0);
    expect(phraseDuGroupe(groupe)).toBe('vous 2 — Kevin et Théo');
    expect(phraseDesManquants(groupe)).toBeNull();
  });

  it('compte ce qu’il ne sait pas nommer plutôt que d’écrire un identifiant', () => {
    const groupe = groupeDe(
      [JOUEUR_1, JOUEUR_3],
      presence({ id: JOUEUR_1, perso: PERSO_1 }, { id: JOUEUR_3, perso: null }),
      instantane(),
    );
    expect(groupe.noms).toEqual(['Kevin']);
    expect(groupe.sansNom).toBe(1);
    // LE COMPTE RESTE JUSTE : « vous 2 » même si un seul nom est connu. Dire
    // « vous 1 » serait mentir sur qui lit.
    expect(phraseDuGroupe(groupe)).toBe('vous 2 — Kevin');
    expect(phraseDesManquants(groupe)).toMatch(/le nom d’un destinataire manque/u);
    // Et l'identifiant du joueur n'est passé dans AUCUNE des deux phrases.
    expect(phraseDuGroupe(groupe)).not.toContain(JOUEUR_3);
    expect(phraseDesManquants(groupe) ?? '').not.toContain(JOUEUR_3);
  });

  it('n’invente aucun nom quand l’instantané n’est pas encore arrivé', () => {
    const groupe = groupeDe(
      [JOUEUR_1, JOUEUR_2],
      presence({ id: JOUEUR_1, perso: PERSO_1 }, { id: JOUEUR_2, perso: PERSO_2 }),
      null,
    );
    expect(groupe.noms).toEqual([]);
    expect(groupe.sansNom).toBe(2);
    expect(phraseDuGroupe(groupe)).toBe('vous 2');
    expect(phraseDesManquants(groupe)).toMatch(/le nom de 2 destinataires manque/u);
  });
});

describe('l’énumération', () => {
  it.each([
    [[], ''],
    [['Kevin'], 'Kevin'],
    [['Kevin', 'Théo'], 'Kevin et Théo'],
    [['Kevin', 'Théo', 'Ana'], 'Kevin, Théo et Ana'],
  ])('%j se dit « %s »', (noms, attendu) => {
    expect(enumerer(noms)).toBe(attendu);
  });
});

describe('la jointure, dans les deux sens', () => {
  /**
   * LES DEUX MOITIÉS DU MÊME CHEMIN. Le protocole dit `playerId` d'un côté
   * (les destinataires d'une enveloppe, ADR 0008) et `characterId` de l'autre
   * (le locuteur d'une ligne, `ws/journal.ts`) ; la présence est la seule
   * chose qui porte les deux. L'écran a besoin du sens personnage → nom pour
   * écrire qui parle, et du sens personnage → joueur pour savoir si celui qui
   * parle était destinataire (`fil.ts`, correction 10).
   *
   * CHAQUE CAS A DEUX PERSONNAGES : à un seul, « trouve le bon » est vrai de
   * n'importe quelle implémentation, y compris « rends toujours le premier ».
   */
  it('nomme un personnage de l’instantané, et rend null quand il n’y est pas', () => {
    const etat = instantane();
    expect(nomDuPersonnage(PERSO_1, etat)).toBe('Kevin');
    expect(nomDuPersonnage(PERSO_2, etat)).toBe('Théo');
    expect(nomDuPersonnage(anId('character', 9), etat)).toBeNull();
    expect(nomDuPersonnage(null, etat)).toBeNull();
    expect(nomDuPersonnage(PERSO_1, null)).toBeNull();
  });

  it('retrouve le joueur derrière un personnage, et personne quand la présence ne le porte pas', () => {
    const presents = presence(
      { id: JOUEUR_1, perso: PERSO_1 },
      { id: JOUEUR_2, perso: PERSO_2 },
      { id: JOUEUR_3, perso: null },
    );
    expect(joueurDuPersonnage(PERSO_2, presents)).toBe(JOUEUR_2);
    expect(joueurDuPersonnage(PERSO_1, presents)).toBe(JOUEUR_1);
    expect(joueurDuPersonnage(anId('character', 9), presents)).toBeNull();
    // `null` ne doit PAS tomber sur le joueur sans personnage : deux absences
    // ne sont pas une correspondance, et c'est l'erreur facile à écrire ici.
    expect(joueurDuPersonnage(null, presents)).toBeNull();
    expect(joueurDuPersonnage(PERSO_1, [])).toBeNull();
  });
});
