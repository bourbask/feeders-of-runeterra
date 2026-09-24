/**
 * `decide()` — the function that settles things, measured.
 *
 * Three families of assertion, in the order they matter:
 *
 *   1. it REFUSES, with a code from the closed list, and never throws;
 *   2. it DECIDES the same thing twice from the same generator;
 *   3. it writes the journal the rest of the system reads — one turn, one
 *      correlation group, dense sequences, and no `EngineEffect` coming from
 *      anywhere but the content.
 */

import {
  aCharacter,
  aScene,
  aScenePresence,
  aTableState,
  anId,
  counterIds,
  scriptedRng,
  stableStringify,
} from '@for/testkit';
import { describe, expect, it } from 'vitest';

import {
  aContent,
  aDecisionContext,
  byStream,
  oneStream,
} from '../tests/support/engine-content.test.js';
import type {
  CampaignState,
  DecisionContext,
  GameEvent,
  Intent,
  Rng,
  RngStream,
  RuleViolation,
  TrackState,
} from './index.js';
import {
  NO_EFFECT_INDEX,
  createSeededRng,
  decide,
  fallbackTemplateId,
  isErr,
  isExtremeAnswer,
  isOk,
} from './index.js';

const HERO = anId('character');
const PLAYER = anId('player');
const TRACK = anId('track');
const CLOCK = anId('clock');
const FOE = anId('entity');

function aPlayableState(overrides: Parameters<typeof aTableState>[0] = {}): CampaignState {
  return aTableState({
    seq: 10,
    status: 'active',
    characters: [aCharacter({ id: HERO, playerId: PLAYER })],
    ...overrides,
  });
}

/** What each named stream will serve, in order. An unscripted stream throws. */
type Scripts = Partial<Record<RngStream, readonly number[]>>;

/**
 * One generator PER STREAM, each one scripted and each one exhausting into an
 * exception. A shared generator would hide the very thing these tests measure:
 * that a price draw and an action draw do not share an index.
 */
function aCtx(
  action: readonly number[],
  scripts: Scripts = {},
  overrides: Partial<DecisionContext> = {},
): DecisionContext {
  const built: Partial<Record<RngStream, Rng>> = {};
  for (const [name, values] of Object.entries({ action, ...scripts })) {
    built[name as RngStream] = scriptedRng(values);
  }
  return aDecisionContext({
    rng: byStream(built, scriptedRng([])),
    ids: counterIds('id'),
    actorId: HERO,
    ...overrides,
  });
}

/** The roll that beats both dice: a d6 of 6 against a 1 and a 2. */
const CLEAN_HIT = [6, 1, 2];
/** Beats one die only. */
const WEAK_HIT = [3, 1, 9];
/** Beats neither — and the two challenge dice DIFFER, so no presage rides. */
const MISS = [1, 9, 8];

function typesOf(events: readonly GameEvent[]): readonly string[] {
  return events.map((event) => event.type);
}

function violationOf(result: ReturnType<typeof decide>): RuleViolation {
  if (isOk(result))
    throw new Error(`expected a refusal, got ${stableStringify(result.value.events)}`);
  return result.error;
}

// ------------------------------------------------------------------ refusals

describe('what decide refuses, and with which code', () => {
  const faceDanger: Intent = {
    type: 'move.face_danger',
    attribute: 'fer',
    description: 'je saute',
  };

  it('refuses everything while the campaign is not active', () => {
    const paused = aPlayableState({ status: 'paused' });
    expect(violationOf(decide(paused, faceDanger, aCtx(CLEAN_HIT))).code).toBe(
      'campaign_not_active',
    );
  });

  it('refuses a character nobody has heard of', () => {
    const state = aPlayableState();
    const ctx = aCtx(CLEAN_HIT, {}, { actorId: anId('character', 9) });
    expect(violationOf(decide(state, faceDanger, ctx)).code).toBe('unknown_character');
  });

  it.each([
    ['dead', 'character_dead'],
    ['retired', 'character_retired'],
    ['draft', 'character_not_in_campaign'],
  ] as const)('refuses a %s character with %s', (status, code) => {
    const state = aPlayableState({
      characters: [aCharacter({ id: HERO, playerId: PLAYER, status })],
    });
    expect(violationOf(decide(state, faceDanger, aCtx(CLEAN_HIT))).code).toBe(code);
  });

  it('refuses a character whose player left the table', () => {
    const state = aPlayableState({
      party: { memberPlayerIds: [], ownerPlayerId: PLAYER },
    });
    expect(violationOf(decide(state, faceDanger, aCtx(CLEAN_HIT))).code).toBe('not_a_member');
  });

  it('refuses a move the content bundle does not carry', () => {
    const state = aPlayableState();
    const ctx = aCtx(CLEAN_HIT, {}, { content: aContent({ moves: {} }) });
    expect(violationOf(decide(state, faceDanger, ctx)).code).toBe('unknown_move');
  });

  it('refuses an attribute the move does not offer', () => {
    const state = aPlayableState();
    const intent: Intent = { type: 'move.secure_advantage', attribute: 'fer', description: '' };
    expect(violationOf(decide(state, intent, aCtx(CLEAN_HIT))).code).toBe('attribute_not_allowed');
  });

  it('refuses a move whose content offers no attribute at all', () => {
    const content = aContent();
    const broken = aContent({
      moves: {
        ...content.moves,
        'endure-cold': { ...content.moves['endure-cold']!, attributeOptions: [] },
      },
    });
    const state = aPlayableState();
    const result = decide(
      state,
      { type: 'move.endure_cold' },
      aCtx(CLEAN_HIT, {}, { content: broken }),
    );
    expect(violationOf(result).code).toBe('unknown_move');
  });

  it('refuses an attribute value no character sheet could hold', () => {
    const state = aPlayableState({
      characters: [
        aCharacter({
          id: HERO,
          playerId: PLAYER,
          attributes: { vif: 2, coeur: 3, fer: 0, ombre: 1, esprit: 1 },
        }),
      ],
    });
    expect(violationOf(decide(state, faceDanger, aCtx(CLEAN_HIT))).code).toBe(
      'attribute_not_allowed',
    );
  });

  it('refuses a momentum no character sheet could hold', () => {
    const state = aPlayableState({
      characters: [aCharacter({ id: HERO, playerId: PLAYER, momentum: 1.5 })],
    });
    expect(violationOf(decide(state, faceDanger, aCtx(CLEAN_HIT))).code).toBe('gauge_out_of_range');
  });
});

// ------------------------------------------------------------------ one turn

describe('one turn of face-danger, written to the journal', () => {
  const state = aPlayableState();
  const result = decide(
    state,
    { type: 'move.face_danger', attribute: 'fer', description: 'je saute', bonus: 1 },
    aCtx(CLEAN_HIT),
  );
  if (isErr(result)) throw new Error(result.error.code);
  const { events, brief } = result.value;

  it('declares, rolls, applies and resolves, in that order', () => {
    expect(typesOf(events)).toEqual([
      'move.declared',
      'roll.action_resolved',
      'character.momentum_changed',
      'move.resolved',
    ]);
  });

  it('numbers the entries densely from the state it was given', () => {
    expect(events.map((event) => event.seq)).toEqual([11, 12, 13, 14]);
  });

  it('groups the whole turn under one correlation identifier', () => {
    expect(new Set(events.map((event) => event.correlationId)).size).toBe(1);
    expect(brief.correlationId).toBe(events[0]?.correlationId);
  });

  it('hangs every entry off the declaration', () => {
    expect(events[0]?.causationId).toBeNull();
    for (const event of events.slice(1)) expect(event.causationId).toBe(events[0]?.id);
  });

  it('leaves scope and recipients to the server (ADR 0008)', () => {
    for (const event of events) {
      expect(event.scope).toBe('table');
      expect(event.recipients).toBeNull();
    }
  });

  it('reads the clock from the context and never from the ambient one', () => {
    expect(new Set(events.map((event) => event.createdAt)).size).toBe(1);
  });

  it('signs the declaration by the player and the roll by the engine', () => {
    expect(events[0]?.actorKind).toBe('player');
    expect(events[0]?.actorPlayerId).toBe(PLAYER);
    expect(events[1]?.actorKind).toBe('engine');
    expect(events[1]?.actorPlayerId).toBeNull();
  });

  it('carries the declared bonus as an add, not as a hidden modifier', () => {
    const declared = events[0];
    if (declared?.type !== 'move.declared') throw new Error('not a declaration');
    expect(declared.payload.declaredAdds).toEqual([{ source: 'intent', value: 1 }]);
    expect(declared.payload.chosenAttribute).toBe('fer');
  });

  it('records the stream and the draw index of the roll', () => {
    expect(events[1]?.rngStream).toBe('action');
    expect(events[1]?.rngDrawIndex).toBe(0);
  });

  it('hands the storyteller a settled fact, not a parameter', () => {
    expect(brief.outcome).toBe('franche');
    expect(brief.roll?.total).toBe(6 + 2 + 1);
    expect(brief.appliedEffects.map((applied) => applied.effect.op)).toEqual(['momentum']);
    expect(brief.eventSeqs).toEqual([11, 12, 13, 14]);
    expect(brief.playerInput).toBe('je saute');
    expect(brief.fallbackTemplateId).toBe('face-danger/franche');
  });

  it('points every applied effect at an entry of this very turn', () => {
    for (const applied of brief.appliedEffects) {
      expect(brief.eventSeqs).toContain(applied.eventSeq);
    }
  });

  it('decides the same thing twice from the same generator', () => {
    const again = decide(
      state,
      { type: 'move.face_danger', attribute: 'fer', description: 'je saute', bonus: 1 },
      aCtx(CLEAN_HIT),
    );
    if (isErr(again)) throw new Error(again.error.code);
    expect(stableStringify(again.value)).toBe(stableStringify(result.value));
  });

  it('advances the draw index from where the state left it', () => {
    const later = aPlayableState({ rng: { seed: 'x', draws: { action: 7 } } });
    const next = decide(
      later,
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx(CLEAN_HIT),
    );
    if (isErr(next)) throw new Error(next.error.code);
    expect(next.value.events[1]?.rngDrawIndex).toBe(7);
  });
});

// ------------------------------------------------------------ the dice rules

describe('what the dice impose', () => {
  it('opens the burn window when burning would change the score', () => {
    const state = aPlayableState({
      characters: [aCharacter({ id: HERO, playerId: PLAYER, momentum: 9 })],
    });
    const result = decide(
      state,
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx(WEAK_HIT),
    );
    if (isErr(result)) throw new Error(result.error.code);
    const roll = result.value.events[1];
    if (roll?.type !== 'roll.action_resolved') throw new Error('not a roll');
    expect(roll.payload.burnWindow).toBe(true);
  });

  it('leaves it shut when the move forbids the burn', () => {
    const state = aPlayableState({
      characters: [aCharacter({ id: HERO, playerId: PLAYER, momentum: 9 })],
      tracks: [{ ...aTrackFixture(), ticks: 4 }],
    });
    const result = decide(state, { type: 'move.fulfill_your_vow', trackId: TRACK }, aCtx([1, 9]));
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).toContain('roll.progress_resolved');
  });

  it('writes the negation of the action die as its own entry', () => {
    const state = aPlayableState({
      characters: [aCharacter({ id: HERO, playerId: PLAYER, momentum: -3 })],
    });
    const result = decide(
      state,
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx([3, 9, 8], { price: [1] }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).toContain('character.momentum_negated');
  });

  it('draws a presage when the challenge dice match, whatever the outcome', () => {
    const state = aPlayableState();
    const result = decide(
      state,
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx([6, 4, 4], { presage: [2] }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).toContain('roll.presage_drawn');
    expect(result.value.brief.presage?.entryId).toBe('pr1');
    expect(result.value.brief.isPresage).toBe(true);
  });

  it('never opens the presage table when the dice differ', () => {
    const state = aPlayableState();
    const result = decide(
      state,
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx(CLEAN_HIT),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).not.toContain('roll.presage_drawn');
  });

  it('refuses to draw a presage from a table that is not the presage table', () => {
    const content = aContent({
      presageTable: { ...aContent().presageTable, id: 'complication' },
    });
    const result = decide(
      aPlayableState(),
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx([6, 4, 4], {}, { content }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).not.toContain('roll.presage_drawn');
  });
});

function aTrackFixture(): TrackState {
  return {
    id: TRACK,
    kind: 'vow',
    rank: 'dangereux',
    title: 'Ramener la corne',
    description: '',
    ownerCharacterId: null,
    ticks: 0,
    status: 'open',
    visibility: 'public',
    tags: [],
    createdSeq: 1,
    updatedSeq: 1,
    resolvedSeq: null,
  };
}

// ------------------------------------------------------------------ ADR 0006

describe('paying the price: one mode, and nobody chooses', () => {
  const state = aPlayableState();

  it('rolls the d12 and imposes what came up', () => {
    const result = decide(
      state,
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx(MISS, { price: [2] }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).toEqual([
      'move.declared',
      'roll.action_resolved',
      'roll.price_paid',
      'character.gauge_changed',
      'move.resolved',
    ]);
    expect(result.value.brief.imposedPrice?.entryId).toBe('p2');
    expect(result.value.brief.imposedPrice?.effectIndex).toBe(0);
  });

  it('arbitrates several effects with a SECOND draw, never with a choice', () => {
    const result = decide(
      state,
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx(MISS, { price: [3, 2] }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(result.value.brief.imposedPrice?.effectIndex).toBe(1);
    const gauge = result.value.events.find((event) => event.type === 'character.gauge_changed');
    if (gauge?.type !== 'character.gauge_changed') throw new Error('no gauge entry');
    expect(gauge.payload.gauge).toBe('ame');
  });

  it('spends no die on a one-horse race, and says so with NO_EFFECT_INDEX', () => {
    const result = decide(
      state,
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx(MISS, { price: [1] }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(result.value.brief.imposedPrice?.effectIndex).toBe(NO_EFFECT_INDEX);
    expect(typesOf(result.value.events)).toEqual([
      'move.declared',
      'roll.action_resolved',
      'roll.price_paid',
      'move.resolved',
    ]);
  });

  it('bounds a price that drags another price behind it', () => {
    const result = decide(
      state,
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx(MISS, { price: [12, 12] }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    // Two price entries, and the nested one stops there: no third draw is
    // asked for, which the scripted generator would have refused to serve.
    expect(typesOf(result.value.events).filter((type) => type === 'roll.price_paid')).toHaveLength(
      2,
    );
  });

  /**
   * The INSTANCE contract of `DecisionRng.stream()`, measured.
   *
   * A nested price calls `ctx.rng.stream('price')` a second time. The contract
   * is that the second call hands back THE SAME generator, so the nested draw
   * is the second draw of the stream. An implementation that builds a fresh
   * generator per call — and `createCampaignRng(seed, turnSeq, stream)`, which
   * the interface comment calls canonical, is exactly that if it is called
   * again — restarts at draw 0 and serves the first value twice.
   *
   * The two tests below are the same journal under the two implementations.
   * Scripting the stream `[12, 12]` cannot tell them apart; `[12, 4]` can.
   */
  function priceValuesOf(events: readonly GameEvent[]): readonly number[] {
    return events.flatMap((event) =>
      event.type === 'roll.price_paid' ? [event.payload.value] : [],
    );
  }

  const nestedPrice: Intent = { type: 'move.face_danger', attribute: 'fer', description: '' };

  it('draws the nested price from the SAME generator: second draw, not a replay', () => {
    const result = decide(state, nestedPrice, aCtx(MISS, { price: [12, 4] }));
    if (isErr(result)) throw new Error(result.error.code);
    expect(priceValuesOf(result.value.events)).toEqual([12, 4]);
  });

  it('would serve 12 twice if stream() handed back a fresh generator', () => {
    // The counter-implementation, written down rather than argued about: only
    // the `price` stream is made fresh-each-call, so the action roll is the
    // one above and the sole difference is the nested draw.
    const action = scriptedRng([...MISS]);
    const freshPricePerCall = {
      stream: (name: RngStream): Rng => (name === 'price' ? scriptedRng([12, 4]) : action),
    };
    const result = decide(state, nestedPrice, aCtx(MISS, {}, { rng: freshPricePerCall }));
    if (isErr(result)) throw new Error(result.error.code);
    expect(priceValuesOf(result.value.events)).toEqual([12, 12]);
  });

  it('writes nothing when the bundle hands over a table that is not the price table', () => {
    const content = aContent({ priceTable: { ...aContent().priceTable, id: 'complication' } });
    const result = decide(
      state,
      { type: 'move.face_danger', attribute: 'fer', description: '' },
      aCtx(MISS, {}, { content }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).not.toContain('roll.price_paid');
  });
});

// ------------------------------------------------------------- every move

describe('the eleven moves', () => {
  it('forces esprit on gather-information and draws its oracle', () => {
    const result = decide(
      aPlayableState(),
      { type: 'move.gather_information', description: 'je demande au camp' },
      aCtx(CLEAN_HIT, { oracle: [5] }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    const declared = result.value.events[0];
    if (declared?.type !== 'move.declared') throw new Error('not a declaration');
    expect(declared.payload.chosenAttribute).toBe('esprit');
    const oracle = result.value.events.find((event) => event.type === 'roll.oracle_resolved');
    if (oracle?.type !== 'roll.oracle_resolved') throw new Error('no oracle entry');
    expect(oracle.payload.entryId).toBe('c2');
    expect(oracle.payload.tableVersion).toBe('1.0.0');
  });

  it('writes nothing for an oracle effect naming a table the bundle lacks', () => {
    const result = decide(
      aPlayableState(),
      { type: 'move.gather_information', description: '' },
      aCtx(MISS),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).not.toContain('roll.oracle_resolved');
  });

  it('refuses a strike with no scene open', () => {
    const result = decide(
      aPlayableState(),
      { type: 'move.strike', targetId: FOE, attribute: 'fer' },
      aCtx(CLEAN_HIT),
    );
    expect(violationOf(result).code).toBe('no_active_scene');
  });

  it('refuses a strike at somebody who is not in the scene', () => {
    const state = aPlayableState({ scene: aScene({ present: [aScenePresence()] }) });
    const result = decide(
      state,
      { type: 'move.strike', targetId: FOE, attribute: 'fer' },
      aCtx(CLEAN_HIT),
    );
    expect(violationOf(result).code).toBe('target_not_present');
  });

  it('strikes a target who is there, and ticks the fight', () => {
    const state = aPlayableState({
      scene: aScene({
        present: [aScenePresence({ ref: { kind: 'entity', id: FOE }, name: 'Katla' })],
      }),
      tracks: [{ ...aTrackFixture(), kind: 'combat' }],
    });
    const result = decide(
      state,
      { type: 'move.strike', targetId: FOE, attribute: 'fer' },
      aCtx(CLEAN_HIT),
    );
    if (isErr(result)) throw new Error(result.error.code);
    const ticked = result.value.events.find((event) => event.type === 'track.ticked');
    if (ticked?.type !== 'track.ticked') throw new Error('no tick');
    expect(ticked.payload.to).toBe(4);
    expect(ticked.payload.milestones).toBe(0);
  });

  it('refuses to probe a soul that does not exist', () => {
    const result = decide(
      aPlayableState(),
      { type: 'move.probe_a_soul', target: { kind: 'entity', entityId: FOE } },
      aCtx(CLEAN_HIT),
    );
    expect(violationOf(result).code).toBe('unknown_entity');
  });

  it('probes a described soul without inventing an entity', () => {
    const result = decide(
      aPlayableState(),
      { type: 'move.probe_a_soul', target: { kind: 'description', text: 'la vieille au feu' } },
      aCtx(WEAK_HIT),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).not.toContain('entity.introduced');
    expect(result.value.brief.playerInput).toBe('la vieille au feu');
    const added = result.value.events.find((event) => event.type === 'character.condition_added');
    if (added?.type !== 'character.condition_added') throw new Error('no condition');
    expect(added.payload.label).toBe('Trouble');
  });

  it('writes nothing for a condition the bundle does not define', () => {
    const result = decide(
      aPlayableState(),
      { type: 'move.probe_a_soul', target: { kind: 'description', text: '' } },
      aCtx(MISS),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).not.toContain('character.condition_added');
  });

  it('takes the harm before the roll, whatever the roll gives', () => {
    const result = decide(
      aPlayableState(),
      { type: 'move.endure_harm', amount: 2 },
      aCtx(CLEAN_HIT),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).toEqual([
      'move.declared',
      'character.gauge_changed',
      'roll.action_resolved',
      'character.momentum_changed',
      'move.resolved',
    ]);
    const harm = result.value.events[1];
    if (harm?.type !== 'character.gauge_changed') throw new Error('no harm');
    expect(harm.payload.to).toBe(3);
  });

  it('removes a condition the character has, and nothing when they have none', () => {
    const wounded = aPlayableState({
      characters: [
        aCharacter({
          id: HERO,
          playerId: PLAYER,
          conditions: [{ conditionId: 'trouble', label: 'Trouble', source: 'engine', sinceSeq: 1 }],
        }),
      ],
    });
    const removed = decide(wounded, { type: 'move.endure_harm' }, aCtx(WEAK_HIT));
    if (isErr(removed)) throw new Error(removed.error.code);
    expect(typesOf(removed.value.events)).toContain('character.condition_removed');

    const clean = decide(aPlayableState(), { type: 'move.endure_harm' }, aCtx(WEAK_HIT));
    if (isErr(clean)) throw new Error(clean.error.code);
    expect(typesOf(clean.value.events)).not.toContain('character.condition_removed');
  });

  it('resets momentum through the ordinary momentum entry', () => {
    const state = aPlayableState({
      characters: [aCharacter({ id: HERO, playerId: PLAYER, momentum: 8 })],
    });
    const result = decide(state, { type: 'move.endure_harm' }, aCtx(MISS));
    if (isErr(result)) throw new Error(result.error.code);
    const reset = result.value.events.find((event) => event.type === 'character.momentum_changed');
    if (reset?.type !== 'character.momentum_changed') throw new Error('no reset');
    expect(reset.payload.to).toBe(2);
  });

  it('writes nothing when a momentum reset would change nothing', () => {
    const result = decide(aPlayableState(), { type: 'move.endure_harm' }, aCtx(MISS));
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).not.toContain('character.momentum_changed');
  });

  it('spreads an all-allies gauge over every active character, sorted', () => {
    const second = aCharacter({ id: anId('character', 2), playerId: anId('player', 2) });
    const state = aPlayableState({
      characters: [aCharacter({ id: HERO, playerId: PLAYER }), second],
    });
    const result = decide(state, { type: 'move.endure_cold' }, aCtx(WEAK_HIT));
    if (isErr(result)) throw new Error(result.error.code);
    const touched = result.value.events
      .filter((event) => event.type === 'character.gauge_changed')
      .map((event) => event.subjectCharacterId);
    expect(touched).toEqual([HERO, second.id]);
  });

  it('touches nobody for a chosen-ally effect, because no intent carries the choice', () => {
    const result = decide(aPlayableState(), { type: 'move.endure_cold' }, aCtx(MISS));
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).not.toContain('character.gauge_changed');
    // ADR 0006 bound 3: the selection is an ordinary player intent, and there
    // is none yet. The effect is NOT reported as applied.
    expect(result.value.brief.appliedEffects).toEqual([]);
  });

  it('opens a vow at the rank the player asked for', () => {
    const result = decide(
      aPlayableState(),
      { type: 'move.swear_a_vow', text: 'Ramener la corne', rank: 'redoutable' },
      aCtx(CLEAN_HIT),
    );
    if (isErr(result)) throw new Error(result.error.code);
    const created = result.value.events.find((event) => event.type === 'track.created');
    if (created?.type !== 'track.created') throw new Error('no track');
    expect(created.payload.rank).toBe('redoutable');
    expect(created.payload.kind).toBe('vow');
    expect(created.payload.title).toBe('Ramener la corne');
    expect(created.payload.ownerCharacterId).toBe(HERO);
  });

  it('opens nothing when neither the content nor the player names a rank', () => {
    const result = decide(
      aPlayableState(),
      { type: 'move.swear_a_vow', text: 'Ramener la corne', rank: 'redoutable' },
      aCtx(MISS),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).not.toContain('track.created');
  });

  it.each([
    ['unknown', 'unknown_track'],
    ['wrong-kind', 'track_wrong_kind'],
    ['closed', 'track_already_resolved'],
  ] as const)('refuses a milestone on a %s track with %s', (shape, code) => {
    const track = aTrackFixture();
    const tracks =
      shape === 'unknown'
        ? []
        : [
            shape === 'wrong-kind'
              ? { ...track, kind: 'combat' as const }
              : { ...track, status: 'fulfilled' as const },
          ];
    const state = aPlayableState({ tracks });
    const result = decide(state, { type: 'move.reach_a_milestone', trackId: TRACK }, aCtx([]));
    expect(violationOf(result).code).toBe(code);
  });

  it('marks a milestone without rolling anything at all', () => {
    const state = aPlayableState({ tracks: [aTrackFixture()] });
    const result = decide(state, { type: 'move.reach_a_milestone', trackId: TRACK }, aCtx([]));
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).toEqual([
      'move.declared',
      'track.ticked',
      'move.resolved',
    ]);
    const ticked = result.value.events[1];
    if (ticked?.type !== 'track.ticked') throw new Error('no tick');
    // Eight ticks: one milestone at rank `dangereux`, read from the engine.
    expect(ticked.payload.to).toBe(8);
    expect(ticked.payload.milestones).toBe(1);
    expect(result.value.brief.roll).toBeNull();
    expect(result.value.brief.fallbackTemplateId).toBe('reach-a-milestone/franche');
  });

  it('fulfills a vow on a progress roll and reports what it paid', () => {
    const state = aPlayableState({ tracks: [{ ...aTrackFixture(), ticks: 40 }] });
    const result = decide(state, { type: 'move.fulfill_your_vow', trackId: TRACK }, aCtx([1, 2]));
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).toEqual([
      'move.declared',
      'roll.progress_resolved',
      'character.xp_earned',
      'track.resolved',
      'move.resolved',
    ]);
    const resolved = result.value.events[3];
    if (resolved?.type !== 'track.resolved') throw new Error('not resolved');
    expect(resolved.payload.outcome).toBe('fulfilled');
    expect(resolved.payload.xpAwarded).toBe(2);
  });

  it('fails a vow whose track has nothing on it', () => {
    const state = aPlayableState({ tracks: [aTrackFixture()] });
    const result = decide(state, { type: 'move.fulfill_your_vow', trackId: TRACK }, aCtx([9, 8]));
    if (isErr(result)) throw new Error(result.error.code);
    const resolved = result.value.events.find((event) => event.type === 'track.resolved');
    if (resolved?.type !== 'track.resolved') throw new Error('not resolved');
    expect(resolved.payload.outcome).toBe('failed');
    expect(resolved.payload.xpAwarded).toBe(0);
  });

  it('forsakes a vow and records what it cost', () => {
    const state = aPlayableState({ tracks: [aTrackFixture()] });
    const result = decide(
      state,
      { type: 'move.forsake_your_vow', trackId: TRACK, reason: 'la bande rentre' },
      aCtx([]),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).toEqual([
      'move.declared',
      'character.xp_spent',
      'track.forsaken',
      'move.resolved',
    ]);
    const forsaken = result.value.events[2];
    if (forsaken?.type !== 'track.forsaken') throw new Error('not forsaken');
    expect(forsaken.payload.xpLost).toBe(1);
    expect(forsaken.payload.reason).toBe('la bande rentre');
  });

  it('advances the most recent ticking clock, and fills it at its last segment', () => {
    const clock = {
      id: CLOCK,
      title: 'La tempete',
      description: '',
      segments: 4 as const,
      filled: 3,
      status: 'ticking' as const,
      visibility: 'public' as const,
      consequence: 'le col se ferme',
      createdSeq: 1,
      updatedSeq: 1,
    };
    const state = aPlayableState({ clocks: [clock] });
    const result = decide(
      state,
      { type: 'move.secure_advantage', attribute: 'vif', description: '' },
      aCtx(MISS),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).toContain('clock.advanced');
    expect(typesOf(result.value.events)).toContain('clock.filled');
  });

  it('writes nothing when a clock is already full or none is ticking', () => {
    const full = {
      id: CLOCK,
      title: 'La tempete',
      description: '',
      segments: 4 as const,
      filled: 4,
      status: 'ticking' as const,
      visibility: 'public' as const,
      consequence: '',
      createdSeq: 1,
      updatedSeq: 1,
    };
    for (const clocks of [[], [full]]) {
      const result = decide(
        aPlayableState({ clocks }),
        { type: 'move.secure_advantage', attribute: 'vif', description: '' },
        aCtx(MISS),
      );
      if (isErr(result)) throw new Error(result.error.code);
      expect(typesOf(result.value.events)).not.toContain('clock.advanced');
    }
  });

  it('writes nothing for a choice effect, and does not report it as applied', () => {
    // ADR 0006 bound 3 again, from the other side: `choice` is legitimate
    // player agency, and the selection is an ordinary intent the protocol does
    // not carry yet. The engine picking an option on the player's behalf is
    // the one thing this effect must never become.
    const base = aContent();
    const content = aContent({
      moves: {
        ...base.moves,
        'endure-cold': {
          ...base.moves['endure-cold']!,
          outcomes: {
            ...base.moves['endure-cold']!.outcomes,
            franche: {
              effects: [
                {
                  op: 'choice',
                  label: 'perds des vivres ou encaisse',
                  pick: 1,
                  options: [
                    {
                      id: 'vivres',
                      label: 'vivres',
                      effects: [{ op: 'gauge', gauge: 'vivres', delta: -1, target: 'self' }],
                    },
                  ],
                },
                { op: 'xp', amount: 1 },
              ],
            },
          },
        },
      },
    });
    const result = decide(
      aPlayableState(),
      { type: 'move.endure_cold' },
      aCtx(CLEAN_HIT, {}, { content }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(result.value.brief.appliedEffects.map((applied) => applied.effect.op)).toEqual(['xp']);
    // The experience is earned with NO track attached, which is the other half
    // of the `character.xp_earned` payload.
    const earned = result.value.events.find((event) => event.type === 'character.xp_earned');
    if (earned?.type !== 'character.xp_earned') throw new Error('no xp');
    expect(earned.payload.trackId).toBeUndefined();
  });

  it('carries a narrative effect to the storyteller without writing a line', () => {
    const result = decide(
      aPlayableState(),
      { type: 'move.secure_advantage', attribute: 'vif', description: '' },
      aCtx(CLEAN_HIT),
    );
    if (isErr(result)) throw new Error(result.error.code);
    expect(result.value.brief.appliedEffects.map((applied) => applied.effect.op)).toEqual([
      'momentum',
      'narrative',
    ]);
  });
});

// ------------------------------------------------------------- burning elan

describe('burning momentum, in two steps', () => {
  const state = aPlayableState({
    characters: [aCharacter({ id: HERO, playerId: PLAYER, momentum: 8 })],
  });
  const rollId = anId('roll');
  const burnWindow = {
    rollId,
    rollSeq: 9,
    characterId: HERO,
    total: 5,
    challengeDice: [6, 7] as const,
  };

  it('refuses a burn with no window open', () => {
    const result = decide(state, { type: 'momentum.burn', rollId }, aCtx([]));
    expect(violationOf(result).code).toBe('no_burn_window');
  });

  it('refuses a burn aimed at another roll', () => {
    const ctx = aCtx([], {}, { burnWindow });
    const result = decide(state, { type: 'momentum.burn', rollId: anId('roll', 2) }, ctx);
    expect(violationOf(result).code).toBe('no_burn_window');
  });

  it('refuses a burn that would not improve the score', () => {
    const weak = aPlayableState({
      characters: [aCharacter({ id: HERO, playerId: PLAYER, momentum: 1 })],
    });
    const result = decide(weak, { type: 'momentum.burn', rollId }, aCtx([], {}, { burnWindow }));
    expect(violationOf(result).code).toBe('momentum_too_low');
  });

  it('adds a revision rather than rewriting the first roll', () => {
    const result = decide(state, { type: 'momentum.burn', rollId }, aCtx([], {}, { burnWindow }));
    if (isErr(result)) throw new Error(result.error.code);
    expect(typesOf(result.value.events)).toEqual([
      'character.momentum_burned',
      'roll.action_revised',
    ]);
    const revised = result.value.events[1];
    if (revised?.type !== 'roll.action_revised') throw new Error('no revision');
    expect(revised.payload.total).toBe(8);
    expect(revised.payload.outcome).toBe('franche');
    expect(revised.payload.revisedFromSeq).toBe(9);
  });

  it('drops momentum to the character bound, not to a constant', () => {
    const result = decide(state, { type: 'momentum.burn', rollId }, aCtx([], {}, { burnWindow }));
    if (isErr(result)) throw new Error(result.error.code);
    const burned = result.value.events[0];
    if (burned?.type !== 'character.momentum_burned') throw new Error('no burn');
    expect(burned.payload.spent).toBe(8);
    expect(burned.payload.resetTo).toBe(2);
  });

  it('keeps the presage of the roll it revises', () => {
    const matched = { ...burnWindow, challengeDice: [6, 6] as const };
    const result = decide(
      state,
      { type: 'momentum.burn', rollId },
      aCtx([], {}, { burnWindow: matched }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    const revised = result.value.events[1];
    if (revised?.type !== 'roll.action_revised') throw new Error('no revision');
    expect(revised.payload.isPresage).toBe(true);
  });
});

// --------------------------------------------------------------- the oracles

describe('asking and drawing the oracle', () => {
  const state = aPlayableState();

  it('answers yes below the band and no above it', () => {
    const yes = decide(
      state,
      { type: 'oracle.ask', question: 'Le pont tient-il ?', likelihood: 'incertain' },
      aCtx([], { oracle: [40] }),
    );
    if (isErr(yes)) throw new Error(yes.error.code);
    const answer = yes.value.events[0];
    if (answer?.type !== 'roll.yes_no_resolved') throw new Error('no answer');
    expect(answer.payload.answer).toBe('oui');
    expect(answer.payload.threshold).toBe(50);

    const no = decide(
      state,
      { type: 'oracle.ask', question: '', likelihood: 'incertain' },
      aCtx([], { oracle: [60] }),
    );
    if (isErr(no)) throw new Error(no.error.code);
    const second = no.value.events[0];
    if (second?.type !== 'roll.yes_no_resolved') throw new Error('no answer');
    expect(second.payload.answer).toBe('non');
  });

  it('calls the outermost tenth of each side extreme', () => {
    expect(isExtremeAnswer(1, 50)).toBe(true);
    expect(isExtremeAnswer(6, 50)).toBe(false);
    expect(isExtremeAnswer(100, 50)).toBe(true);
    expect(isExtremeAnswer(95, 50)).toBe(false);
    expect(isExtremeAnswer(1, 10)).toBe(true);
    expect(isExtremeAnswer(100, 90)).toBe(true);
  });

  it('refuses a table the bundle does not carry', () => {
    const result = decide(state, { type: 'oracle.draw', oracleId: 'absente' }, aCtx([]));
    expect(violationOf(result).code).toBe('unknown_oracle_table');
  });

  it('refuses the two tables reserved to the engine', () => {
    const content = aContent({
      oracles: { ...aContent().oracles, prix: { ...aContent().presageTable, id: 'pay-the-price' } },
    });
    expect(
      violationOf(decide(state, { type: 'oracle.draw', oracleId: 'presages' }, aCtx([]))).code,
    ).toBe('unknown_oracle_table');
    expect(
      violationOf(
        decide(state, { type: 'oracle.draw', oracleId: 'prix' }, aCtx([], {}, { content })),
      ).code,
    ).toBe('unknown_oracle_table');
  });

  it('draws an ordinary oracle and copies its text verbatim', () => {
    const result = decide(
      state,
      { type: 'oracle.draw', oracleId: 'complication' },
      aCtx([], { oracle: [1] }),
    );
    if (isErr(result)) throw new Error(result.error.code);
    const drawn = result.value.events[0];
    if (drawn?.type !== 'roll.oracle_resolved') throw new Error('no draw');
    expect(drawn.payload.text).toBe('une piste se perd');
    expect(drawn.payload.tags).toEqual(['enquete']);
    expect(drawn.rngStream).toBe('oracle');
  });
});

// ------------------------------------------------------- the other intents

describe('the intents that are not moves', () => {
  it('says what a player said, on the channel they said it', () => {
    const result = decide(
      aPlayableState(),
      { type: 'speech.say', channel: 'ooc', text: 'je prends une pause' },
      aCtx([]),
    );
    if (isErr(result)) throw new Error(result.error.code);
    const said = result.value.events[0];
    if (said?.type !== 'narration.player_message') throw new Error('nothing said');
    expect(said.payload.kind).toBe('ooc');
    expect(said.actorKind).toBe('player');
  });

  it('joins a player once, and says nothing the second time', () => {
    const outsider = aCharacter({ id: HERO, playerId: PLAYER });
    const state = aTableState({
      seq: 10,
      status: 'active',
      characters: [outsider],
      party: { memberPlayerIds: [], ownerPlayerId: PLAYER },
    });
    const first = decide(state, { type: 'campaign.join', characterId: HERO }, aCtx([]));
    if (isErr(first)) throw new Error(first.error.code);
    expect(typesOf(first.value.events)).toEqual(['party.member_joined']);

    const already = decide(
      aPlayableState(),
      { type: 'campaign.join', characterId: HERO },
      aCtx([]),
    );
    if (isErr(already)) throw new Error(already.error.code);
    expect(already.value.events).toEqual([]);
  });

  it('refuses to join as a character nobody has heard of', () => {
    const result = decide(
      aPlayableState(),
      { type: 'campaign.join', characterId: anId('character', 9) },
      aCtx([]),
    );
    expect(violationOf(result).code).toBe('unknown_character');
  });

  it('lets a member leave, and refuses to let a stranger leave', () => {
    const left = decide(aPlayableState(), { type: 'campaign.leave' }, aCtx([]));
    if (isErr(left)) throw new Error(left.error.code);
    expect(typesOf(left.value.events)).toEqual(['party.member_left']);

    const stranger = aPlayableState({ party: { memberPlayerIds: [], ownerPlayerId: PLAYER } });
    expect(violationOf(decide(stranger, { type: 'campaign.leave' }, aCtx([]))).code).toBe(
      'not_a_member',
    );
    const ghost = aCtx([], {}, { actorId: anId('character', 9) });
    expect(violationOf(decide(aPlayableState(), { type: 'campaign.leave' }, ghost)).code).toBe(
      'unknown_character',
    );
  });

  it('refuses a draft whose spread is not 3/2/2/1/1', () => {
    const result = decide(
      aPlayableState(),
      {
        type: 'character.create_draft',
        championSlug: 'braum',
        spread: { vif: 3, coeur: 3, fer: 3, ombre: 3, esprit: 3 },
        background: '',
      },
      aCtx([]),
    );
    expect(violationOf(result).code).toBe('attribute_spread_illegal');
  });

  it('refuses a draft on a locked champion, and allows one on an npc lock', () => {
    const locked = aPlayableState({
      championLocks: [{ championId: 'braum', lockKind: 'reserved_pc', reason: 'prise', setSeq: 1 }],
    });
    const draft = {
      type: 'character.create_draft',
      championSlug: 'braum',
      spread: { vif: 3, coeur: 2, fer: 2, ombre: 1, esprit: 1 },
      background: 'un forgeron',
    } as const;
    expect(violationOf(decide(locked, draft, aCtx([]))).code).toBe('champion_locked');

    const npc = aPlayableState({
      championLocks: [{ championId: 'braum', lockKind: 'allowed_npc', reason: 'pnj', setSeq: 1 }],
    });
    const allowed = decide(npc, draft, aCtx([]));
    if (isErr(allowed)) throw new Error(allowed.error.code);
    // No entry: the sheet does not exist yet, and `character.created` is the
    // server's to write once the forge has answered. Reported with the task.
    expect(allowed.value.events).toEqual([]);
    expect(allowed.value.brief.playerInput).toBe('un forgeron');
  });

  it('writes no entry for a play session boundary', () => {
    for (const type of ['play_session.begin', 'play_session.end'] as const) {
      const result = decide(aPlayableState(), { type }, aCtx([]));
      if (isErr(result)) throw new Error(result.error.code);
      expect(result.value.events).toEqual([]);
    }
  });
});

// ------------------------------------------------------------------- fuzzing

describe('five hundred syntactically valid intents', () => {
  /** Every shape a client may legally send, built without reading a clock. */
  function anIntent(pick: (sides: number) => number): Intent {
    const attributes = ['vif', 'coeur', 'fer', 'ombre', 'esprit'] as const;
    const attribute = attributes[pick(attributes.length) - 1] ?? 'fer';
    const ranks = ['genant', 'dangereux', 'redoutable', 'extreme', 'epique'] as const;
    const rank = ranks[pick(ranks.length) - 1] ?? 'genant';
    const likelihoods = [
      'quasi-certain',
      'probable',
      'incertain',
      'peu-probable',
      'improbable',
    ] as const;
    const likelihood = likelihoods[pick(likelihoods.length) - 1] ?? 'incertain';
    const bonus = pick(9) - 5;
    const shapes: readonly Intent[] = [
      { type: 'campaign.join', characterId: pick(2) === 1 ? HERO : anId('character', 9) },
      { type: 'campaign.leave' },
      {
        type: 'character.create_draft',
        championSlug: pick(2) === 1 ? 'braum' : 'ashe',
        spread: { vif: 3, coeur: 2, fer: 2, ombre: 1, esprit: 1 },
        background: 'x',
      },
      { type: 'move.face_danger', attribute, description: 'x', bonus },
      { type: 'move.secure_advantage', attribute, description: 'x', bonus },
      { type: 'move.gather_information', description: 'x', bonus },
      {
        type: 'move.probe_a_soul',
        target:
          pick(2) === 1 ? { kind: 'entity', entityId: FOE } : { kind: 'description', text: 'x' },
        bonus,
      },
      {
        type: 'move.strike',
        targetId: pick(2) === 1 ? FOE : 'inconnu',
        attribute: pick(2) === 1 ? 'fer' : 'vif',
      },
      { type: 'move.endure_harm', amount: pick(9) - 5 },
      { type: 'move.endure_cold' },
      { type: 'move.swear_a_vow', text: 'x', rank },
      { type: 'move.reach_a_milestone', trackId: pick(2) === 1 ? TRACK : anId('track', 9) },
      { type: 'move.fulfill_your_vow', trackId: pick(2) === 1 ? TRACK : anId('track', 9) },
      { type: 'move.forsake_your_vow', trackId: TRACK, reason: 'x' },
      { type: 'momentum.burn', rollId: anId('roll') },
      { type: 'oracle.ask', question: 'x', likelihood },
      { type: 'oracle.draw', oracleId: pick(2) === 1 ? 'complication' : 'absente' },
      { type: 'speech.say', channel: pick(2) === 1 ? 'ic' : 'ooc', text: 'x' },
      { type: 'play_session.begin' },
      { type: 'play_session.end' },
    ];
    return shapes[pick(shapes.length) - 1] ?? { type: 'campaign.leave' };
  }

  it('never throws, and always comes back with a Result', () => {
    const generator = createSeededRng('fuzz-M0-13');
    const state = aPlayableState({
      tracks: [aTrackFixture()],
      scene: aScene({
        present: [aScenePresence({ ref: { kind: 'entity', id: FOE }, name: 'Katla' })],
      }),
      entities: [
        {
          id: FOE,
          kind: 'npc',
          slug: 'katla',
          name: 'Katla',
          summary: '',
          details: {},
          championId: null,
          regionId: null,
          status: 'active',
          disposition: null,
          firstSeenSeq: 1,
          lastSeenSeq: 1,
        },
      ],
    });
    const codes = new Set<string>();
    let decided = 0;
    for (let index = 0; index < 500; index += 1) {
      const intent = anIntent((sides) => generator.roll(sides));
      const result = decide(
        state,
        intent,
        aDecisionContext({
          rng: oneStream(createSeededRng(`turn-${String(index)}`)),
          ids: counterIds('id'),
          actorId: HERO,
        }),
      );
      expect(typeof result.ok).toBe('boolean');
      if (isOk(result)) decided += 1;
      else codes.add(result.error.code);
    }
    // Both halves actually happened: a fuzz run that only ever refused, or only
    // ever succeeded, would prove nothing about the other path.
    expect(decided).toBeGreaterThan(0);
    expect(decided).toBeLessThan(500);
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('the fallback template identifier', () => {
  it('names the move and its outcome', () => {
    expect(fallbackTemplateId('face-danger', 'echec')).toBe('face-danger/echec');
  });

  it('falls back to the reserved key for a turn with no move', () => {
    expect(fallbackTemplateId(null, null)).toBe('default/franche');
  });
});
