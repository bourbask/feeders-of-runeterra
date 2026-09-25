/**
 * « Pourquoi ? » — `c2s.why`, et la preuve qu'il ne mute rien (P22).
 *
 * LE CENT VIENT DU CRITÈRE, donc il est écrit en toutes lettres. Ce qui n'en
 * vient pas — le code d'erreur — est comparé à l'UNION FERMÉE `APP_ERROR_CODES`
 * exportée par `@for/contracts`, pas à la chaîne que le serveur a choisie : le
 * critère dit « un code qui appartient à l'union », pas « ce code-là ».
 *
 * LA SONDE DE MUTATION EST DANS LA SUITE, pas dans un compte rendu. Le dernier
 * test allume `mutateOnProof` sur le faux service et exige que le compteur
 * bouge : sans lui, « le journal n'a pas grandi » pourrait être vrai parce que
 * rien ne fait jamais grandir ce journal, et l'assertion serait vide.
 */

import { APP_ERROR_CODES } from '@for/contracts';
import type { CampaignId } from '@for/engine';
import { describe, expect, it } from 'vitest';

import {
  ALICE,
  CAMPAIGN,
  OTHER_CAMPAIGN,
  Table,
  aProof,
  aUuid,
  c2s,
} from './support/harness.test.js';

const TURN = aUuid(777);

/** Le critère d'acceptation, en toutes lettres. */
const CALLS = 100;

describe('`c2s.why`', () => {
  it('rend un `s2c.turn_proof` portant le même `correlationId`', async () => {
    const table = new Table();
    table.service.proofs.set(`${CAMPAIGN}|${TURN}`, { proof: aProof(TURN), truncated: false });

    const alice = await table.join(ALICE);
    alice.socket.clear();
    await alice.connection.receive(c2s('c2s.why', { correlationId: TURN }, table.nextFrameId()));

    const frame = alice.socket.of('s2c.turn_proof')[0];
    expect(frame?.p['correlationId']).toBe(TURN);
    expect((frame?.p['proof'] as { correlationId: string }).correlationId).toBe(TURN);
    expect(frame?.p['truncated']).toBe(false);
  });

  it('reporte la troncature telle que le service la rend, sans la décider', async () => {
    const table = new Table();
    table.service.proofs.set(`${CAMPAIGN}|${TURN}`, { proof: aProof(TURN), truncated: true });

    const alice = await table.join(ALICE);
    alice.socket.clear();
    await alice.connection.receive(c2s('c2s.why', { correlationId: TURN }, table.nextFrameId()));

    expect(alice.socket.of('s2c.turn_proof')[0]?.p['truncated']).toBe(true);
  });

  it("répond un `s2c.error` dont le code appartient à l'union fermée quand le tour est inconnu", async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    await alice.connection.receive(
      c2s('c2s.why', { correlationId: aUuid(1234) }, table.nextFrameId()),
    );

    expect(alice.socket.of('s2c.turn_proof')).toHaveLength(0);
    const error = alice.socket.of('s2c.error')[0];
    expect(APP_ERROR_CODES).toContain(error?.p['code']);
  });

  it("un `correlationId` d'une AUTRE campagne est traité comme inconnu, jamais servi", async () => {
    const table = new Table();
    // La preuve existe — mais dans une autre table.
    table.service.proofs.set(`${OTHER_CAMPAIGN}|${TURN}`, {
      proof: aProof(TURN),
      truncated: false,
    });

    const alice = await table.join(ALICE);
    alice.socket.clear();
    await alice.connection.receive(c2s('c2s.why', { correlationId: TURN }, table.nextFrameId()));

    expect(alice.socket.of('s2c.turn_proof')).toHaveLength(0);
    expect(APP_ERROR_CODES).toContain(alice.socket.of('s2c.error')[0]?.p['code']);
    // Et rien de la preuve de l'autre table n'a été écrit sur la socket.
    expect(alice.socket.sent.some((line) => line.includes('"proof"'))).toBe(false);
  });

  it('interroge le service avec la campagne DE LA SOCKET, pas une campagne fournie par le client', async () => {
    const table = new Table();
    const seen: string[] = [];
    const original = table.service.getTurnProof.bind(table.service);
    table.service.getTurnProof = (campaignId: CampaignId, correlationId: string) => {
      seen.push(campaignId);
      return original(campaignId, correlationId);
    };

    const alice = await table.join(ALICE);
    await alice.connection.receive(c2s('c2s.why', { correlationId: TURN }, table.nextFrameId()));

    expect(seen).toStrictEqual([CAMPAIGN]);
  });

  it(`ne mute rien après ${String(CALLS)} appels : ni le journal, ni une narration`, async () => {
    const table = new Table();
    table.service.proofs.set(`${CAMPAIGN}|${TURN}`, { proof: aProof(TURN), truncated: false });

    const alice = await table.join(ALICE);
    const journalBefore = table.service.journal.length;
    const narrationsBefore = table.service.narrationsStarted;
    const submitsBefore = table.service.submitCalls;

    for (let i = 0; i < CALLS; i += 1) {
      // Dix par fenêtre : au-delà, c'est la limitation de débit qu'on
      // mesurerait, pas l'absence de mutation.
      if (i % 10 === 0) table.clock.advance(10_001);
      await alice.connection.receive(c2s('c2s.why', { correlationId: TURN }, table.nextFrameId()));
    }

    expect(table.service.proofCalls).toBe(CALLS);
    expect(table.service.journal).toHaveLength(journalBefore);
    expect(table.service.narrationsStarted).toBe(narrationsBefore);
    expect(table.service.submitCalls).toBe(submitsBefore);
    expect(alice.socket.of('s2c.turn_proof')).toHaveLength(CALLS);
  });

  it('et le compteur mord : une lecture qui écrirait ferait tomber le test précédent', async () => {
    const table = new Table();
    table.service.proofs.set(`${CAMPAIGN}|${TURN}`, { proof: aProof(TURN), truncated: false });
    table.service.mutateOnProof = true;

    const alice = await table.join(ALICE);
    const before = table.service.journal.length;
    await alice.connection.receive(c2s('c2s.why', { correlationId: TURN }, table.nextFrameId()));

    expect(table.service.journal.length).toBe(before + 1);
  });
});
