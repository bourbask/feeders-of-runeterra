/**
 * `zTurnProof` — the proof a turn unfolds behind the « Pourquoi ? » command
 * (P22, 01-architecture.md section 5.4, 02-mj-ia.md section 4.8.6).
 *
 * THIS IS NOT A MIRROR OF THE ENGINE. It is a PROJECTION of the journal: the
 * server reads the events of one `correlationId` group and folds them into
 * this shape. Nothing here is stored, and nothing here is derived from
 * anything but journal lines. It is therefore the one file in `src/` with no
 * `satisfies z.ZodType<...>`, on purpose — there is no engine type to mirror.
 *
 * FOUR PROPERTIES THE SHAPE ITSELF ENFORCES, because a proof that could lie
 * would be worse than no proof:
 *
 *   1. EVERY ENTRY CARRIES ITS `eventSeq`. That is what makes the proof
 *      verifiable: one can walk back from a label to the journal line that
 *      establishes it. An entry without `eventSeq` would be data fabricated
 *      for display, which is exactly what P22 forbids — so `eventSeq` is
 *      required on `move`, `roll`, `revision`, each `effects` entry, `price`,
 *      `presage` and `narration`.
 *   2. `.strict()`. An unknown key is refused rather than dropped. A proof
 *      that silently accepted extra fields would let a future caller smuggle
 *      something in and have it ignored by the schema but rendered by a
 *      client.
 *   3. AT MOST 32 EFFECTS, 120 CHARACTERS PER LABEL, 400 PER TEXT. Together
 *      they keep a serialised proof under the 8 KiB ceiling, which keeps it
 *      far from the 256 KiB outgoing frame. Past the bound the server answers
 *      `truncated: true` and the client falls back to
 *      `GET /api/campaigns/:id/log` — it does not trim the proof itself.
 *   4. A REVERTED TURN IS STILL A PROOF. `status: 'reverted'` with
 *      `revertedBy { seq, reason }` is a first-class, accepted value: the
 *      cancelled turn stays on screen, struck through, with its proof
 *      readable (03-donnees.md section 3.7, point 5). Nothing is erased.
 *
 * THE PROOF SHOWS NOTHING OF THE MODEL: no reasoning, no tool call, no
 * rejected proposal (02-mj-ia.md section 6.5). `narration` carries an
 * `eventSeq` and a source, and that is all.
 */

import { z } from 'zod';

import { zCorrelationId, zEventSeq, zSeq } from '../primitives.js';

/** Hard bound on the effect list. The 33rd entry is refused, not dropped. */
export const TURN_PROOF_MAX_EFFECTS = 32;
/** Hard bound on any single human-readable label. */
export const TURN_PROOF_LABEL_MAX = 120;
/** Hard bound on a copied content text (price entry, presage entry). */
export const TURN_PROOF_TEXT_MAX = 400;
/** Serialised ceiling. Past it the server sets `truncated: true`. */
export const TURN_PROOF_MAX_BYTES = 8 * 1024;

const zLabel = z.string().max(TURN_PROOF_LABEL_MAX);
const zText = z.string().max(TURN_PROOF_TEXT_MAX);

export const zTurnProofEffect = z.strictObject({
  eventSeq: zEventSeq,
  type: z.string(),
  label: zLabel,
});

export const zTurnProof = z.strictObject({
  correlationId: zCorrelationId,
  firstSeq: zSeq,
  lastSeq: zSeq,
  status: z.enum(['applied', 'reverted']),
  revertedBy: z.strictObject({ seq: zSeq, reason: zLabel }).nullable(),
  move: z
    .strictObject({
      eventSeq: zEventSeq,
      moveId: z.string(),
      attribute: z.string().nullable(),
      bonus: z.number().int().nullable(),
      label: zLabel,
    })
    .nullable(),
  roll: z
    .strictObject({
      eventSeq: zEventSeq,
      rngStream: z.string(),
      rngDrawIndex: z.number().int(),
      action: z.number().int(),
      challenge: z.tuple([z.number().int(), z.number().int()]),
      total: z.number().int(),
      outcome: z.string(),
    })
    .nullable(),
  /** The momentum burn, when there was one. */
  revision: z.strictObject({ eventSeq: zEventSeq, label: zLabel }).nullable(),
  effects: z.array(zTurnProofEffect).max(TURN_PROOF_MAX_EFFECTS),
  price: z
    .strictObject({
      eventSeq: zEventSeq,
      entryId: z.string(),
      text: zText,
      value: z.number().int(),
      effectIndex: z.number().int().nullable(),
    })
    .nullable(),
  presage: z.strictObject({ eventSeq: zEventSeq, entryId: z.string(), text: zText }).nullable(),
  narration: z.strictObject({ eventSeq: zEventSeq, source: z.enum(['ai', 'engine']) }).nullable(),
});

export type TurnProofDto = z.output<typeof zTurnProof>;
export type TurnProofEffectDto = z.output<typeof zTurnProofEffect>;
