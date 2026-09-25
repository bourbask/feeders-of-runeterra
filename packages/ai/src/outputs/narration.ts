/**
 * One model answer, turned into a `NarrationOutput` (02-mj-ia.md section 2.3).
 *
 * Pure, and it never throws: everything that can go wrong with the
 * `<scene_apres>` block is already a NULL BLOCK rather than an error
 * (`outputs/scene.ts`), and the prose survives all of it. A truncated answer —
 * `finish: 'truncated'` — is the ordinary case of a block cut in half, and it
 * costs the turn nothing.
 */

import { NARRATION_PROSE_MAX, type NarrationOutput } from '@for/contracts';

import type { ReservedChampion } from '../assertions/types.js';
import { readSceneBlock, type SceneBlockTag } from './scene.js';

export interface ReadNarrationResult {
  readonly output: NarrationOutput;
  /** For `ai_calls.eval_tags_json`. */
  readonly tags: readonly SceneBlockTag[];
  /** True when the prose had to be cut to the contract's safety bound. */
  readonly proseTruncated: boolean;
}

/**
 * Read a full answer: prose before the tag, scene block after it.
 *
 * The prose is capped at `NARRATION_PROSE_MAX`, which is a SAFETY bound
 * derived from `maxOutputTokens`, not a style rule — « three to five
 * sentences » lives in the prompt and is measured by `sentence_count`.
 */
export function readNarration(
  response: string,
  reservedChampions: readonly ReservedChampion[] = [],
): ReadNarrationResult {
  const reading = readSceneBlock(response, reservedChampions);
  const proseTruncated = reading.prose.length > NARRATION_PROSE_MAX;
  return {
    output: {
      prose: proseTruncated ? reading.prose.slice(0, NARRATION_PROSE_MAX) : reading.prose,
      sceneBlock: reading.block,
    },
    tags: reading.tags,
    proseTruncated,
  };
}
