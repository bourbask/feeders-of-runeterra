import type { ChampionCard, ChampionCatalogueResponse, CharacterSummary } from '@for/contracts';
import { normalizeAlias } from '@for/contracts';
import type { ChampionLock, ChampionLockKind } from '@for/engine';
import { ATTRIBUTES, CHAMPION_LOCK_KINDS } from '@for/engine';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { rejectionMessage } from '../api/error-messages.js';
import { Button } from '../components/ui/Button.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Panel } from '../components/ui/Panel.js';
import { ATTRIBUTS } from '../features/table/attributs.js';
import '../styles/personnage.css';
import { useTable, useTableStoreApi } from '../ws/context.js';
import { routeHref } from './route.js';

/**
 * Choosing a champion — and the screen that sends the FIRST INTENT this client
 * has ever put on the wire (`c2s.intent`, `character.create_draft`).
 *
 * ══ WHAT THIS SCREEN DOES NOT DO ══════════════════════════════════════════
 *
 * IT DOES NOT RESERVE ANYTHING. The champion lock is posted by
 * `character.created`, written by the server through the SAME journal as play
 * (`contracts/src/intents/index.ts`: « le MÊME journal que le jeu »). There is
 * one write path and this screen is not it: pressing the button sends a
 * question and waits. Nothing below marks a champion as taken, opens the
 * table, or writes a line — `screens.test.tsx`, « n'ouvre pas la table toute
 * seule : elle attend le serveur ».
 *
 * IT DOES NOT LET A PLAYER DISTRIBUTE ATTRIBUTES. `decideCreateDraft` accepts
 * exactly 3/2/2/1/1 and the champion SHEET already carries one such spread
 * (`attributes`, validated by `zAttributeSpread`). So the five values are
 * shown and sent back unchanged: there is no choice to offer, and inventing
 * one would be a mechanic, not an interface. Reported with the task.
 *
 * IT DOES NOT EDIT THE DISTRIBUTION. §4 of the sheet asks for the three
 * families of locks to be visible; no intent can change one. `zIntent` holds
 * no `campaign.lock_champion` and none is invented here — the screen says so
 * in so many words instead.
 */

/**
 * What each lock family is called on screen, and what it means for a player.
 *
 * TYPED ON THE ENGINE'S CLOSED UNION, so a fourth `ChampionLockKind` does not
 * compile until this screen says what it is called. Exported because
 * `screens.test.tsx` compares its keys to `CHAMPION_LOCK_KINDS` — two origins,
 * and a family deleted from here falls over.
 */
export const FAMILLES: Readonly<Record<ChampionLockKind, { titre: string; explication: string }>> =
  {
    reserved_pc: {
      titre: 'Verrouillés — n’apparaissent jamais',
      explication:
        'Les mains de la bande. Le conteur ne les fera jamais intervenir — ni en allié, ni en adversaire. Personne ne tombe sur son propre perso.',
    },
    allowed_npc: {
      titre: 'PNJ de la campagne',
      explication: 'Le conteur peut les faire entrer en scène.',
    },
    banned: {
      titre: 'Écartés de cette table',
      explication: 'Ni joueur, ni conteur : ils ne sont pas de cette histoire.',
    },
  };

/**
 * Whether this champion can still be asked for.
 *
 * THE RULE IS THE ENGINE'S, MIRRORED — `decideCreateDraft` refuses a champion
 * whose lock is anything other than `allowed_npc`. Hiding a card the server
 * would refuse is a courtesy, not an authority: the refusal still comes from
 * the server, and this screen shows it when it does.
 */
function estLibre(verrou: ChampionLock | undefined): boolean {
  return verrou === undefined || verrou.lockKind === 'allowed_npc';
}

/**
 * The search, over the NAME and the REGION, accents and case ignored.
 *
 * `normalizeAlias` is the contracts' own normal form — the one the
 * distribution lock compares on — rather than a second `toLowerCase()` that
 * would disagree with it on « Bràum » the day someone types it.
 */
function correspond(champion: ChampionCard, recherche: string): boolean {
  const cherche = normalizeAlias(recherche);
  if (cherche === '') return true;
  return [champion.name, champion.title, champion.regionName ?? champion.regionId]
    .map((morceau) => normalizeAlias(morceau))
    .some((morceau) => morceau.includes(cherche));
}

function Carte(props: {
  readonly champion: ChampionCard;
  readonly enAttente: boolean;
  readonly onChoisir: () => void;
}): ReactNode {
  const champion = props.champion;
  return (
    <li className="fr-champion">
      <h3 className="fr-champion__nom">{champion.name}</h3>
      <p className="fr-champion__region">{champion.regionName ?? champion.regionId}</p>
      <p className="fr-champion__titre">{champion.title}</p>
      <p className="fr-champion__accroche">{champion.pitch}</p>
      <ul className="fr-champion__attributs">
        {ATTRIBUTES.map((attribut) => (
          <li key={attribut}>
            <span className="fr-champion__attribut-nom">{ATTRIBUTS[attribut]}</span>{' '}
            <span className="fr-champion__attribut-valeur">{champion.attributes[attribut]}</span>
          </li>
        ))}
      </ul>
      <Button onClick={props.onChoisir} disabled={props.enAttente}>
        Prendre {champion.name}
      </Button>
    </li>
  );
}

export function CharacterPicker(props: {
  readonly campaignId: string;
  readonly personnages: readonly CharacterSummary[];
  /** `null` while the catalogue is being read, or when the read failed. */
  readonly catalogue: ChampionCatalogueResponse | null;
  readonly erreurCatalogue: string | null;
}): ReactNode {
  const [recherche, setRecherche] = useState('');
  const [histoire, setHistoire] = useState('');
  const store = useTableStoreApi();
  const verrous = useTable((state) => state.table?.championLocks ?? null);
  const refus = useTable((state) => state.lastRejection);
  const enVol = useTable((state) => state.pendingIntent);

  const miens = props.personnages.filter(
    (personnage) => personnage.campaignId === props.campaignId,
  );
  const parChampion = new Map((verrous ?? []).map((verrou) => [verrou.championId, verrou]));
  const champions = props.catalogue?.champions ?? [];
  const offerts = champions
    .filter((champion) => estLibre(parChampion.get(champion.id)))
    .filter((champion) => correspond(champion, recherche));

  const choisir = (champion: ChampionCard): void => {
    store.getState().sendIntent({
      type: 'character.create_draft',
      championSlug: champion.id,
      spread: champion.attributes,
      background: histoire,
    });
  };

  return (
    <main className="fr-ecran fr-ecran--personnage">
      <h1 className="fr-personnage__titre">Choisis ton champion</h1>

      {miens.length === 0 ? null : (
        <Panel titre="Ton champion">
          <ul className="fr-personnages">
            {miens.map((personnage) => (
              <li key={personnage.id}>
                {personnage.displayName} — {personnage.championId} ({personnage.status})
              </li>
            ))}
          </ul>
          <a href={routeHref({ nom: 'table', campaignId: props.campaignId })}>Revenir à la table</a>
        </Panel>
      )}

      <div className="fr-recherche">
        <label className="fr-recherche__libelle" htmlFor="fr-recherche-champion">
          Chercher un champion ou une région
        </label>
        <input
          id="fr-recherche-champion"
          className="fr-recherche__champ"
          type="search"
          placeholder="Chercher un champion ou une région…"
          value={recherche}
          onChange={(evenement) => {
            setRecherche(evenement.target.value);
          }}
        />
      </div>

      <div className="fr-recherche">
        <label className="fr-recherche__libelle" htmlFor="fr-histoire">
          Ce que tu veux qu’on raconte de lui (facultatif)
        </label>
        <textarea
          id="fr-histoire"
          className="fr-recherche__champ"
          value={histoire}
          onChange={(evenement) => {
            setHistoire(evenement.target.value);
          }}
        />
      </div>

      {/* LE REFUS EST UN RÉSULTAT, L'ENVOI N'EN EST PAS UN. Les deux bandeaux
          ne disent donc pas la même chose : l'un rapporte ce que le serveur a
          répondu, l'autre dit seulement qu'on attend. */}
      {refus === null ? null : (
        <p className="fr-personnage__refus" role="alert">
          {rejectionMessage(refus.code)} <span className="fr-personnage__code">{refus.code}</span>
        </p>
      )}
      {enVol === null ? null : (
        <p className="fr-personnage__attente" role="status">
          Demande envoyée. Cet écran attend la réponse du serveur : il ne décide rien tout seul.
        </p>
      )}

      {props.erreurCatalogue !== null ? (
        <EmptyState>{props.erreurCatalogue}</EmptyState>
      ) : props.catalogue === null ? (
        <EmptyState>Les champions arrivent…</EmptyState>
      ) : offerts.length === 0 ? (
        <EmptyState>Aucun champion ne répond à cette recherche.</EmptyState>
      ) : (
        <ul className="fr-champions">
          {offerts.map((champion) => (
            <Carte
              key={champion.id}
              champion={champion}
              enAttente={enVol !== null}
              onChoisir={() => {
                choisir(champion);
              }}
            />
          ))}
        </ul>
      )}

      {props.catalogue === null ? null : (
        <p className="fr-personnage__manque">
          {props.catalogue.champions.length} fiche(s) jouable(s) pour {props.catalogue.namedInIndex}{' '}
          champions nommés par l’annuaire : les autres n’ont pas encore de fiche dans
          `content/champions/`. C’est du contenu à écrire, pas un écran à corriger.
        </p>
      )}

      <Panel titre="La distribution">
        {verrous === null ? (
          <EmptyState>
            La table n’a pas encore envoyé son état : la distribution s’affichera avec lui.
          </EmptyState>
        ) : (
          CHAMPION_LOCK_KINDS.map((genre) => (
            <section key={genre} className="fr-distribution">
              <h3 className="fr-distribution__titre">{FAMILLES[genre].titre}</h3>
              <p className="fr-distribution__explication">{FAMILLES[genre].explication}</p>
              {verrous.filter((verrou) => verrou.lockKind === genre).length === 0 ? (
                <EmptyState>Aucun.</EmptyState>
              ) : (
                <ul className="fr-distribution__liste">
                  {verrous
                    .filter((verrou) => verrou.lockKind === genre)
                    .map((verrou) => (
                      <li key={verrou.championId}>{verrou.championId}</li>
                    ))}
                </ul>
              )}
            </section>
          ))
        )}
        <p className="fr-personnage__manque">
          Cette liste se lit, elle ne se modifie pas : aucune intention du protocole ne pose ni ne
          lève un verrou. Seul `character.created`, écrit par le serveur, en pose un — et seulement
          du genre « verrouillé ».
        </p>
      </Panel>
    </main>
  );
}
