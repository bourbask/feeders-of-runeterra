/**
 * The three gauges and the momentum bounds.
 *
 * Bounds are mirrored by SQL CHECK constraints (03-donnees.md section 1.4).
 * That redundancy is deliberate: a reducer bug that pushed a gauge out of
 * range fails the transaction instead of being written.
 */

export const GAUGES = ['vigueur', 'ame', 'vivres'] as const;

export type GaugeId = (typeof GAUGES)[number];

export const GAUGE_MIN = 0;
export const GAUGE_MAX = 5;

/** One value per gauge, each in [GAUGE_MIN, GAUGE_MAX]. */
export type GaugeSet = Readonly<Record<GaugeId, number>>;

/**
 * Momentum bounds, per character: a content asset may move them, so they are
 * state rather than a constant.
 */
export interface MomentumBounds {
  readonly min: number;
  readonly max: number;
  /** Value momentum falls back to after a burn. */
  readonly reset: number;
}

export const DEFAULT_MOMENTUM_BOUNDS: MomentumBounds = {
  min: -6,
  max: 10,
  reset: 2,
};
