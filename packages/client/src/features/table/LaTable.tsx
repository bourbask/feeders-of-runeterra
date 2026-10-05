import type { TableStateDto } from '@for/contracts';
import type { ReactNode } from 'react';

import { EmptyState } from '../../components/ui/EmptyState.js';
import type { PresenceMember } from '../../ws/store.js';

/**
 * The right column (05-interface.md §4.3): the table, then the notebook, then
 * the vows and the tracks.
 *
 * THE NOTEBOOK IS RESERVED, NOT BUILT. §8.5: « La colonne de droite lui est
 * réservée dès M1, vide et étiquetée, pour que la mise en page ne bouge pas
 * quand il arrive. » §8 is marked V2 by the spec, so the place is held by an
 * `EmptyState` that says what it is waiting for (règle 5) — and held by
 * `screens.test.tsx`, which checks the column exists, is empty, and says so.
 *
 * Writing the cards now would cost a panel to demolish; writing nothing at all
 * would let a later M1 layout decision make the column impossible.
 *
 * `characterId ?? playerId` AND NOT A NAME. `s2c.presence` carries no display
 * name (`contracts/src/ws/s2c.ts`). A mirror does not mint one.
 */
export function LaTable(props: {
  readonly presence: readonly PresenceMember[];
  readonly etat: TableStateDto | null;
}): ReactNode {
  const horloges = props.etat?.clocks ?? [];
  const pistes = props.etat?.tracks ?? [];

  return (
    <div className="fr-cote">
      {/* LE TITRE « LA TABLE » A DISPARU (correction 5). Il est remonté dans la
          barre du haut, sous la forme du NOM DE L'AVENTURE — « la table » ne
          nommait rien, c'était l'étiquette d'un panneau qui est déjà le
          panneau de la table. Le nom accessible, lui, reste : il est porté par
          l'`aria-label` de la section, dans `TableRoom.tsx`, pour qu'un lecteur
          d'écran sache toujours dans quel panneau il est (§2.2). */}
      {props.presence.length === 0 ? (
        <EmptyState>Personne d’autre n’est connecté.</EmptyState>
      ) : (
        <ul className="fr-presence">
          {props.presence.map((membre) => (
            <li key={membre.playerId} className="fr-presence__membre">
              <span
                className={
                  membre.online ? 'fr-presence__pastille--en-ligne' : 'fr-presence__pastille'
                }
              />
              {membre.characterId ?? membre.playerId}
              {membre.typing ? <em className="fr-presence__ecrit"> écrit…</em> : null}
            </li>
          ))}
        </ul>
      )}

      <h3 className="fr-cote__sous-titre">Horloges</h3>
      {horloges.length === 0 ? (
        <EmptyState>Aucune horloge ne tourne.</EmptyState>
      ) : (
        <ul className="fr-cote__liste">
          {horloges.map((horloge) => (
            <li key={horloge.id}>
              {horloge.title} — {horloge.filled} / {horloge.segments}
            </li>
          ))}
        </ul>
      )}

      <h3 className="fr-cote__sous-titre">Serments et pistes</h3>
      {pistes.length === 0 ? (
        <EmptyState>Aucun serment prêté, aucune piste ouverte.</EmptyState>
      ) : (
        <ul className="fr-cote__liste">
          {pistes.map((piste) => (
            <li key={piste.id}>
              {piste.title} — {piste.rank}
            </li>
          ))}
        </ul>
      )}

      {/* §8.5 : la place du carnet d'objets, tenue et étiquetée. Vide, et qui
          dit ce qu'elle attend — règle 5. */}
      <h3 className="fr-cote__sous-titre">Carnet d’objets</h3>
      <div className="fr-carnet" data-reserve="v2">
        <EmptyState>
          Réservé. Les cartes d’objets, leur partage et leur toile de dessin arrivent après M1 — la
          place est tenue pour que la mise en page ne bouge pas ce jour-là.
        </EmptyState>
      </div>
    </div>
  );
}
