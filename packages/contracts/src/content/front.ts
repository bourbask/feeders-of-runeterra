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
 *
 * ── ONE DIALECT OF REFUSAL ───────────────────────────────────────────────
 * The message opens with `scenarioRuleHead(SCENARIO_RULES.portentsPerSegment)`,
 * exactly like the four of the graph pass. Before S-06 it named the front and
 * stopped there, so one graph answered in two shapes.
 */

import { z } from 'zod';

import { FrTextSchema, RefSchema, SegmentCountSchema, SlugSchema, TagsSchema } from './common.js';
import { SCENARIO_RULES, scenarioRuleHead } from './scenario-rules.js';

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
        `${scenarioRuleHead(SCENARIO_RULES.portentsPerSegment)}le front « ${front.id} » a ` +
        `${String(front.portents.length)} présage(s) pour ${String(front.segments)} segment(s). ` +
        (front.portents.length < front.segments
          ? `Ajoutez ${String(front.segments - front.portents.length)} présage(s), `
          : `Retirez ${String(front.portents.length - front.segments)} présage(s), `) +
        `ou changez « segments ».`,
    });
  });

export type FrontContent = z.output<typeof FrontSchema>;
