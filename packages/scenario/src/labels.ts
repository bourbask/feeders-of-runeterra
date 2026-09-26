/**
 * The French one-liners a candidate carries, for the three closed lists the
 * ENGINE owns.
 *
 * ── WHY A RECORD AND NOT A `switch` ──────────────────────────────────────
 * `Record<Disposition, string>` is total by construction: a fifth disposition
 * in the engine stops this file compiling. The pair of tests in
 * `labels.test.ts` closes the other direction — they WALK
 * `DispositionSchema.options` and `RankSchema.options` rather than pinning a
 * list of their own, so emptying the record drops a key and reddens them.
 *
 * These are the only three lists this package renders in French, and none of
 * them is retyped: `.options` and `.def.values` enumerate the mirror S-01
 * already guards member by member (`tests/exhaustive-union.test.ts`).
 */

import type { Disposition, Rank, SegmentCount } from '@for/contracts';

/** How a figure stands towards the party. Engine tuple, French gloss. */
export const DISPOSITION_LABELS: Readonly<Record<Disposition, string>> = {
  allie: 'alliée',
  neutre: 'neutre',
  hostile: 'hostile',
  inconnu: 'inconnue',
};

/** The rank of the vow a ressort becomes, and what it costs to fill. */
export const RANK_LABELS: Readonly<Record<Rank, string>> = {
  genant: 'gênant',
  dangereux: 'dangereux',
  redoutable: 'redoutable',
  extreme: 'extrême',
  epique: 'épique',
};

/** « horloge à 6 segments ». The count comes from the front, never from here. */
export function segmentsLabel(segments: SegmentCount): string {
  return `horloge à ${String(segments)} segments`;
}
