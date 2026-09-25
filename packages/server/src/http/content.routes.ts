/**
 * The content surface (01-architecture.md section 6).
 *
 * ONE TABLE, TWO USES. `KINDS` is what `/api/content/manifest` counts AND what
 * `/api/content/:kind/:id` resolves; a kind that the manifest announces is
 * therefore, by construction, a kind that can be fetched. Two hand-kept lists
 * would be two places to forget, and the one that drifts is always the one
 * nobody reads.
 *
 * `tests/http/content.test.ts` writes the six kinds out IN FULL and compares
 * its own literal list to `Object.keys(KINDS)`. It does not loop over `KINDS`
 * to check `KINDS`: emptying the table has to make a test red, and a test that
 * iterates the thing it verifies goes green instead — the sixth failure mode
 * of `docs/RECETTE.md`.
 *
 * THE CACHING RULE IS NOT DECORATIVE. A document URL is keyed on a content
 * version, and a campaign is frozen on one version (03-donnees.md section
 * 4.8), so a document at a given version never changes and may be served
 * `immutable`. The MANIFEST, which is how a client learns the current version,
 * is exactly the response that must NOT be: it carries an `ETag` and
 * `no-cache`, so a browser revalidates and gets a 304 when nothing moved.
 */

import { contentVersion } from '@for/content';
import {
  CONTENT_CACHE_CONTROL,
  zContentDocParams,
  zContentDocResponse,
  zContentManifestResponse,
} from '@for/contracts';
import { z } from 'zod';

import { AppError } from '../errors.js';

import type { ContentBundle } from '@for/content';
import type { FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppPluginOptions } from '../deps.js';

/** 404 — no such kind, or no such document in that kind. */
export function contentNotFound(details?: unknown): AppError {
  return new AppError('content_not_found', 404, "Cette fiche de contenu n'existe pas.", details);
}

/**
 * The kinds this server serves, by the folder name they live under in
 * `content/`. The URL segment IS the folder, so a reader can go from a 404 to
 * the file without a lookup table.
 */
export const KINDS = {
  champions: (b: ContentBundle) => b.champions,
  moves: (b: ContentBundle) => b.moves,
  oracles: (b: ContentBundle) => b.oracles,
  regions: (b: ContentBundle) => b.regions,
  assets: (b: ContentBundle) => b.assets,
  conditions: (b: ContentBundle) => b.conditions,
} as const;

export type ContentKind = keyof typeof KINDS;

function isKind(value: string): value is ContentKind {
  return Object.hasOwn(KINDS, value);
}

export const contentRoutes: FastifyPluginCallback<AppPluginOptions> = (app, options, done) => {
  const { deps } = options;
  const routes = app.withTypeProvider<ZodTypeProvider>();

  /**
   * The manifest is PUBLIC: it says which version of the rules and of the
   * content a deployment runs, which is the first thing a player needs before
   * they have an account. No session is required, and none is read.
   */
  routes.get(
    '/api/content/manifest',
    // `304: z.undefined()` is not decoration, and `z.null()` is WRONG here —
    // measured: it serialises the four characters `null` into a 304, which RFC
    // 9110 says carries no body at all. The entry is needed because without it
    // the type provider narrows `reply.status` to 200 and the revalidation
    // branch does not compile.
    { schema: { response: { 200: zContentManifestResponse, 304: z.undefined() } } },
    (request, reply) => {
      const bundle = deps.content.bundle;
      const version = contentVersion(bundle.version, bundle.hash);
      const etag = `"${version}"`;

      if (request.headers['if-none-match'] === etag) {
        void reply
          .header('etag', etag)
          .header('cache-control', 'no-cache')
          .status(304)
          .send(undefined);
        return;
      }

      const counts: Record<string, number> = {};
      for (const [kind, mapOf] of Object.entries(KINDS)) {
        counts[kind] = mapOf(bundle).size;
      }

      void reply
        .header('etag', etag)
        .header('cache-control', 'no-cache')
        .status(200)
        .send({ contentVersion: version, counts, etag });
    },
  );

  routes.get(
    '/api/content/:kind/:id',
    { schema: { params: zContentDocParams, response: { 200: zContentDocResponse } } },
    (request, reply) => {
      const { kind, id } = request.params;
      if (!isKind(kind)) throw contentNotFound({ kind });

      const document = KINDS[kind](deps.content.bundle).get(id);
      if (document === undefined) throw contentNotFound({ kind, id });

      void reply.header('cache-control', CONTENT_CACHE_CONTROL).status(200).send(document);
    },
  );

  done();
};
