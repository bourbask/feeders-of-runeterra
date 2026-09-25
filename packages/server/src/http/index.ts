/**
 * The HTTP plugin: the routes of 01-architecture.md section 6.
 *
 * EVERY PROMISE BELOW NAMES THE TEST THAT HOLDS IT (CLAUDE.md, « une promesse
 * nomme le test qui la tient »).
 *
 * `fastify-type-provider-zod` IS SET UP HERE, on this encapsulated instance,
 * exactly as `app.ts` says it must be — Fastify scopes both compilers, so a
 * `setValidatorCompiler` in the composition point would impose Zod on every
 * plugin including `ws/` and `game/`, which are not this task's to decide for.
 * The four route modules are registered as children of this instance and
 * inherit both compilers without knowing they exist. What a test holds is the
 * outcome: `tests/http/composition.test.ts`, « expose une route de CHACUN des
 * quatre modules de la surface HTTP », walks one route per module against the
 * REAL `buildApp` and demands no 404. That the compilers stay OUT of `ws/` and
 * `game/` is a statement about scopes M0-25 will fill, held by nothing today.
 *
 * `/healthz`, `/readyz` and `/api/admin/health` are NOT here. `app.ts`
 * registers `healthRoutes` itself so that a liveness probe never depends on
 * the plugin carrying the product's routes. Held by `tests/http/health.test.ts`,
 * « répond 200 sans jamais toucher la base », which builds those routes over a
 * tripwired connection this plugin's routes could not survive.
 *
 * WHAT ENFORCES AUTHENTICATION IS NOT THIS FILE. `app.requirePlayer` comes
 * from the auth plugin, which `app.ts` registers FIRST and which
 * `fastify-plugin` lifts to the root instance; the CSRF rule is an
 * `onRequest` hook installed there too, so it covers routes nobody has
 * written yet. This file composes; the guards live where they are installed.
 * Held by `tests/http/session.test.ts`, « couvre une route qui n'existe pas :
 * le crochet est global, pas par route » — a route this file never registered
 * answers 403, not 404.
 */

import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { authRoutes } from './auth.routes.js';
import { campaignRoutes } from './campaigns.routes.js';
import { characterRoutes } from './characters.routes.js';
import { contentRoutes } from './content.routes.js';

import type { FastifyPluginCallback } from 'fastify';
import type { AppPluginOptions } from '../deps.js';

export const httpPlugin: FastifyPluginCallback<AppPluginOptions> = (app, options, done) => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  void app.register(authRoutes, options);
  void app.register(campaignRoutes, options);
  void app.register(characterRoutes, options);
  void app.register(contentRoutes, options);

  done();
};
