/**
 * `content/periods/*.json` — a slice of the Freljord timeline (ADR 0012
 * decision 2).
 *
 * A period is a FILTER, not a story. Every other scenario piece carries a
 * `periodId`, and S-04 narrows its candidate lists with it; that is the whole
 * mechanism against the anachronism `04-scenarios.md` section 6 names first —
 * a character meeting someone dead for three centuries.
 *
 * ── THE TWO BOUNDS ───────────────────────────────────────────────────────
 * `after` and `before` are MARKS on an abstract timeline, not years: the lore
 * gives no dates, only an order. A mark grows towards the present, so periods
 * sort by `after`. `null` means "unbounded on that side" — the age before the
 * Sisters has no `after`, the modern Freljord has no `before`.
 *
 * ── THE FIELD THAT DOES THE WORK ─────────────────────────────────────────
 * `absentFactionIds` is the one that stops an anachronism, and it has to be
 * EXPLICIT: a faction merely left out of `factionIds` is a faction nobody
 * decided about. Naming it absent is what lets S-03 assert that no piece of
 * this period mentions it.
 *
 * A FACTION IS NOT A FILE. Faction ids live inside `regions/*.json`
 * (`factions[].id`), and pass 3 of the loader resolves `ref:faction` against
 * that set — held by `packages/content/tests/scenario-vocabulary.test.ts`
 * « les factions se résolvent contre les régions, pas contre une liste figée ».
 */

import { z } from 'zod';

import { FrTextSchema, RefSchema, SlugSchema, TagsSchema } from './common.js';

export const PeriodSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: SlugSchema,
    name: FrTextSchema,
    summary: FrTextSchema.max(400),
    /** The period opens after this mark. `null` = since always. */
    after: z.number().int().nullable(),
    /** The period closes before this mark. `null` = until now. */
    before: z.number().int().nullable(),
    /** Factions that exist and act during this period. */
    factionIds: z.array(RefSchema('faction')).max(12).default([]),
    /** Factions that do NOT exist yet, or no longer do. Named, never implied. */
    absentFactionIds: z.array(RefSchema('faction')).max(12).default([]),
    tags: TagsSchema,
  })
  .superRefine((period, ctx) => {
    if (period.after !== null && period.before !== null && period.after >= period.before) {
      ctx.addIssue({
        code: 'custom',
        path: ['before'],
        message:
          `période « ${period.id} » : la borne « before » (${String(period.before)}) doit ` +
          `être strictement supérieure à « after » (${String(period.after)})`,
      });
    }

    const present = new Set(period.factionIds);
    for (const [index, absent] of period.absentFactionIds.entries()) {
      if (!present.has(absent)) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['absentFactionIds', index],
        message:
          `période « ${period.id} » : la faction « ${absent} » est déclarée présente ` +
          `et absente à la fois`,
      });
    }
  });

export type PeriodContent = z.output<typeof PeriodSchema>;
