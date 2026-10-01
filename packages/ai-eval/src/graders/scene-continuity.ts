/**
 * `scene-continuity` — nobody comes back from the list of the departed.
 *
 * The bug this closes was observed in a real session: three exchanges were
 * enough to put somebody who had fled back asleep in their shelter. Two
 * checks, two surfaces.
 *
 * ── THE BLOCK: MECHANICAL, NO HEURISTIC ─────────────────────────────────────
 * `scene_block_consistent` fails when `<scene_apres>.presents` names anybody
 * who sits in `scene_in.absent`. Rule S5 of the merge already IGNORES such an
 * entry, server side and silently; this assertion turns that silence into a
 * visible failure. Both halves are measured here: the assertion, and
 * `expect.scene_out` read on the MERGED state — section 8.2 is explicit that
 * « c'est la fusion qui fait foi, et c'est elle qu'il faut protéger d'une
 * régression ».
 *
 * ── THE PROSE: A HEURISTIC, IN THE PERMISSIVE DIRECTION ─────────────────────
 * `no_absent_reappearance` allows what we want to allow — the empty shelter,
 * the blood, the trace — and fails only on a bare mention. Hard anyway,
 * because it is exactly the observed bug.
 *
 * ── WHY `expect.scene_out` GATES AND THE MERGE'S REJECTIONS DO NOT ──────────
 * A rejection is the merge DOING ITS JOB: S1 on a name nobody knows, S5 on a
 * reappearance, S6 on an unknown place. Failing on them would be failing on
 * the guard rather than on the breach. What gates is the STATE AFTER: whoever
 * had to stay absent is still absent, whoever had to stay present is still
 * present. Held by `scene-continuity.test.ts` « le rejet S5 est signalé, et
 * c'est l'état fusionné qui décide ».
 */

import { normalize } from '@for/ai';

import { runFamily, type Check, type Grader, type GraderInput } from './kit.js';

export const SCENE_CONTINUITY_IDS: readonly string[] = [
  'no_absent_reappearance',
  'scene_block_consistent',
];

const sameName = (left: string, right: string): boolean =>
  normalize(left).length > 0 && normalize(left) === normalize(right);

function sceneOutCheck(input: GraderInput): Check {
  const expected = input.evalCase.sceneOut;
  if (expected === null) {
    return { id: 'scene_out', passed: true, detail: 'aucune attente de scène', gating: false };
  }
  const after = input.view.merged.after;
  const presentNames = after.present.map((entry) => entry.name);
  const absentNames = after.absent.map((entry) => entry.name);
  const wrongfullyBack = expected.mustStayAbsent.filter((name) =>
    presentNames.some((present) => sameName(name, present)),
  );
  const wrongfullyGone = expected.mustStayPresent.filter(
    (name) => !presentNames.some((present) => sameName(name, present)),
  );
  const missingFromAbsent = expected.mustStayAbsent.filter(
    (name) => !absentNames.some((absent) => sameName(name, absent)),
  );
  const faults = [
    ...wrongfullyBack.map((name) => `${name} revenu parmi les présents`),
    ...missingFromAbsent.map((name) => `${name} n'est plus dans les partis`),
    ...wrongfullyGone.map((name) => `${name} a disparu des présents`),
  ];
  return {
    id: 'scene_out',
    passed: faults.length === 0,
    detail:
      faults.length === 0
        ? `${String(after.present.length)} présents, ${String(after.absent.length)} partis après fusion`
        : faults.join(' ; '),
    gating: true,
  };
}

function mergeRejectionsCheck(input: GraderInput): Check {
  const { rejections, unchanged } = input.view.merged;
  return {
    id: 'scene_merge',
    passed: true,
    detail:
      rejections.length === 0
        ? unchanged
          ? 'fusion sans changement'
          : 'fusion appliquée'
        : rejections.map((one) => `${one.rule} ${one.code} (${one.detail})`).join(' ; '),
    gating: false,
  };
}

export const sceneContinuityGrader: Grader = {
  name: 'scene-continuity',
  ids: SCENE_CONTINUITY_IDS,
  run: (input) => [
    ...runFamily(SCENE_CONTINUITY_IDS, input),
    sceneOutCheck(input),
    mergeRejectionsCheck(input),
  ],
};
