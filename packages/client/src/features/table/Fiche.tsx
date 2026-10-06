import type { CharacterStateDto } from '@for/contracts';
import type { GaugeId } from '@for/engine';
import { ATTRIBUTES } from '@for/engine';
import type { ReactNode } from 'react';

import { EmptyState } from '../../components/ui/EmptyState.js';
import { ATTRIBUTS } from './attributs.js';
import { Elan } from './Elan.js';
import { Jauges } from './Jauge.js';

/**
 * The « vous » column (05-interface.md §4.3) — your sheet, and nothing else.
 *
 * FOUR THINGS, IN THIS ORDER, because the order is the spec's: identity, the
 * three gauges, the traits, your assets. « Ce qui n'est pas "ce que vous êtes
 * sans l'avoir cherché" est dans la colonne de droite, y compris vos propres
 * serments. »
 *
 * TWO THINGS THE PROTOCOL DOES NOT CARRY, SAID OUT LOUD RATHER THAN INVENTED:
 *
 *   - §4.3 asks for « nom du champion, titre, région ». `zCharacterState`
 *     carries `displayName` and `championId`; there is no title and no region
 *     on the wire.
 *   - §4.3 asks that an asset's TRIGGER be « affiché en entier, jamais
 *     abrégé », because it is what stops the ridicule (ADR 0009).
 *     `zCharacterAsset` carries `assetId`, the indexes of the unlocked
 *     abilities and a map of options — the trigger lives in the content pack,
 *     which this client never reads. Showing the id and saying what is missing
 *     is the only honest rendering; filling the gap would mean the client
 *     holding a copy of the content, which is invariant 3 lost sideways.
 *
 * Reported in the PR, not worked around.
 */

export function Fiche(props: {
  readonly personnage: CharacterStateDto | null;
  readonly modifiee: GaugeId | null;
  readonly fenetreOuverte: boolean;
  /** `false` on a phone: the gauges are already a banner at the top (§4.4). */
  readonly avecJauges?: boolean;
}): ReactNode {
  const personnage = props.personnage;

  return (
    <div className="fr-fiche">
      <h2 className="fr-rail__titre">Vous</h2>

      {personnage === null ? (
        <EmptyState>
          Aucun personnage ne vous est attaché à cette table : la fiche attend que le serveur en
          nomme un.
        </EmptyState>
      ) : (
        <p className="fr-fiche__identite">
          <span className="fr-fiche__nom">{personnage.displayName}</span>
          <span className="fr-fiche__champion">{personnage.championId}</span>
        </p>
      )}

      {props.avecJauges === false ? null : (
        <Jauges
          valeurs={personnage === null ? null : personnage.gauges}
          modifiee={props.modifiee}
        />
      )}

      {personnage === null ? null : (
        <Elan valeur={personnage.momentum} fenetreOuverte={props.fenetreOuverte} />
      )}

      <h3 className="fr-fiche__sous-titre">Traits</h3>
      {personnage === null ? (
        <EmptyState>Rien à montrer tant qu’aucun personnage n’est attaché.</EmptyState>
      ) : (
        <ul className="fr-fiche__traits">
          {ATTRIBUTES.map((attribut) => (
            <li key={attribut}>
              <span className="fr-fiche__trait-nom">{ATTRIBUTS[attribut]}</span>{' '}
              <span className="fr-fiche__trait-valeur">{personnage.attributes[attribut]}</span>
            </li>
          ))}
          {personnage.conditions.map((condition) => (
            <li key={condition.conditionId} className="fr-fiche__condition">
              {condition.label}
            </li>
          ))}
        </ul>
      )}

      <h3 className="fr-fiche__sous-titre">Vos atouts</h3>
      {personnage === null || personnage.assets.length === 0 ? (
        <EmptyState>Aucun atout n’est encore inscrit sur cette fiche.</EmptyState>
      ) : (
        <ul className="fr-fiche__atouts">
          {personnage.assets.map((atout) => (
            <li key={atout.assetId}>{atout.assetId}</li>
          ))}
        </ul>
      )}
      <p className="fr-fiche__manque">
        Le déclencheur d’un atout vit dans le paquet de contenu, que le client ne lit pas : le
        protocole n’en porte que l’identifiant.
      </p>
    </div>
  );
}
