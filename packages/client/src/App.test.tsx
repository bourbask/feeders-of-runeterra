import { anId } from '@for/testkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { HttpDeps } from './api/http.js';

const CAMPAGNE = anId('campaign');

const ME = {
  player: {
    id: anId('player'),
    displayName: 'Théo',
    avatarUrl: null,
    locale: 'fr',
    isAdmin: false,
  },
  characters: [],
  campaigns: [
    {
      id: CAMPAGNE,
      slug: 'le-col',
      name: 'Le col de Rakelstake',
      pitch: 'Une passe.',
      status: 'active',
      ownerPlayerId: anId('player'),
      contentPackVersion: '1.0.0',
      seq: 0,
    },
  ],
};

/** Une socket qui n'ouvre rien : le test mesure le montage, pas le réseau. */
class SocketMuette {
  static ouvertes: string[] = [];
  constructor(url: string) {
    SocketMuette.ouvertes.push(url);
  }
  addEventListener(): void {
    // Aucune trame ne viendra : l'écran doit s'afficher quand même.
  }
  send(): void {
    throw new Error('le test ne doit rien envoyer sur le réseau');
  }
  close(): void {
    // rien
  }
}

function depsRendant(corps: unknown, status = 200): HttpDeps {
  return {
    baseUrl: '',
    fetch: () =>
      Promise.resolve(
        new Response(JSON.stringify(corps), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
  };
}

/**
 * Un `fetch` qui note chaque appel : le test de déconnexion ne mesure pas une
 * réponse, il mesure la REQUÊTE — le chemin, la méthode, et le fait que le
 * cookie parte. Un double qui ne rend qu'une réponse laisserait passer une
 * déconnexion qui n'appelle rien.
 */
function depsNotant(): HttpDeps & { readonly appels: { url: string; init: RequestInit }[] } {
  const appels: { url: string; init: RequestInit }[] = [];
  return {
    baseUrl: '',
    appels,
    fetch: ((url: string, init: RequestInit) => {
      appels.push({ url, init });
      const corps = url.includes('/api/auth/logout') ? { ok: true } : ME;
      return Promise.resolve(
        new Response(JSON.stringify(corps), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as unknown as HttpDeps['fetch'],
  };
}

function afficher(deps: HttpDeps): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App http={deps} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  SocketMuette.ouvertes = [];
  globalThis.location.hash = '';
  vi.stubGlobal('WebSocket', SocketMuette);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('l’application', () => {
  it('renvoie à la connexion Discord quand la session a expiré', async () => {
    afficher(depsRendant({ code: 'unauthenticated', message: 'non', requestId: 'r' }, 401));
    expect(await screen.findByRole('link', { name: /Discord/u })).toBeDefined();
  });

  it('affiche les tables du joueur à la racine', async () => {
    afficher(depsRendant(ME));
    expect(await screen.findByRole('link', { name: 'Le col de Rakelstake' })).toBeDefined();
  });

  /**
   * LA DÉCONNEXION N'AVAIT AUCUN BOUTON — c'est le défaut que ces cas gardent.
   * La route serveur existait, testée de son côté, et aucun écran ne
   * l'appelait : le point de contrôle du runbook §8 n'échouait pas, il était
   * inatteignable. Trouvé en recette manuelle, pas par un test.
   */
  describe('la déconnexion', () => {
    it('montre le NOM du joueur, jamais son identifiant', async () => {
      afficher(depsRendant(ME));
      expect(await screen.findByText('Théo')).toBeDefined();
      expect(screen.queryByText(ME.player.id)).toBeNull();
    });

    it('appelle /api/auth/logout en POST, avec le cookie', async () => {
      const deps = depsNotant();
      afficher(deps);

      (await screen.findByRole('button', { name: /déconnecter/iu })).click();

      await waitFor(() => {
        const sortie = deps.appels.find((appel) => appel.url.includes('/api/auth/logout'));
        expect(sortie).toBeDefined();
        expect(sortie?.init.method).toBe('POST');
        // Le serveur révoque par le cookie : sans `include`, il révoquerait
        // une session anonyme et répondrait 200 sans rien faire.
        expect(sortie?.init.credentials).toBe('include');
      });
    });

    it('revient à la racine, pour ne pas laisser la table de celui qui part', async () => {
      globalThis.location.hash = `#/campagnes/${CAMPAGNE}`;
      const deps = depsNotant();
      afficher(deps);

      (await screen.findByRole('button', { name: /déconnecter/iu })).click();

      await waitFor(() => {
        expect(globalThis.location.hash).toBe('');
      });
    });

    it('n’apparaît pas tant qu’on n’est pas connecté', async () => {
      afficher(depsRendant({ code: 'unauthenticated', message: 'non', requestId: 'r' }, 401));
      await screen.findByRole('link', { name: /Discord/u });
      expect(screen.queryByRole('button', { name: /déconnecter/iu })).toBeNull();
    });
  });

  it('dit qu’une route inconnue n’existe pas, au lieu de deviner', async () => {
    globalThis.location.hash = '#/une-page-inventee';
    afficher(depsRendant(ME));
    expect(await screen.findByText(/n’existe pas/u)).toBeDefined();
  });

  it('ouvre la table et branche la socket sur la campagne de l’URL', async () => {
    globalThis.location.hash = `#/campagnes/${CAMPAGNE}`;
    afficher(depsRendant(ME));

    expect(await screen.findByText(/Rien ne s’est encore passé/u)).toBeDefined();
    expect(SocketMuette.ouvertes).toHaveLength(1);
    expect(SocketMuette.ouvertes[0]).toContain(`campaignId=${CAMPAGNE}`);
    expect(SocketMuette.ouvertes[0]?.startsWith('ws://')).toBe(true);
  });

  it('ouvre le choix du champion sur sa route', async () => {
    globalThis.location.hash = `#/campagnes/${CAMPAGNE}/personnage`;
    afficher(depsRendant(ME));
    expect(await screen.findByText(/M0-24/u)).toBeDefined();
  });

  it('montre l’erreur du serveur plutôt qu’un écran blanc', async () => {
    afficher(depsRendant({ code: 'internal_error', message: 'x', requestId: 'r' }, 500));
    expect(await screen.findByText(/C’est noté côté serveur/u)).toBeDefined();
  });
});
