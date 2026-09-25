/**
 * `<scene_apres>` applied to the journal (02-mj-ia.md section 4.7).
 *
 * The merge itself is `mergeSceneBlock`, pure, in `@for/ai`. This file does
 * three things and nothing else: it builds the merge's view of the world from
 * the committed state, it decides whether anything moved, and — only then —
 * it appends `scene.facts_updated`.
 *
 * ── AN EVENT ONLY WHEN THE MERGE CHANGES SOMETHING ───────────────────────
 * Section 4.7.1: "l'événement n'est émis que si la fusion produit un
 * changement effectif". A turn that displaces nobody writes NOTHING. On the
 * demonstration campaign that is roughly one entry every three turns, and the
 * alternative is a journal whose scene history is mostly noise.
 *
 * The decision is `mergeSceneBlock`'s own `unchanged` flag — canonical JSON
 * before against canonical JSON after — and this file does not re-derive it.
 * Held by `tests/ai/scene-state.test.ts`, « deux tours sans mouvement
 * n'écrivent aucun événement », with the other direction one line below:
 * « alors qu'un départ réel en écrit un ».
 *
 * ── AND AN ABSENT BLOCK IS THE NORMAL CASE, NOT AN ERROR ─────────────────
 * Measured rather than assumed: M0-32 ran 24 samples on two free local models
 * and NONE of them wrote the block. So the path where `block` is `null` is the
 * one the table will actually take, and it must cost the turn nothing — no
 * event, no exception, no retry, no fallback (section 7.1's own row for it).
 * Held by `tests/ai/scene-state.test.ts`, « aucun bloc rendu par le modèle :
 * aucun événement, aucune exception, le tour se termine ».
 *
 * ── THE GATE IS ON THE WAY OUT ───────────────────────────────────────────
 * `scene.facts_updated` belongs to circuit 1, and `gateEvents` says so before
 * the entry is appended. A handler that grew a second consequence would throw
 * here instead of quietly widening what the model can reach.
 */

import { mergeSceneBlock } from '@for/ai';
import { appendEvents } from '@for/db';

import { toAppendable } from '../game/intent-pipeline.js';
import { PROPOSAL_CIRCUIT, gateEvents } from './proposal-surface.js';

import type { SceneMergeResult, SceneMergeState } from '@for/ai';
import type { SceneBlock, SceneStateDto } from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type {
  AiCallId,
  CampaignState,
  EventId,
  GameEventOf,
  IdFactory,
  SceneId,
} from '@for/engine';

/**
 * The scene state a campaign with no open scene is merged against.
 *
 * NOT an error and not a skip: `scene.ended` sets `CampaignState.scene` to
 * null, and a turn played outside a scene still has presence facts the model
 * may report. An empty scene merges to an empty scene, which `unchanged`
 * reports as nothing to write.
 */
export function emptyScene(seq: number): SceneStateDto {
  return {
    sceneId: '' as SceneId,
    placeId: '',
    placeName: '',
    timeOfDay: '',
    present: [],
    absent: [],
    updatedSeq: seq,
  };
}

/**
 * `CampaignState.scene`, or the empty scene. One reading, one place.
 *
 * The lists are COPIED rather than passed through, and that is not
 * ceremony: the engine's `SceneState` carries `readonly` arrays and
 * `SceneStateDto` — the Zod output — carries mutable ones. Copying is what
 * the compiler asks for, and it also means nothing downstream can write back
 * into the state it was handed.
 */
export function sceneBefore(state: CampaignState): SceneStateDto {
  const scene = state.scene;
  if (scene === null) return emptyScene(state.seq);
  return {
    sceneId: scene.sceneId,
    placeId: scene.placeId,
    placeName: scene.placeName,
    timeOfDay: scene.timeOfDay,
    present: scene.present.map((entry) => ({ ...entry, ref: { ...entry.ref } })),
    absent: scene.absent.map((entry) => ({ ...entry, ref: { ...entry.ref } })),
    updatedSeq: scene.updatedSeq,
  };
}

/**
 * What `mergeSceneBlock` is allowed to know about the world.
 *
 * Narrow on purpose (see `outputs/scene.ts`): who exists, what they are
 * called, whether they are a player character, whether THE ENGINE killed them,
 * and where they are. Nothing else crosses, so nothing else can be leaned on.
 *
 * `placeId` comes from `details.placeId` for an entity and from the scene for
 * a character. That asymmetry is the world: a character is where the scene is,
 * an entity carries its own place. An entity whose `details` says nothing
 * answers `null`, and `hors_de_portee` can never be proven against it — which
 * is the safe direction, since the refusal would cancel a turn.
 */
export function sceneMergeState(state: CampaignState): SceneMergeState {
  const scenePlaceId = state.scene?.placeId ?? null;
  const characters = Object.values(state.characters).map((character) => ({
    ref: { kind: 'character' as const, id: character.id },
    name: character.displayName,
    isPlayerCharacter: true,
    isDead: character.status === 'dead',
    placeId: scenePlaceId,
  }));
  const entities = Object.values(state.entities).map((entity) => ({
    ref: { kind: 'entity' as const, id: entity.id },
    name: entity.name,
    isPlayerCharacter: false,
    isDead: entity.status === 'dead',
    placeId: readPlaceId(entity.details),
  }));
  return {
    actors: [...characters, ...entities],
    placeIds: Object.values(state.entities)
      .filter((entity) => entity.kind === 'place')
      .map((entity) => entity.id),
    seq: state.seq + 1,
  };
}

function readPlaceId(details: Readonly<Record<string, unknown>>): string | null {
  const value = details['placeId'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface SceneStateDeps {
  readonly connection: SqliteConnection;
  readonly ids: IdFactory;
}

export interface ApplySceneBlockInput {
  readonly campaignId: string;
  readonly correlationId: string;
  /** The `narration.gm_proposal` this merge answers, for `causationId`. */
  readonly causationId: string | null;
  readonly state: CampaignState;
  /** `null` whenever the model wrote no usable block. THE NORMAL CASE. */
  readonly block: SceneBlock | null;
  readonly aiCallId: string;
  readonly now: number;
}

export type SceneFactsEvent = GameEventOf<'scene.facts_updated'>;

export interface ApplySceneBlockResult {
  readonly merge: SceneMergeResult;
  /** The entry, or `null` when the merge changed nothing. */
  readonly event: SceneFactsEvent | null;
  /** `seq` the database allocated, or `null`. */
  readonly seq: number | null;
}

/**
 * Merge the block and, if it moved anything, write the entry.
 *
 * It NEVER throws on the model's account: every way a block can be wrong is
 * already a null block or an ignored entry one level down. The only throw
 * here is `gateEvents`, and that one is about OUR code.
 */
export function applySceneBlock(
  deps: SceneStateDeps,
  input: ApplySceneBlockInput,
): ApplySceneBlockResult {
  const before = sceneBefore(input.state);
  const merge = mergeSceneBlock(before, input.block, sceneMergeState(input.state));
  if (merge.unchanged) return { merge, event: null, seq: null };

  const event: SceneFactsEvent = {
    id: deps.ids.next() as EventId,
    campaignId: input.state.campaignId,
    seq: input.state.seq + 1,
    playSessionId: null,
    payloadVersion: 1,
    // The SERVER writes, after the merge validated — 03-donnees.md section
    // 0.5, « via validation et fusion serveur ».
    actorKind: 'engine',
    actorPlayerId: null,
    subjectCharacterId: null,
    correlationId: input.correlationId,
    causationId: input.causationId as EventId | null,
    rngStream: null,
    rngDrawIndex: null,
    createdAt: input.now,
    scope: 'table',
    recipients: null,
    type: 'scene.facts_updated',
    payload: {
      sceneId: merge.after.sceneId,
      placeId: merge.after.placeId,
      placeName: merge.after.placeName,
      timeOfDay: merge.after.timeOfDay,
      present: merge.after.present,
      absent: merge.after.absent,
      // WHERE THE FACTS CAME FROM, which is not who wrote the entry. The
      // server wrote it, after validating; the model is where it read them.
      source: 'gm_ai',
      aiCallId: input.aiCallId as AiCallId,
    },
  };

  gateEvents(PROPOSAL_CIRCUIT, [event]);

  const appended = appendEvents(deps.connection, {
    campaignId: input.campaignId,
    // `toAppendable` is the intent path's own converter, and it runs
    // `assertNotAiAuthored` on the way in. Reusing it here is the point of
    // M0-13's report: that predicate was written for THIS path.
    events: [toAppendable(event, input.correlationId)],
    now: input.now,
  });
  const written = appended.events[0];
  return { merge, event, seq: written?.seq ?? null };
}
