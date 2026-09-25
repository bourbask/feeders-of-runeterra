/**
 * L'ordre, l'absence de trou, et la reprise — ADR 0010 décision 1.
 *
 * THE NUMBER 50 IS WRITTEN OUT, because it comes from the acceptance
 * criterion ("un test injecte 50 événements") and from nowhere else. The
 * numbers that come from the code — the tail bound, the close codes — are read
 * from the code. No number here is compared to itself.
 *
 * WHAT "SANS TROU" MEANS AFTER L'ADR 0008. It is FALSE of `seq` for any one
 * player: an event addressed to somebody else leaves a legitimate hole. It is
 * true of `deliverySeq`, and that is the whole reason the second counter
 * exists. The suite therefore asserts a gap in `seq` AND density in
 * `deliverySeq` on the same stream — one assertion without the other would let
 * a hub that ignored the scopes pass.
 */

import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { WS_DELIVERY_TAIL_MAX } from '../../src/ws/hub.js';
import { ALICE, BOB, CAMPAIGN, Table, anEvent, c2s } from './support/harness.test.js';

/** Le critère d'acceptation, en toutes lettres. */
const INJECTED = 50;

interface WireEvent {
  readonly seq: number;
  readonly deliverySeq: number;
}

/** Les deux compteurs, lus dans l'enveloppe des trames `s2c.event`. */
function counters(socket: { sent: string[] }): { seqs: number[]; deliverySeqs: number[] } {
  const seqs: number[] = [];
  const deliverySeqs: number[] = [];
  for (const line of socket.sent) {
    const frame = JSON.parse(line) as { t: string; seq?: number; deliverySeq?: number };
    if (frame.t !== 's2c.event') continue;
    seqs.push(frame.seq ?? -1);
    deliverySeqs.push(frame.deliverySeq ?? -1);
  }
  return { seqs, deliverySeqs };
}

describe('la livraison', () => {
  it(`livre ${String(INJECTED)} événements dans l'ordre strict, sans trou de livraison`, async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    const events = Array.from({ length: INJECTED }, (_, i) =>
      anEvent({ seq: i + 1, scope: 'table' }),
    );
    table.hub.broadcast(CAMPAIGN, events);

    const { seqs, deliverySeqs } = counters(alice.socket);
    expect(seqs).toHaveLength(INJECTED);
    expect(seqs).toStrictEqual(Array.from({ length: INJECTED }, (_, i) => i + 1));
    expect(deliverySeqs).toStrictEqual(Array.from({ length: INJECTED }, (_, i) => i + 1));
  });

  it('`seq` a des trous légitimes là où `deliverySeq` n’en a aucun', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    // Un sur deux est adressé à Bob : Alice voit 1, 3, 5, 7, 9.
    const events = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? anEvent({ seq: i + 1, scope: 'table' })
        : anEvent({ seq: i + 1, scope: 'private', recipients: [BOB] }),
    );
    table.hub.broadcast(CAMPAIGN, events);

    const { seqs, deliverySeqs } = counters(alice.socket);
    expect(seqs).toStrictEqual([1, 3, 5, 7, 9]);
    expect(deliverySeqs).toStrictEqual([1, 2, 3, 4, 5]);
  });

  it('après une coupure, `c2s.resume` renvoie exactement les manquants', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);

    table.hub.broadcast(
      CAMPAIGN,
      Array.from({ length: INJECTED }, (_, i) => anEvent({ seq: i + 1, scope: 'table' })),
    );
    alice.socket.clear();

    // Le client a acquitté jusqu'au 30e : il lui manque les vingt derniers.
    await alice.connection.receive(
      c2s('c2s.resume', { sinceDeliverySeq: 30 }, table.nextFrameId()),
    );

    const batch = alice.socket.of('s2c.events_batch').at(-1)?.p['events'] as WireEvent[];
    expect(batch.map((entry) => entry.deliverySeq)).toStrictEqual(
      Array.from({ length: INJECTED - 30 }, (_, i) => 31 + i),
    );
    expect(batch.map((entry) => entry.seq)).toStrictEqual(
      Array.from({ length: INJECTED - 30 }, (_, i) => 31 + i),
    );
  });

  it('`c2s.resume { sinceDeliverySeq: 0 }` redemande tout', async () => {
    const table = new Table();
    table.service.commit(
      Array.from({ length: 5 }, (_, i) => anEvent({ seq: i + 1, scope: 'table' })),
    );
    const alice = await table.join(ALICE);
    alice.socket.clear();

    await alice.connection.receive(c2s('c2s.resume', { sinceDeliverySeq: 0 }, table.nextFrameId()));

    const batch = alice.socket.of('s2c.events_batch').at(-1)?.p['events'] as WireEvent[];
    expect(batch.map((entry) => entry.deliverySeq)).toStrictEqual([1, 2, 3, 4, 5]);
  });

  it('un curseur plus ancien que la fenêtre retenue retombe sur un instantané', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);

    table.hub.broadcast(
      CAMPAIGN,
      Array.from({ length: WS_DELIVERY_TAIL_MAX + 10 }, (_, i) =>
        anEvent({ seq: i + 1, scope: 'table' }),
      ),
    );
    alice.socket.clear();

    await alice.connection.receive(c2s('c2s.resume', { sinceDeliverySeq: 1 }, table.nextFrameId()));

    expect(alice.socket.types()).toStrictEqual(['s2c.snapshot']);
    // Les deux repli sur instantané n'ont pas la même cause, et le hub les
    // distingue : sans cette ligne, ce test et le suivant seraient le même.
    expect(table.hub.catchUpFrom(CAMPAIGN, ALICE, 1)).toStrictEqual({
      kind: 'snapshot',
      reason: 'curseur trop ancien',
    });
  });

  it('un curseur en avance sur le serveur retombe sur un instantané', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    await alice.connection.receive(
      c2s('c2s.resume', { sinceDeliverySeq: 9_999 }, table.nextFrameId()),
    );

    expect(alice.socket.types()).toStrictEqual(['s2c.snapshot']);
    expect(table.hub.catchUpFrom(CAMPAIGN, ALICE, 9_999)).toStrictEqual({
      kind: 'snapshot',
      reason: 'curseur en avance sur le serveur',
    });
  });

  it('deux sockets du même joueur partagent la même numérotation', async () => {
    const table = new Table();
    const first = await table.join(ALICE);
    const second = await table.join(ALICE);
    first.socket.clear();
    second.socket.clear();

    table.hub.broadcast(CAMPAIGN, [anEvent({ seq: 1, scope: 'table' })]);

    expect(counters(first.socket).deliverySeqs).toStrictEqual([1]);
    expect(counters(second.socket).deliverySeqs).toStrictEqual([1]);
  });

  it('un événement diffusé pendant l’hydratation est compté une fois, et une seule', async () => {
    const table = new Table();
    table.service.commit([
      anEvent({ seq: 1, scope: 'table' }),
      anEvent({ seq: 2, scope: 'table' }),
    ]);

    // La lecture du journal est partie ; la diffusion arrive avant qu'elle ne
    // revienne. Le 2 est dans les deux, le 3 n'est que dans la diffusion.
    // C'est exactement la course que `openStream` referme, et les deux issues
    // qu'elle doit traiter : un doublon et un nouveau.
    const hydrating = table.hub.openStream(CAMPAIGN, ALICE);
    table.hub.broadcast(CAMPAIGN, [
      anEvent({ seq: 2, scope: 'table' }),
      anEvent({ seq: 3, scope: 'table' }),
    ]);
    await hydrating;

    expect(table.hub.deliveryHead(CAMPAIGN, ALICE)).toBe(3);
  });

  it('ne recompte pas un événement rediffusé par erreur', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    const event = anEvent({ seq: 1, scope: 'table' });
    table.hub.broadcast(CAMPAIGN, [event]);
    table.hub.broadcast(CAMPAIGN, [event]);

    expect(counters(alice.socket).deliverySeqs).toStrictEqual([1]);
  });
});

describe('le fractionnement du rattrapage', () => {
  it('découpe un rattrapage trop lourd en plusieurs trames de moins de 256 Kio', async () => {
    const table = new Table();
    const heavy = Array.from({ length: 120 }, (_, i) =>
      anEvent({ seq: i + 1, scope: 'table', text: 'x'.repeat(4_000) }),
    );
    table.service.commit(heavy);

    const alice = await table.join(ALICE);
    alice.socket.clear();
    await alice.connection.receive(c2s('c2s.resume', { sinceDeliverySeq: 0 }, table.nextFrameId()));

    const batches = alice.socket.of('s2c.events_batch');
    expect(batches.length).toBeGreaterThan(1);

    for (const line of alice.socket.sent) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(256 * 1024);
    }

    const delivered = batches.flatMap((frame) => frame.p['events'] as WireEvent[]);
    expect(delivered.map((entry) => entry.deliverySeq)).toStrictEqual(
      Array.from({ length: 120 }, (_, i) => i + 1),
    );
  });
});

describe('le fil de livraison, relu', () => {
  it("ce qu'Alice a reçu est exactement ce que son fil rejoué redonne", async () => {
    const table = new Table();
    const journal = [
      anEvent({ seq: 1, scope: 'table' }),
      anEvent({ seq: 2, scope: 'private', recipients: [BOB] }),
      anEvent({ seq: 3, scope: 'subset', recipients: [ALICE, BOB] }),
      anEvent({ seq: 4, scope: 'private', recipients: [ALICE] }),
    ];
    const alice = await table.join(ALICE);
    alice.socket.clear();
    table.hub.broadcast(CAMPAIGN, journal);

    // Invariant 4 tel que l'ADR 0008 le durcit : rejouer DU POINT DE VUE
    // d'Alice redonne exactement ce qu'elle a vu, ni plus ni moins.
    const replayed = journal
      .filter((event) => event.scope === 'table' || (event.recipients ?? []).includes(ALICE))
      .map((event) => event.seq);
    expect(counters(alice.socket).seqs).toStrictEqual(replayed);
    expect(replayed).toStrictEqual([1, 3, 4]);
  });
});
