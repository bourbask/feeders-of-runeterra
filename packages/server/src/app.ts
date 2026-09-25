/**
 * THE COMPOSITION POINT. This file is closed: it is not modified again.
 *
 * That is the whole reason it exists. Wave 7 puts three agents on this package
 * at once — M0-23 on `auth/` and `http/`, M0-24 on `game/`, M0-25 on `ws/` —
 * and a composition root everybody edits is a merge conflict everybody waits
 * on. So the four plugins are registered here, empty, today; each agent fills
 * its own module and touches nothing else.
 *
 * FOUR THINGS A LATER TASK MIGHT BE TEMPTED TO ADD HERE, AND WHERE THEY GO:
 *
 *   - a route: in the plugin that owns it, never here;
 *   - `setValidatorCompiler` / `setSerializerCompiler` for
 *     `fastify-type-provider-zod`: inside `http/index.ts`, on its own
 *     encapsulated instance. Fastify scopes both;
 *   - a decorator (`requireAdmin`, a session accessor): in `auth/index.ts`,
 *     wrapped in `fastify-plugin` so it reaches the root instance. `auth` is
 *     registered FIRST for exactly this reason;
 *   - a WebSocket upgrade: in `ws/index.ts`, with its own `@fastify/websocket`
 *     registration.
 *
 * `buildApp` DOES NOT LISTEN. It is what `app.inject()` drives in the tests
 * and what `main.ts` hands a port to — and the difference is what lets
 * `/healthz` be proven with no socket and no database.
 */

import Fastify from 'fastify';

import { authPlugin } from './auth/index.js';
import { installErrorHandling } from './errors.js';
import { gamePlugin } from './game/index.js';
import { healthRoutes } from './http/health.js';
import { httpPlugin } from './http/index.js';
import { wsPlugin } from './ws/index.js';

import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import type { AppDeps } from './deps.js';

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // Annotated rather than inferred: `loggerInstance` specialises Fastify's
  // logger type parameter to pino's concrete `Logger`, and every downstream
  // signature written against the plain `FastifyInstance` then stops
  // type-checking under `exactOptionalPropertyTypes`. Naming the option type
  // pins the generic back to `FastifyBaseLogger`, which is what a plugin sees.
  const options: FastifyServerOptions = {
    loggerInstance: deps.logger,
    // The request identifier comes from the injected source, like every other
    // identifier in the process — and it is what `AppErrorPayload.requestId`
    // carries back to the client, so an operator can join a French error
    // message in a browser to a line in the log.
    genReqId: () => deps.ids.next(),
  };
  const app = Fastify(options);

  installErrorHandling(app);

  // Order is a contract, not a style: `auth` decorates, the rest read.
  void app.register(authPlugin, { deps });
  // Health is registered by the composition point itself, NOT by `httpPlugin`:
  // a liveness probe must not depend on the plugin that carries the product's
  // routes (see `http/index.ts`).
  void app.register(healthRoutes, { deps });
  void app.register(httpPlugin, { deps });
  void app.register(wsPlugin, { deps });
  void app.register(gamePlugin, { deps });

  await app.ready();
  return app;
}
