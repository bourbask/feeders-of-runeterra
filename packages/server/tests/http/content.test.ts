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
import {
  CONTENT_CACHE_CONTROL,
  zAppErrorPayload,
  zChampionCatalogueResponse,
  zContentManifestResponse,
} from '@for/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { bench, signIn } from '../../src/auth/testing.js';
import { KINDS, championCards } from '../../src/http/content.routes.js';

import type { ContentBundle } from '@for/content';
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

  it('n’en lit aucune non plus : last_used_at ne bouge pas quand un cookie passe', async () => {
    // « No session is required, AND NONE IS READ », dit l'en-tête du fichier.
    // La première moitié est le test ci-dessus ; la seconde se mesure à DEUX
    // INSTANTS, sur la seule trace qu'une résolution de session laisse.
    const b = await bed();
    const signed = await signIn(b);
    const lastUsed = (): number =>
      (
        b.connection.prepare(`SELECT last_used_at FROM auth_sessions`).get() as {
          last_used_at: number;
        }
      ).last_used_at;
    const avant = lastUsed();

    b.clock.advance(60_000);
    const response = await b.app.inject({
      method: 'GET',
      url: '/api/content/manifest',
      cookies: { fr_session: signed.secret },
    });

    expect(response.statusCode).toBe(200);
    expect(lastUsed()).toBe(avant);

    // L'AUTRE SENS : une route qui, elle, résout la session repousse bien la
    // date. Sans cela, l'égalité ci-dessus tiendrait aussi pour un
    // `touchSession` devenu inerte.
    await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: signed.secret },
    });
    expect(lastUsed()).toBe(avant + 60_000);
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

/**
 * LE CATALOGUE DE L'ÉCRAN DE CHOIX (UI-03).
 *
 * `/api/content/:kind/:id` sert UNE fiche et le manifeste ne sert que des
 * COMPTES : un navigateur n'avait aucun moyen d'apprendre quels champions
 * existent, et il n'a pas le droit d'importer `@for/content`. Cette route est
 * le seul chemin, donc elle est mesurée comme tel.
 */
describe('GET /api/content/champions', () => {
  it('sert une carte par FICHIER de `content/champions/`, pas par entrée du registre', async () => {
    const b = await bed();

    const response = await b.app.inject({ method: 'GET', url: '/api/content/champions' });

    expect(response.statusCode).toBe(200);
    const body = zChampionCatalogueResponse.parse(response.json());
    // Deux lectures indépendantes : la route lit le paquet validé, `filesUnder`
    // lit le texte brut des fichiers.
    expect(filesUnder('champions')).toBeGreaterThan(0);
    expect(body.champions).toHaveLength(filesUnder('champions'));
  });

  it('porte la répartition ÉCRITE DANS LA FICHE, pas une répartition recalculée', async () => {
    const b = await bed();

    const body = zChampionCatalogueResponse.parse(
      (await b.app.inject({ method: 'GET', url: '/api/content/champions' })).json(),
    );

    // L'AUTRE OPÉRANDE EST LE FICHIER JSON LUI-MÊME. Comparer la carte au
    // paquet que la route a lu serait un chiffre comparé à lui-même.
    for (const carte of body.champions) {
      const brut = GENERATED_FILES[`champions/${carte.id}.json`];
      expect(brut).toBeDefined();
      const fiche = JSON.parse(brut!) as { name: string; attributes: unknown; pitch: string };
      expect(carte.name).toBe(fiche.name);
      expect(carte.pitch).toBe(fiche.pitch);
      expect(carte.attributes).toEqual(fiche.attributes);
    }
  });

  it('range les champions par nom, même servis à l’envers', async () => {
    const b = await bed();
    const bundle = b.deps.content.bundle;

    // MODE 7 : une fixture déjà triée ne prouve rien sur un tri. On retourne la
    // carte du paquet et on exige le TABLEAU EXACT, comparé à une liste de noms
    // triée indépendamment.
    const envers: ContentBundle = {
      ...bundle,
      champions: new Map([...bundle.champions].reverse()),
    };
    const attendu = [...bundle.champions.values()]
      .map((champion) => champion.name)
      .sort((a, b2) => a.localeCompare(b2, 'fr'));

    expect(attendu.length).toBeGreaterThan(1);
    expect(championCards(envers).map((carte) => carte.name)).toEqual(attendu);
  });

  it('n’est PAS servi en cache immuable : son URL ne porte aucune version', async () => {
    const b = await bed();

    const response = await b.app.inject({ method: 'GET', url: '/api/content/champions' });

    // `immutable` sur cette URL rendrait invisible une quatrième fiche pour
    // tout navigateur ayant déjà posé la question une fois.
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['cache-control']).not.toBe(CONTENT_CACHE_CONTROL);
  });

  it('compte à part les champions NOMMÉS, et ils sont plus nombreux que les fiches', async () => {
    const b = await bed();

    const body = zChampionCatalogueResponse.parse(
      (await b.app.inject({ method: 'GET', url: '/api/content/champions' })).json(),
    );

    // DEUX FICHIERS, DEUX LECTURES : l'annuaire d'un côté, le dossier des
    // fiches de l'autre. C'est l'écart entre les deux que l'écran annonce au
    // lieu de laisser croire que le Freljord compte trois personnes.
    const annuaire = JSON.parse(GENERATED_FILES['champions-index.json']!) as {
      champions: readonly unknown[];
    };
    expect(body.namedInIndex).toBe(annuaire.champions.length);
    expect(body.namedInIndex).toBeGreaterThan(body.champions.length);
  });

  it('est public : aucune session, et pas de 401', async () => {
    const b = await bed();
    const response = await b.app.inject({ method: 'GET', url: '/api/content/champions' });
    expect(response.statusCode).toBe(200);
  });
});
