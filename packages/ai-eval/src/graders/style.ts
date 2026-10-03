/**
 * `style` — the register, measured on tournures rather than on adjectives.
 *
 * The verdict on `conteur/1.0.0` was « fade et trop flou ». Asking for a tone
 * « âpre, sensoriel, concret » changed nothing; the six checks below measure
 * what actually moves, and three of them are hard.
 *
 * ── THREE STAY SOFT, DELIBERATELY ───────────────────────────────────────────
 * `adverb_budget`, `no_triads` and `no_anonymous_recurrent`. Their heuristics
 * on French morphology are good without being perfect, and risk 4 of
 * `ARCHITECTURE.md` names segmentation and morphology as the two known sources
 * of false failures. A false failure on a hard assertion is an engine fallback
 * a player sees — so they are reported and never block. `kit.ts` decides that
 * from `assertion.hard`, which is `@for/ai`'s own flag, not a second list kept
 * here.
 */

import { runFamily, type Grader } from './kit.js';

export const STYLE_IDS: readonly string[] = [
  'banned_style_lexicon',
  'no_named_emotion',
  'no_atmosphere_ending',
  'adverb_budget',
  'no_triads',
  'no_anonymous_recurrent',
];

export const styleGrader: Grader = {
  name: 'style',
  ids: STYLE_IDS,
  run: (input) => runFamily(STYLE_IDS, input),
};
