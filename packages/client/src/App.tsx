import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CharacterSummary, MeResponse } from '@for/contracts';
import type { CampaignId } from '@for/engine';

import type { HttpDeps } from './api/http.js';
import { HttpError } from './api/http.js';
import { campaignLogQuery, championsQuery, logout, meQuery } from './api/queries.js';
import { clientEnv, websocketUrl } from './env.js';
import { AppHeader } from './routes/AppHeader.js';
import { CampaignList } from './routes/CampaignList.js';
import { CharacterPicker } from './routes/CharacterPicker.js';
import { DesignShowcase } from './routes/DesignShowcase.js';
import { Login } from './routes/Login.js';
import { BarreTechnique, TableRoom } from './routes/TableRoom.js';
import { parseRoute, routeHref, type Route } from './routes/route.js';
import { TableStoreProvider } from './ws/context.js';
import type { SocketHandle } from './ws/socket.js';
import { connect, openBrowserSocket } from './ws/socket.js';
import { createTableStore } from './ws/store.js';

/** Version announced in `c2s.hello`. Bumped when the wire handling changes. */
export const CLIENT_VERSION = '0.0.0';

function useHash(): string {
  const [hash, setHash] = useState(() => globalThis.location.hash);
  useEffect(() => {
    const onChange = (): void => {
      setHash(globalThis.location.hash);
    };
    globalThis.addEventListener('hashchange', onChange);
    return () => {
      globalThis.removeEventListener('hashchange', onChange);
    };
  }, []);
  return hash;
}

/** What the top bar needs about the player, whatever route is on screen. */
interface Entete {
  readonly joueur: MeResponse['player'];
  readonly onDeconnexion: () => void;
  readonly enCours: boolean;
}

/**
 * ONE CAMPAIGN, ONE SOCKET, TWO VIEWS.
 *
 * ONE STORE PER CAMPAIGN, created with the connection and dropped with it: a
 * store that outlived a table would show one table's journal under another
 * table's name.
 *
 * IT RENDERS THE TOP BAR ITSELF, and that is correction 4 and nothing else.
 * The bar carries « Liaison : connectée · contenu … · journal n° 248 », which
 * is read off the table store — so the bar has to be INSIDE the provider. The
 * other routes keep their bar in `Ecran`, where it always was.
 *
 * ══ POURQUOI LE CHOIX DE PERSONNAGE EST ICI, SOUS LA SOCKET ═══════════════
 *
 * Il envoie `c2s.intent` et il lit `championLocks` de l'instantané : les deux
 * passent par le magasin de CETTE table. Un écran de choix branché sur rien
 * aurait dû inventer les deux, et c'est exactement ce que l'invariant 3
 * interdit.
 */
function CampaignScreen(props: {
  readonly campaignId: string;
  readonly http: HttpDeps;
  readonly entete: Entete;
  /** Le nom de l'aventure, à gauche dans la barre (correction 5). */
  readonly aventure: string | null;
  /** `personnage` quand la porte est fermée, ou quand la route le demande. */
  readonly vue: 'table' | 'personnage';
  readonly personnages: readonly CharacterSummary[];
}): ReactNode {
  const transport = useRef<SocketHandle | null>(null);

  const store = useMemo(
    () =>
      createTableStore({
        send: (frame) => {
          transport.current?.send(frame);
        },
        newId: () => globalThis.crypto.randomUUID(),
        clientVersion: CLIENT_VERSION,
      }),
    [],
  );

  useEffect(() => {
    const handle = connect({
      url: websocketUrl(clientEnv, globalThis.location.origin, props.campaignId),
      open: openBrowserSocket,
      schedule: (run, delayMs) => {
        globalThis.setTimeout(run, delayMs);
      },
      onFrame: (raw) => {
        store.getState().receive(raw);
      },
      onStatus: (status) => {
        store.getState().setStatus(status);
      },
      onOpen: () => {
        store.getState().hello();
      },
    });
    transport.current = handle;
    return () => {
      transport.current = null;
      handle.close();
    };
  }, [props.campaignId, store]);

  /**
   * LE PASSÉ VIENT D'HTTP, LE DIRECT DE LA SOCKET.
   *
   * `s2c.snapshot` place le curseur de reprise sur la tête du journal : une
   * première connexion n'a donc aucun trou à signaler, ne demande rien, et
   * laisserait le fil vide sur une table qui a déjà deux cents entrées. La
   * route existait et personne ne l'appelait.
   */
  const log = useQuery({
    ...campaignLogQuery(props.http, props.campaignId as CampaignId),
    // Le passé d'une table qu'on ne regarde pas est du trafic pour rien.
    enabled: props.vue === 'table',
  });
  const entries = log.data?.entries;

  const catalogue = useQuery({ ...championsQuery(props.http), enabled: props.vue !== 'table' });

  /**
   * L'URL SUIT LA PORTE, elle ne la commande pas. Le rendu est déjà décidé
   * au-dessus ; cette ligne existe pour qu'un joueur renvoyé au choix puisse
   * recharger la page et retomber au même endroit, et pour que le lien qu'il
   * copie ne promette pas une table qu'il ne peut pas voir.
   */
  useEffect(() => {
    if (props.vue !== 'personnage') return;
    const voulu = routeHref({ nom: 'personnage', campaignId: props.campaignId });
    if (globalThis.location.hash !== voulu) globalThis.location.hash = voulu;
  }, [props.vue, props.campaignId]);

  useEffect(() => {
    if (entries === undefined) return;
    store.getState().backfill(entries);
  }, [entries, store]);

  return (
    <TableStoreProvider store={store}>
      <AppHeader
        joueur={props.entete.joueur}
        onDeconnexion={props.entete.onDeconnexion}
        enCours={props.entete.enCours}
        aventure={props.aventure}
        technique={<BarreTechnique />}
      />
      {props.vue === 'table' ? (
        <TableRoom />
      ) : (
        <CharacterPicker
          campaignId={props.campaignId}
          personnages={props.personnages}
          catalogue={catalogue.data ?? null}
          erreurCatalogue={
            catalogue.error === null ? null : 'Les champions n’ont pas pu être lus du serveur.'
          }
        />
      )}
    </TableStoreProvider>
  );
}

export function App(props: { readonly http: HttpDeps }): ReactNode {
  const hash = useHash();
  const route = parseRoute(hash);
  const me = useQuery(meQuery(props.http));
  const queryClient = useQueryClient();

  /**
   * SE DÉCONNECTER VIDE LE CACHE, ET REVIENT À LA RACINE.
   *
   * Le serveur révoque la session et efface le cookie ; il ne peut pas vider le
   * cache de ce navigateur. Sans `clear()`, la liste des tables du joueur
   * précédent resterait affichée jusqu'au prochain rechargement — et un écran
   * qui montre les tables de quelqu'un d'autre après sa sortie est exactement
   * ce que la révocation sert à empêcher.
   */
  const deconnexion = useMutation({
    mutationFn: async () => logout(props.http),
    onSettled: () => {
      globalThis.location.hash = '';
      queryClient.clear();
    },
  });

  // La vitrine passe AVANT le portillon de session. `useQuery` reste appelé, donc
  // les hooks restent dans le même ordre, mais rien n'attend : une maquette qu'il
  // faut connecter pour être vue est une maquette qu'on ne regarde plus.
  if (route.nom === 'design') {
    return <DesignShowcase />;
  }

  if (me.isPending) {
    return <p className="fr-vide">Chargement…</p>;
  }

  if (me.error instanceof HttpError && me.error.code === 'unauthenticated') {
    return <Login apiBaseUrl={props.http.baseUrl} />;
  }

  if (me.error !== null) {
    return <p className="fr-erreur">{me.error.message}</p>;
  }

  return (
    <Ecran
      route={route}
      me={me.data}
      http={props.http}
      entete={{
        joueur: me.data.player,
        onDeconnexion: () => {
          deconnexion.mutate();
        },
        enCours: deconnexion.isPending,
      }}
    />
  );
}

/**
 * LE TYPE DE `route` EXCLUT `design`, ET CE N'EST PAS UN DÉTAIL.
 *
 * `App` traite `design` AVANT le portillon de session et rend la main. Tant que
 * le `switch` vivait dans `App`, TypeScript le savait et refusait un `case
 * 'design'` devenu inatteignable. Sorti dans ce composant, il ne le sait plus :
 * `design` redevient un cas possible, et un `switch` qui ne le couvre pas ne
 * rend rien — `TS7030`, mesuré sur `develop` le 5 octobre.
 *
 * L'exclure ICI rend les deux intentions compatibles : aucun `case 'design'` à
 * écrire, et un nom ajouté à `Route` sans être traité fait toujours échouer la
 * compilation. C'est le mécanisme que la PR 104 voulait, préservé.
 *
 * LES DEUX ÉCRANS D'UNE CAMPAGNE SORTENT DU `switch` PAR LE HAUT, pour la même
 * raison qu'ils ont leur propre barre : ce sont les seuls dont l'en-tête lit
 * l'état de la table, donc les seuls dont l'en-tête vit sous le fournisseur de
 * magasin. Le `switch` de `Contenu` reste exhaustif sur ce qui reste, et un nom
 * ajouté à `Route` sans être traité fait toujours échouer la compilation.
 *
 * ══ LA PORTE ══════════════════════════════════════════════════════════════
 *
 * ON NE RENTRE PAS SUR UNE TABLE SANS PERSONNAGE. Pas un bandeau, pas un
 * avertissement : `vue` vaut `personnage`, et `<TableRoom />` n'est pas rendu
 * du tout. Ce que le joueur a ou n'a pas vient de `/api/me`, c'est-à-dire du
 * serveur — le client ne décide pas qui a un personnage, il lit la réponse.
 *
 * Tenue par `App.test.tsx`, « un joueur sans personnage ne voit PAS la table,
 * il voit le choix du champion » : retirer la ligne `aPersonnage` ci-dessous
 * fait tomber ce cas nommé.
 */
function Ecran(props: {
  readonly route: Exclude<Route, { readonly nom: 'design' }>;
  readonly me: MeResponse;
  readonly http: HttpDeps;
  readonly entete: Entete;
}): ReactNode {
  const route = props.route;

  if (route.nom === 'table' || route.nom === 'personnage') {
    const campagne = props.me.campaigns.find((candidate) => candidate.id === route.campaignId);
    const aPersonnage = props.me.characters.some(
      (personnage) => personnage.campaignId === route.campaignId,
    );
    return (
      <CampaignScreen
        campaignId={route.campaignId}
        http={props.http}
        entete={props.entete}
        aventure={campagne?.name ?? null}
        vue={route.nom === 'table' && aPersonnage ? 'table' : 'personnage'}
        personnages={props.me.characters}
      />
    );
  }

  return (
    <>
      <AppHeader
        joueur={props.entete.joueur}
        onDeconnexion={props.entete.onDeconnexion}
        enCours={props.entete.enCours}
      />
      <Contenu route={route} me={props.me} />
    </>
  );
}

function Contenu(props: {
  readonly route: Exclude<
    Route,
    { readonly nom: 'design' } | { readonly nom: 'table' } | { readonly nom: 'personnage' }
  >;
  readonly me: MeResponse;
}): ReactNode {
  switch (props.route.nom) {
    case 'campagnes':
      return <CampaignList campagnes={props.me.campaigns} />;
    // Pas de `case 'design'`, ni `'table'`, ni `'personnage'` : les retours
    // plus haut ont déjà narrowed le type, et TS les refuse ici. C'est le
    // mécanisme qu'on veut — un nom ajouté à `Route` sans être traité fait
    // échouer la compilation, qu'on l'ait oublié avant ou après le portillon.
    case 'inconnue':
      return <p className="fr-erreur">Cette page n’existe pas.</p>;
  }
}
