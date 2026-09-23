import { describe, expect, it } from 'vitest';

import {
  TURN_PROOF_LABEL_MAX,
  TURN_PROOF_MAX_BYTES,
  TURN_PROOF_MAX_EFFECTS,
  zTurnProof,
} from './turn-proof.js';

const CORRELATION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const effect = (seq: number) => ({
  eventSeq: seq,
  type: 'character.gauge_changed',
  label: 'Vivres -1',
});

const proof = (over: Record<string, unknown> = {}) => ({
  correlationId: CORRELATION_ID,
  firstSeq: 410,
  lastSeq: 418,
  status: 'applied',
  revertedBy: null,
  move: {
    eventSeq: 410,
    moveId: 'strike',
    attribute: 'fer',
    bonus: null,
    label: 'Frapper le loup',
  },
  roll: {
    eventSeq: 411,
    rngStream: 'action',
    rngDrawIndex: 12,
    action: 4,
    challenge: [7, 9],
    total: 6,
    outcome: 'echec',
  },
  revision: null,
  effects: [effect(412)],
  price: {
    eventSeq: 413,
    entryId: 'perte-de-vivres',
    text: 'Le sac se déchire dans la bourrasque.',
    value: 7,
    effectIndex: 0,
  },
  presage: null,
  narration: { eventSeq: 418, source: 'ai' },
  ...over,
});

describe('zTurnProof — la preuve d’un tour (P22)', () => {
  it('accepte une preuve complète', () => {
    expect(zTurnProof.safeParse(proof()).success).toBe(true);
  });

  it('accepte 32 effets', () => {
    const effects = Array.from({ length: TURN_PROOF_MAX_EFFECTS }, (_, i) => effect(420 + i));
    expect(zTurnProof.safeParse(proof({ effects })).success).toBe(true);
  });

  it('refuse 33 effets', () => {
    const effects = Array.from({ length: TURN_PROOF_MAX_EFFECTS + 1 }, (_, i) => effect(420 + i));
    expect(zTurnProof.safeParse(proof({ effects })).success).toBe(false);
  });

  it('refuse une entrée d’effets sans eventSeq', () => {
    // Une entrée sans provenance est une donnée fabriquée pour l'affichage,
    // exactement ce que P22 interdit.
    const result = zTurnProof.safeParse(
      proof({ effects: [{ type: 'character.gauge_changed', label: 'Vivres -1' }] }),
    );
    expect(result.success).toBe(false);
  });

  it.each(['move', 'roll', 'revision', 'price', 'presage', 'narration'])(
    'refuse une entrée « %s » sans eventSeq',
    (key) => {
      const base = proof();
      const entry = { ...(base[key as keyof typeof base] as Record<string, unknown> | null) };
      delete entry['eventSeq'];
      expect(zTurnProof.safeParse(proof({ [key]: entry })).success).toBe(false);
    },
  );

  it('refuse une clé inconnue (.strict)', () => {
    expect(zTurnProof.safeParse(proof({ aiReasoning: 'jamais' })).success).toBe(false);
  });

  it('refuse une clé inconnue dans une entrée d’effets (.strict)', () => {
    const result = zTurnProof.safeParse(
      proof({ effects: [{ ...effect(412), toolCall: 'propose_price' }] }),
    );
    expect(result.success).toBe(false);
  });

  it('accepte une preuve annulée portant revertedBy { seq, reason }', () => {
    const result = zTurnProof.safeParse(
      proof({
        status: 'reverted',
        revertedBy: { seq: 419, reason: 'gm_refusal:target_gone' },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('refuse un statut qui n’est ni applied ni reverted', () => {
    expect(zTurnProof.safeParse(proof({ status: 'pending' })).success).toBe(false);
  });

  it('refuse un libellé de plus de 120 caractères', () => {
    const long = { ...effect(412), label: 'a'.repeat(TURN_PROOF_LABEL_MAX + 1) };
    expect(zTurnProof.safeParse(proof({ effects: [long] })).success).toBe(false);
  });

  it('refuse un correlationId qui n’est pas un UUID', () => {
    expect(zTurnProof.safeParse(proof({ correlationId: 'tour-412' })).success).toBe(false);
  });

  it('une preuve au maximum de ses bornes tient sous 8 Kio', () => {
    // La garantie qui empêche une preuve d'approcher la trame sortante de
    // 256 Kio. M0-08 la reprend sur le message qui la transporte.
    const label = 'a'.repeat(TURN_PROOF_LABEL_MAX);
    const effects = Array.from({ length: TURN_PROOF_MAX_EFFECTS }, (_, i) => ({
      eventSeq: 420 + i,
      type: 'character.gauge_changed',
      label,
    }));
    const maximal = proof({
      effects,
      revertedBy: { seq: 500, reason: label },
      move: { eventSeq: 410, moveId: 'strike', attribute: 'fer', bonus: 2, label },
      revision: { eventSeq: 414, label },
      presage: { eventSeq: 415, entryId: 'presage', text: 'b'.repeat(400) },
      price: {
        eventSeq: 413,
        entryId: 'perte-de-vivres',
        text: 'b'.repeat(400),
        value: 7,
        effectIndex: 0,
      },
    });
    expect(zTurnProof.safeParse(maximal).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(maximal), 'utf8')).toBeLessThan(TURN_PROOF_MAX_BYTES);
  });
});
