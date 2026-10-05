import type { EventScope } from '@for/engine';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useReducer, useState } from 'react';

import { rejectionMessage } from '../api/error-messages.js';
import { Compositeur } from '../features/table/Compositeur.js';
import { ListeDestinataires } from '../features/table/Destinataire.js';
import { Fiche } from '../features/table/Fiche.js';
import { Jauges } from '../features/table/Jauge.js';
import { Journal } from '../features/table/Journal.js';
import { LaTable } from '../features/table/LaTable.js';
import { Modale } from '../features/table/Modale.js';
import { BoutonTiroir, Tiroir } from '../features/table/Tiroir.js';
import { CALQUES_FERMES, reduireCalques } from '../features/table/calques.js';
import type { Largeur } from '../features/table/largeur.js';
import { coteEnTiroir, ficheEnTiroir, largeurDe } from '../features/table/largeur.js';
import '../styles/table.css';
import { useTable } from '../ws/context.js';
import { isReadable } from '../ws/journal.js';
import { journalLines } from '../ws/store.js';

/**
 * The table screen (05-interface.md §4, §5, §6). It replaces the M0-19
 * scaffold the spec itself calls « le coquillage M0 ».
 *
 * FOUR COLUMNS, THREE TRACKS (§4.1). The two outer cells are elastic and each
 * holds a rail plus the margin around it; the centre is a reading column and
 * nothing else. The three floors are `0rem`, which is the whole mechanism:
 * « avec 0rem comme plancher, les deux pistes élastiques absorbent tout le
 * manque, elles tombent à zéro, et la grille NE PEUT PAS déborder ». The sum of
 * the floors is checked against `--seuil-tiroir-tout` by `tokens.test.ts`.
 *
 * THE SHAPE IS A PURE FUNCTION OF THE WIDTH (`largeur.ts`). `EcranDeTable`
 * takes it as a value so a test can ask what the narrow screen looks like
 * without a viewport; `TableRoom` is the same screen with the browser's width
 * plugged in.
 *
 * NEVER TWO PANELS AT ONCE (règle 7). Everything that can be open lives in one
 * reducer, `calques.ts`, with one drawer slot and one layer slot. Opening
 * either empties the other, so « un seul tiroir à la fois » and « ouvrir un
 * calque referme le tiroir » are properties of a function, not of whoever
 * remembers to call the second setter. `atMostOneDialog.test.tsx` counts the
 * `dialog` roles on screen after each gesture.
 *
 * THE LEFT DRAWER IS DELIBERATELY LESS REACHABLE THAN THE RIGHT (§4.4): « la
 * fiche est l'information que l'on consulte, l'inventaire est celle dont on a
 * besoin tout de suite ». On a narrow screen the right push-button comes FIRST
 * in reading order. Held by `screens.test.tsx`.
 *
 * WHAT 5 OCTOBER MOVED, AND WHY EACH MOVE IS HERE AND NOT IN A STYLESHEET.
 *
 *   - THE FEED HAS A CEILING AND SCROLLS (correction 1). It used to push the
 *     page down for ever and shove the composer off screen. The ceiling is
 *     `--ecran-fil-hauteur`, and it applies ONLY to the `assise` shape: below
 *     that width there is no room to spare, and the constraint drops. The width
 *     is the one `largeur.ts` already computes — a media query would have been
 *     a second source for a number `tokens.css` owns, and the §4.2 rule is that
 *     these are SEUILS with a test, not media queries.
 *   - THE TECHNICAL BANNER LEFT THE PLAYING AREA (correction 4). « Liaison …
 *     journal n° 248 » is software talking about itself; it belongs in the top
 *     bar, left of the player's name. `BarreTechnique` is exported for that,
 *     and `App.tsx` hands it to `AppHeader` from INSIDE the store provider —
 *     which is the only reason the header is rendered there for this route.
 *   - « LA TABLE » IS NOT A TITLE ANY MORE (correction 5). The adventure's name
 *     took its place in the bar. The panel keeps an accessible name and loses
 *     its heading.
 *   - THE COLUMNS TOUCH (correction 6). The free space is at the two ENDS of
 *     the screen, never between the columns: `justify-content: center` on a
 *     grid whose three tracks are bounded. §4.1's two elastic margin tracks are
 *     what put the gap in the middle, and that is exactly what was wrong.
 *   - THE PLAYING AREA IS A SURFACE (correction 7). `.fr-table__jeu`, darker
 *     than the page, rounded, under the three columns. It is where the physical
 *     inventory will live. The porteur doubts it: it is built plainly so it can
 *     be judged, and what it costs in room is in the report.
 *
 * THE DRAFT IS HELD HERE, NOT IN THE FIELD (§9, « un brouillon n'est jamais
 * perdu »). A frame from the server re-renders the feed underneath it and the
 * text stays. It is NOT in `ws/store.ts`: that store is a mirror of the server,
 * and a mirror does not hold what the player has not sent.
 */

/** What a player types, and to whom. Local state: nothing here is game state. */
interface Composition {
  readonly brouillon: string;
  readonly porteeChoisie: EventScope | null;
  readonly choisis: readonly string[];
  readonly declassificationAcceptee: boolean;
}

const ETAT_CONNEXION: Readonly<Record<string, string>> = {
  idle: 'en attente',
  connecting: 'connexion…',
  open: 'connectée',
  closed: 'coupée — reconnexion en cours',
};

/**
 * The technical banner (correction 4): the link, the content version and the
 * journal head. IT IS NOT GAME STATE AND IT IS NOT IN THE PLAYING AREA — it is
 * the software saying how it is doing, so it goes in the top bar.
 *
 * It reads the table store, so it can only be rendered inside the provider.
 * `App.tsx` renders the header for the table route from within it, for this.
 */
export function BarreTechnique(): ReactNode {
  const status = useTable((state) => state.status);
  const welcome = useTable((state) => state.welcome);
  const lastSeq = useTable((state) => state.lastSeq);

  return (
    <span className="fr-entete__technique">
      Liaison : {ETAT_CONNEXION[status] ?? status}
      {welcome === null
        ? null
        : ` · contenu ${welcome.contentVersion} · journal n° ${String(lastSeq)}`}
    </span>
  );
}

export function EcranDeTable(props: { readonly largeur: Largeur }): ReactNode {
  const welcome = useTable((state) => state.welcome);
  const table = useTable((state) => state.table);
  const presence = useTable((state) => state.presence);
  const lines = useTable((state) => state.lines);
  const history = useTable((state) => state.history);
  const revocations = useTable((state) => state.revocations);
  const lastRejection = useTable((state) => state.lastRejection);

  const [calques, agir] = useReducer(reduireCalques, CALQUES_FERMES);
  const [composition, setComposition] = useState<Composition>({
    brouillon: '',
    porteeChoisie: null,
    choisis: [],
    declassificationAcceptee: false,
  });

  const lignes = useMemo(
    () => journalLines({ lines, history, revocations }).filter(isReadable),
    [lines, history, revocations],
  );

  /**
   * §7.2: « à l'ouverture du compositeur, la portée reprend celle du bloc
   * auquel on répond ». In a single feed, the block one answers is the last one
   * received. Derived rather than stored in an effect: a value that is computed
   * cannot drift from what the feed shows.
   */
  const porteeDuBloc = lignes.at(-1)?.scope ?? null;
  const portee = composition.porteeChoisie ?? porteeDuBloc ?? 'table';

  const monPersonnage =
    table?.characters.find((personnage) => personnage.id === welcome?.characterId) ?? null;

  // The drawers close when the screen grows back: a drawer that stayed open on
  // a wide screen would be the second panel rule 7 forbids.
  const fiche = ficheEnTiroir(props.largeur);
  const cote = coteEnTiroir(props.largeur);
  useEffect(() => {
    if (!fiche && !cote) agir({ type: 'fermer-tiroir' });
  }, [fiche, cote]);

  // Sur portable les jauges sont DÉJÀ en bandeau, en tête (§4.4) : les rendre
  // une seconde fois dans le tiroir donnerait deux « Vigueur » à l'écran, et
  // deux endroits où lire la même valeur sont deux endroits où elle peut
  // diverger à l'œil.
  const panneauFiche = (
    <Fiche
      personnage={monPersonnage}
      modifiee={null}
      fenetreOuverte={false}
      avecJauges={props.largeur !== 'portable'}
    />
  );
  const panneauCote = <LaTable presence={presence} etat={table} />;

  return (
    <main className="fr-table" data-largeur={props.largeur}>
      {/* Les jauges sortent du tiroir sur portable, et elles seules (§4.4). */}
      {props.largeur === 'portable' ? (
        <Jauges
          valeurs={monPersonnage === null ? null : monPersonnage.gauges}
          disposition="horizontale"
        />
      ) : null}

      {/* L'INVENTAIRE AVANT LA FICHE (§4.4). L'ordre de ces deux boutons est
          l'arbitrage de game design, pas une habitude de lecture. */}
      {fiche || cote ? (
        <nav className="fr-table__poussoirs" aria-label="Tiroirs">
          {cote ? (
            <BoutonTiroir
              cote="droite"
              titre="La table"
              compte={presence.length}
              ouvert={calques.tiroir === 'droite'}
              cible="fr-tiroir-droite"
              onBasculer={() => {
                agir({ type: 'basculer-tiroir', cote: 'droite' });
              }}
            />
          ) : null}
          {fiche ? (
            <BoutonTiroir
              cote="gauche"
              titre="Fiche"
              compte={monPersonnage === null ? 0 : monPersonnage.assets.length}
              ouvert={calques.tiroir === 'gauche'}
              cible="fr-tiroir-gauche"
              onBasculer={() => {
                agir({ type: 'basculer-tiroir', cote: 'gauche' });
              }}
            />
          ) : null}
        </nav>
      ) : null}

      {/* LA SURFACE DE JEU (correction 7). Un aplat plus sombre que la page,
          arrondi, sous les trois colonnes — l'emplacement futur de l'inventaire
          physique. Le fond de page reste visible tout autour : c'est un cadre
          posé sur la page, pas une seconde page. */}
      <div className="fr-table__jeu">
        <div className="fr-table__grille">
          <div className="fr-table__cellule" data-colonne="gauche">
            {fiche ? null : <section className="fr-rail fr-rail--gauche">{panneauFiche}</section>}
          </div>

          <div className="fr-table__cellule" data-colonne="centre">
            {calques.tiroir === 'gauche' ? (
              <Tiroir
                cote="gauche"
                id="fr-tiroir-gauche"
                titre="Fiche"
                onFermer={() => {
                  agir({ type: 'fermer-tiroir' });
                }}
              >
                {panneauFiche}
              </Tiroir>
            ) : null}
            {calques.tiroir === 'droite' ? (
              <Tiroir
                cote="droite"
                id="fr-tiroir-droite"
                titre="La table"
                onFermer={() => {
                  agir({ type: 'fermer-tiroir' });
                }}
              >
                {panneauCote}
              </Tiroir>
            ) : null}

            {/* LE FIL ET LA SAISIE DANS LA MÊME CARTE (correction 1). Le fil a
              un plafond et défile sur lui-même ; la saisie est dessous, dans la
              même carte, et ne quitte jamais l'écran. */}
            <div className="fr-table__carte">
              <div className="fr-fil">
                <Journal />
              </div>

              <Compositeur
                texte={composition.brouillon}
                onTexte={(brouillon) => {
                  setComposition((etat) => ({ ...etat, brouillon }));
                }}
                portee={portee}
                onPortee={(porteeChoisie) => {
                  setComposition((etat) => ({
                    ...etat,
                    porteeChoisie,
                    declassificationAcceptee: false,
                  }));
                  if (porteeChoisie === 'subset') {
                    agir({ type: 'ouvrir-calque', calque: { nom: 'destinataires' } });
                  }
                }}
                presents={presence}
                choisis={composition.choisis}
                onOuvrirListe={() => {
                  agir({ type: 'ouvrir-calque', calque: { nom: 'destinataires' } });
                }}
                porteeDuBloc={porteeDuBloc}
                declassificationAcceptee={composition.declassificationAcceptee}
                onAccepterDeclassification={(declassificationAcceptee) => {
                  setComposition((etat) => ({ ...etat, declassificationAcceptee }));
                }}
                erreur={lastRejection === null ? null : rejectionMessage(lastRejection.code)}
                table={table}
              />
            </div>

            {/* RÈGLE 8 : le calque naît ICI, dans la colonne du centre, et nulle
              part ailleurs. Pas de portail : une modale sans parent n'a plus de
              colonne, et la règle devient invérifiable. */}
            {calques.calque?.nom === 'destinataires' ? (
              <Modale
                titre="Qui lit ce message"
                onFermer={() => {
                  agir({ type: 'fermer-calque' });
                }}
              >
                <ListeDestinataires
                  presents={presence}
                  choisis={composition.choisis}
                  onChoisis={(choisis) => {
                    setComposition((etat) => ({ ...etat, choisis }));
                  }}
                  table={table}
                />
              </Modale>
            ) : null}
          </div>

          <div className="fr-table__cellule" data-colonne="droite">
            {cote ? null : (
              <section className="fr-rail fr-rail--droite" aria-label="La table">
                {panneauCote}
              </section>
            )}
          </div>
        </div>
      </div>

      {table === null ? (
        <p className="fr-vide">L’instantané de la table n’est pas encore arrivé.</p>
      ) : null}
    </main>
  );
}

/**
 * The width the browser actually has, in `rem` — so the reader's own text size
 * is what decides, not a pixel count. Falls back to the widest shape where
 * there is no window to measure.
 */
function useLargeur(): Largeur {
  const [largeur, setLargeur] = useState<Largeur>('assise');

  useEffect(() => {
    const mesurer = (): void => {
      const racine = globalThis.document.documentElement;
      const base = Number.parseFloat(globalThis.getComputedStyle(racine).fontSize);
      const unite = Number.isFinite(base) && base > 0 ? base : 16;
      setLargeur(largeurDe(racine.clientWidth / unite));
    };
    mesurer();
    globalThis.addEventListener('resize', mesurer);
    return () => {
      globalThis.removeEventListener('resize', mesurer);
    };
  }, []);

  return largeur;
}

export function TableRoom(): ReactNode {
  const largeur = useLargeur();
  return <EcranDeTable largeur={largeur} />;
}
