/**
 * `content/assets/*.json` (03-donnees.md section 4.7).
 */

import { z } from 'zod';

import { EffectSchema } from '../core/effects.js';
import { FrTextSchema, SlugSchema, TagsSchema } from './common.js';

export const AssetSchema = z.object({
  schemaVersion: z.literal(1),
  id: SlugSchema,
  name: FrTextSchema,
  category: z.enum(['compagnon', 'chemin', 'talent', 'rituel', 'equipement']),
  text: FrTextSchema,
  abilities: z
    .array(
      z.object({
        text: FrTextSchema,
        xpCost: z.number().int().min(0).max(3).default(1),
        effects: z.array(EffectSchema).max(4).default([]),
      }),
    )
    .min(1)
    .max(3),
  track: z.object({ label: FrTextSchema, max: z.number().int().min(1).max(5) }).optional(),
  tags: TagsSchema,
});

export type AssetContent = z.output<typeof AssetSchema>;
