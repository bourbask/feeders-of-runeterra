/**
 * La mesure des contrastes du client — et les paires qu'elle mesure.
 *
 * POURQUOI CE FICHIER EST DE LA PRODUCTION ET PAS UN TEST. Deux fichiers en ont
 * besoin : `tokens.test.ts`, qui prouve que chaque paire passe son minimum, et
 * `design.test.tsx`, qui prouve que la vitrine `/design` affiche le VRAI nombre
 * et pas un nombre recopié. Si les deux avaient leur propre implémentation de
 * WCAG, ils pourraient être d'accord sur la formule et tort sur les chiffres, et
 * le second test ne prouverait plus rien. Une seule mesure, deux vérifications
 * qui se complètent.
 *
 * LES NOMBRES ÉCRITS ICI SONT DES DÉCLARATIONS, PAS DES MESURES. Le navigateur
 * ne peut pas lire `tokens.css` pour faire le calcul tout seul — d'où le fait
 * qu'ils soient écrits, et d'où le test qui les confronte à la mesure. C'est la
 * seule chose dans ce fichier qui puisse mentir, et c'est exactement ce que
 * `design.test.tsx` cherche.
 */

/** Une déclaration `--nom: valeur;` trouvée dans une feuille de style. */
export interface Declaration {
  readonly nom: string;
  readonly valeur: string;
}

/**
 * A CSS custom property is `--name: value;` inside a rule block. This reads
 * every one of them in a file, block or not: the only thing it must not do is
 * invent a declaration that isn't there.
 */
export function declarations(texte: string): Declaration[] {
  const trouvees: Declaration[] = [];
  const motif = /--([\w-]+)\s*:\s*([^;{}]+);/gu;
  for (const trouve of texte.matchAll(motif)) {
    const nom = trouve[1];
    const valeur = trouve[2];
    if (nom !== undefined && valeur !== undefined) {
      trouvees.push({ nom: `--${nom}`, valeur: valeur.trim() });
    }
  }
  return trouvees;
}

export type Jetons = ReadonlyMap<string, string>;

export function jetonsDe(texte: string): Jetons {
  return new Map(declarations(texte).map((d) => [d.nom, d.valeur]));
}

/** Follows `var(--a)` chains until it reaches a raw value, or gives up. */
export function resout(jetons: Jetons, nom: string, profondeur = 0): string | undefined {
  if (profondeur > 8) return undefined;
  const valeur = jetons.get(nom);
  if (valeur === undefined) return undefined;
  const reference = /^var\((--[\w-]+)\)$/u.exec(valeur);
  const suivant = reference?.[1];
  return suivant === undefined ? valeur : resout(jetons, suivant, profondeur + 1);
}

/**
 * Relative luminance, WCAG 2.1 §relative luminance. Rejects anything that is
 * not a six-digit hex, so a token that resolves to a keyword or a `color-mix`
 * fails loudly instead of being read as black.
 */
export function luminance(valeur: string): number {
  if (!/^#[0-9a-f]{6}$/u.test(valeur)) {
    throw new Error(`« ${valeur} » n'est pas un #rrggbb`);
  }
  const n = Number.parseInt(valeur.slice(1), 16);
  const lineique = (canal: number): number => {
    const c = canal / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * lineique((n >> 16) & 0xff) +
    0.7152 * lineique((n >> 8) & 0xff) +
    0.0722 * lineique(n & 0xff)
  );
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
export function contraste(avant: string, arriere: string): number {
  const a = luminance(avant);
  const b = luminance(arriere);
  return a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05);
}

/** The `#rrggbb` a token resolves to, or a loud failure. */
export function couleur(jetons: Jetons, nom: string): string {
  const valeur = resout(jetons, nom);
  if (valeur === undefined) throw new Error(`« ${nom} » ne se résout pas`);
  if (!/^#[0-9a-f]{6}$/u.test(valeur)) {
    throw new Error(`« ${nom} » se résout en « ${valeur} », pas en une couleur`);
  }
  return valeur;
}

/** A foreground/background pair, the bar it has to clear, and the number the
 *  showcase puts on screen. `mesure` is a DECLARATION — see the file header. */
export interface Paire {
  readonly devant: string;
  readonly sur: string;
  readonly minimum: number;
  readonly mesure: number;
  readonly quoi: string;
}

/** AA for normal text is 4,5. */
export const PAIRES_TEXTE: readonly Paire[] = [
  { devant: '--texte', sur: '--fond', minimum: 4.5, mesure: 15.62, quoi: 'le fil sur la page' },
  {
    devant: '--texte',
    sur: '--fond-panneau',
    minimum: 4.5,
    mesure: 16.42,
    quoi: 'le texte d’un panneau',
  },
  {
    devant: '--texte',
    sur: '--surface-haute',
    minimum: 4.5,
    mesure: 13.92,
    quoi: 'le texte d’un panneau posé',
  },
  {
    devant: '--texte-discret',
    sur: '--fond-panneau',
    minimum: 4.5,
    mesure: 7.54,
    quoi: 'les libellés',
  },
  {
    devant: '--texte-discret',
    sur: '--surface-haute',
    minimum: 4.5,
    mesure: 6.39,
    quoi: 'les libellés d’un panneau posé',
  },
  {
    devant: '--accent',
    sur: '--fond-panneau',
    minimum: 4.5,
    mesure: 6.93,
    quoi: 'l’action principale',
  },
  {
    devant: '--accent',
    sur: '--fond',
    minimum: 4.5,
    mesure: 6.59,
    quoi: 'l’action principale sur la page',
  },
  {
    devant: '--annule',
    sur: '--fond-panneau',
    minimum: 4.5,
    mesure: 8.92,
    quoi: 'un refus du modèle',
  },
  { devant: '--annule', sur: '--fond', minimum: 4.5, mesure: 8.48, quoi: 'une erreur réseau' },
  { devant: '--succes', sur: '--fond-panneau', minimum: 4.5, mesure: 10.0, quoi: 'une validation' },
  {
    devant: '--vivres',
    sur: '--fond-panneau',
    minimum: 4.5,
    mesure: 7.08,
    quoi: 'la jauge des vivres, en texte',
  },
  {
    devant: '--portee-publique',
    sur: '--fond',
    minimum: 4.5,
    mesure: 6.59,
    quoi: 'le rail public',
  },
  {
    devant: '--portee-restreinte',
    sur: '--fond',
    minimum: 4.5,
    mesure: 12.01,
    quoi: 'le rail restreint',
  },
  {
    devant: '--portee-restreinte',
    sur: '--fond-panneau',
    minimum: 4.5,
    mesure: 12.63,
    quoi: 'le rail restreint en panneau',
  },
  {
    devant: '--texte-inverse',
    sur: '--accent-aplat',
    minimum: 4.5,
    mesure: 11.98,
    quoi: 'le texte sur pastille active',
  },
  // La surface de jeu (correction 7) est un FOND : tout ce qui s'écrit dessus
  // se mesure dessus, sans quoi elle serait le seul aplat de l'écran dont
  // personne ne connaît le contraste.
  {
    devant: '--texte',
    sur: '--fond-jeu',
    minimum: 4.5,
    mesure: 14.56,
    quoi: 'le texte sur la surface de jeu',
  },
  {
    devant: '--texte-discret',
    sur: '--fond-jeu',
    minimum: 4.5,
    mesure: 6.68,
    quoi: 'les libellés sur la surface de jeu',
  },
  // La troisième teinte de portée (arbitrage A), sur les deux fonds où elle
  // apparaît : le rail d'un bloc personnel, et le filet de la position 3.
  {
    devant: '--portee-personnelle',
    sur: '--fond',
    minimum: 4.5,
    mesure: 8.48,
    quoi: 'le rail personnel',
  },
  {
    devant: '--portee-personnelle',
    sur: '--fond-panneau',
    minimum: 4.5,
    mesure: 8.92,
    quoi: 'le rail personnel en panneau',
  },
];

/**
 * 3:1 is WCAG 1.4.11, and it applies to what is REQUIRED to identify a
 * component, not to every rectangle on the page. A focus ring qualifies: it is
 * the only thing that says which field you are in. A panel border does not,
 * because a panel is identified by its heading — which is a real `<h2>` with an
 * `aria-label`, not a 1px line. `--trait` is therefore decorative, below 3:1 on
 * purpose, and this list is the line between the two.
 */
export const PAIRES_COMPOSANT: readonly Paire[] = [
  { devant: '--trait-fort', sur: '--fond', minimum: 3, mesure: 5.63, quoi: 'le focus sur la page' },
  {
    devant: '--trait-fort',
    sur: '--fond-panneau',
    minimum: 3,
    mesure: 5.92,
    quoi: 'le focus dans un panneau',
  },
  {
    devant: '--trait-fort',
    sur: '--surface-haute',
    minimum: 3,
    mesure: 5.02,
    quoi: 'le focus dans un panneau posé',
  },
  {
    devant: '--vigueur-aplat',
    sur: '--fond-panneau',
    minimum: 3,
    mesure: 6.59,
    quoi: 'la jauge de vigueur, en aplat',
  },
  {
    devant: '--ame-aplat',
    sur: '--fond-panneau',
    minimum: 3,
    mesure: 4.18,
    quoi: 'la jauge d’âme, en aplat',
  },
  {
    devant: '--vivres-aplat',
    sur: '--fond-panneau',
    minimum: 3,
    mesure: 4.9,
    quoi: 'la jauge des vivres, en aplat',
  },
];
