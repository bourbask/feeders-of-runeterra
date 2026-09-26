/**
 * What a pass reports, in its own module.
 *
 * WHY THIS IS NOT IN `validate.ts`. The fifth pass lives in
 * `validate-graph.ts` and `validate.ts` calls it; if the graph pass also read
 * its issue type from `validate.ts`, the two files would import each other and
 * `pnpm depcruise` would refuse the cycle — measured, `pas-de-cycle`, exit 1,
 * even though the back edge is `import type` and disappears at build time.
 * The rule is a good one, so the shared type moved instead of the rule bending.
 *
 * `validate.ts` re-exports both names, so nothing outside the package changed.
 */

/**
 * 1 syntax, 2 shape, 3 references, 4 global invariants, 5 THE SCENARIO GRAPH.
 *
 * Passes 1 to 4 read one document at a time (pass 4 counts them, one family at
 * a time). Pass 5 is the only one that reads TWO pieces together, and the
 * order is a guarantee, not a convention: a dead reference falls in pass 3 and
 * never in pass 5, or the report would send the reader to the wrong place.
 */
export type ContentPass = 1 | 2 | 3 | 4 | 5;

export interface ContentIssue {
  /** Root-relative path of the offending file, e.g. `champions/ashe.json`. */
  readonly file: string;
  /** Path inside the document, e.g. `startingAssets[0]`. Empty for the file itself. */
  readonly path: string;
  readonly message: string;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly pass: ContentPass;
}
