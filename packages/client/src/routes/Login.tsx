import type { ReactNode } from 'react';

import { Panel } from '../components/ui/Panel.js';

/**
 * Sign-in. A LINK, NOT A `fetch`. `/api/auth/discord/start` answers a redirect
 * to Discord, and a redirect followed by XHR would land in the page instead of
 * in the browser's address bar — the OAuth round trip needs the real
 * navigation, and the `state` and PKCE cookies it sets need to be the
 * browser's own.
 */
export function Login(props: { readonly apiBaseUrl: string }): ReactNode {
  return (
    <main className="fr-ecran fr-ecran--connexion">
      <Panel titre="Rejoindre la table">
        <p>
          Le vocal reste sur Discord ; la table, elle, est ici. Connecte-toi avec le compte Discord
          que tu utilises pour jouer.
        </p>
        <a
          className="fr-bouton fr-bouton--principal"
          href={`${props.apiBaseUrl}/api/auth/discord/start`}
        >
          Se connecter avec Discord
        </a>
      </Panel>
    </main>
  );
}
