/**
 * `SceneBlockSchema` — the `<scene_apres>` block the storyteller writes AFTER
 * its prose (02-mj-ia.md section 2.3). Never broadcast to players.
 *
 * WHY A TAGGED BLOCK AND NOT `structurer()`. A structured output would wrap
 * the prose in a JSON field: we would have to stream JSON and rebuild the text
 * client-side, and the 50 ms coalescing of section 6.2 would become an
 * incremental parser. Decisive second reason: a tagged block works on EVERY
 * provider, including the ones whose `capabilities.structuredOutput` is false.
 *
 * THIS SCHEMA IS F5, AND ONLY F5. The eight reading rules of section 2.3 run
 * in `@for/ai` (`src/outputs/scene.ts`, pure); F4's 900-character ceiling and
 * F6/F7/F8's content filters are NOT expressible as Zod and are not attempted
 * here. What this file owns is the SHAPE, and one property that the acceptance
 * criteria call out by name:
 *
 *   A MINIMAL BLOCK IS NEVER AN ERROR. `{}` parses. Every field has a default,
 *   so a model that reports nothing is reporting "nothing changed" rather than
 *   failing a turn. Section 2.3 is explicit: an absent, truncated or malformed
 *   block never breaks a turn, and that is the condition for this mechanism to
 *   be unable to degrade availability.
 *
 * NOTHING MECHANICAL CROSSES IT. No gauge, no outcome, no die, no segment, no
 * event sequence. `refus` carries a cause from a closed list and a name — no
 * `targetSeqs`, no effect, no value. The server recomputes the proof alone
 * (R1→R7, section 4.8.2), which is what keeps the storyteller unable to cancel
 * a roll by sheer will: it can only POINT AT A FACT the server re-checks.
 *
 * THE BOUNDS ARE REUSED, NOT RETYPED. `8`, `40` and `60` already live in
 * `core/scene-state.ts`, mirrored from the engine and compared to it at
 * runtime by `tests/exhaustive-union.test.ts`. Writing the numbers again here
 * would create a third copy that nothing compares — exactly the failure mode
 * ADR 0007 describes for scalars, where the compiler only ever sees `number`.
 *
 * THE `SceneState` MIRROR IS NOT HERE EITHER. The M0-12 sheet lists
 * "SceneBlockSchema + the Zod mirror of SceneState" for this file; M0-05
 * already delivered `zSceneState` in `core/scene-state.ts`, and `src/index.ts`
 * star-exports `core/` and `ai/` side by side — a name exported by two starred
 * modules is dropped from the barrel in silence. So this file imports the
 * bounds and re-declares nothing.
 */

import { z } from 'zod';

import {
  SCENE_NAME_MAX,
  SCENE_PRESENCE_MAX,
  SCENE_PRESENCE_STATE_MAX,
} from '../core/scene-state.js';

/**
 * F4: the text between the tags, past which `@for/ai` ignores the block
 * without erroring. It lives here because the parser in `@for/ai` and the
 * prompt that announces the format in `@for/ai` must not each carry their own.
 */
export const SCENE_BLOCK_MAX_CHARS = 900;

/**
 * The three free-text fields of the block — `lieu`, `etat`, `cible` — are all
 * capped at 60 by section 2.3, which is the `state` ceiling already mirrored
 * from the engine. One alias, one number, nothing recopied.
 */
export const SCENE_BLOCK_TEXT_MAX = SCENE_PRESENCE_STATE_MAX;

/**
 * The FOUR causes of section 4.8.1, and they alone.
 *
 * Each one is a MATERIAL POSSIBILITY the server can re-derive from structured
 * state. What is never a cause, and what the system prompt spells out: the
 * result displeases, the action is risky, stupid, immoral or absurd. An absurd
 * but materially possible action is played.
 *
 * These four have no engine tuple to mirror: the engine carries the refusal as
 * `narration.gm_proposal { kind: 'refusal' }` with an `unknown` payload, on
 * purpose (03-donnees.md section 3.4). So this tuple is the canonical list,
 * and `@for/ai`'s `proveRefusal` derives its R4 table from it.
 */
export const SCENE_REFUSAL_CAUSES = [
  'cible_absente',
  'cible_morte',
  'hors_de_portee',
  'objet_inexistant',
] as const;

export type SceneRefusalCause = (typeof SCENE_REFUSAL_CAUSES)[number];

/**
 * The absence causes a block may declare.
 *
 * Deliberately NOT `zSceneAbsenceCause`: the model writes French words that
 * happen to coincide with the engine's tuple today, and the day the engine
 * adds a fourth cause it will be because the ENGINE learned to produce one,
 * not because the storyteller may now report it. Tying the two would let an
 * engine-side addition silently widen what the model is allowed to say.
 * `tests/ai/scene.test.ts` compares the two lists and reddens if they drift,
 * so the coincidence stays a measured one.
 */
export const SCENE_BLOCK_DEPARTURE_CAUSES = ['parti', 'mort', 'hors_de_portee'] as const;

export type SceneBlockDepartureCause = (typeof SCENE_BLOCK_DEPARTURE_CAUSES)[number];

export const ScenePresentSchema = z
  .object({
    nom: z.string().min(1).max(SCENE_NAME_MAX),
    etat: z.string().max(SCENE_BLOCK_TEXT_MAX).default(''),
  })
  .strict();

export const SceneDepartedSchema = z
  .object({
    nom: z.string().min(1).max(SCENE_NAME_MAX),
    cause: z.enum(SCENE_BLOCK_DEPARTURE_CAUSES),
  })
  .strict();

export const SceneRefusalSchema = z
  .object({
    cause: z.enum(SCENE_REFUSAL_CAUSES),
    cible: z.string().min(1).max(SCENE_BLOCK_TEXT_MAX),
  })
  .strict();

export const SceneBlockSchema = z
  .object({
    lieu: z.string().max(SCENE_BLOCK_TEXT_MAX).default(''),
    presents: z.array(ScenePresentSchema).max(SCENE_PRESENCE_MAX).default([]),
    partis: z.array(SceneDepartedSchema).max(SCENE_PRESENCE_MAX).default([]),
    refus: SceneRefusalSchema.nullable().default(null),
  })
  .strict();

export type SceneBlock = z.output<typeof SceneBlockSchema>;
export type SceneBlockRefusal = z.output<typeof SceneRefusalSchema>;
