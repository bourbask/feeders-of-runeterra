import type { PlayerProfile } from '@for/contracts';
import type { ReactNode } from 'react';

/**
 * La barre du haut : qui est connecté, et comment en sortir.
 *
 * ELLE EXISTE PARCE QU'IL N'Y AVAIT AUCUN MOYEN DE SE DÉCONNECTER. La route
 * `/api/auth/logout` était écrite, testée côté serveur, et aucun écran ne
 * l'appelait : le point de contrôle du runbook §8 n'échouait pas, il était
 * inatteignable. Constaté en recette manuelle, pas par un test.
 *
 * ELLE MONTRE UN NOM, PAS UN IDENTIFIANT. `player.displayName` est déjà résolu
 * par le serveur — le nom global Discord quand il existe, le pseudo sinon.
 * Le panneau « À la table » affiche encore un identifiant brut, lui, parce que
 * `s2c.presence` n'en transporte aucun : c'est un défaut de contrat, pas
 * d'affichage, et il n'est pas corrigé ici.
 */
export function AppHeader(props: {
  readonly joueur: PlayerProfile;
  readonly onDeconnexion: () => void;
  readonly enCours: boolean;
}): ReactNode {
  return (
    <header className="fr-entete">
      <span className="fr-entete__joueur">{props.joueur.displayName}</span>
      <button
        type="button"
        className="fr-bouton fr-bouton--discret"
        onClick={props.onDeconnexion}
        disabled={props.enCours}
      >
        {props.enCours ? 'Déconnexion…' : 'Se déconnecter'}
      </button>
    </header>
  );
}
