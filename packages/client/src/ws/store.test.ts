import type { C2SMessage } from '@for/contracts';
import { aCorrelationId, aTableState, anEvent, anId } from '@for/testkit';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import {
  aTableStateDto,
  aTurnProof,
  batchFrame,
  eventFrame,
  presenceFrame,
  snapshotFrame,
  turnProofFrame,
  welcomeFrame,
} from '../test/frames.js';
import type { TableState } from './store.js';
import { createTableStore, journalLines, turnRevocation } from './store.js';

const TOUR = aCorrelationId(7);

let envoyes: C2SMessage[];
let store: StoreApi<TableState>;
let idSuivant: number;

beforeEach(() => {
  envoyes = [];
  idSuivant = 0;
  store = createTableStore({
    send: (frame) => envoyes.push(frame),
    newId: () => {
      idSuivant += 1;
      return `00000000-0000-4000-8000-${idSuivant.toString(16).padStart(12, '0')}`;
    },
    clientVersion: 'test',
  });
});

const gm = (seq: number, texte: string, correlationId: string | null = TOUR) =>
  anEvent({
    seq,
    correlationId,
    type: 'narration.gm_message',
    payload: {
      text: texte,
      aiCallId: anId('aicall'),
      model: 'stub',
      promptVersion: 'conteur/2.0.0',
      source: 'ai',
      citedEventSeqs: [],
    },
  });

const jetAvecDes = (seq: number) =>
  anEvent({
    seq,
    correlationId: TOUR,
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

// ------------------------------------------------------- trames illisibles

describe('une trame malformée', () => {
  it('ne lève rien et demande une resynchronisation', () => {
    store.getState().receive({ v: 1, t: 's2c.event', p: { event: { pas: 'un evenement' } } });

    expect(store.getState().malformedFrames).toBe(1);
    expect(store.getState().lines).toEqual([]);
    expect(envoyes.map((frame) => frame.t)).toEqual(['c2s.resume']);
  });

  it.each([null, 42, 'du texte', {}, { v: 2, t: 's2c.ping', p: {} }])(
    '« %s » est refusé sans exception',
    (charge) => {
      expect(() => {
        store.getState().receive(charge);
      }).not.toThrow();
      expect(store.getState().malformedFrames).toBe(1);
    },
  );
});

// ------------------------------------------------------------ l'instantané

describe('s2c.snapshot', () => {
  it('écrase intégralement l’état local', () => {
    store.getState().receive(welcomeFrame(0, 0));
    store.getState().receive(eventFrame(1, 1, gm(1, 'une ligne d’avant')));
    store.getState().receive(presenceFrame([{ playerId: anId('player'), characterId: null }]));
    store.getState().receive(turnProofFrame(aTurnProof({ correlationId: TOUR })));
    expect(store.getState().lines).toHaveLength(1);

    const etat = aTableStateDto({ seq: 500, characters: [] });
    store.getState().receive(snapshotFrame(etat, 500, 12));

    const apres = store.getState();
    expect(apres.table).toEqual(etat);
    expect(apres.lastSeq).toBe(500);
    expect(apres.lastDeliverySeq).toBe(12);
    // ÉCRASEMENT, PAS FUSION : rien de ce qui précédait ne survit.
    expect(apres.lines).toEqual([]);
    expect(apres.revocations).toEqual({});
    expect(apres.presence).toEqual([]);
    expect(apres.proofs).toEqual({});
    expect(apres.openProofs).toEqual([]);
  });

  it('remplace un instantané par le suivant au lieu de le compléter', () => {
    const premier = aTableStateDto({ seq: 10, clocks: [] });
    const second = aTableStateDto({ seq: 20, clocks: [], characters: [] });
    store.getState().receive(snapshotFrame(premier, 10, 1));
    store.getState().receive(snapshotFrame(second, 20, 2));

    expect(store.getState().table?.characters).toEqual([]);
    expect(store.getState().table?.seq).toBe(20);
  });
});

// ------------------------------------------------ le trou et le non-trou

describe('la reprise', () => {
  it('un trou de deliverySeq déclenche un c2s.resume depuis le dernier reçu', () => {
    store.getState().receive(eventFrame(1, 1, gm(1, 'une')));
    envoyes.length = 0;

    store.getState().receive(eventFrame(9, 4, gm(9, 'quatre')));

    const reprises = envoyes.filter((frame) => frame.t === 'c2s.resume');
    expect(reprises).toHaveLength(1);
    expect(reprises[0]).toMatchObject({ t: 'c2s.resume', p: { sinceDeliverySeq: 1 } });
  });

  it('un trou de seq SEUL ne déclenche rien — ADR 0008 : il est légitime', () => {
    // Le joueur n'était pas destinataire des seq 2 a 8 : sa livraison, elle,
    // reste dense. Surveiller `seq` ferait redemander sans fin des evenements
    // auxquels il n'a pas droit.
    store.getState().receive(eventFrame(1, 1, gm(1, 'une')));
    envoyes.length = 0;

    store.getState().receive(eventFrame(9, 2, gm(9, 'deux')));

    expect(envoyes.filter((frame) => frame.t === 'c2s.resume')).toEqual([]);
    expect(store.getState().lines).toHaveLength(2);
  });

  it('un rattrapage par lot ne duplique pas ce qui est déjà appliqué', () => {
    store.getState().receive(eventFrame(1, 1, gm(1, 'une')));
    store.getState().receive(
      batchFrame([
        { seq: 1, deliverySeq: 1, event: gm(1, 'une') },
        { seq: 2, deliverySeq: 2, event: gm(2, 'deux') },
      ]),
    );

    expect(store.getState().lines.map((ligne) => ligne.deliverySeq)).toEqual([1, 2]);
  });
});

// ------------------------------------------------------ le tour annulé

describe('system.reverted', () => {
  const annulation = (seq: number) =>
    anEvent({
      seq,
      correlationId: TOUR,
      type: 'system.reverted',
      payload: {
        targetSeqs: [412, 413, 414],
        reason: 'gm_refusal:cible_absente',
        byPlayerId: null,
      },
    });

  it('marque les trois lignes et n’en retire aucune', () => {
    store.getState().receive(eventFrame(412, 1, gm(412, 'La corde tient.')));
    store.getState().receive(eventFrame(413, 2, gm(413, 'Katla ne se lève pas.')));
    store.getState().receive(eventFrame(414, 3, gm(414, 'Le vent tombe d’un coup.')));

    store.getState().receive(eventFrame(415, 4, annulation(415)));

    const lignes = journalLines(store.getState());
    const visees = lignes.filter((ligne) => [412, 413, 414].includes(ligne.seq));

    // PRÉSENTES — c'est le point de 02-mj-ia.md 4.8.6 (b).
    expect(visees).toHaveLength(3);
    // MARQUÉES, avec leur cause lisible.
    for (const ligne of visees) {
      expect(ligne.revoked).toEqual({ bySeq: 415, reason: 'gm_refusal:cible_absente' });
      expect(ligne.text).not.toBeNull();
    }
    // Et le texte n'a pas été effacé au passage.
    expect(visees.map((ligne) => ligne.text)).toEqual([
      'La corde tient.',
      'Katla ne se lève pas.',
      'Le vent tombe d’un coup.',
    ]);
  });

  it('marque aussi une ligne arrivée APRÈS l’annulation', () => {
    store.getState().receive(eventFrame(415, 1, annulation(415)));
    store.getState().receive(eventFrame(412, 2, gm(412, 'en retard')));

    const ligne = journalLines(store.getState()).find((candidate) => candidate.seq === 412);
    expect(ligne?.revoked?.reason).toBe('gm_refusal:cible_absente');
  });

  it('le tour annulé est reconnaissable par son correlationId', () => {
    store.getState().receive(eventFrame(412, 1, gm(412, 'La corde tient.')));
    store.getState().receive(eventFrame(415, 2, annulation(415)));

    expect(turnRevocation(store.getState(), TOUR)?.bySeq).toBe(415);
    expect(turnRevocation(store.getState(), aCorrelationId(99))).toBeNull();
  });
});

// ---------------------------------------------------------- « Pourquoi ? »

describe('« Pourquoi ? »', () => {
  it('est replié au départ : aucun panneau ouvert, aucune preuve demandée', () => {
    store.getState().receive(eventFrame(412, 1, gm(412, 'La corde tient.')));
    expect(store.getState().openProofs).toEqual([]);
    expect(envoyes).toEqual([]);
  });

  it('un dépliage envoie exactement un c2s.why, et rien d’autre', () => {
    store.getState().toggleProof(TOUR);

    expect(envoyes).toHaveLength(1);
    expect(envoyes[0]).toMatchObject({ t: 'c2s.why', p: { correlationId: TOUR } });
    expect(envoyes.filter((frame) => frame.t === 'c2s.intent')).toEqual([]);
  });

  it('replier puis redéplier ne redemande pas une preuve déjà reçue', () => {
    store.getState().toggleProof(TOUR);
    store.getState().receive(turnProofFrame(aTurnProof({ correlationId: TOUR })));
    store.getState().toggleProof(TOUR);
    store.getState().toggleProof(TOUR);

    expect(envoyes.filter((frame) => frame.t === 'c2s.why')).toHaveLength(1);
  });

  it('range la preuve telle quelle, sans rien y ajouter', () => {
    const preuve = aTurnProof({ correlationId: TOUR, roll: null });
    store.getState().receive(turnProofFrame(preuve, true));

    expect(store.getState().proofs[TOUR]).toEqual({ proof: preuve, truncated: true });
  });

  it('aucun événement reçu ne fabrique une preuve', () => {
    // Le jet est dans le journal, avec ses dés. Le store n'en tire RIEN :
    // seule une trame s2c.turn_proof remplit `proofs`.
    store.getState().receive(eventFrame(413, 1, jetAvecDes(413)));

    expect(store.getState().proofs).toEqual({});
  });
});

// ------------------------------------------------------------- le reste

describe('le reste du protocole', () => {
  it('s2c.welcome renseigne la session et les deux curseurs', () => {
    store.getState().receive(welcomeFrame(500, 12));

    expect(store.getState().welcome?.contentVersion).toBe('1.0.0');
    expect(store.getState().lastSeq).toBe(500);
    expect(store.getState().lastDeliverySeq).toBe(12);
  });

  it('s2c.ping appelle un c2s.pong', () => {
    store.getState().receive({ v: 1, t: 's2c.ping', id: aCorrelationId(3), ts: 1, p: {} });
    expect(envoyes.map((frame) => frame.t)).toEqual(['c2s.pong']);
  });

  it('s2c.resync_required vide l’état et refait un hello sans curseur', () => {
    store.getState().receive(eventFrame(1, 1, gm(1, 'une')));
    store.getState().receive({
      v: 1,
      t: 's2c.resync_required',
      id: aCorrelationId(4),
      ts: 1,
      p: { reason: 'r' },
    });

    expect(store.getState().lines).toEqual([]);
    expect(envoyes.at(-1)).toMatchObject({ t: 'c2s.hello', p: { lastDeliverySeq: null } });
  });

  it('hello reprend au dernier deliverySeq connu', () => {
    store.getState().receive(welcomeFrame(9, 4));
    store.getState().hello();

    expect(envoyes.at(-1)).toMatchObject({ t: 'c2s.hello', p: { lastDeliverySeq: 4 } });
  });

  it('la présence vient du serveur, jamais d’un comptage local', () => {
    store.getState().receive(eventFrame(1, 1, gm(1, 'une')));
    expect(store.getState().presence).toEqual([]);

    store.getState().receive(presenceFrame([{ playerId: anId('player'), characterId: null }]));
    expect(store.getState().presence).toHaveLength(1);
  });

  it('le store n’a aucune autorité : aucune trame sortante ne porte d’état', () => {
    store.getState().receive(eventFrame(413, 1, jetAvecDes(413)));
    store.getState().toggleProof(TOUR);
    store.getState().hello();

    const interdits = ['c2s.intent'];
    expect(envoyes.filter((frame) => interdits.includes(frame.t))).toEqual([]);
    for (const frame of envoyes) {
      expect(JSON.stringify(frame)).not.toContain('challengeDice');
    }
  });
});

// -------------------------------------------------------- la narration

describe('le flux de narration', () => {
  const NARRATION = 'nar-412';
  const trame = (t: string, p: unknown) => ({ v: 1, t, id: aCorrelationId(5), ts: 1, p });

  it('assemble les fragments dans l’ordre reçu', () => {
    store.getState().receive(
      trame('s2c.narration_started', {
        narrationId: NARRATION,
        eventSeq: 412,
        actorCharacterId: null,
        chunk: 0,
      }),
    );
    store
      .getState()
      .receive(
        trame('s2c.narration_delta', { narrationId: NARRATION, chunk: 1, text: 'La corde ' }),
      );
    store
      .getState()
      .receive(trame('s2c.narration_delta', { narrationId: NARRATION, chunk: 2, text: 'tient.' }));

    expect(store.getState().narrations[NARRATION]?.text).toBe('La corde tient.');
    expect(store.getState().narrations[NARRATION]?.status).toBe('streaming');
  });

  it('ignore un fragment d’un flux qu’il n’a pas vu commencer', () => {
    store
      .getState()
      .receive(trame('s2c.narration_delta', { narrationId: 'inconnu', chunk: 1, text: 'x' }));
    expect(store.getState().narrations).toEqual({});
  });

  it('un instantané de narration remplace le tampon', () => {
    store.getState().receive(
      trame('s2c.narration_snapshot', {
        narrationId: NARRATION,
        chunk: 4,
        text: 'Le texte entier.',
        status: 'done',
      }),
    );
    expect(store.getState().narrations[NARRATION]?.text).toBe('Le texte entier.');
  });

  it('la fin fixe le texte et la source', () => {
    store.getState().receive(
      trame('s2c.narration_done', {
        narrationId: NARRATION,
        eventSeq: 412,
        text: 'Le vent tombe.',
        model: 'stub',
        source: 'engine',
      }),
    );
    expect(store.getState().narrations[NARRATION]).toMatchObject({
      text: 'Le vent tombe.',
      status: 'done',
    });
  });

  it('une erreur de narration marque le flux sans toucher au jeu', () => {
    store.getState().receive(
      trame('s2c.narration_started', {
        narrationId: NARRATION,
        eventSeq: 412,
        actorCharacterId: null,
        chunk: 0,
      }),
    );
    store
      .getState()
      .receive(trame('s2c.narration_error', { narrationId: NARRATION, code: 'action_impossible' }));

    expect(store.getState().narrations[NARRATION]?.status).toBe('failed');
    expect(store.getState().lines).toEqual([]);
  });
});

describe('les refus', () => {
  it('s2c.rejected retient le code, pas une phrase', () => {
    store.getState().receive({
      v: 1,
      t: 's2c.rejected',
      id: aCorrelationId(6),
      ts: 1,
      p: { intentId: aCorrelationId(2), code: 'champion_locked', message: 'x' },
    });

    expect(store.getState().lastRejection?.code).toBe('champion_locked');
  });

  it('s2c.error ne touche à rien de l’état de jeu', () => {
    store.getState().receive(eventFrame(1, 1, gm(1, 'une')));
    store.getState().receive({
      v: 1,
      t: 's2c.error',
      id: aCorrelationId(8),
      ts: 1,
      p: { code: 'internal_error', message: 'x', requestId: 'r' },
    });

    expect(store.getState().lines).toHaveLength(1);
    expect(store.getState().malformedFrames).toBe(0);
  });
});

describe('les fixtures', () => {
  it('l’état projeté est bien celui du testkit', () => {
    const state = aTableState();
    const dto = aTableStateDto();
    expect(dto.characters).toHaveLength(Object.keys(state.characters).length);
    expect(dto).not.toHaveProperty('rng');
  });
});
