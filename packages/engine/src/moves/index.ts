/**
 * `MOVE_REGISTRY` — the eleven moves, keyed by identifier.
 *
 * TWO COMPILE GUARDS, in opposite directions, because one of them alone is
 * worth very little (ADR 0007 makes the same point about the Zod mirror):
 *
 *   - `Record<MoveId, MoveHandler>` fails to compile when a move of `MOVE_IDS`
 *     has no handler;
 *   - `MOVE_BY_INTENT`, typed `Record<MoveIntent['type'], MoveHandler>`, fails
 *     when an intent of the `move.*` family reaches no handler.
 *
 * The pairing itself — handler `x` answers intent `y` — is checked at runtime
 * by `index.test.ts`, because a key and the `intentType` written inside the
 * object it points at cannot be correlated by the type system.
 */

import type { MoveId } from '../types/moves.js';
import { endureCold } from './endure-cold.js';
import { endureHarm } from './endure-harm.js';
import { faceDanger } from './face-danger.js';
import { forsakeYourVow } from './forsake-your-vow.js';
import { fulfillYourVow } from './fulfill-your-vow.js';
import { gatherInformation } from './gather-information.js';
import type { MoveHandler, MoveIntent } from './handler.js';
import { probeASoul } from './probe-a-soul.js';
import { reachAMilestone } from './reach-a-milestone.js';
import { secureAdvantage } from './secure-advantage.js';
import { strike } from './strike.js';
import { swearAVow } from './swear-a-vow.js';

export const MOVE_REGISTRY: Readonly<Record<MoveId, MoveHandler>> = {
  'face-danger': faceDanger,
  'secure-advantage': secureAdvantage,
  'gather-information': gatherInformation,
  'probe-a-soul': probeASoul,
  strike,
  'endure-harm': endureHarm,
  'endure-cold': endureCold,
  'swear-a-vow': swearAVow,
  'fulfill-your-vow': fulfillYourVow,
  'reach-a-milestone': reachAMilestone,
  'forsake-your-vow': forsakeYourVow,
};

/** The same eleven, reached from the intent a client actually sends. */
export const MOVE_BY_INTENT: Readonly<Record<MoveIntent['type'], MoveHandler>> = {
  'move.face_danger': faceDanger,
  'move.secure_advantage': secureAdvantage,
  'move.gather_information': gatherInformation,
  'move.probe_a_soul': probeASoul,
  'move.strike': strike,
  'move.endure_harm': endureHarm,
  'move.endure_cold': endureCold,
  'move.swear_a_vow': swearAVow,
  'move.fulfill_your_vow': fulfillYourVow,
  'move.reach_a_milestone': reachAMilestone,
  'move.forsake_your_vow': forsakeYourVow,
};

export * from './content.js';
export { endureCold } from './endure-cold.js';
export { DEFAULT_HARM, endureHarm, HARM_GAUGE, harmAmount } from './endure-harm.js';
export { faceDanger } from './face-danger.js';
export { forsakeYourVow } from './forsake-your-vow.js';
export { fulfillYourVow } from './fulfill-your-vow.js';
export { GATHER_INFORMATION_ATTRIBUTE, gatherInformation } from './gather-information.js';
export * from './handler.js';
export { probeASoul } from './probe-a-soul.js';
export { reachAMilestone } from './reach-a-milestone.js';
export { secureAdvantage } from './secure-advantage.js';
export { strike } from './strike.js';
export { swearAVow } from './swear-a-vow.js';
