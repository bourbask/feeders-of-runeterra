import type { GameEvent } from '@for/engine';
import { GAME_EVENT_TYPES } from '@for/engine';
import { anEvent, anId } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { NarrativeEventType } from './journal.js';
import { NARRATIVE_EVENT_TYPES, isReadable, lineOfEvent } from './journal.js';

/**
 * LA LISTE DES CHAMPS EST ÉCRITE EN TOUTES LETTRES, pas lue sur l'objet qu'elle
 * vérifie. Comparer `Object.keys(ligne)` a lui-meme passerait toujours ;
 * ajouter un champ `roll` a `JournalLine` doit rendre ce test rouge.
 */
const CHAMPS_ATTENDUS = [
  'correlationId',
  'deliverySeq',
  'hasRoll',
  'kind',
  'recipients',
  'revoked',
  'scope',
  'seq',
  'speaker',
  'text',
];

describe('la ligne de journal', () => {
  it('n’a que dix champs, et aucun ne peut porter un chiffre de jeu', () => {
    const ligne = lineOfEvent(anEvent({ seq: 1 }), 1);
    expect(Object.keys(ligne).sort()).toEqual(CHAMPS_ATTENDUS);
  });

  it('recopie la portée de l’enveloppe, et n’en décide aucune', () => {
    // ADR 0008 : c'est le SERVEUR qui renseigne `scope` et `recipients`. Le
    // client les relit pour dessiner le rail du §5.2 ; il ne les calcule pas,
    // et il ne filtre rien avec.
    const destinataires = [anId('player', 1), anId('player', 2)];
    const ligne = lineOfEvent(anEvent({ seq: 2, scope: 'subset', recipients: destinataires }), 2);
    expect(ligne.scope).toBe('subset');
    expect(ligne.recipients).toEqual(destinataires);
  });

  it('marque un jet comme un jet, et une prose comme pas un jet', () => {
    // Les deux sens : « tout est un jet » et « rien n'est un jet » passeraient
    // chacun la moitié de cette assertion.
    const unJet = lineOfEvent(
      anEvent({
        seq: 3,
        type: 'roll.yes_no_resolved',
        payload: {
          rollId: anId('roll'),
          question: 'Est-elle encore là ?',
          likelihood: 'probable',
          threshold: 75,
          value: 42,
          answer: 'oui',
          isExtreme: false,
        },
      }),
      3,
    );
    expect(unJet.hasRoll).toBe(true);
    expect(lineOfEvent(anEvent({ seq: 4 }), 4).hasRoll).toBe(false);
  });

  it('les types narratifs existent tous dans le catalogue du moteur', () => {
    // La source de la boucle est la liste d'ici ; la reference est celle du
    // moteur. Un type renomme en amont rend ce test rouge.
    for (const type of NARRATIVE_EVENT_TYPES) {
      expect(GAME_EVENT_TYPES).toContain(type);
    }
  });
});

/**
 * L'AUTRE SENS, et c'est celui qui mord. `proseOf` repond « mecanique » par
 * defaut : sans ce test, retirer une branche de la chaine ferait disparaitre
 * une ligne du fil sans qu'aucune porte ne bronche, et `NARRATIVE_EVENT_TYPES`
 * continuerait a l'annoncer.
 */
describe('la liste des types narratifs et la fonction disent la même chose', () => {
  const EXEMPLES: Readonly<Record<NarrativeEventType, GameEvent>> = {
    'scene.started': anEvent({
      seq: 1,
      type: 'scene.started',
      payload: {
        sceneId: anId('scene'),
        title: 'Le col',
        entityIds: [],
        presentCharacterIds: [],
      },
    }),
    'scene.ended': anEvent({
      seq: 2,
      type: 'scene.ended',
      payload: { sceneId: anId('scene'), outcome: 'la tempête passe' },
    }),
    'narration.gm_message': anEvent({
      seq: 3,
      type: 'narration.gm_message',
      payload: {
        text: 'Le vent tombe.',
        aiCallId: anId('aicall'),
        model: 'stub',
        promptVersion: 'conteur/2.0.0',
        source: 'ai',
        citedEventSeqs: [],
      },
    }),
    'narration.gm_failed': anEvent({
      seq: 4,
      type: 'narration.gm_failed',
      payload: { errorKind: 'api_error', fallbackText: 'Le silence retombe.' },
    }),
    'narration.player_message': anEvent({
      seq: 5,
      type: 'narration.player_message',
      payload: { text: 'Je tends la corde.', kind: 'ic' },
    }),
    'system.note': anEvent({
      seq: 6,
      type: 'system.note',
      payload: { text: 'Pause.', byPlayerId: anId('player') },
    }),
  };

  it.each([...NARRATIVE_EVENT_TYPES])('« %s » produit bien une ligne lisible', (type) => {
    const ligne = lineOfEvent(EXEMPLES[type], 1);
    expect(ligne.kind).not.toBe('mecanique');
    expect(ligne.text).not.toBeNull();
  });
});

describe('un événement mécanique', () => {
  const jet = anEvent({
    seq: 413,
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
  });

  const jauge = anEvent({
    seq: 414,
    type: 'character.gauge_changed',
    payload: {
      characterId: anId('character'),
      gauge: 'vigueur',
      delta: -1,
      from: 5,
      to: 4,
      clamped: false,
      cause: 'prix',
    },
  });

  it.each([
    ['roll.action_resolved', jet],
    ['character.gauge_changed', jauge],
  ])('« %s » ne porte aucun texte dans le fil', (_nom, evenement) => {
    const ligne = lineOfEvent(evenement, 1);
    expect(ligne.kind).toBe('mecanique');
    expect(ligne.text).toBeNull();
    expect(isReadable(ligne)).toBe(false);
  });

  it('les valeurs du jet ne se retrouvent nulle part sur la ligne', () => {
    const ligne = lineOfEvent(jet, 1);
    const serialise = JSON.stringify({ ...ligne, seq: 0, deliverySeq: 0 });
    for (const valeur of ['"action"', '118', 'partielle', 'face-danger']) {
      expect(serialise).not.toContain(valeur);
    }
  });
});

describe('un événement narratif', () => {
  it('porte sa prose et le tour auquel il appartient', () => {
    const evenement = anEvent({
      seq: 12,
      type: 'narration.player_message',
      payload: { text: 'Je tends la corde.', kind: 'ic' },
    });
    const ligne = lineOfEvent(evenement, 3);

    expect(ligne.kind).toBe('joueur');
    expect(ligne.text).toBe('Je tends la corde.');
    expect(ligne.correlationId).not.toBeNull();
    expect(isReadable(ligne)).toBe(true);
  });

  it('une scène affiche son titre, pas son identifiant', () => {
    const evenement = anEvent({
      seq: 5,
      type: 'scene.started',
      payload: {
        sceneId: anId('scene'),
        title: 'Le col battu par la tempête',
        entityIds: [],
        presentCharacterIds: [],
      },
    });
    const ligne = lineOfEvent(evenement, 1);

    expect(ligne.text).toBe('Le col battu par la tempête');
    expect(ligne.text).not.toContain('0SCENE');
  });
});
