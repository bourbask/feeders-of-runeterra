/**
 * The WebSocket plugin. EMPTY UNTIL M0-25.
 *
 * `hub.ts`, `connection.ts` and `handlers.ts` land here. The hub ROUTES: it
 * never calls `decide()`, never calls `reduce()`, and never builds a turn
 * proof — it asks `CampaignService` (the interface in `game/types.ts`) and
 * forwards the answer.
 */

import type { FastifyPluginCallback } from 'fastify';
import type { AppPluginOptions } from '../deps.js';

export const wsPlugin: FastifyPluginCallback<AppPluginOptions> = (_app, _options, done) => {
  done();
};
