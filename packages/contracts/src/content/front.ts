/**
 * `content/fronts/*.json` — what advances if nobody intervenes (ADR 0012
 * decision 2, `04-scenarios.md` section 2).
 *
 * A front BECOMES A CLOCK. `segments` is therefore the engine's
 * `CLOCK_SEGMENT_COUNTS` through `SegmentCountSchema`, never a second tuple.
 *
 * ── THE ONE RULE THAT MAKES A FRONT A FRONT ──────────────────────────────
 * `portents` holds EXACTLY `segments` entries: one concrete consequence per
 * segment of the clock it becomes. A front promising more than its clock can
 * hold loses presages at seeding; a front promising fewer leaves a segment
 * with nothing to narrate. BOTH DIRECTIONS are held by
 * `tests/content/scenario.test.ts`, describe « front : les présages comptent
 * exactement les segments » : one `it` removes an entry, the next adds one,
 * and each expects a refusal.
 */

import { z } from 'zod';

import { FrTextSchema, RefSchema, SegmentCountSchema, SlugSchema, TagsSchema } from './common.js';

export const FrontSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: SlugSchema,
    name: FrTextSchema,
    /** What is lost if the clock fills. Section 6, element 4. */
    stake: FrTextSchema.max(400),
    segments: SegmentCountSchema,
    /**
     * One concrete step per segment, in the order they are crossed.
     *
     * No `.min()` / `.max()` here on purpose: a bound copied from the segment
     * tuple would be a number compared to itself. The refinement below is the
     * only thing that decides how many entries are legal, and it reads
     * `segments` from the document.
     */
    portents: z.array(FrTextSchema.max(240)),
    periodId: RefSchema('period'),
    regionIds: z.array(RefSchema('region')).min(1).max(8),
    tags: TagsSchema,
  })
  .superRefine((front, ctx) => {
    if (front.portents.length === front.segments) return;
    ctx.addIssue({
      code: 'custom',
      path: ['portents'],
      message:
        `front « ${front.id} » : ${String(front.portents.length)} présage(s) pour ` +
        `${String(front.segments)} segment(s) — il en faut exactement un par segment`,
    });
  });

export type FrontContent = z.output<typeof FrontSchema>;
