/**
 * ADR 0008 decision 1 — LE SERVEUR DÉCIDE QUI REÇOIT QUOI.
 *
 * THE ASSERTIONS READ THE BYTES. `socket.sent` holds the strings handed to the
 * transport, and the checks below search those strings for the event's own
 * identifier. That is deliberate: an assertion on a parsed frame, or on a list
 * the hub returned, could be satisfied by a server that built the frame and
 * left the filtering to somebody else. "A client-side filter is not
 * confidentiality, it is a suggestion" — the only measurement that means
 * anything is what left the process.
 *
 * TWO DIRECTIONS, ALWAYS. Every case below checks that the recipient DOES get
 * the event and that the non-recipient does NOT. A suite that only checked the
 * absence would stay green on a hub that delivered nothing at all.
 */

import { EVENT_SCOPES } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { ADDRESSED_SCOPES, isVisibleTo } from '../../src/ws/hub.js';
import { ALICE, BOB, CAMPAIGN, Table, anEvent, c2s } from './support/harness.test.js';

/** Does anything this socket wrote mention this event? */
function wroteEvent(sent: readonly string[], eventId: string): boolean {
  return sent.some((line) => line.includes(eventId));
}

describe('la diffusion adressée', () => {
  it('un événement `private` ne quitte jamais le serveur vers un non-destinataire', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    const bob = await table.join(BOB);
    alice.socket.clear();
    bob.socket.clear();

    const secret = anEvent({ seq: 1, scope: 'private', recipients: [ALICE] });
    table.hub.broadcast(CAMPAIGN, [secret]);

    expect(wroteEvent(alice.socket.sent, secret.id)).toBe(true);
    expect(wroteEvent(bob.socket.sent, secret.id)).toBe(false);
    expect(bob.socket.sent).toStrictEqual([]);
  });

  it('un événement `subset` va aux nommés, et à eux seuls', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    const bob = await table.join(BOB);
    alice.socket.clear();
    bob.socket.clear();

    const shared = anEvent({ seq: 1, scope: 'subset', recipients: [BOB] });
    table.hub.broadcast(CAMPAIGN, [shared]);

    expect(wroteEvent(bob.socket.sent, shared.id)).toBe(true);
    expect(wroteEvent(alice.socket.sent, shared.id)).toBe(false);
  });

  it('un événement `table` va à tout le monde', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    const bob = await table.join(BOB);
    alice.socket.clear();
    bob.socket.clear();

    const common = anEvent({ seq: 1, scope: 'table' });
    table.hub.broadcast(CAMPAIGN, [common]);

    expect(wroteEvent(alice.socket.sent, common.id)).toBe(true);
    expect(wroteEvent(bob.socket.sent, common.id)).toBe(true);
  });

  it('le rattrapage est adressé comme la diffusion : un secret ne revient pas par la reprise', async () => {
    const table = new Table();
    table.service.commit([
      anEvent({ seq: 1, scope: 'table' }),
      anEvent({ seq: 2, scope: 'private', recipients: [ALICE] }),
      anEvent({ seq: 3, scope: 'table' }),
    ]);
    const secretId = table.service.journal[1]?.id ?? '';

    const bob = await table.join(BOB);
    await bob.connection.receive(c2s('c2s.resume', { sinceDeliverySeq: 0 }, table.nextFrameId()));

    expect(wroteEvent(bob.socket.sent, secretId)).toBe(false);
    const batch = bob.socket.of('s2c.events_batch').at(-1)?.p['events'] as { seq: number }[];
    expect(batch.map((entry) => entry.seq)).toStrictEqual([1, 3]);
  });

  it('une liste de destinataires vide ou absente ne livre à personne — le défaut est le refus', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    table.hub.broadcast(CAMPAIGN, [
      anEvent({ seq: 1, scope: 'private', recipients: [] }),
      anEvent({ seq: 2, scope: 'subset', recipients: null }),
    ]);

    expect(alice.socket.sent).toStrictEqual([]);
  });

  it('ne confond pas un identifiant avec son préfixe', () => {
    // La version `LIKE '%p1%'` de ce prédicat livrait `["p10"]` à `p1`.
    // Ici les identifiants sont des ULID, donc de même longueur, mais la
    // propriété qui compte est la comparaison de MEMBRES entiers.
    const event = anEvent({ seq: 1, scope: 'private', recipients: [`${ALICE}X`] });
    expect(isVisibleTo(event, ALICE)).toBe(false);
  });
});

describe('les portées, comparées à leur source', () => {
  it("les portées adressées sont celles que l'ADR 0008 nomme, et le moteur les porte toutes", () => {
    // Deux chemins : à gauche ce que le TUPLE DU MOTEUR donne une fois `table`
    // retiré ; à droite les deux noms que l'ADR 0008 décision 1 écrit en toutes
    // lettres. Retirer un membre du tuple moteur fait tomber cette ligne.
    expect([...ADDRESSED_SCOPES]).toStrictEqual(['subset', 'private']);
    expect([...EVENT_SCOPES]).toStrictEqual(['table', 'subset', 'private']);
  });

  it('chaque portée du moteur a une réponse, et seule `table` est ouverte', () => {
    const openToEveryone: string[] = [];
    const addressed: string[] = [];
    for (const scope of EVENT_SCOPES) {
      const visible = isVisibleTo(anEvent({ seq: 1, scope, recipients: [BOB] }), ALICE);
      if (visible) openToEveryone.push(scope);
      else addressed.push(scope);
    }
    expect(openToEveryone).toStrictEqual(['table']);
    expect(addressed).toStrictEqual(['subset', 'private']);
  });
});
