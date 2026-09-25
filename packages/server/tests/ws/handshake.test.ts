/**
 * Who may open a socket, and what `c2s.hello` answers.
 *
 * THE CLOSE CODES ARE READ FROM `WS_CLOSE_CODES`, NOT WRITTEN OUT. The numbers
 * 4001-4009 come from 01-architecture.md section 5.5, which `@for/contracts`
 * already mirrors; spelling `4002` here would compare a number to a copy of
 * itself living two files away. What IS written out is the ASSOCIATION — "no
 * session means unauthenticated" — because that is what the acceptance
 * criterion states and it exists nowhere else in machine-readable form.
 */

import { WS_CLOSE_CODES } from '@for/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { ALICE, BOB, Table, anEvent, c2s } from './support/harness.test.js';

describe('la poignée de main', () => {
  let table: Table;

  beforeEach(() => {
    table = new Table();
  });

  it('ferme en 4002 une connexion sans session valide', async () => {
    const { connection, socket } = await table.connect(null);

    expect(connection).toBeNull();
    expect(socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_CODES.unauthenticated,
    ]);
    expect(socket.sent).toStrictEqual([]);
  });

  it("répond 4002 avant 4004 : l'identité passe avant la ressource", async () => {
    const { socket } = await table.connect(null, null);

    expect(socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_CODES.unauthenticated,
    ]);
  });

  it('ferme en 4003 une campagne interdite', async () => {
    table.access.verdict = 'forbidden';
    const { connection, socket } = await table.connect(ALICE);

    expect(connection).toBeNull();
    expect(socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_CODES.forbidden_campaign,
    ]);
  });

  it('ferme en 4004 une campagne inconnue, et une absence de campagne', async () => {
    table.access.verdict = 'not_found';
    const refused = await table.connect(ALICE);
    expect(refused.socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_CODES.campaign_not_found,
    ]);

    table.access.verdict = 'ok';
    const nameless = await table.connect(ALICE, null);
    expect(nameless.socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_CODES.campaign_not_found,
    ]);
  });

  it('ferme en 4001 une trame dont le `v` diffère', async () => {
    const { connection, socket } = await table.join(ALICE);
    socket.clear();

    await connection.receive(
      JSON.stringify({ v: 999, t: 'c2s.pong', id: table.nextFrameId(), p: {} }),
    );

    expect(socket.closes.map((close) => close.code)).toStrictEqual([
      WS_CLOSE_CODES.protocol_version,
    ]);
    expect(socket.types()).toStrictEqual([]);
  });

  it("refuse une trame qui n'est pas du JSON, sans fermer la socket", async () => {
    const { connection, socket } = await table.join(ALICE);
    socket.clear();

    await connection.receive('{ pas du json');

    expect(socket.closes).toStrictEqual([]);
    expect(socket.types()).toStrictEqual(['s2c.error']);
    expect(socket.of('s2c.error')[0]?.p['code']).toBe('validation_failed');
  });

  it('refuse une trame du bon `v` qui ne respecte aucune des huit formes', async () => {
    const { connection, socket } = await table.join(ALICE);
    socket.clear();

    await connection.receive(
      c2s('c2s.intent', { intent: { type: 'ceci-nexiste-pas' } }, table.nextFrameId()),
    );

    expect(socket.closes).toStrictEqual([]);
    expect(socket.of('s2c.error')[0]?.p['code']).toBe('validation_failed');
  });
});

describe('`c2s.hello`', () => {
  it('répond accueil, puis rattrapage ou instantané, puis présence — dans cet ordre', async () => {
    const table = new Table();
    const { socket } = await table.join(ALICE);

    const types = socket.types();
    expect(types[0]).toBe('s2c.welcome');
    expect(['s2c.events_batch', 's2c.snapshot']).toContain(types[1]);
    expect(types[2]).toBe('s2c.presence');
    expect(types).toHaveLength(3);
  });

  it('envoie un instantané quand le curseur est absent, un rattrapage quand il existe', async () => {
    const table = new Table();
    table.service.commit([
      anEvent({ seq: 1, scope: 'table' }),
      anEvent({ seq: 2, scope: 'table' }),
    ]);

    const first = await table.join(ALICE, null);
    expect(first.socket.types()[1]).toBe('s2c.snapshot');

    // `zC2SHello.lastDeliverySeq` est `zDeliverySeq.nullable()`, donc POSITIF
    // ou nul au sens de `null` : « je n'ai rien reçu » s'écrit `null` ici et
    // `0` sur `c2s.resume`, qui porte `zDeliveryCursor`. Deux curseurs, deux
    // schémas, et la nuance est dans le protocole gelé, pas ici.
    const second = await table.join(BOB, 1);
    expect(second.socket.types()[1]).toBe('s2c.events_batch');
    const batch = second.socket.of('s2c.events_batch')[0]?.p['events'] as { seq: number }[];
    expect(batch.map((entry) => entry.seq)).toStrictEqual([2]);
  });

  it('porte les deux curseurs sur `s2c.welcome` : celui du journal et celui de la livraison', async () => {
    const table = new Table();
    table.service.commit([
      anEvent({ seq: 1, scope: 'table' }),
      anEvent({ seq: 2, scope: 'private', recipients: [BOB] }),
      anEvent({ seq: 3, scope: 'table' }),
    ]);

    const { socket } = await table.join(ALICE);
    const welcome = socket.of('s2c.welcome')[0];

    // Le journal en compte trois ; Alice n'en voit que deux. C'est exactement
    // la contradiction que l'ADR 0010 lève : `lastSeq` a des trous légitimes
    // pour un destinataire donné, `lastDeliverySeq` n'en a pas.
    expect(welcome?.p['lastSeq']).toBe(3);
    expect(welcome?.p['lastDeliverySeq']).toBe(2);
  });

  it('diffuse la présence à toute la table quand quelqu’un arrive', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    await table.join(BOB);

    const presence = alice.socket.of('s2c.presence').at(-1);
    const members = presence?.p['members'] as { playerId: string }[];
    expect([...members].map((member) => member.playerId).sort()).toStrictEqual([ALICE, BOB].sort());
  });
});
