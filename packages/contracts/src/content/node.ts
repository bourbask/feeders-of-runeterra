/**
 * `content/nodes/*.json` — a situation, and the ways out of it (ADR 0012
 * decision 2, `04-scenarios.md` section 3).
 *
 * A node BECOMES A SCENE when the party arrives. It describes a STATE — who is
 * there, what is at stake — and never a sequence of events: `situation`, not
 * `déroulé`. That distinction is the whole of `Don't Prep Plots`.
 *
 * ── THE THREE-CLUE RULE, INVERTED, AND WHAT IT REALLY REQUIRES ───────────
 * "Three leads and the scenario cannot stall" is only true if the three leads
 * go to three DIFFERENT places. Three entries pointing at one node is one way
 * out written three times — a rail with extra words — and a lead pointing back
 * at its own node is not a way out at all. The schema therefore asks for three
 * DISTINCT destinations, none of them itself — held by
 * `tests/content/scenario.test.ts` « trois pistes vers le même nœud ne font
 * pas trois sorties » and « une piste qui revient au même nœud n'est pas une
 * sortie », against the green « trois passe, deux échoue ».
 *
 * `SCENARIO_NODE_KINDS` MIRRORS NOTHING. The engine has no node; the tuple is
 * owned here and, per the operating rule of ADR 0007, pinned IN FULL LETTERS
 * by `tests/content/scenario.test.ts` « SCENARIO_NODE_KINDS » rather than
 * "compared" to a list that does not exist.
 */

import { z } from 'zod';

import { FrTextSchema, RefSchema, SlugSchema, TagsSchema } from './common.js';

export const SCENARIO_NODE_KINDS = ['lieu', 'confrontation', 'rencontre', 'revelation'] as const;

export const NodeKindSchema = z.enum(SCENARIO_NODE_KINDS);

export type ScenarioNodeKind = z.output<typeof NodeKindSchema>;

/**
 * How many ways out a node must offer.
 *
 * FOR THE CODE, NOT FOR THE ASSERTIONS. A test of this rule — here, or in
 * S-02's graph pass — writes `3` in full letters, because a test that reads
 * its bound from the schema it checks compares a number to itself and proves
 * nothing (ADR 0007, corollaire du 25 septembre).
 */
export const MIN_LEADS_PER_NODE = 3;

export const LeadSchema = z.strictObject({
  toNodeId: RefSchema('node'),
  /** What makes the party take this way out. One sentence, never a condition. */
  trigger: FrTextSchema.max(240),
});

export type LeadContent = z.output<typeof LeadSchema>;

export const NodeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: SlugSchema,
    name: FrTextSchema,
    kind: NodeKindSchema,
    /** The state of the place, never what happens in it. */
    situation: FrTextSchema.max(1200),
    /** Section 4: what this node is there to find out. */
    stakeQuestion: FrTextSchema.max(240),
    figureIds: z.array(RefSchema('figure')).max(6).default([]),
    regionId: RefSchema('region'),
    periodId: RefSchema('period'),
    /**
     * A node the party may start at.
     *
     * S-02 rule 2 refuses a node reachable from nowhere UNLESS it declares
     * itself an entry point. Without this field every graph would have an
     * orphan by construction — the one the party starts at.
     */
    entryPoint: z.boolean().default(false),
    leads: z.array(LeadSchema).max(8),
    tags: TagsSchema,
  })
  .superRefine((node, ctx) => {
    const destinations = new Set<string>();
    for (const [index, lead] of node.leads.entries()) {
      if (lead.toNodeId === node.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['leads', index, 'toNodeId'],
          message: `nœud « ${node.id} » : une piste qui revient au même nœud n'est pas une sortie`,
        });
        continue;
      }
      if (destinations.has(lead.toNodeId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['leads', index, 'toNodeId'],
          message:
            `nœud « ${node.id} » : la piste vers « ${lead.toNodeId} » est écrite deux fois — ` +
            `trois pistes vers le même endroit ne font qu'une sortie`,
        });
        continue;
      }
      destinations.add(lead.toNodeId);
    }

    if (destinations.size >= MIN_LEADS_PER_NODE) return;
    ctx.addIssue({
      code: 'custom',
      path: ['leads'],
      message:
        `nœud « ${node.id} » : ${String(destinations.size)} sortie(s) distincte(s) pour ` +
        `${String(MIN_LEADS_PER_NODE)} exigée(s) — ajoutez des pistes vers d'autres nœuds`,
    });
  });

export type NodeContent = z.output<typeof NodeSchema>;
