/**
 * Les données de la vitrine `/design`.
 *
 * POURQUOI UN FICHIER À PART. La vitrine affiche des nombres de contraste, et
 * son test les recalcule à partir de `tokens.css`. Si les deux écrivaient leurs
 * paires séparément, le test vérifierait que la vitrine est d'accord avec
 * elle-même, ce qui ne prouve rien. Ici il n'y a qu'une liste, et le test la
 * confronte à la mesure : si un jeton bouge et qu'un ratio passe sous le
 * minimum, l'écran affiche un nombre faux et le test échoue. C'est exactement
 * le défaut qu'on veut voir apparaître.
 *
 * AUCUN CSS ICI. Ni import, ni image, ni dépendance : ce module est lu par le
 * navigateur ET par un test, et un test qui charge une feuille de style ne
 * prouve rien sur ce qui est affiché.
 *
 * LES PAIRES DE CONTRASTE NE SONT PAS ICI. Elles sont dans
 * `styles/contraste.ts`, avec la mesure qui les vérifie, parce que
 * `tokens.test.ts` a besoin de la même liste pour prouver qu'elles passent
 * leur minimum. Deux listes auraient été deux occasions de diverger.
 */

/** Un jeton, et ce qu'il est censé dire. Le rôle est en français : c'est la
 *  seule chose qu'un jeton ne peut pas dire tout seul. */
export interface Jeton {
  readonly nom: string;
  readonly role: string;
}

export const PRIMITIVES: readonly Jeton[] = [
  { nom: '--p-glace-1000', role: 'fond de vignette, jamais en fond de page' },
  { nom: '--p-glace-900', role: 'le fond de page' },
  { nom: '--p-glace-800', role: 'le fond de panneau' },
  { nom: '--p-glace-700', role: 'surface élevée : un panneau posé sur un panneau' },
  { nom: '--p-glace-600', role: 'le filet d’un panneau' },
  { nom: '--p-glace-500', role: 'anneau de focus — le seul filet qui doit passer 3:1' },
  { nom: '--p-brume-400', role: 'trait désactivé, et le remplissage de la jauge d’âme' },
  { nom: '--p-brume-300', role: 'le texte discret' },
  { nom: '--p-brume-100', role: 'le texte courant' },
  { nom: '--p-blanc-000', role: 'texte sur un aplat clair' },
  { nom: '--p-azure-700', role: 'accent en aplat, fond de pastille' },
  { nom: '--p-azure-500', role: 'l’accent, l’action principale' },
  { nom: '--p-azure-300', role: 'accent en texte sur fond sombre accentué' },
  { nom: '--p-braise-600', role: 'erreur en aplat' },
  { nom: '--p-braise-500', role: 'l’ancien --annule — et le remplissage de la jauge de vigueur' },
  { nom: '--p-braise-300', role: 'erreur en texte' },
  { nom: '--p-ambre-500', role: 'vivres, en aplat' },
  { nom: '--p-ambre-300', role: 'vivres, en texte' },
  { nom: '--p-verde-500', role: 'succès, en aplat' },
  { nom: '--p-verde-300', role: 'succès, en texte' },
  { nom: '--p-violet-500', role: 'le personnage, en aplat' },
  { nom: '--p-violet-300', role: 'le personnage, en texte' },
];

export const SEMANTIQUE: readonly Jeton[] = [
  { nom: '--fond', role: 'fond de page' },
  { nom: '--fond-panneau', role: 'fond de panneau' },
  { nom: '--surface-haute', role: 'panneau posé sur panneau, survol' },
  { nom: '--trait', role: 'bordure de panneau — décoratif, sous 3:1 assumé' },
  { nom: '--trait-fort', role: 'anneau de focus' },
  { nom: '--texte', role: 'texte courant' },
  { nom: '--texte-discret', role: 'métadonnées, libellés' },
  { nom: '--texte-inverse', role: 'texte sur aplat clair' },
  { nom: '--accent', role: 'action principale, lien' },
  { nom: '--accent-aplat', role: 'fond de pastille active' },
  { nom: '--annule', role: 'refus, coupure, jauge de vigueur en texte' },
  { nom: '--annule-aplat', role: 'fond de bandeau d’erreur' },
  { nom: '--succes', role: 'validation serveur, gain' },
  { nom: '--vivres', role: 'la jauge des vivres, en texte' },
  { nom: '--vigueur-aplat', role: 'remplissage de la jauge de vigueur' },
  { nom: '--ame-aplat', role: 'remplissage de la jauge d’âme' },
  { nom: '--vivres-aplat', role: 'remplissage de la jauge des vivres' },
  { nom: '--portee-publique', role: 'rail actif d’un bloc visible par toute la table' },
  { nom: '--portee-restreinte', role: 'rail actif d’un bloc visible par un sous-ensemble' },
];

export const ECHELLES: readonly Jeton[] = [
  { nom: '--e-1', role: '0,25rem — l’interligne d’un libellé' },
  { nom: '--e-2', role: '0,5rem — entre deux éléments voisins' },
  { nom: '--e-3', role: '0,75rem — le pas par défaut' },
  { nom: '--e-4', role: '1rem — l’unité de respiration' },
  { nom: '--e-5', role: '1,25rem — le pas d’un composant' },
  { nom: '--e-6', role: '1,5rem — entre deux sections' },
  { nom: '--e-7', role: '2rem' },
  { nom: '--e-8', role: '2,5rem' },
  { nom: '--e-9', role: '3rem' },
  { nom: '--e-10', role: '4rem' },
  { nom: '--e-11', role: '5rem' },
  { nom: '--e-12', role: '6rem' },
  { nom: '--t-micro', role: 'libellés de panneau, le qui du fil' },
  { nom: '--t-petit', role: 'légendes, compteurs' },
  { nom: '--t-base', role: 'texte courant de l’interface' },
  { nom: '--t-lecture', role: 'le fil de narration' },
  { nom: '--t-titre', role: 'titres de section' },
  { nom: '--t-ecran', role: 'le nom de la campagne' },
  { nom: '--r-s', role: '3px — petits boutons, pastilles' },
  { nom: '--r-m', role: '6px — panneaux' },
  { nom: '--r-l', role: '10px — calques' },
  { nom: '--filet-fin', role: '1px — la bordure' },
  { nom: '--filet-large', role: '2px — le rail d’un bloc, l’anneau de focus' },
  { nom: '--z-panneau', role: '10 — un panneau posé sur un autre' },
  { nom: '--z-survol', role: '20 — le survol, l’infobulle' },
  { nom: '--z-dialogue', role: '30 — un calque' },
  { nom: '--z-toile', role: '40 — la toile de dessin, au-dessus de tout' },
  { nom: '--ecran-lecture', role: '68ch — la largeur de la colonne de lecture' },
  { nom: '--ecran-large', role: '75rem — la largeur maximale de la vitrine' },
  { nom: '--rail-gauche', role: '18rem — la fiche' },
  { nom: '--rail-droite', role: '24rem — la table et le carnet' },
  { nom: '--seuil-tiroir-fiche', role: '56,25rem — en dessous, la fiche part en tiroir' },
  { nom: '--seuil-tiroir-carnet', role: '43,75rem — en dessous, le carnet part en tiroir' },
  { nom: '--seuil-tiroir-tout', role: '35rem — en dessous, plus aucune colonne latérale' },
  { nom: '--vignette-hauteur', role: '34rem — la hauteur d’une maquette dans la vitrine' },
];

/** L'ordre de sacrifice du §4.2. Cinq rangs, et un seul est un point de rupture
 *  CSS — les quatre autres sont des seuils, donc des arrangements du même
 *  composant et pas des media queries. */
export type VarianteId = 'large' | 'moyen' | 'tiroir-gauche' | 'tiroir-droit' | 'portable';

export interface Variante {
  readonly id: VarianteId;
  /** L'ordre est une donnée, pas une accidents de lecture du tableau : si on
   *  réordonne `VARIANTES`, la vitrine doit se réordonner avec. */
  readonly rang: number;
  readonly titre: string;
  readonly dessous: string;
  readonly ceQuiCede: string;
  readonly ceQuiReste: string;
}

export const VARIANTES: readonly Variante[] = [
  {
    id: 'large',
    rang: 1,
    titre: 'Les marges respirent',
    dessous: 'au-delà de 1 480px',
    ceQuiCede: 'rien — la marge autour des deux cellules latérales',
    ceQuiReste: 'tout, le fil ne bouge pas',
  },
  {
    id: 'moyen',
    rang: 2,
    titre: 'Les rails touchent le fil',
    dessous: '1 180px',
    ceQuiCede: 'le rail de droite : 24rem devient 18rem',
    ceQuiReste: 'tout, plus serré',
  },
  {
    id: 'tiroir-gauche',
    rang: 3,
    titre: 'La fiche devient un tiroir',
    dessous: '900px',
    ceQuiCede: 'le rail de gauche',
    ceQuiReste: 'les jauges et l’identité seules',
  },
  {
    id: 'tiroir-droit',
    rang: 4,
    titre: 'Le carnet devient un tiroir',
    dessous: '700px',
    ceQuiCede: 'le rail de droite',
    ceQuiReste: 'tout, mais par tiroir',
  },
  {
    id: 'portable',
    rang: 5,
    titre: 'Les jauges passent en tête',
    dessous: '560px',
    ceQuiCede: 'la colonne centrale s’élargit',
    ceQuiReste: 'le fil et le compositeur',
  },
];

/** Les trois états d'une table (05 §4.7). */
export const ETATS_TABLE: readonly { readonly nom: string; readonly quoi: string; readonly qui: string }[] = [
  { nom: 'Seul', quoi: 'un seul joueur ; la colonne de droite dit ce qu’on attend', qui: 'sous le seuil de joueurs d’un front' },
  { nom: 'Assise', quoi: 'grille complète, quatre colonnes', qui: 'la norme' },
  { nom: 'Séparée', quoi: 'les colonnes latérales restent, le fil se scinde en deux sous-fils', qui: 'une portée `subset` non vide' },
];

/** Le carnet d'objets, et ce qu'on peut partager de chaque nature (05 §8.4).
 *  `PartagePolicy` vit dans le CONTENU, pas dans le client : invariant 3. Cette
 *  liste est donc un extrait de ce que contiendrait `packages/content`, écrit
 *  ici pour être regardé, et sa source de vérité n'est pas ce fichier. */
export interface Objet {
  readonly nom: string;
  readonly nature: 'consommable' | 'utilisable' | 'outil' | 'secret';
  readonly partage: string;
  readonly partageable: boolean;
}

export const OBJETS: readonly Objet[] = [  {
    nom: 'Fiole devigour',
    nature: 'consommable',
    partage: 'la quantité et l’effet, jamais le fait qu’on l’ait consultée',
    partageable: true,
  },
  {
    nom: 'Corde d’ascension',
    nature: 'utilisable',
    partage: 'l’effet obtenu, une fois obtenue',
    partageable: true,
  },
  {
    nom: 'Marteau de Ravine',
    nature: 'outil',
    partage: 'ses traits — il est fait pour être décrit',
    partageable: true,
  },
  {
    nom: 'Lettre de Serys',
    nature: 'secret',
    partage: 'rien : c’est à celui qui l’a lue de décider',
    partageable: false,
  },
];

/** Le sélecteur de destinataire (05 §7). Toujours visible : c’est le composant le
 *  plus important de l’écran, et un menu le range trop bien. */
export const DESTINATAIRES: readonly { readonly nom: string; readonly coche: boolean }[] = [
  { nom: 'Toute la table', coche: true },
  { nom: 'Furie, Kazu et Serys', coche: false },
  { nom: 'Ceux qui voient le bloc', coche: true },
];

/** Les états du §9, rendus et non décrits. Un état vide non dessiné est un
 *  écran blanc sur une soirée de jeu. */
export interface EtatCase {
  readonly composant: string;
  readonly vide: string;
  readonly chargement: string;
  readonly erreur: string;
  readonly desactive: string;
}

export const ETATS_CAS: readonly EtatCase[] = [
  {
    composant: 'Jauge',
    vide: 'libellé seul, « — »',
    chargement: 'squelette statique, pas de shimmer',
    erreur: 'trait en --annule, valeur conservée',
    desactive: 'opacité 0,5, valeur lisible',
  },
  {
    composant: 'Destinataire',
    vide: 'liste cochée, la table cochée par défaut',
    chargement: 'aucun — il y a une valeur par défaut',
    erreur: 'le choix reste affiché, un --annule en ligne',
    desactive: '—',
  },
  {
    composant: 'Fil',
    vide: 'un bloc d’amorce écrit par le moteur',
    chargement: 'rien, le fil ne bouge pas',
    erreur: 'bandeau --annule-aplat, le fil reste lisible en dessous',
    desactive: '—',
  },
  {
    composant: 'Compositeur',
    vide: 'placeholder « Ce que tu fais… »',
    chargement: 'bouton envoyer en désactivé, texte du champ conservé',
    erreur: 'l’erreur s’affiche au-dessus du champ, le brouillon n’est jamais perdu',
    desactive: 'bouton désactivé, jamais caché',
  },
  {
    composant: 'Carte',
    vide: '—',
    chargement: 'cadre vide + nom',
    erreur: '—',
    desactive: 'opacité 0,5, nom toujours lisible',
  },
  {
    composant: 'Toile',
    vide: 'grille de points, --trait',
    chargement: '—',
    erreur: 'le trait est déjà parti',
    desactive: '—',
  },
  {
    composant: 'Tiroir',
    vide: 'le bouton-poussoir porte son compte (inventaire · 4)',
    chargement: 'l’ouverture est instantanée',
    erreur: 'il s’ouvre vide, avec son EmptyState',
    desactive: '—',
  },
  {
    composant: 'Modale',
    vide: '—',
    chargement: 'squelette statique, titre déjà écrit',
    erreur: 'un bandeau dans le calque, le calque reste',
    desactive: 'le bouton × est toujours actif',
  },
];

/** Les huit règles du §0, en une ligne chacune, parce qu'une règle qu'on ne peut
 *  pas relire en dix secondes n'est pas une règle, c'est un vœu. */
export const REGLES: readonly { readonly numero: number; readonly texte: string }[] = [
  { numero: 1, texte: 'Peu de couleurs. Vingt-deux valeurs brutes, et tout le reste est un rôle.' },
  { numero: 2, texte: 'La couleur ne porte jamais seule une information. Glyphe, libellé ou forme la doublent.' },
  { numero: 3, texte: 'Rien qui bouge sans qu’on l’ait demandé. Aucune animation de jet (ADR 0009).' },
  { numero: 4, texte: 'Le fil de narration est la seule colonne de lecture, et il est au centre.' },
  { numero: 5, texte: 'Désactivé n’est pas invisible : l’opacité baisse, le texte reste.' },
  { numero: 6, texte: 'Un brouillon n’est jamais perdu. Il est dans le store, pas dans le DOM.' },
  { numero: 7, texte: 'Jamais deux panneaux superposés. Un seul calque, un seul tiroir.' },
  { numero: 8, texte: 'Toute modale naît au centre, jamais dans une colonne latérale.' },
];

/** Combien d'exemplaires vous en avez. Écrit en texte, jamais en pastilles :
 *  trois points et un deux, c'est une devinette. Un consommable se compte, un
 *  outil se possède — d'où le 1 par défaut. */
export const QUANTITES: Readonly<Record<string, number>> = {
  'Fiole devigour': 2,
  'Corde d’ascension': 1,
  'Marteau de Ravine': 1,
  'Lettre de Serys': 1,
};
