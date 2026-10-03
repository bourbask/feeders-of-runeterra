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
 *   - the STORYTELLER'S PORT, via `buildNarrator(deps.env, selectNarrator)` in
 *     `src/ai/narrator.ts` — the only place in the server that reads the
 *     port's configuration (01-architecture.md section 2.8). That is why
 *     `AppDeps` carries `env` and not a `NarratorPort`, exactly as the header
 *     of `deps.ts` predicted. THE SECOND ARGUMENT IS THE WHOLE WIRING: without
 *     it `buildNarrator` falls back to the server's own `builtinSelector`,
 *     which knows `stub` and nothing else, so every other value of
 *     `NARRATOR_PROVIDER` yielded a port that raises `unavailable` on its
 *     first call and NO SOCKET WAS EVER OPENED TOWARDS A MODEL. Nothing went
 *     red, because the pipeline's fallback is good: the turn still resolved
 *     and the engine's sentence still reached the table. Held by
 *     `tests/game/narrator-wiring.test.ts`, which names the provider the
 *     server composes for each configuration;
 *   - the WRITE QUEUE, one for the process, holding one chain per campaign.
 *
 * Everything under `src/game/**` is held to the engine's rule by ESLint:
 * `new Date()` and `Math.random()` are refused here, the same as in
 * `@for/engine`. What this code needs arrives through `deps`.
 */

import { selectNarrator } from '@for/ai';
import { GENERATED_FILES } from '@for/content';
import fp from 'fastify-plugin';

import { createJournalDelivery } from './delivery.js';

import { NarrationDispatcher } from '../ai/broadcast.js';
import { buildNarrator } from '../ai/narrator.js';
import { createTurnRunner } from '../ai/turn-runner.js';
import { createTableHub } from '../ws/index.js';
import { createCampaignService } from './campaign-service.js';
import { toEngineContent } from './content.js';

import type { NarratorPort } from '@for/contracts';
import type { FallbackTemplates } from '@for/engine';
import type { FastifyPluginCallback } from 'fastify';
import type { AppPluginOptions } from '../deps.js';
import type { TableHub } from '../ws/hub.js';
import type { CampaignService, EventDelivery } from './types.js';

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
    /** Who is connected, and who receives what. Read per request by `ws/`. */
    tableHub?: TableHub;
    /** The narration buffer: one generation per campaign, many readers. */
    narration?: NarrationDispatcher;
    /** How a committed entry reaches a socket: by sequence, from the journal. */
    delivery?: EventDelivery;
    /**
     * THE PORT THE PROCESS ACTUALLY COMPOSED, built once at start-up.
     *
     * Decorated for one reason: which provider a configuration ends up with was
     * invisible from outside this file, and that is how `buildNarrator(env)`
     * sat here unwired from M0-24 to M0-30 with nothing red. Read by
     * `tests/game/narrator-wiring.test.ts`; nothing in production reads it.
     */
    narrator?: NarratorPort;
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

/**
 * THE RUNTIME OF ONE PROCESS, composed in one place.
 *
 * ── THE ONE CYCLE, AND HOW IT IS CUT ─────────────────────────────────────
 * `TableHub` is built from the `CampaignService`. The service's storyteller
 * (`ai/turn-runner.ts`) delivers what it writes through `JournalDelivery`.
 * `JournalDelivery` broadcasts through the hub. Something has to be named
 * late, and `JournalDeliveryDeps.hub` is a thunk for exactly that — see its
 * own header. Nothing below is reachable before this function returns.
 *
 * ── WHY THE HUB AND THE DISPATCHER ARE DECORATORS ────────────────────────
 * `app.ts` registers `wsPlugin` BEFORE this one and is closed. A WebSocket
 * route therefore cannot read these at REGISTRATION time, and does not need
 * to: it reads them per request, by which point this plugin has run. The same
 * reasoning `app.ts` writes out for `campaigns`.
 */
const plugin: FastifyPluginCallback<AppPluginOptions> = (app, options, done) => {
  const { deps } = options;

  const dispatcher = new NarrationDispatcher();

  /**
   * ONE PORT, BUILT ONCE, AND `selectNarrator` IS THE ARGUMENT THAT MAKES IT
   * REAL. `@for/ai` owns the four implementations; the server owns the
   * configuration. Two calls to `buildNarrator` would also have built two
   * ports for one process, which is not what `narrator.ts` promises.
   */
  const narrator = buildNarrator(deps.env, selectNarrator);

  // Named late, on purpose. See the header.
  let hub: TableHub | null = null;
  const delivery = createJournalDelivery({
    connection: deps.connection,
    hub: () => {
      if (hub === null) throw new Error('hub de table lu avant sa composition');
      return hub;
    },
  });

  const service = createCampaignService({
    deps: {
      connection: deps.connection,
      content: toEngineContent(deps.content),
      fallbacks: fallbackTemplates(),
      clock: deps.clock,
      rng: deps.rng,
      ids: deps.ids,
      narrator,
      /**
       * THE REAL STORYTELLER, finally called. Before M0-30 the intent path
       * went through `intent-pipeline.ts`'s placeholder and
       * `runNarrationTurn` had no caller at all.
       */
      narrateTurn: createTurnRunner({
        connection: deps.connection,
        content: deps.content,
        narrator,
        ids: deps.ids,
        clock: deps.clock,
        logger: deps.logger,
        dispatcher,
        delivery,
        fallbacks: fallbackTemplates(),
        rng: deps.rng,
      }),
    },
  });

  hub = createTableHub(service, dispatcher);

  app.decorate('campaigns', service);
  app.decorate('tableHub', hub);
  app.decorate('narration', dispatcher);
  app.decorate('delivery', delivery);
  app.decorate('narrator', narrator);

  done();
};

/**
 * WRAPPED IN `fastify-plugin`, and that is not a detail: an unwrapped plugin
 * gets its own encapsulation context, and the decorator would then be
 * invisible to `ws/` and `http/`, which are registered as siblings. The same
 * reasoning `app.ts` writes out for `auth`.
 */
export const gamePlugin = fp(plugin, { name: 'game' });
