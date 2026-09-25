/**
 * `content/hooks/*.json` — the ressort: why THESE characters (ADR 0012
 * decisions 2 and 3).
 *
 * A hook BECOMES A VOW plus a few BONDS. It is the only piece of step B: it
 * cannot be chosen before the party exists, because `appliesTo` reads the
 * sheets — a tag, a faction, a region, or a champion by name.
 *
 * `vowRank` is the engine's `PROGRESS_RANKS` through `RankSchema`: the vow it
 * becomes is a progress track, and its rank decides the ticks a milestone is
 * worth (`RANK_TICKS`). A fresh tuple of ranks here would be a second answer
 * to a question the engine already closes.
 *
 * ── TWO FIELDS BEYOND THE BRIEF, AND WHY ─────────────────────────────────
 * `name` — every other content file is addressed by its id and displayed by
 * its name, and pass 4 checks id against the file name. A hook with no name
 * would be the only piece the loader's report cannot print in French.
 * `periodId` — S-04 filters every candidate list by period. A hook without one
 * could not be filtered, and step B would be free to hang a modern faction's
 * ressort on a party playing before the Sisters. Both declared in the PR.
 *
 * `appliesTo.kind === 'trait'` carries a bare `SlugSchema`, not a reference:
 * champion sheets spell their traits in a free `tags` array that no index
 * resolves. Said here rather than left to be discovered.
 */

import { z } from 'zod';

import { FrTextSchema, RankSchema, RefSchema, SlugSchema, TagsSchema } from './common.js';

export const HookAppliesToSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('trait'), tag: SlugSchema }),
  z.strictObject({ kind: z.literal('faction'), factionId: RefSchema('faction') }),
  z.strictObject({ kind: z.literal('region'), regionId: RefSchema('region') }),
  z.strictObject({ kind: z.literal('champion'), championId: RefSchema('champion') }),
]);

export type HookAppliesTo = z.output<typeof HookAppliesToSchema>;

export const HookSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: SlugSchema,
  name: FrTextSchema,
  appliesTo: HookAppliesToSchema,
  /** Why this band, said to this band. One paragraph at most. */
  pitch: FrTextSchema.max(400),
  vowRank: RankSchema,
  /** The figures this ressort ties the party to. A bond attaches to somebody. */
  suggestedBondIds: z.array(RefSchema('figure')).max(4).default([]),
  periodId: RefSchema('period'),
  tags: TagsSchema,
});

export type HookContent = z.output<typeof HookSchema>;
