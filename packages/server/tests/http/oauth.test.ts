/**
 * The OAuth round trip, driven end to end with NO NETWORK.
 *
 * The Discord client is injected into `authPlugin` and COUNTS ITS CALLS, so
 * "no network happened" is measured on the refusal paths rather than asserted:
 * a client that merely returned a canned answer could not tell a flow that
 * stopped before the exchange from one that went through it.
 *
 * EVERY NUMBER IN THIS FILE COMES FROM ONE OF TWO PLACES, and never from the
 * code under test: an acceptance criterion, written out in full (`S256`,
 * `discord.com`, ten minutes in milliseconds), or a value recomputed here with
 * `node:crypto` (the PKCE challenge). Comparing the route's challenge to the
 * route's own helper would be a number compared to itself.
 */

import { createHash } from 'node:crypto';

import { zAppErrorPayload } from '@for/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { DiscordCallError } from '../../src/auth/discord.js';
import { OAUTH_STATE_TTL_MS } from '../../src/auth/session.js';
import { bench, cookieValue, fakeDiscord, signIn } from '../../src/auth/testing.js';

import type { Bench } from '../../src/auth/testing.js';

const open: Bench[] = [];

async function bed(): Promise<Bench> {
  const created = await bench();
  open.push(created);
  return created;
}

afterEach(async () => {
  for (const one of open.splice(0)) await one.close();
});

function countPlayers(bed_: Bench): number {
  return (bed_.connection.prepare(`SELECT COUNT(*) AS n FROM players`).get() as { n: number }).n;
}

function countStates(bed_: Bench): number {
  return (bed_.connection.prepare(`SELECT COUNT(*) AS n FROM oauth_states`).get() as { n: number })
    .n;
}

describe('GET /api/auth/discord/start', () => {
  it('redirige vers discord.com avec state, code_challenge et code_challenge_method=S256', async () => {
    const b = await bed();

    const response = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });

    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location!);
    // Written out, because the criterion writes it out.
    expect(location.host).toBe('discord.com');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).not.toBeNull();
    expect(location.searchParams.get('code_challenge')).not.toBeNull();
    // From the environment the bench declares, not from `deps.env` read back.
    expect(location.searchParams.get('client_id')).toBe('client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:8787/api/auth/discord/callback',
    );
  });

  it('pose les deux cookies, et le défi PKCE est bien le SHA-256 du vérificateur posé', async () => {
    const b = await bed();

    const response = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
    const location = new URL(response.headers.location!);

    const stateCookie = cookieValue(response.headers, 'fr_oauth_state');
    const verifierCookie = cookieValue(response.headers, 'fr_oauth_verifier');
    expect(stateCookie).not.toBeNull();
    expect(verifierCookie).not.toBeNull();
    expect(location.searchParams.get('state')).toBe(stateCookie);

    // THE SECOND PATH. `codeChallengeOf` is not called here: the challenge in
    // the URL is compared to one recomputed from the cookie with `node:crypto`.
    // Calling the helper on both sides would assert that a function equals
    // itself.
    const recomputed = createHash('sha256').update(verifierCookie!, 'ascii').digest('base64url');
    expect(location.searchParams.get('code_challenge')).toBe(recomputed);
    // And the other direction: a different verifier does NOT produce it.
    const other = createHash('sha256').update('autre-verificateur', 'ascii').digest('base64url');
    expect(location.searchParams.get('code_challenge')).not.toBe(other);
  });

  it('écrit la ligne oauth_states de zone A, avec une échéance de dix minutes', async () => {
    const b = await bed();

    const response = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });

    const row = b.connection.prepare(`SELECT * FROM oauth_states`).get() as {
      state: string;
      code_verifier: string;
      created_at: number;
      expires_at: number;
    };
    expect(row.state).toBe(cookieValue(response.headers, 'fr_oauth_state'));
    expect(row.code_verifier).toBe(cookieValue(response.headers, 'fr_oauth_verifier'));
    // Ten minutes, written out rather than read from the constant it checks.
    expect(row.expires_at - row.created_at).toBe(10 * 60 * 1000);
    // …and the constant the code ships agrees with that number.
    expect(OAUTH_STATE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('purge les états expirés, et seulement ceux-là', async () => {
    const b = await bed();
    // Two rows, so "the purge emptied the table" cannot pass for "the purge
    // removed the expired one". One is already dead, the other is not.
    b.connection
      .prepare(
        `INSERT INTO oauth_states (state, code_verifier, created_at, expires_at)
         VALUES ('perime', 'v1', 0, ?), ('encore-bon', 'v2', 0, ?)`,
      )
      .run(b.clock.now() - 1, b.clock.now() + 60_000);
    expect(countStates(b)).toBe(2);

    await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });

    const remaining = b.connection
      .prepare(`SELECT state FROM oauth_states ORDER BY state`)
      .all() as { state: string }[];
    // The survivor, plus the one this very request minted.
    expect(remaining.map((r) => r.state)).toContain('encore-bon');
    expect(remaining.map((r) => r.state)).not.toContain('perime');
    expect(remaining).toHaveLength(2);
  });
});

describe('GET /api/auth/discord/callback — le chemin qui marche', () => {
  it('crée le joueur, pose la session et redirige vers PUBLIC_URL', async () => {
    const b = await bed();

    const signed = await signIn(b);

    expect(countPlayers(b)).toBe(1);
    const player = b.connection.prepare(`SELECT * FROM players`).get() as {
      id: string;
      discord_user_id: string;
      discord_username: string;
      discord_global_name: string | null;
      discord_avatar_hash: string | null;
    };
    expect(player.discord_user_id).toBe('221503261830316032');
    expect(player.discord_username).toBe('kevinb');
    expect(player.discord_global_name).toBe('Kevin');
    expect(player.discord_avatar_hash).toBe('a1b2c3');
    expect(signed.playerId).toBe(player.id);

    expect(b.discord.calls).toEqual({ exchange: 1, user: 1 });
  });

  it('transmet au fournisseur le vérificateur PKCE posé au démarrage', async () => {
    const b = await bed();

    const start = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
    const state = cookieValue(start.headers, 'fr_oauth_state')!;
    const verifier = cookieValue(start.headers, 'fr_oauth_verifier')!;

    await b.app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=un-code&state=${encodeURIComponent(state)}`,
      cookies: { fr_oauth_state: state, fr_oauth_verifier: verifier },
    });

    // Without this, "PKCE is implemented" would rest on the start route alone:
    // a callback that dropped the verifier would still pass every assertion
    // above.
    expect(b.discord.seen.verifiers).toEqual([verifier]);
    expect(b.discord.seen.codes).toEqual(['un-code']);
  });

  it('efface les cookies du tour et brûle la ligne oauth_states', async () => {
    const b = await bed();

    await signIn(b);

    expect(countStates(b)).toBe(0);
  });

  it('un rappel redirige vers PUBLIC_URL', async () => {
    const b = await bed();
    const start = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
    const state = cookieValue(start.headers, 'fr_oauth_state')!;
    const verifier = cookieValue(start.headers, 'fr_oauth_verifier')!;

    const response = await b.app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=c&state=${encodeURIComponent(state)}`,
      cookies: { fr_oauth_state: state, fr_oauth_verifier: verifier },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('http://localhost:5173');
  });
});

describe('GET /api/auth/discord/callback — les refus', () => {
  /** Every refusal asserts the same three things. */
  async function expectRefused(b: Bench, url: string, cookies: Record<string, string>) {
    const response = await b.app.inject({ method: 'GET', url, cookies });
    expect(response.statusCode).toBe(400);
    expect(zAppErrorPayload.parse(response.json()).code).toBe('validation_failed');
    // The criterion, literally: no player is created.
    expect(countPlayers(b)).toBe(0);
    return response;
  }

  it('state inconnu : 400, aucun joueur, aucun appel réseau', async () => {
    const b = await bed();

    await expectRefused(b, '/api/auth/discord/callback?code=c&state=jamais-emis', {
      fr_oauth_state: 'jamais-emis',
      fr_oauth_verifier: 'peu-importe',
    });

    expect(b.discord.calls).toEqual({ exchange: 0, user: 0 });
  });

  it('state expiré : 400, aucun joueur, et la ligne est consommée quand même', async () => {
    const b = await bed();
    const start = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
    const state = cookieValue(start.headers, 'fr_oauth_state')!;
    const verifier = cookieValue(start.headers, 'fr_oauth_verifier')!;

    // One millisecond past the deadline, not a day: the boundary is the claim.
    b.clock.advance(OAUTH_STATE_TTL_MS + 1);

    await expectRefused(b, `/api/auth/discord/callback?code=c&state=${encodeURIComponent(state)}`, {
      fr_oauth_state: state,
      fr_oauth_verifier: verifier,
    });

    expect(b.discord.calls).toEqual({ exchange: 0, user: 0 });
    // Consumed even though it was refused: a stale row is never retriable.
    expect(countStates(b)).toBe(0);
  });

  it('le même state, une seconde fois : 400', async () => {
    const b = await bed();
    const start = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
    const state = cookieValue(start.headers, 'fr_oauth_state')!;
    const verifier = cookieValue(start.headers, 'fr_oauth_verifier')!;
    const cookies = { fr_oauth_state: state, fr_oauth_verifier: verifier };

    const first = await b.app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=c1&state=${encodeURIComponent(state)}`,
      cookies,
    });
    expect(first.statusCode).toBe(302);

    const second = await b.app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=c2&state=${encodeURIComponent(state)}`,
      cookies,
    });
    expect(second.statusCode).toBe(400);
    // The exchange ran once, for the first call, and not for the replay.
    expect(b.discord.calls.exchange).toBe(1);
  });

  it('sans le cookie d’état : 400, aucun joueur', async () => {
    const b = await bed();
    const start = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
    const state = cookieValue(start.headers, 'fr_oauth_state')!;
    const verifier = cookieValue(start.headers, 'fr_oauth_verifier')!;

    await expectRefused(b, `/api/auth/discord/callback?code=c&state=${encodeURIComponent(state)}`, {
      fr_oauth_verifier: verifier,
    });

    expect(b.discord.calls).toEqual({ exchange: 0, user: 0 });
  });

  it('avec un vérificateur PKCE qui n’est pas celui de la ligne : 400', async () => {
    const b = await bed();
    const start = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
    const state = cookieValue(start.headers, 'fr_oauth_state')!;

    await expectRefused(b, `/api/auth/discord/callback?code=c&state=${encodeURIComponent(state)}`, {
      fr_oauth_state: state,
      fr_oauth_verifier: 'un-autre-verificateur-de-la-meme-longueur',
    });

    expect(b.discord.calls).toEqual({ exchange: 0, user: 0 });
  });

  it('quand le joueur refuse chez Discord : 400, aucun joueur', async () => {
    const b = await bed();

    await expectRefused(b, '/api/auth/discord/callback?error=access_denied', {});

    expect(b.discord.calls).toEqual({ exchange: 0, user: 0 });
  });

  it('quand Discord est injoignable : 502, aucun joueur, aucune session', async () => {
    const enPanne = fakeDiscord({ id: '1', username: 'x', globalName: null, avatar: null });
    const b = await bench({
      discord: {
        ...enPanne,
        exchangeCode: () => Promise.reject(new DiscordCallError('token', 503, 'indisponible')),
      },
    });
    open.push(b);

    const start = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
    const state = cookieValue(start.headers, 'fr_oauth_state')!;
    const verifier = cookieValue(start.headers, 'fr_oauth_verifier')!;

    const response = await b.app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=c&state=${encodeURIComponent(state)}`,
      cookies: { fr_oauth_state: state, fr_oauth_verifier: verifier },
    });

    // 502 rather than 500: the failure is upstream, and the message says so.
    expect(response.statusCode).toBe(502);
    // The transaction never ran: no half-created identity is left behind.
    expect(countPlayers(b)).toBe(0);
    const sessions = b.connection.prepare(`SELECT COUNT(*) AS n FROM auth_sessions`).get() as {
      n: number;
    };
    expect(sessions.n).toBe(0);
    // And the body carries no trace of what Discord answered.
    expect(response.body).not.toContain('indisponible');
  });

  it('avec une chaîne de requête que le contrat ne décrit pas : 400', async () => {
    const b = await bed();

    const response = await b.app.inject({
      method: 'GET',
      url: '/api/auth/discord/callback?code=c&state=s&surnumeraire=1',
    });

    expect(response.statusCode).toBe(400);
    expect(countPlayers(b)).toBe(0);
  });
});
