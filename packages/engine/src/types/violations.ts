/**
 * `RuleViolation` — an intent the rules refuse.
 *
 * A code and machine details. NO HUMAN TEXT: the engine does not speak French
 * (or any other language). The client maps a code to a sentence in
 * `packages/client/src/api/error-messages.ts` (01-architecture.md section 3.3).
 *
 * The code union is CLOSED. The four names written in the spec are
 * `move_in_progress`, `gauge_out_of_range`, `unknown_move` and
 * `character_dead`; the rest of the list closes the ellipsis the spec left
 * open, and is reported as such in the M0-02 report.
 */

export const RULE_VIOLATION_CODES = [
  /** The actor has a roll awaiting a burn decision. NOT a turn lock. */
  'move_in_progress',
  'gauge_out_of_range',
  'unknown_move',
  'character_dead',
  'character_retired',
  'character_not_in_campaign',
  'unknown_character',
  'unknown_track',
  'unknown_clock',
  'unknown_entity',
  'unknown_oracle_table',
  'campaign_not_active',
  'not_a_member',
  'attribute_spread_illegal',
  'attribute_not_allowed',
  'champion_locked',
  'track_already_resolved',
  'track_wrong_kind',
  'no_burn_window',
  'momentum_too_low',
  'insufficient_xp',
  'no_active_scene',
  'scene_capacity_exceeded',
  'target_not_present',
] as const;

export type RuleViolationCode = (typeof RULE_VIOLATION_CODES)[number];

/** Machine-readable context. Scalars only: it is serialised and logged. */
export type ViolationDetails = Readonly<Record<string, string | number | boolean | null>>;

export interface RuleViolation {
  readonly code: RuleViolationCode;
  readonly details: ViolationDetails;
}
