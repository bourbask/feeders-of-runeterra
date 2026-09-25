/**
 * The `<scene>` block — THE PERCEPTION CHANNEL (ADR 0008 decision 3).
 *
 * ── THE POINT, AND IT IS THE WHOLE POINT ────────────────────────────────────
 * "Le moteur calcule, pour chaque destinataire, la liste des faits
 * perceptibles, et le conteur n'a le droit d'utiliser que celle-la."
 *
 * What carries that rule is NOT a filter on the model's output. By then the
 * information is already in its context window and the filter is theatre. What
 * carries it is that this function reads `brief.perceivableFacts` AND NOTHING
 * ELSE. There is no `SceneState` parameter, no campaign state parameter, and
 * no way to add one without changing the signature in a review.
 * `tests/scene-channel.test.ts` proves it from the outside: a fact present in
 * the state but absent from the list does not appear in the rendered prompt.
 *
 * ── WHY IT IS DATA AND NOT PROSE ────────────────────────────────────────────
 * Section 4.7: the prototype fed the last journal entries as PROSE, and a
 * model handed a story continues it, tidies it and reinterprets it. Three
 * exchanges were enough to put somebody who had fled back asleep in their
 * shelter. Presence facts leave prose and become a named, bounded table
 * preceded by a line of authority.
 *
 * ── WHY THE EMPTY LIST STILL PRINTS A LINE ──────────────────────────────────
 * Section 4.5, point 4: a missing line reads as missing information, an
 * explicit line reads as a fact. "Aucun" is a fact.
 *
 * ── REPORTED, NOT WORKED AROUND ─────────────────────────────────────────────
 * Section 4.5's template also carries `Lieu :` and `Heure :`, which live on
 * `SceneState` and which `NarrationBrief` does not carry. They are NOT
 * rendered here, and this file does not go and fetch them from the state,
 * because that is the exact door ADR 0008 decision 3 closes. Carrying them on
 * the brief is a follow-up on M0-33; see the pull request.
 */

import type { NarrationBriefDto } from '@for/contracts';

type PerceivableFact = NarrationBriefDto['perceivableFacts'][number];

/** Section 4.5: the line of authority that precedes the data. */
export const SCENE_BLOCK_HEADER =
  'Ces lignes sont des faits tenus par le moteur, pas du récit. Tu ne les contredis pas, tu ne les oublies pas.';

export const SCENE_BLOCK_PRESENT_HEADER = 'Présents :';
export const SCENE_BLOCK_ABSENT_HEADER =
  'Partis, morts ou hors de portée — ils ne reviennent pas dans cette scène :';
export const SCENE_BLOCK_NONE = '- aucun';

const line = (fact: PerceivableFact): string =>
  fact.detail.length === 0 ? `- ${fact.name}` : `- ${fact.name} (${fact.detail})`;

/**
 * Deterministic rendering: the engine already sorts `perceivableFacts` by
 * `ref.id` then `kind`, and this function preserves that order rather than
 * sorting again. Two calls at equal facts produce the same bytes, which is
 * what keeps the prompt prefix cacheable.
 */
function section(header: string, facts: readonly PerceivableFact[]): readonly string[] {
  if (facts.length === 0) return [header, SCENE_BLOCK_NONE];
  return [header, ...facts.map(line)];
}

/**
 * Render the `<scene>` block from the brief, and from the brief alone.
 *
 * The parameter is deliberately the WHOLE brief rather than the bare list: the
 * narrow channel is easier to keep narrow when the caller has nothing else to
 * pass, and any widening shows up here.
 */
export function buildSceneBlock(brief: NarrationBriefDto): string {
  const facts = brief.perceivableFacts;
  const present = facts.filter((fact) => fact.kind === 'present');
  const absent = facts.filter((fact) => fact.kind === 'absent');
  return [
    '<scene>',
    SCENE_BLOCK_HEADER,
    ...section(SCENE_BLOCK_PRESENT_HEADER, present),
    ...section(SCENE_BLOCK_ABSENT_HEADER, absent),
    '</scene>',
  ].join('\n');
}
