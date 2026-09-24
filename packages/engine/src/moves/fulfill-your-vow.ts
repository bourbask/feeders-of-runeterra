/**
 * `fulfill-your-vow` — accomplir son serment.
 *
 * THE ONE MOVE THAT ROLLS PROGRESS. Its score is the track's filled boxes, not
 * a d6 and not an attribute, and momentum cannot touch it (`dice/progress.ts`
 * says why: burning elan to end a vow is the move the two-step burn exists to
 * keep out of the journal).
 *
 * A weak hit still fulfills. What it costs is the content's business, on the
 * `partielle` branch; what it is WORTH is `{ op: 'xp' }` on that same branch,
 * because a rank-to-XP ladder written in the engine would be a rule no
 * specification carries.
 */

import type { Result } from '../result.js';
import { isErr, ok } from '../result.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { planOf, requireOpenVow } from './handler.js';

type FulfillYourVowIntent = Extract<
  MovePlanInput['intent'],
  { readonly type: 'move.fulfill_your_vow' }
>;

export const fulfillYourVow: MoveHandler<FulfillYourVowIntent> = {
  id: 'fulfill-your-vow',
  intentType: 'move.fulfill_your_vow',
  plan({ state, intent }): Result<MovePlan, RuleViolation> {
    const track = requireOpenVow(state, intent.trackId);
    if (isErr(track)) return track;
    return ok({
      ...planOf({ kind: 'progress', trackId: track.value.id }, ''),
      trackId: track.value.id,
      resolution: {
        franche: { kind: 'resolved', outcome: 'fulfilled' },
        partielle: { kind: 'resolved', outcome: 'fulfilled' },
        echec: { kind: 'resolved', outcome: 'failed' },
      },
    });
  },
};
