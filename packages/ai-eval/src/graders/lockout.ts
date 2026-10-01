/**
 * `lockout` — the distribution lock, read on the output.
 *
 * Those champions are played by somebody else at this table. The storyteller
 * must not name them, under a name, a nickname, a title or a recognisable
 * periphrasis — and section 8.6 makes this the one failure that is ALWAYS
 * logged as an alert, even when the retry then succeeds.
 *
 * ── TWO DOORS, BOTH WATCHED ─────────────────────────────────────────────────
 * `no_reserved_champion` guards the PROSE. The block has its own guard: F8
 * sinks a `<scene_apres>` that names a reserved champion anywhere, and
 * `readSceneBlock` tags it `reserved_champion_leak`. A grader that only looked
 * at the prose would be green on an answer that smuggled the name into
 * `presents[].nom`, where the merge would have matched it against the
 * projection. Both are reported here, and both gate. Held by
 * `lockout.test.ts` « attrape l'alias dans la prose » and « attrape le nom
 * dans le bloc, que la prose soit propre ou non ».
 */

import { runFamily, type Check, type Grader, type GraderInput } from './kit.js';

export const LOCKOUT_IDS: readonly string[] = ['no_reserved_champion'];

function blockLeakCheck(input: GraderInput): Check {
  const leaked = input.view.reading.tags.includes('reserved_champion_leak');
  return {
    id: 'reserved_champion_block',
    passed: !leaked,
    detail: leaked
      ? 'champion réservé nommé dans <scene_apres> : bloc coulé par F8'
      : 'aucun réservé dans le bloc',
    gating: true,
  };
}

export const lockoutGrader: Grader = {
  name: 'lockout',
  ids: LOCKOUT_IDS,
  run: (input) => [...runFamily(LOCKOUT_IDS, input), blockLeakCheck(input)],
};
