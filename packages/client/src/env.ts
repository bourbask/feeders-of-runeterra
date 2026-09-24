/**
 * The three values the browser bundle is allowed to know, validated at module
 * load (01-architecture.md section 2.9).
 *
 * NOTHING SECRET IS HERE AND NOTHING SECRET MAY COME HERE. Vite inlines every
 * `VITE_*` variable into the bundle it ships, so a key put in this file is a
 * key published on the web. The session travels in the `fr_session` cookie,
 * which the browser attaches on its own; the client never holds a token.
 *
 * EVERY VALUE HAS A DEFAULT THAT WORKS, and the defaults are the same-origin
 * ones: in production Caddy serves the SPA and the API from one origin, and in
 * development `vite.config.ts` proxies `/api` and `/ws` to Fastify so that the
 * browser still sees one. A deployment that needs another origin says so; the
 * common case configures nothing.
 */

import { z } from 'zod';

/**
 * `''` means "same origin". A trailing slash is refused rather than trimmed:
 * two spellings of one base URL is how `//api/me` reaches a log one day.
 */
const zBase = z
  .string()
  .refine((value) => !value.endsWith('/'), { message: 'sans barre oblique finale' });

export const zClientEnv = z.object({
  /** Base of the HTTP API. `''` = same origin. */
  VITE_API_BASE_URL: zBase.default(''),
  /**
   * Absolute WebSocket URL. `''` = derive it from the page's own origin, which
   * is what `websocketUrl()` does. An `http(s)://` value here would silently
   * never connect, so the scheme is checked.
   */
  VITE_WS_URL: z
    .string()
    .refine((value) => value === '' || value.startsWith('ws://') || value.startsWith('wss://'), {
      message: 'doit commencer par ws:// ou wss://',
    })
    .default(''),
});

export type ClientEnv = z.output<typeof zClientEnv>;

/**
 * Reads the environment, or throws with the list of what is wrong. Throwing at
 * load is deliberate: a misconfigured bundle must fail visibly on the first
 * screen, not on the first socket.
 */
export function readClientEnv(source: Record<string, unknown>): ClientEnv {
  const parsed = zClientEnv.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')} : ${issue.message}`)
      .join(' ; ');
    throw new Error(`Configuration du client invalide — ${details}`);
  }
  return parsed.data;
}

export const clientEnv: ClientEnv = readClientEnv(import.meta.env);

/** The socket URL, from configuration when set, from the page otherwise. */
export function websocketUrl(env: ClientEnv, origin: string, campaignId: string): string {
  const base =
    env.VITE_WS_URL === '' ? `${origin.replace(/^http/u, 'ws')}/ws` : `${env.VITE_WS_URL}/ws`;
  return `${base}?campaignId=${encodeURIComponent(campaignId)}`;
}
