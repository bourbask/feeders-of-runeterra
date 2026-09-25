/**
 * The four OAuth routes of 01-architecture.md section 6.
 *
 * THE ROUND TRIP IS BOUND AT THREE POINTS, and each one is a different attack:
 *
 *   1. the `oauth_states` row (zone A, ADR 0010 arbitration 6) is what proves
 *      the callback answers a start THIS SERVER issued, and it carries the
 *      deadline. It is consumed by a `DELETE … RETURNING`, so a `state`
 *      is usable exactly once;
 *   2. the `fr_oauth_state` cookie is what proves the callback reaches the
 *      SAME BROWSER the start left from. Without it, anybody holding a stolen
 *      `state` could complete somebody else's sign-in;
 *   3. the `fr_oauth_verifier` cookie is the PKCE verifier, and it is compared
 *      to the copy in the row. Section 6 and the fiche both say "state + PKCE
 *      in a cookie"; the DDL says `oauth_states.code_verifier NOT NULL`. Both
 *      are honoured rather than one being chosen: the verifier travels in the
 *      cookie AND is stored, and a mismatch between the two ends the flow.
 *      Reported as an arbitration rather than applied silently.
 *
 * NO SECRET EVER TRAVELS IN A QUERY STRING — a URL ends up in an access log,
 * in a `Referer` and in browser history. `state` is the single exception the
 * protocol forces, and it is a nonce, not a credential.
 *
 * WHAT THE ERROR PATHS ANSWER: 400, always, and never a hint about WHICH of
 * the three bindings failed. The distinction is in `details`, which
 * `errors.ts` keeps in the log.
 */

import {
  SESSION_COOKIE_NAME,
  zAuthCallbackErrorQuery,
  zAuthCallbackQuery,
  zAuthStartQuery,
  zLogoutResponse,
} from '@for/contracts';
import { getPlayerByDiscordUserId, upsertPlayer } from '@for/db';
import { z } from 'zod';

import {
  DiscordCallError,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  authorizeUrl,
  clearedCookieAttributes,
  codeChallengeOf,
  consumeOAuthState,
  createSession,
  hashIp,
  insertOAuthState,
  newSecret,
  oauthCookieAttributes,
  purgeExpiredOAuthStates,
  revokeSessionBySecret,
  secretsMatch,
  sessionCookieAttributes,
  sessionSecretOf,
} from '../auth/index.js';
import { AppError } from '../errors.js';

import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppPluginOptions } from '../deps.js';

/** 400 — the round trip does not hold together. The reason stays in the log. */
function callbackRefused(details: unknown): AppError {
  return new AppError(
    'validation_failed',
    400,
    "La connexion Discord n'a pas pu être vérifiée. Recommence depuis la page de connexion.",
    details,
  );
}

/** The cookie value, or `null` when the browser sent none. */
function cookie(request: FastifyRequest, name: string): string | null {
  const raw = request.cookies[name];
  return raw === undefined || raw === '' ? null : raw;
}

export const authRoutes: FastifyPluginCallback<AppPluginOptions> = (app, options, done) => {
  const { deps } = options;
  const routes = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Start: mint the nonce and the verifier, remember both, send the browser on.
   *
   * THE PURGE LIVES HERE, not at boot. `oauth_states` is a disposable table
   * whose only growth comes from sign-ins that were never completed, so the
   * sign-in path is exactly where it is worth a `DELETE`. Running it at plugin
   * registration would also make `/healthz` touch the database, which
   * `tests/http/health.test.ts` forbids by proof rather than by convention.
   */
  routes.get(
    '/api/auth/discord/start',
    { schema: { querystring: zAuthStartQuery } },
    (_request, reply) => {
      const now = deps.clock.now();
      purgeExpiredOAuthStates(deps.connection, now);

      const state = newSecret();
      const codeVerifier = newSecret();

      insertOAuthState(deps.connection, { state, codeVerifier, redirectTo: null, now });

      const target = authorizeUrl(deps.env, {
        state,
        codeChallenge: codeChallengeOf(codeVerifier),
      });
      void reply
        .setCookie(OAUTH_STATE_COOKIE, state, oauthCookieAttributes)
        .setCookie(OAUTH_VERIFIER_COOKIE, codeVerifier, oauthCookieAttributes)
        .redirect(target, 302);
    },
  );

  /**
   * Callback: check the three bindings, then trade the code for an identity.
   *
   * The two `oauth_*` cookies are cleared on EVERY exit OF THIS HANDLER —
   * success, refusal, upstream outage — because the clearing is written before
   * the first binding is even looked at. A verifier left in a browser is a
   * verifier that can be paired with a second stolen code.
   *
   * MEASURED, in both halves, by `tests/http/oauth.test.ts`: the success path
   * in `efface les cookies du tour et brûle la ligne oauth_states`, and every
   * refusal through its `expectRefused`, which asserts the empty value, the
   * `Max-Age=0` and the matching `Path`. Removing the two `clearCookie` calls
   * turns both red.
   *
   * The boundary, stated because it is real: a query string the CONTRACT does
   * not describe is refused by the schema, before this handler runs, so
   * nothing is cleared there. That is correct rather than a hole — no row is
   * consumed either, so the round trip is still the browser's to finish — and
   * the same test file pins it so the sentence above cannot quietly grow.
   */
  routes.get(
    '/api/auth/discord/callback',
    { schema: { querystring: z.union([zAuthCallbackQuery, zAuthCallbackErrorQuery]) } },
    async (request, reply) => {
      const now = deps.clock.now();
      const query = request.query;

      reply
        .clearCookie(OAUTH_STATE_COOKIE, clearedCookieAttributes)
        .clearCookie(OAUTH_VERIFIER_COOKIE, clearedCookieAttributes);

      if ('error' in query) {
        throw callbackRefused({ discordError: query.error });
      }

      const stateCookie = cookie(request, OAUTH_STATE_COOKIE);
      const verifierCookie = cookie(request, OAUTH_VERIFIER_COOKIE);

      // Binding 1: a row this server wrote, not yet used, not yet expired.
      // Consumed FIRST and unconditionally, so a failed attempt burns it.
      const row = consumeOAuthState(deps.connection, query.state);
      if (row === undefined) throw callbackRefused({ reason: 'state inconnu' });
      if (row.expires_at <= now) throw callbackRefused({ reason: 'state expiré' });

      // Binding 2: the same browser.
      if (stateCookie === null || !secretsMatch(stateCookie, row.state)) {
        throw callbackRefused({ reason: 'cookie d’état absent ou différent' });
      }

      // Binding 3: the PKCE verifier, in the cookie AND in the row.
      if (verifierCookie === null || !secretsMatch(verifierCookie, row.code_verifier)) {
        throw callbackRefused({ reason: 'vérificateur PKCE absent ou différent' });
      }

      // A DISCORD OUTAGE IS NOT AN INTERNAL ERROR, and it is not the player's
      // mistake either. Left to the default handler, `DiscordCallError` would
      // come back as `internal_error` with a stack in the log and a sentence
      // telling the player to try again in a moment — which is right by
      // accident and wrong by diagnosis. `AppErrorCode` has no upstream code
      // to say it properly; reported rather than invented here, since the
      // union is closed and widening it is an ADR.
      let identity;
      try {
        const tokens = await app.discord.exchangeCode({
          code: query.code,
          codeVerifier: row.code_verifier,
        });
        identity = await app.discord.fetchUser(tokens.accessToken);
      } catch (error) {
        if (error instanceof DiscordCallError) {
          throw new AppError(
            'internal_error',
            502,
            'Discord est injoignable pour le moment. Réessaie dans un instant.',
            { step: error.step, status: error.status },
            { cause: error },
          );
        }
        throw error;
      }
      const user = identity;

      // One transaction: an identity that exists without its session, or the
      // other way round, is a state nobody wrote a recovery for.
      const session = deps.connection.transaction(() => {
        upsertPlayer(deps.connection, {
          id: deps.ids.next(),
          discordUserId: user.id,
          discordUsername: user.username,
          discordGlobalName: user.globalName,
          createdAt: now,
        });
        // `PlayerInsert` carries no avatar field although the column exists and
        // `/api/me` serves it. Written straight after the upsert rather than by
        // editing `@for/db`, which belongs to another task. Reported.
        const player = getPlayerByDiscordUserId(deps.connection, user.id);
        if (player === undefined) throw new Error('upsertPlayer n’a pas écrit de joueur');
        deps.connection
          .prepare(`UPDATE players SET discord_avatar_hash = ?, updated_at = ? WHERE id = ?`)
          .run(user.avatar, now, player.id);

        // ROTATION (section 6): signing in again never reuses the cookie that
        // arrived. The old session is revoked rather than left live, so a
        // stolen cookie stops working the next time its owner signs in.
        const previous = sessionSecretOf(request);
        if (previous !== null) revokeSessionBySecret(deps.connection, previous, now);

        return createSession(deps.connection, {
          playerId: player.id,
          now,
          userAgent: request.headers['user-agent'] ?? null,
          ipHash: request.ip === '' ? null : hashIp(request.ip, deps.env.SESSION_SECRET),
        });
      })();

      return reply
        .setCookie(SESSION_COOKIE_NAME, session.secret, sessionCookieAttributes)
        .redirect(deps.env.PUBLIC_URL, 302);
    },
  );

  /**
   * Logout: revoke, then clear.
   *
   * IDEMPOTENT ON PURPOSE — 200 even with no cookie. A logout that answered
   * 401 when nobody is signed in would make "sign me out everywhere" a
   * two-outcome operation for no gain; and the CSRF hook already refuses this
   * route to anybody who cannot set a header.
   *
   * BOTH HALVES ARE ASSERTED, and the second one had to be added: deleting the
   * `clearCookie` below left the whole suite green, though a revoked cookie
   * left in the jar is re-sent on every request. `tests/http/session.test.ts`,
   * `révoque la session, et efface le cookie : la requête suivante répond
   * 401`, now reads the `Set-Cookie` back.
   */
  routes.post(
    '/api/auth/logout',
    { schema: { response: { 200: zLogoutResponse } } },
    (request, reply) => {
      const secret = sessionSecretOf(request);
      if (secret !== null) revokeSessionBySecret(deps.connection, secret, deps.clock.now());
      void reply
        .clearCookie(SESSION_COOKIE_NAME, clearedCookieAttributes)
        .status(200)
        .send({ ok: true as const });
    },
  );

  done();
};
