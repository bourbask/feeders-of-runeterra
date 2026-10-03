/**
 * LA DIFFUSION SE FAIT PAR SÉQUENCE, JAMAIS PAR LE RÉSULTAT — issue #67.
 *
 * `ws/handlers.ts` diffusait `SubmitIntentResult.events`, c'est-à-dire ce que
 * l'intention REND. Le filet de sécurité de la brûlure (`closeWindowAsKeep`)
 * écrit des entrées qui sont journalisées et ABSENTES de ce résultat. Elles
 * n'atteignaient donc personne — et JAMAIS PLUS : `TableHub` fait avancer
 * `stream.lastSeq` par-dessus en comptant, donc aucune reprise ne les
 * redemandait. Trois entrées perdues sur le seul scénario `06` du simulateur.
 *
 * ── CE FICHIER MESURE DANS LES DEUX SENS, ET C'EST TOUT SON INTÉRÊT ───────
 * `Table.useResultDelivery()` remonte la livraison D'AVANT — celle par le
 * résultat — et la suite exige qu'elle PERDE l'entrée. La livraison par
 * séquence, sur la même table et le même scénario, la livre. Montrer qu'un
 * test existe ne vaut rien ; montrer qu'il distingue les deux chemins, si.
 *
 * ── DEUX INSTANTS, DEUX DESTINATAIRES ────────────────────────────────────
 * L'entrée hors résultat est écrite AVANT celle du résultat, donc elle porte
 * un `seq` plus petit : une diffusion qui la saute laisse le curseur de
 * livraison du joueur sauter avec elle. La suite lit donc le `deliverySeq`,
 * pas seulement la présence des trames. Et elle le fait pour DEUX joueurs,
 * parce qu'un compteur par joueur ne se mesure pas sur un joueur.
 */

import { describe, expect, it } from 'vitest';

import { ALICE, BOB, CAMPAIGN, Table, c2s } from './support/harness.test.js';

const AN_INTENT = { type: 'play_session.begin' } as const;

/** Ce que le filet de la brûlure écrit sur le scénario `06`, en toutes lettres. */
const ENTRIES_WRITTEN_BY_THE_SAFETY_NET = 3;

/** Les deux compteurs de l'enveloppe, qui vivent À CÔTÉ de `p` et non dedans. */
function numbersOf(
  frames: readonly { t: string; p: Record<string, unknown> }[],
  field: 'seq' | 'deliverySeq',
): number[] {
  return frames.map((frame) => (frame as unknown as Record<string, number>)[field] ?? -1);
}

async function playOneTurn(table: Table, connection: { receive(raw: string): Promise<void> }) {
  await connection.receive(c2s('c2s.intent', { intent: AN_INTENT }, table.nextFrameId()));
}

describe('la diffusion part du journal, pas du résultat (#67)', () => {
  it('livre les entrées écrites HORS du résultat de l’intention — le filet de la brûlure', async () => {
    const table = new Table();
    table.service.journalledOutsideResult = ENTRIES_WRITTEN_BY_THE_SAFETY_NET;

    const alice = await table.join(ALICE);
    alice.socket.clear();
    await playOneTurn(table, alice.connection);

    // Trois entrées hors résultat, plus celle que le résultat porte.
    expect(alice.socket.of('s2c.event')).toHaveLength(ENTRIES_WRITTEN_BY_THE_SAFETY_NET + 1);
    const texts = alice.socket
      .of('s2c.event')
      .map((frame) => (frame.p['event'] as { payload: { text: string } }).payload.text);
    expect(texts.filter((text) => text.includes('absente du résultat'))).toHaveLength(
      ENTRIES_WRITTEN_BY_THE_SAFETY_NET,
    );
  });

  it('et le curseur de livraison ne saute pas par-dessus elles', async () => {
    const table = new Table();
    table.service.journalledOutsideResult = ENTRIES_WRITTEN_BY_THE_SAFETY_NET;

    const alice = await table.join(ALICE);
    alice.socket.clear();
    await playOneTurn(table, alice.connection);

    // DENSE, SANS TROU : c'est le seul compteur dont l'ADR 0010 promet la
    // densité, et c'est lui que `c2s.resume` renvoie.
    const cursors = numbersOf(alice.socket.of('s2c.event'), 'deliverySeq');
    expect(cursors).toStrictEqual([1, 2, 3, 4]);
  });

  it('AVEC LA VIOLATION — diffuser le résultat perd les entrées, et le curseur saute', async () => {
    const table = new Table();
    table.useResultDelivery();
    table.service.journalledOutsideResult = ENTRIES_WRITTEN_BY_THE_SAFETY_NET;

    const alice = await table.join(ALICE);
    alice.socket.clear();
    await playOneTurn(table, alice.connection);

    // Une seule trame : celle que le résultat portait. Les trois autres sont
    // écrites, numérotées, et n'atteindront jamais personne.
    const events = alice.socket.of('s2c.event');
    expect(events).toHaveLength(1);
    expect((events[0]?.p['event'] as { payload: { text: string } }).payload.text).not.toContain(
      'absente du résultat',
    );
    // Et le trou est définitif : le `seq` du journal est à 4, le joueur n'a
    // reçu qu'un numéro de livraison, et rien ne redemandera les trois autres.
    expect(numbersOf(events, 'seq')).toStrictEqual([ENTRIES_WRITTEN_BY_THE_SAFETY_NET + 1]);
    expect(numbersOf(events, 'deliverySeq')).toStrictEqual([1]);
  });

  it('DEUX DESTINATAIRES : chacun reçoit les quatre, chacun avec son propre curseur dense', async () => {
    const table = new Table();
    table.service.journalledOutsideResult = ENTRIES_WRITTEN_BY_THE_SAFETY_NET;

    const alice = await table.join(ALICE);
    const bob = await table.join(BOB);
    alice.socket.clear();
    bob.socket.clear();

    await playOneTurn(table, alice.connection);

    expect(numbersOf(alice.socket.of('s2c.event'), 'deliverySeq')).toStrictEqual([1, 2, 3, 4]);
    expect(numbersOf(bob.socket.of('s2c.event'), 'deliverySeq')).toStrictEqual([1, 2, 3, 4]);
  });

  it('deux livraisons de la même entrée n’écrivent qu’une trame', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    await playOneTurn(table, alice.connection);
    const after = alice.socket.of('s2c.event').length;

    // Une seconde livraison sur la même campagne : le hub ignore un `seq`
    // déjà compté, donc rien de plus ne part. Sans cette idempotence, la
    // livraison par séquence doublerait chaque trame.
    table.delivery.deliver(CAMPAIGN);
    table.delivery.deliverSince(CAMPAIGN, 0);

    expect(alice.socket.of('s2c.event')).toHaveLength(after);
  });

  it('la livraison est nommée : elle reçoit la campagne, et c’est celle de la socket', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    table.delivery.asked.splice(0, table.delivery.asked.length);

    await playOneTurn(table, alice.connection);

    // Un `deliver()` sans paramètre compilerait et effacerait la campagne de
    // toute la suite — huitième mode de la batterie.
    expect(table.delivery.asked).toStrictEqual([CAMPAIGN]);
  });
});
