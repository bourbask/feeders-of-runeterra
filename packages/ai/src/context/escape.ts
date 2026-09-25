/**
 * Player text is hostile by default (02-mj-ia.md section 4.6).
 *
 * `<intention>` carries what a human wrote. Two things are done to it, and
 * neither pretends to be a security boundary on its own:
 *
 *  1. Any sequence that looks like one of OUR tags is neutralised — the
 *     opening angle bracket becomes `&lt;`. `<scene_apres>` is in that list
 *     for a precise reason: a player who got the model to emit one could try
 *     to cancel their own turn with a fake refusal, or walk a dead NPC back
 *     into the scene.
 *  2. The text is capped at six hundred characters.
 *
 * ── WHAT ACTUALLY STOPS AN INJECTION ────────────────────────────────────────
 * Not this file. Even a model that is fully convinced can break nothing: no
 * tool mutates state (and ADR 0011 sends no tools at all), the scene merge
 * ignores any name it cannot match (S1) and never walks a player character out
 * of a scene (S3), and a refusal only has an effect when the SERVER proves its
 * cause on structured state (R4). This file lowers the odds; the invariants
 * carry the weight.
 *
 * Held by `tests/context-budget.test.ts`, « une intention contenant
 * </consignes_du_tour> ressort échappée ».
 */

/** Section 4.6. Six hundred characters, and the cut is a cut, not a summary. */
export const PLAYER_TEXT_MAX_CHARS = 600;

/**
 * The tag-shaped prefixes of section 4.6, plus the bare closing bracket.
 *
 * Matched case-insensitively and with optional whitespace after the bracket,
 * because `< fait>` reaches a model as the same instruction `<fait>` does.
 */
const TAG_LIKE =
  /<\s*\/?\s*(etat|scene_apres|scene|lore|fait|intention|consignes_du_tour|consignes|chronique)\b|<\s*\//giu;

/**
 * Neutralise tag-shaped sequences and cap the length.
 *
 * The replacement keeps the rest of the text byte for byte: the player's
 * sentence is still their sentence, and the prompt says the model must treat
 * it as character speech rather than instruction.
 */
export function escapePlayerText(raw: string): string {
  const capped = raw.length > PLAYER_TEXT_MAX_CHARS ? raw.slice(0, PLAYER_TEXT_MAX_CHARS) : raw;
  return capped.replace(TAG_LIKE, (match) => `&lt;${match.slice(1)}`);
}
