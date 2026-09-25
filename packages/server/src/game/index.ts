/**
 * The game plugin. EMPTY UNTIL M0-24.
 *
 * It builds the `CampaignService` — the single write path for game state —
 * and the storyteller port, via `buildNarrator(deps.env)` in
 * `src/ai/narrator.ts`, the only place in the server that reads the port's
 * configuration (01-architecture.md section 2.8). That is why `AppDeps`
 * carries `env` and not a `NarratorPort`: see the header of `deps.ts`.
 *
 * Everything under `src/game/**` is held to the engine's rule by ESLint:
 * `new Date()` and `Math.random()` are refused here, the same as in
 * `@for/engine`. What this code needs arrives through `deps`.
 */

import type { FastifyPluginCallback } from 'fastify';
import type { AppPluginOptions } from '../deps.js';

export const gamePlugin: FastifyPluginCallback<AppPluginOptions> = (_app, _options, done) => {
  done();
};
