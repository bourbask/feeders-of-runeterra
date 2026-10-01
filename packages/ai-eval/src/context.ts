/**
 * One recorded sample, read the way the server reads a live answer.
 *
 * ── THE SAME PATH, OR THE EVAL MEASURES SOMETHING ELSE ──────────────────────
 * `readSceneBlock` (F1 → F8), `mergeSceneBlock` (S1 → S10) and `proveRefusal`
 * (R1 → R7) are the PRODUCTION functions, imported from `@for/ai`. Nothing
 * here re-implements a rule. A harness that parsed the block its own way
 * would grade a product that does not exist — and it is exactly the shape of
 * green this project has already paid for twice.
 *
 * ── THE OUTCOME IS CARRIED, THEN DROPPED ────────────────────────────────────
 * `refusalProofInput` takes a turn that HOLDS the outcome and returns an input
 * that does not. Going through it, rather than building a `RefusalProofInput`
 * by hand, is what makes `refusal_is_outcome_blind` a real probe: if somebody
 * wires the dice into the decision, they have to add the field to
 * `RefusalProofInput` and carry it through that function, and the corpus
 * grader reddens the same day. Built by hand here, the probe would be empty —
 * it would be measuring a path production does not take.
 */

import {
  DEFAULT_LIMITS,
  assertionContext,
  escapePlayerText,
  mergeSceneBlock,
  proveRefusal,
  readSceneBlock,
  refusalProofInput,
  refusalView,
  type AssertionContext,
  type RefusalObservation,
  type RefusalVerdict,
  type SceneBlockReading,
  type SceneMergeResult,
  type SceneMergeState,
} from '@for/ai';
import type { SceneBlockRefusal } from '@for/contracts';

import type { EvalCase } from './cases.js';
import type { EvalFixture } from './fixtures.js';
import type { RecordedSample } from './recorded.js';

/** Everything the merge and the proof read of the world, from the fixture. */
export function mergeStateOf(fixture: EvalFixture): SceneMergeState {
  return {
    actors: fixture.actors.map((actor) => ({
      ref: actor.ref,
      name: actor.name,
      isPlayerCharacter: actor.isPlayerCharacter,
      isDead: actor.isDead,
      placeId: actor.placeId,
    })),
    placeIds: fixture.placeIds,
    seq: fixture.seq,
  };
}

/**
 * Run the refusal proof for one declared refusal.
 *
 * `outcome` is a parameter because the corpus grader replays the same call
 * with `franche` and `echec` swapped. It goes onto the TURN, and
 * `refusalProofInput` is what drops it.
 */
export function proveFor(
  evalCase: EvalCase,
  fixture: EvalFixture,
  refusal: SceneBlockRefusal | null,
  declaredCount: number,
  outcome: string | null,
): RefusalVerdict {
  return proveRefusal(
    refusalProofInput({
      refusal,
      declaredCount,
      sceneBefore: evalCase.turn.sceneIn,
      state: mergeStateOf(fixture),
      actorInventory: evalCase.turn.actorInventory,
      actorAssets: evalCase.turn.actorAssets,
      intention: escapePlayerText(evalCase.turn.intent),
      moveId: evalCase.turn.fact.moveId,
      upheldRefusalsInWindow: evalCase.turn.upheldRefusalsInWindow,
      outcome,
    }),
  );
}

export interface SampleView {
  readonly reading: SceneBlockReading;
  /** The merge of the block into `scene_in`, for `expect.scene_out`. */
  readonly merged: SceneMergeResult;
  /** What the proof said, or `null` when the block declared no refusal. */
  readonly refusal: RefusalObservation | null;
  readonly context: AssertionContext;
}

const expectationOf = (evalCase: EvalCase): RefusalObservation | null => {
  const expected = evalCase.refusal;
  if (expected === null || expected.verdict === 'none') return null;
  return { verdict: expected.verdict, cause: expected.cause, target: expected.target };
};

/**
 * Read one sample and assemble the context the twenty-eight checks are handed.
 *
 * `limits` is spread field by field over `DEFAULT_LIMITS` through
 * `assertionContext`, so a case that overrides nothing gets the production
 * defaults rather than zeroes.
 */
export function viewSample(
  evalCase: EvalCase,
  fixture: EvalFixture,
  sample: RecordedSample,
): SampleView {
  const reading = readSceneBlock(sample.response, fixture.reservedChampions);
  const declaredRefusal = reading.block?.refus ?? null;
  const verdict =
    declaredRefusal === null
      ? null
      : proveFor(evalCase, fixture, declaredRefusal, 1, evalCase.turn.fact.outcome);
  const view = verdict === null ? null : refusalView(declaredRefusal, verdict);
  const refusal: RefusalObservation | null =
    view === null ? null : { verdict: view.verdict, cause: view.cause, target: view.target };

  const { params } = evalCase;
  /**
   * `assertionContext` spreads over `DEFAULT_LIMITS`, so a case that overrides
   * nothing is graded with the production numbers rather than with zeroes.
   * Each override is conditional: `exactOptionalPropertyTypes` makes an
   * explicit `undefined` a different thing from an absent key, and the absent
   * key is the one that inherits the default.
   */
  const context = assertionContext({
    reservedChampions: fixture.reservedChampions,
    playerCharacterNames:
      params.playerCharacterNames ?? fixture.campaign.characters.map((one) => one.name),
    absentNames: evalCase.turn.sceneIn.absent.map((entry) => entry.name),
    sceneEntityNames: [
      ...evalCase.turn.sceneIn.present.map((entry) => entry.name),
      ...evalCase.turn.sceneIn.absent.map((entry) => entry.name),
    ],
    priceKeywords: evalCase.turn.fact.price?.keywords ?? null,
    factHasTimeSkip: evalCase.turn.fact.hasTimeSkip,
    sceneBlock: reading.block,
    refusal,
    expectedRefusal: expectationOf(evalCase),
    toolCalls: sample.toolCalls,
    allowedTools: params.allowedTools ?? [],
    mentionsAny: params.mentionsAny ?? [],
    limits: {
      ...DEFAULT_LIMITS,
      ...(params.sentenceMin === undefined ? {} : { sentenceMin: params.sentenceMin }),
      ...(params.sentenceMax === undefined ? {} : { sentenceMax: params.sentenceMax }),
      ...(params.maxChars === undefined ? {} : { maxChars: params.maxChars }),
      ...(params.toolCallsMax === undefined ? {} : { toolCallsMax: params.toolCallsMax }),
    },
  });

  return {
    reading,
    merged: mergeSceneBlock(evalCase.turn.sceneIn, reading.block, mergeStateOf(fixture)),
    refusal,
    context,
  };
}
