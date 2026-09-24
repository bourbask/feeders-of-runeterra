/**
 * Shared primitives of the game-content schemas (03-donnees.md section 4.2).
 *
 * TWO NAMES LIVE ELSEWHERE, ON PURPOSE. Section 4.2 prints
 * `AttributeSpreadSchema` here and section 4.3 prints `EffectSchema` next
 * door; both were already delivered by M0-05, in `src/core/attributes.ts` and
 * `src/core/effects.ts`. Redeclaring either would be two answers to the single
 * question ADR 0006 exists to close ("how many modes does `pay_price` have"),
 * and `src/index.ts` star-exports `core/` and `content/` side by side — a name
 * exported by two starred modules is dropped from the barrel in silence. So
 * this folder IMPORTS them and never re-exports them.
 *
 * The enums below are ALIASES of `src/core/enums.ts` for the same reason: the
 * engine tuple is mirrored once, guarded in both directions there, and section
 * 4.2's names point at that single owner instead of a second copy.
 */

import { z } from 'zod';

import { zAttributeId, zGaugeId, zProgressRank } from '../core/enums.js';
import { zNonEmptyText, zSlug } from '../primitives.js';

/** kebab-case ASCII slug. Section 4.2's name for `zSlug`. */
export const SlugSchema = zSlug;

/** French text, trimmed, never empty. Section 4.2's name for `zNonEmptyText`. */
export const FrTextSchema = zNonEmptyText;

export const AttributeKeySchema = zAttributeId;
export type AttributeKey = z.infer<typeof AttributeKeySchema>;

export const GaugeKeySchema = zGaugeId;

export const RankSchema = zProgressRank;
export type Rank = z.infer<typeof RankSchema>;

/**
 * Ticks granted by one milestone, by rank.
 *
 * A FLAT RECOPY of the engine's `TICKS_PER_MILESTONE`, and it had to be one:
 * `contracts-ne-depend-que-de-zod` forbids importing an engine VALUE. A
 * recopied number is worse than a recopied enum — the compiler only ever sees
 * `number` — so the pair of lists is compared member by member at runtime in
 * `tests/exhaustive-union.test.ts`, per the operating rule of ADR 0007. That
 * comparison is the only thing that reddens if the engine retunes a rank.
 */
export const RANK_TICKS: Readonly<Record<Rank, number>> = {
  genant: 12,
  dangereux: 8,
  redoutable: 4,
  extreme: 2,
  epique: 1,
};

export const TagsSchema = z.array(SlugSchema).max(12).default([]);

/**
 * A reference to another content entity.
 *
 * The `ref:<kind>` marker is NOT decoration: pass 3 of the loader (section 4.8,
 * M0-14) walks the schema looking for `.describe('ref:…')` and checks every
 * matching value against the loaded index, with a Levenshtein suggestion on
 * failure. A reference written as a bare `SlugSchema` is a reference nobody
 * resolves.
 */
export const RefSchema = (kind: string): z.ZodString => SlugSchema.describe(`ref:${kind}`);
