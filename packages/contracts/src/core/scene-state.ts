/**
 * Structured scene state: the presence facts.
 *
 * This is what closes the factual-inconsistency bug class of 02-mj-ia.md
 * section 4.7. Feeding the storyteller the last journal entries as prose
 * invited it to reinterpret them, and three exchanges were enough to put
 * someone who had fled back asleep in their shelter. Presence facts therefore
 * leave prose and become data — and data has bounds.
 *
 * THE BOUNDS ARE THE POINT, so they are written once, here, and reused by the
 * `scene.facts_updated` event payload. The SQL CHECK constraints of
 * 03-donnees.md section 1.4 mirror them:
 *
 *   - at most 8 present, at most 8 absent;
 *   - `name` at most 40 characters, always the projection's, never the model's;
 *   - `state` at most 60 characters, no digit, no rule vocabulary;
 *   - `cause` drawn from `parti | mort | hors_de_portee` and nothing else.
 *
 * No game number lives here. Gauges, segments and ranks are in `characters`
 * and `clocks`, which are always fresh.
 */

import { z } from 'zod';

import type { SceneAbsence, ScenePresence, SceneRef, SceneState } from '@for/engine';

import { zSceneId, zSeq } from '../primitives.js';
import { zSceneAbsenceCause } from './enums.js';

/** Hard cap on each list. */
export const SCENE_PRESENCE_MAX = 8;
export const SCENE_NAME_MAX = 40;
export const SCENE_PRESENCE_STATE_MAX = 60;
export const SCENE_TIME_OF_DAY_MAX = 40;

export const zSceneRef = z.object({
  kind: z.enum(['character', 'entity']),
  id: z.string().min(1),
}) satisfies z.ZodType<SceneRef>;

export const zScenePresence = z.object({
  ref: zSceneRef,
  name: z.string().max(SCENE_NAME_MAX),
  state: z.string().max(SCENE_PRESENCE_STATE_MAX),
  sinceSeq: zSeq,
}) satisfies z.ZodType<ScenePresence>;

export const zSceneAbsence = z.object({
  ref: zSceneRef,
  name: z.string().max(SCENE_NAME_MAX),
  cause: zSceneAbsenceCause,
  sinceSeq: zSeq,
}) satisfies z.ZodType<SceneAbsence>;

export const zScenePresenceList = z.array(zScenePresence).max(SCENE_PRESENCE_MAX);
export const zSceneAbsenceList = z.array(zSceneAbsence).max(SCENE_PRESENCE_MAX);

export const zSceneState = z.object({
  sceneId: zSceneId,
  placeId: z.string(),
  placeName: z.string().max(SCENE_NAME_MAX),
  timeOfDay: z.string().max(SCENE_TIME_OF_DAY_MAX),
  /** Sorted by `ref.id`, so the `<scene>` prompt block is byte-stable. */
  present: zScenePresenceList,
  /** Monotone within a scene: only `scene.started` empties it. */
  absent: zSceneAbsenceList,
  updatedSeq: zSeq,
}) satisfies z.ZodType<SceneState>;

export type SceneStateDto = z.output<typeof zSceneState>;
