/**
 * `ForgeOutputSchema` — the strict SUBSET of a champion sheet a model is
 * allowed to fill (02-mj-ia.md section 9.4, 03-donnees.md section 4.7).
 *
 * THE FORGE HAS NO PRIVILEGE. There is one champion schema, and a forged sheet
 * passes exactly the same one as a handwritten sheet. This is a derivation of
 * `ChampionSchema`, never a parallel shape: the server completes the six
 * omitted fields and then revalidates the WHOLE object with `ChampionSchema`
 * (V12, "la porte finale, aucune fiche ne l'esquive").
 *
 * THE SIX OMISSIONS, EACH FOR ITS OWN REASON:
 *
 *   schemaVersion  imposed by the server
 *   id             imposed by the server: the slug of the request
 *   source         always 'forged', imposed by the server
 *   portraitUrl    never invented by a model
 *   relations      a forged sheet cites NO other champion (prompt rule 8)
 *   aliases        a model never chooses the names it will be recognised
 *                  under; they come from `content/champions-index.json`, and
 *                  they are what the whole distribution lock runs on
 *                  (`no_reserved_champion`, `check_name_allowed`)
 *
 * ── WHY THIS IS NOT LITERALLY `ChampionSchema.omit({...})` ──────────────────
 * Because that call THROWS, at module load, with "`.omit()` cannot be used on
 * object schemas containing refinements". `ChampionSchema` ends in a
 * `.superRefine()` (self-relation, duplicate trait ids) and Zod 4 refuses to
 * derive from a refined object — the checks would be carried onto a shape
 * whose fields they no longer describe.
 *
 * So the omission is done on the SHAPE, which is the same derivation by
 * another road: the key set still comes from `ChampionSchema` and nothing is
 * retyped by hand. `tests/ai/forge.test.ts` compares the two key sets rather
 * than a written list, so a field added to the champion sheet lands here
 * automatically and a field that stops existing reddens.
 *
 * WHAT THE DETOUR COSTS, SAID OUT LOUD: the two cross-field checks do not
 * travel. The self-relation check is moot (`relations` is omitted). The
 * duplicate-trait-id check is NOT re-run here — it is re-run by V12, on the
 * completed object, before insertion. A forged sheet with two traits sharing
 * an `id` is therefore caught one step later than a handwritten one, never
 * not at all.
 */

import { z } from 'zod';

import { ChampionSchema } from '../content/champion.js';

/**
 * The six fields the server owns. Written once, as a tuple, so the schema and
 * the test cannot disagree about which they are.
 */
export const FORGE_OMITTED_FIELDS = [
  'schemaVersion',
  'id',
  'source',
  'portraitUrl',
  'relations',
  'aliases',
] as const satisfies readonly (keyof typeof ChampionSchema.shape)[];

export type ForgeOmittedField = (typeof FORGE_OMITTED_FIELDS)[number];

/** The `.omit()` mask, BUILT from the tuple so the two cannot disagree. */
const OMIT_MASK = Object.fromEntries(FORGE_OMITTED_FIELDS.map((field) => [field, true])) as Record<
  ForgeOmittedField,
  true
>;

/**
 * `z.object(ChampionSchema.shape)` rebuilds the champion object WITHOUT its
 * refinements, and `.omit()` then works exactly as section 9.4 writes it. Same
 * derivation, same key set, same single owner — only the refined wrapper is
 * left behind, and the file header says what that costs.
 */
export const ForgeOutputSchema = z.object(ChampionSchema.shape).omit(OMIT_MASK);

export type ForgeOutput = z.output<typeof ForgeOutputSchema>;
