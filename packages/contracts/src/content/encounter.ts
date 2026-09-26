/**
 * `content/encounters/*.json` — merchants, allies, beasts, finds, obstacles
 * (ADR 0012 decision 2).
 *
 * AN ENCOUNTER IS NOT SCHEDULED. It is DRAWN AT THE ORACLE, which is why the
 * only thing this file says about when it happens is `oracleRef`: the table
 * that decides. A list of encounters placed along a route would be the
 * programme of meetings `04-scenarios.md` section 2 refuses — "what happens if
 * nobody does anything" is a front's business, not an encounter's.
 *
 * `regionKinds` reuses `REGION_KINDS` from `region.ts`. One answer to "what
 * kinds of region exist", not two.
 *
 * `ENCOUNTER_KINDS` MIRRORS NOTHING in the engine — it is the five families of
 * the brief — so it is owned here and pinned IN FULL LETTERS by
 * `tests/content/scenario.test.ts` « ENCOUNTER_KINDS — les cinq genres de la
 * fiche S-03 », per the operating rule of ADR 0007.
 */

import { z } from 'zod';

import { FrTextSchema, RefSchema, SlugSchema, TagsSchema } from './common.js';
import { REGION_KINDS, RegionKindSchema } from './region.js';

export const ENCOUNTER_KINDS = ['marchand', 'allie', 'bete', 'trouvaille', 'obstacle'] as const;

export const EncounterKindSchema = z.enum(ENCOUNTER_KINDS);

export type EncounterKind = z.output<typeof EncounterKindSchema>;

export const EncounterSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: SlugSchema,
    name: FrTextSchema,
    kind: EncounterKindSchema,
    /** One or two sentences. What the party meets, not what it does about it. */
    summary: FrTextSchema.max(400),
    periodId: RefSchema('period'),
    /**
     * Where this can turn up. The cap is the number of region kinds there are,
     * read from the tuple rather than typed again: listing all of them is legal,
     * listing one twice is refused by the check below.
     */
    regionKinds: z.array(RegionKindSchema).min(1).max(REGION_KINDS.length),
    oracleRef: RefSchema('oracle'),
    tags: TagsSchema,
  })
  .superRefine((encounter, ctx) => {
    const seen = new Set<string>();
    for (const [index, kind] of encounter.regionKinds.entries()) {
      if (!seen.has(kind)) {
        seen.add(kind);
        continue;
      }
      ctx.addIssue({
        code: 'custom',
        path: ['regionKinds', index],
        message: `rencontre « ${encounter.id} » : le genre de région « ${kind} » est écrit deux fois`,
      });
    }
  });

export type EncounterContent = z.output<typeof EncounterSchema>;
