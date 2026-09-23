/**
 * Structured scene state: the presence facts.
 *
 * This is what closes the factual-inconsistency bug class described in
 * 02-mj-ia.md section 4.7. Feeding the storyteller the last journal entries as
 * prose invited it to reinterpret them, and three exchanges were enough to put
 * someone who had fled back asleep in their shelter. Presence facts therefore
 * leave prose and become data.
 *
 * Three properties the reducer must not lose (03-donnees.md section 3.5):
 *
 * 1. NO GAME NUMBERS here. No gauge, no segment, no rank. Numbers live in
 *    `characters` and `clocks`, which are always fresh.
 * 2. Both lists are SORTED BY `ref.id`, not by arrival order. The rendering of
 *    the `<scene>` block must be identical from one call to the next at equal
 *    facts, otherwise the prompt cache prefix changes for nothing.
 * 3. `absent` is MONOTONE within a scene: `scene.started` empties it and
 *    rebuilds `present`, `scene.ended` sets the scene back to `null`, and
 *    nothing else removes an entry.
 */

import type { SceneId } from '../ids.js';

export interface SceneRef {
  readonly kind: 'character' | 'entity';
  readonly id: string;
}

export const SCENE_ABSENCE_CAUSES = ['parti', 'mort', 'hors_de_portee'] as const;

export type SceneAbsenceCause = (typeof SCENE_ABSENCE_CAUSES)[number];

/** Hard cap on each list. The SQL CHECK constraints mirror it. */
export const SCENE_PRESENCE_MAX = 8;

export interface ScenePresence {
  readonly ref: SceneRef;
  /** 40 chars max. Always the projection's name, never the model's. */
  readonly name: string;
  /** 60 chars max. No digit, no rule vocabulary. */
  readonly state: string;
  readonly sinceSeq: number;
}

export interface SceneAbsence {
  readonly ref: SceneRef;
  readonly name: string;
  readonly cause: SceneAbsenceCause;
  readonly sinceSeq: number;
}

export interface SceneState {
  readonly sceneId: SceneId;
  readonly placeId: string;
  readonly placeName: string;
  /** 40 chars max. */
  readonly timeOfDay: string;
  /** At most `SCENE_PRESENCE_MAX`, sorted by `ref.id`. */
  readonly present: readonly ScenePresence[];
  /** At most `SCENE_PRESENCE_MAX`, sorted by `ref.id`. */
  readonly absent: readonly SceneAbsence[];
  readonly updatedSeq: number;
}
