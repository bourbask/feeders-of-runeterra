/**
 * The HTTP plugin. EMPTY UNTIL M0-23.
 *
 * The routes of 01-architecture.md section 6 land here — auth, campaigns,
 * characters, content — each in its own `*.routes.ts` file.
 *
 * `/healthz`, `/readyz` and `/api/admin/health` do NOT: `app.ts` registers
 * `healthRoutes` itself, so that the health probes keep answering even if this
 * plugin is later gated, reordered or made conditional. A liveness probe that
 * depends on the plugin carrying the application's routes is a liveness probe
 * that lies exactly when it matters.
 *
 * `fastify-type-provider-zod` is set up HERE, with `setValidatorCompiler` and
 * `setSerializerCompiler` on this encapsulated instance — not in `app.ts`,
 * which is closed.
 */

import type { FastifyPluginCallback } from 'fastify';
import type { AppPluginOptions } from '../deps.js';

export const httpPlugin: FastifyPluginCallback<AppPluginOptions> = (_app, _options, done) => {
  done();
};
