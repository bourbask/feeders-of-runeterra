/**
 * Discord OAuth and the session cookie (01-architecture.md section 6).
 *
 * NOTHING SECRET TRAVELS IN A QUERY STRING. `state` and the PKCE verifier live
 * in `HttpOnly` cookies for the length of the round trip, so
 * `/api/auth/discord/start` takes no parameters at all — an empty strict
 * object, which is a statement rather than an oversight. The WebSocket handshake
 * authenticates by the same cookie for the same reason: section 5 forbids a
 * token in the URL, because a URL ends up in logs and referrers.
 *
 * CSRF is the header plus `SameSite=Lax`, not a token: there is no cross-site
 * form in the product, and a header a browser will not set cross-origin is the
 * cheapest thing that actually holds.
 */

import { z } from 'zod';

export const SESSION_COOKIE_NAME = 'fr_session';
/** 30 days, rotated on every sign-in. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Mutations require this header. Lower-case: that is how a server reads it. */
export const CSRF_HEADER_NAME = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'for-app';

/** CORS is off in production (same origin via Caddy); in development, this one. */
export const DEV_ALLOWED_ORIGIN = 'http://localhost:5173';

/** No parameters: `state` and the PKCE verifier are set as `HttpOnly` cookies. */
export const zAuthStartQuery = z.strictObject({});

/** What Discord sends back on success. */
export const zAuthCallbackQuery = z.strictObject({
  code: z.string().min(1),
  state: z.string().min(1),
});

/**
 * What Discord sends back on refusal. A separate schema rather than a pile of
 * optional fields: "the user said no" and "here is your code" are different
 * answers, and a single loose object would let one be mistaken for the other.
 */
export const zAuthCallbackErrorQuery = z.strictObject({
  error: z.string().min(1),
  error_description: z.string().optional(),
  state: z.string().optional(),
});

export const zLogoutResponse = z.strictObject({ ok: z.literal(true) });

export const zCsrfHeaders = z.object({
  [CSRF_HEADER_NAME]: z.literal(CSRF_HEADER_VALUE),
});

export type AuthCallbackQuery = z.output<typeof zAuthCallbackQuery>;
export type AuthCallbackErrorQuery = z.output<typeof zAuthCallbackErrorQuery>;
export type LogoutResponse = z.output<typeof zLogoutResponse>;
