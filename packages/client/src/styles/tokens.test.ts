/**
 * Le garde-fou des jetons de `@for/client`.
 *
 * `docs/design/05-interface.md` §1 pose une règle qui n'a aucun sens tant que
 * personne ne la fait respecter : un composant référence l'étage 2 et l'étage 3
 * des jetons, jamais l'étage 1, et jamais une valeur écrite en dur. C'est ce qui
 * rend « peu de couleurs » (règle 1) une propriété du dépôt et non un goût.
 *
 * Ce test est un SCAN DE TEXTE, délibérément. Le point n'est pas l'élégance,
 * c'est que l'échec soit visible au moment où quelqu'un écrit la chose interdite,
 * et que le garde-fou soit prouvable en violant la règle. Un test qui rendrait
 * les composants serait plus joli et ne prouve rien : la règle porte sur le
 * texte écrit, donc c'est le texte qui est lu.
 *
 * Il couvre cinq choses, et chacune peut échouer seule :
 *
 * - la structure : les jetons sont dans UN fichier, et ce fichier est importé ;
 * - la pureté des étages : l'étage 1 est du brut, l'étage 2 ne l'est pas ;
 * - la résolution : aucun `var(--x)` ne pointe vers un jeton qui n'existe pas ;
 * - les contrastes : chaque paire texte/fond déclarée passe WCAG 2.1 AA ;
 * - l'absence de littéraux : aucun autre fichier du paquet n'écrit de valeur.
 *
 * Unlike `purity.test.ts` in `@for/engine`, this file sits in `src/` beside what
 * it guards, because `01-architecture.md` §2.9 forbids the client a `tests/`
 * directory. It cannot therefore match itself, so it does not need to: the
 * patterns below are only ever run against `.css` and `.tsx`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  contraste,
  couleur,
  declarations,
  jetonsDe,
  PAIRES_COMPOSANT,
  PAIRES_TEXTE,
  resout,
} from './contraste.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(SRC, 'styles');
const TOKENS_FILE = join(STYLES, 'tokens.css');
const GLOBAL_FILE = join(STYLES, 'global.css');

/** Files the scan is allowed to read, and which of them own the values. */
const FEUILLE = /\.css$/u;
const COMPOSANT = /\.tsx$/u;
const PROPRIETAIRES = new Set([TOKENS_FILE]);

// ---------------------------------------------------------------------------
// Lecture du fichier de jetons
// ---------------------------------------------------------------------------

const jetons = jetonsDe(readFileSync(TOKENS_FILE, 'utf8'));

function estPremierEtage(nom: string): boolean {
  return nom.startsWith('--p-');
}

/**
 * Les jetons d'ÉCHELLE et de PALIER : des grandeurs, pas des rôles. Un jeton
 * qui n'est ni une primitive (`--p-`) ni une échelle est un RÔLE, et un rôle
 * doit référencer une primitive plutôt que de porter sa valeur — c'est la règle
 * de `tokens.css`. `--vignette-` est donc dans la liste : une hauteur de cadre
 * est une grandeur, pas un rôle, et elle a le droit de s'écrire en `rem`.
 *
 * La liste est explicite, pas un motif large. C'est volontaire : ajouter un
 * préfixe ici est un acte, et il se voit en diff.
 */
function estEchelle(nom: string): boolean {
  return /^--(?:e|t|r|z|ecran|rail|seuil|filet|vignette)-/u.test(nom);
}

// ---------------------------------------------------------------------------
// Le scan du paquet
// ---------------------------------------------------------------------------

function fichiersRacines(repertoire: string, extension: RegExp): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(repertoire, { withFileTypes: true })) {
    const complet = join(repertoire, entree.name);
    if (entree.isDirectory()) {
      trouves.push(...fichiersRacines(complet, extension));
    } else if (extension.test(entree.name) && !entree.name.endsWith('.test.ts')) {
      trouves.push(complet);
    }
  }
  return trouves;
}

const A_SCANNER: readonly { readonly nom: string; readonly chemin: string }[] = [
  ...fichiersRacines(SRC, FEUILLE),
  ...fichiersRacines(SRC, COMPOSANT),
]
  .filter((chemin) => !PROPRIETAIRES.has(chemin))
  .map((chemin) => ({ nom: relative(SRC, chemin), chemin }));

interface Infraction {
  readonly label: string;
  readonly motif: RegExp;
}

/**
 * Each entry names ONE way to write a value that should have been a token. The
 * labels are the ones a contributor will read, so they say what to do instead.
 */
const INTERDITS: readonly Infraction[] = [
  { label: 'une couleur en dur — il faut un jeton de `tokens.css`', motif: /#[0-9a-fA-F]{3,8}\b/u },
  {
    label: 'une couleur en dur — il faut un jeton de `tokens.css`',
    motif: /\b(?:rgba?|hsla?)\s*\(/u,
  },
  {
    label: 'une longueur en `px` — l’échelle est en `rem` (`--e-1` à `--e-12`)',
    motif: /\b\d+(?:\.\d+)?px\b/u,
  },
  {
    label:
      'une primitive d’étage 1 — un composant référence l’étage 2 (`--p-` est réservé à `tokens.css`)',
    motif: /var\(\s*--p-/u,
  },
];

function infractions(texte: string): string[] {
  return INTERDITS.filter(({ motif }) => motif.test(texte)).map(({ label }) => label);
}

/**
 * Un commentaire de CSS ne fait rien au rendu. Un `#ff0000` ou un `var(--x)`
 * écrit dans un commentaire n'est donc pas une infraction — c'est souvent
 * l'inverse, une explication de ce qu'il ne faut pas écrire. Sans ce retrait,
 * le fichier qui explique la règle échoue à la règle, et l'auteur remplace alors
 * l'explication par un mot plus prudent : la documentation se tait.
 *
 * Seuls les commentaires `/* … *\/` sont retirés, parce qu'ils sont sans
 * ambiguïté. Les commentaires `//` sont laissés : les retirer casserait un
 * `https://` écrit dans une chaîne.
 */
function sansCommentaires(texte: string): string {
  return texte.replace(/\/\*[\s\S]*?\*\//gu, '');
}

describe('les jetons du client', () => {
  it('vit dans UN fichier, et ce fichier est importé', () => {
    // Sans l'import, tout le reste de ce fichier passe au vert sur une feuille
    // de style que personne ne charge. C'est le mode d'échec « règle présente
    // et inerte », et il ne se voit pas autrement.
    const global = readFileSync(GLOBAL_FILE, 'utf8');
    expect(global).toMatch(/@import\s+'\.\/tokens\.css'\s*;/u);

    // Aucun jeton ne reste derrière dans `global.css` : deux endroits pour
    // définir une valeur, c'est un endroit où elle finit par diverger.
    expect(declarations(global).map((d) => d.nom)).toEqual([]);
  });

  it('trouve au moins les feuilles qu’il est censé lire', () => {
    // Sans ce test, un glob cassé fait passer tous les scans suivants sur rien.
    expect(A_SCANNER.length).toBeGreaterThanOrEqual(5);
  });

  it('étage 1 : toute primitive est une valeur brute', () => {
    const impures = [...jetons]
      .filter(([nom]) => estPremierEtage(nom))
      .filter(([, valeur]) => !/^#[0-9a-f]{6}$/u.test(valeur))
      .map(([nom, valeur]) => `${nom}: ${valeur}`);

    expect(impures).toEqual([]);
  });

  it('étage 2 : aucun rôle ne porte sa valeur en dur', () => {
    // C'est LA règle du fichier. Une primitive existe pour qu'un rôle soit
    // defini une fois ; un rôle qui réécrit son hexadécimal n'utilise pas la
    // primitive, il la duplique.
    const bruts = [...jetons]
      .filter(([nom]) => !estPremierEtage(nom) && !estEchelle(nom))
      .filter(([, valeur]) => !valeur.startsWith('var('))
      .map(([nom, valeur]) => `${nom}: ${valeur}`);

    expect(bruts).toEqual([]);
  });

  it('tout jeton se résout, et aucun ne pointe dans le vide', () => {
    const pendants = [...jetons]
      .filter(([nom]) => resout(jetons, nom) === undefined)
      .map(([nom]) => nom);

    expect(pendants).toEqual([]);
  });

  it('aucun var(--x) ne cite un jeton qui n’existe pas', () => {
    // Un `var(--typo)` ne lève rien : la propriété retombe silencieusement sur
    // sa valeur initiale, et l'écran affiche du texte blanc sur du texte blanc.
    const cites = new Set<string>();
    const chercher = (texte: string): void => {
      for (const trouve of sansCommentaires(texte).matchAll(/var\(\s*(--[\w-]+)/gu)) {
        const cite = trouve[1];
        if (cite !== undefined) cites.add(cite);
      }
    };

    chercher(readFileSync(TOKENS_FILE, 'utf8'));
    for (const { chemin } of A_SCANNER) chercher(readFileSync(chemin, 'utf8'));

    expect([...cites].filter((nom) => !jetons.has(nom)).sort()).toEqual([]);
  });

  it('mesure au moins les 15 paires que le §12 promet', () => {
    // MODE 6 : UNE LISTE QUI EST SA PROPRE SOURCE DE BOUCLE. Les deux `it.each`
    // ci-dessous sont engendrés PAR `PAIRES_TEXTE` et `PAIRES_COMPOSANT` : vider
    // l'une des deux ne fait pas rougir une ligne, elle fait DISPARAÎTRE les cas,
    // et une suite sans cas est verte. Mesuré : `PAIRES_TEXTE` vidée, zéro échec,
    // dix-neuf tests évaporés en silence.
    //
    // Le chiffre ne vient donc pas de la liste — il viendrait d'elle-même, et un
    // chiffre comparé à lui-même ne prouve rien (§5 bis). Il vient du §12 de
    // `docs/design/05-interface.md`, « Les 15 contrastes promis sont promis …
    // 15 paires texte/fond recalculées, ≥ 4,5 chacune », et il est écrit ici en
    // toutes lettres. `>=` et non `===` : la PR du 5 octobre en a ajouté quatre,
    // et une promesse de plancher ne doit pas interdire d'en mesurer plus.
    expect(PAIRES_TEXTE.length).toBeGreaterThanOrEqual(15);
    // Et les paires de composant ne comblent pas le trou : ce sont deux
    // promesses, deux minima (4,5 contre 3), et le §12 ne parle que des
    // premières. Sans cette ligne, la liste des six suffirait à satisfaire un
    // compte global.
    expect(PAIRES_COMPOSANT.length).toBeGreaterThan(0);
    expect(PAIRES_TEXTE.every((paire) => paire.minimum === 4.5)).toBe(true);
  });

  it.each(PAIRES_TEXTE)('$devant sur $sur — $quoi passe le contraste AA', (paire) => {
    expect(
      contraste(couleur(jetons, paire.devant), couleur(jetons, paire.sur)),
    ).toBeGreaterThanOrEqual(paire.minimum);
  });

  it.each(PAIRES_COMPOSANT)('$devant sur $sur — $quoi passe le contraste 1.4.11', (paire) => {
    expect(
      contraste(couleur(jetons, paire.devant), couleur(jetons, paire.sur)),
    ).toBeGreaterThanOrEqual(paire.minimum);
  });

  it('`--trait` reste sous 3:1, et c’est assumé', () => {
    // Le filet d'un panneau est décoratif : un panneau est identifié par son
    // titre, qui est un vrai <h2>. Ce test existe pour que le jour où quelqu'un
    // spunlock ce filet à 3:1 en croyant corriger un défaut, il apprenne qu'il
    // vient de casser autre chose.
    expect(contraste(couleur(jetons, '--trait'), couleur(jetons, '--fond'))).toBeLessThan(3);
  });

  it('l’échelle d’espacement est une suite sans trou', () => {
    const presents = [...jetons.keys()]
      .filter((nom) => /^--e-\d+$/u.test(nom))
      .map((nom) => Number.parseInt(nom.slice(4), 10))
      .sort((a, b) => a - b);

    expect(presents).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('les plans montent, donc le dernier ouvert reste au-dessus', () => {
    // L'ordre du fichier n'est pas l'ordre des plans. C'est le tri par valeur
    // qui compte, parce que « ouvert en dernier » veut dire « le plus haut ».
    const plans = [...jetons]
      .filter(([nom]) => nom.startsWith('--z-'))
      .map(([nom, valeur]) => ({ nom, valeur: Number.parseInt(valeur, 10) }))
      .sort((a, b) => a.valeur - b.valeur)
      .map(({ nom }) => nom);

    expect(plans).toEqual(['--z-panneau', '--z-survol', '--z-dialogue', '--z-toile']);
  });

  it.each(A_SCANNER)('$nom n’écrit aucune valeur en dur', ({ chemin }) => {
    expect(infractions(readFileSync(chemin, 'utf8'))).toEqual([]);
  });

  it('aucune grille ne peut déborder l’écran le plus étroit', () => {
    // Le plancher par défaut d'une piste `fr` est `auto`, et `auto` refuse de
    // descendre sous son contenu : la grille déborde au lieu de rétrécir. C'est
    // le défaut de mise en page le plus facile à introduire et le plus dur à
    // voir, parce qu'il n'apparaît que sur l'écran le plus étroit du parc.
    //
    // Un plancher n'est pas interdit en soi : `minmax(16rem, 1fr)` refuse de
    // descendre sous 16rem, et c'est très bien tant que ces 16rem entrent. Ce
    // qui ne va pas, c'est la SOMME des planchers d'une même grille. Elle est
    // comparée au seuil en dessous duquel tout passe en colonne unique,
    // parce que c'est à cette largeur — et à elle seule — que la grille doit
    // encore tenir.
    const seuil = jetons.get('--seuil-tiroir-tout');
    expect(seuil).toMatch(/^[\d.]+rem$/u);
    const plafond = Number.parseFloat((seuil ?? '').replace('rem', ''));

    const fautifs: string[] = [];
    for (const { nom, chemin } of A_SCANNER) {
      const feuille = readFileSync(chemin, 'utf8');
      for (const grille of feuille.matchAll(/grid-template-(?:columns|rows)\s*:\s*([^;}]+)/gu)) {
        const declaration = grille[1];
        if (declaration === undefined) continue;

        const planchers: number[] = [];
        for (const plancher of declaration.matchAll(/minmax\(\s*([\d.]+)(?:rem|px)/gu)) {
          planchers.push(Number.parseFloat(plancher[1] ?? ''));
        }
        // Une piste écrite en dur, sans minmax(), compte aussi.
        for (const nue of declaration.matchAll(/(?:^|\s)([\d.]+)(?:rem|px)(?=\s|$)/gu)) {
          planchers.push(Number.parseFloat(nue[1] ?? ''));
        }

        const somme = planchers.reduce((a, b) => a + b, 0);
        if (somme > plafond) {
          fautifs.push(
            `${nom} : les planchers font ${String(somme)}rem, plus que ${String(plafond)}rem`,
          );
        }
      }
    }

    expect(fautifs).toEqual([]);
  });

  it('les `rem` écrits en dur ne peuvent qu’enduire', () => {
    // Le reste de la dette, mesurée. `--e-1` … `--e-12` est l'unique échelle
    // d'espacement, et `global.css` — écrit avant qu'elle existe — s'en écarte
    // encore en 15 valeurs distinctes. Ce n'est pas une raison de les garder
    // tels quels : c'est une raison de ne pas pouvoir en ajouter une seizième
    // en attendant. Le jour où quelqu'un migre une règle, il baisse le nombre
    // en bas de ce fichier, et le test oblige à ce que ce soit bien le nouveau.
    //
    // `0rem` n'est pas compté : ce n'est pas une distance, c'est l'absence de
    // distance. `minmax(0rem, 1fr)` est la forme documentée du §4.1, et compter
    // le zéro comme une dette d'espacement reviendrait à interdire d'écrire
    // « pas de plancher ».
    const valeurs = new Set<string>();
    for (const { chemin } of A_SCANNER) {
      if (!chemin.endsWith('.css')) continue;
      for (const trouve of readFileSync(chemin, 'utf8').matchAll(/[\d.]+rem\b/gu)) {
        const valeur = trouve[0];
        if (valeur !== '0rem') valeurs.add(valeur);
      }
    }

    expect([...valeurs].sort()).toHaveLength(DETTE_REM);
  });

  it('aucune zone à contenu libre ne prend sa hauteur à l’échelle d’espacement', () => {
    // Le bug que ce test a été écrit après : une maquette de table haute de
    // `var(--e-12)` parce que « c'était la seule valeur sous la main ». `--e-12`
    // vaut 6rem, l'échelle est faite de MARGES, et une boîte qui doit contenir
    // du texte arbitraire ne peut pas faire 6rem de haut : elle déborde — puis,
    // sans `overflow`, elle recouvre la section suivante. Ça ne lève aucune
    // erreur, ça ne casse aucun test, et ça rend la page entière illisible.
    //
    // LA DISTINCTION, parce qu'elle est le test lui-même :
    //
    // - INTERDIT : `min-height` sur une zone à contenu libre. Un tube de jauge,
    //   un tube d'horloge, un tube de silhouette : leur hauteur EST leur forme,
    //   et un cran d'échelle y est correct. Un cadre, une vignette, une toile
    //   de dessin : leur hauteur est un CADRE, et elle vient d'un jeton nommé.
    //
    // - PERMIS : `height` fixe sur un élément de taille connue (une pastille,
    //   une poignée), et les `width`/`max-width` de rails et de vignettes, qui
    //   sont des largeurs de COLONNE, déjà couvertes par `--rail-*`.
    //
    // Donc on ne cherche que `min-height: var(--e-N)`. C'est étroit, et c'est
    // voulu : un test large ici donnerait dix faux positifs et serait
    // désactivé sous une semaine.
    const hauteurDeZone = /^\s*min-height\s*:\s*var\(--e-\d+\)/mu;
    const coupables: string[] = [];

    for (const { nom, chemin } of A_SCANNER) {
      if (!chemin.endsWith('.css')) continue;
      const lignes = readFileSync(chemin, 'utf8').split('\n');
      for (const [index, ligne] of lignes.entries()) {
        if (hauteurDeZone.test(ligne)) {
          coupables.push(`${nom}:${String(index + 1)} — ${ligne.trim()}`);
        }
      }
    }

    expect(coupables).toEqual([]);
  });

  it('seul le fil défile, et rien ne défile latéralement', () => {
    // Deux défauts qui se voient tout de suite à l'écran et qu'aucun test ne
    // voyait : des barres de défilement SUR les colonnes latérales, parce
    // que la fiche est plus longue que la vignette ; et un défilement
    // horizontal, parce qu'une carte d'objet ou un nom d'atout est plus large
    // que sa colonne.
    //
    // Le principe, une fois pour toutes : dans cette maquette, le SEUL élément
    // qui défile verticalement est le FIL — c'est le seul contenu borné par le
    // temps et pas par la place. Tout le reste tient sur un écran, donc il doit
    // se comprimer, se casser, ou être rogné par le cadre. Jamais défiler.
    //
    // Et RIEN ne défile horizontalement, nulle part : une information qu'on
    // doit faire glisser latéralement pour être lue est une information mal
    // posée, pas une information longue.
    //
    // CE QUE CE TEST REGARDAIT, ET CE QU'IL REGARDE MAINTENANT. Il tenait une
    // liste de CANDIDATS — cinq classes `dz-*`, c'est-à-dire la vitrine — et ne
    // disait rien de tout ce qui n'y figurait pas : le produit entier, dont
    // `table.css`, pouvait se mettre à défiler sans qu'une ligne tombe. On
    // relève donc l'INVERSE : la liste exacte des classes qui déclarent un
    // défilement vertical, dans TOUTES les feuilles scannées, épinglée au
    // tableau ci-dessous. Ajouter une barre quelque part la fait rougir ; en
    // retirer une au fil aussi. Une liste de coupables vide pouvait être vraie
    // d'un fichier vide ; un tableau exact ne peut pas l'être.
    //
    // Le raccourci `overflow` compte autant que `overflow-y` : `overflow: auto`
    // défile verticalement, et ne pas le lire laissait passer la moitié des
    // façons de l'écrire.
    const DEFILEMENT_VERTICAL = /^\s*overflow(?:-y)?\s*:\s*(?:auto|scroll)/mu;
    const qui: string[] = [];
    const coupables: string[] = [];

    for (const { nom, chemin } of A_SCANNER) {
      if (!chemin.endsWith('.css')) continue;
      const css = sansCommentaires(readFileSync(chemin, 'utf8'));

      for (const bloc of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/gu)) {
        const classe = bloc[1];
        const corps = bloc[2];
        if (classe === undefined || corps === undefined) continue;

        // 1. Qui défile verticalement, où que ce soit.
        if (DEFILEMENT_VERTICAL.test(corps)) qui.push(classe);

        // 2. Aucun défilement horizontal, nulle part.
        if (/overflow-x\s*:\s*(?:auto|scroll)/u.test(corps)) {
          coupables.push(`${nom} — .${classe} défile latéralement`);
        }
      }
    }

    // LE TABLEAU EXACT, et les trois lignes qui le composent :
    //   - `fr-fil`  : le fil du PRODUIT. C'est lui, la règle.
    //   - `dz-fil`  : le même fil, dessiné dans la vitrine `/design`.
    //   - `dz-fenetre__corps` : le corps d'une fenêtre REDIMENSIONNABLE de la
    //     vitrine, qu'on tire à la main pour comparer des maquettes. Ce n'est
    //     pas un écran de jeu, et son cadre est l'objet même de la
    //     démonstration.
    expect([...new Set(qui)].sort()).toEqual(['dz-fenetre__corps', 'dz-fil', 'fr-fil']);
    expect(coupables).toEqual([]);
  });

  it('le fil ET les colonnes latérales ont un plafond, par le même jeton', () => {
    // LE DÉFAUT QUE LE PLAFOND DU FIL NE COUVRAIT PAS. Le fil a cessé de
    // pousser la page (correction 1) ; une FICHE longue le pouvait encore,
    // parce que la borne ne visait que `.fr-fil`. Une colonne sans plafond
    // rallonge la surface de jeu, et l'écran redevient plus haut que l'écran.
    //
    // On exige donc les DEUX règles, et le MÊME jeton dans les deux : deux
    // plafonds différents pour deux colonnes côte à côte seraient deux
    // décisions là où il n'y en a qu'une.
    const css = sansCommentaires(readFileSync(join(STYLES, 'table.css'), 'utf8'));
    const plafonds = [...css.matchAll(/([^{}]+)\{([^}]*max-height[^}]*)\}/gu)].map((bloc) => ({
      selecteur: (bloc[1] ?? '').trim(),
      jeton: /max-height\s*:\s*var\((--[\w-]+)\)/u.exec(bloc[2] ?? '')?.[1] ?? null,
    }));

    const cibles = plafonds.map((plafond) => plafond.selecteur).sort();
    expect(cibles).toEqual([
      ".fr-table[data-largeur='assise'] .fr-fil",
      ".fr-table[data-largeur='assise'] .fr-rail",
    ]);

    // Le même jeton pour les deux, et il existe vraiment dans `tokens.css`.
    expect([...new Set(plafonds.map((plafond) => plafond.jeton))]).toEqual(['--ecran-fil-hauteur']);
    expect(jetons.has('--ecran-fil-hauteur')).toBe(true);
  });

  it('la hauteur d’une vignette vient d’un jeton nommé, pas d’une marche', () => {
    // Le même bug, vu par l'autre bout : plutôt que d'interdire une syntaxe,
    // on exige qu'un cadre ait une hauteur qui a un NOM. Une hauteur nommée se
    // trouve dans `tokens.css`, se discute, et se change en un endroit. Une
    // hauteur empruntée à l'échelle est anonyme : personne ne la trouve, donc
    // personne ne la change.
    const hauteur = jetons.get('--vignette-hauteur');
    expect(hauteur).toMatch(/^[\d.]+rem$/u);

    const css = readFileSync(join(STYLES, 'design.css'), 'utf8');
    const cadres = [...css.matchAll(/^\s*height\s*:\s*(.+);/gmu)]
      .map((trouve) => trouve[1]?.trim() ?? '')
      .filter((valeur) => valeur.startsWith('var('));

    // Toute hauteur de cadre est un jeton nommé — pas un `--e-*`, pas un brut.
    for (const valeur of cadres) {
      expect(valeur).toMatch(/^var\(--[a-z][\w-]*\)$/u);
    }
  });
});

/**
 * LA SPEC ÉCRIT DES HEXADÉCIMAUX, ET ILS ONT ÉTÉ FAUX PENDANT DES MOIS.
 *
 * `05-interface.md` §1.2 tabule les vingt-deux primitives avec leur valeur. Au
 * passage du sombre au clair, `tokens.css` a changé et le document n'a pas
 * bougé : les VINGT-DEUX valeurs décrivaient l'ancienne rampe. Deux relecteurs
 * indépendants ont calculé sur elles le contraste d'un mode sombre qui n'existe
 * plus nulle part dans le client — `global.css` déclare `color-scheme: light`
 * et aucun fichier ne porte de `prefers-color-scheme`.
 *
 * Un document que les agents lisent avant d'écrire une ligne vaut un test.
 */
const SPEC_FILE = join(SRC, '..', '..', '..', 'docs', 'design', '05-interface.md');

describe('la spec et les jetons disent la même chose', () => {
  it('chaque hexadécimal écrit dans §1.2 est la valeur du jeton qu’il nomme', () => {
    const spec = readFileSync(SPEC_FILE, 'utf8');
    const ecrits = [...spec.matchAll(/`(--p-[a-z]+-\d+)`\s*\|\s*`(#[0-9a-fA-F]{6})`/gu)];

    // Non vacuité : la §1.2 annonce « Vingt-deux valeurs brutes » en toutes
    // lettres. Une table vidée ferait passer une boucle vide.
    expect(ecrits).toHaveLength(22);

    const ecarts = ecrits
      .map(([, nom, valeur]) => ({
        nom: nom!,
        ecrit: valeur!.toLowerCase(),
        reel: jetons.get(nom!),
      }))
      .filter((paire) => paire.reel?.toLowerCase() !== paire.ecrit)
      .map(
        (paire) =>
          `${paire.nom} : la spec dit ${paire.ecrit}, tokens.css dit ${paire.reel ?? '(absent)'}`,
      );

    expect(ecarts).toEqual([]);
  });
});

/**
 * LES DEUX PLAFONDS DE LA §2.1, et pourquoi il en faut deux.
 *
 * Le budget d'origine disait six teintes et comptait ensemble quatre gris de
 * fond qui tiennent dans un mouchoir et les couleurs qui portent un sens. On le
 * dépassait sans rien avoir abîmé. Relevé à onze le 5 octobre, avec un second
 * plafond sur les seuls ACCENTS — c'est lui qui tient la phrase d'origine,
 * « trois accents de couleur, pas dix ».
 *
 * LES DEUX NOMBRES SONT ÉCRITS EN TOUTES LETTRES ici, et relus dans la §2.1 :
 * ils viennent d'un arbitrage, pas de `tokens.css`. Les compter depuis le code
 * ferait un chiffre qui s'accorde avec lui-même (ADR 0007).
 */
const PLAFOND_TEINTES = 13;
const PLAFOND_ACCENTS = 4;

/**
 * LES RÔLES NE SONT PAS ÉCRITS ICI, ILS SONT LUS DANS LES FEUILLES.
 *
 * Une liste écrite à la main serait sa propre source : un rôle de couleur
 * ajouté à `table.css` ne la ferait pas grandir, et le plafond ne verrait rien.
 * Mesuré en écrivant ce test — une première version portait la liste, et une
 * douzième teinte passait sans faire rougir. C'est le mode 6 de `RECETTE.md`.
 *
 * Donc : on lit les `var(--x)` des feuilles qui habillent la table, on les
 * résout jusqu'à leur valeur brute, et on ne garde que ce qui est une couleur.
 */
/**
 * ── LA LISTE DES FEUILLES EST LUE, PAS ÉCRITE ─────────────────────────────
 *
 * Elle était écrite à la main — `table.css` et `global.css` — et le plafond ne
 * voyait donc QUE ces deux fichiers. Mesuré en écrivant UI-03 : une feuille
 * neuve (`personnage.css`) pouvait introduire une quatorzième teinte sans
 * qu'une ligne tombe, parce qu'elle n'était dans aucune liste. C'est le mode 6
 * de `RECETTE.md`, appliqué à un fichier au lieu d'un tableau.
 *
 * On lit donc TOUTES les feuilles de `styles/`, et on en retire deux, chacune
 * avec sa raison :
 *
 *   - `tokens.css` : c'est la DÉFINITION des teintes. Les compter là
 *     reviendrait à mesurer le catalogue, pas l'écran.
 *   - `design.css` : la vitrine `/design` EXPOSE la palette — elle affiche
 *     chaque primitive à côté de son rôle (§0.2 : « ce n'est pas un produit »).
 *     Elle touche donc légitimement des teintes qu'aucun écran de jeu
 *     n'affiche, et son décompte dirait combien de couleurs EXISTENT, jamais
 *     combien un joueur en voit à la fois.
 *
 * Une feuille de produit ajoutée demain est comptée sans que personne y pense ;
 * l'en exclure demande un acte, et cet acte se voit en diff.
 */
const HORS_PRODUIT = new Set(['tokens.css', 'design.css']);

const FEUILLES_DE_TABLE = fichiersRacines(STYLES, FEUILLE).filter(
  (chemin) => !HORS_PRODUIT.has(chemin.slice(STYLES.length + 1)),
);

/**
 * Les trois aplats de jauge comptent pour UN : §2.1, « une seule couleur de
 * jauge à la fois, parce qu'un personnage n'a qu'un personnage ».
 */
const APLATS_DE_JAUGE = ['--vigueur-aplat', '--ame-aplat', '--vivres-aplat'];

const EST_COULEUR = /^#[0-9a-fA-F]{6}$/u;

function teintesDesFeuilles(): Set<string> {
  const vues = new Set<string>();
  for (const feuille of FEUILLES_DE_TABLE) {
    const texte = readFileSync(feuille, 'utf8');
    for (const [, nom] of texte.matchAll(/var\((--[\w-]+)\)/gu)) {
      if (nom === undefined || APLATS_DE_JAUGE.includes(nom)) continue;
      const valeur = resout(jetons, nom);
      if (valeur !== undefined && EST_COULEUR.test(valeur)) vues.add(valeur.toLowerCase());
    }
  }
  return vues;
}

/** Les rôles qui DISENT quelque chose : lus eux aussi, jamais listés. */
function accentsDeclares(): Set<string> {
  const tokens = readFileSync(TOKENS_FILE, 'utf8');
  const valeurs = new Set<string>();
  for (const [, nom] of tokens.matchAll(/(--portee-[\w-]+):/gu)) {
    const valeur = nom === undefined ? undefined : resout(jetons, nom);
    if (valeur !== undefined) valeurs.add(valeur.toLowerCase());
  }
  return valeurs;
}

describe('le budget de couleurs de la §2.1', () => {
  it('lit toutes les feuilles de produit, et pas seulement celles d’hier', () => {
    // Sans ce cas, un filtre trop large viderait `FEUILLES_DE_TABLE` et le
    // plafond passerait sur rien. Les deux écrans du produit sont nommés ici
    // parce qu'ils EXISTENT ; le jour où un troisième arrive, il est lu sans
    // que cette ligne bouge.
    const noms = FEUILLES_DE_TABLE.map((chemin) => chemin.slice(STYLES.length + 1)).sort();
    expect(noms).toContain('global.css');
    expect(noms).toContain('table.css');
    expect(noms).toContain('personnage.css');
    expect(noms).not.toContain('tokens.css');
    expect(noms).not.toContain('design.css');
  });

  it(`n’affiche pas plus de ${String(PLAFOND_TEINTES)} teintes à la fois`, () => {
    const teintes = teintesDesFeuilles();
    // Non vacuité : une lecture qui ne trouverait rien passerait tous les
    // plafonds du monde. Le plancher vient de la §2.1, qui en énumère dix.
    expect(teintes.size).toBeGreaterThanOrEqual(6);
    // Le dernier est la jauge du moment : une seule, jamais trois.
    expect(teintes.size + 1).toBeLessThanOrEqual(PLAFOND_TEINTES);
  });

  it(`n’affiche pas plus de ${String(PLAFOND_ACCENTS)} accents`, () => {
    const accents = accentsDeclares();
    expect(accents.size).toBeGreaterThanOrEqual(3);
    expect(accents.size + 1).toBeLessThanOrEqual(PLAFOND_ACCENTS);
  });

  it('les trois portées ont trois valeurs DISTINCTES', () => {
    // L'arbitrage du 5 octobre : trois teintes bien distinctes, et non deux.
    expect(accentsDeclares().size).toBe(3);
  });

  it('la §2.1 écrit les deux mêmes nombres que ce test', () => {
    // Le document et le test se contrôlent l'un l'autre : changer l'un sans
    // l'autre fait rougir, dans les deux sens.
    const spec = readFileSync(SPEC_FILE, 'utf8');
    expect(spec).toContain(`| **teintes** | **${String(PLAFOND_TEINTES)}** |`);
    expect(spec).toContain(`| **accents** | **${String(PLAFOND_ACCENTS)}** |`);
  });
});

/** Distinct `rem` values still written by hand in the client's stylesheets. */
const DETTE_REM = 15;
