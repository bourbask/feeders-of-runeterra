/**
 * The five attributes, and the only legal spread at creation.
 *
 * The engine declares `ATTRIBUTE_SPREAD = [3, 2, 2, 1, 1]` and says the CHECK
 * itself lives here (`types/attributes.ts`). This is that check.
 */

import { z } from 'zod';

import type { AttributeSpread } from '@for/engine';

import { zAttributeId } from './enums.js';

export const ATTRIBUTE_MIN = 1;
export const ATTRIBUTE_MAX = 3;

/** Sorted descending, the only accepted spread. */
export const ATTRIBUTE_SPREAD_SIGNATURE = '3,2,2,1,1';

const zAttributeValue = z.number().int().min(ATTRIBUTE_MIN).max(ATTRIBUTE_MAX);

/** One value per attribute, unconstrained beyond its range. */
export const zAttributeMap = z.record(zAttributeId, z.number().int()) satisfies z.ZodType<
  Readonly<Record<'vif' | 'coeur' | 'fer' | 'ombre' | 'esprit', number>>
>;

/**
 * Exactly 3/2/2/1/1, in any attribute order. Refused otherwise, with the
 * offending spread in the message so the client can show what was sent.
 */
export const zAttributeSpread = z
  .object({
    vif: zAttributeValue,
    coeur: zAttributeValue,
    fer: zAttributeValue,
    ombre: zAttributeValue,
    esprit: zAttributeValue,
  })
  .refine(
    (spread) =>
      Object.values(spread)
        .sort((a, b) => b - a)
        .join(',') === ATTRIBUTE_SPREAD_SIGNATURE,
    {
      message: `répartition illégale : attendu exactement ${ATTRIBUTE_SPREAD_SIGNATURE}`,
    },
  ) satisfies z.ZodType<AttributeSpread>;

/** The name 03-donnees.md section 4.2 uses. Same schema, single owner. */
export const AttributeSpreadSchema = zAttributeSpread;
