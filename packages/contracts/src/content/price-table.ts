/**
 * `content/tables/pay-the-price.json` — the d12 (03-donnees.md section 4.6).
 *
 * ADR 0006 / P10: the ENGINE rolls, applies the drawn entry, and hands it to
 * the storyteller as an imposed fact. `suggestedEffects` keeps its inherited
 * name and is nothing of the sort — nobody is offered anything. Several
 * effects means a second draw on the `price` RNG stream, and the index goes
 * into `roll.price_paid.effectIndex`.
 *
 * `keywords` IS NOT OPTIONAL. The hard assertion `price_respected`
 * (02-mj-ia.md section 8.4), which doubles as a production post-filter, looks
 * for those words in the narration to check that the imposed price was staged
 * and not quietly swapped for something else. Without the list, the assertion
 * has nothing to score against — so a missing `keywords` is a silent hole in a
 * production filter, not a documentation gap.
 */

import { z } from 'zod';

import { EffectSchema } from '../core/effects.js';
import { FrTextSchema, TagsSchema } from './common.js';
import { OracleEntrySchema, coversDie } from './oracle.js';

/** No digit: a keyword is a word of the scene, never a rule number. */
export const PRICE_KEYWORD_MAX = 40;

export const PriceKeywordSchema = FrTextSchema.max(PRICE_KEYWORD_MAX).refine(
  (word) => !/\d/.test(word),
  { message: 'un mot-clé de prix ne contient aucun chiffre' },
);

export const PriceEntrySchema = OracleEntrySchema.extend({
  severity: z.enum(['legere', 'serieuse', 'grave']),
  suggestedEffects: z.array(EffectSchema).max(3).default([]),
  keywords: z.array(PriceKeywordSchema).min(1).max(6),
});

export const PriceTableSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.literal('pay-the-price'),
    kind: z.literal('price'),
    die: z.literal(12),
    entries: z.array(PriceEntrySchema).length(12),
    tags: TagsSchema,
  })
  .superRefine((table, ctx) => {
    coversDie(table.entries, 12, ctx);
  });

export type PriceTableContent = z.output<typeof PriceTableSchema>;
