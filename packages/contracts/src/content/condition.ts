/**
 * `content/conditions.json` (03-donnees.md section 4.7).
 *
 * A flat list rather than one file per condition: small, tightly coupled,
 * never referenced individually in a PR.
 */

import { z } from 'zod';

import { FrTextSchema, SlugSchema } from './common.js';

export const ConditionSchema = z.object({
  id: SlugSchema,
  name: FrTextSchema,
  kind: z.enum(['physique', 'morale', 'lien', 'fardeau']),
  text: FrTextSchema,
  /** Some marks lower the reset instead of blocking it. */
  blocksMomentumReset: z.boolean().default(false),
  momentumMaxPenalty: z.number().int().min(0).max(4).default(1),
  clearMoveHint: FrTextSchema,
});

export const ConditionsFileSchema = z.object({
  schemaVersion: z.literal(1),
  conditions: z.array(ConditionSchema).min(1),
});

export type ConditionContent = z.output<typeof ConditionSchema>;
