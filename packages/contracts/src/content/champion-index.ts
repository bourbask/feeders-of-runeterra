/**
 * `content/champions-index.json` — the directory of the ~170 champions of
 * Runeterra (03-donnees.md section 4.7).
 *
 * NOT a playable sheet: the table of truth for NAMES. It backs the
 * distribution lock (no reserved champion leaves the storyteller's mouth under
 * any nickname), the character-choice screen, and the forge checks V2
 * (canonical region) and V7 (no other champion cited).
 *
 * THE AMBIGUITY CHECK NORMALISES BEFORE COMPARING. « Bràum » and « braum »
 * are the same name to a player and to a post-filter, so they are the same
 * name here: NFD, diacritics stripped, lowercased, trimmed. An alias shared by
 * two champions makes the lock undecidable, so it is refused rather than
 * arbitrated.
 */

import { z } from 'zod';

import { FrTextSchema, RefSchema, SlugSchema } from './common.js';

/** The normal form the ambiguity check compares on. Exported so the lock uses the same one. */
export function normalizeAlias(alias: string): string {
  return alias
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export const ChampionIndexEntrySchema = z.object({
  id: SlugSchema,
  displayName: FrTextSchema,
  /** `null` when the champion is from no known Runeterran region. */
  canonicalRegionId: RefSchema('region').nullable(),
  aliases: z.array(FrTextSchema).min(1).max(12),
  playable: z.boolean().default(true),
});

export const ChampionIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    champions: z.array(ChampionIndexEntrySchema).min(1),
  })
  .superRefine((index, ctx) => {
    const seen = new Set<string>();
    for (const champion of index.champions) {
      for (const alias of [champion.displayName, ...champion.aliases]) {
        const key = normalizeAlias(alias);
        if (seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['champions'],
            message: `alias ambigu « ${alias} » : partagé par deux champions`,
          });
        }
        seen.add(key);
      }
    }
  });

export type ChampionIndexContent = z.output<typeof ChampionIndexSchema>;
export type ChampionIndexEntryContent = z.output<typeof ChampionIndexEntrySchema>;
