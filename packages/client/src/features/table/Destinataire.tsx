import type { EventScope } from '@for/engine';
import type { ReactNode } from 'react';

import type { PresenceMember } from '../../ws/store.js';
import { PORTEES_ORDONNEES, porteeVue } from './portee.js';

/**
 * « Le composant le plus important de l'écran » (ADR 0008, 05-interface.md §7).
 *
 * THREE POSITIONS, ALWAYS VISIBLE. §7.1: « un segmenté à trois positions,
 * toujours visible, jamais replié, jamais dans un `⋯` ». So it is a real
 * `radiogroup` with three real radios, rendered unconditionally — there is no
 * `ouvert` prop and no menu, because règle 4 forbids a mode you have to open
 * to discover. What position 2 opens is the LIST OF MEMBERS, which §4.5 names
 * as one of the five surfaces of the centre column: « la modale de sélection
 * des destinataires (§7.1) ». The choice it produces is then written back next
 * to the segmented control, in letters — nothing ends up hidden behind the
 * layer.
 *
 * EACH POSITION CARRIES ITS LABEL AS TEXT, from `portee.ts`. The glyph is
 * `aria-hidden` and the colour is a repetition: a player who reads neither
 * still reads « à toi seul ». That is §5.3 applied to the composer, and it is
 * the same reason — « il peut faire un incident qu'aucune annulation ne
 * répare ».
 *
 * YOU TICK A NAME, YOU DO NOT TYPE ONE (§7.1, §10). `ListeDestinataires` is
 * checkboxes and only checkboxes: there is no `type="text"` in this file, and
 * `Destinataire.test.tsx` asserts the absence by counting the text inputs in
 * the rendered list.
 *
 * WHAT THE PROTOCOL DOES NOT GIVE, AND WHAT THIS DOES ABOUT IT.
 * `s2c.presence` carries `playerId` and `characterId`, and NO display name
 * (`contracts/src/ws/s2c.ts`). A list of twenty-six-character ids is a list
 * nobody ticks correctly. This component shows what it has and says so in
 * place; it does NOT mint a name. Widening the contract is the server's call,
 * not the mirror's (invariant 3). Reported, not worked around.
 */

/**
 * The one blocking warning of the product (§7.2).
 *
 * ADR 0008: « répondre dans le commun à ce qui t'a été dit en privé rend cette
 * information publique ». It is shown BEFORE the send, never after, because
 * this is the accident no undo repairs.
 *
 * A PURE FUNCTION, so `Destinataire.test.tsx` can enumerate the nine
 * (scope answered × scope chosen) pairs instead of clicking through three.
 */
export function avertissementDeclassification(
  porteeDuBloc: EventScope | null,
  porteeChoisie: EventScope,
): string | null {
  if (porteeDuBloc === null) return null;
  if (porteeChoisie !== 'table') return null;
  if (porteeDuBloc === 'table') return null;
  return porteeDuBloc === 'private'
    ? 'Tu réponds en public à un message que toi seul avais reçu.'
    : 'Tu réponds en public à un message qui n’avait été dit qu’à ton groupe.';
}

/**
 * The members, ticked. Lives in the centre layer (§4.5), and is also what a
 * share gesture will reuse in V2 (§8.3, « le même composant »).
 */
export function ListeDestinataires(props: {
  readonly presents: readonly PresenceMember[];
  readonly choisis: readonly string[];
  readonly onChoisis: (choisis: readonly string[]) => void;
}): ReactNode {
  if (props.presents.length === 0) {
    return (
      <p className="fr-vide">Personne d’autre n’est connecté : il n’y a pas de groupe à viser.</p>
    );
  }

  return (
    <>
      <ul className="fr-destinataire__joueurs">
        {props.presents.map((membre) => (
          <li key={membre.playerId}>
            <label>
              <input
                type="checkbox"
                checked={props.choisis.includes(membre.playerId)}
                onChange={() => {
                  props.onChoisis(
                    props.choisis.includes(membre.playerId)
                      ? props.choisis.filter((id) => id !== membre.playerId)
                      : [...props.choisis, membre.playerId],
                  );
                }}
              />{' '}
              {membre.characterId ?? membre.playerId}
            </label>
          </li>
        ))}
      </ul>
      {/* Signalé, pas contourné : le protocole ne porte pas de nom affichable.
          Le dire à l'écran vaut mieux que fabriquer un nom. */}
      <p className="fr-destinataire__manque">
        Les joueurs sans personnage sont listés par leur identifiant : le protocole ne porte pas
        encore de nom affichable.
      </p>
    </>
  );
}

export function Destinataire(props: {
  readonly portee: EventScope;
  readonly onPortee: (portee: EventScope) => void;
  readonly presents: readonly PresenceMember[];
  readonly choisis: readonly string[];
  /** Opens the centre layer that holds the member list (§4.5, §7.1). */
  readonly onOuvrirListe: () => void;
  /** Scope of the block being answered, or `null` outside of a reply (§7.2). */
  readonly porteeDuBloc: EventScope | null;
  /** The player has read the warning and still wants to send. */
  readonly declassificationAcceptee: boolean;
  readonly onAccepterDeclassification: (accepte: boolean) => void;
}): ReactNode {
  const avertissement = avertissementDeclassification(props.porteeDuBloc, props.portee);

  return (
    <div className="fr-destinataire">
      <div className="fr-destinataire__positions" role="radiogroup" aria-label="Destinataires">
        {PORTEES_ORDONNEES.map((vue) => (
          <label className="fr-destinataire__position" key={vue.scope} data-portee={vue.scope}>
            <input
              type="radio"
              name="portee"
              value={vue.scope}
              checked={props.portee === vue.scope}
              onChange={() => {
                props.onPortee(vue.scope);
              }}
            />
            <span className="fr-destinataire__glyphe" aria-hidden="true">
              {vue.glyphe}
            </span>
            <span className="fr-destinataire__libelle">{vue.libelle}</span>
          </label>
        ))}
      </div>

      {props.porteeDuBloc === null ? null : (
        <p className="fr-destinataire__reprise">
          Tu réponds à un bloc dit {porteeVue(props.porteeDuBloc).libelle}.
        </p>
      )}

      {props.portee === 'subset' ? (
        <p className="fr-destinataire__groupe">
          <span className="fr-destinataire__compte">
            {props.choisis.length} destinataire(s) coché(s)
          </span>{' '}
          <button
            type="button"
            className="fr-bouton fr-bouton--discret"
            onClick={props.onOuvrirListe}
          >
            Choisir qui lit
          </button>
        </p>
      ) : null}

      {avertissement === null ? null : (
        <div className="fr-destinataire__avertissement" role="alert">
          <p>⚠ {avertissement}</p>
          <label>
            <input
              type="checkbox"
              checked={props.declassificationAcceptee}
              onChange={(evenement) => {
                props.onAccepterDeclassification(evenement.target.checked);
              }}
            />{' '}
            J’ai lu, et je l’envoie quand même à toute la table.
          </label>
        </div>
      )}
    </div>
  );
}
