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

import { WS_CLOSE_CODES, zMessageId, zPlayerId } from '@for/contracts';
import type { CampaignId, PlayerId } from '@for/engine';
import { beforeEach, describe, expect, it } from 'vitest';

import { randomFrameIds } from '../../src/ws/index.js';

import {
  ALICE,
  ALICE_CHARACTER,
  BOB,
  CAMPAIGN,
  Table,
  aCharacter,
  anEvent,
  c2s,
} from './support/harness.test.js';

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

  it('lit une trame binaire comme une trame texte — le transport réel en livre', async () => {
    const { connection, socket } = await table.join(ALICE);
    socket.clear();

    // `WsSocket` accepte `string | Uint8Array` parce qu'un WebSocket livre les
    // deux. Ce chemin-là n'était exercé par rien : une trame binaire parfaitement
    // valide aurait pu être refusée sans que la suite bronche.
    const frame = c2s(
      'c2s.intent',
      { intent: { type: 'play_session.begin' } },
      table.nextFrameId(),
    );
    await connection.receive(new TextEncoder().encode(frame));

    expect(table.service.submitCalls).toBe(1);
    expect(socket.of('s2c.error')).toStrictEqual([]);
    expect(socket.of('s2c.event')).toHaveLength(1);
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

describe('les identifiants de la poignée de main', () => {
  it('sont PARSÉS, jamais castés : une forme que le moteur refuse ne devient pas une session', async () => {
    const table = new Table();

    // La couche d'authentification (M0-23) rend des chaînes ; rien ne garantit
    // qu'elles portent la forme ULID que `zPlayerId` et `zCampaignId` exigent.
    // Un cast donnerait la marque nominale à n'importe quoi, et la marque ne
    // voudrait plus rien dire à partir de là.
    await expect(table.connect('p1' as PlayerId)).rejects.toThrow();
    await expect(table.connect(ALICE, 'campagne-2' as CampaignId)).rejects.toThrow();
  });

  it("la source d'identifiants de trame rend ce que `zMessageId` accepte, jamais un ULID", () => {
    // LA DIVERGENCE EST VOULUE ET N'EST PAS MESURÉE AILLEURS : `zMessageId`
    // est `z.uuid()`, alors que tout identifiant de serveur est un ULID. Une
    // source qui se tromperait de vocabulaire ferait jeter `zS2CEnvelope` sur
    // la première trame envoyée à un joueur, en production et pas ici.
    const id = randomFrameIds.next();

    expect(zMessageId.safeParse(id).success).toBe(true);
    expect(zPlayerId.safeParse(id).success).toBe(false);
    expect(randomFrameIds.next()).not.toBe(id);
  });

  it('et laissent passer la forme que les schémas gelés déclarent', async () => {
    const table = new Table();
    const opened = await table.connect(ALICE);

    expect(opened.connection?.session.playerId).toBe(ALICE);
    expect(opened.connection?.session.campaignId).toBe(CAMPAIGN);
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

  it("nomme le personnage du joueur dans `s2c.welcome.you`, et `null` quand il n'en a pas", async () => {
    const table = new Table();
    table.service.characters = [aCharacter(ALICE_CHARACTER, ALICE)];

    const alice = await table.join(ALICE);
    expect(alice.socket.of('s2c.welcome')[0]?.p['you']).toStrictEqual({
      characterId: ALICE_CHARACTER,
    });

    // Bob est à la même table et n'a pas de personnage : les deux directions,
    // sur le même état. Sans la seconde, un serveur qui rendrait toujours le
    // premier personnage de la liste passerait.
    const bob = await table.join(BOB);
    expect(bob.socket.of('s2c.welcome')[0]?.p['you']).toStrictEqual({ characterId: null });
  });

  it('porte le personnage et la frappe de chacun dans `s2c.presence`', async () => {
    const table = new Table();
    table.service.characters = [aCharacter(ALICE_CHARACTER, ALICE)];

    const alice = await table.join(ALICE);
    await table.join(BOB);
    alice.socket.clear();

    await alice.connection.receive(c2s('c2s.typing', { typing: true }, table.nextFrameId()));

    // Le tableau EXACT, dans l'ordre d'arrivée : Alice qui frappe et porte son
    // personnage, Bob qui ne fait ni l'un ni l'autre.
    expect(alice.socket.of('s2c.presence').at(-1)?.p['members']).toStrictEqual([
      { playerId: ALICE, characterId: ALICE_CHARACTER, online: true, typing: true },
      { playerId: BOB, characterId: null, online: true, typing: false },
    ]);
  });

  it('rend la frappe à son état de repos quand le client la retire', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);

    await alice.connection.receive(c2s('c2s.typing', { typing: true }, table.nextFrameId()));
    // La fenêtre de débit laisse passer une trame `c2s.typing` par tranche de
    // 10 s : sans ce saut, la seconde serait ignorée en silence (section 5.6).
    table.clock.advance(10_001);
    alice.socket.clear();
    await alice.connection.receive(c2s('c2s.typing', { typing: false }, table.nextFrameId()));

    expect(alice.socket.of('s2c.presence').at(-1)?.p['members']).toStrictEqual([
      { playerId: ALICE, characterId: null, online: true, typing: false },
    ]);
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
