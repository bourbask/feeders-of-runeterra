/**
 * The auth plugin: cookies, the three decorators, and the CSRF hook.
 *
 * EVERY PROMISE BELOW NAMES THE TEST THAT HOLDS IT (CLAUDE.md, « une promesse
 * nomme le test qui la tient »), and all four are held by
 * `tests/http/composition.test.ts`, which builds the application through the
 * REAL `buildApp` rather than through the bench's mirror of it.
 *
 * WRAPPED IN `fastify-plugin`, ON PURPOSE AND AS `app.ts` PREDICTED. Fastify
 * encapsulates by default, so a decoration made inside a plain plugin dies
 * with its scope — and `/api/admin/health`, which `app.ts` registers as a
 * SIBLING, would never see `requireAdmin`. `app.ts` registers this plugin
 * FIRST for exactly that reason, and says so in its own header. `app.ts` is
 * not reopened by this task: everything below is registered from here. Held by
 * « ferme /api/admin/health à tout le monde sauf aux administrateurs » : that
 * route is a sibling, so it answers 401/403/200 only if the decoration really
 * reached the root.
 *
 * `@fastify/cookie` IS REGISTERED HERE TOO, not in `app.ts`, and it reaches
 * the root for the same reason: it is itself an fp-wrapped plugin, loaded
 * inside a scope that is already the root. `httpPlugin`, registered after,
 * therefore sees `request.cookies` and `reply.setCookie` without knowing where
 * they came from. Held by « applique le garde de session : 401 sans cookie,
 * 200 avec » — the 200 needs a cookie to have been parsed in another scope.
 *
 * THE DISCORD CLIENT IS AN OPTION OF THIS PLUGIN, not a field of `AppDeps`,
 * and that is the seam the tests use. `app.ts` passes `{ deps }` and gets the
 * real client built from the validated environment; a test passes
 * `{ deps, discord }` and drives the whole OAuth round trip with no socket
 * open anywhere. Adding the field to `deps.ts` would have meant reopening
 * `deps.ts` and `main.ts`, neither of which belongs to this task. Held by
 * `tests/http/oauth.test.ts`: the injected client COUNTS ITS CALLS, so « state
 * inconnu : 400, aucun joueur, aucun appel réseau » shows a flow that stopped
 * before the exchange, which a canned answer could not distinguish.
 *
 * NOTHING HERE TOUCHES THE DATABASE AT REGISTRATION TIME. `/healthz` is built
 * over a connection that throws on ANY property access and asserts the touch
 * list is empty; the expired-state purge therefore runs on the OAuth start
 * route, where a database is genuinely expected, and never at boot. Held by
 * `tests/http/health.test.ts`, « répond 200 sans jamais toucher la base ».
 */

import cookie from '@fastify/cookie';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@for/contracts';
import fp from 'fastify-plugin';

import { unauthenticated } from '../errors.js';
import { createDiscordClient } from './discord.js';
import { csrfFailed, currentPlayer, forbidden, isMutating } from './guards.js';

import type { FastifyPluginCallback } from 'fastify';
import type { AppPluginOptions } from '../deps.js';
import type { DiscordClient } from './discord.js';

export * from './discord.js';
export * from './guards.js';
export * from './session.js';

export interface AuthPluginOptions extends AppPluginOptions {
  /** Absent in production: the real client is built from `deps.env`. */
  readonly discord?: DiscordClient;
}

const plugin: FastifyPluginCallback<AuthPluginOptions> = (app, options, done) => {
  const { deps } = options;

  void app.register(cookie);

  app.decorate('discord', options.discord ?? createDiscordClient(deps.env));

  app.decorate('currentPlayer', (request) => currentPlayer(deps, request));

  app.decorate('requirePlayer', (request) => {
    const player = currentPlayer(deps, request);
    if (player === null) throw unauthenticated('aucune session valide sur la requête');
    return player;
  });

  app.decorate('requireAdmin', (request) => {
    const player = currentPlayer(deps, request);
    if (player === null) throw unauthenticated('aucune session valide sur la requête');
    if (!player.profile.isAdmin) {
      throw forbidden("Cette page est réservée à l'administration.", {
        playerId: player.profile.id,
      });
    }
  });

  /**
   * CSRF, the whole of it: the header plus `SameSite=Lax` (section 6).
   *
   * `onRequest` rather than `preHandler` so the body of a rejected mutation is
   * never even read, and on the ROOT instance so a route written next week is
   * covered without its author doing anything. Both halves are held by
   * `tests/http/session.test.ts`: « refuse AVANT de lire le corps : le crochet
   * est onRequest, pas preHandler » — a body no parser can accept still
   * answers 403 — and « couvre une route qui n'existe pas : le crochet est
   * global, pas par route ». The value, not merely the presence, of the header
   * is held by « refuse une mutation dont l'en-tête porte une AUTRE valeur ».
   */
  app.addHook('onRequest', (request, _reply, next) => {
    if (isMutating(request.method) && request.headers[CSRF_HEADER_NAME] !== CSRF_HEADER_VALUE) {
      next(csrfFailed({ method: request.method, url: request.url }));
      return;
    }
    next();
  });

  done();
};

export const authPlugin = fp(plugin, { name: 'for-auth', fastify: '5.x' });
