import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CampaignId } from '@for/engine';

import type { HttpDeps } from './api/http.js';
import { HttpError } from './api/http.js';
import { campaignLogQuery, meQuery } from './api/queries.js';
import { clientEnv, websocketUrl } from './env.js';
import { CampaignList } from './routes/CampaignList.js';
import { CharacterPicker } from './routes/CharacterPicker.js';
import { DesignShowcase } from './routes/DesignShowcase.js';
import { Login } from './routes/Login.js';
import { TableRoom } from './routes/TableRoom.js';
import { parseRoute } from './routes/route.js';
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

/**
 * The table screen plus its socket. ONE STORE PER CAMPAIGN, created with the
 * connection and dropped with it: a store that outlived a table would show one
 * table's journal under another table's name.
 */
function TableScreen(props: { readonly campaignId: string; readonly http: HttpDeps }): ReactNode {
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
  const log = useQuery(campaignLogQuery(props.http, props.campaignId as CampaignId));
  const entries = log.data?.entries;

  useEffect(() => {
    if (entries === undefined) return;
    store.getState().backfill(entries);
  }, [entries, store]);

  return (
    <TableStoreProvider store={store}>
      <TableRoom />
    </TableStoreProvider>
  );
}

export function App(props: { readonly http: HttpDeps }): ReactNode {
  const hash = useHash();
  const route = parseRoute(hash);
  const me = useQuery(meQuery(props.http));

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

  switch (route.nom) {
    case 'table':
      return <TableScreen campaignId={route.campaignId} http={props.http} />;
    case 'personnage':
      return <CharacterPicker campaignId={route.campaignId} personnages={me.data.characters} />;
    case 'campagnes':
      return <CampaignList campagnes={me.data.campaigns} />;
    // Pas de `case 'design'` : le retour plus haut a déjà narrowed le type, et
    // TS le refuse ici. C'est le mécanisme qu'on veut — un nom ajouté à `Route`
    // sans être traité fait échouer la compilation, qu'on l'ait oublié avant ou
    // après le portillon.
    case 'inconnue':
      return <p className="fr-erreur">Cette page n’existe pas.</p>;
  }
}
