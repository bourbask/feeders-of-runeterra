/**
 * WHEN the chronicle is regenerated. Not HOW, and not by whom.
 *
 * 02-mj-ia.md section 5.3 lists five triggers in evaluation order, and this
 * file answers exactly that question — as a pure function of the journal and
 * of the chronicle row. The worker that actually compacts, the
 * `chronicle_jobs` lease, the 60-second debounce and the call to
 * `structurer()` are M0-29's; a trigger that also ran the job would put a
 * model call on the turn's critical path, which section 5.3 forbids in so many
 * words ("un tour ne l'attend jamais").
 *
 * THE FOUR TRIGGERS THIS FILE CAN SEE. Trigger 1 (end of session) is half
 * here: `session.closed` is an entry and is read below; "table inactive for 30
 * minutes" is a timer, and a timer belongs to the worker. Trigger 5 (manual)
 * is an administration command and needs nobody's permission.
 *
 * WHY THE THRESHOLD COUNTS "SIGNIFICANT" ENTRIES AND NOT ENTRIES. Section
 * 5.3 names them: narrations emitted, applied proposals, vow resolutions,
 * clocks filled. A turn writes a dozen lines — gauge changes, ticks, a price —
 * and counting those would regenerate the memory three times a session for
 * nothing. The list is walked, so emptying it makes the volume trigger stop
 * firing and the test fall over.
 */

import type { GameEvent } from '@for/engine';

/** Section 5.3, trigger 2. Chosen without real play data (section 9, risk 7). */
export const CHRONICLE_VOLUME_THRESHOLD = 40;

/** Section 5.3, trigger 4: the current version's measured size. */
export const CHRONICLE_TOKEN_BUDGET = 2500;

/** What counts towards the volume threshold (section 5.3, trigger 2). */
const SIGNIFICANT_TYPES: ReadonlySet<string> = new Set([
  'narration.gm_message',
  'narration.proposal_accepted',
  'track.resolved',
  'track.forsaken',
  'clock.filled',
]);

/**
 * Entries that must reach long memory AT ONCE (section 5.3, trigger 3): a
 * player character's death, a vow fulfilled or forsaken, an arc resolved, a
 * named NPC killed.
 */
const PIVOTAL_TYPES: ReadonlySet<string> = new Set([
  'character.died',
  'track.resolved',
  'track.forsaken',
  'entity.status_changed',
]);

export type ChronicleTrigger = 'session_end' | 'pivotal' | 'volume' | 'budget';

export interface ChronicleWatch {
  /** `chronicles.source_event_seq` of the version in service, or 0. */
  readonly sourceEventSeq: number;
  /** `chronicles.token_count` of the version in service. */
  readonly tokenCount: number;
}

/**
 * The reason to regenerate, or `null`.
 *
 * Evaluation order is section 5.3's own, and it is not decoration: a session
 * that ends is worth regenerating even when nothing pivotal happened, and a
 * pivotal entry is worth it before the volume threshold is reached.
 */
export function chronicleTrigger(
  watch: ChronicleWatch,
  journal: readonly GameEvent[],
): ChronicleTrigger | null {
  const since = journal.filter((event) => event.seq > watch.sourceEventSeq);

  if (since.some((event) => event.type === 'session.closed')) return 'session_end';
  if (since.some((event) => isPivotal(event))) return 'pivotal';
  if (
    since.filter((event) => SIGNIFICANT_TYPES.has(event.type)).length >= CHRONICLE_VOLUME_THRESHOLD
  ) {
    return 'volume';
  }
  if (watch.tokenCount > CHRONICLE_TOKEN_BUDGET) return 'budget';
  return null;
}

/**
 * `entity.status_changed` is pivotal only when it KILLS — section 5.3 says
 * "PNJ nommé tué", not "any entity whose status moved". A status going to
 * `dormant` is scene bookkeeping and has no business waking the compaction
 * worker.
 */
function isPivotal(event: GameEvent): boolean {
  if (!PIVOTAL_TYPES.has(event.type)) return false;
  if (event.type === 'entity.status_changed') return event.payload.to === 'dead';
  return true;
}
