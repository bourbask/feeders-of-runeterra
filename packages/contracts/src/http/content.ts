/**
 * The content surface (01-architecture.md section 6).
 *
 * `doc` IS `z.unknown()`, AND THAT IS A DECLARED HOLE, not an oversight. The
 * per-kind schemas — champion, oracle, move, price table, presage table — are
 * M0-09's (`src/content/`), and inventing a placeholder union here would
 * create a second, wrong list of content kinds that M0-09 would then have to
 * contradict. The route's SHAPE is frozen now; what fills `doc` is validated
 * by the content schemas when they land, at the loader rather than at the
 * edge, which is where a content error is actually diagnosable.
 *
 * Caching keys on `contentVersion`, which is why the document may be served
 * `immutable`: a campaign is frozen on one version, so a document at a given
 * version never changes.
 */

import { z } from 'zod';

import { zSlug } from '../primitives.js';

export const zContentManifestResponse = z.strictObject({
  contentVersion: z.string().min(1),
  /** Counts per kind. M0-09 owns the key set; this route only reports it. */
  counts: z.record(z.string(), z.number().int().nonnegative()),
  etag: z.string().min(1),
});

export const zContentDocParams = z.strictObject({ kind: zSlug, id: zSlug });

/**
 * THE DECLARED HOLE, WRITTEN DOWN. Section 2.4 requires every route to declare
 * `{ body, querystring, params, response }`; a route with no response schema at
 * all would be an undeclared hole rather than a declared one, and the two are
 * not the same thing. `z.unknown()` says "M0-09 validates this, at the loader"
 * in the one place a reader looks for the answer.
 */
export const zContentDocResponse = z.unknown();

/** Safe to cache forever: the URL is keyed on an immutable content version. */
export const CONTENT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export type ContentManifestResponse = z.output<typeof zContentManifestResponse>;
export type ContentDocParams = z.output<typeof zContentDocParams>;
export type ContentDocResponse = z.output<typeof zContentDocResponse>;
