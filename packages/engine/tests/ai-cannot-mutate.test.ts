/**
 * Invariant 1, proven by violating it: the storyteller cannot move a gauge.
 *
 * ARCHITECTURE.md section 1 names this file as one of the three tests that
 * break the build when the invariant goes. So it is tested BOTH WAYS on every
 * type of the catalogue: red WITH `actorKind: 'gm_ai'`, green WITHOUT. A guard
 * measured only in the direction where it fires is a guard nobody has proven
 * can be satisfied.
 */

import { describe, expect, it } from 'vitest';

import type { GameEvent, GameEventType } from '../src/index.js';
import {
  AI_PROPOSABLE_EVENT_TYPES,
  AI_REFUSAL_EVENT_TYPES,
  AI_TOOL_EVENT_TYPES,
  AiCannotMutateState,
  ENGINE_ONLY_EVENT_TYPES,
  GAME_EVENT_TYPES,
  assertNotAiAuthored,
  isAiAuthoredMutation,
  mayBeAuthoredByAi,
} from '../src/index.js';
import { everyEventJournal } from './support/every-event.test.js';

const journal = everyEventJournal();

function withActorKind(event: GameEvent, actorKind: GameEvent['actorKind']): GameEvent {
  return { ...event, actorKind };
}

describe('no gauge event is ever signed by the model', () => {
  const gaugeEvents = journal.filter((event) =>
    (ENGINE_ONLY_EVENT_TYPES as readonly GameEventType[]).includes(event.type),
  );

  it('finds the entries it is supposed to scan', () => {
    // Without this, a bad filter would make every assertion below pass on an
    // empty list — the "rule present and inert" failure this repository keeps
    // meeting.
    expect(gaugeEvents.length).toBe(ENGINE_ONLY_EVENT_TYPES.length);
  });

  it.each(
    ENGINE_ONLY_EVENT_TYPES.filter(
      (type) => !(AI_TOOL_EVENT_TYPES as readonly GameEventType[]).includes(type),
    ).map((type) => [type]),
  )('refuses %s when it carries actorKind gm_ai', (type) => {
    const event = journal.find((entry) => entry.type === type)!;
    expect(isAiAuthoredMutation(withActorKind(event, 'gm_ai'))).toBe(true);
    expect(() => {
      assertNotAiAuthored(withActorKind(event, 'gm_ai'));
    }).toThrow(AiCannotMutateState);
  });

  it.each(ENGINE_ONLY_EVENT_TYPES.map((type) => [type]))(
    'accepts %s when the engine signs it',
    (type) => {
      const event = journal.find((entry) => entry.type === type)!;
      expect(isAiAuthoredMutation(withActorKind(event, 'engine'))).toBe(false);
      expect(() => {
        assertNotAiAuthored(withActorKind(event, 'engine'));
      }).not.toThrow();
    },
  );

  it('names the type it refused, so the failure is readable', () => {
    const gauge = journal.find((entry) => entry.type === 'character.gauge_changed')!;
    expect(() => {
      assertNotAiAuthored(withActorKind(gauge, 'gm_ai'));
    }).toThrow(/character\.gauge_changed/);
  });
});

describe('the three circuits the model does reach', () => {
  it('lets a proposal circuit type be attributed to the model', () => {
    // ONE EXCEPTION, and it is a finding rather than a bug: `clock.advanced`
    // is in ARCHITECTURE.md's proposal list AND in `ENGINE_ONLY_EVENT_TYPES`.
    // The two agree once read properly — the model PROPOSES the advance, the
    // ENGINE writes it — so the entry that lands in the journal is signed
    // `engine` and never `gm_ai`. Pinned here so that reading stays deliberate.
    const writtenByTheEngine: readonly GameEventType[] = ['clock.advanced'];
    for (const type of AI_PROPOSABLE_EVENT_TYPES) {
      expect(mayBeAuthoredByAi(type)).toBe(!writtenByTheEngine.includes(type));
    }
    expect(
      AI_PROPOSABLE_EVENT_TYPES.filter((type) =>
        (ENGINE_ONLY_EVENT_TYPES as readonly GameEventType[]).includes(type),
      ),
    ).toEqual(writtenByTheEngine);
  });

  it('lets roll_oracle write its two entries', () => {
    for (const type of AI_TOOL_EVENT_TYPES) {
      expect(mayBeAuthoredByAi(type)).toBe(true);
    }
  });

  it('keeps the right of refusal under actorKind system, never gm_ai', () => {
    for (const type of AI_REFUSAL_EVENT_TYPES) {
      expect(mayBeAuthoredByAi(type)).toBe(false);
    }
  });

  it('excludes the narration family by nature, not by grant', () => {
    const narration = GAME_EVENT_TYPES.filter((type) => type.startsWith('narration.'));
    expect(narration).toHaveLength(7);
    for (const type of narration) {
      expect(mayBeAuthoredByAi(type)).toBe(true);
      expect(AI_PROPOSABLE_EVENT_TYPES as readonly GameEventType[]).not.toContain(type);
    }
  });

  it('refuses everything else, which is most of the catalogue', () => {
    // Written out rather than recomputed from the lists under test: a count
    // derived from the very constants it checks passes whatever they say.
    expect(GAME_EVENT_TYPES.filter((type) => mayBeAuthoredByAi(type))).toEqual([
      'roll.oracle_resolved',
      'roll.yes_no_resolved',
      'clock.created',
      'scene.started',
      'scene.ended',
      'scene.facts_updated',
      'narration.player_message',
      'narration.gm_message',
      'narration.gm_failed',
      'narration.gm_proposal',
      'narration.proposal_accepted',
      'narration.proposal_rejected',
      'narration.safety_flag',
      'entity.introduced',
      'entity.updated',
      'entity.status_changed',
    ]);
  });
});

describe('the fixture journal itself is legal', () => {
  it.each(journal.map((event) => [event.type, event] as const))(
    '%s passes the validator as written',
    (_type, event) => {
      expect(() => {
        assertNotAiAuthored(event);
      }).not.toThrow();
    },
  );
});
