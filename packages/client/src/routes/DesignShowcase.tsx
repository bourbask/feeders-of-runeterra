import type { ReactNode } from 'react';

import { Button } from '../components/ui/Button.js';
import type { Jeton, Objet, VarianteId } from './design-data.js';
import {
  DESTINATAIRES,
  ECHELLES,
  ETATS_CAS,
  ETATS_TABLE,
  OBJETS,
  PRIMITIVES,
  QUANTITES,
  REGLES,
  SEMANTIQUE,
  VARIANTES,
} from './design-data.js';
import type { Paire } from '../styles/contraste.js';
import { PAIRES_COMPOSANT, PAIRES_TEXTE } from '../styles/contraste.js';
import '../styles/design.css';

/**
 * La vitrine `/design` : la maquette, dans le produit.
 *
 * CE QUE CETTE PAGE EST. Le rendu de `docs/design/05-interface.md`. Elle existe
 * parce qu'une spécification d'interface décrite en prose ne se juge pas : on
 * peut dire « peu de couleurs » pendant des mois et découvrir le jour où on
 * dessine que ça fait onze. Elle est dans le client, et non dans un dossier à
 * côté, pour une raison précise : **une maquette hors du dépôt dérive**, parce
 * que rien ne la oblige à compiler. Ici elle échoue si un jeton change de nom.
 *
 * CE QU'ELLE N'EST PAS. Elle n'est pas le produit. Les colonnes, les tiroirs, la
 * carte annotable et la toile de dessin n'existent pas encore dans
 * `features/table/` : ce sont des dessins, et ils sont ici pour être jugés
 * avant d'être écrits. Le premier bandeau de la page le dit en toutes lettres,
 * parce qu'une maquette qui se fait passer pour le produit est pire que pas de
 * maquette du tout.
 *
 * ELLE EST HORS SESSION. Une maquette qu'il faut connecter pour être vue est une
 * maquette qu'on ne regarde plus. Elle ne montre rien du compte de personne :
 * les noms, les chiffres et les objets sont écrits en dur dans `design-data.ts`
 * et ne viennent d'aucune requête.
 *
 * AUCUNE VALEUR EN DUR. Les seules couleurs écrites dans ce fichier sont des
 * `var(--jeton)`. `tokens.test.ts` lit ce fichier comme n'importe quelle autre
 * feuille du paquet et refuse toute autre écriture.
 */

function ratio(mesure: number): string {
  return mesure.toFixed(2).replace('.', ',');
}

/* ------------------------------------------------------------------ §0 --- */

function Regles(): ReactNode {
  return (
    <section className="dz-section" id="regles">
      <h2>§0 — Les huit règles</h2>
      <p className="dz-lede">
        Tout le reste du document en découle. Une règle qu’on ne peut pas relire
        en dix secondes n’est pas une règle, c’est un vœu.
      </p>
      <ol className="dz-jetons">
        {REGLES.map((regle) => (
          <li className="dz-etat" key={regle.numero}>
            <h4>Règle {String(regle.numero)}</h4>
            <p>{regle.texte}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ §1 --- */

function Pastille({ jeton }: { readonly jeton: Jeton }): ReactNode {
  return (
    <li className="dz-jeton">
      <div
        className="dz-jeton__teinte"
        style={{ background: `var(${jeton.nom})` }}
        aria-hidden="true"
      />
      <div className="dz-jeton__corps">
        <p className="dz-jeton__nom">{jeton.nom}</p>
        <p className="dz-jeton__valeur">{jeton.role}</p>
      </div>
    </li>
  );
}

function Etage(props: { readonly titre: string; readonly note: string; readonly jetons: readonly Jeton[] }): ReactNode {
  return (
    <>
      <h3>{props.titre}</h3>
      <p className="dz-note">{props.note}</p>
      <ul className="dz-jetons">
        {props.jetons.map((jeton) => (
          <Pastille jeton={jeton} key={jeton.nom} />
        ))}
      </ul>
    </>
  );
}

function Jetons(): ReactNode {
  return (
    <section className="dz-section" id="jetons">
      <h2>§1 — Les jetons</h2>
      <p className="dz-lede">
        Trois étages. Un composant référence l’étage 2 et l’étage 3, jamais
        l’étage 1 : une primitive existe pour qu’un rôle soit défini une fois,
        et un rôle qui réécrit son hexadécimal ne l’utilise pas, il la duplique.
        <code>styles/tokens.test.ts</code> fait respecter la règle.
      </p>
      <Etage
        titre="Étage 1 — vingt-deux valeurs brutes"
        note="Sans sens, jamais utilisées directement. C’est tout le budget : au-delà, « peu de couleurs » n’est plus vrai."
        jetons={PRIMITIVES}
      />
      <Etage
        titre="Étage 2 — sémantique"
        note="Un rôle, un nom, en français. Ces noms existaient déjà dans global.css : les renommer coûterait plus qu’il ne rapporterait."
        jetons={SEMANTIQUE}
      />
      <Etage
        titre="Étage 3 — échelles et paliers"
        note="Pas de pixel en dur dans un composant. Les paliers d’écran vivent ici parce qu’un composant ne doit pas décider à quelle taille un écran devient étroit."
        jetons={ECHELLES}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ §2 --- */

function LignePaire({ paire }: { readonly paire: Paire }): ReactNode {
  const passe = paire.mesure >= paire.minimum;
  return (
    <tr>
      <th scope="row">
        <code>{paire.devant}</code> sur <code>{paire.sur}</code>
      </th>
      <td>{paire.quoi}</td>
      <td>{ratio(paire.mesure)}</td>
      <td>{ratio(paire.minimum)}</td>
      <td className={passe ? 'dz-oui' : 'dz-non'}>{passe ? '✔' : '✘'}</td>
    </tr>
  );
}

function Contrastes(): ReactNode {
  return (
    <section className="dz-section" id="contrastes">
      <h2>§2 — La couleur, mesurée</h2>
      <p className="dz-lede">
        Les ratios ci-dessous sont <strong>calculés</strong>, jamais estimés. Le
        test de la vitrine les recalcule à partir de <code>tokens.css</code> et
        échoue si l’écran affiche un nombre faux — donc si un jeton bouge sans
        que la mesure bouge avec lui.
      </p>

      <h3>Du texte sur un fond — AA exige 4,5</h3>
      <table className="dz-tableau">
        <thead>
          <tr>
            <th scope="col">Paire</th>
            <th scope="col">Ce qu’elle dit</th>
            <th scope="col">Mesuré</th>
            <th scope="col">Minimum</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {PAIRES_TEXTE.map((paire) => (
            <LignePaire key={`${paire.devant}/${paire.sur}`} paire={paire} />
          ))}
        </tbody>
      </table>

      <h3>Un composant d’interface — WCAG 1.4.11 exige 3</h3>
      <p className="dz-note">
        Le 3:1 ne s’applique pas à toute ligne de l’écran, seulement à ce qui est
        <em>nécessaire</em> pour identifier un composant. Un panneau est identifié
        par son titre, un anneau de focus ne peut l’être que par lui-même. C’est
        pourquoi <code>--trait</code> reste en dessous, et <code>--trait-fort</code>{' '}
        au-dessus.
      </p>
      <table className="dz-tableau">
        <thead>
          <tr>
            <th scope="col">Paire</th>
            <th scope="col">Ce qu’elle dit</th>
            <th scope="col">Mesuré</th>
            <th scope="col">Minimum</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {PAIRES_COMPOSANT.map((paire) => (
            <LignePaire key={`${paire.devant}/${paire.sur}`} paire={paire} />
          ))}
        </tbody>
      </table>

      <h3>Le texte, pour de vrai</h3>
      <p className="dz-note">
        Un carré de couleur ne prouve rien sur la lisibilité. Il faut du texte,
        sur le fond réel, à la taille réelle.
      </p>
      <ul className="dz-paires">
        {PAIRES_TEXTE.map((paire) => (
          <li
            className="dz-pastille-texte"
            key={`${paire.devant}/${paire.sur}`}
            style={{ color: `var(${paire.devant})`, background: `var(${paire.sur})` }}
          >
            {paire.devant} sur {paire.sur} — {ratio(paire.mesure)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ §4 --- */

interface JaugeProps {
  readonly nom: string;
  readonly nature: 'vigueur' | 'ame' | 'vivres';
  readonly sur: number;
  readonly max: number;
  /** La démonstration du §6 : la même jauge sans aucune teinte. Ce qui reste
   *  lisible sans couleur est tout ce qui compte — le reste est du décor. */
  readonly sansCouleur?: boolean;
}

/** Des pastilles, pas une barre. Une jauge est une POSITION : « il en reste
 *  quatorze sur vingt » se lit sur une suite de marques, pas en comparant deux
 *  longueurs de rectangle. */
function Jauge(props: JaugeProps): ReactNode {
  const pastilles = Array.from({ length: props.max }, (_, index) => index < props.sur);
  const sansCouleur = props.sansCouleur === true;
  return (
    <div className={`dz-jauge dz-jauge--${props.nature}${sansCouleur ? ' dz-jauge--sans-couleur' : ''}`}>
      <div className="dz-jauge__ligne">
        <span className="dz-jauge__nom">{props.nom}</span>
        <span
          className={`dz-jauge__valeur${props.sur === 0 ? ' dz-jauge__valeur--vide' : ''}`}
          title={`${String(props.sur)} / ${String(props.max)}`}
        >
          {props.sur === 0 ? '—' : `${String(props.sur)} / ${String(props.max)}`}
        </span>
      </div>
      <div className="dz-jauge__tube">
        {pastilles.map((pleine, index) => (
          <span
            className={
              pleine ? 'dz-jauge__pastille dz-jauge__pastille--pleine' : 'dz-jauge__pastille'
            }
            key={index}
          />
        ))}
      </div>
    </div>
  );
}

function Fiche(): ReactNode {
  return (
    <>
      <p className="dz-titre-rail">Vous</p>
      <p className="dz-liste">
        <strong>Braum</strong>
        <br />
        Le Cœur de Freljord
      </p>
      <h3>Jauges</h3>
      <Jauge nature="vigueur" nom="Vigueur" sur={14} max={20} />
      <Jauge nature="ame" nom="Âme" sur={17} max={20} />
      <Jauge nature="vivres" nom="Vivres" sur={6} max={12} />
      <h3>Traits</h3>
      <ul className="dz-liste">
        <li>Ferran</li>
        <li>Habitant du col</li>
        <li>Gardien de porte</li>
      </ul>
      <h3>Atouts</h3>
      <ul className="dz-liste">
        <li>Le Vent du Nord</li>
        <li>
          <em>Quand</em> tu te places entre un allié et ce qui l’attaque, tu
          absorbs 1
        </li>
      </ul>
    </>
  );
}

/**
 * Une horloge : une MENACE, nommée, qui se remplit.
 *
 * D'où elle vient : `02-mj-ia.md`, pas de moi. Une horloge a un nom qui est une
 * menace concrète (« La tempête se lève ») et un nombre de segments que le
 * moteur remplit selon l'issue des tours. Quand elle est pleine, c'est le
 * MOTEUR qui déclenche la conséquence — jamais le modèle, et jamais le client.
 *
 * Pourquoi elle se lisait mal avant : rendue « Le col — 2 / 4 », elle disait
 * qu'il y a un objet et deux nombres. La forme ne disait pas *ce qui approche*,
 * ni *ce qui arrive quand c'est plein*. Les segments sont donc des marques
 * pleines, comme les vivres : on les compte d'un coup d'œil, et le dernier
 * segment a une forme différente — c'est celui qui déclenche.
 *
 * Le nom de section est en RP et le terme du domaine reste « horloge » dans le
 * code : c'est la convention du dépôt (libellés français, clés métier anglaises).
 */
function Horloge(props: {
  readonly nom: string;
  readonly segments: number;
  readonly sur: number;
}): ReactNode {
  const pleine = props.segments >= props.sur;
  return (
    <div className="dz-horloge">
      <p className="dz-horloge__nom">
        {props.nom}
        <span className="dz-horloge__compte">
          {String(props.segments)} / {String(props.sur)}
        </span>
      </p>
      <div className="dz-horloge__segments">
        {Array.from({ length: props.sur }, (_, index) => (
          <span
            className={
              index < props.segments
                ? 'dz-horloge__segment dz-horloge__segment--plein'
                : 'dz-horloge__segment'
            }
            key={index}
          />
        ))}
      </div>
      {pleine ? (
        <p className="dz-chrome">Pleine — sa conséquence a été jouée.</p>
      ) : (
        <p className="dz-chrome">
          Encore {String(props.sur - props.segments)} avant qu’elle se déclenche.
        </p>
      )}
    </div>
  );
}

function Table(): ReactNode {
  return (
    <>
      <p className="dz-titre-rail">La table</p>
      <ul className="dz-liste">
        <li>
          <span className="dz-presence__pastille dz-presence__pastille--en-ligne" />
          Braum, présent
        </li>
        <li>
          <span className="dz-presence__pastille dz-presence__pastille--en-ligne" />
          Serys, présente
        </li>
        <li>
          <span className="dz-presence__pastille" />
          Kazu, parti depuis 4 min
        </li>
      </ul>
      <h3>Ce qui se rapproche</h3>
      <Horloge nom="La tempête se lève" segments={3} sur={6} />
      <Horloge nom="Le col cède" segments={2} sur={4} />
      <Horloge nom="Kazu revient toujours" segments={3} sur={3} />
      <h3>Serments</h3>
      <ul className="dz-liste">
        <li>Personne ne passe deux fois</li>
      </ul>
    </>
  );
}

/**
 * L'inventaire. Ce sont des OBJETS QUE VOUS AVEZ, pas un panneau d'interface :
 * chaque carte est un objet du monde, obtenu en le recevant ou en le
 * fabriquant. Le carnet est lui-même un objet — vous ne l'avez pas tous, et si
 * vous ne l'avez pas, il n'y a rien à y écrire.
 *
 * La quantité est écrite EN TEXTE (`× 2`), jamais seulement en pastilles : trois
 * points et un deux, c'est une devinette.
 */
function Inventaire(props: { readonly titre: string }): ReactNode {
  return (
    <div className="dz-inventaire">
      <p className="dz-titre-rail">{props.titre}</p>
      <ul className="dz-carnet">
        {OBJETS.map((objet) => (
          <li className="dz-carte" key={objet.nom}>
            <span className="dz-carte__nature">{objet.nature}</span>
            <span className="dz-carte__nom">{objet.nom}</span>
            <span className="dz-carte__quantite">× {String(QUANTITES[objet.nom] ?? 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Un bloc du fil. Le rail de gauche porte la portée ; l'erreur prend le même
 *  rail, parce qu'un refus du modèle est un événement du fil comme un autre et
 *  qu'il ne doit pas se lire comme un encart d'une autre nature. */
function Bloc(props: {
  readonly qui: string;
  readonly portee: 'publique' | 'restreinte';
  readonly texte: string;
  readonly chrome?: string;
  readonly refus?: boolean;
}): ReactNode {
  const restreinte = props.portee === 'restreinte';
  const refus = props.refus === true;
  return (
    <li
      className={`dz-bloc${restreinte ? ' dz-bloc--restreinte' : ''}${refus ? ' dz-bloc--erreur' : ''}`}
    >
      <p className="dz-bloc__qui">
        <span>{props.qui}</span>
        {/* La portée ne se lit JAMAIS à la couleur seule : le glyphe et le
            libellé la doublent toujours (règle 2). */}
        <span className={`dz-portee${restreinte ? ' dz-portee--restreinte' : ''}`}>
          <span aria-hidden="true">{restreinte ? '◑' : '◎'}</span>
          {restreinte ? 'restreint' : 'toute la table'}
        </span>
      </p>
      <p className="dz-texte-narration">{props.texte}</p>
      {props.chrome === undefined ? null : <p className="dz-chrome">{props.chrome}</p>}
    </li>
  );
}

function Fil(props: {
  readonly erreur?: boolean;
  readonly separe?: boolean;
  readonly refus?: boolean;
}): ReactNode {
  return (
    <div className="dz-centre">
      <p className="dz-centre__titre">Le fil</p>
      {props.erreur === true ? (
        <p className="dz-bandeau">
          Le modèle n’a pas répondu. Ton texte est resté dans le champ.
        </p>
      ) : null}
      <ul className="dz-fil">
        {props.separe === true ? (
          <>
            <p className="dz-centre__titre">— sous-fil public —</p>
            <Bloc
              portee="publique"
              qui="Serys"
              texte="La crête tient encore, mais la neige a tourné. Braum, vous êtes le seul entre la passe et nous."
              chrome="Serys · 2 min"
            />
            <p className="dz-centre__titre">— sous-fil restreint —</p>
            <Bloc
              portee="restreinte"
              qui="Kazu"
              texte="Je ne dis ça qu’à vous : la lettre dans ma sacoche n’est pas la mienne."
              chrome="Kazu · à l’instant"
            />
          </>
        ) : (
          <Bloc
            portee="publique"
            qui="Serys"
            texte="La crête tient encore, mais la neige a tourné. Braum, vous êtes le seul entre la passe et nous."
            chrome="Serys · 2 min"
          />
        )}
        <Bloc
          portee="publique"
          qui="Toi"
          texte="Je plante le marteau dans la glace et je me mets entre vous et le vent. Si quelqu’un veut passer, il passe par moi."
          chrome="à toi de jouer"
        />
        {props.refus === true ? (
          <Bloc
            refus
            portee="publique"
            qui="Le modèle"
            texte="Je ne peux pas décider à ta place qui voit ça. Choisis un destinataire, puis écris."
            chrome="refus · à l’instant"
          />
        ) : null}
      </ul>
      <label className="dz-champ dz-champ--vide" htmlFor="dz-compositeur">
        Ce que tu fais…
      </label>
    </div>
  );
}

/** Les quatre colonnes du §4.1, dans le même composant. La déclaration de grille
 *  est dans `design.css` et ne se trouve nulle part ailleurs. */
function QuatreColonnes(props: { readonly identite?: string }): ReactNode {
  return (
    <div className="dz-table">
      <div className="dz-cellule">
        <div className="dz-rail dz-rail--gauche">
          {props.identite === undefined ? null : <p className="dz-chrome">{props.identite}</p>}
          <Fiche />
        </div>
        <Inventaire titre="Ce que vous portez" />
      </div>
      <Fil />
      <div className="dz-cellule dz-cellule--droite">
        <div className="dz-rail dz-rail--droite">
          <Table />
        </div>
        <Inventaire titre="Sur la table" />
      </div>
    </div>
  );
}

/** Un tiroir ne recouvre rien : il prend la place d'une colonne qui n'a plus de
 *  place. Ici il est dessiné à la place de la colonne, bord intérieur visible,
 *  pour qu'on ne le confonde jamais avec une modale. */
function Tiroir(props: {
  readonly cote: 'gauche' | 'droit' | 'bas';
  readonly titre: string;
  readonly compte: string;
  readonly ouvert: boolean;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <div className={`dz-tiroir dz-tiroir--${props.cote}`}>
      <Button expanded={props.ouvert} onClick={(): void => undefined}>
        {props.titre} · <span className="dz-compteur">{props.compte}</span>
      </Button>
      {props.ouvert && props.children !== undefined ? props.children : null}
    </div>
  );
}

function Vignette(props: {
  readonly legende: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <figure className="dz-largeur">
      <figcaption>{props.legende}</figcaption>
      <div className="dz-vignette">{props.children}</div>
    </figure>
  );
}

/** Le contenu d'une vignette : le MÊME composant, réarrangé.
 *
 *  C'est tout ce qu'un palier change — jamais ce qu'il y a dedans. La fiche est
 *  la même au palier 1 et au palier 3 ; au palier 3 elle est simplement dans un
 *  tiroir. Un palier qui affichait autre chose que la même fiche serait un
 *  deuxième écran, et il faudrait alors deux spécifications. */
function Arrangement(props: { readonly id: VarianteId; readonly rang: number }): ReactNode {
  switch (props.id) {
    case 'large':
      return <QuatreColonnes identite="palier 1" />;

    case 'moyen':
      return (
        <div className="dz-table">
          <div className="dz-rail dz-rail--gauche">
            <Fiche />
          </div>
          <Fil />
          <div className="dz-rail dz-rail--droite">
            <Table />
          </div>
        </div>
      );

    case 'tiroir-gauche':
      return (
        <div className="dz-table dz-table--tiroir-gauche">
          <Tiroir cote="gauche" titre="Fiche" compte="3 jauges" ouvert>
            <Fiche />
          </Tiroir>
          <Fil />
          <div className="dz-rail dz-rail--droite">
            <Table />
          </div>
        </div>
      );

    case 'tiroir-droit':
      return (
        <div className="dz-table dz-table--tiroir-droit">
          <div className="dz-rail dz-rail--gauche">
            <Fiche />
          </div>
          <Fil />
          <Tiroir cote="droit" titre="Carnet" compte="3 objets" ouvert>
            <Table />
          </Tiroir>
        </div>
      );

    case 'portable':
      return (
        <div className="dz-table dz-table--portable">
          <div>
            {/* Les trois jauges sont la SEULE chose qui sort du tiroir : ce sont
                les trois seules qui doivent être lisibles sans rien ouvrir. */}
            <div className="dz-bandeau-jauges">
              <Jauge nature="vigueur" nom="Vigueur" sur={14} max={20} />
            </div>
            <div className="dz-rangee-tiroirs">
              <div aria-expanded="false" className="dz-bouton-tiroir" role="button">
                Fiche <span className="dz-glyphes">◑</span>
              </div>
              <div aria-expanded="false" className="dz-bouton-tiroir" role="button">
                Table · carnet <span className="dz-glyphes">3</span>
              </div>
            </div>
            <Fil />
          </div>
        </div>
      );
  }
}

function Decoupage(): ReactNode {
  return (
    <section className="dz-section" id="decoupage">
      <h2>§4 — Le découpage de la table</h2>
      <p className="dz-lede">
        Quatre colonnes, dont deux élastiques. Les deux extérieures sont des
        marges qui s’adaptent et qui servent d’inventaire ; les deux intérieures
        sont la fiche et le fil. Le centre est une colonne de lecture — c’est
        pour ça qu’il n’est pas large comme les côtés, et c’est pour ça que les
        côtés ne sont pas égaux.
      </p>

      <h3>Les quatre paliers</h3>
      <p className="dz-note">
        Quatre des cinq rangs ne sont pas des media queries : ce sont des
        <em> arrangements</em> du même composant. Ce qui change d’un palier à
        l’autre, c’est où vit le contenu — rail, marge, tiroir, bandeau — et
        jamais le contenu lui-même.
      </p>

      {VARIANTES.map((variante) => (
        <Vignette
          key={variante.id}
          legende={
            <>
              <strong>
                {String(variante.rang)} — {variante.titre}
              </strong>
              <span>
                {variante.dessous} · cède : {variante.ceQuiCede} · reste :{' '}
                {variante.ceQuiReste}
              </span>
            </>
          }
        >
          <Arrangement id={variante.id} rang={variante.rang} />
        </Vignette>
      ))}

      <h3>Un tiroir, un seul à la fois</h3>
      <p className="dz-note">
        Le tiroir gauche est <strong>volontairement moins accessible</strong> que
        le droit, et c’est un choix de jeu autant que d’interface : la fiche est
        l’information qu’on consulte, l’inventaire est celle dont on a besoin
        tout de suite au moment de jouer un mouvement. Un tiroir fermé annonce son
        contenu, parce qu’un bouton-poussoir nu est un bouton dont on ne devine pas
        l’usage.
      </p>
      <div className="dz-calque-demo">
        <div className="dz-rangee-tiroirs">
          <div className="dz-bouton-tiroir" aria-expanded="true">
            Fiche <span className="dz-glyphes">◑</span>
          </div>
          <div className="dz-bouton-tiroir" aria-expanded="false">
            Table · carnet <span className="dz-glyphes">3</span>
          </div>
        </div>
        <Tiroir cote="bas" titre="Pistes" compte="2" ouvert={false}>
          <p className="dz-chrome">Réservé. Dessiné ici, construit plus tard.</p>
        </Tiroir>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ §4.7 --- */

function EtatsTable(): ReactNode {
  return (
    <section className="dz-section" id="etats-table">
      <h2>§4.7 — Les trois états d’une table</h2>
      <p className="dz-note">
        Le mode « séparée » ne réinvente pas l’écran : il affiche deux fois le
        fil, à deux endroits, parce que la chronologie de l’histoire ne se scinde
        pas (ADR 0008, décision 1). Les colonnes latérales restent.
      </p>
      <Vignette
        legende={
          <>
            <strong>Assise</strong>
            <span>la norme</span>
          </>
        }
      >
        <QuatreColonnes identite="état assise" />
      </Vignette>
      <Vignette
        legende={
          <>
            <strong>Séparée</strong>
            <span>une portée `subset` non vide — le fil se scinde, les colonnes restent</span>
          </>
        }
      >
        <div className="dz-table">
          <div className="dz-cellule">
            <div className="dz-rail dz-rail--gauche">
              <Fiche />
            </div>
            <Inventaire titre="Ce que vous portez" />
          </div>
          <Fil separe />
          <div className="dz-cellule dz-cellule--droite">
            <div className="dz-rail dz-rail--droite">
              <Table />
            </div>
            <Inventaire titre="Sur la table" />
          </div>
        </div>
      </Vignette>
      <table className="dz-tableau">
        <thead>
          <tr>
            <th scope="col">État</th>
            <th scope="col">Ce qu’on voit</th>
            <th scope="col">Qui le déclenche</th>
          </tr>
        </thead>
        <tbody>
          {ETATS_TABLE.map((etat) => (
            <tr key={etat.nom}>
              <th scope="row">{etat.nom}</th>
              <td>{etat.quoi}</td>
              <td>{etat.qui}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ------------------------------------------------------------------ §6 --- */

function Jauges(): ReactNode {
  return (
    <section className="dz-section" id="jauges">
      <h2>§6 — Les trois jauges</h2>
      <p className="dz-lede">
        Vigueur, âme, vivres. L’aplat ne porte que la <strong>teinte</strong> ; la
        <strong> valeur est écrite à côté, en texte</strong>. Un aplat sans nombre
        est une forme décorative, et c’est la règle 2 appliquée à une jauge.
      </p>

      <h3>Le cas de l’âme</h3>
      <p className="dz-note">
        Sur un thème froid et sombre, une jauge « spirituelle » en blanc se confond
        avec le texte. C’est assumé : trois jauges qui se ressemblent ne se
        distinguent pas, trois jauges de couleurs différentes se lisent dans
        l’ordre. Et voici la preuve — la version sans couleur, où il ne reste que
        la forme et le nombre :
      </p>
      <div className="dz-jetons">
        <div className="dz-etat">
          <h4>Avec la couleur</h4>
          <Jauge nature="vigueur" nom="Vigueur" sur={14} max={20} />
          <Jauge nature="ame" nom="Âme" sur={17} max={20} />
          <Jauge nature="vivres" nom="Vivres" sur={6} max={12} />
        </div>
        <div className="dz-etat">
          <h4>Sans la couleur</h4>
          <Jauge nature="vigueur" nom="Vigueur" sur={14} max={20} sansCouleur />
          <Jauge nature="ame" nom="Âme" sur={17} max={20} sansCouleur />
          <Jauge nature="vivres" nom="Vivres" sur={6} max={12} sansCouleur />
        </div>
      </div>

      <h3>Les cinq états de la jauge</h3>
      <ul className="dz-etats">
        <li className="dz-etat">
          <h4>Vide</h4>
          <Jauge nature="vigueur" nom="Vigueur" sur={0} max={20} />
        </li>
        <li className="dz-etat">
          <h4>Chargement</h4>
          {/* Un squelette STATIQUE. Pas de shimmer : ce qui bouge sans qu’on
              l’ait demandé est interdit par la règle 3. */}
          <div className="dz-squelette" aria-hidden="true" />
          <p className="dz-chrome">14 / 20</p>
        </li>
        <li className="dz-etat dz-jauge--erreur">
          <h4>Erreur</h4>
          <div className="dz-jauge dz-jauge--vigueur">
            <div className="dz-jauge__ligne">
              <span className="dz-jauge__nom">Vigueur</span>
              <span className="dz-jauge__valeur">14 / 20</span>
            </div>
            <div className="dz-jauge__tube">
              {Array.from({ length: 20 }, (_, index) => (
                <span
                  className={
                    index < 14
                      ? 'dz-jauge__pastille dz-jauge__pastille--pleine'
                      : 'dz-jauge__pastille'
                  }
                  key={index}
                />
              ))}
            </div>
          </div>
          <p className="dz-chrome">La valeur reste lisible.</p>
        </li>
        <li className="dz-etat dz-jauge--inactive">
          <h4>Désactivée</h4>
          <Jauge nature="ame" nom="Âme" sur={3} max={20} />
          <p className="dz-chrome">Opacité 0,5 — et le nombre reste.</p>
        </li>
        <li className="dz-etat">
          <h4>Survol</h4>
          <Jauge nature="vivres" nom="Vivres" sur={6} max={12} />
          <p className="dz-chrome">Le titre natif porte « 6 / 12 ».</p>
        </li>
      </ul>

      <h3>Le momentum n’est pas une jauge</h3>
      <p className="dz-note">
        <code>momentum.burn</code> et <code>momentum.keep</code> n’existent que
        pendant la fenêtre de jet : un survol tardif sur une fenêtre fermée est
        refusé. Il est donc un <strong>badge</strong> attaché au jet, pas une
        quatrième jauge.
      </p>
      <p>
        <span className="dz-carte">
          <span className="dz-carte__nom">2d6 — élan 2</span>
        </span>
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ §7 --- */

function Destinataires(): ReactNode {
  return (
    <section className="dz-section" id="destinataires">
      <h2>§7 — Le sélecteur de destinataire</h2>
      <p className="dz-lede">
        Toujours rendu, jamais dans un menu : c’est le composant le plus
        important de l’écran, et un menu le range trop bien (ADR 0008, décision
        4). Le joueur déclassifie lui-même, et on ne le fait jamais à sa place
        sans prévenir.
      </p>

      <div className="dz-carte-ouverte">
        <div>
          <h4>Qui voit ce que tu écris ?</h4>
          <ul className="dz-partage-liste">
            {DESTINATAIRES.map((destinataire) => (
              <li key={destinataire.nom}>
                <input
                  checked={destinataire.coche}
                  id={`dz-dest-${destinataire.nom}`}
                  readOnly
                  type="checkbox"
                />
                <label htmlFor={`dz-dest-${destinataire.nom}`}>{destinataire.nom}</label>
              </li>
            ))}
          </ul>
          <h3>Répondre en public</h3>
          <p className="dz-note">
            Ce bloc était restreint à <strong>Furie, Kazu et Serys</strong>. Le
            rendre public retirera sa portée à 3 joueurs qui n’ont rien demandé.
          </p>
          <div className="dz-paires">
            <Button onClick={(): void => undefined}>Rendre public</Button>
            <Button onClick={(): void => undefined} variant="discret">
              Garder restreint
            </Button>
          </div>
        </div>
        <div className="dz-toile dz-toile--grille">
          Aperçu du bloc tel que la table le verra : la portée décide de la
          couleur du rail, jamais du texte.
        </div>
      </div>

      <h3>Un refus du modèle ne vide pas le sélecteur</h3>
      <p className="dz-note">
        Le cas le plus facile à mal faire : le modèle refuse faute de destinataire,
        et l’interface remet le sélecteur à zéro « pour être propre ». Le joueur
        perd alors son choix, et il ne saura jamais qu’il y en avait un. Le refus
        entre dans le fil comme un événement, et le sélecteur garde exactement ce
        qu’il avait.
      </p>
      <div className="dz-jetons">
        <div className="dz-etat">
          <h4>Le refus</h4>
          <Fil refus />
        </div>
        <div className="dz-etat">
          <h4>Le sélecteur, inchangé</h4>
          <ul className="dz-partage-liste">
            {DESTINATAIRES.map((destinataire) => (
              <li key={destinataire.nom}>
                <input
                  checked={destinataire.coche}
                  id={`dz-dest-refus-${destinataire.nom}`}
                  readOnly
                  type="checkbox"
                />
                <label htmlFor={`dz-dest-refus-${destinataire.nom}`}>
                  {destinataire.nom}
                </label>
              </li>
            ))}
          </ul>
          <p className="dz-chrome">
            Le refus est en rouge, le choix reste. Un message d’erreur ne doit
            jamais être la seule information à l’écran.
          </p>
        </div>
        <div className="dz-etat">
          <h4>Envoyé</h4>
          <p className="dz-bandeau dz-bandeau--succes">
            Votre action est arrivée à toute la table.
          </p>
          <p className="dz-chrome">
            Le succès s’affiche, puis disparaît tout seul. Rien à fermer, rien à
            cliquer.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ §8 --- */

function CarteOuverte(props: { readonly objet: Objet }): ReactNode {
  return (
    <div className="dz-carte-ouverte">
      <div>
        <h4>{props.objet.nom}</h4>
        <p className="dz-chrome">
          {props.objet.nature === 'secret'
            ? 'Ne se partage pas. Ce que vous en faites ne regarde que vous.'
            : 'Ouvrir une carte, c’est ouvrir une surface de dessin — pas un second panneau.'}
        </p>
        <h3>Ce qu’on peut partager</h3>
        <p className={props.objet.partageable ? undefined : 'dz-annule'}>{props.objet.partage}</p>
        <h3>Interactions</h3>
        <ul>
          <li className="dz-check">
            <span aria-hidden="true">☞</span>
            <span>Clic — ouvrir la carte et sa toile</span>
          </li>
          <li className="dz-check">
            <span aria-hidden="true">✥</span>
            <span>Glisser sur une carte d’allié — l’ouvrir à deux</span>
          </li>
          <li className="dz-check">
            <span aria-hidden="true">☰</span>
            <span>Clic droit — partager, ou ouvrir la liste de contrôle</span>
          </li>
        </ul>
      </div>
      {/* La toile est une SURFACE DANS LA carte : pas de cadre de fenêtre, pas de
          second en-tête, pas de bouton de fermeture. C’est la seule
          superposition que ce produit s’autorise. */}
      <div className="dz-toile dz-toile--grille">
        <p className="dz-chrome">La toile — surface de dessin</p>
        <div className="dz-trait" />
        <p className="dz-chrome">
          Deux qui dessinent ici voient la même toile. Ce qui est écrit dessus est
          à eux, pas à la table.
        </p>
      </div>
    </div>
  );
}

function Carnet(): ReactNode {
  const partageable = OBJETS.find((objet) => objet.partageable);
  const secret = OBJETS.find((objet) => !objet.partageable);

  return (
    <section className="dz-section" id="carnet">
      <h2>§8 — Le carnet d’objets, et la carte annotable</h2>
      <p className="dz-lede">
        Le carnet est la seule zone qui <strong>grandit</strong> : c’est là que le
        glisser-déposer dépose les cartes. Le système de partage est global et
        générique, et il ne vit pas dans ce composant — il vient de
        <code> PartagePolicy</code>, qui est dans le contenu versionné. Un client
        qui déciderait lui-même quoi partager casserait l’invariant 3.
      </p>

      <ul className="dz-carnet">
        {OBJETS.map((objet) => (
          <li
            className={`dz-carte${objet.partageable ? '' : ' dz-carte--inactive'}`}
            key={objet.nom}
          >
            <span className="dz-carte__nature">{objet.nature}</span>
            <span className="dz-carte__nom">{objet.nom}</span>
            <span
              className={`dz-carte__partage${objet.partageable ? '' : ' dz-carte__partage--non'}`}
            >
              {objet.partageable ? 'partageable' : 'non partageable'}
            </span>
          </li>
        ))}
      </ul>

      <h3>La règle, par nature d’objet</h3>
      <table className="dz-tableau">
        <thead>
          <tr>
            <th scope="col">Objet</th>
            <th scope="col">Nature</th>
            <th scope="col">Ce qu’on peut partager</th>
          </tr>
        </thead>
        <tbody>
          {OBJETS.map((objet) => (
            <tr key={objet.nom}>
              <th scope="row">{objet.nom}</th>
              <td className="dz-nature">{objet.nature}</td>
              <td>{objet.partage}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {partageable === undefined || secret === undefined ? null : (
        <>
          <h3>Ouverte — partageable</h3>
          <CarteOuverte objet={partageable} />
          <h3>Ouverte — non partageable</h3>
          <CarteOuverte objet={secret} />
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ §9 --- */

function Etats(): ReactNode {
  return (
    <section className="dz-section" id="etats">
      <h2>§9 — Les états</h2>
      <p className="dz-lede">
        Un état vide non dessiné est un écran blanc sur une soirée de jeu. Les
        trois règles qui valent plus que le tableau :
      </p>
      <ul className="dz-liste dz-note">
        <li>
          <strong>Un brouillon n’est jamais perdu.</strong> Une erreur réseau, un
          retour du serveur, un rechargement : le texte est dans le store, pas
          dans le DOM.
        </li>
        <li>
          <strong>Désactivé n’est pas invisible.</strong> Un élément désactivé qui
          disparaît est impossible à retrouver. L’opacité baisse, le texte reste.
        </li>
        <li>
          <strong>Un tiroir fermé annonce son contenu.</strong> Il porte son
          compte, parce que c’est le seul chiffre d’un tiroir qui compte.
        </li>
      </ul>

      <h3>Le fil, en chargement et en erreur</h3>
      <Vignette
        legende={
          <>
            <strong>Erreur réseau</strong>
            <span>le bandeau s’affiche au-dessus, le fil reste lisible en dessous</span>
          </>
        }
      >
        <Fil erreur />
      </Vignette>
      <Vignette
        legende={
          <>
            <strong>Chargement</strong>
            <span>rien ne bouge : squelette statique, le fil ne se réécrit pas</span>
          </>
        }
      >
        <div className="dz-centre">
          <p className="dz-centre__titre">Le fil</p>
          <div aria-hidden="true" className="dz-squelette" />
          <div aria-hidden="true" className="dz-squelette" />
          <div aria-hidden="true" className="dz-squelette" />
        </div>
      </Vignette>

      <h3>Le compositeur, vide et en erreur</h3>
      <div className="dz-jetons">
        <div className="dz-etat">
          <h4>Vide</h4>
          <input
            className="dz-champ dz-champ--vide"
            id="dz-champ-vide"
            placeholder="Ce que tu fais…"
            readOnly
            value=""
          />
          <p className="dz-chrome">Le champ garde sa place. Un champ qui disparaît est un champ perdu.</p>
        </div>
        <div className="dz-etat">
          <h4>Avec un brouillon, focus</h4>
          <input
            className="dz-champ dz-focus"
            id="dz-champ-focus"
            readOnly
            value="Je plante le marteau et je me mets entre vous et le vent."
          />
          <div className="dz-paires">
            <Button disabled onClick={(): void => undefined}>
              envoyer
            </Button>
          </div>
          <p className="dz-chrome">
            Le focus est le seul filet qui passe 3:1 : c’est le seul qui dit
            quelque chose.
          </p>
        </div>
        <div className="dz-etat">
          <h4>Erreur — le brouillon survit</h4>
          <p className="dz-bandeau">Le serveur n’a pas répondu. Ton texte est resté.</p>
          <input
            className="dz-champ"
            id="dz-champ-erreur"
            readOnly
            value="Je plante le marteau et je me mets entre vous et le vent."
          />
        </div>
        <div className="dz-etat">
          <h4>Une fenêtre, fermée puis ouverte</h4>
          <div className="dz-calque-demo">
            <div className="dz-voile" />
            <div className="dz-fenetre dz-fenetre--au-plan">
              <div className="dz-fenetre__poignee">
                <p className="dz-fenetre__titre">Le carnet de Serys</p>
                <span className="dz-fenetre__nature">objet</span>
                <button className="dz-fenetre__fermer" type="button">
                  ×
                </button>
              </div>
              <div className="dz-fenetre__corps">
                <p className="dz-bandeau">Chargement interrompu.</p>
                <p className="dz-chrome">
                  Le titre est déjà écrit, le bandeau est DANS la fenêtre, et la
                  fenêtre reste. Le bouton × est toujours actif.
                </p>
              </div>
              <div className="dz-fenetre__tirer" />
            </div>
          </div>
        </div>
      </div>

      <h3>Plusieurs fenêtres, ensemble</h3>
      <p className="dz-note">
        Le carnet ouvert, la carte, et le livre trouvé dans une maison abandonnée
        où l’on veut copier une note. <strong>Trois fenêtres, pas trois
        écrans.</strong> C’est ce qui rend la scène jouable : on compare deux
        objets côte à côte, on ne les relit pas de mémoire. Chacune se déplace
        par sa poignée, chacune se redimensionne par son coin, et la dernière
        ouverte vient devant — mais on voit qu’il y en a deux derrière.
      </p>
      <p className="dz-note">
        <strong>Le focus n’est pas piégé.</strong> Il va à la fenêtre ouverte, puis
        il reste libre : on tabule vers le fil, on écrit, on revient. On ne peut
        pas non plus cliquer « à travers » une fenêtre pour toucher ce
        qu’elle couvre. C’est le compromis entre « plusieurs objets » et « on
        sait toujours où on est ».
      </p>
      <div className="dz-calque-demo">
        <div className="dz-voile" />
        <div className="dz-fenetre dz-fenetre--derriere" style={{ left: '8%', top: '14%', width: '46%', height: '62%' }}>
          <div className="dz-fenetre__poignee">
            <p className="dz-fenetre__titre">Le carnet de Serys</p>
            <span className="dz-fenetre__nature">carnet</span>
            <button className="dz-fenetre__fermer" type="button">
              ×
            </button>
          </div>
          <div className="dz-fenetre__corps">
            <p className="dz-chrome">
              « …et le marteau ne sert qu’à cela, à se » — la phrase
              s’arrête là, et la suite est sur une autre page.
            </p>
          </div>
        </div>
        <div className="dz-fenetre dz-fenetre--derriere" style={{ left: '38%', top: '32%', width: '44%', height: '58%' }}>
          <div className="dz-fenetre__poignee">
            <p className="dz-fenetre__titre">Le livre de l’armoire</p>
            <span className="dz-fenetre__nature">livre</span>
            <button className="dz-fenetre__fermer" type="button">
              ×
            </button>
          </div>
          <div className="dz-fenetre__corps">
            <p className="dz-chrome">
              Une page blanche, et une liste de noms. Le votre n’y est pas.
            </p>
          </div>
        </div>
        <div className="dz-fenetre dz-fenetre--au-plan" style={{ left: '24%', top: '8%', width: '48%', height: '56%' }}>
          <div className="dz-fenetre__poignee">
            <p className="dz-fenetre__titre">Marteau de Ravine</p>
            <span className="dz-fenetre__nature">outil</span>
            <button className="dz-fenetre__fermer" type="button">
              ×
            </button>
          </div>
          <div className="dz-fenetre__corps">
            <p className="dz-chrome">La fiche de l’objet, et sa toile dessous.</p>
            <div className="dz-trait" />
            <p className="dz-chrome">
              Le carnet et le livre restent derrière, et restent lisibles par
              leur bord.
            </p>
          </div>
          <div className="dz-fenetre__tirer" />
        </div>
      </div>

      <h3>Les états de la carte</h3>
      <ul className="dz-etats">
        <li className="dz-etat">
          <h4>Au repos</h4>
          <span className="dz-carte">
            <span className="dz-carte__nature">outil</span>
            <span className="dz-carte__nom">Marteau de Ravine</span>
          </span>
        </li>
        <li className="dz-etat">
          <h4>Au survol</h4>
          {/* Élévation d'un cran, `--surface-haute`. Aucun décalage : une carte
              qui bouge sous le curseur est une carte qu'on rate. */}
          <span className="dz-carte dz-carte--survol">
            <span className="dz-carte__nature">outil</span>
            <span className="dz-carte__nom">Marteau de Ravine</span>
          </span>
        </li>
        <li className="dz-etat">
          <h4>Désactivée</h4>
          <span className="dz-carte dz-carte--inactive">
            <span className="dz-carte__nature">consommable</span>
            <span className="dz-carte__nom">Fiole devigour</span>
            <span className="dz-carte__partage">il n’en reste qu’une</span>
          </span>
        </li>
        <li className="dz-etat">
          <h4>Chargement</h4>
          {/* Le cadre vide et le NOM. Le nom d'un objet ne se charge jamais
              depuis le réseau : il est dans le contenu versionné. */}
          <span className="dz-carte">
            <span className="dz-carte__nom">Lettre de Serys</span>
            <span className="dz-squelette" />
          </span>
        </li>
      </ul>

      <h3>Le tableau complet</h3>
      <table className="dz-tableau">
        <thead>
          <tr>
            <th scope="col">Composant</th>
            <th scope="col">Vide</th>
            <th scope="col">Chargement</th>
            <th scope="col">Erreur</th>
            <th scope="col">Désactivé</th>
          </tr>
        </thead>
        <tbody>
          {ETATS_CAS.map((cas) => (
            <tr key={cas.composant}>
              <th scope="row">{cas.composant}</th>
              <td>{cas.vide}</td>
              <td>{cas.chargement}</td>
              <td>{cas.erreur}</td>
              <td>{cas.desactive}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ---------------------------------------------------------------- page --- */

export function DesignShowcase(): ReactNode {
  return (
    <main className="dz">
      <header className="dz-entete">
        <p className="dz-surtitre">Feeders of Runeterra — vitrine d’interface</p>
        <h1>Le Freljord : peu de couleurs, beaucoup de contraste</h1>
        <p>
          Le rendu de <code>docs/design/05-interface.md</code>. Cette page vit
          dans le client, et non dans un dossier à côté, pour une raison précise :
          une maquette hors du dépôt dérive, parce que rien ne la oblige à
          compiler. Ici elle échoue si un jeton change de nom.
        </p>
        <p>
          Elle est <strong>hors session</strong> : une maquette qu’il faut connecter
          pour être vue est une maquette qu’on ne regarde plus.
        </p>
        <p className="dz-avertissement">
          <strong>Ceci n’est pas le produit.</strong> Les colonnes, les tiroirs, la
          carte annotable et la toile de dessin n’existent pas encore dans
          <code> features/table/</code> : ce sont des dessins, et ils sont ici pour
          être jugés avant d’être écrits. Les noms, les chiffres et les objets sont
          écrits en dur dans <code>design-data.ts</code> et ne viennent d’aucune
          requête.
        </p>
      </header>

      <nav className="dz-navigation">
        <a href="#regles">§0 règles</a>
        <a href="#jetons">§1 jetons</a>
        <a href="#contrastes">§2 contrastes</a>
        <a href="#decoupage">§4 découpage</a>
        <a href="#etats-table">§4.7 états de table</a>
        <a href="#jauges">§6 jauges</a>
        <a href="#destinataires">§7 destinataires</a>
        <a href="#carnet">§8 carnet</a>
        <a href="#etats">§9 états</a>
      </nav>

      <Regles />
      <Jetons />
      <Contrastes />
      <Decoupage />
      <EtatsTable />
      <Jauges />
      <Destinataires />
      <Carnet />
      <Etats />
    </main>
  );
}
