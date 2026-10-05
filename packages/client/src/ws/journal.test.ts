import type { GameEvent, GameEventType } from '@for/engine';
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
    'roll.oracle_resolved': anEvent({
      seq: 7,
      type: 'roll.oracle_resolved',
      payload: {
        rollId: anId('roll'),
        tableId: 'rencontres-du-col',
        tableVersion: '1.0.0',
        dieSize: 100,
        value: 73,
        entryId: 'loup-blesse',
        text: 'Un loup blessé, et personne pour l’avoir blessé.',
        tags: [],
        question: 'Qu’y a-t-il derrière la corniche ?',
      },
    }),
    'roll.yes_no_resolved': anEvent({
      seq: 8,
      type: 'roll.yes_no_resolved',
      payload: {
        rollId: anId('roll'),
        question: 'La porte est-elle gardée ?',
        likelihood: 'probable',
        threshold: 75,
        value: 42,
        answer: 'oui',
        isExtreme: false,
      },
    }),
  };

  it.each([...NARRATIVE_EVENT_TYPES])('« %s » produit bien une ligne lisible', (type) => {
    const ligne = lineOfEvent(EXEMPLES[type], 1);
    expect(ligne.kind).not.toBe('mecanique');
    expect(ligne.text).not.toBeNull();
  });

  /**
   * LA LISTE EST UNE MESURE, PAS UNE DÉCLARATION — et elle ne l'était pas.
   *
   * SONDE QUI A SERVI, mode 6 de la recette : retirer les deux oracles de
   * `NARRATIVE_EVENT_TYPES` laissait les 53 tests de ce fichier et du fil AU
   * VERT. `proseOf` leur donnait toujours leur texte, et la liste n'était plus
   * qu'un commentaire qui se trouvait compiler. Seul `typecheck:tests` —
   * c'est-à-dire le travail 4 de la CI, pas les quatre portes locales — le
   * voyait, par la clé en trop du dictionnaire ci-dessus.
   *
   * Donc : le NOM des types est écrit ici en toutes lettres, indépendamment de
   * la liste, et ce qui est comparé est « ce que la fonction rend lisible »
   * contre « ce que la liste annonce ». Vider la liste fait tomber ce test.
   */
  const TOUS: readonly (readonly [GameEventType, GameEvent])[] = [
    ['scene.started', EXEMPLES['scene.started']],
    ['scene.ended', EXEMPLES['scene.ended']],
    ['narration.gm_message', EXEMPLES['narration.gm_message']],
    ['narration.gm_failed', EXEMPLES['narration.gm_failed']],
    ['narration.player_message', EXEMPLES['narration.player_message']],
    ['system.note', EXEMPLES['system.note']],
    ['roll.oracle_resolved', EXEMPLES['roll.oracle_resolved']],
    ['roll.yes_no_resolved', EXEMPLES['roll.yes_no_resolved']],
    // Les deux mécaniques, pour que la mesure ait quelque chose à EXCLURE : une
    // comparaison dont tous les cas tombent du même côté ne mesure rien.
    [
      'character.gauge_changed',
      anEvent({
        seq: 9,
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
      }),
    ],
    [
      'move.aborted',
      anEvent({
        seq: 10,
        type: 'move.aborted',
        payload: { moveId: 'face-danger', characterId: anId('character'), reason: 'timeout' },
      }),
    ],
  ];

  it('annonce exactement les types que la fonction rend lisibles', () => {
    const lisibles = TOUS.filter(([, evenement]) => isReadable(lineOfEvent(evenement, 1))).map(
      ([type]) => type,
    );

    // La mesure trouve bien les deux bords : des lisibles ET des muets.
    expect(lisibles.length).toBeGreaterThan(0);
    expect(lisibles.length).toBeLessThan(TOUS.length);

    expect([...lisibles].sort()).toEqual([...NARRATIVE_EVENT_TYPES].sort());
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

/**
 * L'ORACLE (correction 13). Il n'est ni du récit ni de la parole, et c'est
 * pour ça qu'il a son propre `kind` : une voix de synthèse doit pouvoir le
 * laisser de côté, et un `kind` emprunté au conteur le lui rendrait invisible.
 *
 * CE QUI EST MESURÉ ICI, ET QUI N'EST PAS « il y a du texte » : la QUESTION et
 * la RÉPONSE arrivent dans DEUX champs distincts, et AUCUN des cinq nombres de
 * la charge utile n'arrive nulle part. Un oracle qui pousserait son `value` ou
 * son `threshold` dans le fil serait exactement le défaut que le §12 interdit
 * au reste du fil.
 */
describe('un oracle', () => {
  const question = anEvent({
    seq: 20,
    type: 'roll.yes_no_resolved',
    payload: {
      rollId: anId('roll'),
      question: 'La porte est-elle gardée ?',
      likelihood: 'probable',
      threshold: 75,
      value: 42,
      answer: 'non',
      isExtreme: false,
    },
  });

  it('porte sa question et sa réponse dans deux champs, pas dans une phrase', () => {
    const ligne = lineOfEvent(question, 1);
    expect(ligne.kind).toBe('oracle');
    expect(ligne.speaker).toBe('La porte est-elle gardée ?');
    expect(ligne.text).toBe('NON');
    expect(isReadable(ligne)).toBe(true);
  });

  it('est aussi un jet, donc sa preuve reste consultable', () => {
    expect(lineOfEvent(question, 1).hasRoll).toBe(true);
  });

  it('ne laisse passer aucun des nombres de sa charge utile', () => {
    // Les cinq valeurs du tirage, nommées en toutes lettres : « 75 », « 42 »,
    // la vraisemblance, l'identifiant de jet et le drapeau d'extrême.
    const serialise = JSON.stringify({ ...lineOfEvent(question, 1), seq: 0, deliverySeq: 0 });
    for (const interdit of ['75', '42', 'probable', 'isExtreme', 'rollId']) {
      expect(serialise).not.toContain(interdit);
    }
  });

  it('copie le texte de contenu tel quel quand l’oracle est une table', () => {
    const tire = anEvent({
      seq: 21,
      type: 'roll.oracle_resolved',
      payload: {
        rollId: anId('roll'),
        tableId: 'rencontres-du-col',
        tableVersion: '1.0.0',
        dieSize: 100,
        value: 73,
        entryId: 'loup-blesse',
        text: 'Un loup blessé.',
        tags: [],
        question: 'Qu’y a-t-il derrière la corniche ?',
      },
    });
    const ligne = lineOfEvent(tire, 1);
    expect(ligne.text).toBe('Un loup blessé.');
    expect(ligne.speaker).toBe('Qu’y a-t-il derrière la corniche ?');
    expect(JSON.stringify(ligne)).not.toContain('73');
  });
});
