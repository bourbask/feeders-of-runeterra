/**
 * Ce qui dépasse : débit, taille de trame, battement de cœur, contre-pression.
 *
 * LES CHIFFRES DES CRITÈRES SONT ÉCRITS EN TOUTES LETTRES — six `c2s.intent`,
 * onze `c2s.why`, 65 Kio, 60 s. Ils viennent de la fiche M0-25 et de nulle
 * part ailleurs, donc les comparer à une constante du code serait les comparer
 * à eux-mêmes. Les chiffres qui viennent du protocole gelé — les codes de
 * fermeture, le seuil d'entrée — sont lus dans `@for/contracts`.
 *
 * LA DEUXIÈME DIRECTION EST TESTÉE PARTOUT : le cinquième `c2s.intent` passe,
 * le sixième non ; 65 536 octets ne ferment pas, 65 537 ferment ; 59 s ne
 * ferment pas, 60 s ferment. Une suite qui ne montrerait que le refus
 * resterait verte sur un serveur qui refuse tout.
 *
 * LA BORNE D'ENTRÉE SE MESURE SUR LES OCTETS, PAS SUR UNE TRAME VALIDE, et
 * c'est une conséquence du protocole gelé, pas un raccourci :
 * `zSpeechSayIntent.text` plafonne à 2 000 caractères, donc aucune des huit
 * trames `c2s.*` ne peut peser 64 Kio en étant valide. Le contrôle de taille
 * court de toute façon AVANT l'analyse (§5.5), et c'est là qu'on le prend :
 * au seuil la socket reste ouverte et répond `validation_failed`, au seuil + 1
 * elle ferme en 4009. Une version antérieure de cette suite rembourrait à
 * `Math.min(room, 2000)` et mesurait donc 2 Kio en annonçant 64.
 */

import { Buffer } from 'node:buffer';

import {
  WS_CLOSE_CODES,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
  WS_MAX_INCOMING_FRAME_BYTES,
  WS_RATE_LIMITS,
  WS_SOCKET_QUEUE_MAX_MESSAGES,
} from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { WS_CLOSE_HEARTBEAT_TIMEOUT } from '../../src/ws/connection.js';
import { WsRateLimiter } from '../../src/ws/handlers.js';
import { ALICE, CAMPAIGN, FakeClock, Table, anEvent, c2s } from './support/harness.test.js';

const A_MOVE = {
  type: 'move.face_danger',
  attribute: 'fer',
  description: 'Franchir le col sous la tempête',
};

describe('la limitation de débit', () => {
  it('accepte cinq `c2s.intent` en 10 s et refuse le sixième', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    for (let i = 0; i < 5; i += 1) {
      await alice.connection.receive(c2s('c2s.intent', { intent: A_MOVE }, table.nextFrameId()));
    }
    expect(alice.socket.of('s2c.error')).toHaveLength(0);
    expect(table.service.submitCalls).toBe(5);

    await alice.connection.receive(c2s('c2s.intent', { intent: A_MOVE }, table.nextFrameId()));

    expect(alice.socket.of('s2c.error')).toHaveLength(1);
    expect(alice.socket.of('s2c.error')[0]?.p['code']).toBe('rate_limited');
    // Le moteur n'a pas été sollicité par la trame refusée.
    expect(table.service.submitCalls).toBe(5);
  });

  it('ferme en 4008 au troisième dépassement', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    for (let i = 0; i < 8; i += 1) {
      await alice.connection.receive(c2s('c2s.intent', { intent: A_MOVE }, table.nextFrameId()));
    }

    expect(alice.socket.of('s2c.error')).toHaveLength(2);
    expect(alice.socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_CODES.rate_limited,
    ]);
  });

  it('accepte dix `c2s.why` en 10 s et refuse le onzième', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    for (let i = 0; i < 10; i += 1) {
      await alice.connection.receive(
        c2s('c2s.why', { correlationId: table.nextFrameId() }, table.nextFrameId()),
      );
    }
    const before = alice.socket.of('s2c.error').length;

    await alice.connection.receive(
      c2s('c2s.why', { correlationId: table.nextFrameId() }, table.nextFrameId()),
    );

    const errors = alice.socket.of('s2c.error');
    expect(errors.at(-1)?.p['code']).toBe('rate_limited');
    // Les dix premiers ont répondu « tour inconnu », pas « trop de messages ».
    expect(errors.slice(0, before).every((frame) => frame.p['code'] === 'validation_failed')).toBe(
      true,
    );
  });

  it('la fenêtre glisse : passé les 10 s, le compteur repart', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    for (let i = 0; i < 6; i += 1) {
      await alice.connection.receive(c2s('c2s.intent', { intent: A_MOVE }, table.nextFrameId()));
    }
    expect(alice.socket.of('s2c.error')).toHaveLength(1);

    table.clock.advance(10_001);
    await alice.connection.receive(c2s('c2s.intent', { intent: A_MOVE }, table.nextFrameId()));

    expect(alice.socket.of('s2c.error')).toHaveLength(1);
    expect(table.service.submitCalls).toBe(6);
  });

  it('`c2s.typing` au-delà de sa cadence est ignoré, pas refusé, et ne compte pas de faute', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    for (let i = 0; i < 20; i += 1) {
      await alice.connection.receive(
        c2s('c2s.typing', { typing: i % 2 === 0 }, table.nextFrameId()),
      );
    }

    expect(alice.socket.of('s2c.error')).toHaveLength(0);
    expect(alice.socket.closes).toStrictEqual([]);
    // Une seule présence diffusée : la première trame de la fenêtre.
    expect(alice.socket.of('s2c.presence')).toHaveLength(1);
  });

  it('les seaux viennent de la table gelée : un type sans seau passe toujours', () => {
    const limiter = new WsRateLimiter();
    const clock = new FakeClock();

    // `c2s.pong` n'a pas de seau (section 5.6) : cent battements passent.
    for (let i = 0; i < 100; i += 1) {
      expect(limiter.check('c2s.pong', clock.now())).toBe('ok');
    }
    expect(WS_RATE_LIMITS['c2s.intent'].count).toBe(5);
  });
});

describe('la taille des trames', () => {
  /**
   * LE SEUIL DE LA FICHE, ÉCRIT EN TOUTES LETTRES — « trames 64 Kio
   * entrantes ». Le constant du protocole gelé est comparé à ce nombre-là, et
   * les trames des tests sont bâties sur ce nombre-là, jamais sur le constant :
   * deux chemins, sinon la borne se comparerait à elle-même.
   */
  const SHEET_MAX_INCOMING = 64 * 1024;

  it('le seuil du protocole gelé est celui que la fiche écrit', () => {
    expect(WS_MAX_INCOMING_FRAME_BYTES).toBe(SHEET_MAX_INCOMING);
  });

  it('accepte une trame valide de bout en bout, sous le seuil', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    // AUCUNE TRAME VALIDE NE PEUT ATTEINDRE 64 Kio, et c'est mesuré ici plutôt
    // qu'affirmé : `zSpeechSayIntent.text` est borné à 2 000 caractères, donc
    // la plus grosse trame `c2s.speak` acceptable pèse quelques kilo-octets.
    // La borne d'entrée, elle, se mesure sur les OCTETS et avant toute
    // analyse — c'est le test suivant qui la prend exactement.
    const largestValid = c2s(
      'c2s.speak',
      { channel: 'ic', text: 'a'.repeat(2_000) },
      table.nextFrameId(),
    );
    expect(Buffer.byteLength(largestValid)).toBeLessThan(SHEET_MAX_INCOMING);

    await alice.connection.receive(largestValid);
    expect(alice.socket.closes).toStrictEqual([]);
    expect(table.service.submitCalls).toBe(1);

    const tooLongForTheSchema = c2s(
      'c2s.speak',
      { channel: 'ic', text: 'a'.repeat(2_001) },
      table.nextFrameId(),
    );
    await alice.connection.receive(tooLongForTheSchema);
    expect(alice.socket.closes).toStrictEqual([]);
    expect(alice.socket.of('s2c.error').at(-1)?.p['code']).toBe('validation_failed');
  });

  it('prend la borne des octets exactement : le seuil passe, le seuil + 1 ferme', async () => {
    const table = new Table();
    const atLimit = await table.join(ALICE);
    atLimit.socket.clear();

    // Exactement 65 536 octets. Ce n'est pas du JSON : le contrôle de taille
    // court AVANT l'analyse, donc une trame au seuil est refusée par le
    // protocole (`validation_failed`) et surtout PAS fermée.
    const exactly = 'x'.repeat(SHEET_MAX_INCOMING);
    expect(Buffer.byteLength(exactly)).toBe(65_536);
    await atLimit.connection.receive(exactly);

    expect(atLimit.socket.closes).toStrictEqual([]);
    expect(atLimit.socket.of('s2c.error')[0]?.p['code']).toBe('validation_failed');

    // Un octet de plus, sur une socket neuve : la fermeture.
    const overLimit = await table.join(ALICE);
    overLimit.socket.clear();
    const oneMore = 'x'.repeat(SHEET_MAX_INCOMING + 1);
    expect(Buffer.byteLength(oneMore)).toBe(65_537);
    await overLimit.connection.receive(oneMore);

    expect(overLimit.socket.of('s2c.error')).toStrictEqual([]);
    expect(overLimit.socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_CODES.payload_too_large,
    ]);
  });

  it('ferme en 4009 à 65 Kio — le chiffre du critère', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    const oversized = 'x'.repeat(65 * 1024);
    expect(Buffer.byteLength(oversized)).toBe(66_560);
    await alice.connection.receive(oversized);

    expect(alice.socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_CODES.payload_too_large,
    ]);
  });

  it('ferme sur la taille AVANT de tenter la moindre analyse', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    // Du JSON parfaitement valide, simplement trop gros : si l'ordre des
    // contrôles s'inversait, la réponse serait `validation_failed`.
    const huge = JSON.stringify({ v: 1, t: 'c2s.pong', id: table.nextFrameId(), p: {} }).replace(
      '"p":{}',
      `"p":{},"bourrage":"${'y'.repeat(65 * 1024)}"`,
    );
    await alice.connection.receive(huge);

    expect(alice.socket.of('s2c.error')).toHaveLength(0);
    expect(alice.socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_CODES.payload_too_large,
    ]);
  });
});

describe('le battement de cœur', () => {
  it('envoie un `s2c.ping` toutes les 25 s', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    table.hub.tick(table.clock.advance(WS_HEARTBEAT_INTERVAL_MS - 1));
    expect(alice.socket.of('s2c.ping')).toHaveLength(0);

    table.hub.tick(table.clock.advance(1));
    expect(alice.socket.of('s2c.ping')).toHaveLength(1);
  });

  it('ferme la connexion sans `c2s.pong` pendant 60 s, et pas avant', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);

    table.hub.tick(table.clock.advance(59_000));
    expect(alice.socket.closes).toStrictEqual([]);
    expect(alice.connection.isOpen).toBe(true);

    table.hub.tick(table.clock.advance(1_000));
    expect(alice.connection.isOpen).toBe(false);
    expect(alice.socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_HEARTBEAT_TIMEOUT,
    ]);
    expect(WS_HEARTBEAT_TIMEOUT_MS).toBe(60_000);
  });

  it('un `c2s.pong` repousse l’échéance', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);

    table.clock.advance(59_000);
    await alice.connection.receive(c2s('c2s.pong', {}, table.nextFrameId()));
    table.hub.tick(table.clock.advance(1_000));

    expect(alice.connection.isOpen).toBe(true);
  });

  it('une connexion fermée quitte la salle', async () => {
    const table = new Table();
    await table.join(ALICE);
    expect(table.hub.connectionsOf(CAMPAIGN)).toHaveLength(1);

    table.hub.tick(table.clock.advance(WS_HEARTBEAT_TIMEOUT_MS));

    expect(table.hub.connectionsOf(CAMPAIGN)).toHaveLength(0);
  });
});

describe('la contre-pression', () => {
  it('replie la file au-delà de sa borne et demande une resynchronisation', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.stalled = true;
    alice.socket.clear();

    table.hub.broadcast(
      CAMPAIGN,
      Array.from({ length: WS_SOCKET_QUEUE_MAX_MESSAGES + 5 }, (_, i) =>
        anEvent({ seq: i + 1, scope: 'table' }),
      ),
    );

    const types = alice.socket.types();
    // La borne vient de 02-mj-ia.md §6.3, reprise par `ws/codes.ts` : elle est
    // écrite en toutes lettres ici parce que l'entrée du test la dérive, et un
    // chiffre qui sert des deux côtés ne prouve rien.
    expect(WS_SOCKET_QUEUE_MAX_MESSAGES).toBe(64);
    expect(types.filter((type) => type === 's2c.event')).toHaveLength(64);
    expect(types.filter((type) => type === 's2c.resync_required')).toHaveLength(1);
  });
});
