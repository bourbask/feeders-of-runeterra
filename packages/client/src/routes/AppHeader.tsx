import type { PlayerProfile } from '@for/contracts';
import type { ReactNode } from 'react';

/**
 * La barre du haut : où l'on est, comment ça va, qui est connecté, et comment
 * en sortir.
 *
 * ELLE EXISTE PARCE QU'IL N'Y AVAIT AUCUN MOYEN DE SE DÉCONNECTER. La route
 * `/api/auth/logout` était écrite, testée côté serveur, et aucun écran ne
 * l'appelait : le point de contrôle du runbook §8 n'échouait pas, il était
 * inatteignable. Constaté en recette manuelle, pas par un test.
 *
 * ELLE A DEUX NOUVEAUX LOCATAIRES, ET TOUS DEUX VIENNENT DE L'ESPACE DE JEU.
 *
 *   - À GAUCHE, LE NOM DE L'AVENTURE (correction 5). Il remplace le titre
 *     « La table », qui ne nommait rien : toutes les tables s'appelaient comme
 *     ça.
 *   - À GAUCHE DU NOM DU JOUEUR, LE BANDEAU TECHNIQUE (correction 4).
 *     « Liaison : connectée · contenu … · journal n° 248 » est le logiciel qui
 *     parle de lui-même ; il n'a rien à faire au milieu d'une fiction. Il
 *     arrive en `ReactNode` plutôt qu'en chaîne parce qu'il LIT L'ÉTAT DE LA
 *     TABLE : c'est `TableRoom.BarreTechnique`, et il ne peut vivre que sous le
 *     fournisseur de magasin. C'est la seule raison pour laquelle `App.tsx`
 *     rend cette barre depuis l'intérieur de la route de table.
 *
 * ELLE MONTRE UN NOM, PAS UN IDENTIFIANT. `player.displayName` est déjà résolu
 * par le serveur — le nom global Discord quand il existe, le pseudo sinon.
 */
export function AppHeader(props: {
  readonly joueur: PlayerProfile;
  readonly onDeconnexion: () => void;
  readonly enCours: boolean;
  /** Le nom de l'aventure, à gauche. Absent hors d'une table. */
  readonly aventure?: string | null;
  /** Le bandeau technique, à gauche du nom du joueur. Absent hors d'une table. */
  readonly technique?: ReactNode;
}): ReactNode {
  return (
    <header className="fr-entete">
      {props.aventure === null || props.aventure === undefined ? null : (
        <h1 className="fr-entete__aventure">{props.aventure}</h1>
      )}
      <div className="fr-entete__droite">
        {props.technique}
        <span className="fr-entete__joueur">{props.joueur.displayName}</span>
        <button
          type="button"
          className="fr-bouton fr-bouton--discret"
          onClick={props.onDeconnexion}
          disabled={props.enCours}
        >
          {props.enCours ? 'Déconnexion…' : 'Se déconnecter'}
        </button>
      </div>
    </header>
  );
}
