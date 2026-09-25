/**
 * `createDiscordClient` — the only code in this server that really talks to
 * Discord — driven through its `fetch` PARAMETER, with no network at all.
 *
 * WHY THIS FILE EXISTS, WRITTEN OUT BECAUSE IT WAS FOUND THE HARD WAY. The
 * round trip in `oauth.test.ts` runs against `fakeDiscord`, which replaces
 * this client WHOLE. Every assertion there is therefore blind to what the real
 * client puts on the wire, and four ways of breaking the sign-in left the
 * ninety-two tests green: the PKCE verifier replaced by any string, the
 * `client_secret` line deleted from the POST body, the refusal on a non-`ok`
 * answer deleted, and the `Bearer` header deleted from `/users/@me`. Each of
 * those four is an assertion below.
 *
 * NO NETWORK, AND IT IS MEASURED RATHER THAN PROMISED: the fake `fetch` keeps
 * every URL and every `init` it saw, and each test compares the WHOLE list of
 * URLs — so a step that fired twice, or fired when it should not have, fails
 * here. `globalThis.fetch` is never touched.
 *
 * EVERY VALUE COMPARED HERE IS SPELLED OUT IN THIS FILE — the client
 * identifier, the secret, the redirect URI, the verifier, the access token,
 * the two endpoints. None is read back from `env` or from the module under
 * test: two operands that come from the same definition assert nothing.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { DiscordCallError, createDiscordClient } from '../../src/auth/discord.js';
import { envVars } from '../../src/auth/testing.js';
import { readEnv } from '../../src/env.js';

import type { FetchLike } from '../../src/auth/discord.js';

/** The two endpoints, written out. The module's constants are not imported. */
const TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';
const USER_URL = 'https://discord.com/api/v10/users/@me';

const CLIENT_ID = 'application-quarante-deux';
const CLIENT_SECRET = 'le-secret-que-seul-le-serveur-connait';
const REDIRECT_URI = 'https://exemple.test/api/auth/discord/callback';
const CODE = 'le-code-a-usage-unique';
const VERIFIER = 'le-verificateur-pkce-de-ce-tour';
const ACCESS_TOKEN = 'jeton-rendu-par-discord';

const env = readEnv(
  envVars({
    DISCORD_CLIENT_ID: CLIENT_ID,
    DISCORD_CLIENT_SECRET: CLIENT_SECRET,
    DISCORD_REDIRECT_URI: REDIRECT_URI,
  }),
);

interface Answer {
  readonly status: number;
  readonly body?: unknown;
  /** Un corps qui n'est PAS du JSON — une page d'erreur d'un intermédiaire. */
  readonly raw?: string;
}

/** What the client actually put on the wire, in order. */
interface Wire {
  readonly urls: string[];
  readonly inits: RequestInit[];
}

/**
 * A `fetch` that answers from a SCRIPT and records what it was asked.
 *
 * The script is exhausted rather than repeated on purpose: a client that
 * called a step twice — a retry, which the module's header says must not exist
 * because an authorisation code is single-use — throws here instead of quietly
 * getting the same answer again.
 */
function scriptedFetch(answers: readonly Answer[]): { fetchImpl: FetchLike; wire: Wire } {
  const wire: Wire = { urls: [], inits: [] };
  let index = 0;
  const fetchImpl: FetchLike = (input, init) => {
    wire.urls.push(input);
    wire.inits.push(init);
    const answer = answers[index];
    index += 1;
    if (answer === undefined) {
      throw new Error(`appel ${String(index)} : le script du faux fetch est épuisé`);
    }
    return Promise.resolve(
      answer.raw === undefined
        ? new Response(JSON.stringify(answer.body), {
            status: answer.status,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(answer.raw, {
            status: answer.status,
            headers: { 'content-type': 'text/html' },
          }),
    );
  };
  return { fetchImpl, wire };
}

const TOKEN_OK: Answer = {
  status: 200,
  body: {
    access_token: ACCESS_TOKEN,
    token_type: 'Bearer',
    expires_in: 604_800,
    scope: 'identify',
    refresh_token: 'jeton-de-rafraichissement',
  },
};

const USER_OK: Answer = {
  status: 200,
  body: {
    id: '221503261830316032',
    username: 'kevinb',
    global_name: 'Kevin',
    avatar: 'a1b2c3',
  },
};

/** Le corps du POST, qui est TOUJOURS une chaîne urlencodée ici. */
function bodyOf(init: RequestInit | undefined): URLSearchParams {
  const body = init?.body;
  if (typeof body !== 'string') {
    throw new Error(`le corps du POST n'est pas une chaîne : ${typeof body}`);
  }
  return new URLSearchParams(body);
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

/** The refusal this client raises, or an explicit failure. */
async function refusalOf(run: () => Promise<unknown>): Promise<DiscordCallError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DiscordCallError) return error;
    throw error;
  }
  throw new Error('le client a accepté une réponse que Discord a refusée');
}

/**
 * `globalThis.fetch` IS POISONED FOR THE WHOLE FILE, and the poison is itself
 * an assertion (last test below): a client built WITHOUT the parameter really
 * does reach for the global, which is what makes "the seam is `fetchImpl`" a
 * measured statement instead of a claim about a default argument.
 */
const realFetch = globalThis.fetch;
const POISON = 'ACCÈS RÉSEAU INTERDIT dans discord-client.test.ts';
globalThis.fetch = () => {
  throw new Error(POISON);
};
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('createDiscordClient — l’échange du code', () => {
  it('poste sur le point de terminaison du jeton, en formulaire', async () => {
    const { fetchImpl, wire } = scriptedFetch([TOKEN_OK]);

    await createDiscordClient(env, fetchImpl).exchangeCode({ code: CODE, codeVerifier: VERIFIER });

    // THE WHOLE LIST: un seul appel, et c'est celui-là.
    expect(wire.urls).toEqual([TOKEN_URL]);
    expect(wire.inits[0]?.method).toBe('POST');
    expect(headersOf(wire.inits[0])['content-type']).toBe('application/x-www-form-urlencoded');
    // …ET LE CORPS EST VRAIMENT ENCODÉ AINSI, lu sur la CHAÎNE BRUTE. `bodyOf`
    // décode, exactement comme `searchParams.get` : il ne peut pas témoigner
    // de l'encodage que l'en-tête ci-dessus annonce, et une concaténation qui
    // poserait `redirect_uri=https://exemple.test/…` lui serait invisible.
    // Écrit en toutes lettres : `encodeURIComponent` n'est pas appelé ici.
    expect(wire.inits[0]?.body).toContain(
      'redirect_uri=https%3A%2F%2Fexemple.test%2Fapi%2Fauth%2Fdiscord%2Fcallback',
    );
    expect(wire.inits[0]?.body).not.toContain('redirect_uri=https://');
  });

  it('porte le secret client, le grant_type et LE vérificateur reçu en entrée', async () => {
    const { fetchImpl, wire } = scriptedFetch([TOKEN_OK]);

    await createDiscordClient(env, fetchImpl).exchangeCode({ code: CODE, codeVerifier: VERIFIER });

    const body = bodyOf(wire.inits[0]);
    // Les quatre lignes du corps, comparées à des littéraux de ce fichier.
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('client_secret')).toBe(CLIENT_SECRET);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(body.get('code')).toBe(CODE);
    // PKCE SUR LE FIL : le vérificateur transmis est celui de l'appelant, et
    // pas une valeur que ce module aurait fabriquée de son côté.
    expect(body.get('code_verifier')).toBe(VERIFIER);
  });

  it('rend le jeton, la durée et la portée que Discord a répondus', async () => {
    const { fetchImpl } = scriptedFetch([TOKEN_OK]);

    const tokens = await createDiscordClient(env, fetchImpl).exchangeCode({
      code: CODE,
      codeVerifier: VERIFIER,
    });

    expect(tokens).toEqual({
      accessToken: ACCESS_TOKEN,
      refreshToken: 'jeton-de-rafraichissement',
      expiresIn: 604_800,
      scope: 'identify',
    });
  });

  it('rend null plutôt qu’une chaîne vide sur un rafraîchissement absent', async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: { access_token: ACCESS_TOKEN, refresh_token: '', expires_in: 'plus tard' },
      },
    ]);

    const tokens = await createDiscordClient(env, fetchImpl).exchangeCode({
      code: CODE,
      codeVerifier: VERIFIER,
    });

    expect(tokens.refreshToken).toBeNull();
    // Un `expires_in` qui n'est pas un nombre ne devient pas `NaN` en aval.
    expect(tokens.expiresIn).toBe(0);
    expect(tokens.scope).toBe('');
  });
});

describe('createDiscordClient — les refus de l’échange', () => {
  it('lève l’erreur avec son étape, et garde le corps de Discord dans details', async () => {
    const { fetchImpl, wire } = scriptedFetch([
      { status: 401, body: { error: 'invalid_grant', error_description: 'code déjà consommé' } },
    ]);
    const client = createDiscordClient(env, fetchImpl);

    const refusal = await refusalOf(() =>
      client.exchangeCode({ code: CODE, codeVerifier: VERIFIER }),
    );

    expect(refusal.step).toBe('token');
    expect(refusal.status).toBe(401);
    // Ce que Discord a dit va dans `details`, que `errors.ts` garde hors du fil
    // — et JAMAIS dans le message, qui, lui, est lu par un humain.
    expect(refusal.details).toEqual({
      error: 'invalid_grant',
      error_description: 'code déjà consommé',
    });
    expect(refusal.message).not.toContain('invalid_grant');
    // Aucun second appel : pas de reprise sur un code à usage unique.
    expect(wire.urls).toEqual([TOKEN_URL]);
  });

  it('refuse un 4xx MÊME quand le corps ressemble à un jeton utilisable', async () => {
    // LA SONDE DIRECTE du test `!response.ok`. Sans lui, ce corps-là passerait
    // pour une réussite : le code d'état est la seule chose qui distingue les
    // deux, et c'est exactement la ligne qu'une suppression fait disparaître.
    const { fetchImpl } = scriptedFetch([
      { status: 400, body: { access_token: 'ne-doit-jamais-servir', expires_in: 1 } },
    ]);
    const client = createDiscordClient(env, fetchImpl);

    const refusal = await refusalOf(() =>
      client.exchangeCode({ code: CODE, codeVerifier: VERIFIER }),
    );

    expect(refusal.step).toBe('token');
    expect(refusal.status).toBe(400);
  });

  it('refuse un 200 dont le corps n’est pas du JSON', async () => {
    // Une passerelle en panne rend du HTML avec un 200. `response.json()` jette,
    // le `catch` rend `null`, et c'est la branche `payload ?? {}` : sans elle,
    // la lecture du jeton partirait sur `null` et le refus deviendrait un
    // `TypeError` non identifié à l'étage du dessus.
    const { fetchImpl } = scriptedFetch([{ status: 200, raw: '<html>passerelle</html>' }]);
    const client = createDiscordClient(env, fetchImpl);

    const refusal = await refusalOf(() =>
      client.exchangeCode({ code: CODE, codeVerifier: VERIFIER }),
    );

    expect(refusal.step).toBe('token');
    expect(refusal.details).toBe('access_token absent');
  });

  it('refuse un 200 sans access_token', async () => {
    const { fetchImpl } = scriptedFetch([{ status: 200, body: { token_type: 'Bearer' } }]);
    const client = createDiscordClient(env, fetchImpl);

    const refusal = await refusalOf(() =>
      client.exchangeCode({ code: CODE, codeVerifier: VERIFIER }),
    );

    expect(refusal.step).toBe('token');
    expect(refusal.details).toBe('access_token absent');
  });
});

describe('createDiscordClient — /users/@me', () => {
  /** Échange puis identité, sur le même client : c'est l'enchaînement réel. */
  async function signInWire(answers: readonly Answer[]) {
    const { fetchImpl, wire } = scriptedFetch(answers);
    const client = createDiscordClient(env, fetchImpl);
    const tokens = await client.exchangeCode({ code: CODE, codeVerifier: VERIFIER });
    return { client, wire, tokens };
  }

  it('part en GET avec le Bearer du jeton rendu par l’échange', async () => {
    const { client, wire, tokens } = await signInWire([TOKEN_OK, USER_OK]);

    await client.fetchUser(tokens.accessToken);

    expect(wire.urls).toEqual([TOKEN_URL, USER_URL]);
    expect(wire.inits[1]?.method).toBe('GET');
    // L'EN-TÊTE, ET SA VALEUR : le jeton littéral de ce fichier, précédé du
    // schéma. Une requête sans en-tête, ou avec un en-tête vide, tombe ici.
    expect(headersOf(wire.inits[1])['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    // Et le corps du POST n'a pas voyagé jusqu'ici : rien du secret client.
    expect(JSON.stringify(wire.inits[1])).not.toContain(CLIENT_SECRET);
  });

  it('projette l’identité sur les quatre champs que ce produit stocke', async () => {
    const { client, wire, tokens } = await signInWire([TOKEN_OK, USER_OK]);

    const user = await client.fetchUser(tokens.accessToken);

    expect(user).toEqual({
      id: '221503261830316032',
      username: 'kevinb',
      globalName: 'Kevin',
      avatar: 'a1b2c3',
    });
    expect(wire.urls).toHaveLength(2);
  });

  it('rend null sur un global_name ou un avatar absents', async () => {
    const { client, tokens } = await signInWire([
      TOKEN_OK,
      { status: 200, body: { id: '7', username: 'sans-fioriture', global_name: null } },
    ]);

    const user = await client.fetchUser(tokens.accessToken);

    expect(user.globalName).toBeNull();
    expect(user.avatar).toBeNull();
  });

  it('lève l’erreur d’étape « user » sur un 4xx', async () => {
    const { client, tokens } = await signInWire([
      TOKEN_OK,
      { status: 403, body: { message: 'jeton révoqué' } },
    ]);

    const refusal = await refusalOf(() => client.fetchUser(tokens.accessToken));

    // L'étape distingue les deux appels : un 403 ici n'est pas un 403 là-haut.
    expect(refusal.step).toBe('user');
    expect(refusal.status).toBe(403);
    expect(refusal.details).toEqual({ message: 'jeton révoqué' });
  });

  it('refuse un 200 dont le corps n’est pas du JSON, du côté identité aussi', async () => {
    const { client, tokens } = await signInWire([
      TOKEN_OK,
      { status: 200, raw: 'pas du JSON du tout' },
    ]);

    const refusal = await refusalOf(() => client.fetchUser(tokens.accessToken));

    expect(refusal.step).toBe('user');
    expect(refusal.details).toBe('id ou username absent');
  });

  it('lève l’erreur d’étape « user » sur un 200 sans id ni username', async () => {
    const { client, tokens } = await signInWire([
      TOKEN_OK,
      { status: 200, body: { global_name: 'un fantôme' } },
    ]);

    const refusal = await refusalOf(() => client.fetchUser(tokens.accessToken));

    expect(refusal.step).toBe('user');
    expect(refusal.details).toBe('id ou username absent');
  });
});

describe('la couture est bien le paramètre fetchImpl', () => {
  it('sans le paramètre, le client part sur le fetch du processus', async () => {
    // L'AUTRE SENS de tout ce fichier : si le client ignorait son paramètre,
    // les quinze assertions ci-dessus porteraient sur un objet mort. Ici, et
    // ici seulement, le client est construit SANS faux fetch — et il tombe sur
    // le poison, donc il appelle bien le `fetch` du processus par défaut.
    const client = createDiscordClient(env);

    await expect(client.exchangeCode({ code: CODE, codeVerifier: VERIFIER })).rejects.toThrow(
      POISON,
    );
    await expect(client.fetchUser(ACCESS_TOKEN)).rejects.toThrow(POISON);
  });
});
