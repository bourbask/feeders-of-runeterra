/**
 * Oracle tables (03-donnees.md section 4.6).
 *
 * `coversDie` is the most useful guarantee the loader has. A d12 table missing
 * one entry does not show up in review, but in play it produces an `undefined`
 * that travels all the way into the storyteller prompt. Here, the server does
 * not start.
 */

import { z } from 'zod';

import { zLikelihood } from '../core/enums.js';
import { FrTextSchema, RefSchema, SlugSchema, TagsSchema } from './common.js';

export const DieSizeSchema = z.union([
  z.literal(4),
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
  z.literal(20),
  z.literal(100),
]);

export const OracleEntrySchema = z
  .object({
    id: SlugSchema,
    min: z.number().int().positive(),
    max: z.number().int().positive(),
    text: FrTextSchema,
    tags: TagsSchema,
    /** Chaining: roll on another table next (place -> name). */
    chain: z.array(RefSchema('oracle')).max(3).default([]),
  })
  .refine((entry) => entry.max >= entry.min, { message: 'max doit être ≥ min' });

/**
 * Exact, gapless coverage of a die.
 *
 * THREE DISTINCT MESSAGES, and the distinction is the point: a gap and an
 * overlap are different mistakes with different fixes, and a single "table
 * invalide" would send the author looking in the wrong place.
 */
export const coversDie = (
  entries: readonly { min: number; max: number }[],
  die: number,
  ctx: z.RefinementCtx,
): void => {
  const sorted = [...entries].sort((a, b) => a.min - b.min);
  let cursor = 1;
  for (const entry of sorted) {
    if (entry.min !== cursor) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message:
          entry.min > cursor
            ? `trou dans la table : ${String(cursor)}..${String(entry.min - 1)} non couvert`
            : `chevauchement à ${String(entry.min)} (déjà couvert jusqu'à ${String(cursor - 1)})`,
      });
      return;
    }
    cursor = entry.max + 1;
  }
  if (cursor !== die + 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['entries'],
      message: `table incomplète : ${String(cursor)}..${String(die)} non couvert`,
    });
  }
};

export const OracleTableSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: SlugSchema,
    name: FrTextSchema,
    kind: z.literal('table'),
    die: DieSizeSchema,
    /** When the storyteller is meant to reach for it. */
    usage: FrTextSchema,
    entries: z.array(OracleEntrySchema).min(2),
    tags: TagsSchema,
  })
  .superRefine((table, ctx) => {
    coversDie(table.entries, table.die, ctx);
  });

/**
 * The d100 thresholds of the weighted yes/no oracle.
 *
 * A FLAT RECOPY of the engine's `LIKELIHOOD_THRESHOLDS` — a value import is
 * forbidden here (`contracts-ne-depend-que-de-zod`). Written as a named
 * constant rather than inline literals so that
 * `tests/exhaustive-union.test.ts` has something to compare, member by member,
 * against the engine's table (ADR 0007's operating rule).
 */
export const YESNO_THRESHOLDS = {
  'quasi-certain': 90,
  probable: 75,
  incertain: 50,
  'peu-probable': 25,
  improbable: 10,
} as const;

export const YesNoOracleSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal('yes-no'),
  kind: z.literal('yes-no'),
  die: z.literal(100),
  /** Value ≤ threshold ⇒ "oui". */
  likelihoods: z.object({
    'quasi-certain': z.literal(YESNO_THRESHOLDS['quasi-certain']),
    probable: z.literal(YESNO_THRESHOLDS.probable),
    incertain: z.literal(YESNO_THRESHOLDS.incertain),
    'peu-probable': z.literal(YESNO_THRESHOLDS['peu-probable']),
    improbable: z.literal(YESNO_THRESHOLDS.improbable),
  }),
  /** Doubles (11, 22, …) ⇒ "oui, mais" / "non, et": an imposed reversal. */
  extremeRule: FrTextSchema,
  extremeTableId: RefSchema('table'),
});

/**
 * The keys the yes/no oracle must carry, derived from the schema rather than
 * retyped, so the comparison against the engine's `Likelihood` union in
 * `tests/exhaustive-union.test.ts` reads the real shape.
 */
export function likelihoodKeysOfSchema(): readonly string[] {
  return Object.keys(YesNoOracleSchema.shape.likelihoods.shape);
}

/** The engine's closed likelihood union, under section 4.6's reading. */
export const LikelihoodKeySchema = zLikelihood;

export type OracleTableContent = z.output<typeof OracleTableSchema>;
export type OracleEntryContent = z.output<typeof OracleEntrySchema>;
