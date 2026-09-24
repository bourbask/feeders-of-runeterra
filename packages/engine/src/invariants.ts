/**
 * `checkInvariants()` — what must be true of a state, whatever produced it.
 *
 * It exists because the reducer is deliberately JUDGEMENT-FREE: it saturates
 * rather than refuses, and it trusts the payload. Something has to say out
 * loud when the result is nonsense, and that something must not be the
 * reducer, or totality goes (03-donnees.md section 3.3, constraint 2).
 *
 * It returns a LIST, never throws, and never repairs. The codes come from the
 * closed union in `types/violations.ts`, so a caller can render them with the
 * same table it uses for a refused intent. Three places read it: the golden
 * corpus, the simulator, and `pnpm db:check` control 9 — the one that compares
 * a rebuilt state with a dumped one.
 *
 * What it does NOT check: that the state agrees with the journal. That is the
 * rebuild's job, and it needs the journal.
 */

import type { CampaignState } from './types/campaign.js';
import type { GameEvent, GameEventType } from './types/events.js';
import { ENGINE_ONLY_EVENT_TYPES } from './types/events.js';
import { GAUGE_MAX, GAUGE_MIN } from './types/gauges.js';
import { MAX_PROGRESS_TICKS } from './types/progress.js';
import { SCENE_PRESENCE_MAX } from './types/scene.js';
import type { RuleViolation } from './types/violations.js';

/** Sorted by `ref.id`, with no repeat. What the prompt cache depends on. */
function sortedByRef(entries: readonly { readonly ref: { readonly id: string } }[]): boolean {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous === undefined || current === undefined) return true;
    if (previous.ref.id.localeCompare(current.ref.id) >= 0) return false;
  }
  return true;
}

/**
 * Everything wrong with this state, or an empty list.
 *
 * The order is stable — characters, tracks, clocks, then the scene — so a diff
 * of two runs is readable.
 */
export function checkInvariants(state: CampaignState): readonly RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const [key, character] of Object.entries(state.characters)) {
    if (key !== character.id) {
      violations.push({ code: 'unknown_character', details: { key, id: character.id } });
    }
    for (const [gauge, value] of Object.entries(character.gauges)) {
      if (!Number.isInteger(value) || value < GAUGE_MIN || value > GAUGE_MAX) {
        violations.push({
          code: 'gauge_out_of_range',
          details: { characterId: character.id, gauge, value },
        });
      }
    }
    const { momentumBounds } = character;
    if (character.momentum < momentumBounds.min || character.momentum > momentumBounds.max) {
      violations.push({
        code: 'gauge_out_of_range',
        details: { characterId: character.id, gauge: 'momentum', value: character.momentum },
      });
    }
  }

  for (const [key, track] of Object.entries(state.tracks)) {
    if (key !== track.id) {
      violations.push({ code: 'unknown_track', details: { key, id: track.id } });
    }
    if (!Number.isInteger(track.ticks) || track.ticks < 0 || track.ticks > MAX_PROGRESS_TICKS) {
      violations.push({
        code: 'gauge_out_of_range',
        details: { trackId: track.id, gauge: 'ticks', value: track.ticks },
      });
    }
  }

  for (const [key, clock] of Object.entries(state.clocks)) {
    if (key !== clock.id) {
      violations.push({ code: 'unknown_clock', details: { key, id: clock.id } });
    }
    if (!Number.isInteger(clock.filled) || clock.filled < 0 || clock.filled > clock.segments) {
      violations.push({
        code: 'gauge_out_of_range',
        details: { clockId: clock.id, gauge: 'segments', value: clock.filled },
      });
    }
  }

  const { scene } = state;
  if (scene !== null) {
    // The cap is a CHECK here and a truncation upstream (02-mj-ia.md section
    // 4.7.3, rule S7). Truncating a second time, inside the reducer, would be
    // a divergent copy of the rule; saying it is broken is not.
    if (scene.present.length > SCENE_PRESENCE_MAX) {
      violations.push({
        code: 'scene_capacity_exceeded',
        details: { list: 'present', size: scene.present.length },
      });
    }
    if (scene.absent.length > SCENE_PRESENCE_MAX) {
      violations.push({
        code: 'scene_capacity_exceeded',
        details: { list: 'absent', size: scene.absent.length },
      });
    }
    if (!sortedByRef(scene.present)) {
      violations.push({ code: 'target_not_present', details: { list: 'present', sorted: false } });
    }
    if (!sortedByRef(scene.absent)) {
      violations.push({ code: 'target_not_present', details: { list: 'absent', sorted: false } });
    }
  }

  return violations;
}

/** `true` when nothing is wrong. Reads better at a call site than a length. */
export function isConsistent(state: CampaignState): boolean {
  return checkInvariants(state).length === 0;
}

// --------------------------------------------------- invariant 1, mechanically

/**
 * The THREE closed lists of ARCHITECTURE.md section 1, invariant 1: everything
 * the model can reach, and by which route.
 *
 * They are kept SEPARATE, as that section keeps them, because they are three
 * different circuits with three different guarantees. Merged into one list they
 * would read as "what the model may write", which is precisely the sentence
 * invariant 1 exists to make false.
 */

/** 1. Through a validated proposal (`propose_*` or the `<scene_apres>` block). */
export const AI_PROPOSABLE_EVENT_TYPES = [
  'entity.introduced',
  'entity.updated',
  'entity.status_changed',
  'clock.created',
  'clock.advanced',
  'scene.started',
  'scene.ended',
  'scene.facts_updated',
] as const satisfies readonly GameEventType[];

/** 2. Through `roll_oracle`, the one read tool that writes. */
export const AI_TOOL_EVENT_TYPES = [
  'roll.oracle_resolved',
  'roll.yes_no_resolved',
] as const satisfies readonly GameEventType[];

/** 3. Through the right of refusal — and it carries `actorKind: 'system'`. */
export const AI_REFUSAL_EVENT_TYPES = [
  'system.reverted',
] as const satisfies readonly GameEventType[];

/**
 * The trace of what the model SAID, which has no game value and no effect on
 * the reducer (03-donnees.md section 0.5). Excluded by nature, not by grant.
 */
function isNarration(type: GameEventType): boolean {
  return type.startsWith('narration.');
}

/**
 * May an entry of this type carry `actorKind: 'gm_ai'`?
 *
 * Note what this is NOT saying about `clock.advanced`, which appears both in
 * `ENGINE_ONLY_EVENT_TYPES` and in the proposal list. There is no contradiction:
 * the model PROPOSES a clock advance and the ENGINE writes it, so the entry
 * that lands in the journal carries `actorKind: 'engine'`. An entry of that type
 * signed by the model is a proposal that skipped the server, which is the
 * failure this function names.
 */
export function mayBeAuthoredByAi(type: GameEventType): boolean {
  if ((ENGINE_ONLY_EVENT_TYPES as readonly GameEventType[]).includes(type)) {
    return (AI_TOOL_EVENT_TYPES as readonly GameEventType[]).includes(type);
  }
  return (
    isNarration(type) || (AI_PROPOSABLE_EVENT_TYPES as readonly GameEventType[]).includes(type)
  );
}

/** Thrown when an entry signed by the model would change the state of play. */
export class AiCannotMutateState extends Error {
  readonly eventType: GameEventType;

  constructor(eventType: GameEventType) {
    super(
      `${JSON.stringify(eventType)} cannot carry actorKind "gm_ai". Invariant 1: the engine ` +
        `decides, the storyteller tells. A gauge, a roll, a track or a clock is written by the ` +
        `engine after the server has validated an intent or a proposal; an entry of this type ` +
        `signed by the model is a write path that bypassed the only one there is ` +
        `(ARCHITECTURE.md section 6).`,
    );
    this.name = 'AiCannotMutateState';
    this.eventType = eventType;
  }
}

/** `true` when this entry breaches invariant 1. */
export function isAiAuthoredMutation(event: GameEvent): boolean {
  return event.actorKind === 'gm_ai' && !mayBeAuthoredByAi(event.type);
}

/**
 * The input validator of invariant 1: refuse the entry, loudly.
 *
 * It THROWS rather than returning a `RuleViolation`, and the distinction is the
 * one `result.ts` draws: a rule violation is something a player can do and be
 * told about, while this is a programming error — a caller building a journal
 * entry that the architecture forbids. There is no message to render, because
 * no player will ever see it.
 */
export function assertNotAiAuthored(event: GameEvent): void {
  if (isAiAuthoredMutation(event)) throw new AiCannotMutateState(event.type);
}
