/**
 * CE QUI SORT, ET CE QUI NE SORT PAS. Les quatre garde-fous de
 * `connection.ts` que l'en-tête du module annonce et qu'aucune suite ne
 * mesurait : l'analyse de toute trame sortante, la borne de 256 Kio, la socket
 * fermée, et le repli de file qui doit se réarmer.
 *
 * POURQUOI UNE SUITE À PART. Les autres suites conduisent le serveur par
 * l'entrée — une trame `c2s.*` arrive, une réponse part. Ces quatre-là ne sont
 * atteignables que par la sortie : aucune trame entrante ne fait construire au
 * serveur une trame invalide, et c'est précisément ce qui les avait laissés
 * sans mesure. Ici on appelle la couture publique de `TableConnection`, qui
 * est celle que M0-24 appellera.
 *
 * LES DEUX DIRECTIONS, PARTOUT. Chaque refus est doublé de l'acceptation qui
 * lui correspond : une suite qui ne montrerait que le refus resterait verte
 * sur une connexion qui n'écrit jamais rien.
 */

import { Buffer } from 'node:buffer';

import {
  PROTOCOL_VERSION,
  WS_MAX_OUTGOING_FRAME_BYTES,
  zId,
  zMessageId,
  zPlayerId,
} from '@for/contracts';
import { describe, expect, it } from 'vitest';

import type { FakeSocket } from './support/harness.test.js';
import {
  ALICE,
  anEvent,
  aUuid,
  c2s,
  CAMPAIGN,
  RecordingLogger,
  Table,
} from './support/harness.test.js';

/** Une trame telle qu'elle part, ENVELOPPE COMPRISE. */
interface Stamped {
  readonly t: string;
  readonly id: string;
  readonly ts: number;
  readonly p: Record<string, unknown>;
}

function stamped(socket: FakeSocket): Stamped[] {
  return socket.sent.map((line) => JSON.parse(line) as Stamped);
}

/** Le squelette `{ v, t, id, ts, p }` que porte toute trame `s2c.*`. */
function envelope(type: string, payload: unknown): unknown {
  return { v: PROTOCOL_VERSION, t: type, id: aUuid(9_001), ts: 1_700_000_000_000, p: payload };
}

describe('toute trame sortante est analysée avant sérialisation', () => {
  it("jette sur une trame que le serveur aurait mal construite, et n'écrit rien", async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    // `lastDeliverySeq` en toutes lettres : `zS2CSnapshot` veut un nombre.
    const malformed = envelope('s2c.snapshot', {
      state: null,
      lastSeq: 0,
      lastDeliverySeq: 'trois',
    });

    expect(() => alice.connection.send(malformed)).toThrow();
    // L'erreur est un défaut de serveur : rien n'atteint l'écran du joueur.
    expect(alice.socket.sent).toStrictEqual([]);
  });

  it('laisse passer la même trame une fois bien formée — la direction basse', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    const state = alice.socket.of('s2c.snapshot')[0]?.p['state'];
    alice.socket.clear();

    const wellFormed = envelope('s2c.snapshot', { state, lastSeq: 0, lastDeliverySeq: 0 });

    expect(alice.connection.send(wellFormed)).toBe(true);
    expect(alice.socket.types()).toStrictEqual(['s2c.snapshot']);
  });

  it('refuse un type de trame que le protocole gelé ne déclare pas', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    expect(() => alice.connection.send(envelope('s2c.inventee', {}))).toThrow();
    expect(alice.socket.sent).toStrictEqual([]);
  });
});

describe('la borne de 256 Kio sortants', () => {
  it('abandonne une trame trop lourde pour le fil, et le dit au journal', async () => {
    const table = new Table();
    const logger = new RecordingLogger();
    table.logger = logger;
    const alice = await table.join(ALICE);
    alice.socket.clear();

    // Une note démesurée : `zSystemNotePayload.text` est un `z.string()` sans
    // borne, donc la trame est VALIDE et seulement trop grosse.
    const bloated = anEvent({ seq: 1, scope: 'table', text: 'x'.repeat(300_000) });
    const written = alice.connection.sendEvent({ seq: 1, deliverySeq: 1, event: bloated });

    expect(written).toBe(false);
    expect(alice.socket.sent).toStrictEqual([]);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.context).toMatchObject({ limit: WS_MAX_OUTGOING_FRAME_BYTES });
  });

  it('écrit la même trame quand elle tient — la direction basse', async () => {
    const table = new Table();
    const logger = new RecordingLogger();
    table.logger = logger;
    const alice = await table.join(ALICE);
    alice.socket.clear();

    const roomy = anEvent({ seq: 1, scope: 'table', text: 'x'.repeat(100_000) });
    const written = alice.connection.sendEvent({ seq: 1, deliverySeq: 1, event: roomy });

    expect(written).toBe(true);
    expect(alice.socket.sent).toHaveLength(1);
    expect(Buffer.byteLength(alice.socket.sent[0] ?? '')).toBeLessThanOrEqual(
      WS_MAX_OUTGOING_FRAME_BYTES,
    );
    expect(logger.warnings).toStrictEqual([]);
  });
});

describe('une socket fermée', () => {
  it("n'est fermée qu'une fois, et n'écrit plus rien après", async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    alice.connection.closeWith('rate_limited');
    alice.connection.closeWith('payload_too_large');

    // Un seul code de fermeture part : le premier, celui qui dit ce qui s'est
    // réellement passé. Deux fermetures, c'est deux raisons contradictoires
    // sur le même fil.
    expect(alice.socket.closes.map((close) => close.reason)).toStrictEqual(['rate_limited']);
    expect(alice.connection.isOpen).toBe(false);
    expect(alice.connection.send(envelope('s2c.ping', {}))).toBe(false);
    expect(alice.socket.sent).toStrictEqual([]);
  });

  it('ignore une trame entrante arrivée après la fermeture', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.connection.closeWith('rate_limited');
    alice.socket.clear();

    await alice.connection.receive(
      c2s('c2s.intent', { intent: { type: 'play_session.begin' } }, table.nextFrameId()),
    );

    expect(table.service.submitCalls).toBe(0);
    expect(alice.socket.sent).toStrictEqual([]);
  });

  it('quitte la table quand le transport est parti de lui-même', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    // `markClosed` est la couture que le transport réel appelle sur son
    // événement `close` : rien ne l'a fermée ici, elle l'apprend.
    alice.connection.markClosed();

    expect(alice.connection.isOpen).toBe(false);
    expect(alice.connection.member.online).toBe(false);
    expect(alice.socket.closes).toStrictEqual([]);

    table.hub.tick(table.clock.now());
    expect(table.hub.connectionsOf(CAMPAIGN)).toStrictEqual([]);
  });
});

describe('le repli de file', () => {
  it('se réarme quand le transport a rattrapé son retard', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);

    const flood = (from: number): void => {
      table.hub.broadcast(
        CAMPAIGN,
        Array.from({ length: 70 }, (_, i) => anEvent({ seq: from + i, scope: 'table' })),
      );
    };

    alice.socket.stalled = true;
    alice.socket.clear();
    flood(1);
    expect(alice.socket.of('s2c.resync_required')).toHaveLength(1);

    // Le transport écoule sa file : la connexion doit redevenir capable de
    // replier une seconde fois. Sans réarmement, elle reste muette pour
    // toujours et un client saturé ne sera plus jamais prévenu.
    alice.socket.drain();
    alice.socket.stalled = true;
    alice.socket.clear();
    flood(1_000);

    expect(alice.socket.of('s2c.resync_required')).toHaveLength(1);
  });
});

describe("les trois identifiants d'enveloppe, sur une trame réelle", () => {
  /**
   * L'EN-TÊTE DE `connection.ts` CONSACRE UN PARAGRAPHE À LA DIVERGENCE :
   * « NOT `AppDeps.ids`, AND THAT IS A DIVERGENCE WORTH NAMING ». `zMessageId`
   * est `z.uuid()` tandis que tout identifiant de serveur est un ULID, donc
   * l'`id` d'enveloppe et le `requestId` d'une erreur viennent de DEUX SOURCES
   * DIFFÉRENTES. `handshake.test.ts` mesure la fabrique `randomFrameIds` ; ici
   * on mesure que `send` confie le bon champ à la bonne source, sur les octets
   * réellement écrits — c'est le seul endroit où une inversion se voit.
   */
  it('un `id` par trame, distinct, et de la forme que `zMessageId` exige', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);

    const ids = stamped(alice.socket).map((frame) => frame.id);

    // Trois trames d'accueil, trois identifiants : un `id` figé à une
    // constante passerait toute analyse de schéma et se verrait ici seulement.
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(zMessageId.safeParse(id).success).toBe(true);
      expect(zPlayerId.safeParse(id).success).toBe(false);
    }
  });

  it("le `ts` suit l'horloge injectée, à deux instants et pas un seul", async () => {
    const table = new Table();
    const born = table.clock.now();
    const alice = await table.join(ALICE);

    const later = table.clock.advance(4_321);
    await alice.connection.receive(c2s('c2s.typing', { typing: true }, table.nextFrameId()));

    const frames = stamped(alice.socket);
    // DEUX INSTANTS : à un seul, un `ts` figé à n'importe quel entier — ou une
    // horloge ambiante à la place de celle qu'on injecte — resterait vert.
    expect(later).not.toBe(born);
    expect(frames.slice(0, 3).map((frame) => frame.ts)).toStrictEqual([born, born, born]);
    expect(frames.at(-1)?.t).toBe('s2c.presence');
    expect(frames.at(-1)?.ts).toBe(later);
  });

  it("le `requestId` d'une erreur est un ULID, jamais l'`id` de la trame qui le porte", async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    await alice.connection.receive('{ pas du json');
    await alice.connection.receive('{ toujours pas');

    const errors = stamped(alice.socket);
    expect(errors.map((frame) => frame.t)).toStrictEqual(['s2c.error', 's2c.error']);

    const requestIds = errors.map((frame) => frame.p['requestId'] as string);
    // `zAppErrorPayload.requestId` est un `z.string().min(1)` : le schéma
    // accepterait une constante. Les deux vocabulaires, eux, ne se confondent
    // pas — et c'est ce qui se mesure ici.
    expect(new Set(requestIds).size).toBe(2);
    for (const requestId of requestIds) {
      expect(zId.safeParse(requestId).success).toBe(true);
      expect(zMessageId.safeParse(requestId).success).toBe(false);
    }
    expect(requestIds[0]).not.toBe(errors[0]?.id);
  });
});
