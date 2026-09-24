/**
 * `content/truths/*.json` — the campaign truths offered at creation
 * (03-donnees.md section 4.7).
 */

import { z } from 'zod';

import { FrTextSchema, SlugSchema } from './common.js';

export const TruthSchema = z.object({
  id: SlugSchema,
  question: FrTextSchema,
  options: z
    .array(
      z.object({
        id: SlugSchema,
        text: FrTextSchema,
        questHint: FrTextSchema,
        entitySeeds: z
          .array(
            z.object({
              kind: z.enum(['npc', 'place', 'faction']),
              name: FrTextSchema,
              summary: FrTextSchema,
            }),
          )
          .max(4)
          .default([]),
      }),
    )
    .min(2)
    .max(5),
});

export const TruthsFileSchema = z.object({
  schemaVersion: z.literal(1),
  truths: z.array(TruthSchema).min(1),
});

export type TruthContent = z.output<typeof TruthSchema>;
