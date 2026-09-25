/**
 * LA FENÊTRE ENTRE L'ÉTAT ET LE CURSEUR — invariant 4, durci par l'ADR 0008.
 *
 * Un instantané se compose de DEUX lectures prises à deux instants : l'état
 * vient de `CampaignService.getSnapshot`, qui est attendu, et le curseur vient
 * du hub, qui continue de compter pendant cette attente. Un événement commité
 * et diffusé entre les deux est compté par le curseur et absent de l'état — et
 * sur `c2s.hello` la socket n'est pas encore dans l'ensemble de diffusion,
 * donc il n'est écrit nulle part.
 *
 * POURQUOI LA PERTE EST DÉFINITIVE, et pas seulement gênante.
 * `packages/client/src/ws/store.ts`, `case 's2c.snapshot'` : « ÉCRASEMENT
 * INTÉGRAL », puis `lastDeliverySeq: frame.p.lastDeliverySeq`. Le client
 * mémorise donc le curseur qui COMPTE l'événement perdu. Le suivant portera
 * exactement `lastDeliverySeq + 1`, et son détecteur de trou
 * (`if (frame.deliverySeq > expected) requestResume()`) ne peut plus se
 * déclencher. Aucun `c2s.resume` ne redemandera jamais cette ligne.
 *
 * CE QUE CES TESTS MESURENT, et qui n'est pas « un test existe » : les octets
 * écrits vers le joueur, et l'ORDRE dans lequel ils sont écrits. Un instantané
 * qui arrive après un événement plus récent que lui l'annule ; le fil doit
 * donc redonner l'événement APRÈS l'instantané, pas avant.
 *
 * LES DEUX CHEMINS SONT MESURÉS, parce que le défaut est sur les deux et que
 * leur symptôme diffère : sur `c2s.hello` la trame n'est jamais écrite ; sur
 * `c2s.resume` elle est écrite puis écrasée.
 */

import { describe, expect, it } from 'vitest';

import type { FakeSocket } from './support/harness.test.js';
import {
  ALICE,
  BOB,
  CAMPAIGN,
  Gate,
  Table,
  anEvent,
  c2s,
  letAwaitsRun,
} from './support/harness.test.js';

/** Une trame telle qu'elle part sur le fil, enveloppe comprise. */
interface WireFrame {
  readonly t: string;
  readonly seq?: number;
  readonly deliverySeq?: number;
  readonly p: Record<string, unknown>;
}

function wire(socket: FakeSocket): WireFrame[] {
  return socket.sent.map((line) => JSON.parse(line) as WireFrame);
}

/** Les rangs des octets écrits qui portent cet identifiant d'événement. */
function positionsOf(socket: FakeSocket, eventId: string): number[] {
  const marks = socket.sent.map((line, index) => (line.includes(eventId) ? index : -1));
  return marks.filter((index) => index >= 0);
}

describe("l'instantané et le curseur sont pris au même instant", () => {
  it('livre un événement diffusé pendant que la lecture est en vol — `c2s.hello`', async () => {
    const table = new Table();
    const gate = new Gate();
    table.service.suspendSnapshot = () => gate.closed;

    const opened = await table.connect(ALICE);
    const connection = opened.connection;
    expect(connection).not.toBeNull();
    if (connection === null) return;

    const hello = connection.receive(
      c2s('c2s.hello', { clientVersion: '0.0.0-test', lastDeliverySeq: null }, table.nextFrameId()),
    );
    await letAwaitsRun();
    // La lecture est EN VOL : elle a figé son état et n'a pas répondu.
    expect(table.service.snapshotCalls).toBe(1);

    const late = anEvent({ seq: 1, scope: 'table' });
    table.service.commit([late]);
    table.hub.broadcast(CAMPAIGN, [late]);

    gate.open();
    await hello;

    // 1. L'événement a bien quitté le serveur vers Alice.
    expect(positionsOf(opened.socket, late.id)).not.toStrictEqual([]);

    // 2. Dans cet ordre, et pas un autre.
    expect(opened.socket.types()).toStrictEqual([
      's2c.welcome',
      's2c.snapshot',
      's2c.event',
      's2c.presence',
    ]);

    // 3. Et sans trou pour le client : il retient 0 de l'instantané, reçoit 1,
    //    donc `expected` vaut exactement ce qui arrive.
    const frames = wire(opened.socket);
    const snapshot = frames.find((frame) => frame.t === 's2c.snapshot');
    const event = frames.find((frame) => frame.t === 's2c.event');
    expect(snapshot?.p['lastDeliverySeq']).toBe(0);
    expect(event?.deliverySeq).toBe(1);
  });

  it('ne laisse jamais un instantané écraser un événement plus récent que lui — `c2s.resume`', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    const gate = new Gate();
    table.service.suspendSnapshot = () => gate.closed;
    const before = table.service.snapshotCalls;

    // `9 999` force la branche instantané : le curseur est en avance sur le
    // serveur, donc aucun rattrapage n'est possible.
    const resume = alice.connection.receive(
      c2s('c2s.resume', { sinceDeliverySeq: 9_999 }, table.nextFrameId()),
    );
    await letAwaitsRun();
    expect(table.service.snapshotCalls).toBe(before + 1);

    // Ici la socket EST attachée : l'événement part en direct, AVANT
    // l'instantané qui va l'écraser.
    const late = anEvent({ seq: 1, scope: 'table' });
    table.service.commit([late]);
    table.hub.broadcast(CAMPAIGN, [late]);

    gate.open();
    await resume;

    const frames = wire(alice.socket);
    const snapshotAt = frames.findIndex((frame) => frame.t === 's2c.snapshot');
    expect(snapshotAt).toBeGreaterThanOrEqual(0);

    // Le dernier octet qui porte l'événement vient APRÈS l'instantané.
    const carried = positionsOf(alice.socket, late.id);
    expect(Math.max(...carried)).toBeGreaterThan(snapshotAt);

    // Et ce qui suit l'instantané reprend exactement à son curseur + 1.
    const replayed = frames.slice(snapshotAt + 1).filter((frame) => frame.t === 's2c.event');
    expect(frames[snapshotAt]?.p['lastDeliverySeq']).toBe(0);
    expect(replayed.map((frame) => frame.deliverySeq)).toStrictEqual([1]);
  });

  it("le rattrapage de la fenêtre reste adressé : ce qui n'est pas pour Alice ne passe pas", async () => {
    const table = new Table();
    const gate = new Gate();
    table.service.suspendSnapshot = () => gate.closed;

    const opened = await table.connect(ALICE);
    const connection = opened.connection;
    expect(connection).not.toBeNull();
    if (connection === null) return;

    const hello = connection.receive(
      c2s('c2s.hello', { clientVersion: '0.0.0-test', lastDeliverySeq: null }, table.nextFrameId()),
    );
    await letAwaitsRun();

    // Trois événements dans la fenêtre, dont un qui ne la regarde pas : le
    // `seq` d'Alice a donc un trou légitime là où son `deliverySeq` n'en a pas.
    const first = anEvent({ seq: 1, scope: 'table' });
    const hidden = anEvent({ seq: 2, scope: 'private', recipients: [BOB] });
    const third = anEvent({ seq: 3, scope: 'table' });
    table.service.commit([first, hidden, third]);
    table.hub.broadcast(CAMPAIGN, [first, hidden, third]);

    gate.open();
    await hello;

    expect(positionsOf(opened.socket, hidden.id)).toStrictEqual([]);

    // Invariant 4 : le fil rejoué du point de vue d'Alice, et ce qu'elle a vu.
    const delivered = wire(opened.socket).filter((frame) => frame.t === 's2c.event');
    expect(delivered.map((frame) => frame.seq)).toStrictEqual([1, 3]);
    expect(delivered.map((frame) => frame.deliverySeq)).toStrictEqual([1, 2]);
  });

  it('le rattrapage de la fenêtre ne rejoue rien quand la fenêtre est vide', async () => {
    // La contre-épreuve du mode 6 : si `flushAfterSnapshot` écrivait quoi que
    // ce soit sans événement à rattraper, l'accueil porterait quatre trames.
    const table = new Table();
    const opened = await table.join(ALICE);

    expect(opened.socket.types()).toStrictEqual(['s2c.welcome', 's2c.snapshot', 's2c.presence']);
  });
});
