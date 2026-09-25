/**
 * Scene-coherence and refusal assertions — teachings 2 and 3 of section 8.4.
 *
 * ── WHAT `scene_block_consistent` ADDS ──────────────────────────────────────
 * Rule S5 of the merge already IGNORES an entry that walks an absent back into
 * `presents`, server-side and silently. This assertion turns that silence into
 * a visible failure, in eval AND in the post-filter. Its failure never
 * invalidates the prose (section 8.6): the entry is already dropped, the
 * assertion only makes the incident countable. Held by
 * tests/assertions.test.ts « scene_block_consistent refuse un présent qui
 * figure dans les partis » and « et un bloc absent ne déclenche rien » ; the
 * silence it is making visible is tests/scene-merge.test.ts « S5 : un parti
 * que le bloc remet en scène est ignoré ».
 *
 * ── WHY `no_absent_reappearance` IS HARD DESPITE BEING A HEURISTIC ──────────
 * Its marker list runs in the permissive direction: it ALLOWS what we want to
 * allow — the empty shelter, the blood, the trace — and only fails on a bare
 * mention. And it is exactly the bug observed in a real session, three
 * exchanges in. Held in both directions by tests/assertions.test.ts
 * « no_absent_reappearance refuse la mention nue d'un absent » and « et
 * autorise ce qu'il a laissé derrière lui ».
 */

import { ABSENCE_MARKERS } from './lexicons.js';
import { findTerms, normalize, splitSentences, stripQuoted } from './text.js';
import { fail, pass, type Assertion } from './types.js';

/** S1's matching, reduced to what an assertion needs: fold and compare. */
const sameName = (left: string, right: string): boolean =>
  normalize(left) === normalize(right) && normalize(left).length > 0;

export const noAbsentReappearance: Assertion = {
  id: 'no_absent_reappearance',
  hard: true,
  run: (output, ctx) => {
    const narration = stripQuoted(output);
    for (const sentence of splitSentences(narration)) {
      for (const name of ctx.absentNames) {
        if (findTerms(sentence, [name]).length === 0) continue;
        if (findTerms(sentence, ABSENCE_MARKERS).length > 0) continue;
        return fail(
          'no_absent_reappearance',
          `« ${name} » nommé sans marqueur d’absence : « ${sentence} »`,
        );
      }
    }
    return pass('no_absent_reappearance');
  },
};

export const sceneBlockConsistent: Assertion = {
  id: 'scene_block_consistent',
  hard: true,
  run: (_output, ctx) => {
    if (ctx.sceneBlock === null) return pass('scene_block_consistent', 'aucun bloc exploitable');
    const offending = ctx.sceneBlock.presents.filter((present) =>
      ctx.absentNames.some((absent) => sameName(absent, present.nom)),
    );
    return offending.length === 0
      ? pass('scene_block_consistent')
      : fail(
          'scene_block_consistent',
          `présents déjà partis : ${offending.map((entry) => entry.nom).join(', ')}`,
        );
  },
};

/**
 * On a case marked « materially possible », no refusal may be UPHELD.
 *
 * A refusal the server REJECTED is not a failure here: the model pointed at a
 * fact, the server re-checked it and said no, the turn played normally. That
 * is the mechanism working, not a defect — and the rejection rate is a metric
 * the eval harness already tracks.
 */
export const noRefusal: Assertion = {
  id: 'no_refusal',
  hard: false,
  run: (_output, ctx) => {
    if (ctx.refusal === null) return pass('no_refusal', 'aucun refus déclaré');
    return ctx.refusal.verdict === 'upheld'
      ? fail('no_refusal', `refus retenu (${ctx.refusal.cause ?? '?'}) sur un cas jouable`)
      : pass('no_refusal', 'refus déclaré puis rejeté par le serveur');
  },
};

export const refusalMatches: Assertion = {
  id: 'refusal_matches',
  hard: false,
  run: (_output, ctx) => {
    if (ctx.expectedRefusal === null) {
      return ctx.refusal === null || ctx.refusal.verdict === 'rejected'
        ? pass('refusal_matches', 'aucun refus attendu, aucun refus retenu')
        : fail('refusal_matches', 'refus retenu alors que le cas n’en attend aucun');
    }
    if (ctx.refusal === null) return fail('refusal_matches', 'aucun refus produit');
    const expected = ctx.expectedRefusal;
    const same =
      ctx.refusal.verdict === expected.verdict &&
      ctx.refusal.cause === expected.cause &&
      ((ctx.refusal.target === null && expected.target === null) ||
        (ctx.refusal.target !== null &&
          expected.target !== null &&
          sameName(ctx.refusal.target, expected.target)));
    return same
      ? pass('refusal_matches')
      : fail(
          'refusal_matches',
          `attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(ctx.refusal)}`,
        );
  },
};
