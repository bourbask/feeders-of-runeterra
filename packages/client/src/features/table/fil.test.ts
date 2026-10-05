import type { CharacterId, EventScope, PlayerId } from '@for/engine';
import { aCorrelationId, anEvent, anId } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { JournalLine } from '../../ws/journal.js';
import { lineOfEvent } from '../../ws/journal.js';
import type { PresenceMember } from '../../ws/store.js';
import { composerLeFil } from './fil.js';

/**
 * LES QUATRE RÈGLES DE VOISINAGE DU FIL, mesurées sans rendre une page.
 *
 * CHAQUE FIXTURE A AU MOINS DEUX BLOCS, et dans un ordre où la réponse naïve
 * est fausse : un critère qui parle de « premier d'une suite », de « ce qui
 * suit » ou de « ce qui précède » ne se mesure pas sur un élément unique
 * (mode 7). Et chaque attente est le TABLEAU EXACT, pas un `toContain`.
 *
 * ET DEUX ACTEURS, PAS UN. La première version de ce fichier ne faisait parler
 * QUE moi : les cinq cas du bloc promu étaient verts sur un code qui ne
 * regardait jamais qui parle, et le fil surlignait le bloc d'un AUTRE joueur
 * sous une phrase qui l'accusait d'avoir déclassifié. C'est le mode « deux
 * acteurs au lieu d'un » de `RECETTE.md` §5 bis, et il ne se voit pas
 * autrement : à un acteur, « celui qui parle est le destinataire » est vrai
 * sans être calculé. Toute fixture de ce fichier parle donc à une table de
 * TROIS personnes, et le bloc promu est mesuré au moins une fois pour chacune.
 */

const KEVIN = anId('player', 1);
const THEO = anId('player', 2);
const ANA = anId('player', 3);
const PERSONNAGE_DE_KEVIN = anId('character', 1);
const PERSONNAGE_DE_THEO = anId('character', 2);
const PERSONNAGE_D_ANA = anId('character', 3);

/** La table, telle que `s2c.presence` la porte : un joueur, un personnage. */
const PRESENCE: readonly PresenceMember[] = [
  { playerId: KEVIN, characterId: PERSONNAGE_DE_KEVIN, online: true, typing: false },
  { playerId: THEO, characterId: PERSONNAGE_DE_THEO, online: true, typing: false },
  { playerId: ANA, characterId: PERSONNAGE_D_ANA, online: true, typing: false },
];

const TOUR = aCorrelationId(7);
const AUTRE = aCorrelationId(8);

function prose(
  seq: number,
  deliverySeq: number,
  texte: string,
  scope: EventScope = 'table',
  destinataires: readonly PlayerId[] | null = null,
): JournalLine {
  return lineOfEvent(
    anEvent({
      seq,
      correlationId: TOUR,
      scope,
      recipients: scope === 'table' ? null : (destinataires ?? [KEVIN]),
      type: 'narration.gm_message',
      payload: {
        text: texte,
        aiCallId: anId('aicall'),
        model: 'stub',
        promptVersion: 'conteur/2.0.0',
        source: 'ai',
        citedEventSeqs: [],
      },
    }),
    deliverySeq,
  );
}

/**
 * Une parole, ET QUI LA DIT. Le personnage est un paramètre et n'a pas de
 * valeur par défaut muette : c'est le champ que le défaut du bloc promu rendait
 * invisible, et un défaut de fixture ici redevient un défaut de produit.
 */
function parole(
  seq: number,
  deliverySeq: number,
  texte: string,
  personnage: CharacterId,
  scope: EventScope = 'table',
  destinataires: readonly PlayerId[] | null = null,
): JournalLine {
  return lineOfEvent(
    anEvent({
      seq,
      correlationId: TOUR,
      scope,
      recipients: scope === 'table' ? null : (destinataires ?? [KEVIN]),
      actorKind: 'player',
      subjectCharacterId: personnage,
      type: 'narration.player_message',
      payload: { text: texte, kind: 'ic', characterId: personnage },
    }),
    deliverySeq,
  );
}

function jet(seq: number, deliverySeq: number, tour = TOUR): JournalLine {
  return lineOfEvent(
    anEvent({
      seq,
      correlationId: tour,
      type: 'roll.action_resolved',
      payload: {
        rollId: anId('roll'),
        characterId: anId('character'),
        moveId: 'face-danger',
        attribute: 'fer',
        attributeValue: 2,
        actionDie: 5,
        adds: [],
        rawTotal: 7,
        total: 7,
        cappedAtTen: false,
        challengeDice: [3, 9],
        outcome: 'partielle',
        isPresage: false,
        momentumBefore: 2,
        momentumNegated: false,
        burnWindow: true,
        rngStream: 'action',
        rngDrawIndex: 118,
      },
    }),
    deliverySeq,
  );
}

// ------------------------------------------------- l'étiquette, une fois (§2)

describe('l’étiquette de portée', () => {
  it('ouvre une suite au premier bloc, et la laisse close ensuite', () => {
    const blocs = composerLeFil(
      [
        prose(1, 1, 'public'),
        prose(2, 2, 'groupe', 'subset'),
        prose(3, 3, 'groupe encore', 'subset'),
        prose(4, 4, 'groupe toujours', 'subset'),
      ],
      PRESENCE,
    );
    expect(blocs.map((bloc) => bloc.ouvreUneSuite)).toEqual([true, true, false, false]);
  });

  it('rouvre une suite quand le GROUPE change à portée égale', () => {
    // LA RAISON D'ÊTRE DE LA CLÉ MÉCANIQUE. Deux groupes différents de suite,
    // tous deux `subset` : sans la clé, le second hériterait du bandeau du
    // premier et le lecteur croirait écrire aux mêmes gens.
    const blocs = composerLeFil(
      [
        prose(1, 1, 'au premier groupe', 'subset', [KEVIN, THEO]),
        prose(2, 2, 'au premier groupe encore', 'subset', [THEO, KEVIN]),
        prose(3, 3, 'à un autre groupe', 'subset', [THEO]),
      ],
      PRESENCE,
    );
    // Le deuxième liste les mêmes membres DANS L'AUTRE SENS : c'est la même
    // suite, et c'est ce qui prouve que la clé est triée.
    expect(blocs.map((bloc) => bloc.ouvreUneSuite)).toEqual([true, false, true]);
  });
});

// ------------------------------------------------------------ la rupture (§9)

describe('la rupture', () => {
  it('se pose au passage du public au restreint, et une seule fois', () => {
    const blocs = composerLeFil(
      [
        prose(1, 1, 'public'),
        prose(2, 2, 'groupe', 'subset'),
        prose(3, 3, 'groupe encore', 'subset'),
      ],
      PRESENCE,
    );
    expect(blocs.map((bloc) => bloc.rupture)).toEqual([false, true, false]);
  });

  it('ne se pose pas sur le tout premier bloc, même restreint', () => {
    // Rien ne s'est séparé : il n'y avait pas de bande avant.
    const blocs = composerLeFil([prose(1, 1, 'groupe', 'subset'), prose(2, 2, 'public')], PRESENCE);
    expect(blocs.map((bloc) => bloc.rupture)).toEqual([false, false]);
  });

  it('se repose si la bande se reforme puis se sépare à nouveau', () => {
    const blocs = composerLeFil(
      [prose(1, 1, 'groupe', 'subset'), prose(2, 2, 'public'), prose(3, 3, 'groupe', 'subset')],
      PRESENCE,
    );
    expect(blocs.map((bloc) => bloc.rupture)).toEqual([false, false, true]);
  });
});

// ------------------------------------------------------------- le promu (§10)

/**
 * LE BLOC PROMU EST UNE ACCUSATION NOMINATIVE, et c'est ce qui décide de la
 * forme de ces cas. La note dit « Ce joueur a répondu en public à ce que lui
 * seul avait reçu », sous son nom, devant toute la table. Elle n'est donc vraie
 * que si CELUI QUI PARLE est bien l'un des destinataires du bloc restreint
 * qu'il suit — ce que les deux portées, à elles seules, ne disent pas.
 *
 * CHAQUE CAS FAIT PARLER QUELQU'UN, ET LE NOMME. Un cas à un seul acteur est
 * vert sur une implémentation qui ne regarde jamais qui parle : c'est
 * exactement ce qui s'est produit, et le fil accusait un joueur qui n'avait
 * rien reçu.
 */
describe('le bloc promu', () => {
  it('marque la parole publique qui suit un bloc restreint, et elle seule', () => {
    const blocs = composerLeFil(
      [
        prose(1, 1, 'toi seul le sais', 'private', [KEVIN]),
        parole(2, 2, 'il y a une trappe', PERSONNAGE_DE_KEVIN),
        parole(3, 3, 'et il fait froid', PERSONNAGE_DE_KEVIN),
      ],
      PRESENCE,
    );
    // Le TROISIÈME ne l'est pas : ce qu'il suit est déjà public.
    expect(blocs.map((bloc) => bloc.promu)).toEqual([false, true, false]);
  });

  it('n’accuse PAS un joueur qui n’avait rien reçu — deux acteurs, le même fil', () => {
    // LE DÉFAUT QUE CE FICHIER NE VOYAIT PAS. Le conteur parle à Kevin seul ;
    // c'est THÉO qui parle ensuite en public, et il ne déclassifie rien du tout
    // — il n'a jamais rien reçu. Puis Kevin répond, et lui déclassifie.
    //
    // Les deux paroles ont la MÊME portée, le MÊME bloc restreint au-dessus, et
    // le même tour : la seule chose qui les sépare est QUI PARLE. Un fil à un
    // acteur ne peut pas porter cette distinction, et c'est pour ça que celui-ci
    // en a deux.
    const blocs = composerLeFil(
      [
        prose(1, 1, 'toi seul vois la trappe', 'private', [KEVIN]),
        parole(2, 2, 'j’ai froid', PERSONNAGE_DE_THEO),
        prose(3, 3, 'toi seul vois la trappe, encore', 'private', [KEVIN]),
        parole(4, 4, 'il y a une trappe sous la neige', PERSONNAGE_DE_KEVIN),
      ],
      PRESENCE,
    );
    expect(blocs.map((bloc) => bloc.promu)).toEqual([false, false, false, true]);
  });

  it('marque un membre du groupe, et pas celui qui n’en était pas', () => {
    // Trois acteurs, et le groupe n'en contient que deux. Ana parle en public
    // après un bloc adressé à Kevin ET Théo : elle n'en était pas, donc rien.
    // Théo parle ensuite après le même genre de bloc : il en était, donc la
    // marque. La §7.2 avertit pour les deux portées restreintes ; la marque
    // d'après couvre les deux, mais seulement pour qui a reçu.
    const blocs = composerLeFil(
      [
        prose(1, 1, 'à vous deux', 'subset', [KEVIN, THEO]),
        parole(2, 2, 'je n’étais pas là', PERSONNAGE_D_ANA),
        prose(3, 3, 'à vous deux, encore', 'subset', [KEVIN, THEO]),
        parole(4, 4, 'je le dis à tous', PERSONNAGE_DE_THEO),
      ],
      PRESENCE,
    );
    expect(blocs.map((bloc) => bloc.promu)).toEqual([false, false, false, true]);
  });

  it('ne marque pas le conteur, qui ne déclassifie rien : il raconte', () => {
    const blocs = composerLeFil(
      [prose(1, 1, 'toi seul', 'private', [KEVIN]), prose(2, 2, 'le vent tombe')],
      PRESENCE,
    );
    expect(blocs.map((bloc) => bloc.promu)).toEqual([false, false]);
  });

  it('ne marque pas une parole qui reste restreinte', () => {
    const blocs = composerLeFil(
      [
        prose(1, 1, 'toi seul', 'private', [KEVIN]),
        parole(2, 2, 'je te réponds tout bas', PERSONNAGE_DE_KEVIN, 'private', [KEVIN]),
      ],
      PRESENCE,
    );
    expect(blocs.map((bloc) => bloc.promu)).toEqual([false, false]);
  });

  it('n’accuse personne quand la présence ne dit pas qui est qui', () => {
    // LE DÉFAUT CHOISI, écrit comme une assertion. Sans la jointure, le client
    // ne peut pas savoir si le locuteur était destinataire — et la réponse à
    // « je ne sais pas » est le silence, pas une accusation. La même fixture
    // que le premier cas, présence vide : plus une seule marque.
    const lignes = [
      prose(1, 1, 'toi seul le sais', 'private', [KEVIN]),
      parole(2, 2, 'il y a une trappe', PERSONNAGE_DE_KEVIN),
    ];
    expect(composerLeFil(lignes, PRESENCE).map((bloc) => bloc.promu)).toEqual([false, true]);
    expect(composerLeFil(lignes, []).map((bloc) => bloc.promu)).toEqual([false, false]);
  });

  it('n’accuse personne quand le bloc restreint ne liste aucun destinataire', () => {
    // L'AUTRE MOITIÉ DE « JE NE SAIS PAS ». Une portée restreinte sans
    // `recipients` ne devrait pas arriver — mais c'est une enveloppe, elle
    // vient du réseau, et la réponse à « restreint à qui ? on ne sait pas »
    // reste le silence et non une marque posée au hasard.
    // Les DEUX façons dont l'enveloppe peut ne nommer personne : la liste vide
    // et la liste absente. Une seule des deux laisserait l'autre sans mesure.
    const vides = [
      prose(1, 1, 'restreint, mais à qui ?', 'private', []),
      lineOfEvent(
        anEvent({
          seq: 1,
          correlationId: TOUR,
          scope: 'private',
          recipients: null,
          type: 'narration.gm_message',
          payload: {
            text: 'restreint, sans liste du tout',
            aiCallId: anId('aicall'),
            model: 'stub',
            promptVersion: 'conteur/2.0.0',
            source: 'ai',
            citedEventSeqs: [],
          },
        }),
        1,
      ),
    ];

    for (const restreint of vides) {
      const blocs = composerLeFil(
        [restreint, parole(2, 2, 'il y a une trappe', PERSONNAGE_DE_KEVIN)],
        PRESENCE,
      );
      expect(blocs.map((bloc) => bloc.promu)).toEqual([false, false]);
    }
  });
});

// ------------------------------------------------- les dés mis de côté (§11)

describe('la preuve différée', () => {
  it('ne se rattache à rien tant que rien n’a suivi le jet', () => {
    const blocs = composerLeFil([prose(1, 1, 'la corde tient'), jet(2, 2)], PRESENCE);
    expect(blocs.map((bloc) => bloc.preuveDuTour)).toEqual([null]);
  });

  it('se rattache au premier bloc lisible d’APRÈS, pas à celui d’avant', () => {
    const blocs = composerLeFil(
      [prose(1, 1, 'la corde tient'), jet(2, 2), prose(3, 3, 'après')],
      PRESENCE,
    );
    expect(blocs.map((bloc) => bloc.preuveDuTour)).toEqual([null, TOUR]);
  });

  it('attend le DERNIER jet du tour, pas le premier', () => {
    // Un tour qui lance, raconte, puis relance : la preuve ne peut pas partir
    // avec le bloc du milieu, elle n'est pas complète à ce moment-là.
    const blocs = composerLeFil(
      [jet(1, 1), prose(2, 2, 'entre les deux'), jet(3, 3), prose(4, 4, 'après tout')],
      PRESENCE,
    );
    expect(blocs.map((bloc) => bloc.preuveDuTour)).toEqual([null, TOUR]);
  });

  it('n’en donne aucune à un tour qui n’a lancé aucun dé', () => {
    const blocs = composerLeFil([prose(1, 1, 'rien'), prose(2, 2, 'ne bouge')], PRESENCE);
    expect(blocs.map((bloc) => bloc.preuveDuTour)).toEqual([null, null]);
  });

  it('ne met jamais deux preuves sur le même bloc', () => {
    // Deux tours qui lancent coup sur coup, un seul bloc derrière : le second
    // attend le bloc suivant plutôt que de s'empiler sur le premier.
    const blocs = composerLeFil(
      [
        jet(1, 1),
        jet(2, 2, AUTRE),
        prose(3, 3, 'le premier après'),
        prose(4, 4, 'le second après'),
      ],
      PRESENCE,
    );
    expect(blocs.map((bloc) => bloc.preuveDuTour)).toEqual([TOUR, AUTRE]);
  });
});
