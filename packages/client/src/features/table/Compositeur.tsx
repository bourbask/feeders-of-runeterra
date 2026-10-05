import type { TableStateDto } from '@for/contracts';
import { zSpeechSayIntent } from '@for/contracts';
import type { EventScope } from '@for/engine';
import type { ReactNode } from 'react';

import type { PresenceMember } from '../../ws/store.js';
import { Destinataire, LuPar, avertissementDeclassification } from './Destinataire.js';

/**
 * Where a player writes, at the bottom of the centre column (05-interface.md
 * §4.3, §7).
 *
 * ONE FIELD, ONE QUESTION OF RECIPIENT (§7.3). No « GM » mode, no hidden
 * channel, no per-player conversation: those are M1 and ADR 0008 says so.
 *
 * THE LIMIT IS READ OFF THE CONTRACT, not retyped. `zSpeechSayIntent` says
 * 2000; writing 2000 here would be a second place to be wrong, and a counter
 * that disagrees with the server is a counter that lets a player write a
 * message the server refuses. If zod ever stops exposing the bound, `maxLength`
 * is `null` and the counter says so rather than inventing one.
 *
 * THE SEND BUTTON IS DISABLED, AND SAYS WHY. The client-side intent pipeline is
 * not wired in M0 — the M0-19 shells said so and this screen replaces them —
 * and §10 forbids « un bouton
 * qui n'explique pas ce qu'il va envoyer ». §9 forbids hiding it: « Désactivé
 * n'est pas invisible. » So it is rendered, disabled, with the reason beside
 * it — and it comes alive the day `onEnvoyer` is handed in.
 *
 * WHO WILL READ IT IS WRITTEN UNDER THE FIELD, BEFORE THE SEND (correction 8).
 * « Lu par Kevin, Théo », with the group's mechanical key. That is
 * `Destinataire`'s business, and this component only hands it the snapshot the
 * names are joined from.
 *
 * THE DRAFT IS NOT IN THIS COMPONENT. It is held above (`TableRoom`), so a
 * frame from the server re-rendering the feed cannot take the text with it
 * (§9, « un brouillon n'est jamais perdu »). Held by `screens.test.tsx`.
 */

/** 2000, as the contract says it. `null` if the schema stops exposing it. */
export const LIMITE_TEXTE: number | null = zSpeechSayIntent.shape.text.maxLength;

export function Compositeur(props: {
  readonly texte: string;
  readonly onTexte: (texte: string) => void;
  readonly portee: EventScope;
  readonly onPortee: (portee: EventScope) => void;
  readonly presents: readonly PresenceMember[];
  readonly choisis: readonly string[];
  readonly onOuvrirListe: () => void;
  readonly porteeDuBloc: EventScope | null;
  readonly declassificationAcceptee: boolean;
  readonly onAccepterDeclassification: (accepte: boolean) => void;
  /** The last error the server sent, or `null`. Shown ABOVE the field (§9). */
  readonly erreur: string | null;
  /** The snapshot, so « Lu par … » can name people instead of counting them. */
  readonly table?: TableStateDto | null;
  /** Absent while the intent pipeline is not wired. The button then says so. */
  readonly onEnvoyer?: () => void;
}): ReactNode {
  const avertissement = avertissementDeclassification(props.porteeDuBloc, props.portee);
  const bloqueParDeclassification = avertissement !== null && !props.declassificationAcceptee;
  const envoiCable = props.onEnvoyer !== undefined;

  return (
    <form
      className="fr-compositeur"
      aria-label="Ce que tu fais"
      onSubmit={(evenement) => {
        evenement.preventDefault();
      }}
    >
      <Destinataire
        portee={props.portee}
        onPortee={props.onPortee}
        presents={props.presents}
        choisis={props.choisis}
        onOuvrirListe={props.onOuvrirListe}
        porteeDuBloc={props.porteeDuBloc}
        declassificationAcceptee={props.declassificationAcceptee}
        onAccepterDeclassification={props.onAccepterDeclassification}
        table={props.table ?? null}
      />

      {/* AU-DESSUS du champ, et le brouillon reste (§9). */}
      {props.erreur === null ? null : (
        <p className="fr-compositeur__erreur" role="alert">
          {props.erreur}
        </p>
      )}

      <label className="fr-compositeur__champ" htmlFor="fr-compositeur-texte">
        <span className="fr-compositeur__etiquette">Ce que tu fais…</span>
        <textarea
          id="fr-compositeur-texte"
          value={props.texte}
          placeholder="Ce que tu fais…"
          {...(LIMITE_TEXTE === null ? {} : { maxLength: LIMITE_TEXTE })}
          onChange={(evenement) => {
            props.onTexte(evenement.target.value);
          }}
        />
      </label>

      {/* SOUS LA SAISIE, à côté du bouton : « Lu par Kevin, Théo » (correction
          8). Au-dessus du champ, elle serait lue avant qu'il y ait quoi que ce
          soit à envoyer. */}
      <LuPar
        portee={props.portee}
        presents={props.presents}
        choisis={props.choisis}
        table={props.table ?? null}
      />

      <p className="fr-compositeur__pied">
        <button
          type="button"
          className="fr-bouton fr-bouton--principal"
          disabled={!envoiCable || bloqueParDeclassification || props.texte.trim() === ''}
          onClick={() => {
            props.onEnvoyer?.();
          }}
        >
          ⏎ envoyer
        </button>{' '}
        <span className="fr-compositeur__compte">
          {props.texte.length}
          {LIMITE_TEXTE === null ? '' : ` / ${String(LIMITE_TEXTE)}`}
        </span>
        {envoiCable ? null : (
          <span className="fr-compositeur__raison">
            {' '}
            — l’envoi d’intentions n’est pas encore câblé côté client.
          </span>
        )}
      </p>
    </form>
  );
}
