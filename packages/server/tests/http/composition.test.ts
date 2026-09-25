/**
 * Two things nothing else in this folder can prove.
 *
 * 1. THE REAL `buildApp` WIRES THIS TASK IN. Every other file here drives a
 *    bench that mirrors `app.ts` so the Discord client can be injected. A
 *    mirror is only worth what the original does, so this file builds the
 *    application through the composition point ITSELF — untouched by M0-23 —
 *    and demands the three things that only `authPlugin` can provide: the
 *    cookie parser, `requirePlayer`, and the CSRF hook. If `app.ts` stopped
 *    registering the auth plugin, every other file here would stay green and
 *    this one would not.
 *
 * 2. THE CONFIGURATION STOPS THE PROCESS AND NAMES THE VARIABLE. The project
 *    owner created the Discord application but could not read its secret back
 *    — it is shown once. So no code path may assume a real value exists in
 *    development: the server refuses to boot and says which variable is
 *    missing, the way M0-20 established for the rest of the environment. That
 *    rule was never measured for the three `DISCORD_*` variables, and it is
 *    measured here.
 */

import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE, zAppErrorPayload } from '@for/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { createSession } from '../../src/auth/session.js';
import { bench, envVars } from '../../src/auth/testing.js';
import { EnvError, readEnv } from '../../src/env.js';

import type { FastifyInstance } from 'fastify';
import type { Bench } from '../../src/auth/testing.js';

const open: Bench[] = [];
const apps: FastifyInstance[] = [];

async function realApp(): Promise<{ app: FastifyInstance; bed: Bench }> {
  const bed = await bench();
  open.push(bed);
  // THE COMPOSITION POINT, not the bench's mirror of it.
  const app = await buildApp(bed.deps);
  apps.push(app);
  return { app, bed };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const one of open.splice(0)) await one.close();
});

/** A player with a session, and whether they are an administrator. */
function playerWithSession(bed: Bench, isAdmin: boolean): string {
  const id = bed.deps.ids.next();
  const now = bed.clock.now();
  bed.connection
    .prepare(
      `INSERT INTO players (id, discord_user_id, discord_username, is_admin, created_at, updated_at)
       VALUES (?, ?, 'kevinb', ?, ?, ?)`,
    )
    .run(id, `discord-${id}`, isAdmin ? 1 : 0, now, now);
  return createSession(bed.connection, { playerId: id, now }).secret;
}

describe('ce que buildApp enregistre vraiment', () => {
  it('expose les routes de la surface HTTP', async () => {
    const { app } = await realApp();

    const response = await app.inject({ method: 'GET', url: '/api/content/manifest' });

    expect(response.statusCode).toBe(200);
  });

  it('applique le garde de session : 401 sans cookie, 200 avec', async () => {
    const { app, bed } = await realApp();

    const without = await app.inject({ method: 'GET', url: '/api/me' });
    expect(without.statusCode).toBe(401);

    const secret = playerWithSession(bed, false);
    const with_ = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: secret },
    });
    // 200 also proves `@fastify/cookie` reached the ROOT instance: without
    // `fastify-plugin` around the auth plugin, `request.cookies` would be
    // undefined inside `httpPlugin`, which is a sibling scope.
    expect(with_.statusCode).toBe(200);
  });

  it('applique la règle CSRF', async () => {
    const { app } = await realApp();

    const bare = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(bare.statusCode).toBe(403);
    expect(zAppErrorPayload.parse(bare.json()).code).toBe('csrf_failed');

    const withHeader = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE },
    });
    expect(withHeader.statusCode).toBe(200);
  });

  it('ferme /api/admin/health à tout le monde sauf aux administrateurs', async () => {
    const { app, bed } = await realApp();

    // M0-20 shipped this route failing CLOSED while `requireAdmin` was absent.
    // The three directions: nobody, somebody, an administrator.
    const anonymous = await app.inject({ method: 'GET', url: '/api/admin/health' });
    expect(anonymous.statusCode).toBe(401);

    const plain = await app.inject({
      method: 'GET',
      url: '/api/admin/health',
      cookies: { fr_session: playerWithSession(bed, false) },
    });
    expect(plain.statusCode).toBe(403);
    expect(zAppErrorPayload.parse(plain.json()).code).toBe('forbidden_campaign');

    const admin = await app.inject({
      method: 'GET',
      url: '/api/admin/health',
      cookies: { fr_session: playerWithSession(bed, true) },
    });
    expect(admin.statusCode).toBe(200);
  });
});

describe('la configuration Discord s’arrête au démarrage en nommant la variable', () => {
  /** Removes one variable and returns the names the refusal points at. */
  function refusalFor(name: string): readonly string[] {
    // Rebuilt without the key rather than `delete`d out of it: `readEnv` folds
    // a blank to "absent", so an empty string would measure the same thing, and
    // a dynamic `delete` is a rule this repository turns off for nobody.
    const vars = Object.fromEntries(Object.entries(envVars()).filter(([key]) => key !== name));
    try {
      readEnv(vars);
    } catch (error) {
      if (error instanceof EnvError) return error.variables;
      throw error;
    }
    throw new Error(`readEnv a accepté une configuration sans ${name}`);
  }

  it.each([
    ['DISCORD_CLIENT_ID'],
    ['DISCORD_CLIENT_SECRET'],
    ['DISCORD_REDIRECT_URI'],
    ['SESSION_SECRET'],
  ])('%s manquante : refus, et c’est elle qui est nommée', (name) => {
    expect(refusalFor(name)).toEqual([name]);
  });

  it('traite une valeur vide comme absente : le secret non récupéré ne passe pas', () => {
    // The whole reason this test exists: `.env.example` ships
    // `DISCORD_CLIENT_SECRET=` with nothing after the sign, and a shell hands
    // that over as `''`. Booting on it would push the failure to the first
    // player who tries to sign in.
    expect(() => readEnv(envVars({ DISCORD_CLIENT_SECRET: '   ' }))).toThrow(EnvError);
  });

  it('accepte la configuration complète du banc', () => {
    // The other direction, without which the four refusals above would also
    // hold for a `readEnv` that refused everything.
    expect(() => readEnv(envVars())).not.toThrow();
  });
});
