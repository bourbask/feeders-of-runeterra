import type { TableStateDto } from '@for/contracts';
import type { ReactNode } from 'react';
import { Fragment, useMemo } from 'react';

import { EmptyState } from '../../components/ui/EmptyState.js';
import { useTable } from '../../ws/context.js';
import type { JournalLine } from '../../ws/journal.js';
import type { PresenceMember } from '../../ws/store.js';
import { journalLines } from '../../ws/store.js';
import { ProofCommand } from './Proof/ProofCommand.js';
import { groupeDe, phraseDesManquants, phraseDuGroupe } from './destinataires.js';
import type { BlocDuFil } from './fil.js';
import { composerLeFil } from './fil.js';
import { porteeVue } from './portee.js';

/**
 * The fiction feed, on its rails (05-interface.md §5, amended 5 October).
 *
 * WHAT IT SHOWS: prose, and the oracle's question and answer. WHAT IT NEVER
 * SHOWS: a die, a total, an effect name, a price — those have no field on a
 * `JournalLine` to begin with (`ws/journal.ts`) and reach the screen only
 * through « Pourquoi ? ».
 *
 * THE PUBLIC BLOCK IS BARE (correction 3). No rail, no indentation, no glyph,
 * no band: « le public est le défaut, et un défaut ne s'annonce pas ». A
 * restricted block, on the other hand, carries FIVE channels at once — the band
 * in letters WITH THE NAMES of who reads it, the glyph, the indentation, a
 * stroke that is solid for a group and dashed for a private block (arbitration
 * B), and a colour. Four of the five survive having every colour torn off, and
 * that is what `screens.test.tsx` measures.
 *
 * THE BAND IS WRITTEN ONCE PER RUN (correction 2), and the run is a scope AND a
 * group: see `fil.ts`, which owns every rule about a block's neighbours.
 *
 * WHO READS IT, BY NAME (correction 8). The band says « vous 2 — Kevin et
 * Théo ». The names are JOINED from presence and the snapshot, never minted,
 * and the group carries a MECHANICAL KEY so that two different groups are never
 * read as one. What is missing is written on screen, in words, beside the
 * names: see `destinataires.ts`.
 *
 * SPEECH IS NOT NARRATION, AND THE MARKUP SAYS SO (correction 12). A player's
 * words are in a real `<em>`, the speaker's name in a plain `<span>`, and the
 * block carries `data-voix`. The day a reading voice speaks the table, it reads
 * `data-voix="recit"` and nothing else — players already talk on Discord. A CSS
 * class would not survive that, so the distinction is not a class.
 *
 * « POURQUOI ? » IS DEFERRED (correction 11). The dice are set aside and
 * attached to the block that FOLLOWS the roll, never to the roll's own turn as
 * it happens. One per rolled turn, and none at all while nothing has followed.
 *
 * A CANCELLED LINE STAYS. It is struck, it carries its cause, and it keeps its
 * « Pourquoi ? » (02-mj-ia.md 4.8.6 (b)).
 */

const ETIQUETTES: Readonly<Record<JournalLine['kind'], string>> = {
  scene: 'Scène',
  conteur: 'Le conteur',
  joueur: 'Un joueur',
  systeme: 'Note',
  oracle: 'L’oracle',
  mecanique: '',
};

/** What a reading voice would speak, and what it would skip. */
const VOIX: Readonly<Record<JournalLine['kind'], 'recit' | 'parole' | 'oracle' | 'aucune'>> = {
  scene: 'recit',
  conteur: 'recit',
  joueur: 'parole',
  systeme: 'aucune',
  oracle: 'oracle',
  mecanique: 'aucune',
};

/** A line's identity in the feed: its journal number and its delivery number. */
function cle(ligne: JournalLine): string {
  return `${String(ligne.seq)}:${String(ligne.deliverySeq)}`;
}

/**
 * The band that names who reads a restricted block (§5.2, correction 8).
 *
 * Rendered for a restricted scope only, and only on the block that opens the
 * run. A public block gets nothing — `marque` is false and this returns `null`.
 */
function Bandeau(props: {
  readonly ligne: JournalLine;
  readonly presence: readonly PresenceMember[];
  readonly table: TableStateDto | null;
}): ReactNode {
  const vue = porteeVue(props.ligne.scope);
  if (!vue.marque) return null;

  const groupe = groupeDe(props.ligne.recipients ?? [], props.presence, props.table);
  const manquants = phraseDesManquants(groupe);

  return (
    <span className="fr-bloc__portee" data-portee={vue.scope}>
      <span className="fr-bloc__glyphe" aria-hidden="true">
        {vue.glyphe}
      </span>
      {/* LE LIBELLÉ EST TOUJOURS LÀ, en texte, sur toute portée marquée. C'est
          le seul canal qu'un joueur daltonien lit à coup sûr (§5.3). */}
      <span className="fr-bloc__libelle">{vue.libelle}</span>
      {props.ligne.scope === 'subset' ? (
        <>
          <span className="fr-bloc__qui"> · {phraseDuGroupe(groupe)}</span>
          {/* L'identifiant mécanique du groupe. Il ne décore pas : c'est lui qui
              dit que deux bandeaux parlent du MÊME groupe, et il est écrit
              plutôt que deviné. */}
          <span className="fr-bloc__cle" title={groupe.membres.join(' ')}>
            {' '}
            ({groupe.cle})
          </span>
          {manquants === null ? null : <span className="fr-bloc__manque"> · {manquants}</span>}
        </>
      ) : null}
    </span>
  );
}

/** « le groupe s'est séparé » — the event that creates the rails (correction 9). */
function Rupture(): ReactNode {
  return (
    <li className="fr-journal__rupture" data-rupture="true">
      <span className="fr-journal__rupture-libelle">le groupe s’est séparé</span>
    </li>
  );
}

function Corps(props: { readonly ligne: JournalLine }): ReactNode {
  const ligne = props.ligne;

  if (ligne.kind === 'oracle') {
    // « question — RÉPONSE ». Two elements, not one string: the question and
    // the answer are different things and a voice must be able to tell them
    // apart (correction 13).
    return (
      <span className="fr-journal__texte fr-journal__oracle">
        {ligne.speaker === null ? null : (
          <>
            <span className="fr-journal__oracle-question">{ligne.speaker}</span>
            <span aria-hidden="true"> — </span>
          </>
        )}
        <b className="fr-journal__oracle-reponse">{ligne.text}</b>
      </span>
    );
  }

  // A PLAYER'S WORDS ARE IN AN `<em>`, the narration is not. The element is the
  // distinction; the italic is only what the element looks like.
  if (ligne.kind === 'joueur') {
    return <em className="fr-journal__texte fr-journal__parole">{ligne.text}</em>;
  }

  return <span className="fr-journal__texte">{ligne.text}</span>;
}

function Bloc(props: {
  readonly bloc: BlocDuFil;
  readonly presence: readonly PresenceMember[];
  readonly table: TableStateDto | null;
}): ReactNode {
  const { bloc } = props;
  const ligne = bloc.ligne;
  const vue = porteeVue(ligne.scope);

  return (
    <li
      className={`fr-journal__ligne fr-journal__ligne--${ligne.kind}${
        ligne.revoked === null ? '' : ' fr-journal__ligne--annulee'
      }${bloc.promu ? ' fr-journal__ligne--promu' : ''}`}
      data-portee={vue.scope}
      data-niveau={String(vue.niveau)}
      data-trait={vue.trait}
      data-voix={VOIX[ligne.kind]}
      {...(bloc.promu ? { 'data-promu': 'true' } : {})}
      {...(ligne.revoked === null ? {} : { 'data-annulee': 'true' })}
    >
      {bloc.ouvreUneSuite ? (
        <Bandeau ligne={ligne} presence={props.presence} table={props.table} />
      ) : null}
      {ligne.kind === 'oracle' ? null : (
        <span className="fr-journal__qui">{ligne.speaker ?? ETIQUETTES[ligne.kind]}</span>
      )}
      {ligne.revoked === null ? (
        <Corps ligne={ligne} />
      ) : (
        <span className="fr-journal__texte">
          <s>{ligne.text}</s>
          <span className="fr-annule">
            {' '}
            — annulé : {ligne.revoked.reason} (journal n° {ligne.revoked.bySeq})
          </span>
        </span>
      )}
      {/* APRÈS l'envoi, dans le fil — l'avertissement du §7.2 est AVANT, dans le
          compositeur. Les deux sont voulus, et celui-ci dit QUI a déclassifié. */}
      {bloc.promu ? (
        <span className="fr-journal__promu" data-promu="true">
          Ce joueur a répondu en public à ce que lui seul avait reçu : il l’a rendu public, personne
          d’autre.
        </span>
      ) : null}
      {bloc.preuveDuTour === null ? null : <ProofCommand correlationId={bloc.preuveDuTour} />}
    </li>
  );
}

export function Journal(): ReactNode {
  // Deux selecteurs stables plutot qu'un qui calcule : `journalLines` rend un
  // tableau neuf a chaque appel, et `useSyncExternalStore` refuse un instantane
  // qui change d'identite a chaque rendu.
  const lines = useTable((state) => state.lines);
  const history = useTable((state) => state.history);
  const revocations = useTable((state) => state.revocations);
  const presence = useTable((state) => state.presence);
  const table = useTable((state) => state.table);

  const blocs = useMemo(
    () => composerLeFil(journalLines({ lines, history, revocations })),
    [lines, history, revocations],
  );

  if (blocs.length === 0) {
    return <EmptyState>La table est ouverte. Rien ne s’est encore passé.</EmptyState>;
  }

  return (
    <ol className="fr-journal">
      {blocs.map((bloc) => (
        <Fragment key={cle(bloc.ligne)}>
          {bloc.rupture ? <Rupture /> : null}
          <Bloc bloc={bloc} presence={presence} table={table} />
        </Fragment>
      ))}
    </ol>
  );
}
