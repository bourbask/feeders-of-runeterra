/**
 * The content surface: the manifest, its `ETag`, and one document.
 *
 * THE COUNTS ARE CHECKED AGAINST THE FILES, NOT AGAINST THE REGISTRY. The
 * route reads `deps.content.bundle`; comparing its answer to that same bundle
 * would be a number compared to itself, green on a loader that dropped half
 * the champions. `GENERATED_FILES` is the other path: it is the raw text of
 * every content file, so counting the keys under `champions/` is an
 * independent reading of the same fact.
 */

import { GENERATED_FILES } from '@for/content';
import { CONTENT_CACHE_CONTROL, zAppErrorPayload, zContentManifestResponse } from '@for/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { bench } from '../../src/auth/testing.js';
import { KINDS } from '../../src/http/content.routes.js';

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

/** How many JSON documents sit directly under one folder of `content/`. */
function filesUnder(folder: string): number {
  return Object.keys(GENERATED_FILES).filter(
    (path) => path.startsWith(`${folder}/`) && path.endsWith('.json'),
  ).length;
}

describe('les genres servis', () => {
  it('sont les six que voici, écrits en toutes lettres', () => {
    // NOT a loop over `KINDS`: emptying that table has to make this red, and a
    // test that iterated it would go green instead. The manifest and the
    // document route read the SAME table, so this one assertion pins both.
    expect(Object.keys(KINDS).sort()).toEqual([
      'assets',
      'champions',
      'conditions',
      'moves',
      'oracles',
      'regions',
    ]);
  });
});

describe('GET /api/content/manifest', () => {
  it('compte ce que les fichiers contiennent, pas ce que le registre annonce', async () => {
    const b = await bed();

    const response = await b.app.inject({ method: 'GET', url: '/api/content/manifest' });

    expect(response.statusCode).toBe(200);
    const body = zContentManifestResponse.parse(response.json());

    // Two independent readings, twice. `filesUnder` walks the raw file map;
    // the route walks the validated bundle.
    expect(filesUnder('champions')).toBeGreaterThan(0);
    expect(body.counts['champions']).toBe(filesUnder('champions'));
    expect(filesUnder('moves')).toBeGreaterThan(0);
    expect(body.counts['moves']).toBe(filesUnder('moves'));
    // And every announced kind carries a number.
    expect(Object.keys(body.counts).sort()).toEqual(Object.keys(KINDS).sort());
  });

  it('porte un ETag, et répond 304 quand le client le renvoie', async () => {
    const b = await bed();

    const first = await b.app.inject({ method: 'GET', url: '/api/content/manifest' });
    const etag = first.headers.etag!;
    expect(etag).toBe(`"${zContentManifestResponse.parse(first.json()).contentVersion}"`);
    expect(first.headers['cache-control']).toBe('no-cache');

    const second = await b.app.inject({
      method: 'GET',
      url: '/api/content/manifest',
      headers: { 'if-none-match': etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');

    // The other direction: a stale validator gets the body back, so the 304
    // above really came from the comparison and not from the header's mere
    // presence.
    const stale = await b.app.inject({
      method: 'GET',
      url: '/api/content/manifest',
      headers: { 'if-none-match': '"une-autre-version"' },
    });
    expect(stale.statusCode).toBe(200);
  });

  it('est public : aucune session, et pas de 401', async () => {
    const b = await bed();

    const response = await b.app.inject({ method: 'GET', url: '/api/content/manifest' });

    expect(response.statusCode).toBe(200);
  });
});

describe('GET /api/content/:kind/:id', () => {
  it('rend la fiche, en cache immuable', async () => {
    const b = await bed();
    // Taken from the files, so this test follows the content instead of
    // hard-coding a champion that may be renamed.
    const path = Object.keys(GENERATED_FILES).find((p) => p.startsWith('champions/'));
    expect(path).toBeDefined();
    const id = path!.slice('champions/'.length, -'.json'.length);

    const response = await b.app.inject({ method: 'GET', url: `/api/content/champions/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe(CONTENT_CACHE_CONTROL);
    expect(response.json<{ id: string }>().id).toBe(id);
  });

  it('répond 404 sur un genre inconnu et sur un identifiant inconnu', async () => {
    const b = await bed();

    const badKind = await b.app.inject({ method: 'GET', url: '/api/content/dragons/braum' });
    expect(badKind.statusCode).toBe(404);
    expect(zAppErrorPayload.parse(badKind.json()).code).toBe('content_not_found');

    const badId = await b.app.inject({ method: 'GET', url: '/api/content/champions/personne' });
    expect(badId.statusCode).toBe(404);
    expect(zAppErrorPayload.parse(badId.json()).code).toBe('content_not_found');
  });
});
