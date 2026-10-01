/**
 * `content/regions/*.json` (03-donnees.md section 4.7).
 *
 * `parentId` must form a FOREST, not a graph. That check needs every region at
 * once, so it belongs to pass 4 of the loader (M0-14), not to a per-file
 * schema: a single file cannot see a cycle it is part of.
 *
 * `REGION_KINDS` IS EXPORTED BECAUSE A SECOND FILE NEEDS IT. S-01's
 * `encounter.ts` says which kinds of region an encounter may appear in; typing
 * that tuple again would be a second answer to "what kinds of region exist".
 * It mirrors nothing in the engine — the engine has no notion of a region —
 * so it is owned here, and pinned in full letters by
 * `tests/content/scenario.test.ts` « REGION_KINDS ».
 */

import { z } from 'zod';

import { FrTextSchema, RankSchema, RefSchema, SlugSchema, TagsSchema } from './common.js';

export const REGION_KINDS = ['royaume', 'territoire', 'etablissement', 'site', 'etendue'] as const;

export const RegionKindSchema = z.enum(REGION_KINDS);

export type RegionKind = z.output<typeof RegionKindSchema>;

export const RegionSchema = z.object({
  schemaVersion: z.literal(1),
  id: SlugSchema,
  name: FrTextSchema,
  parentId: RefSchema('region').nullable(),
  kind: RegionKindSchema,
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
