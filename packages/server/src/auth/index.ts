/**
 * The auth plugin. EMPTY UNTIL M0-23.
 *
 * It exists now so `app.ts` — the composition point — can be written once and
 * never reopened: three agents fill `auth/`, `ws/` and `game/` in parallel in
 * wave 7, and a shared `app.ts` would serialise them behind one merge.
 *
 * REGISTERED FIRST, and that is not alphabetical. M0-23 decorates the instance
 * with `requireAdmin` (see `deps.ts`), and `/api/admin/health` reads that
 * decorator: whoever installs a decorator has to be registered before whoever
 * reads it. A decorator that reaches the ROOT instance needs `fastify-plugin`
 * around this export — Fastify encapsulates by default, and a decoration made
 * inside an encapsulated plugin dies with its scope.
 */

import type { FastifyPluginCallback } from 'fastify';
import type { AppPluginOptions } from '../deps.js';

export const authPlugin: FastifyPluginCallback<AppPluginOptions> = (_app, _options, done) => {
  done();
};
