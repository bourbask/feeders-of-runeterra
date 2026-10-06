import { anId } from '@for/testkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { HttpDeps } from './api/http.js';

const CAMPAGNE = anId('campaign');

/**
 * LE PERSONNAGE EST CE QUI OUVRE LA PORTE, donc il est ABSENT de `ME`.
 *
 * `ME` est le porteur du projet le jour où il s'est connecté : membre d'une
 * table, sans fiche. C'est l'état que la porte doit refuser, et le laisser par
 * défaut est ce qui fait qu'un test qui montre la table doit DIRE qu'il donne
 * un personnage.
 */
const PERSONNAGE = {
  id: anId('character'),
  campaignId: CAMPAGNE,
  championId: 'braum',
  displayName: 'Braum',
  sheetSource: 'handwritten' as const,
  status: 'active' as const,
};

const ME = {
  player: {
    id: anId('player'),
    displayName: 'Théo',
    avatarUrl: null,
    locale: 'fr',
    isAdmin: false,
  },
  characters: [] as (typeof PERSONNAGE)[],
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

/** Le même joueur, mais avec une fiche à cette table : la porte s'ouvre. */
const ME_AVEC_PERSO = { ...ME, characters: [PERSONNAGE] };

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
function depsNotant(
  moi: typeof ME = ME,
): HttpDeps & { readonly appels: { url: string; init: RequestInit }[] } {
  const appels: { url: string; init: RequestInit }[] = [];
  return {
    baseUrl: '',
    appels,
    fetch: ((url: string, init: RequestInit) => {
      appels.push({ url, init });
      const corps = url.includes('/api/auth/logout') ? { ok: true } : moi;
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
      const deps = depsNotant(ME_AVEC_PERSO);
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
    afficher(depsRendant(ME_AVEC_PERSO));

    expect(await screen.findByText(/Rien ne s’est encore passé/u)).toBeDefined();
    expect(SocketMuette.ouvertes).toHaveLength(1);
    expect(SocketMuette.ouvertes[0]).toContain(`campaignId=${CAMPAGNE}`);
    expect(SocketMuette.ouvertes[0]?.startsWith('ws://')).toBe(true);
  });

  /**
   * CORRECTIONS 4 ET 5 : ce que la barre du haut porte sur une table.
   *
   * LE NOM DE L'AVENTURE a remplacé le titre « La table », qui ne nommait rien.
   * LE BANDEAU TECHNIQUE a quitté l'espace de jeu et s'est posé à gauche du nom
   * du joueur. Les deux sont dans la MÊME barre, et l'ordre de lecture est
   * celui du DOM.
   */
  it('porte le nom de l’aventure et l’état de la liaison dans la barre du haut', async () => {
    globalThis.location.hash = `#/campagnes/${CAMPAGNE}`;
    afficher(depsRendant(ME_AVEC_PERSO));

    const barre = await screen.findByRole('banner');
    expect(barre.textContent).toContain('Le col de Rakelstake');
    expect(barre.textContent).toContain('Liaison');
    expect(barre.textContent).toContain('Théo');

    // À GAUCHE DU NOM DU JOUEUR, et pas « quelque part dans la barre ». L'ordre
    // de lecture est ce qui est demandé, donc c'est l'ordre qui est mesuré.
    const technique = barre.querySelector('.fr-entete__technique');
    const joueur = barre.querySelector('.fr-entete__joueur');
    expect(technique).not.toBeNull();
    expect(joueur).not.toBeNull();
    expect(
      (technique?.compareDocumentPosition(joueur as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it('ne met ni aventure ni technique dans la barre hors d’une table', async () => {
    // L'AUTRE SENS. Sans lui, « la barre porte un nom d'aventure » serait vrai
    // d'une barre qui en porterait un sur toutes les pages, y compris celle qui
    // sert à choisir la table.
    afficher(depsRendant(ME));

    const barre = await screen.findByRole('banner');
    expect(barre.textContent).toContain('Théo');
    expect(barre.textContent).not.toContain('Liaison');
    expect(barre.querySelector('.fr-entete__aventure')).toBeNull();
  });

  it('ouvre le choix du champion sur sa route', async () => {
    globalThis.location.hash = `#/campagnes/${CAMPAGNE}/personnage`;
    afficher(depsRendant(ME));
    expect(await screen.findByRole('heading', { name: 'Choisis ton champion' })).toBeDefined();
  });

  /**
   * ══ LA PORTE ═════════════════════════════════════════════════════════════
   *
   * « On ne devrait pas pouvoir rentrer sur une table sans perso. » Pas un
   * bandeau, pas un avertissement : la table n'est PAS RENDUE. Ce que ces deux
   * cas mesurent est l'absence de la zone de saisie du jeu — c'est elle qui
   * fait qu'on joue, et un écran qui la porte est un écran de table quoi
   * qu'affiche le reste.
   *
   * CASSER LA PORTE FAIT TOMBER LE PREMIER CAS, NOMMÉMENT : remplacer
   * `vue={route.nom === 'table' && aPersonnage ? 'table' : 'personnage'}` par
   * `vue={route.nom === 'table' ? 'table' : 'personnage'}` dans `App.tsx` rend
   * « un joueur SANS personnage ne voit pas la table » rouge, et lui seul.
   */
  describe('la porte du personnage', () => {
    it('un joueur SANS personnage ne voit pas la table, il voit le choix du champion', async () => {
      globalThis.location.hash = `#/campagnes/${CAMPAGNE}`;
      afficher(depsRendant(ME));

      expect(await screen.findByRole('heading', { name: 'Choisis ton champion' })).toBeDefined();
      // LA TABLE N'EST PAS LÀ : ni la saisie, ni le fil.
      expect(screen.queryByLabelText('Ce que tu fais')).toBeNull();
      expect(screen.queryByText(/Rien ne s’est encore passé/u)).toBeNull();
    });

    it('et l’URL le suit : il est ENVOYÉ au choix, il n’y est pas seulement montré', async () => {
      globalThis.location.hash = `#/campagnes/${CAMPAGNE}`;
      afficher(depsRendant(ME));

      await screen.findByRole('heading', { name: 'Choisis ton champion' });
      await waitFor(() => {
        expect(globalThis.location.hash).toBe(`#/campagnes/${CAMPAGNE}/personnage`);
      });
    });

    it('l’autre sens : avec un personnage, la table s’ouvre et le choix n’apparaît pas', async () => {
      // Sans ce cas, « la table ne s'affiche pas » serait vrai d'une porte
      // fermée pour tout le monde.
      globalThis.location.hash = `#/campagnes/${CAMPAGNE}`;
      afficher(depsRendant(ME_AVEC_PERSO));

      expect(await screen.findByLabelText('Ce que tu fais')).toBeDefined();
      expect(screen.queryByRole('heading', { name: 'Choisis ton champion' })).toBeNull();
      expect(globalThis.location.hash).toBe(`#/campagnes/${CAMPAGNE}`);
    });
  });

  it('montre l’erreur du serveur plutôt qu’un écran blanc', async () => {
    afficher(depsRendant({ code: 'internal_error', message: 'x', requestId: 'r' }, 500));
    expect(await screen.findByText(/C’est noté côté serveur/u)).toBeDefined();
  });
});
