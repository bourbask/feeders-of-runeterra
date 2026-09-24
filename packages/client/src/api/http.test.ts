import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@for/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { HttpError, NETWORK_ERROR_MESSAGE, UNREADABLE_RESPONSE_MESSAGE, request } from './http.js';

const zCorps = z.strictObject({ ok: z.boolean() });

function reponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(brut(body, status));
}

function brut(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('la requête HTTP', () => {
  it('valide la réponse avant de la rendre', async () => {
    const deps = { baseUrl: '', fetch: () => reponse({ ok: true }) };
    await expect(request(deps, { path: '/api/x', schema: zCorps })).resolves.toEqual({ ok: true });
  });

  it('refuse un corps qui ne correspond pas au schéma', async () => {
    const deps = { baseUrl: '', fetch: () => reponse({ ok: 'oui' }) };
    await expect(request(deps, { path: '/api/x', schema: zCorps })).rejects.toThrow(
      UNREADABLE_RESPONSE_MESSAGE,
    );
  });

  it('traduit le code d’erreur du serveur en phrase française', async () => {
    const deps = {
      baseUrl: '',
      fetch: () => reponse({ code: 'unauthenticated', message: 'nope', requestId: 'r1' }, 401),
    };

    await expect(request(deps, { path: '/api/me', schema: zCorps })).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
      message: expect.stringContaining('Discord') as unknown as string,
    });
  });

  it('un serveur injoignable devient une erreur lisible, pas une exception nue', async () => {
    const deps = {
      baseUrl: '',
      fetch: () => {
        throw new TypeError('failed to fetch');
      },
    };

    const erreur = await request(deps, { path: '/api/me', schema: zCorps }).catch(
      (cause: unknown) => cause,
    );
    expect(erreur).toBeInstanceOf(HttpError);
    expect((erreur as HttpError).message).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('porte l’en-tête CSRF sur une mutation et pas sur une lecture', async () => {
    const vues: (HeadersInit | undefined)[] = [];
    const deps = {
      baseUrl: 'https://api.test',
      fetch: (_url: string | URL | Request, init?: RequestInit) => {
        vues.push(init?.headers);
        return reponse({ ok: true });
      },
    };

    await request(deps, { path: '/api/x', schema: zCorps });
    await request(deps, { method: 'POST', path: '/api/x', schema: zCorps, body: { a: 1 } });

    expect(vues[0]).not.toHaveProperty(CSRF_HEADER_NAME);
    expect(vues[1]).toMatchObject({ [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE });
  });

  it('envoie le cookie de session et jamais un jeton', async () => {
    let init: RequestInit | undefined;
    const deps = {
      baseUrl: '',
      fetch: (_url: string | URL | Request, options?: RequestInit) => {
        init = options;
        return reponse({ ok: true });
      },
    };

    await request(deps, { path: '/api/me', schema: zCorps });
    expect(init?.credentials).toBe('include');
    expect(JSON.stringify(init?.headers)).not.toMatch(/authorization/iu);
  });
});
