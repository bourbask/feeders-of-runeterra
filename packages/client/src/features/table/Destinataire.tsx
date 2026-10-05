import type { TableStateDto } from '@for/contracts';
import type { EventScope } from '@for/engine';
import type { ReactNode } from 'react';

import type { PresenceMember } from '../../ws/store.js';
import { enumerer, groupeDe, phraseDesManquants } from './destinataires.js';
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
 * YOU ALWAYS KNOW WHO WILL READ IT, BEFORE YOU SEND (correction 8). Under the
 * three positions, in letters: « Lu par Kevin, Théo ». Not a count, names — and
 * the group's MECHANICAL KEY beside them, so that « this group » means the same
 * group it meant two blocks ago in the feed (`destinataires.ts`).
 *
 * WHAT THE PROTOCOL DOES NOT GIVE, AND WHAT THIS DOES ABOUT IT.
 * `s2c.presence` carries `playerId` and `characterId`, and NO display name
 * (`contracts/src/ws/s2c.ts`). A name is therefore JOINED — presence gives the
 * character, the snapshot gives its `displayName` — and a recipient the join
 * misses has NO name, which this component writes out instead of printing an
 * id inside a sentence. It does NOT mint one. Widening the contract is the
 * server's call, not the mirror's (invariant 3), and the group's own durable
 * identity is issue 116. Reported, not worked around.
 *
 * NO `#` BEFORE THAT NUMBER, AND IT IS NOT A TYPO. `tokens.test.ts` forbids a
 * hard-coded colour by matching `#` followed by three to eight hex digits, in
 * the RAW file — comments included. Three digits after a hash is three hex
 * digits, so the issue number is written without one. The guard is
 * right to be blunt and the cost of obeying it is one character.
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
  /** The snapshot, where a character's `displayName` lives. */
  readonly table?: TableStateDto | null;
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
              {groupeDe([membre.playerId], props.presents, props.table ?? null).noms[0] ??
                membre.characterId ??
                membre.playerId}
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
  /** The snapshot, where a character's `displayName` lives. */
  readonly table?: TableStateDto | null;
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

/**
 * « Lu par … », UNDER THE FIELD and before the send (correction 8).
 *
 * Under the FIELD and not under the three positions, which is where it first
 * landed and where it was wrong: the sentence answers « qui va lire ce que je
 * viens d'écrire », so it belongs beside the send button, at the moment one
 * reaches for it — not above, where it is read before there is anything to
 * send. `Compositeur` places it; this file only knows how to word it.
 *
 * THE THREE SCOPES ANSWER THE SAME QUESTION. A player must never have to
 * deduce who reads him from which radio is lit: the sentence is written for
 * all three, and for a group it carries the names AND the mechanical key.
 */
export function LuPar(props: {
  readonly portee: EventScope;
  readonly presents: readonly PresenceMember[];
  readonly choisis: readonly string[];
  readonly table: TableStateDto | null;
}): ReactNode {
  if (props.portee === 'table') {
    return <p className="fr-destinataire__lu">Lu par toute la table.</p>;
  }
  if (props.portee === 'private') {
    return <p className="fr-destinataire__lu">Lu par toi seul.</p>;
  }

  if (props.choisis.length === 0) {
    return (
      <p className="fr-destinataire__lu">Personne n’est coché : ce message n’a aucun lecteur.</p>
    );
  }

  const groupe = groupeDe(props.choisis, props.presents, props.table);
  const manquants = phraseDesManquants(groupe);

  return (
    <p className="fr-destinataire__lu">
      {groupe.noms.length === 0 ? 'Lu par ' : `Lu par ${enumerer(groupe.noms)}`}
      {groupe.noms.length === 0 ? (
        <span>{String(groupe.membres.length)} joueur(s)</span>
      ) : null}{' '}
      <span className="fr-destinataire__cle" title={groupe.membres.join(' ')}>
        ({groupe.cle})
      </span>
      {manquants === null ? null : <span className="fr-destinataire__manque"> · {manquants}</span>}
    </p>
  );
}
