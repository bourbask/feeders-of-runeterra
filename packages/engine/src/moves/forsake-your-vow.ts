/**
 * `forsake-your-vow` — renier son serment.
 *
 * No roll: giving up is not something you can fail at. The track closes as
 * `forsaken`, and what that costs — elan, experience — is on the `franche`
 * branch of the content file like every other consequence.
 *
 * `forsaken` and `abandoned` are two different endings and the reducer keeps
 * them apart: one is a character breaking their word inside the fiction, the
 * other is housekeeping outside it (`types/progress.ts`).
 */

import type { Result } from '../result.js';
import { isErr, ok } from '../result.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { planOf, requireOpenVow } from './handler.js';

type ForsakeYourVowIntent = Extract<
  MovePlanInput['intent'],
  { readonly type: 'move.forsake_your_vow' }
>;

export const forsakeYourVow: MoveHandler<ForsakeYourVowIntent> = {
  id: 'forsake-your-vow',
  intentType: 'move.forsake_your_vow',
  plan({ state, intent }): Result<MovePlan, RuleViolation> {
    const track = requireOpenVow(state, intent.trackId);
    if (isErr(track)) return track;
    return ok({
      ...planOf({ kind: 'none', outcome: 'franche' }, intent.reason),
      trackId: track.value.id,
      resolution: { franche: { kind: 'forsaken' }, partielle: null, echec: null },
    });
  },
};
