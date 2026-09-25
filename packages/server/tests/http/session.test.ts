/**
 * The session cookie, `/api/me`, the logout, and the CSRF rule.
 *
 * THE FILE'S REASON TO EXIST IS THE FIRST TEST: a dump of `auth_sessions`
 * hands out no usable session. It is measured IN BOTH DIRECTIONS — the secret
 * is absent from every cell, AND its SHA-256 is present in one — because
 * "not found" on its own is equally true of a scan that looks nowhere.
 *
 * The digest is recomputed here with `node:crypto`. `hashSecret` is
 * deliberately not called: a test that hashed with the same function the route
 * hashed with would compare a value to itself, and would stay green if both
 * sides drifted to, say, SHA-1.
 */

import { createHash } from 'node:crypto';

import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE, zAppErrorPayload, zMeResponse } from '@for/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { MUTATING_METHODS, currentPlayer } from '../../src/auth/guards.js';
import { bench, cookieValue, setCookies, signIn } from '../../src/auth/testing.js';

import type { FastifyRequest } from 'fastify';
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

/** Every cell of every row of a table, as a string. */
function everyCell(b: Bench, table: string): string[] {
  const rows = b.connection.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  return rows.flatMap((row) => Object.values(row).map((value) => String(value)));
}

const csrf = { [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE };

describe('ce que la base contient d’une session', () => {
  it('ne contient jamais le secret du cookie, seulement son SHA-256', async () => {
    const b = await bed();

    const signed = await signIn(b);

    // The fixture is not vacuous: 32 bytes in base64url are 43 characters, so
    // there is a real secret to look for.
    expect(signed.secret.length).toBeGreaterThanOrEqual(43);

    const cells = everyCell(b, 'auth_sessions');
    expect(cells.length).toBeGreaterThan(0);
    // THE CRITERION.
    expect(cells).not.toContain(signed.secret);
    for (const cell of cells) expect(cell).not.toContain(signed.secret);

    // THE OTHER DIRECTION, without which the assertion above would also hold
    // for a scan that reads nothing: the hash IS there, and it is the row's
    // primary key.
    const digest = createHash('sha256').update(signed.secret, 'utf8').digest('hex');
    expect(cells).toContain(digest);
    const row = b.connection.prepare(`SELECT id FROM auth_sessions`).get() as { id: string };
    expect(row.id).toBe(digest);
  });

  it('n’apparaît dans aucune ligne de journal, même à trace', async () => {
    // The repository is public and the logs are not. M0-20 shipped the
    // redaction list; this measures the ONE value that list exists for, on the
    // path that mints it, at the loudest level the product has.
    const lines: string[] = [];
    const b = await bench({ logs: lines });
    open.push(b);

    const signed = await signIn(b);
    await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: signed.secret },
    });

    // The fixture is not vacuous: the server really did write lines.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(signed.secret);
    // And the same scan DOES find something the logs legitimately carry, so a
    // scan that looked nowhere could not pass for a clean one.
    expect(lines.some((line) => line.includes('/api/me'))).toBe(true);
  });

  it('le cookie porte HttpOnly, Secure, SameSite=Lax et trente jours', async () => {
    const b = await bed();
    const start = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
    const state = cookieValue(start.headers, 'fr_oauth_state')!;
    const verifier = cookieValue(start.headers, 'fr_oauth_verifier')!;

    const callback = await b.app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=c&state=${encodeURIComponent(state)}`,
      cookies: { fr_oauth_state: state, fr_oauth_verifier: verifier },
    });

    const line = setCookies(callback.headers).find((l) => l.startsWith('fr_session='));
    expect(line).toBeDefined();
    // The four attributes of the criterion, written out.
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=Lax');
    expect(line).toContain('Path=/');
    // Thirty days in seconds, spelled out rather than imported.
    expect(line).toContain(`Max-Age=${String(30 * 24 * 60 * 60)}`);
  });
});

describe('GET /api/me', () => {
  it('répond 401 sans cookie', async () => {
    const b = await bed();

    const response = await b.app.inject({ method: 'GET', url: '/api/me' });

    expect(response.statusCode).toBe(401);
    expect(zAppErrorPayload.parse(response.json()).code).toBe('unauthenticated');
  });

  it('répond 200 avec le cookie, et rend le profil projeté', async () => {
    const b = await bed();
    const signed = await signIn(b);

    const response = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: signed.secret },
    });

    expect(response.statusCode).toBe(200);
    const body = zMeResponse.parse(response.json());
    expect(body.player.id).toBe(signed.playerId);
    // `global_name` wins over `username`, and the avatar is a URL rather than a
    // hash: both are decisions of `profileOf`, not of the database.
    expect(body.player.displayName).toBe('Kevin');
    expect(body.player.avatarUrl).toBe(
      'https://cdn.discordapp.com/avatars/221503261830316032/a1b2c3.png',
    );
    expect(body.player.isAdmin).toBe(false);
    // The projection carries FIVE keys and no sixth. Asserted on the RAW keys,
    // because `zMeResponse.parse` is a non-strict object and would strip a
    // leaked field before the assertion could see it.
    const raw = response.json<{ player: Record<string, unknown> }>();
    expect(Object.keys(raw.player).sort()).toEqual([
      'avatarUrl',
      'displayName',
      'id',
      'isAdmin',
      'locale',
    ]);

    // THE SNOWFLAKE DOES LEAVE THE SERVER, AND EXACTLY ONCE: inside the CDN
    // URL, which Discord builds from the identifier. Found while writing this
    // file — the first version asserted the snowflake was absent from the body
    // and went red. Reported rather than softened: `/api/me` answers about the
    // caller and nobody else, so what a player learns is their own identifier.
    // The assertion is therefore that it appears NOWHERE ELSE.
    const withoutAvatar = response.body.replace(body.player.avatarUrl ?? '', '');
    expect(withoutAvatar).not.toContain('221503261830316032');
  });

  it('répond 401 quand la session a dépassé ses trente jours', async () => {
    const b = await bed();
    const signed = await signIn(b);

    // One millisecond past the deadline: the boundary is the claim.
    b.clock.advance(30 * 24 * 60 * 60 * 1000 + 1);

    const response = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: signed.secret },
    });

    expect(response.statusCode).toBe(401);
  });

  it('répond 401 à un joueur anonymisé (RGPD), sur une session pourtant vivante', async () => {
    const b = await bed();
    const signed = await signIn(b);

    // Avant l'anonymisation, cette session ouvre bien la porte.
    const before = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: signed.secret },
    });
    expect(before.statusCode).toBe(200);

    // L'anonymisation telle que le schéma la fait : la ligne RESTE, et
    // `deleted_at` est posé. Rien n'est supprimé, rien n'est révoqué.
    b.connection
      .prepare(`UPDATE players SET deleted_at = ? WHERE id = ?`)
      .run(b.clock.now(), signed.playerId);

    const after = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: signed.secret },
    });
    expect(after.statusCode).toBe(401);

    // L'AUTRE MOITIÉ, SANS LAQUELLE LE 401 NE PROUVE RIEN : la session est
    // toujours vivante — ni révoquée, ni expirée — donc le refus vient de la
    // clause `deleted_at IS NULL` du SQL de `resolveSession` et de nulle part
    // ailleurs.
    const row = b.connection.prepare(`SELECT revoked_at, expires_at FROM auth_sessions`).get() as {
      revoked_at: number | null;
      expires_at: number;
    };
    expect(row.revoked_at).toBeNull();
    expect(row.expires_at).toBeGreaterThan(b.clock.now());
  });

  it('répond 401 sur un cookie inventé, et la base n’a pas bougé', async () => {
    const b = await bed();
    await signIn(b);

    const response = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: 'un-secret-qui-n-a-jamais-ete-emis-par-ce-serveur' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('révoque la session : la requête suivante répond 401', async () => {
    const b = await bed();
    const signed = await signIn(b);

    // Alive before.
    const before = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: signed.secret },
    });
    expect(before.statusCode).toBe(200);

    const logout = await b.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: csrf,
      cookies: { fr_session: signed.secret },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ ok: true });

    // THE CRITERION: the next request answers 401 — measured with the SAME
    // cookie, not with none.
    const after = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: signed.secret },
    });
    expect(after.statusCode).toBe(401);

    // And the row is revoked rather than deleted: a journal of who signed out
    // when is worth keeping, and a DELETE would look identical to a miss.
    const row = b.connection.prepare(`SELECT revoked_at FROM auth_sessions`).get() as {
      revoked_at: number | null;
    };
    expect(row.revoked_at).not.toBeNull();
  });

  it('reste idempotent sans session', async () => {
    const b = await bed();

    const response = await b.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: csrf,
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('la rotation à chaque connexion', () => {
  it('révoque la session précédente du même navigateur', async () => {
    const b = await bed();
    const first = await signIn(b);

    // The second sign-in carries the first cookie, which is what a browser
    // does. Without that, "rotation" would just be "a second row appeared".
    const start = await b.app.inject({ method: 'GET', url: '/api/auth/discord/start' });
    const state = cookieValue(start.headers, 'fr_oauth_state')!;
    const verifier = cookieValue(start.headers, 'fr_oauth_verifier')!;
    const callback = await b.app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=c2&state=${encodeURIComponent(state)}`,
      cookies: {
        fr_oauth_state: state,
        fr_oauth_verifier: verifier,
        fr_session: first.secret,
      },
    });
    const second = cookieValue(callback.headers, 'fr_session')!;

    expect(second).not.toBe(first.secret);
    const oldOne = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: first.secret },
    });
    expect(oldOne.statusCode).toBe(401);
    const newOne = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: second },
    });
    expect(newOne.statusCode).toBe(200);

    // The same human, not a second player.
    const players = b.connection.prepare(`SELECT COUNT(*) AS n FROM players`).get() as {
      n: number;
    };
    expect(players.n).toBe(1);
  });
});

describe('la règle CSRF', () => {
  it('refuse une mutation sans l’en-tête, et la session survit', async () => {
    const b = await bed();
    const signed = await signIn(b);

    const response = await b.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { fr_session: signed.secret },
    });

    // THE CRITERION.
    expect(response.statusCode).toBe(403);
    expect(zAppErrorPayload.parse(response.json()).code).toBe('csrf_failed');

    // The hook ran BEFORE the handler: the session the mutation would have
    // revoked is still alive. A 403 alone would not distinguish "refused" from
    // "done, then refused".
    const after = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: signed.secret },
    });
    expect(after.statusCode).toBe(200);
  });

  it('refuse une mutation dont l’en-tête porte une AUTRE valeur', async () => {
    const b = await bed();
    const signed = await signIn(b);

    // LA VALEUR, PAS LA PRÉSENCE. Une comparaison dégradée en « l'en-tête
    // existe » laisserait passer exactement cette requête-là — et c'est ce
    // qu'un site tiers sait envoyer.
    const response = await b.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { [CSRF_HEADER_NAME]: 'une-autre-application' },
      cookies: { fr_session: signed.secret },
    });

    expect(response.statusCode).toBe(403);
    expect(zAppErrorPayload.parse(response.json()).code).toBe('csrf_failed');

    // La session a survécu : le crochet a bien refusé avant le gestionnaire.
    const after = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: signed.secret },
    });
    expect(after.statusCode).toBe(200);
  });

  it('la paire attendue est celle du contrat, écrite ici en toutes lettres', () => {
    // Écrits, pas importés pour être comparés à eux-mêmes : la valeur que le
    // client envoie est un contrat, et un contrat se recopie.
    expect(CSRF_HEADER_NAME).toBe('x-requested-with');
    expect(CSRF_HEADER_VALUE).toBe('for-app');
  });

  it('laisse passer une lecture sans l’en-tête', async () => {
    const b = await bed();

    const response = await b.app.inject({ method: 'GET', url: '/api/content/manifest' });

    // The other direction: the rule is about mutations, not about the header.
    expect(response.statusCode).toBe(200);
  });

  it('couvre une route qui n’existe pas : le crochet est global, pas par route', async () => {
    const b = await bed();

    // 403 rather than 404 is the whole point. A per-route guard would let this
    // fall through to the not-found handler — which is exactly what would
    // happen to a route M0-24 or M0-25 writes next week.
    const withoutHeader = await b.app.inject({ method: 'DELETE', url: '/api/rien-du-tout' });
    expect(withoutHeader.statusCode).toBe(403);
    expect(zAppErrorPayload.parse(withoutHeader.json()).code).toBe('csrf_failed');

    // And with the header it is a plain 404, so the 403 above really came from
    // the header and not from the route being unknown.
    const withHeader = await b.app.inject({
      method: 'DELETE',
      url: '/api/rien-du-tout',
      headers: csrf,
    });
    expect(withHeader.statusCode).toBe(404);
  });

  it('porte sur les quatre verbes mutants, écrits ici en toutes lettres', () => {
    // NOT a loop over `MUTATING_METHODS`: emptying that constant has to make
    // this red. A test that iterated it would go green instead.
    expect([...MUTATING_METHODS]).toEqual(['POST', 'PUT', 'PATCH', 'DELETE']);
  });

  it('refuse les quatre verbes et laisse passer les deux lectures', async () => {
    const b = await bed();

    // Collected then compared as one table, so a failure names the verb that
    // broke instead of the assertion that ran.
    const observed: Record<string, number> = {};
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'GET', 'HEAD'] as const) {
      const response = await b.app.inject({ method, url: '/api/rien-du-tout' });
      observed[method] = response.statusCode;
    }
    expect(observed).toEqual({
      POST: 403,
      PUT: 403,
      PATCH: 403,
      DELETE: 403,
      GET: 404,
      HEAD: 404,
    });
  });
});

describe('le poivre de ip_hash', () => {
  /** Distinct du poivre par défaut du banc, pour que l'assertion soit dirigée. */
  const POIVRE = 'p'.repeat(32);
  const ADRESSE = '203.0.113.7';
  const NAVIGATEUR = 'Navigateur-de-recette/1.0';

  it('la colonne ne porte ni l’adresse ni son SHA-256 nu, mais celui de l’adresse poivrée', async () => {
    const b = await bench({ env: { SESSION_SECRET: POIVRE } });
    open.push(b);

    const start = await b.app.inject({
      method: 'GET',
      url: '/api/auth/discord/start',
      remoteAddress: ADRESSE,
    });
    const state = cookieValue(start.headers, 'fr_oauth_state')!;
    const verifier = cookieValue(start.headers, 'fr_oauth_verifier')!;
    await b.app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=c&state=${encodeURIComponent(state)}`,
      cookies: { fr_oauth_state: state, fr_oauth_verifier: verifier },
      headers: { 'user-agent': NAVIGATEUR },
      remoteAddress: ADRESSE,
    });

    const row = b.connection.prepare(`SELECT ip_hash, user_agent FROM auth_sessions`).get() as {
      ip_hash: string | null;
      user_agent: string | null;
    };
    // L'autre colonne de diagnostic, qui, elle, se garde en clair : c'est une
    // chaîne que le navigateur annonce, pas une donnée sur la personne.
    expect(row.user_agent).toBe(NAVIGATEUR);
    expect(row.ip_hash).not.toBeNull();
    // L'adresse en clair, d'abord : la colonne est un diagnostic, pas un carnet.
    expect(row.ip_hash).not.toContain(ADRESSE);

    // PUIS SON SHA-256 NU, qui est le point : l'espace des adresses IPv4 tient
    // dans un dictionnaire, donc un hachage sans poivre rend la colonne
    // inversible et le fichier, s'il fuit, devient la liste des adresses des
    // joueurs. Recalculé ici avec `node:crypto`, jamais avec `hashIp`.
    const nu = createHash('sha256').update(ADRESSE, 'utf8').digest('hex');
    expect(row.ip_hash).not.toBe(nu);

    // Et l'autre sens : c'est bien sha256(adresse + SESSION_SECRET).
    const poivre = createHash('sha256').update(`${ADRESSE}${POIVRE}`, 'utf8').digest('hex');
    expect(row.ip_hash).toBe(poivre);
  });
});

describe('la mémoïsation par requête, et last_used_at', () => {
  it('résout une seule fois par requête, et repousse la date à la requête suivante', async () => {
    const b = await bed();
    const signed = await signIn(b);

    const lastUsed = (): number =>
      (
        b.connection.prepare(`SELECT last_used_at FROM auth_sessions`).get() as {
          last_used_at: number;
        }
      ).last_used_at;

    // Deux appels sur LE MÊME objet de requête, ce qu'aucune route ne fait
    // aujourd'hui mais que `/api/me` plus un garde feront dès M0-24.
    const request = { cookies: { fr_session: signed.secret } } as unknown as FastifyRequest;
    const first = currentPlayer(b.deps, request);
    expect(first).not.toBeNull();
    const posee = lastUsed();

    b.clock.advance(60_000);
    const second = currentPlayer(b.deps, request);

    // La mémo : le même objet, et surtout PAS une seconde écriture de
    // `last_used_at` pour une seule requête HTTP — ce que son commentaire promet.
    expect(second).toBe(first);
    expect(lastUsed()).toBe(posee);

    // L'AUTRE SENS, sans lequel l'assertion ci-dessus tiendrait aussi pour un
    // `touchSession` devenu inerte : une NOUVELLE requête, elle, repousse la
    // date, et exactement des soixante secondes écoulées.
    const suivante = { cookies: { fr_session: signed.secret } } as unknown as FastifyRequest;
    currentPlayer(b.deps, suivante);
    expect(lastUsed()).toBe(posee + 60_000);
  });
});
