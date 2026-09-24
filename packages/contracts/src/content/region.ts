/**
 * `content/regions/*.json` (03-donnees.md section 4.7).
 *
 * `parentId` must form a FOREST, not a graph. That check needs every region at
 * once, so it belongs to pass 4 of the loader (M0-14), not to a per-file
 * schema: a single file cannot see a cycle it is part of.
 */

import { z } from 'zod';

import { FrTextSchema, RankSchema, RefSchema, SlugSchema, TagsSchema } from './common.js';

export const RegionSchema = z.object({
  schemaVersion: z.literal(1),
  id: SlugSchema,
  name: FrTextSchema,
  parentId: RefSchema('region').nullable(),
  kind: z.enum(['royaume', 'territoire', 'etablissement', 'site', 'etendue']),
  summary: FrTextSchema.max(400),
  description: FrTextSchema.max(3000),
  dangerRank: RankSchema,
  climate: FrTextSchema,
  factions: z
    .array(z.object({ id: SlugSchema, name: FrTextSchema, stance: FrTextSchema }))
    .max(8)
    .default([]),
  landmarks: z.array(FrTextSchema).max(12).default([]),
  hooks: z.array(FrTextSchema).min(1).max(10),
  oracleRefs: z.array(RefSchema('oracle')).max(8).default([]),
  neighborIds: z.array(RefSchema('region')).max(8).default([]),
  tags: TagsSchema,
});

export type RegionContent = z.output<typeof RegionSchema>;
