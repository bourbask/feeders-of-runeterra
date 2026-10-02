/**
 * The six golden corpora of the rule CONSTANTS the first four never read.
 *
 * WHY THEY EXIST. ARCHITECTURE.md section 7, point 8 promises that changing one
 * rule constant makes three suites red in under thirty seconds. Replayed
 * constant by constant in the counter-review of M0-30 (issue #88), the sentence
 * was FALSE for ten of them: `PRICE_DIE`, `DEFAULT_HARM`, `ATTRIBUTE_MIN`,
 * `ATTRIBUTE_MAX`, `ATTRIBUTE_SPREAD`, `CLOCK_SEGMENT_COUNTS`,
 * `CLOCK_ADVANCE_MIN`, `CLOCK_ADVANCE_MAX`, `SCENE_PRESENCE_MAX` and
 * `LIKELIHOOD_THRESHOLDS` all walked through the golden gate. The four corpora
 * of `corpus.test.ts` read the dice, the progression and the gauges — the price,
 * the harm, the clocks, the oracle bands, the scene and the attribute spread
 * were read by nothing.
 *
 * They follow `corpus.test.ts` to the letter: one line per case, columns
 * aligned, a `format` that says how to read a row, and a DECISION behind every
 * case rather than a cartesian product. Read its header first — it says why
 * each row is a string and why a generated wide corpus would be bigger and
 * prove less.
 *
 * THE SWEEP IS WRITTEN IN FULL, NEVER DERIVED FROM THE CONSTANT UNDER TEST.
 * Each family below opens with a literal window — `PRICE_DICE`,
 * `HARM_AMOUNTS`, `CLOCK_SEGMENT_CANDIDATES`, `CLOCK_ASKS`, `ORACLE_FACES`,
 * `SCENE_SIZES`, `ATTRIBUTE_CANDIDATES` — and not one of them is computed from
 * the constant it is meant to pin. A sweep spelled `ATTRIBUTE_MIN - 1` to
 * `ATTRIBUTE_MAX + 1` SLIDES WITH THE CONSTANT and pins nothing: fifth failure
 * mode of `docs/RECETTE.md`, a number compared with itself. No loop in this
 * file is bounded by a constant it guards.
 *
 * WHERE THE RED COMES FROM, which is not the same question as "is it red".
 * `CLOCK_SEGMENT_COUNTS` was already red before this file existed — but from
 * the Zod mirror of `@for/contracts` refusing to COMPILE, not from a corpus
 * (issue #88, precision 2). A real net, and counting it as a golden gate would
 * have been a number agreeing with itself. The two `legal` rows of the clock
 * family are what makes that constant red HERE, in the golden gate, on its own.
 *
 * WHAT A ROW READS, so nobody has to find out by breaking it:
 *
 *   price      `rollPrice` — its guard on the twelve-entry table, and the d12 it rolls
 *   harm       `harmAmount` and the upfront effect of `endure-harm`, through `decide`
 *   clock      `decide` applying a `clock_advance` effect, and the legal segment counts
 *   oracle     `decide` on `oracle.ask`, which reads the five likelihood bands
 *   scene      `checkInvariants` on the two presence lists, and the brief cap
 *   attribute  `rollChallenge` and `decide` on the attribute bounds, plus the spread
 */

import {
  aCharacter,
  aClock,
  aScene,
  aSceneAbsence,
  aScenePresence,
  aTableState,
  anId,
  counterIds,
  expectGolden,
  scriptedRng,
} from '@for/testkit';
import { describe, expect, it } from 'vitest';

import { rollChallenge } from '../../src/dice/challenge.js';
import { rollPrice } from '../../src/dice/price.js';
import type {
  AttributeSpread,
  CampaignState,
  ClockState,
  DecisionContext,
  EngineEffect,
  GameEvent,
  Intent,
  Likelihood,
  MoveDefinition,
  OracleTable,
  PriceEntryDefinition,
  SceneState,
} from '../../src/index.js';
import {
  ATTRIBUTE_SPREAD,
  BRIEF_PERCEIVABLE_FACTS_MAX,
  CLOCK_SEGMENT_COUNTS,
  LIKELIHOODS,
  SCENE_PRESENCE_MAX,
  briefAudience,
  checkInvariants,
  decide,
  isOk,
  perceivableFactsFor,
  reduceAll,
} from '../../src/index.js';
import { harmAmount } from '../../src/moves/endure-harm.js';
import {
  FIXTURE_MOVES,
  aContent,
  aDecisionContext,
  byStream,
} from '../support/engine-content.test.js';

const GOLDEN = { dir: new URL('.', import.meta.url) };

const HERO = anId('character');
const PLAYER = anId('player');

/** Beats neither challenge die, and the two dice DIFFER, so no presage rides. */
const MISS: readonly number[] = [1, 9, 8];

// ------------------------------------------------------------------ printing

/** Signed, fixed width: `+02`, `-06`. Alignment is what makes a diff readable. */
function signed(value: number, width = 2): string {
  return `${value < 0 ? '-' : '+'}${String(Math.abs(value)).padStart(width, '0')}`;
}

function padded(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function yesNo(value: boolean): string {
  return value ? 'y' : 'n';
}

/**
 * The name of whatever `run` threw, or the value it returned.
 *
 * A corpus that let the exception escape would still be red when a bound moves
 * — but it would be red with a stack trace instead of a DIFF, and the diff is
 * the only thing that says which bound moved.
 */
function orRefusal(run: () => string): string {
  try {
    return run();
  } catch (error) {
    return `refus=${error instanceof Error ? error.name : 'inconnu'}`;
  }
}

// ------------------------------------------------------------------ the turn

/** A table with one actor, momentum at zero so no burn window ever opens. */
function aPlayableState(
  overrides: Parameters<typeof aTableState>[0] = {},
  attributes: AttributeSpread | null = null,
): CampaignState {
  const hero = aCharacter({ id: HERO, playerId: PLAYER, momentum: 0 });
  return aTableState({
    seq: 10,
    status: 'active',
    characters: [attributes === null ? hero : aCharacter({ ...hero, attributes })],
    ...overrides,
  });
}

function aCtx(
  action: readonly number[],
  overrides: Partial<DecisionContext> = {},
): DecisionContext {
  return aDecisionContext({
    rng: byStream({ action: scriptedRng([...action]) }, scriptedRng([])),
    ids: counterIds('id'),
    actorId: HERO,
    ...overrides,
  });
}

/**
 * The first entry of that type, NARROWED.
 *
 * `Array.find` with a plain comparison returns the whole union, and every
 * reader then has to re-test the type it just asked for — which lint reports
 * as a comparison that is always false, and which is also a lie about what the
 * code is doing. The predicate is written once, here.
 */
function firstOf<TType extends GameEvent['type']>(
  events: readonly GameEvent[],
  type: TType,
): Extract<GameEvent, { readonly type: TType }> | undefined {
  return events.find(
    (event): event is Extract<GameEvent, { readonly type: TType }> => event.type === type,
  );
}

/** The journal a decision wrote, or an empty one when it refused. */
function journalOf(
  state: CampaignState,
  intent: Intent,
  ctx: DecisionContext,
): readonly GameEvent[] {
  const decision = decide(state, intent, ctx);
  return isOk(decision) ? decision.value.events : [];
}

/** The refusal code a decision gave, or `ok`. */
function verdictOf(state: CampaignState, intent: Intent, ctx: DecisionContext): string {
  const decision = decide(state, intent, ctx);
  return isOk(decision) ? 'ok' : decision.error.code;
}

// ----------------------------------------------------------------- the price

const PRICE_FORMAT =
  'table  id=<table id> d<die> -> ok | refus=<exception> | ' +
  'roll   face=<d12 face> -> entry=<id> idx=<effect index> arb=<second draw> eff=<op> | ' +
  'turn   echec -> <event types of the turn>';

/**
 * THE DICE THE GUARD IS SWEPT WITH, WRITTEN IN FULL.
 *
 * `PRICE_DIE` is twelve (ADR 0006). The list below holds the dice the content
 * schema allows plus the two neighbours of twelve, so the guard is broken in
 * BOTH directions: moving the constant to eleven must turn `d011` from a
 * refusal into an acceptance AND `d012` from an acceptance into a refusal.
 * A sweep derived from `PRICE_DIE` would have moved with it and shown nothing.
 */
const PRICE_DICE: readonly number[] = [4, 6, 8, 10, 11, 12, 13, 20, 100];

/** Tables the guard must tell apart. Only `pay-the-price` is the engine's own. */
const PRICE_TABLE_IDS: readonly string[] = ['pay-the-price', 'presages', 'complication'];

/** The twelve faces of the d12, spelled out rather than counted from the die. */
const PRICE_FACES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** A price-shaped table of `die` single-face entries, each with one effect. */
function aPriceTableOf(id: string, die: number): OracleTable<PriceEntryDefinition> {
  return {
    id,
    die,
    entries: Array.from({ length: die }, (_unused, index) => ({
      id: `e${String(index + 1)}`,
      min: index + 1,
      max: index + 1,
      text: 'une entree',
      severity: 'mineure',
      suggestedEffects: [{ op: 'momentum', delta: -1 }] as readonly EngineEffect[],
    })),
  };
}

function priceRows(): string[] {
  const rows: string[] = [];
  const content = aContent();

  for (const id of PRICE_TABLE_IDS) {
    for (const die of PRICE_DICE) {
      rows.push(
        `table  id=${id.padEnd(13)} d${padded(die, 3)} -> ` +
          orRefusal(() => {
            rollPrice<EngineEffect, PriceEntryDefinition>(aPriceTableOf(id, die), scriptedRng([1]));
            return 'ok';
          }),
      );
    }
  }

  // The real twelve-entry fixture, face by face. Face 1 carries no effect at
  // all (`effectIndex` is -1, not zero), face 3 carries two and spends a SECOND
  // draw arbitrating them, face 12 carries a nested `pay_price`.
  for (const face of PRICE_FACES) {
    rows.push(
      `roll   face=${padded(face)} -> ` +
        orRefusal(() => {
          const roll = rollPrice<EngineEffect, PriceEntryDefinition>(
            content.priceTable,
            scriptedRng([face, 1]),
          );
          return (
            `entry=${roll.entry.id.padEnd(4)} idx=${signed(roll.effectIndex)} ` +
            `arb=${yesNo(roll.arbitrated)} eff=${roll.effect === null ? 'aucun' : roll.effect.op}`
          );
        }),
    );
  }

  // And the production route: a miss on `face-danger` whose `echec` effect is
  // `pay_price`. The guard inside `decide` is a silent `return false`, so what
  // this row reads is the price event BEING THERE.
  const events = journalOf(
    aPlayableState(),
    { type: 'move.face_danger', attribute: 'fer', description: 'je saute' },
    aCtx(MISS, {
      rng: byStream({ action: scriptedRng([...MISS]), price: scriptedRng([2]) }, scriptedRng([])),
    }),
  );
  rows.push(`turn   echec -> ${events.map((event) => event.type).join(' ')}`);

  return rows;
}

// ------------------------------------------------------------------ the harm

const HARM_FORMAT =
  'amount in=<what the intent carried> -> harm=<points a gauge loses> | ' +
  'turn   in=<same> -> vigueur=<from>-><to> d=<delta> clamped=<y/n> | <no harm>';

/**
 * THE AMOUNTS, WRITTEN IN FULL.
 *
 * `DEFAULT_HARM` is one point. The four entries that do NOT name a number —
 * absent, `NaN`, and the two infinities — are the ones the default answers for,
 * and they are the ones that move when the constant moves. The rest pin the
 * clamp around them: no negative harm, no fraction.
 */
const HARM_AMOUNTS: readonly (number | undefined)[] = [
  undefined,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -3,
  -1,
  -0.5,
  0,
  0.4,
  1,
  1.5,
  2,
  7,
];

function amountLabel(value: number | undefined): string {
  if (value === undefined) return 'absent';
  if (Number.isNaN(value)) return 'nan   ';
  if (value === Number.POSITIVE_INFINITY) return '+inf  ';
  if (value === Number.NEGATIVE_INFINITY) return '-inf  ';
  return `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(1).padStart(5, '0')}`;
}

function harmRows(): string[] {
  const rows: string[] = [];

  for (const amount of HARM_AMOUNTS) {
    rows.push(`amount in=${amountLabel(amount)} -> harm=${signed(harmAmount(amount))}`);
  }

  // The whole route, not just the helper: `endure-harm` is the one move whose
  // FIRST effect is not an outcome, so the harm lands before the dice are even
  // compared. A row here is the gauge entry that landed.
  for (const amount of HARM_AMOUNTS) {
    const events = journalOf(
      aPlayableState(),
      { type: 'move.endure_harm', ...(amount === undefined ? {} : { amount }) },
      aCtx(MISS),
    );
    const gauge = firstOf(events, 'character.gauge_changed');
    rows.push(
      `turn   in=${amountLabel(amount)} -> ` +
        (gauge?.payload.gauge !== 'vigueur'
          ? 'aucun degat'
          : `vigueur=${signed(gauge.payload.from)}->${signed(gauge.payload.to)} ` +
            `d=${signed(gauge.payload.delta)} clamped=${yesNo(gauge.payload.clamped)}`),
    );
  }

  return rows;
}

// ---------------------------------------------------------------- the clocks

const CLOCK_FORMAT =
  'legal  segments=<candidate> -> <y when CLOCK_SEGMENT_COUNTS holds it> | ' +
  'adv    ask=<segments the content asks for> -> delta=<applied> <from>-><to> <status> | rien | ' +
  'fill   segments=<count> step=<n> -> <from>-><to> <status>';

/**
 * THE SEGMENT COUNTS THE MEMBERSHIP IS SWEPT WITH, WRITTEN IN FULL.
 *
 * `CLOCK_SEGMENT_COUNTS` is 4, 6, 8, 10 (ARCHITECTURE.md section 4.4). The
 * candidates below are every integer from two to twelve plus sixteen, so the
 * list is broken in BOTH directions: dropping ten turns its row from `y` to
 * `n`, and adding twelve turns ITS row from `n` to `y`. Derived from the
 * constant, this family would have been twelve lines all saying `y`.
 */
const CLOCK_SEGMENT_CANDIDATES: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16];

/**
 * THE ADVANCES, WRITTEN IN FULL.
 *
 * `CLOCK_ADVANCE_MIN` is one segment and `CLOCK_ADVANCE_MAX` three. The window
 * below reaches four below the floor and eight above the ceiling, and carries
 * fractions because the clamp truncates before it bounds.
 */
const CLOCK_ASKS: readonly number[] = [-7, -3, -1, -0.5, 0, 0.5, 1, 1.4, 2, 3, 3.9, 4, 7, 11];

/** Segment counts the fill walk runs on. Literal, so the walk is readable. */
const CLOCK_FILL_SEGMENTS: readonly number[] = [4, 6, 8, 10, 12];

/** Steps the fill walk takes before giving up. A clock that never fills says so. */
const CLOCK_FILL_STEPS = 6;

/** `secure-advantage`, rewritten so its miss advances a clock by `segments`. */
function advanceMove(segments: number): MoveDefinition {
  const base = FIXTURE_MOVES['secure-advantage'];
  return {
    ...base,
    outcomes: { ...base.outcomes, echec: { effects: [{ op: 'clock_advance', segments }] } },
  };
}

/** One missed `secure-advantage` against this clock, with that content. */
function advanceTurn(ask: number, clock: ClockState): readonly GameEvent[] {
  const content = aContent({
    moves: { ...FIXTURE_MOVES, 'secure-advantage': advanceMove(ask) },
  });
  return journalOf(
    aPlayableState({ clocks: [clock] }),
    { type: 'move.secure_advantage', attribute: 'vif', description: 'je gagne du terrain' },
    aCtx(MISS, { content }),
  );
}

function advanceRow(events: readonly GameEvent[]): string {
  const advanced = firstOf(events, 'clock.advanced');
  if (advanced === undefined) return 'rien';
  const filled = events.some((event) => event.type === 'clock.filled');
  return (
    `delta=${signed(advanced.payload.delta)} ${padded(advanced.payload.from)}->` +
    `${padded(advanced.payload.to)} ${filled ? 'plein' : 'court'}`
  );
}

function clockRows(): string[] {
  const rows: string[] = [];
  const legal: readonly number[] = CLOCK_SEGMENT_COUNTS;

  for (const candidate of CLOCK_SEGMENT_CANDIDATES) {
    rows.push(`legal  segments=${padded(candidate)} -> ${yesNo(legal.includes(candidate))}`);
  }

  for (const ask of CLOCK_ASKS) {
    rows.push(
      `adv    ask=${ask < 0 ? '-' : '+'}${Math.abs(ask).toFixed(1).padStart(4, '0')} -> ` +
        advanceRow(advanceTurn(ask, aClock({ segments: 6, filled: 0 }))),
    );
  }

  // The same clock advanced over and over until it saturates. What this family
  // carries that the one above does not: the NUMBER OF TURNS a clock survives,
  // which is the ceiling multiplied out.
  for (const segments of CLOCK_FILL_SEGMENTS) {
    let state = aPlayableState({
      clocks: [aClock({ segments: segments as ClockState['segments'], filled: 0 })],
    });
    for (let step = 1; step <= CLOCK_FILL_STEPS; step += 1) {
      const clock = Object.values(state.clocks)[0];
      if (clock === undefined) break;
      const content = aContent({
        moves: { ...FIXTURE_MOVES, 'secure-advantage': advanceMove(3) },
      });
      const events = journalOf(
        state,
        { type: 'move.secure_advantage', attribute: 'vif', description: 'je gagne du terrain' },
        aCtx(MISS, { content }),
      );
      rows.push(
        `fill   segments=${padded(segments)} step=${padded(step)} -> ${advanceRow(events)}`,
      );
      state = reduceAll(state, events);
    }
  }

  return rows;
}

// --------------------------------------------------------------- the oracles

const ORACLE_FORMAT =
  'ask    like=<likelihood> d100=<face> -> seuil=<threshold> rep=<oui/non> extr=<extreme>';

/**
 * THE FACES OF THE d100, WRITTEN IN FULL.
 *
 * `LIKELIHOOD_THRESHOLDS` is 90 / 75 / 50 / 25 / 10 (ARCHITECTURE.md section
 * 4.2). The faces below sit ON each of those five numbers and one step either
 * side of them, plus the two ends of the die and the four faces the "extreme"
 * rule turns on. Written out, so moving a threshold by one moves the row that
 * sat on it; swept from the thresholds, every row would have stayed put.
 */
const ORACLE_FACES: readonly number[] = [
  1, 2, 3, 5, 7, 8, 9, 10, 11, 24, 25, 26, 49, 50, 51, 74, 75, 76, 89, 90, 91, 93, 96, 98, 99, 100,
];

function oracleRows(): string[] {
  const rows: string[] = [];

  for (const likelihood of LIKELIHOODS) {
    for (const face of ORACLE_FACES) {
      const events = journalOf(
        aPlayableState(),
        { type: 'oracle.ask', question: 'le col est-il ouvert', likelihood },
        aCtx([], {
          rng: byStream({ oracle: scriptedRng([face]) }, scriptedRng([])),
        }),
      );
      const resolved = firstOf(events, 'roll.yes_no_resolved');
      rows.push(
        `ask    like=${likelihood.padEnd(13)} d100=${padded(face, 3)} -> ` +
          (resolved === undefined
            ? 'rien'
            : `seuil=${padded(resolved.payload.threshold, 3)} rep=${resolved.payload.answer.padEnd(3)} ` +
              `extr=${yesNo(resolved.payload.isExtreme)}`),
      );
    }
  }

  return rows;
}

// ----------------------------------------------------------------- the scene

const SCENE_FORMAT =
  'inv-p  present=<n> -> <violation codes, space separated> | rien | ' +
  'inv-a  absent=<n> -> idem | ' +
  'inv-pa present=<n> absent=<n> -> idem, the two lists loaded at once | ' +
  'sort   ordre=<ref id order> -> <violation codes> | rien | ' +
  'brief  present=<n> absent=<n> -> faits=<n> sous-plafond=<fits BRIEF_PERCEIVABLE_FACTS_MAX> | ' +
  'cap    <name> -> <value>';

/**
 * THE LIST SIZES, WRITTEN IN FULL.
 *
 * `SCENE_PRESENCE_MAX` is eight (02-mj-ia.md section 4.7.3, rule S7). The sweep
 * runs from an empty list to eleven entries, four past the cap, so moving the
 * cap to seven flips the row at eight and moving it to nine flips the row at
 * nine. A sweep spelled `0` to `SCENE_PRESENCE_MAX + 2` would have slid with it
 * and every row would have kept its verdict.
 */
const SCENE_SIZES: readonly number[] = [0, 1, 2, 6, 7, 8, 9, 10, 11];

function aSceneOf(present: number, absent: number): SceneState {
  return aScene({
    present: Array.from({ length: present }, (_unused, index) =>
      aScenePresence({ ref: { kind: 'character', id: anId('character', index + 1) } }),
    ),
    absent: Array.from({ length: absent }, (_unused, index) =>
      aSceneAbsence({ ref: { kind: 'entity', id: anId('entity', index + 1) } }),
    ),
  });
}

/**
 * The violation codes a state carries, each with the list it names.
 *
 * The LIST matters: the cap is checked per list, never on the sum of the two,
 * and two bare `scene_capacity_exceeded` side by side would not say which.
 */
function codesOf(state: CampaignState): string {
  const violations = checkInvariants(state);
  if (violations.length === 0) return 'rien';
  return violations
    .map((violation) => {
      const list = violation.details['list'];
      return list === undefined ? violation.code : `${violation.code}:${String(list)}`;
    })
    .join(' ');
}

function sceneRows(): string[] {
  const rows: string[] = [];

  for (const present of SCENE_SIZES) {
    rows.push(
      `inv-p  present=${padded(present)} -> ` +
        codesOf(aPlayableState({ scene: aSceneOf(present, 0) })),
    );
  }
  for (const absent of SCENE_SIZES) {
    rows.push(
      `inv-a  absent=${padded(absent)} -> ` +
        codesOf(aPlayableState({ scene: aSceneOf(0, absent) })),
    );
  }
  // Both lists at once: the cap is checked per list, never on their sum, and a
  // check written on the sum would show up here as two full lists refused.
  for (const size of SCENE_SIZES) {
    rows.push(
      `inv-pa present=${padded(size)} absent=${padded(size)} -> ` +
        codesOf(aPlayableState({ scene: aSceneOf(size, size) })),
    );
  }

  // THE ORDER, WITH TWO ENTRIES IN AN UNNATURAL ONE. `aScene` sorts what it is
  // given, so a fixture built through it could never show an unsorted list —
  // the criterion speaks of order, so the corpus hands it a list that is out of
  // order, and the EXACT verdict is what the file holds. Seventh failure mode
  // of `docs/RECETTE.md`.
  const two = aSceneOf(2, 0);
  const backwards: SceneState = { ...two, present: [...two.present].reverse() };
  const duplicated: SceneState = { ...two, present: [two.present[0]!, two.present[0]!] };
  rows.push(
    `sort   ordre=croissant -> ${codesOf(aPlayableState({ scene: two }))}`,
    `sort   ordre=inverse   -> ${codesOf(aPlayableState({ scene: backwards }))}`,
    `sort   ordre=doublon   -> ${codesOf(aPlayableState({ scene: duplicated }))}`,
  );

  // What the storyteller is handed. At table scope the filter is the identity
  // (ADR 0008 decision 3), so this reads the two lists concatenated — and the
  // cap the brief declares has to be able to hold them.
  const audience = briefAudience('table', [PLAYER]);
  for (const size of SCENE_SIZES) {
    const facts = perceivableFactsFor(aSceneOf(size, size), audience);
    rows.push(
      `brief  present=${padded(size)} absent=${padded(size)} -> faits=${padded(facts.length)} ` +
        `sous-plafond=${yesNo(facts.length <= BRIEF_PERCEIVABLE_FACTS_MAX)}`,
    );
  }

  rows.push(
    `cap    scene-presence          -> ${padded(SCENE_PRESENCE_MAX)}`,
    `cap    brief-perceivable-facts -> ${padded(BRIEF_PERCEIVABLE_FACTS_MAX)}`,
  );

  return rows;
}

// ------------------------------------------------------------ the attributes

const ATTRIBUTE_FORMAT =
  'roll   att=<value> -> d6=<action die> sco=<score> <outcome> | refus=<exception> | ' +
  'turn   att=<value> -> ok | <refusal code> | ' +
  'spread slot=<index> -> val=<value> jouable=<y/n> | ' +
  'spread <property> -> <value> | ' +
  'spread compte=<value> -> <occurrences> | ' +
  'create spread=<the five values, or the constant they came from> -> ok | <refusal code>';

/**
 * THE ATTRIBUTE VALUES, WRITTEN IN FULL.
 *
 * `ATTRIBUTE_MIN` is one and `ATTRIBUTE_MAX` three. The sweep runs from minus
 * two to five and carries two fractions, so both bounds are broken in BOTH
 * directions: lowering the floor to zero turns the `+00` row from a refusal
 * into a roll, raising the ceiling to four turns the `+04` row the same way.
 */
const ATTRIBUTE_CANDIDATES: readonly number[] = [-2, -1, 0, 0.5, 1, 2, 2.5, 3, 4, 5];

/** Slots the spread is read at. Two past its length, so a shorter one shows. */
const SPREAD_SLOTS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** Values the spread is counted for. Literal, never taken from the spread. */
const SPREAD_VALUES: readonly number[] = [0, 1, 2, 3, 4];

/**
 * THE SPREADS A DRAFT IS OFFERED, WRITTEN IN FULL — plus one built FROM
 * `ATTRIBUTE_SPREAD`, and that last one is the whole point of this family.
 *
 * `decide` refuses a draft whose five values do not sort to the only legal
 * spread. It does so against a STRING LITERAL of its own (`decide.ts`,
 * `decideCreateDraft`), not against `ATTRIBUTE_SPREAD` — a second copy of the
 * rule, reported with the task and deliberately NOT repaired here. What the
 * corpus does about it: the row below built from the constant says `ok` today,
 * and the day the constant moves it says `attribute_spread_illegal` WHILE the
 * literal row `3,2,2,1,1` goes on saying `ok`. The diff then shows the two
 * copies disagreeing, by name, instead of one of them changing in silence.
 */
const DRAFT_SPREADS: readonly (readonly number[])[] = [
  [3, 2, 2, 1, 1],
  [1, 1, 2, 2, 3],
  [3, 2, 2, 2, 1],
  [3, 3, 2, 1, 1],
  [3, 2, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [4, 2, 2, 1, 1],
];

function attributeLabel(value: number): string {
  return `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(1).padStart(4, '0')}`;
}

function attributeRows(): string[] {
  const rows: string[] = [];

  for (const attribute of ATTRIBUTE_CANDIDATES) {
    rows.push(
      `roll   att=${attributeLabel(attribute)} -> ` +
        orRefusal(() => {
          const roll = rollChallenge(
            { attribute, bonus: 0, momentum: 0, burnMomentum: false },
            scriptedRng([4, 3, 6]),
          );
          return `d6=${String(roll.actionDie)} sco=${signed(roll.score)} ${roll.outcome}`;
        }),
    );
  }

  // The same bounds through `decide`, which promises never to throw: the
  // impossible comes back as a REFUSAL CODE here, and a bound that moved shows
  // up as a row changing side.
  for (const attribute of ATTRIBUTE_CANDIDATES) {
    rows.push(
      `turn   att=${attributeLabel(attribute)} -> ` +
        verdictOf(
          aPlayableState({}, { vif: 2, coeur: 3, fer: attribute, ombre: 1, esprit: 1 }),
          { type: 'move.endure_harm' },
          aCtx(MISS),
        ),
    );
  }

  // THE SPREAD, SLOT BY SLOT. `ATTRIBUTE_SPREAD` is read by no engine function
  // — the check lives in the Zod mirror — so this is the only place a golden
  // file can hold it. `jouable` is the join with the bounds above: every value
  // the spread hands out has to be one `rollChallenge` accepts, and a spread
  // that grew a 4 would show up as a slot that stopped being playable.
  const spread: readonly number[] = ATTRIBUTE_SPREAD;
  for (const slot of SPREAD_SLOTS) {
    const value = spread[slot];
    rows.push(
      `spread slot=${padded(slot, 1)} -> ` +
        (value === undefined
          ? 'val=-- jouable=-'
          : `val=${signed(value, 1)} jouable=${
              orRefusal(() => {
                rollChallenge(
                  { attribute: value, bonus: 0, momentum: 0, burnMomentum: false },
                  scriptedRng([4, 3, 9]),
                );
                return 'y';
              }) === 'y'
                ? 'y'
                : 'n'
            }`),
    );
  }

  const descending = spread.every(
    (value, index) => index === 0 || value <= (spread[index - 1] ?? value),
  );
  rows.push(
    `spread ${'longueur'.padEnd(11)} -> ${padded(spread.length)}`,
    `spread ${'somme'.padEnd(11)} -> ${padded(spread.reduce((total, value) => total + value, 0))}`,
    `spread ${'decroissant'.padEnd(11)} -> ${yesNo(descending)}`,
  );

  for (const value of SPREAD_VALUES) {
    rows.push(
      `spread compte=${padded(value, 1)} -> ` +
        padded(spread.filter((entry) => entry === value).length),
    );
  }

  for (const values of [...DRAFT_SPREADS, spread]) {
    const source = values === spread ? 'ATTRIBUTE_SPREAD' : values.join(',');
    rows.push(
      `create spread=${source.padEnd(16)} -> ` +
        verdictOf(
          aPlayableState(),
          {
            type: 'character.create_draft',
            championSlug: 'braum',
            spread: {
              vif: values[0] ?? 0,
              coeur: values[1] ?? 0,
              fer: values[2] ?? 0,
              ombre: values[3] ?? 0,
              esprit: values[4] ?? 0,
            },
            background: 'une bergere du nord',
          },
          aCtx([]),
        ),
    );
  }

  return rows;
}

// ------------------------------------------------------------------- corpora

describe('the golden corpora of the rule constants', () => {
  it('pins the price table and its die', () => {
    const rows = priceRows();
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(new Set(rows).size).toBe(rows.length);
    expectGolden('price-rules', { format: PRICE_FORMAT, rows }, GOLDEN);
  });

  it('pins the harm the endure move takes', () => {
    const rows = harmRows();
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(new Set(rows).size).toBe(rows.length);
    expectGolden('harm-rules', { format: HARM_FORMAT, rows }, GOLDEN);
  });

  it('pins the clock segments and the advance bounds', () => {
    const rows = clockRows();
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(new Set(rows).size).toBe(rows.length);
    expectGolden('clock-rules', { format: CLOCK_FORMAT, rows }, GOLDEN);
  });

  it('pins the oracle likelihood thresholds', () => {
    const rows = oracleRows();
    expect(rows.length).toBeGreaterThanOrEqual(100);
    expect(new Set(rows).size).toBe(rows.length);
    expectGolden('oracle-rules', { format: ORACLE_FORMAT, rows }, GOLDEN);
  });

  it('pins the scene presence cap', () => {
    const rows = sceneRows();
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(new Set(rows).size).toBe(rows.length);
    expectGolden('scene-rules', { format: SCENE_FORMAT, rows }, GOLDEN);
  });

  it('pins the attribute bounds and the creation spread', () => {
    const rows = attributeRows();
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expect(new Set(rows).size).toBe(rows.length);
    expectGolden('attribute-rules', { format: ATTRIBUTE_FORMAT, rows }, GOLDEN);
  });
});

/**
 * WHAT EACH CORPUS IS AN ORACLE FOR.
 *
 * Six tests, one per family, on the model of « what the gauge corpus is an
 * oracle for » in `corpus.test.ts`. Their job is NOT to re-check the values —
 * the golden files hold those. It is to name the DECISION each family exists
 * to pin, so that deleting a family says which one instead of leaving a
 * smaller corpus passing quietly.
 *
 * Every count below is `toBeGreaterThan(0)` over a row the family must produce
 * in BOTH directions: an acceptance and a refusal, a `y` and an `n`, a bound
 * reached and a bound missed. A family that kept only one side would still
 * have rows, and this is what says so.
 */
describe('what the constant corpora are oracles for', () => {
  const count = (rows: readonly string[], predicate: (row: string) => boolean): number =>
    rows.filter(predicate).length;

  it('price: the one table the engine draws for itself, and the twelve faces', () => {
    const rows = priceRows();
    // Exactly ONE (id, die) pair is accepted. A guard that stopped reading the
    // die would accept nine; one that stopped reading the identifier, three.
    expect(count(rows, (row) => row.startsWith('table') && row.endsWith('-> ok'))).toBe(1);
    expect(
      count(rows, (row) => row.startsWith('table') && row.includes('refus=NotThePriceTable')),
    ).toBeGreaterThan(0);
    // The three faces the price rules turn on: no effect at all, two effects
    // arbitrated by a second draw, and a nested price.
    expect(count(rows, (row) => row.includes('idx=-01'))).toBeGreaterThan(0);
    expect(count(rows, (row) => row.includes('arb=y'))).toBeGreaterThan(0);
    expect(count(rows, (row) => row.includes('eff=pay_price'))).toBeGreaterThan(0);
    // And the production route: a miss really writes the price entry.
    expect(count(rows, (row) => row.includes('roll.price_paid'))).toBe(1);
  });

  it('harm: the amount the intent did not name, and the clamp around it', () => {
    const rows = harmRows();
    // The four inputs that carry no number are what the default answers for.
    for (const label of ['absent', 'nan', '+inf', '-inf']) {
      expect(count(rows, (row) => row.startsWith('amount') && row.includes(label))).toBe(1);
    }
    // No negative harm — healing through the harm move is the back door the
    // clamp closes.
    expect(
      count(rows, (row) => row.startsWith('amount') && row.includes('harm=+00')),
    ).toBeGreaterThan(0);
    expect(
      count(rows, (row) => row.startsWith('turn') && row.includes('aucun degat')),
    ).toBeGreaterThan(0);
    // A harm the gauge floor swallowed, and one it did not.
    expect(count(rows, (row) => row.includes('clamped=y'))).toBeGreaterThan(0);
    expect(count(rows, (row) => row.includes('clamped=n'))).toBeGreaterThan(0);
  });

  it('clock: the legal segment counts, both ways, and the two advance bounds', () => {
    const rows = clockRows();
    // The list is SWEPT, not pinned: emptying `CLOCK_SEGMENT_COUNTS` makes
    // every `legal` row say `n`, and these two lines fall.
    expect(count(rows, (row) => row.startsWith('legal') && row.endsWith('-> y'))).toBe(4);
    expect(count(rows, (row) => row.startsWith('legal') && row.endsWith('-> n'))).toBeGreaterThan(
      0,
    );
    // The floor: an advance asked for below it is RAISED to it, never dropped.
    expect(
      count(rows, (row) => row.startsWith('adv') && row.includes('delta=+01')),
    ).toBeGreaterThan(0);
    // The ceiling: an advance asked for above it is cut down to it.
    expect(
      count(rows, (row) => row.startsWith('adv') && row.includes('delta=+03')),
    ).toBeGreaterThan(0);
    // A clock that saturates, and a turn that finds nothing left to advance.
    expect(count(rows, (row) => row.includes('plein'))).toBeGreaterThan(0);
    expect(count(rows, (row) => row.startsWith('fill') && row.endsWith('-> rien'))).toBeGreaterThan(
      0,
    );
  });

  it('oracle: the five bands, each answering both ways around its threshold', () => {
    const rows = oracleRows();
    // The five values of ARCHITECTURE.md section 4.2, written in full. A band
    // dropped from `LIKELIHOODS` makes its line here fall rather than leaving
    // a shorter corpus passing.
    for (const likelihood of [
      'quasi-certain',
      'probable',
      'incertain',
      'peu-probable',
      'improbable',
    ] satisfies readonly Likelihood[]) {
      const band = rows.filter((row) => row.includes(`like=${likelihood} `));
      expect(band.filter((row) => row.includes('rep=oui')).length).toBeGreaterThan(0);
      expect(band.filter((row) => row.includes('rep=non')).length).toBeGreaterThan(0);
    }
    // The extreme answer, at both ends of the die.
    expect(count(rows, (row) => row.includes('rep=oui') && row.includes('extr=y'))).toBeGreaterThan(
      0,
    );
    expect(count(rows, (row) => row.includes('rep=non') && row.includes('extr=y'))).toBeGreaterThan(
      0,
    );
  });

  it('scene: the cap, per list, and the sort the prompt cache depends on', () => {
    const rows = sceneRows();
    // A list under the cap and a list over it. Only one side and the corpus
    // would pin a cap of anything.
    expect(
      count(rows, (row) => row.startsWith('inv-p') && row.endsWith('-> rien')),
    ).toBeGreaterThan(0);
    expect(
      count(
        rows,
        (row) => row.startsWith('inv-p') && row.includes('scene_capacity_exceeded:present'),
      ),
    ).toBeGreaterThan(0);
    expect(
      count(
        rows,
        (row) => row.startsWith('inv-a') && row.includes('scene_capacity_exceeded:absent'),
      ),
    ).toBeGreaterThan(0);
    // Per list, never on the sum: both lists loaded at once give TWO codes.
    expect(
      count(
        rows,
        (row) =>
          row.startsWith('inv-pa') &&
          row.includes('scene_capacity_exceeded:present scene_capacity_exceeded:absent'),
      ),
    ).toBeGreaterThan(0);
    // The sort, with two entries in an unnatural order.
    expect(count(rows, (row) => row.startsWith('sort') && row.includes('target_not_present'))).toBe(
      2,
    );
    // The brief cap, reached from under and from over.
    expect(
      count(rows, (row) => row.startsWith('brief') && row.includes('sous-plafond=y')),
    ).toBeGreaterThan(0);
    expect(
      count(rows, (row) => row.startsWith('brief') && row.includes('sous-plafond=n')),
    ).toBeGreaterThan(0);
  });

  it('attribute: both bounds, both ways, and the only legal spread', () => {
    const rows = attributeRows();
    // The bounds, from the throwing side and from the refusing side.
    expect(count(rows, (row) => row.startsWith('roll') && row.includes('refus='))).toBeGreaterThan(
      0,
    );
    expect(count(rows, (row) => row.startsWith('roll') && !row.includes('refus='))).toBeGreaterThan(
      0,
    );
    expect(count(rows, (row) => row.startsWith('turn') && row.endsWith('-> ok'))).toBeGreaterThan(
      0,
    );
    expect(
      count(rows, (row) => row.startsWith('turn') && row.includes('attribute_not_allowed')),
    ).toBeGreaterThan(0);
    // Every slot of the spread is readable and playable, and the two slots
    // past its end say so rather than being absent.
    expect(count(rows, (row) => row.startsWith('spread slot') && row.includes('jouable=y'))).toBe(
      5,
    );
    expect(count(rows, (row) => row.startsWith('spread slot') && row.includes('val=--'))).toBe(2);
    // The draft gate, accepted and refused — and the row built FROM the
    // constant, which is the one that moves when the constant moves.
    expect(count(rows, (row) => row.startsWith('create') && row.endsWith('-> ok'))).toBeGreaterThan(
      0,
    );
    expect(
      count(rows, (row) => row.startsWith('create') && row.includes('attribute_spread_illegal')),
    ).toBeGreaterThan(0);
    expect(count(rows, (row) => row.includes('spread=ATTRIBUTE_SPREAD'))).toBe(1);
  });
});
