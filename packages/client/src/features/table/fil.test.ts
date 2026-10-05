import type { EventScope, PlayerId } from '@for/engine';
import { aCorrelationId, anEvent, anId } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { JournalLine } from '../../ws/journal.js';
import { lineOfEvent } from '../../ws/journal.js';
import { composerLeFil } from './fil.js';

/**
 * LES QUATRE RÈGLES DE VOISINAGE DU FIL, mesurées sans rendre une page.
 *
 * CHAQUE FIXTURE A AU MOINS DEUX BLOCS, et dans un ordre où la réponse naïve
 * est fausse : un critère qui parle de « premier d'une suite », de « ce qui
 * suit » ou de « ce qui précède » ne se mesure pas sur un élément unique
 * (mode 7). Et chaque attente est le TABLEAU EXACT, pas un `toContain`.
 */

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
      recipients: scope === 'table' ? null : (destinataires ?? [anId('player', 1)]),
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

function parole(
  seq: number,
  deliverySeq: number,
  texte: string,
  scope: EventScope = 'table',
): JournalLine {
  return lineOfEvent(
    anEvent({
      seq,
      correlationId: TOUR,
      scope,
      recipients: scope === 'table' ? null : [anId('player', 1)],
      type: 'narration.player_message',
      payload: { text: texte, kind: 'ic' },
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
    const blocs = composerLeFil([
      prose(1, 1, 'public'),
      prose(2, 2, 'groupe', 'subset'),
      prose(3, 3, 'groupe encore', 'subset'),
      prose(4, 4, 'groupe toujours', 'subset'),
    ]);
    expect(blocs.map((bloc) => bloc.ouvreUneSuite)).toEqual([true, true, false, false]);
  });

  it('rouvre une suite quand le GROUPE change à portée égale', () => {
    // LA RAISON D'ÊTRE DE LA CLÉ MÉCANIQUE. Deux groupes différents de suite,
    // tous deux `subset` : sans la clé, le second hériterait du bandeau du
    // premier et le lecteur croirait écrire aux mêmes gens.
    const kevin = anId('player', 1);
    const theo = anId('player', 2);
    const blocs = composerLeFil([
      prose(1, 1, 'au premier groupe', 'subset', [kevin, theo]),
      prose(2, 2, 'au premier groupe encore', 'subset', [theo, kevin]),
      prose(3, 3, 'à un autre groupe', 'subset', [theo]),
    ]);
    // Le deuxième liste les mêmes membres DANS L'AUTRE SENS : c'est la même
    // suite, et c'est ce qui prouve que la clé est triée.
    expect(blocs.map((bloc) => bloc.ouvreUneSuite)).toEqual([true, false, true]);
  });
});

// ------------------------------------------------------------ la rupture (§9)

describe('la rupture', () => {
  it('se pose au passage du public au restreint, et une seule fois', () => {
    const blocs = composerLeFil([
      prose(1, 1, 'public'),
      prose(2, 2, 'groupe', 'subset'),
      prose(3, 3, 'groupe encore', 'subset'),
    ]);
    expect(blocs.map((bloc) => bloc.rupture)).toEqual([false, true, false]);
  });

  it('ne se pose pas sur le tout premier bloc, même restreint', () => {
    // Rien ne s'est séparé : il n'y avait pas de bande avant.
    const blocs = composerLeFil([prose(1, 1, 'groupe', 'subset'), prose(2, 2, 'public')]);
    expect(blocs.map((bloc) => bloc.rupture)).toEqual([false, false]);
  });

  it('se repose si la bande se reforme puis se sépare à nouveau', () => {
    const blocs = composerLeFil([
      prose(1, 1, 'groupe', 'subset'),
      prose(2, 2, 'public'),
      prose(3, 3, 'groupe', 'subset'),
    ]);
    expect(blocs.map((bloc) => bloc.rupture)).toEqual([false, false, true]);
  });
});

// ------------------------------------------------------------- le promu (§10)

describe('le bloc promu', () => {
  it('marque la parole publique qui suit un bloc restreint, et elle seule', () => {
    const blocs = composerLeFil([
      prose(1, 1, 'toi seul le sais', 'private'),
      parole(2, 2, 'il y a une trappe'),
      parole(3, 3, 'et il fait froid'),
    ]);
    // Le TROISIÈME ne l'est pas : ce qu'il suit est déjà public.
    expect(blocs.map((bloc) => bloc.promu)).toEqual([false, true, false]);
  });

  it('ne marque pas le conteur, qui ne déclassifie rien : il raconte', () => {
    const blocs = composerLeFil([prose(1, 1, 'toi seul', 'private'), prose(2, 2, 'le vent tombe')]);
    expect(blocs.map((bloc) => bloc.promu)).toEqual([false, false]);
  });

  it('marque aussi une réponse publique à un bloc de GROUPE', () => {
    // La §7.2 avertit pour les deux portées restreintes ; la marque d'après
    // suit la même fonction, donc elle couvre les deux ou aucune.
    const blocs = composerLeFil([
      prose(1, 1, 'à vous deux', 'subset'),
      parole(2, 2, 'je le dis à tous'),
    ]);
    expect(blocs.map((bloc) => bloc.promu)).toEqual([false, true]);
  });

  it('ne marque pas une parole qui reste restreinte', () => {
    const blocs = composerLeFil([
      prose(1, 1, 'toi seul', 'private'),
      parole(2, 2, 'je te réponds tout bas', 'private'),
    ]);
    expect(blocs.map((bloc) => bloc.promu)).toEqual([false, false]);
  });
});

// ------------------------------------------------- les dés mis de côté (§11)

describe('la preuve différée', () => {
  it('ne se rattache à rien tant que rien n’a suivi le jet', () => {
    const blocs = composerLeFil([prose(1, 1, 'la corde tient'), jet(2, 2)]);
    expect(blocs.map((bloc) => bloc.preuveDuTour)).toEqual([null]);
  });

  it('se rattache au premier bloc lisible d’APRÈS, pas à celui d’avant', () => {
    const blocs = composerLeFil([prose(1, 1, 'la corde tient'), jet(2, 2), prose(3, 3, 'après')]);
    expect(blocs.map((bloc) => bloc.preuveDuTour)).toEqual([null, TOUR]);
  });

  it('attend le DERNIER jet du tour, pas le premier', () => {
    // Un tour qui lance, raconte, puis relance : la preuve ne peut pas partir
    // avec le bloc du milieu, elle n'est pas complète à ce moment-là.
    const blocs = composerLeFil([
      jet(1, 1),
      prose(2, 2, 'entre les deux'),
      jet(3, 3),
      prose(4, 4, 'après tout'),
    ]);
    expect(blocs.map((bloc) => bloc.preuveDuTour)).toEqual([null, TOUR]);
  });

  it('n’en donne aucune à un tour qui n’a lancé aucun dé', () => {
    const blocs = composerLeFil([prose(1, 1, 'rien'), prose(2, 2, 'ne bouge')]);
    expect(blocs.map((bloc) => bloc.preuveDuTour)).toEqual([null, null]);
  });

  it('ne met jamais deux preuves sur le même bloc', () => {
    // Deux tours qui lancent coup sur coup, un seul bloc derrière : le second
    // attend le bloc suivant plutôt que de s'empiler sur le premier.
    const blocs = composerLeFil([
      jet(1, 1),
      jet(2, 2, AUTRE),
      prose(3, 3, 'le premier après'),
      prose(4, 4, 'le second après'),
    ]);
    expect(blocs.map((bloc) => bloc.preuveDuTour)).toEqual([TOUR, AUTRE]);
  });
});
