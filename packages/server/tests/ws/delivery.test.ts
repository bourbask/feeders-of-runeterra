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
import {
  ALICE,
  BOB,
  CAMPAIGN,
  OTHER_CAMPAIGN,
  Table,
  anEvent,
  c2s,
} from './support/harness.test.js';

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

describe('le hub sur une table que personne n’a ouverte', () => {
  /**
   * LES QUATRE SORTIES PAR DÉFAUT, mesurées plutôt que supposées. Elles sont
   * atteintes en production dès qu'une diffusion arrive après le départ du
   * dernier joueur — `detach` supprime alors la salle — et aucune suite n'y
   * passait : le rapport de couverture les nommait une à une.
   */
  it('ne connaît ni salle, ni flux, ni curseur, et ne se plaint pas', () => {
    const table = new Table();

    expect(table.hub.connectionsOf(OTHER_CAMPAIGN)).toStrictEqual([]);
    expect(table.hub.presence(OTHER_CAMPAIGN)).toStrictEqual([]);
    expect(table.hub.deliveryHead(OTHER_CAMPAIGN, ALICE)).toBe(0);
    expect(table.hub.catchUpFrom(OTHER_CAMPAIGN, ALICE, 0)).toStrictEqual({
      kind: 'snapshot',
      reason: 'flux inconnu',
    });
    expect(table.hub.deliveredSince(OTHER_CAMPAIGN, ALICE, 0)).toStrictEqual([]);
  });

  it('jette une diffusion adressée à une salle vide, sans rien compter', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    // Alice part : la dernière socket sortie emporte la salle et ses flux.
    alice.connection.markClosed();
    table.hub.tick(table.clock.now());
    expect(table.hub.connectionsOf(CAMPAIGN)).toStrictEqual([]);

    table.hub.broadcast(CAMPAIGN, [anEvent({ seq: 1, scope: 'table' })]);
    table.hub.broadcastPresence(CAMPAIGN);

    expect(alice.socket.sent).toStrictEqual([]);
    expect(table.hub.deliveryHead(CAMPAIGN, ALICE)).toBe(0);
  });

  it('un détachement de socket sur une salle déjà partie ne casse rien', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);

    table.hub.detach(alice.connection);
    // La salle a disparu avec sa dernière socket ; le second détachement
    // tombe sur rien, ce qui doit rester une non-opération.
    table.hub.detach(alice.connection);

    expect(table.hub.connectionsOf(CAMPAIGN)).toStrictEqual([]);
  });
});

describe("le curseur porté par l'instantané (ADR 0010 décision 1)", () => {
  /**
   * TROIS ÉVÉNEMENTS AU JOURNAL, DEUX POUR ALICE. Le `seq` global vaut 3, le
   * curseur de livraison d'Alice vaut 2 : deux nombres qui ne peuvent pas être
   * confondus, ce qui est tout l'intérêt de la fixture. Avec un journal
   * entièrement visible, `lastSeq` et `lastDeliverySeq` seraient égaux et
   * remplacer l'un par l'autre ne ferait rien tomber.
   */
  function aJournalAliceOnlyHalfSees(table: Table): void {
    table.service.commit([
      anEvent({ seq: 1, scope: 'table' }),
      anEvent({ seq: 2, scope: 'private', recipients: [BOB] }),
      anEvent({ seq: 3, scope: 'table' }),
    ]);
  }

  it('`s2c.snapshot` porte le numéro de LIVRAISON, jamais le `seq` global — accueil', async () => {
    const table = new Table();
    aJournalAliceOnlyHalfSees(table);

    // Curseur absent : l'accueil retombe sur un instantané.
    const alice = await table.join(ALICE, null);
    const snapshot = alice.socket.of('s2c.snapshot')[0];

    expect(snapshot?.p['lastSeq']).toBe(3);
    expect(snapshot?.p['lastDeliverySeq']).toBe(2);
  });

  it('`s2c.snapshot` porte le numéro de LIVRAISON, jamais le `seq` global — reprise', async () => {
    const table = new Table();
    aJournalAliceOnlyHalfSees(table);
    const alice = await table.join(ALICE, null);
    alice.socket.clear();

    // Curseur en avance sur le serveur : la reprise retombe sur un instantané.
    await alice.connection.receive(
      c2s('c2s.resume', { sinceDeliverySeq: 9_999 }, table.nextFrameId()),
    );
    const snapshot = alice.socket.of('s2c.snapshot')[0];

    expect(snapshot?.p['lastSeq']).toBe(3);
    expect(snapshot?.p['lastDeliverySeq']).toBe(2);
  });

  it("le curseur de l'instantané est celui que le client renverra, et il suffit à reprendre", async () => {
    const table = new Table();
    aJournalAliceOnlyHalfSees(table);
    const alice = await table.join(ALICE, null);
    const snapshot = alice.socket.of('s2c.snapshot')[0];
    alice.socket.clear();

    // Le client fait ce que `client/src/ws/store.ts` fait : il mémorise
    // `lastDeliverySeq` et le renvoie tel quel. Avec le `seq` global (3), ce
    // curseur serait EN AVANCE et la reprise repartirait sur un instantané
    // au lieu du rattrapage — la contradiction que l'ADR 0010 lève.
    table.hub.broadcast(CAMPAIGN, [anEvent({ seq: 4, scope: 'table' })]);
    alice.socket.clear();
    await alice.connection.receive(
      c2s('c2s.resume', { sinceDeliverySeq: snapshot?.p['lastDeliverySeq'] }, table.nextFrameId()),
    );

    expect(alice.socket.types()).toStrictEqual(['s2c.events_batch']);
    const batch = alice.socket.of('s2c.events_batch')[0]?.p['events'] as WireEvent[];
    expect(batch.map((entry) => entry.deliverySeq)).toStrictEqual([3]);
    expect(batch.map((entry) => entry.seq)).toStrictEqual([4]);
  });
});

describe('un lot vide est une réponse, pas un silence', () => {
  /**
   * L'EN-TÊTE DE `sendBatch` L'ÉCRIT EN CAPITALES — « ALWAYS SENDS AT LEAST
   * ONE FRAME, empty batch included » — et c'est le critère d'acceptation :
   * après `c2s.hello`, « un rattrapage OU un instantané ». « Tu n'avais rien
   * manqué » est un rattrapage vide, pas une absence de réponse.
   *
   * LE CAS EST CELUI DU CURSEUR EXACTEMENT À JOUR, et il n'est pas exotique :
   * c'est ce que porte toute reconnexion propre. Trois façons de le casser,
   * chacune reprise par ces deux tests : le repli en instantané sur l'égalité
   * (`since > head` devenu `>=`), le rattrapage tu quand il est vide, et la
   * trame de lot qu'on n'émet plus faute d'entrées.
   *
   * ON ASSERTE LES TYPES DE TRAMES EXACTS, pas « au moins une » : un silence
   * et une réponse vide ne se distinguent que là.
   */
  function aJournalOfTwo(table: Table): void {
    table.service.commit([
      anEvent({ seq: 1, scope: 'table' }),
      anEvent({ seq: 2, scope: 'table' }),
    ]);
  }

  it('`c2s.hello` avec un curseur exactement à jour répond un lot VIDE, pas un instantané', async () => {
    const table = new Table();
    aJournalOfTwo(table);

    // Le client a tout reçu : son curseur vaut la tête du flux.
    const alice = await table.join(ALICE, 2);

    expect(table.hub.deliveryHead(CAMPAIGN, ALICE)).toBe(2);
    expect(alice.socket.types()).toStrictEqual(['s2c.welcome', 's2c.events_batch', 's2c.presence']);
    expect(alice.socket.of('s2c.events_batch')[0]?.p['events']).toStrictEqual([]);
  });

  it('`c2s.resume` avec un curseur exactement à jour répond un lot VIDE, pas un silence', async () => {
    const table = new Table();
    aJournalOfTwo(table);
    const alice = await table.join(ALICE, 2);
    alice.socket.clear();

    await alice.connection.receive(c2s('c2s.resume', { sinceDeliverySeq: 2 }, table.nextFrameId()));

    expect(alice.socket.types()).toStrictEqual(['s2c.events_batch']);
    expect(alice.socket.of('s2c.events_batch')[0]?.p['events']).toStrictEqual([]);
  });
});

describe('la fenêtre retenue, prise exactement à sa borne', () => {
  /**
   * `WS_DELIVERY_TAIL_MAX` N'EST PAS UN CHIFFRE DE CRITÈRE : la fiche ne
   * quantifie pas « trop ancien », et `hub.ts` le dit — « MINE, AND SAID SO ».
   * Il n'y a donc rien à écrire en toutes lettres ici, et ce test ne compare
   * pas un nombre à lui-même : il mesure OÙ SE TROUVE LA BORNE, dans les deux
   * sens, à travers la couture publique. Un rattrapage exactement à la borne
   * est servi ; un cran au-delà retombe sur un instantané.
   */
  it('sert le curseur qui est juste à la borne, et refuse celui qui est un cran derrière', async () => {
    const table = new Table();
    await table.join(ALICE);
    table.hub.broadcast(
      CAMPAIGN,
      Array.from({ length: WS_DELIVERY_TAIL_MAX + 50 }, (_, i) =>
        anEvent({ seq: i + 1, scope: 'table' }),
      ),
    );
    const head = table.hub.deliveryHead(CAMPAIGN, ALICE);

    const served = table.hub.catchUpFrom(CAMPAIGN, ALICE, head - WS_DELIVERY_TAIL_MAX);
    expect(served.kind).toBe('batch');
    expect(served.kind === 'batch' ? served.entries : []).toHaveLength(WS_DELIVERY_TAIL_MAX);

    expect(table.hub.catchUpFrom(CAMPAIGN, ALICE, head - WS_DELIVERY_TAIL_MAX - 1)).toStrictEqual({
      kind: 'snapshot',
      reason: 'curseur trop ancien',
    });
  });
});

describe("l'hydratation du flux ne relit le journal qu'une fois", () => {
  it('un second `c2s.hello` ne recoûte pas une lecture intégrale — et chaque joueur a la sienne', async () => {
    const table = new Table();
    table.service.commit([anEvent({ seq: 1, scope: 'table' })]);

    const alice = await table.join(ALICE);
    expect(table.service.readCalls).toBe(1);

    // Le même joueur redit bonjour : son flux existe, rien n'est relu.
    await alice.connection.receive(
      c2s('c2s.hello', { clientVersion: '0.0.0-test', lastDeliverySeq: null }, table.nextFrameId()),
    );
    expect(table.service.readCalls).toBe(1);

    // DEUX ACTEURS : le court-circuit est par JOUEUR, pas par campagne. Sans
    // cette ligne, un hub qui n'hydraterait qu'un flux par salle passerait,
    // et le second joueur n'aurait jamais de numérotation.
    await table.join(BOB);
    expect(table.service.readCalls).toBe(2);
    expect(table.hub.deliveryHead(CAMPAIGN, BOB)).toBe(1);
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
