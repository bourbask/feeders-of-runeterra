/**
 * The closed list of V1 move identifiers.
 *
 * Move identifiers are ENGLISH kebab-case (ARCHITECTURE.md section 4.2): they are
 * content filenames and code keys, not player-facing wording. What the player
 * reads comes from `content/moves/*.json`.
 */

export const MOVE_IDS = [
  'face-danger',
  'secure-advantage',
  'gather-information',
  'probe-a-soul',
  'strike',
  'endure-harm',
  'endure-cold',
  'swear-a-vow',
  'fulfill-your-vow',
  'reach-a-milestone',
  'forsake-your-vow',
] as const;

export type MoveId = (typeof MOVE_IDS)[number];

/** The three outcomes of any roll. */
export const OUTCOMES = ['franche', 'partielle', 'echec'] as const;

export type Outcome = (typeof OUTCOMES)[number];

/** Oracle likelihood bands, with their d100 thresholds. */
export const LIKELIHOODS = [
  'quasi-certain',
  'probable',
  'incertain',
  'peu-probable',
  'improbable',
] as const;

export type Likelihood = (typeof LIKELIHOODS)[number];

export const LIKELIHOOD_THRESHOLDS: Readonly<Record<Likelihood, number>> = {
  'quasi-certain': 90,
  probable: 75,
  incertain: 50,
  'peu-probable': 25,
  improbable: 10,
};

/** Score ceiling of an action roll. `rawTotal` keeps the unclamped value. */
export const ACTION_SCORE_CAP = 10;
