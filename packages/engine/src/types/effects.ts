/**
 * `EngineEffect` — the core contract.
 *
 * Content NEVER holds logic. It declares effects the engine knows how to run.
 * That is what keeps a JSON file from working around invariant 1, and it is
 * why NO `EngineEffect` ever travels FROM the model: a tool that handed the
 * engine an effect, or an index designating one, would put the storyteller
 * back on the decision path (ARCHITECTURE.md section 4.4).
 *
 * This type is canonical here; `@for/contracts` mirrors it as `EffectSchema`
 * with `satisfies z.ZodType<EngineEffect>` (03-donnees.md section 4.3).
 */

import type { GaugeId } from './gauges.js';
import type { ProgressRank, ProgressTrackKind } from './progress.js';

export const EFFECT_TARGETS = ['self', 'chosen-ally', 'all-allies'] as const;

export type EffectTarget = (typeof EFFECT_TARGETS)[number];

/** Track kinds a `track_create` effect may open. `bond` is not among them. */
export const CREATABLE_TRACK_KINDS = ['vow', 'combat', 'journey', 'scene_challenge'] as const;

export type CreatableTrackKind = (typeof CREATABLE_TRACK_KINDS)[number];

export interface EffectChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly effects: readonly EngineEffect[];
}

export type EngineEffect =
  | {
      readonly op: 'gauge';
      readonly gauge: GaugeId;
      readonly delta: number;
      readonly target: EffectTarget;
    }
  | { readonly op: 'momentum'; readonly delta: number }
  | { readonly op: 'momentum_reset' }
  | { readonly op: 'condition_add'; readonly conditionId: string }
  | { readonly op: 'condition_remove'; readonly conditionId: string }
  | {
      readonly op: 'track_tick';
      readonly trackKind: ProgressTrackKind;
      readonly ticks: number;
      /** `true` => ticks = TICKS_PER_MILESTONE[rank]. */
      readonly useRank: boolean;
    }
  | {
      readonly op: 'track_create';
      readonly trackKind: CreatableTrackKind;
      readonly rankFrom: 'player' | 'fixed';
      /**
       * `| undefined` is not decoration. `exactOptionalPropertyTypes` is on,
       * so `rank?: ProgressRank` would REFUSE the shape a `z.optional()`
       * produces, and `zEngineEffect satisfies z.ZodType<EngineEffect>` would
       * not compile. Every optional field of this package is written this way.
       */
      readonly rank?: ProgressRank | undefined;
    }
  | { readonly op: 'clock_advance'; readonly segments: number }
  | { readonly op: 'xp'; readonly amount: number }
  | { readonly op: 'pay_price'; readonly mode: PayPriceMode }
  | { readonly op: 'oracle'; readonly tableId: string }
  /** Instruction to the storyteller. Zero mechanics. Content text. */
  | { readonly op: 'narrative'; readonly prompt: string }
  | {
      readonly op: 'choice';
      readonly label: string;
      readonly pick: number;
      readonly options: readonly EffectChoiceOption[];
    };

/**
 * ONE MODE, AND ONLY ONE — ADR 0006.
 *
 * M0-02 mirrored `EffectSchema` verbatim, contradiction included, and reported
 * it instead of correcting it silently. That report is what made the hole
 * visible, and ADR 0006 closed it: the engine rolls the d12 on the price table
 * and hands the drawn entry over as an imposed fact. Nobody chooses — not the
 * model, not the player. `gm_choice` and `player_choice` are removed here by
 * M0-05, which is the follow-up the ADR assigns under "ce qui reste a faire".
 *
 * Keeping this tuple at one member is what stops the effect executor from
 * growing a second state-writing path — but NOT through a `switch` on the
 * mode: there is none, and `applyPayPrice` never reads `effect.mode` at all.
 * It rolls the d12 and applies the drawn entry, full stop. What the single
 * member buys is that no other value can ever be written into a `pay_price`
 * effect, so no reader downstream has a second case to branch on.
 *
 * What guards the tuple is the runtime mirror of `@for/contracts`
 * (`exhaustive-union.test.ts`), member by member, per ADR 0007: `satisfies`
 * is covariant in output and lets the list shrink or grow in silence.
 */
export const PAY_PRICE_MODES = ['roll'] as const;

export type PayPriceMode = (typeof PAY_PRICE_MODES)[number];

export const EFFECT_OPS = [
  'gauge',
  'momentum',
  'momentum_reset',
  'condition_add',
  'condition_remove',
  'track_tick',
  'track_create',
  'clock_advance',
  'xp',
  'pay_price',
  'oracle',
  'narrative',
  'choice',
] as const satisfies readonly EngineEffect['op'][];

export type EffectOp = (typeof EFFECT_OPS)[number];

/**
 * Compile-time exhaustiveness: if a variant is added to `EngineEffect` without
 * a line in `EFFECT_OPS`, `Exclude<...>` stops being `never` and this alias
 * fails to satisfy its constraint. `tsc` breaks, no test needed.
 */
type AssertNever<T extends never> = T;
export type EffectOpsAreExhaustive = AssertNever<Exclude<EngineEffect['op'], EffectOp>>;
