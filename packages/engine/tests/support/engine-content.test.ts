/**
 * The content bundle the engine tests run against, and the two small ports
 * `decide` needs: a stream-addressed generator and a decision context.
 *
 * WHY THIS FIXTURE MODULE IS ITSELF A `.test.ts`. The flat ESLint config
 * attaches a TypeScript program to `**\/*.test.ts` and to nothing else under
 * `tests/`, so a plain `.ts` helper there cannot be parsed and is reported as
 * "not found by the project service". Rather than leave two modules outside
 * the lint, they carry the self-check that any fixture owes its readers: a
 * bundle that has quietly stopped covering what the tests assume is a green
 * suite measuring nothing. Reported with the task.
 *
 * It lives in `tests/` and not in `src/` on purpose. `@for/engine` carries no
 * game content — that is the rule ARCHITECTURE.md section 4.3 states in its
 * last row — so a fixture bundle inside `src/` would be the very thing the
 * package forbids, and `purity.test.ts` would catch it by its accents alone.
 *
 * The moves below mirror the SHAPE of `content/moves/*.json` and nothing else:
 * every consequence is an `EngineEffect`, because that is what content is
 * allowed to carry. Between them they exercise the thirteen operations of
 * `EngineEffect`, which is what makes the effect executor measurable.
 */

import { describe, expect, it } from 'vitest';

import type {
  ConditionDefinition,
  DecisionContext,
  DecisionRng,
  EngineContent,
  EngineEffect,
  MoveDefinition,
  MoveId,
  OracleTable,
  OracleTableDefinition,
  PriceEntryDefinition,
  Rng,
  RngStream,
} from '../../src/index.js';
import { EFFECT_OPS, MOVE_IDS } from '../../src/index.js';

/** One outcome's worth of effects, in the shape the content port expects. */
function outcomes(
  franche: readonly EngineEffect[],
  partielle: readonly EngineEffect[],
  echec: readonly EngineEffect[],
): MoveDefinition['outcomes'] {
  return {
    franche: { effects: franche },
    partielle: { effects: partielle },
    echec: { effects: echec },
  };
}

function aMove(
  id: MoveId,
  rollKind: MoveDefinition['rollKind'],
  attributeOptions: MoveDefinition['attributeOptions'],
  moveOutcomes: MoveDefinition['outcomes'],
  allowsMomentumBurn = true,
): MoveDefinition {
  return { id, rollKind, attributeOptions, allowsMomentumBurn, outcomes: moveOutcomes };
}

export const FIXTURE_MOVES: Readonly<Record<MoveId, MoveDefinition>> = {
  'face-danger': aMove(
    'face-danger',
    'action',
    ['vif', 'coeur', 'fer', 'ombre', 'esprit'],
    outcomes(
      [{ op: 'momentum', delta: 1 }],
      [{ op: 'gauge', gauge: 'vivres', delta: -1, target: 'self' }],
      [{ op: 'pay_price', mode: 'roll' }],
    ),
  ),
  'secure-advantage': aMove(
    'secure-advantage',
    'action',
    ['vif', 'esprit'],
    outcomes(
      [
        { op: 'momentum', delta: 2 },
        { op: 'narrative', prompt: 'decris le terrain gagne' },
      ],
      [{ op: 'momentum', delta: 1 }],
      [{ op: 'clock_advance', segments: 2 }],
    ),
  ),
  'gather-information': aMove(
    'gather-information',
    'action',
    ['esprit'],
    outcomes(
      [{ op: 'oracle', tableId: 'complication' }],
      [{ op: 'oracle', tableId: 'complication' }],
      [{ op: 'oracle', tableId: 'absente' }],
    ),
  ),
  'probe-a-soul': aMove(
    'probe-a-soul',
    'action',
    ['coeur', 'ombre'],
    outcomes(
      [{ op: 'momentum', delta: 1 }],
      [{ op: 'condition_add', conditionId: 'trouble' }],
      [{ op: 'condition_add', conditionId: 'inconnue' }],
    ),
  ),
  strike: aMove(
    'strike',
    'action',
    ['fer', 'vif'],
    outcomes(
      [{ op: 'track_tick', trackKind: 'combat', ticks: 4, useRank: false }],
      [{ op: 'track_tick', trackKind: 'combat', ticks: 2, useRank: false }],
      [{ op: 'gauge', gauge: 'vigueur', delta: -1, target: 'self' }],
    ),
  ),
  'endure-harm': aMove(
    'endure-harm',
    'action',
    ['fer'],
    outcomes(
      [{ op: 'momentum', delta: 1 }],
      [{ op: 'condition_remove', conditionId: 'trouble' }],
      [{ op: 'momentum_reset' }],
    ),
  ),
  'endure-cold': aMove(
    'endure-cold',
    'action',
    ['fer', 'esprit'],
    outcomes(
      [{ op: 'momentum', delta: 1 }],
      [{ op: 'gauge', gauge: 'vivres', delta: -1, target: 'all-allies' }],
      [{ op: 'gauge', gauge: 'vigueur', delta: -1, target: 'chosen-ally' }],
    ),
  ),
  'swear-a-vow': aMove(
    'swear-a-vow',
    'action',
    ['coeur'],
    outcomes(
      [{ op: 'track_create', trackKind: 'vow', rankFrom: 'player' }],
      [
        { op: 'track_create', trackKind: 'vow', rankFrom: 'player' },
        { op: 'gauge', gauge: 'ame', delta: -1, target: 'self' },
      ],
      [{ op: 'track_create', trackKind: 'vow', rankFrom: 'fixed' }],
    ),
  ),
  'fulfill-your-vow': aMove(
    'fulfill-your-vow',
    'progress',
    [],
    outcomes([{ op: 'xp', amount: 2 }], [{ op: 'xp', amount: 1 }], [{ op: 'momentum', delta: -1 }]),
    false,
  ),
  'reach-a-milestone': aMove(
    'reach-a-milestone',
    'none',
    [],
    outcomes([{ op: 'track_tick', trackKind: 'vow', ticks: 0, useRank: true }], [], []),
    false,
  ),
  'forsake-your-vow': aMove(
    'forsake-your-vow',
    'none',
    [],
    outcomes([{ op: 'xp', amount: -1 }], [], []),
    false,
  ),
};

/**
 * Twelve entries on a d12, one face each, so a test picks a consequence by
 * naming the die. Three of them are the interesting ones:
 *
 *   1  no effect at all      -> `effectIndex` is `NO_EFFECT_INDEX`, not zero
 *   3  two effects           -> a SECOND draw on the `price` stream arbitrates
 *   12 a nested `pay_price`  -> the depth bound of the executor
 */
export const FIXTURE_PRICE_TABLE: OracleTable<PriceEntryDefinition> = {
  id: 'pay-the-price',
  die: 12,
  entries: [
    {
      id: 'p1',
      min: 1,
      max: 1,
      text: 'rien ne se passe',
      severity: 'mineure',
      suggestedEffects: [],
    },
    {
      id: 'p2',
      min: 2,
      max: 2,
      text: 'tu perds des vivres',
      severity: 'mineure',
      suggestedEffects: [{ op: 'gauge', gauge: 'vivres', delta: -1, target: 'self' }],
    },
    {
      id: 'p3',
      min: 3,
      max: 3,
      text: 'deux issues possibles',
      severity: 'moyenne',
      suggestedEffects: [
        { op: 'gauge', gauge: 'vigueur', delta: -1, target: 'self' },
        { op: 'gauge', gauge: 'ame', delta: -1, target: 'self' },
      ],
    },
    ...[4, 5, 6, 7, 8, 9, 10, 11].map((face) => ({
      id: `p${String(face)}`,
      min: face,
      max: face,
      text: 'le froid prend sa part',
      severity: 'moyenne',
      suggestedEffects: [{ op: 'momentum', delta: -1 }] as readonly EngineEffect[],
    })),
    {
      id: 'p12',
      min: 12,
      max: 12,
      text: 'et ce n est pas fini',
      severity: 'grave',
      suggestedEffects: [{ op: 'pay_price', mode: 'roll' }],
    },
  ],
};

export const FIXTURE_PRESAGE_TABLE: OracleTableDefinition = {
  id: 'presages',
  version: '1.0.0',
  die: 6,
  entries: [
    { id: 'pr1', min: 1, max: 3, text: 'le vent tourne', tags: ['froid'] },
    { id: 'pr2', min: 4, max: 6, text: 'la glace craque' },
  ],
};

export const FIXTURE_ORACLES: Readonly<Record<string, OracleTableDefinition>> = {
  complication: {
    id: 'complication',
    version: '1.0.0',
    die: 6,
    entries: [
      { id: 'c1', min: 1, max: 3, text: 'une piste se perd', tags: ['enquete'] },
      { id: 'c2', min: 4, max: 6, text: 'un temoin ment' },
    ],
  },
  /** Reserved to the engine; `oracle.draw` must refuse it. */
  presages: FIXTURE_PRESAGE_TABLE,
};

export const FIXTURE_CONDITIONS: Readonly<Record<string, ConditionDefinition>> = {
  trouble: { id: 'trouble', label: 'Trouble' },
};

export function aContent(overrides: Partial<EngineContent> = {}): EngineContent {
  return {
    moves: FIXTURE_MOVES,
    oracles: FIXTURE_ORACLES,
    priceTable: FIXTURE_PRICE_TABLE,
    presageTable: FIXTURE_PRESAGE_TABLE,
    conditions: FIXTURE_CONDITIONS,
    ...overrides,
  };
}

/** Every stream served by the SAME generator: a scripted list, read in order. */
export function oneStream(rng: Rng): DecisionRng {
  return { stream: (): Rng => rng };
}

/** A generator per stream, so a test can script the price draw independently. */
export function byStream(streams: Partial<Record<RngStream, Rng>>, fallback: Rng): DecisionRng {
  return { stream: (name: RngStream): Rng => streams[name] ?? fallback };
}

/** The fixed instant every engine fixture uses. No test reads a clock. */
export const FIXTURE_NOW = 1_767_225_600_000;

export function aDecisionContext(
  overrides: Partial<DecisionContext> & Pick<DecisionContext, 'rng' | 'ids' | 'actorId'>,
): DecisionContext {
  return {
    now: FIXTURE_NOW,
    content: aContent(),
    burnWindow: null,
    ...overrides,
  };
}

// ------------------------------------------------------------- self-check

describe('the fixture bundle stays usable', () => {
  it('carries all eleven moves', () => {
    expect(Object.keys(FIXTURE_MOVES).sort()).toEqual([...MOVE_IDS].sort());
  });

  it('covers the d12 of the price table without a hole or an overlap', () => {
    const faces = FIXTURE_PRICE_TABLE.entries.flatMap((entry) =>
      Array.from({ length: entry.max - entry.min + 1 }, (_value, offset) => entry.min + offset),
    );
    expect(faces.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('exercises every effect operation between its moves and its price table', () => {
    const used = new Set<string>();
    for (const move of Object.values(FIXTURE_MOVES)) {
      for (const outcome of Object.values(move.outcomes)) {
        for (const effect of outcome.effects) used.add(effect.op);
      }
    }
    for (const entry of FIXTURE_PRICE_TABLE.entries) {
      for (const effect of entry.suggestedEffects) used.add(effect.op);
    }
    // `choice` is the one operation no fixture move carries: it is built inline
    // by the test that proves the engine refuses to pick for the player.
    expect([...used].sort()).toEqual(
      EFFECT_OPS.filter((op) => op !== 'choice')
        .map((op) => op)
        .sort(),
    );
  });
});
