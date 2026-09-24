/**
 * `reach-a-milestone` — atteindre un jalon.
 *
 * NO ROLL. There is nothing to beat, so there is nothing to fail, and the move
 * takes the `franche` branch of its content file. The ticks it marks are not
 * written here either: the content declares
 * `{ op: 'track_tick', trackKind: 'vow', useRank: true }`, and `useRank` is
 * what makes `TICKS_PER_MILESTONE` the single place the pace of a rank is
 * stated (progress-track.ts says the same thing from the other side).
 *
 * The track must be an OPEN vow. Marking a milestone on a vow already fulfilled
 * is `track_already_resolved`, not a silent no-op: a no-op here would make the
 * button work and change nothing, which is worse than a refusal.
 */

import type { Result } from '../result.js';
import { isErr, ok } from '../result.js';
import type { RuleViolation } from '../types/violations.js';
import type { MoveHandler, MovePlan, MovePlanInput } from './handler.js';
import { planOf, requireOpenVow } from './handler.js';

type ReachAMilestoneIntent = Extract<
  MovePlanInput['intent'],
  { readonly type: 'move.reach_a_milestone' }
>;

export const reachAMilestone: MoveHandler<ReachAMilestoneIntent> = {
  id: 'reach-a-milestone',
  intentType: 'move.reach_a_milestone',
  plan({ state, intent }): Result<MovePlan, RuleViolation> {
    const track = requireOpenVow(state, intent.trackId);
    if (isErr(track)) return track;
    return ok({
      ...planOf({ kind: 'none', outcome: 'franche' }, ''),
      trackId: track.value.id,
    });
  },
};
