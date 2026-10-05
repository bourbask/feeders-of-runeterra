/**
 * Le test de la vitrine `/design`.
 *
 * CE QUE CE TEST PROUVE, et que rien d'autre ne prouve :
 *
 * - **les nombres affichés sont les vrais.** La vitrine écrit des ratios de
 *   contraste en dur, parce que le navigateur ne peut pas lire `tokens.css`
 *   pour les calculer. Un nombre écrit à la main est un nombre qui peut mentir :
 *   quelqu'un change un jeton, le ratio change, et l'écran continue d'afficher
 *   l'ancien. Ici on recalcule chaque ratio depuis `tokens.css` et on le
 *   confronte à ce que la page affiche. Si les deux divergent, le test échoue.
 *
 * - **aucun jeton n'est caché.** Un jeton de `tokens.css` qui n'apparaît pas
 *   dans la vitrine est un jeton que personne ne regarde — et donc un jeton qui
 *   peut mourir sans qu'on le remarque. L'inverse est aussi vérifié : un nom
 *   dans la vitrine qui n'existe pas dans `tokens.css` est une coquille.
 *
 * - **chaque palier, chaque état, chaque cas est rendu.** Une vitrine qui
 *   décrit cinq paliers et n'en dessine que trois n'est pas une vitrine, c'est
 *   une sélection — et une sélection est un mensonge par omission.
 *
 * Contrairement à `tokens.test.ts`, ce test REND la page. C'est délibéré : la
 * règle porte sur ce qui est affiché, pas sur ce qui est écrit dans un fichier
 * de données. Un `ETATS_CAS` complet et une page qui n'en montre que la moitié
 * passeraient le premier et échoueraient ici.
 */
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PORTEES_ORDONNEES } from '../features/table/portee.js';
import {
  PAIRES_COMPOSANT,
  PAIRES_TEXTE,
  contraste,
  couleur,
  jetonsDe,
} from '../styles/contraste.js';
import type { Jeton } from './design-data.js';
import {
  ECHELLES,
  ETATS_CAS,
  ETATS_TABLE,
  OBJETS,
  PRIMITIVES,
  REGLES,
  SEMANTIQUE,
  VARIANTES,
} from './design-data.js';
import { DesignShowcase } from './DesignShowcase.js';

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles');
const TOKENS_FILE = join(STYLES, 'tokens.css');

const jetons = jetonsDe(readFileSync(TOKENS_FILE, 'utf8'));

/** Les trois étages, dans l'ordre où la vitrine les présente. */
const ETAGES: readonly { readonly titre: string; readonly jetons: readonly Jeton[] }[] = [
  { titre: 'Étage 1 — vingt-deux valeurs brutes', jetons: PRIMITIVES },
  { titre: 'Étage 2 — sémantique', jetons: SEMANTIQUE },
  { titre: 'Étage 3 — échelles et paliers', jetons: ECHELLES },
];

/** Tout jeton que la vitrine est censée montrer, avec l'étage qui le porte. */
const AFFICHES = new Map<string, string>(
  ETAGES.flatMap((etage) => etage.jetons.map((jeton) => [jeton.nom, etage.titre])),
);

function ratio(mesure: number): string {
  return mesure.toFixed(2).replace('.', ',');
}

/**
 * UN DÉLAI EXPLICITE, ET LA MESURE QUI LE JUSTIFIE.
 *
 * Ce fichier REND la vitrine entière à chaque cas — c'est le choix expliqué
 * au-dessus, et c'est ce qui le rend lent. Mesuré : 2,7 s seul, 7,4 s quand
 * `turbo run test` fait tourner onze suites en parallèle. Le défaut de Vitest
 * est 5 s, donc la suite passait seule et tombait sous charge.
 *
 * REMESURÉ EN UI-01, parce que la page a gagné une section (§4–§7 au naturel,
 * les composants du produit importés tels quels) : 13,0 s seule et 14,5 s sous
 * la même charge pour le fichier entier, le cas le plus lent passant de 2,8 s à
 * 4,9 s. Le délai est PAR CAS, donc la marge reste d'un facteur six — il n'est
 * pas touché. Le nombre ci-dessous ne bougera que quand une mesure, et non une
 * intuition, le demandera.
 *
 * LE DÉLAI N'EST PAS UN CORRECTIF DE CONFORT : rien ici n'attend, il n'y a ni
 * minuterie ni `setTimeout` — c'est du calcul. Un test qui attendrait se
 * corrigerait en supprimant l'attente, pas en élargissant le délai (#96).
 */
describe('la vitrine /design', { timeout: 30_000 }, () => {
  it('dit, dès la première ligne, qu’elle n’est pas le produit', () => {
    // Une maquette qui se fait passer pour le produit est pire qu'aucune
    // maquette : on la prend pour la chose, et on juge la chose au lieu du
    // dessin. L'avertissement est le premier texte de la page, et ce test
    // s'assure qu'il reste le premier.
    render(<DesignShowcase />);
    expect(screen.getByText(/Ceci n’est pas le produit/u)).toBeDefined();
  });

  it('annonce qu’elle est hors session, donc consultable sans se connecter', () => {
    // Si la vitrine exigeait une session, elle serait invisible à quiconque
    // n'a pas de compte — c'est-à-dire à tout le monde le jour où on la montre
    // à quelqu'un. Le test ne prouve pas le routage (c'est `route.test.ts`),
    // il prouve que la page le dit.
    render(<DesignShowcase />);
    expect(screen.getByText(/hors session/u)).toBeDefined();
  });

  it('montre chaque jeton de tokens.css, et aucun autre', () => {
    // Le test dans les deux sens. Un jeton non montré est un jeton mort
    // potentiel ; un jeton montré qui n'existe pas est une coquille qui fait
    // croire qu'une règle est respectée quand elle ne l'est pas.
    const manquants = [...jetons.keys()].filter((nom) => !AFFICHES.has(nom));
    const fantomes = [...AFFICHES.keys()].filter((nom) => !jetons.has(nom));

    expect(manquants).toEqual([]);
    expect(fantomes).toEqual([]);
  });

  it('présente les trois étages dans l’ordre, avec leur titre', () => {
    render(<DesignShowcase />);
    for (const etage of ETAGES) {
      expect(screen.getByText(etage.titre)).toBeDefined();
    }
  });

  it('donne un rôle à chaque jeton, pas seulement sa valeur', () => {
    // Un jeton sans rôle est une couleur qu'on ne sait pas où mettre. La
    // vitrine est le seul endroit où le rôle est écrit à côté du nom, et c'est
    // pour ça qu'il faut qu'il soit là.
    render(<DesignShowcase />);
    for (const etage of ETAGES) {
      for (const jeton of etage.jetons) {
        // Un nom de jeton peut apparaître aussi dans le tableau des contrastes
        // (« --fond » est un nom ET un rôle). On vérifie qu'il apparaît au moins
        // une fois, pas qu'il apparaît une seule fois.
        expect(screen.getAllByText(jeton.nom).length).toBeGreaterThan(0);
        expect(screen.getAllByText(jeton.role).length).toBeGreaterThan(0);
      }
    }
  });

  it('affiche le ratio mesuré, et non un ratio recopié', () => {
    // LE test de ce fichier. La vitrine écrit `mesure` en dur ; ici on le
    // recalcule depuis `tokens.css` et on vérifie que la page affiche le même
    // nombre. Si quelqu'un change un jeton sans mettre à jour la vitrine, ce
    // test échoue — et c'est exactement le défaut qu'on veut voir apparaître.
    render(<DesignShowcase />);

    const paires = [...PAIRES_TEXTE, ...PAIRES_COMPOSANT];
    // LE GARDE-FOU QUI MANQUAIT. `toBeGreaterThan(0)` sur la CONCATÉNATION est
    // satisfait par les six paires de composant : vider `PAIRES_TEXTE` laissait
    // ce fichier vert et faisait disparaître dix-neuf cas ailleurs, sans un mot
    // (mode 6). Les deux listes sont donc épinglées séparément, et le 15 vient
    // du §12 de `05-interface.md` — « 15 paires texte/fond recalculées » — pas
    // de la liste elle-même.
    expect(PAIRES_TEXTE.length).toBeGreaterThanOrEqual(15);
    expect(PAIRES_COMPOSANT.length).toBeGreaterThan(0);

    for (const paire of paires) {
      const mesure = contraste(couleur(jetons, paire.devant), couleur(jetons, paire.sur));
      const affiche = screen.getAllByText(ratio(mesure));

      // Le ratio doit apparaître au moins une fois : dans le tableau, dans la
      // pastille de texte, ou les deux. S'il n'apparaît nulle part, la vitrine
      // affiche un nombre faux.
      expect(affiche.length).toBeGreaterThan(0);

      // Et le nombre affiché doit être le bon. On vérifie que le ratio
      // déclaré dans les données est bien celui qu'on vient de mesurer.
      expect(paire.mesure).toBeCloseTo(mesure, 1);
    }
  });

  it('marque chaque paire qui passe son minimum, et aucune autre', () => {
    // Un ratio qui passe doit être marqué d'une coche, et un ratio qui ne passe
    // pas doit être marqué d'une croix. Une vitrine qui met des coches partout
    // est une vitrine qui ne dit rien.
    render(<DesignShowcase />);

    for (const paire of PAIRES_TEXTE) {
      const passe = paire.mesure >= paire.minimum;
      // Le libellé peut apparaître dans la pastille de texte aussi. On ne
      // garde que les éléments qui sont dans un <tr>, c'est-à-dire le tableau.
      const lignes = screen.getAllByText(paire.quoi).filter((el) => el.closest('tr') !== null);
      expect(lignes.length).toBeGreaterThan(0);
      // La coche ou la croix est dans la même ligne que le libellé.
      const cellule = lignes[0]?.closest('tr');
      expect(cellule).not.toBeNull();
      expect(cellule?.textContent).toContain(passe ? '✔' : '✘');
    }
  });

  it('dessine les cinq paliers du §4.2, dans l’ordre', () => {
    render(<DesignShowcase />);

    for (const variante of VARIANTES) {
      expect(screen.getByText(`${String(variante.rang)} — ${variante.titre}`)).toBeDefined();
    }

    // L'ordre est une donnée, pas une accident de lecture : si on réordonne
    // `VARIANTES`, la vitrine doit se réordonner avec.
    const rangs = VARIANTES.map((variante) => variante.rang);
    expect(rangs).toEqual([...rangs].sort((a, b) => a - b));
  });

  it('dessine les trois états d’une table', () => {
    render(<DesignShowcase />);
    for (const etat of ETATS_TABLE) {
      // « Assise » apparaît dans le tableau des états et dans la vignette ;
      // « Seul » et « Séparée » peuvent apparaître dans le texte. On vérifie
      // qu'ils apparaissent au moins une fois.
      expect(screen.getAllByText(etat.nom).length).toBeGreaterThan(0);
    }
  });

  it('rend chaque cas du tableau des états du §9', () => {
    // Un état vide non dessiné est un écran blanc sur une soirée de jeu. Le
    // tableau du §9 a huit lignes ; la page doit les avoir toutes.
    render(<DesignShowcase />);
    for (const cas of ETATS_CAS) {
      expect(screen.getByText(cas.composant)).toBeDefined();
    }
  });

  it('montre les trois jauges, avec et sans couleur', () => {
    // La démonstration du §6 : la même jauge, avec sa teinte et sans. C'est la
    // seule façon de savoir si la teinte porte quelque chose ou si c'est du
    // décor.
    render(<DesignShowcase />);
    expect(screen.getByText('Avec la couleur')).toBeDefined();
    expect(screen.getByText('Sans la couleur')).toBeDefined();
  });

  it('montre les cinq états de la jauge', () => {
    render(<DesignShowcase />);
    for (const etat of ['Vide', 'Chargement', 'Erreur', 'Désactivée', 'Survol']) {
      // « Vide » et « Erreur » apparaissent aussi dans le tableau des états.
      expect(screen.getAllByText(etat).length).toBeGreaterThan(0);
    }
  });

  it('dessine la carte annotable et sa toile', () => {
    // La toile est une surface DANS la carte, pas un second panneau. Le test
    // vérifie que les deux existent, et que la toile est bien dans la carte.
    render(<DesignShowcase />);
    // La toile apparaît dans les deux cartes ouvertes (partageable et non).
    expect(screen.getAllByText(/La toile — surface de dessin/u).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Ouvrir une carte, c’est ouvrir une surface de dessin/u).length,
    ).toBeGreaterThan(0);
  });

  it('donne une règle de partage pour chaque nature d’objet', () => {
    render(<DesignShowcase />);
    for (const objet of OBJETS) {
      // Un nom d'objet apparaît dans la liste du carnet, dans le tableau et
      // dans la carte ouverte. On vérifie qu'il apparaît au moins une fois.
      expect(screen.getAllByText(objet.nom).length).toBeGreaterThan(0);
      expect(screen.getAllByText(objet.partage).length).toBeGreaterThan(0);
    }
  });

  it('énonce les huit règles du §0', () => {
    render(<DesignShowcase />);
    for (const regle of REGLES) {
      expect(screen.getByText(`Règle ${String(regle.numero)}`)).toBeDefined();
      expect(screen.getByText(regle.texte)).toBeDefined();
    }
  });

  it('importe les composants du produit, et pas seulement leur dessin', () => {
    // §0.2 : « la maquette vit dans le code ». Depuis UI-01 une partie de la
    // page EST le produit — `Jauge.tsx`, `Elan.tsx`, `Destinataire.tsx`,
    // `portee.ts`. Ce test tient cette partie-là : la source de la boucle est
    // la liste du produit, donc la vider ferait tomber le test au lieu de
    // rendre la page silencieusement incomplète.
    render(<DesignShowcase />);

    expect(PORTEES_ORDONNEES).toHaveLength(3);
    for (const vue of PORTEES_ORDONNEES) {
      expect(screen.getAllByText(vue.libelle).length).toBeGreaterThan(0);
    }

    // LE GLYPHE, SEULEMENT POUR CEUX QUI EN ONT UN, et c'est un garde-fou
    // contre le mode 9 et pas une complaisance. Depuis la correction 3 le
    // public n'a plus de glyphe : `getAllByText('')` passerait sur n'importe
    // quelle page, parce que tout élément vide y répond. Un critère vrai du
    // vide est un critère qui ne mesure rien. On exige donc le glyphe des deux
    // portées marquées, et on exige en toutes lettres que celui du public soit
    // absent.
    const marquees = PORTEES_ORDONNEES.filter((vue) => vue.marque);
    expect(marquees).toHaveLength(2);
    for (const vue of marquees) {
      expect(vue.glyphe).not.toBe('');
      expect(screen.getAllByText(vue.glyphe).length).toBeGreaterThan(0);
    }
    expect(PORTEES_ORDONNEES.filter((vue) => !vue.marque).map((vue) => vue.glyphe)).toEqual(['']);

    // La jauge rendue est bien celle du produit : son marqueur de position, en
    // toutes lettres, est dans les DEUX vignettes — avec et sans teinte.
    expect(screen.getAllByText('modifiée ce tour')).toHaveLength(2);

    // Et l'avertissement de déclassification est montré dans l'état où un
    // joueur le rencontre, pas décrit en prose.
    expect(screen.getByRole('alert').textContent).toContain('Tu réponds en public');
  });

  it('ne montre aucun joueur réel : les noms sont écrits en dur', () => {
    // La vitrine ne doit jamais afficher un vrai nom de joueur ou un vrai
    // identifiant de campagne. Si elle le faisait, elle fuit des données et
    // elle devient un écran de plus à maintenir.
    render(<DesignShowcase />);
    expect(screen.queryByText(/01M3KN4FGVVXPTKD9H539GF4FG/u)).toBeNull();
    expect(screen.queryByText(/229180716842221568/u)).toBeNull();
  });
});
