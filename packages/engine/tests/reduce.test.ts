/**
 * The reducer, measured on the four things it promises: it covers the whole
 * catalogue, it replays to the same bytes, it never touches what it is given,
 * and a cancellation puts the state back exactly — without giving the dice
 * back.
 */

import { anEvent, anId, stableStringify } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { CampaignState, GameEvent, SceneAbsence, ScenePresence } from '../src/index.js';
import {
  GAME_EVENT_TYPES,
  REDUCER_VERSION,
  collectRevertedSeqs,
  createInitialCampaignState,
  freezeState,
  reduce,
  reduceAll,
} from '../src/index.js';
import {
  CAMPAIGN,
  CLOCK,
  ENTITY,
  HERO,
  OWNER,
  SCENE,
  TRACK,
  everyEventJournal,
} from './support/every-event.test.js';

function anInitialState(): CampaignState {
  return createInitialCampaignState({ campaignId: CAMPAIGN, ownerPlayerId: OWNER });
}

/**
 * The GAME state, with the bookkeeping removed.
 *
 * `seq` grows and the draw indexes grow whatever happens — a cancellation adds
 * an entry and consumes an index — so comparing the whole object would make
 * the restoration criterion false by construction. What has to come back is
 * what the rules read: gauges, momentum, conditions, ticks, clock segments.
 */
function gameStateHash(state: CampaignState): string {
  return stableStringify({
    characters: state.characters,
    tracks: state.tracks,
    clocks: state.clocks,
    entities: state.entities,
    scene: state.scene,
    truths: state.truths,
    party: state.party,
    championLocks: state.championLocks,
  });
}

/**
 * The burn window, derived from the journal.
 *
 * It is NOT a field of `CampaignState` — see the report — so the only honest
 * way to compare it before and after a cancellation is to derive it the way
 * the server does: the last `roll.action_resolved` of a character that carries
 * `burnWindow: true` and is still the last entry about them (03-donnees.md
 * section 3.4, "la fenetre se ferme au premier evenement suivant du meme
 * personnage").
 */
function openBurnWindowSeq(events: readonly GameEvent[]): number | null {
  let open: number | null = null;
  for (const event of events) {
    if (event.subjectCharacterId === null) continue;
    open = event.type === 'roll.action_resolved' && event.payload.burnWindow ? event.seq : null;
  }
  return open;
}

// ----------------------------------------------------------------- catalogue

describe('the reducer covers the whole catalogue', () => {
  const journal = everyEventJournal();

  it('has one fixture entry per event type, in catalogue order', () => {
    expect(journal.map((event) => event.type)).toEqual([...GAME_EVENT_TYPES]);
  });

  it('applies all seventy-one without throwing, from a state that has nothing', () => {
    const state = reduceAll(anInitialState(), journal);
    expect(state.seq).toBe(journal.length);
    expect(state.reducerVersion).toBe(REDUCER_VERSION);
  });

  it('starts a campaign with nothing in it', () => {
    const state = anInitialState();
    expect(state.seq).toBe(0);
    expect(state.status).toBe('draft');
    expect(Object.keys(state.characters)).toEqual([]);
    expect(state.scene).toBeNull();
    expect(state.rng.draws).toEqual({});
    expect(state.party.ownerPlayerId).toBe(OWNER);
  });

  it('takes the seed, the owner and the content hash from campaign.created', () => {
    const state = reduce(anInitialState(), journal[0]!);
    expect(state.rng.seed).toBe('seed-of-the-campaign');
    expect(state.contentPackHash).toBe('sha256:content');
  });
});

// ---------------------------------------------------------------- idempotence

describe('replaying the same journal gives the same state', () => {
  const journal = everyEventJournal();

  it('gives the same hash twice, from zero', () => {
    const first = reduceAll(anInitialState(), journal);
    const second = reduceAll(anInitialState(), journal);
    expect(stableStringify(first)).toBe(stableStringify(second));
  });

  it('gives the same hash from a mid-journal snapshot as from zero', () => {
    const whole = reduceAll(anInitialState(), journal);
    const half = journal.length >> 1;
    const snapshot = reduceAll(anInitialState(), journal.slice(0, half));
    const resumed = reduceAll(snapshot, journal.slice(half));
    expect(stableStringify(resumed)).toBe(stableStringify(whole));
  });

  it('draws no die: the same event applied twice changes nothing more', () => {
    const state = reduceAll(anInitialState(), journal);
    const again = reduce(state, journal[journal.length - 1]!);
    expect(stableStringify(again)).toBe(stableStringify(state));
  });
});

// ------------------------------------------------------------- no mutation

describe('the reducer never writes into what it is handed', () => {
  const journal = everyEventJournal();

  it.each(journal.map((event) => [event.type, event] as const))(
    'applies %s to a deeply frozen state',
    (_type, event) => {
      // In an ES module, always strict, a write into a frozen object THROWS.
      // Freezing the input is therefore a proof and not a convention.
      const before = freezeState(reduceAll(anInitialState(), journal));
      expect(() => reduce(before, event)).not.toThrow();
    },
  );

  it('would fail if a branch wrote in place: the guard bites', () => {
    const frozen = freezeState(anInitialState());
    expect(() => {
      (frozen as { seq: number }).seq = 99;
    }).toThrow(TypeError);
  });

  it('leaves its input byte-identical', () => {
    const before = reduceAll(anInitialState(), journal.slice(0, 20));
    const snapshot = stableStringify(before);
    reduceAll(before, journal.slice(20));
    expect(stableStringify(before)).toBe(snapshot);
  });
});

// ----------------------------------------------------------------- the scene

describe('the scene: started, then two fact updates', () => {
  const guard = anId('entity', 2);
  const crow = anId('entity', 3);
  const wolf = anId('entity', 4);

  function presence(id: string, name: string): ScenePresence {
    return { ref: { kind: 'entity', id }, name, state: 'debout', sinceSeq: 1 };
  }

  function absence(id: string, name: string): SceneAbsence {
    return { ref: { kind: 'entity', id }, name, cause: 'parti', sinceSeq: 2 };
  }

  function ids(entries: readonly { readonly ref: { readonly id: string } }[]): readonly string[] {
    return entries.map((entry) => entry.ref.id);
  }

  const started = anEvent({
    seq: 1,
    type: 'scene.started',
    payload: {
      sceneId: SCENE,
      title: 'Le col des Hurleurs',
      regionId: 'freljord',
      entityIds: [guard, ENTITY],
      presentCharacterIds: [HERO],
    },
  });

  /**
   * TWO entries per list, handed over in DESCENDING order.
   *
   * One entry per list would be sorted whatever the comparator does, and a
   * natural order would be sorted by a comparator that does nothing: the
   * criterion is only measurable when the input disagrees with the output.
   */
  const presentAsGiven: readonly ScenePresence[] = [
    presence(crow, 'Le corbeau'),
    presence(guard, 'Le garde'),
  ];
  const absentAsGiven: readonly SceneAbsence[] = [
    absence(wolf, 'Le loup'),
    absence(ENTITY, 'Katla'),
  ];

  const leaves = anEvent({
    seq: 2,
    type: 'scene.facts_updated',
    payload: {
      sceneId: SCENE,
      present: presentAsGiven,
      absent: absentAsGiven,
      source: 'gm_ai',
    },
  });

  const stillGone = anEvent({
    seq: 3,
    type: 'scene.facts_updated',
    payload: {
      sceneId: SCENE,
      present: presentAsGiven,
      absent: absentAsGiven,
      source: 'gm_ai',
    },
  });

  const state = reduceAll(anInitialState(), [started, leaves, stillGone]);

  it('lists the one who left exactly once', () => {
    expect(state.scene?.absent.filter((entry) => entry.ref.id === ENTITY)).toHaveLength(1);
  });

  it('no longer lists them as present', () => {
    expect(state.scene?.present.map((entry) => entry.ref.id)).not.toContain(ENTITY);
  });

  it('sorts both lists by ref.id', () => {
    // THE EXACT ARRAY, written out. Comparing a list with its own `.sort()`
    // sorts both sides of the equality and is blind to the comparator.
    expect(ids(presentAsGiven)).toEqual([crow, guard]);
    expect(ids(absentAsGiven)).toEqual([wolf, ENTITY]);
    expect(ids(state.scene?.present ?? [])).toEqual([guard, crow]);
    expect(ids(state.scene?.absent ?? [])).toEqual([ENTITY, wolf]);
  });

  it('empties absent when a scene starts, and rebuilds present', () => {
    const restarted = reduce(state, { ...started, seq: 4 });
    expect(restarted.scene?.absent).toEqual([]);
    // Given as [guard, ENTITY] plus HERO, read back sorted by identifier.
    expect(ids(restarted.scene?.present ?? [])).toEqual([HERO, ENTITY, guard]);
  });

  it('keeps the place when a fact update names none', () => {
    expect(state.scene?.placeName).toBe('Le col des Hurleurs');
    expect(state.scene?.placeId).toBe('freljord');
  });

  it('closes the scene on scene.ended', () => {
    const ended = reduce(
      state,
      anEvent({ seq: 4, type: 'scene.ended', payload: { sceneId: SCENE } }),
    );
    expect(ended.scene).toBeNull();
  });

  it('replaces the whole scene rather than merging a delta', () => {
    const elsewhere = reduce(
      state,
      anEvent({
        seq: 4,
        type: 'scene.facts_updated',
        payload: {
          sceneId: SCENE,
          placeId: 'camp',
          placeName: 'Le camp',
          timeOfDay: 'nuit',
          present: [],
          absent: [],
          source: 'engine',
        },
      }),
    );
    expect(elsewhere.scene).toEqual({
      sceneId: SCENE,
      placeId: 'camp',
      placeName: 'Le camp',
      timeOfDay: 'nuit',
      present: [],
      absent: [],
      updatedSeq: 4,
    });
  });
});

// --------------------------------------------------------------- cancellation

describe('a reverted turn comes back exactly, and the dice do not', () => {
  const setup: readonly GameEvent[] = [
    anEvent({
      seq: 1,
      type: 'campaign.created',
      payload: {
        name: 'demo',
        slug: 'demo',
        pitch: '',
        ownerPlayerId: OWNER,
        contentPackVersion: '1.0.0',
        contentPackHash: 'sha256:x',
        rulesVersion: 1,
        rngSeed: 'seed',
      },
    }),
    anEvent({
      seq: 2,
      type: 'character.created',
      payload: {
        characterId: HERO,
        playerId: OWNER,
        championId: 'ashe',
        displayName: 'Ashe',
        sheetSource: 'handwritten',
        sheetRef: 'content:champions/ashe@1.0.0',
        sheetSnapshot: {},
        attributes: { vif: 2, coeur: 3, fer: 2, ombre: 1, esprit: 1 },
        gauges: { vigueur: 5, ame: 5, vivres: 5 },
        momentum: 2,
      },
    }),
    anEvent({
      seq: 3,
      type: 'track.created',
      payload: {
        trackId: TRACK,
        kind: 'vow',
        rank: 'dangereux',
        title: 'Ramener la corne',
        description: '',
        visibility: 'public',
        initialTicks: 0,
      },
    }),
    anEvent({
      seq: 4,
      type: 'clock.created',
      payload: {
        clockId: CLOCK,
        title: 'La tempete',
        description: '',
        segments: 6,
        visibility: 'public',
        consequence: 'le col se ferme',
      },
    }),
  ];

  /** One whole turn: a roll, a gauge, a condition, ticks, a clock segment. */
  const turn: readonly GameEvent[] = [
    anEvent({
      seq: 5,
      type: 'move.declared',
      payload: {
        moveId: 'strike',
        characterId: HERO,
        narrativeInput: 'je frappe',
        chosenAttribute: 'fer',
      },
    }),
    anEvent({
      seq: 6,
      rngStream: 'action',
      rngDrawIndex: 0,
      subjectCharacterId: HERO,
      type: 'roll.action_resolved',
      payload: {
        rollId: anId('roll'),
        characterId: HERO,
        moveId: 'strike',
        attribute: 'fer',
        attributeValue: 2,
        actionDie: 5,
        adds: [],
        rawTotal: 7,
        total: 7,
        cappedAtTen: false,
        challengeDice: [4, 9],
        outcome: 'partielle',
        isPresage: false,
        momentumBefore: 2,
        momentumNegated: false,
        // TRUE on purpose: with `false` both sides of the restoration
        // assertion below are `null`, and it measures nothing.
        burnWindow: true,
        rngStream: 'action',
        rngDrawIndex: 0,
      },
    }),
    anEvent({
      seq: 7,
      type: 'character.gauge_changed',
      payload: {
        characterId: HERO,
        gauge: 'vigueur',
        delta: -2,
        from: 5,
        to: 3,
        clamped: false,
        cause: 'move:strike/partielle',
      },
    }),
    anEvent({
      seq: 8,
      type: 'character.momentum_changed',
      payload: { characterId: HERO, delta: 1, from: 2, to: 3, clamped: false, cause: 'x' },
    }),
    anEvent({
      seq: 9,
      type: 'character.condition_added',
      payload: { characterId: HERO, conditionId: 'trouble', label: 'Trouble', source: 'engine' },
    }),
    anEvent({
      seq: 10,
      type: 'track.ticked',
      payload: { trackId: TRACK, ticks: 8, from: 0, to: 8, cause: 'x', milestones: 1 },
    }),
    anEvent({
      seq: 11,
      type: 'clock.advanced',
      payload: { clockId: CLOCK, delta: 2, from: 0, to: 2, cause: 'x' },
    }),
  ];

  const revert = anEvent({
    seq: 12,
    type: 'system.reverted',
    payload: {
      targetSeqs: turn.map((event) => event.seq),
      reason: 'gm_refusal:cible_absente',
      byPlayerId: null,
    },
  });

  const beforeTurn = reduceAll(anInitialState(), setup);
  const afterTurn = reduceAll(anInitialState(), [...setup, ...turn]);
  const afterRevert = reduceAll(anInitialState(), [...setup, ...turn, revert]);

  it('moved something in the first place: the test is not measuring nothing', () => {
    expect(gameStateHash(afterTurn)).not.toBe(gameStateHash(beforeTurn));
  });

  it('restores gauges, momentum, conditions, ticks and clock segments', () => {
    expect(gameStateHash(afterRevert)).toBe(gameStateHash(beforeTurn));
  });

  it('restores the burn window, derived from the journal', () => {
    const journal = [...setup, ...turn, revert];
    const reverted = collectRevertedSeqs(journal);

    // The turn DID open a window: without this line the assertion below
    // compares null with null and measures nothing. Same self-check as
    // 'moved something in the first place' carries for the state hash.
    expect(openBurnWindowSeq([...setup, ...turn])).not.toBeNull();

    // What the cancellation leaves readable is the journal MINUS the
    // cancelled sequences (5 to 11), not minus the cancellation line.
    expect(openBurnWindowSeq(journal.filter((event) => !reverted.has(event.seq)))).toBe(
      openBurnWindowSeq(setup),
    );
  });

  it('does NOT give the draw index back', () => {
    expect(beforeTurn.rng.draws.action).toBeUndefined();
    expect(afterRevert.rng.draws.action).toBe(1);
  });

  it('grows the journal by one line rather than erasing seven', () => {
    expect(afterRevert.seq).toBe(12);
  });

  it('collects the cancelled sequences from the journal itself', () => {
    expect([...collectRevertedSeqs([...setup, ...turn, revert])].sort((a, b) => a - b)).toEqual([
      5, 6, 7, 8, 9, 10, 11,
    ]);
  });
});

// ------------------------------------------------------------ the odd branches

describe('the branches that are easy to get wrong', () => {
  const base = reduceAll(anInitialState(), everyEventJournal());

  it('patches settings without writing undefined over a real one', () => {
    expect(base.settings.gmVerbosity).toBe('ample');
    expect(base.settings.oracleBias).toBe('neutre');
  });

  it('answers a truth once, however often it is answered', () => {
    const twice = reduce(
      base,
      anEvent({
        seq: 100,
        type: 'campaign.truth_set',
        payload: { truthId: 'le-froid', optionId: 'le-froid-epargne' },
      }),
    );
    expect(twice.truths).toHaveLength(1);
    expect(twice.truths[0]?.optionId).toBe('le-froid-epargne');
  });

  /**
   * The sort in `withTruth`, which nothing guarded before (M0-17).
   *
   * TWO truths, and they are answered in DESCENDING order: with one truth, or
   * with two answered in ascending order, this test would pass with the sort
   * removed and prove nothing. `toEqual` on the whole array rather than a
   * length or a member — the claim is about the ORDER, so the order is what is
   * written out.
   */
  it('keeps truths in truthId order, whatever order they were answered in', () => {
    const answered = reduceAll(anInitialState(), [
      anEvent({
        seq: 1,
        type: 'campaign.truth_set',
        payload: { truthId: 'les-esprits', optionId: 'les-esprits-veillent' },
      }),
      anEvent({
        seq: 2,
        type: 'campaign.truth_set',
        payload: { truthId: 'le-froid', optionId: 'le-froid-tue' },
      }),
    ]);

    expect(answered.truths).toEqual([
      { truthId: 'le-froid', optionId: 'le-froid-tue', customText: null },
      { truthId: 'les-esprits', optionId: 'les-esprits-veillent', customText: null },
    ]);
  });

  it('saturates a gauge rather than refusing the entry', () => {
    const out = reduce(
      base,
      anEvent({
        seq: 101,
        type: 'character.gauge_changed',
        payload: {
          characterId: HERO,
          gauge: 'ame',
          delta: -99,
          from: 5,
          to: -94,
          clamped: true,
          cause: 'x',
        },
      }),
    );
    expect(out.characters[HERO]?.gauges.ame).toBe(0);
  });

  it('ignores an entry about somebody who is not at the table', () => {
    const ghost = anId('character', 9);
    const out = reduce(
      base,
      anEvent({
        seq: 102,
        type: 'character.renamed',
        payload: { characterId: ghost, from: 'a', to: 'b' },
      }),
    );
    expect(stableStringify(out.characters)).toBe(stableStringify(base.characters));
  });

  it('moves a display name through system.correction, and nothing else', () => {
    const renamed = reduce(
      base,
      anEvent({
        seq: 103,
        type: 'system.correction',
        payload: {
          targetSeq: 11,
          field: `characters.${HERO}.displayName`,
          from: 'Ashe',
          to: 'Ashe la Flechiere',
          reason: 'saisie',
        },
      }),
    );
    expect(renamed.characters[HERO]?.displayName).toBe('Ashe la Flechiere');

    const untouched = reduce(
      base,
      anEvent({
        seq: 104,
        type: 'system.correction',
        payload: {
          targetSeq: 11,
          field: `characters.${HERO}.momentum`,
          from: 2,
          to: 9,
          reason: 'triche',
        },
      }),
    );
    expect(untouched.characters[HERO]?.momentum).toBe(base.characters[HERO]?.momentum);

    const notAPath = reduce(
      base,
      anEvent({
        seq: 105,
        type: 'system.correction',
        payload: { targetSeq: 11, field: 'seq', from: 1, to: 2, reason: 'triche' },
      }),
    );
    expect(notAPath.seq).toBe(105);
  });

  it('splits an entity patch between its named fields and its details', () => {
    expect(base.entities[ENTITY]?.summary).toBe('Une eclaireuse blessee.');
    expect(base.entities[ENTITY]?.details).toEqual({ arme: 'hache brisee' });
  });

  it('unlocks an asset ability without spending experience twice', () => {
    const withAsset = reduceAll(base, [
      anEvent({
        seq: 110,
        type: 'character.asset_added',
        payload: { characterId: HERO, assetId: 'arc-de-givre', options: { teinte: 'givre' } },
      }),
      anEvent({
        seq: 111,
        type: 'character.asset_upgraded',
        payload: { characterId: HERO, assetId: 'arc-de-givre', abilityIndex: 2, xpCost: 3 },
      }),
      anEvent({
        seq: 112,
        type: 'character.asset_upgraded',
        payload: { characterId: HERO, assetId: 'arc-de-givre', abilityIndex: 1, xpCost: 3 },
      }),
      anEvent({
        seq: 113,
        type: 'character.asset_added',
        payload: { characterId: HERO, assetId: 'arc-de-givre' },
      }),
    ]);
    expect(withAsset.characters[HERO]?.assets).toHaveLength(1);
    expect(withAsset.characters[HERO]?.assets[0]?.unlockedAbilities).toEqual([1, 2]);
    expect(withAsset.characters[HERO]?.assets[0]?.options).toEqual({ teinte: 'givre' });
    expect(withAsset.characters[HERO]?.xpSpent).toBe(base.characters[HERO]?.xpSpent);
  });

  it('adds a condition once and removes it by identifier', () => {
    const twice = reduceAll(base, [
      anEvent({
        seq: 120,
        type: 'character.condition_added',
        payload: { characterId: HERO, conditionId: 'gele', label: 'Gele', source: 'engine' },
      }),
      anEvent({
        seq: 121,
        type: 'character.condition_added',
        payload: { characterId: HERO, conditionId: 'gele', label: 'Gele', source: 'engine' },
      }),
    ]);
    expect(twice.characters[HERO]?.conditions).toHaveLength(1);
  });

  it('keeps a champion lock until it is unlocked', () => {
    const locked = reduce(
      base,
      anEvent({
        seq: 130,
        type: 'party.champion_locked',
        payload: { championId: 'braum', lockKind: 'banned', reason: 'reserve' },
      }),
    );
    expect(locked.championLocks['braum']?.lockKind).toBe('banned');
    const freed = reduce(
      locked,
      anEvent({
        seq: 131,
        type: 'party.champion_unlocked',
        payload: { championId: 'braum', reason: 'liberee' },
      }),
    );
    expect(freed.championLocks['braum']).toBeUndefined();
    expect(freed.championLocks['sejuani']).toBeUndefined();
  });

  it('adds a member once and takes them out again', () => {
    const joined = reduceAll(base, [
      anEvent({
        seq: 140,
        type: 'party.member_joined',
        payload: { playerId: OWNER, role: 'player', displayName: 'Kevin' },
      }),
    ]);
    expect(joined.party.memberPlayerIds).toEqual([OWNER]);
  });

  it('bounds a clock at its own number of segments', () => {
    const over = reduce(
      base,
      anEvent({
        seq: 150,
        type: 'clock.advanced',
        payload: { clockId: CLOCK, delta: 9, from: 0, to: 99, cause: 'x' },
      }),
    );
    expect(over.clocks[CLOCK]?.filled).toBe(base.clocks[CLOCK]?.segments);
  });

  it('bounds a track at ten boxes', () => {
    const over = reduce(
      base,
      anEvent({
        seq: 151,
        type: 'track.ticked',
        payload: { trackId: TRACK, ticks: 99, from: 0, to: 99, cause: 'x', milestones: 0 },
      }),
    );
    expect(over.tracks[TRACK]?.ticks).toBe(40);
  });

  it('ignores a correction whose path names no collection it knows', () => {
    const out = reduce(
      base,
      anEvent({
        seq: 160,
        type: 'system.correction',
        payload: { targetSeq: 1, field: 'clocks.x.title', from: 'a', to: 'b', reason: '' },
      }),
    );
    expect(stableStringify(out.clocks)).toBe(stableStringify(base.clocks));
  });

  it('moves the owner only when a role becomes owner', () => {
    const demoted = reduce(
      base,
      anEvent({
        seq: 161,
        type: 'party.member_role_changed',
        payload: { playerId: anId('player', 3), from: 'owner', to: 'spectator' },
      }),
    );
    expect(demoted.party.ownerPlayerId).toBe(base.party.ownerPlayerId);
  });

  it('leaves another asset alone when one is upgraded', () => {
    const two = reduceAll(base, [
      anEvent({
        seq: 170,
        type: 'character.asset_added',
        payload: { characterId: HERO, assetId: 'arc-de-givre' },
      }),
      anEvent({
        seq: 171,
        type: 'character.asset_added',
        payload: { characterId: HERO, assetId: 'bouclier-de-porte' },
      }),
      anEvent({
        seq: 172,
        type: 'character.asset_upgraded',
        payload: { characterId: HERO, assetId: 'arc-de-givre', abilityIndex: 1, xpCost: 3 },
      }),
    ]);
    const assets = two.characters[HERO]?.assets ?? [];
    expect(assets.map((asset) => asset.unlockedAbilities)).toEqual([[1], []]);
  });

  it('never lets seq go backwards', () => {
    const older = reduce(base, anEvent({ seq: 2 }));
    expect(older.seq).toBe(base.seq);
  });
});
