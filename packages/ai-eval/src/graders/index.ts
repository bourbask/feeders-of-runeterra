/**
 * The six per-sample graders, in the order the report prints them.
 *
 * Their identifier lists partition `ASSERTIONS`: disjoint, and union equal to
 * `Object.keys(ASSERTIONS)` imported from `@for/ai`. `index.test.ts` compares
 * the two sets and names the gap, which is the M0-27 criterion that makes a
 * local copy of an assertion impossible to hide — a copy would have to be
 * added to a family to run, and a family that names an identifier `@for/ai`
 * does not export throws `UnknownCheckError`.
 */

import { factFidelityGrader } from './fact-fidelity.js';
import type { Grader } from './kit.js';
import { lockoutGrader } from './lockout.js';
import { refusalGrader } from './refusal.js';
import { sceneContinuityGrader } from './scene-continuity.js';
import { schemaGrader } from './schema.js';
import { styleGrader } from './style.js';

export * from './fact-fidelity.js';
export * from './kit.js';
export * from './lockout.js';
export * from './refusal-blindness.js';
export * from './refusal.js';
export * from './scene-continuity.js';
export * from './schema.js';
export * from './style.js';

export const GRADERS: readonly Grader[] = [
  schemaGrader,
  lockoutGrader,
  factFidelityGrader,
  styleGrader,
  sceneContinuityGrader,
  refusalGrader,
];

/** Every identifier the offline run exercises, in grader order. */
export const EXERCISED_IDS: readonly string[] = GRADERS.flatMap((grader) => grader.ids);
