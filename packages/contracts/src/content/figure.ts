/**
 * `content/figures/*.json` — a person defined by what they want (ADR 0012
 * decision 2).
 *
 * A figure BECOMES AN `npc` ENTITY. The entity carries the numbers; the figure
 * carries none, and that is a structural property rather than a style rule:
 * this object is STRICT and declares no numeric field at all, so a sheet-like
 * `attributes` or a `strength: 2` is refused at the border. Held by
 * `tests/content/scenario.test.ts` « aucun champ n'est un nombre, hors
 * schemaVersion », which WALKS the shape instead of listing it — measured:
 * adding `strength: z.number().int().optional()` reddens it, and nobody had to
 * edit the test.
 *
 * `disposition` is the engine's `ENTITY_DISPOSITIONS` through
 * `DispositionSchema`. Not a second list: the project already pays for one
 * (`ai/tools.ts`, five values against the engine's four), and S-01's brief
 * names that as the mistake not to repeat.
 */

import { z } from 'zod';

import { DispositionSchema, FrTextSchema, RefSchema, SlugSchema, TagsSchema } from './common.js';

export const FigureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: SlugSchema,
  name: FrTextSchema,
  /** What she is after. The engine of every scene she is in. */
  wants: FrTextSchema.max(240),
  /** What she will not do, whatever it costs. This is what makes her a person. */
  refuses: FrTextSchema.max(240),
  /** What she knows and others do not. Section 3: a node's lead often IS this. */
  knows: FrTextSchema.max(240),
  disposition: DispositionSchema,
  /** `null` for someone who belongs to nobody. */
  factionId: RefSchema('faction').nullable(),
  periodId: RefSchema('period'),
  tags: TagsSchema,
});

export type FigureContent = z.output<typeof FigureSchema>;
