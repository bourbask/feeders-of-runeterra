/**
 * The game plugin: it builds the ONE write path and decorates the instance
 * with it.
 *
 * `app.ts` registered this, empty, in M0-20 and is not reopened — that is the
 * whole reason the composition point exists, with three agents on this package
 * in one wave. Everything below is this module's own.
 *
 * WHAT IS BUILT HERE, AND WHY IT IS BUILT HERE:
 *
 *   - the ENGINE'S VIEW OF THE CONTENT (`content.ts`), once per process. The
 *     bundle is frozen and validated at start-up, and a campaign pins its
 *     version, so rebuilding it per turn would be work with no answer to
 *     change;
 *   - the STORYTELLER'S PORT, via `buildNarrator(deps.env)` in
 *     `src/ai/narrator.ts` — the only place in the server that reads the
 *     port's configuration (01-architecture.md section 2.8). That is why
 *     `AppDeps` carries `env` and not a `NarratorPort`, exactly as the header
 *     of `deps.ts` predicted;
 *   - the WRITE QUEUE, one for the process, holding one chain per campaign.
 *
 * Everything under `src/game/**` is held to the engine's rule by ESLint:
 * `new Date()` and `Math.random()` are refused here, the same as in
 * `@for/engine`. What this code needs arrives through `deps`.
 */

import { GENERATED_FILES } from '@for/content';
import fp from 'fastify-plugin';

import { buildNarrator } from '../ai/narrator.js';
import { createCampaignService } from './campaign-service.js';
import { toEngineContent } from './content.js';

import type { FallbackTemplates } from '@for/engine';
import type { FastifyPluginCallback } from 'fastify';
import type { AppPluginOptions } from '../deps.js';
import type { CampaignService } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * THE ONE WRITE PATH for game state. `ws/handlers.ts` (M0-25) routes
     * `c2s.intent` and `c2s.why` to it; `http/` never writes through anything
     * else. Optional so that a route registered before this plugin answers
     * "not ready" rather than crashing — `auth` is the only plugin registered
     * first, and it writes no game state.
     */
    campaigns?: CampaignService;
  }
}

/**
 * The deterministic fallback templates, read from the compiled bundle.
 *
 * A GAP, REPORTED RATHER THAN PAPERED OVER: `content/fallbacks/narration.json`
 * is the one file `@for/content` lists (`UNVALIDATED_PATHS`) and does not
 * SERVE — `ContentBundle` has no `fallbacks` field and `ContentRegistry` has
 * no getter, because the shape belongs to `@for/engine` and `@for/contracts`
 * holds no schema for it. So the file is read from `GENERATED_FILES`, where
 * the loader does check that it is valid JSON, and parsed against the engine's
 * own type. It belongs in the bundle; putting it there is a change to
 * `@for/content` and to the loader's four passes, which is M0-14's, not this
 * task's.
 */
const FALLBACK_FILE = 'fallbacks/narration.json';

function fallbackTemplates(): FallbackTemplates {
  const raw = GENERATED_FILES[FALLBACK_FILE];
  if (raw === undefined) {
    // LOUD, at start-up, and never a silent `{ templates: {} }`: an empty
    // template set turns every storyteller outage into a thrown
    // `FallbackTemplateMissing` in the middle of a turn, which is the one
    // place 02-mj-ia.md section 0.2 says the game must not break.
    throw new Error(`contenu incomplet : ${FALLBACK_FILE} absent du paquet compilé`);
  }
  return JSON.parse(raw) as FallbackTemplates;
}

const plugin: FastifyPluginCallback<AppPluginOptions> = (app, options, done) => {
  const { deps } = options;

  app.decorate(
    'campaigns',
    createCampaignService({
      deps: {
        connection: deps.connection,
        content: toEngineContent(deps.content),
        fallbacks: fallbackTemplates(),
        clock: deps.clock,
        rng: deps.rng,
        ids: deps.ids,
        narrator: buildNarrator(deps.env),
      },
    }),
  );

  done();
};

/**
 * WRAPPED IN `fastify-plugin`, and that is not a detail: an unwrapped plugin
 * gets its own encapsulation context, and the decorator would then be
 * invisible to `ws/` and `http/`, which are registered as siblings. The same
 * reasoning `app.ts` writes out for `auth`.
 */
export const gamePlugin = fp(plugin, { name: 'game' });
