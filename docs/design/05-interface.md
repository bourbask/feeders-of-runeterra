# 05 — Interface : le système visuel et la table

Statut : **proposé**. Prescriptif pour M1, indicatif pour M0 — rien de ce qui est
écrit ici n'oblige M0 à refaire son écran, mais ce qui est écrit ici ne sera pas
redécidé en M1.
**Autorité supérieure : `docs/ARCHITECTURE.md`, ADR 0008 (portée de visibilité),
ADR 0009 (atouts de perception et visibilité des jets), ADR 0010.** Ces trois
documents tranchent ; ce document ne les contredit pas, il les rend applicables à
l'écran.

**Note de nommage.** `01-architecture.md` §11 annonce l'interface comme
`docs/design/04-ux-table.md`. Le numéro 04 est désormais pris par
`04-scenarios.md` (PR #61). Le fichier s'appelle donc `05-interface.md`, et le
pointeur de `01-architecture.md` §11 devra être corrigé au moment de la fusion —
`01-architecture.md` est modifié par la PR #69, on n'y touche pas ici.

Public : l'agent qui implémente `packages/client` (pas de designer dans la boucle
— c'est une décision, §0.6) et le porteur du projet, qui valide l'écran avant
qu'il ne coûte du temps.

---

## 0. Principes

Huit règles. Chacune a une contrepartie mécanique ; une règle sans test n'est pas
une règle, c'est un goût.

| # | Règle | D'où | Contrepartie |
|---|---|---|---|
| 1 | **Peu de couleurs.** Le nombre de teintes est une contrainte chiffrée, pas une préférence. | `global.css` en comment : « Le Freljord : peu de couleurs, beaucoup de contraste, rien qui clignote » | §2.1 fixe le compte ; §12 le teste |
| 2 | **La couleur ne porte jamais seule une information.** Toute information portée par une couleur est aussi portée par un glyphe, un texte ou une forme. | ADR 0008 (les trois rails), accessibilité | `Jauge` et `Rail` ont un mode `sans-couleur` testé |
| 3 | **Rien ne clignote, rien n'apparaît progressivement.** Ce qui est écrit est lisible à la première image. | ADR 0009 (« pas d'animation de dés », point réexaminable en fin de projet) | `global.css` interdit `animation` et `transition` sur le fil |
| 4 | **Rien n'est caché.** Pas d'onglet qui masque un canal, pas de mode caché dans le sélecteur de destinataire. | ADR 0008 décision 4 | pas d'onglets ; `Destinataire` est toujours visible |
| 5 | **Un panneau vide dit ce qu'il attend.** Un panneau qui ne rend rien est indiscernable d'un panneau cassé. | `EmptyState.tsx`, `Shells.tsx` | conservé tel quel, étendu §9 |
| 6 | **Zéro dépendance nouvelle.** | `pnpm-lock.yaml` est contesté (PR #60, #63, #69) | §0.6, test d'import §12 |
| 7 | **Jamais deux panneaux l'un sur l'autre.** Un seul calque d'interface à la fois, et un seul tiroir à la fois. | arbitrage du porteur de projet | `atMostOneDialog` : un seul `[aria-modal]` dans l'arbre, à tout instant |
| 8 | **Toute modale naît au centre.** Le centre est la seule surface qui accueille un calque. | idem, déduit de la règle 7 | aucune modale n'a de parent dans une colonne latérale |

### 0.1 Trois choses que ce document ne réinvente pas

L'ADR 0008 décision 4 a déjà arrêté la forme de la chronologie : **un fil unique,
trois niveaux, lus par l'indentation et la couleur du rail**. Cet article ne la
rediscute pas — il écrit la spécification visuelle du rail (§5), qui n'existait
pas.

L'ADR 0009 a déjà tranché les dés : **pas d'animer un jet**. L'annexe B décrit
des traitements sprite de jauges, tous marqués spéculatifs, tous soumis à la
revue en fin de projet comme le dit l'ADR.

`global.css` porte déjà l'identité : 7 variables, aucune échelle, aucune
variante. Ce document les garde (§1.2) au lieu de les remplacer : un renommage
de jetons dans 12 PRs ouvertes coûterait plus qu'il ne rapporterait.

### 0.2 Ce que ce document n'est pas

Ce n'est pas une maquette figée, et il n'y a pas de Figma. Le livrable réel du
projet visuel, c'est la route `/design` du client (§11) : la maquette **vit dans
le code**, se relit dans le navigateur, et le test qui échoue est le même que
celui qui casse la page.

### 0.3 Priorité d'application

| Ordre | Quoi | Pourquoi dans cet ordre |
|---|---|---|
| 1 | Jetons (§1) | Tout le reste s'y réfère ; sans jetons, chaque composant invente ses valeurs |
| 2 | Typographie et rythme (§3) | Deux familles, une échelle. Rien à décider après. |
| 3 | Le découpage de la table (§4) | Structure de grille, largeur de lecture, points de rupture |
| 4 | Les composants qui portent une règle de jeu | `Jauge` (§6), `Rail` (§5), `Destinataire` (§7) |
| 5 | Les états (§9) | Rarement designed en premier, toujours source de rework |
| 6 | Le carnet d'objets (§8) | C'est du V2. La spec se fige maintenant, le code pas |

---

## 1. Le système de jetons

### 1.1 Trois étages, et une seule règle d'usage

```
étage 1  primitives   --p-*     valeurs brutes, aucun sens
étage 2  sémantique   --*       un rôle, un seul nom, en français
étage 3  échelles     --e-*     pas de notion d'unité
```

**Règle d'usage, et c'est la règle du fichier :** un composant référence
uniquement l'étage 2 et l'étage 3. L'étage 1 n'est jamais utilisé directement
dans un composant ; il n'existe que pour que deux rôles différents puissent
partager une valeur, et pour que changer une teinte ne demande pas de changer
l'autre.

C'est testable, donc c'est une règle (§12, `styles/tokens.test.ts`).

### 1.2 Étage 1 — primitives

Les 7 variables existantes de `global.css` ne sont pas des primitives, ce sont
des sémantiques. On les garde donc à l'étage 2 (§1.3) et on leur trouve une
origine ici.

| Jeton | Valeur | Note |
|---|---|---|
| `--p-glace-1000` | `#0a0e13` | fond de vignette, jamais en fond de page |
| `--p-glace-900` | `#0d1117` | le `--fond` d'aujourd'hui |
| `--p-glace-800` | `#151b23` | le `--fond-panneau` d'aujourd'hui |
| `--p-glace-700` | `#2e3541` | surface élevée : un panneau posé sur un panneau |
| `--p-glace-600` | `#2a3441` | le `--trait` d'aujourd'hui |
| `--p-glace-500` | `#76808d` | trait marqué : **anneau de focus** — le seul filet qui doit passer 3:1 |
| `--p-brume-400` | `#6b7a8a` | trait désactivé, et `--ame-aplat` : le remplissage de la jauge d'âme |
| `--p-brume-300` | `#9aa7b4` | le `--texte-discret` d'aujourd'hui |
| `--p-brume-100` | `#e6edf3` | le `--texte` d'aujourd'hui |
| `--p-blanc-000` | `#f2f7fb` | texte sur aplat clair, réservé aux jetons de fond clair |
| `--p-azure-700` | `#2b4a5c` | accent en aplat, fond de pastille |
| `--p-azure-500` | `#6fb3d2` | l'`--accent` d'aujourd'hui |
| `--p-azure-300` | `#a8d4e8` | accent en texte sur fond sombre accentué |
| `--p-braise-600` | `#7d3a3a` | erreur en aplat |
| `--p-braise-500` | `#b06a6a` | l'`--annule` d'aujourd'hui — **vaut 4,22:1, voir §2.2** — et `--vigueur-aplat` |
| `--p-braise-300` | `#e08f8f` | erreur en texte (7,00:1) |
| `--p-ambre-500` | `#b39a4a` | vivres, en aplat |
| `--p-ambre-300` | `#e0b558` | vivres, en texte (9,00:1) |
| `--p-verde-500` | `#4f7a63` | succès, en aplat |
| `--p-verde-300` | `#8fd3b0` | succès, en texte (9,99:1) |
| `--p-violet-500` | `#6b5a8f` | l' Personal, en aplat |
| `--p-violet-300` | `#c9b6f0` | perso, en texte (9,43:1) |

Vingt-deux valeurs brutes. C'est tout le budget : un rôle qui n'a pas son jeton
n'est pas inventé à la demande, il est ajouté ici en même temps qu'il est
justifié, ou il est fait en CSS pur (`currentColor`).

### 1.3 Étage 2 — sémantique

Les 7 noms existants sont conservés tels quels : les changer coûterait 12 PRs
pour un gain nul.

| Jeton | Rôle | Alias | Remplace |
|---|---|---|---|
| `--fond` | fond de page | `--p-glace-900` | — (existe) |
| `--fond-panneau` | fond de panneau | `--p-glace-800` | — (existe) |
| `--surface-haute` | panneau posé sur panneau, survol | `--p-glace-700` | — (nouveau) |
| `--trait` | bordure de panneau, filet du fil — **décoratif, sous 3:1 assumé** | `--p-glace-600` | — (existe) |
| `--trait-fort` | **anneau de focus**, bordure de champ actif | `--p-glace-500` | — (nouveau) |
| `--texte` | texte courant | `--p-brume-100` | — (existe) |
| `--texte-discret` | métadonnées, libellés | `--p-brume-300` | — (existe) |
| `--texte-inverse` | texte sur aplat clair | `--p-blanc-000` | — (nouveau) |
| `--accent` | action principale, lien | `--p-azure-500` | — (existe) |
| `--accent-aplat` | fond de pastille active | `--p-azure-700` | — (nouveau) |
| `--annule` | refus, coupure, jauge de vigueur en texte | `--p-braise-300` | **corrigé** |
| `--annule-aplat` | fond de bandeau d'erreur | `--p-braise-600` | — (nouveau) |
| `--succes` | validation serveur, gain | `--p-verde-300` | — (nouveau) |
| `--vivres` | la jauge des vivres, en texte | `--p-ambre-300` | — (nouveau) |
| `--vigueur-aplat` | remplissage de la jauge de vigueur | `--p-braise-500` | — (nouveau) |
| `--ame-aplat` | remplissage de la jauge d'âme | `--p-brume-400` | — (nouveau) |
| `--vivres-aplat` | remplissage de la jauge des vivres | `--p-ambre-500` | — (nouveau) |
| `--portee-publique` | rail actif d'un bloc visible par toute la table | `--p-azure-500` | — (nouveau) |
| `--portee-restreinte` | rail actif d'un bloc visible par un sous-ensemble | `--p-violet-300` | — (nouveau) |

`--annule` change de valeur : **c'est le seul changement cassant du document**, il
est justifié au §2.2 et il est fait en un commit, avec son test.

### 1.4 Étage 3 — échelles

Pas de pixel en dur dans un composant. Jamais.

| Jeton | Valeurs | Usage |
|---|---|---|
| `--e-1` … `--e-12` | `0.25rem` `0.5rem` `0.75rem` `1rem` `1.25rem` `1.5rem` `2rem` `2.5rem` `3rem` `4rem` `5rem` `6rem` | l'unique échelle d'espacement. Un `margin: 13px` est un défaut, pas une préférence |
| `--t-micro` | `0.6875rem` / `0.5rem` majuscules / `0.08em` | les libellés de panneau, l' qui` du fil |
| `--t-petit` | `0.8125rem` | légendes, compteurs |
| `--t-base` | `1rem` | texte courant de l'interface |
| `--t-lecture` | `1.0625rem` / `1.6` | **le fil de narration** |
| `--t-titre` | `1.375rem` | titres de section |
| `--t-ecran` | `1.75rem` | le nom de la campagne |
| `--r-s` `--r-m` `--r-l` | `3px` `6px` `10px` | rayons. Le `4px` de `.fr-panneau` devient `--r-m` |
| `--filet-fin` `--filet-large` | `1px` `2px` | épaisseur des filets. Un `1px` écrit en dur n'est pas une valeur, c'est un oubli : le jour où l'écran change d'échelle, le filet reste à 1px pendant que tout le reste grossit |
| `--z-panneau` `--z-survol` `--z-dialogue` `--z-toile` | `10` `20` `30` `40` | la toile de dessin est au-dessus de tout, c'est le seul dialogue qui couvre l'écran |
| `--ecran-lecture` | `68ch` | la largeur de la colonne de lecture. Un `ch` et non un `rem` : la question est « combien de signes à la ligne », pas « combien de pixels » |
| `--rail-gauche` `--rail-droite` | `18rem` `24rem` | les deuxLargeurs ne sont pas égales : la droite porte l'inventaire, qui est une surface d'objets, la gauche la fiche, qui est une liste |
| `--seuil-tiroir-fiche` | `56.25rem` | en dessous, la fiche personnage part en tiroir |
| `--seuil-tiroir-carnet` | `43.75rem` | en dessous, le carnet part en tiroir |
| `--seuil-tiroir-tout` | `35rem` | en dessous, plus aucune colonne latérale ne tient. C'est aussi le **plafond** que `tokens.test.ts` oppose à la somme des planchers d'une grille |

### 1.5 Ce que la liste des 21 intentions donne comme barre d'actions

Les 12 `move.*` **ne deviennent pas une barre de 12 boutons** (§11, décision
prise : ces actions sont induites dans le texte envoyé au modèle, un bouton
permanent qui les expose toutes donne au joueur l'impression d'un jeu de
plateau où l'on choisit une case, alors qu'on écrit ce qu'on tente). Elles
apparaissent, une par une, **à l'intérieur du fil**, au moment où le serveur les
rend applicables, et disparaissent quand la fenêtre est fermée.

Séquence : `Rassembler des informations` · `Assurer un avantage` ·
`Protéger` · `Se blesser` · `Financer` · `Créer un lien` · `Progresser` ·
`Recommencer` · `Renoncer`.

C'est une **file de suggestions d'une action à la fois**, pas un panneau de
choix. C'est aussi la seule voie par laquelle `momentum.burn` / `momentum.keep`
ont un sens : ils sont scopés à une fenêtre de jet, et un clic sur une fenêtre
fermée est refusé par le serveur.

---

## 2. Couleurs

### 2.1 Le compte

Sur une page de table, en fonctionnement normal, **six teintes au maximum** sont
visibles simultanément :

`#0d1117` · `#151b23` · `#e6edf3` (+ `#9aa7b4` en métadonnées) · `#2a3441` ·
`#6fb3d2` (accent) · et **une seule** couleur de jauge à la fois, parce qu'un
personnage n'a qu'un personnage.

Un personnage qui vit dans le Freljord froid, sous un surlignage de danger, avec
une erreur : trois accents de couleur, pas dix. C'est le budget.

### 2.2 Ce que la mesure a trouvé

Ratios WCAG 2.1 **calculés**, jamais estimés : `tokens.test.ts` recalcule chacun
d'eux à chaque exécution, et échoue si une valeur bouge.

| Paire | Ratio | AA texte (4,5) | 1.4.11 (3) |
|---|---|---|---|
| `--texte` sur `--fond` | **16,02** | ✔ | ✔ |
| `--texte` sur `--fond-panneau` | **14,65** | ✔ | ✔ |
| `--texte` sur `--surface-haute` | **10,44** | ✔ | ✔ |
| `--texte-discret` sur `--fond-panneau` | **7,06** | ✔ | ✔ |
| `--texte-discret` sur `--surface-haute` | **5,03** | ✔ | ✔ |
| `--accent` sur `--fond-panneau` | **7,47** | ✔ | ✔ |
| `--annule` `#b06a6a` *(avant)* sur `--fond-panneau` | **4,22** | **✘** | ✔ |
| `--annule` `#e08f8f` *(après)* sur `--fond-panneau` | **7,00** | ✔ | ✔ |
| `--trait-fort` sur `--surface-haute` | **3,08** | ✔ | ✔ |
| `--trait` `#2a3441` sur `--fond` | **1,50** | — | **✘**, assumé |

Un seul défaut réel, dans le code existant :

**`--annule` échouait le contraste AA en texte courant**, et il est appliqué à
`.fr-annule` et `.fr-erreur` — c'est-à-dire aux refus du modèle et aux erreurs
réseau, précisément le texte qu'un joueur doit pouvoir lire du premier coup.
Correction : `--annule` passe à `#e08f8f` (**7,00:1**), et `#b06a6a` descend
d'un cran en `--p-braise-500`, réservé aux aplats. C'est le seul changement de
valeur d'un jeton existant dans tout le document.

**Le `--trait` à 1,50:1 n'est pas un défaut, et c'est un point de vocabulaire.**
Le ratio de 3:1 (WCAG 1.4.11) ne s'applique pas à toute ligne du écran : il
s'applique à ce qui est **nécessaire pour identifier un composant**. Un panneau
n'est jamais identifié par sa bordure dans cette interface — il est identifié
par son titre, qui est un vrai `<h2>` avec un `aria-label`, et par sa teinte de
fond. Une bordure décorative peut donc être discrète.

En revanche un **anneau de focus** est exactement le cas visé par 1.4.11 : c'est
le seul signe qui dit quel champ est actif. D'où `--trait-fort` `#76808d`, qui
passe 3:1 sur les trois fonds (`4,72` sur `--fond`, `4,32` sur `--fond-panneau`,
`3,08` sur `--surface-haute`). Ces deux valeurs sont le résumé de la règle : un
filet qui *dit* quelque chose doit être fort, un filet qui ne décore rien peut
être faible.

`--surface-haute` `#2e3541` fait un cran visible au-dessus de `--fond-panneau`
(1,403) — assez pour qu'un panneau posé sur un panneau se voie, pas assez pour
qu'il crie. Le réglage n'est pas gratuit : au-delà d'un certain cran, `--trait-fort`
ne passe plus 3:1 sur `--surface-haute` et `--texte-discret` tombe sous 4,5. Les
trois valeurs sont donc solidaires, et c'est le test qui tient les trois ensemble.

### 2.3 Les trois jauges, par la couleur

`vigueur` · `âme` · `vivres` — les noms sont imposés par `03-donnees.md` §0.5.

| Jauge | En texte | En aplat | Lecture à l'œil |
|---|---|---|---|
| **Vigueur** | `--annule` `#e08f8f` | `--vigueur-aplat` `#b06a6a` | rouge froid, pas rose |
| **Âme** | `--texte` `#e6edf3` | `--ame-aplat` `#6b7a8a` | gris froid, presque la couleur du texte : elle se distingue par sa **forme**, pas par sa teinte |
| **Vivres** | `--vivres` `#e0b558` | `--vivres-aplat` `#b39a4a` | ambre, la seule couleur chaude de l'écran |

Chaque jauge a **une teinte et deux profondeurs** : l'aplat remplit, la version
claire écrit le nombre à côté. Jamais l'aplat seul — un aplat sans valeur écrite
est une forme décorative, et c'est la règle 2 appliquée à une jauge.

L'âme est le cas intéressant : sur un thème froid et sombre, une jauge «
spirituelle » en blanc se confond avec le texte. C'est assumé — **trois jauges
qui se ressemblent ne se distinguent pas, trois jauges de couleurs différentes
se lisent dans l'ordre** — et c'est justement pourquoi la règle 2 existe : la
forme porte l'information, la couleur la redouble.

---

## 3. Typographie et rythme

### 3.1 Deux familles, pas une

| Famille | Usage | Pile |
|---|---|---|
| **Narratif** (empattement) | le fil, les titres de scène, les noms propres, les résumés de chronique | `'Iowan Old Style', Georgia, serif` — **inchangée** |
| **Chrome** (linéaire) | panneaux, libellés, boutons, compteurs, jauges, le sélecteur de destinataire | `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` |

La séparation suit une règle lisible : **ce qui est dit par le jeu est en
empattement, ce qui est dit par le logiciel est en linéaire.** Un joueur sait du
premier coup d'œil si un texte vient de la table ou de l'interface. Aucune
police n'est téléchargée : `system-ui` est une pile système, ça coûte zéro
octet et zéro dépendance (§0.6).

### 3.2 L'échelle

Sept pas, ratio **1,2** — volontairement doux. L'écart 1,25 des interfaces
d'outils produit des sauts qu'on remarque quand on lit du texte long ; ici on lit
des Characterization. `--t-lecture` (1,0625rem / interligne 1,6) est réservé au
fil, et à rien d'autre.

### 3.3 La largeur de lecture

Le fil de narration est une colonne de texte, et une colonne de texte qui
dépasse 75 caractères est pénible à lire. Contrainte réelle : **la colonne
centrale a une largeur de lecture** (`65ch` à `72ch`) et **elle est centrée dans
son espace**, même quand les deux colonnes latérales n'ont pas la même largeur.

C'est la seule reason pour laquelle les deux colonnes latérales n'ont pas
forcément la même taille : le centre est une colonne de lecture, les côtés sont
des surfaces d'objets.

### 3.4 Rien n'apparaît progressivement

Aucun `transition` sur le fil, aucun `fade-in`, aucun défilement animé. Ce qui
arrive en haut pendant que tu scrolles en bas est **inséré sans animation**, avec
le fil recalculé pour que la position de lecture ne saute pas. C'est la
directive de `global.css` (« ce qui apparaît doit être lisible tout de suite »)
prise au mot.

---

## 4. La table : le découpage

### 4.1 Quatre colonnes, dont deux élastiques

L'écran de table est **quatre colonnes**. Les deux extérieures sont des **marges
qui s'adaptent** et qui servent d'inventaire ; les deux intérieures sont la fiche
et le fil.

```
  2560px — les marges respirent, le carnet s'étale des deux côtés

  [ gauche : 1fr ]  [ centre : 68ch ]  [ droite : 1.15fr ]
  ┌────────────────┬───────────────────────┬────────────────┐
  │  ▓▓▓▓▓▓▓▓▓▓▓▓  │                       │  ▓▓▓▓▓▓▓▓▓▓▓▓  │
  │  ▓  VOUS    ▓  │                       │  ▓  LA TABLE ▓  │
  │  ▓  18rem   ▓  │   LE FIL              │  ▓   24rem   ▓  │
  │  ▓  jauges  ▓  │   chronologie unique  │  ▓  horloges ▓  │
  │  ▓  traits  ▓  │                       │  ▓ ─────────▓  │
  │  ▓  atouts  ▓  │   65–72ch             │  ▓ CARNET 8 ▓  │
  │  ▓▓▓▓▓▓▓▓▓▓▓▓  │                       │  ▓▓▓▓▓▓▓▓▓▓▓▓  │
  └────────────────┴───────────────────────┴────────────────┘
   ▓ = la cellule latérale : un rail (18rem / 24rem) + la marge autour

  1180px — plus de marge, les rails touchent le fil

  [ gauche : 1fr ]  [ centre : 68ch ]  [ droite : 1.15fr ]
  ┌──────────────┬───────────────────────┬──────────────┐
  │  VOUS        │                       │  LA TABLE    │
  │  jauges      │   LE FIL              │  horloges    │
  │  traits      │                       │  CARNET §8   │
  │  atouts      │   65–72ch             │              │
  └──────────────┴───────────────────────┴──────────────┘

  700px — les cellules latérales sont à zéro, leurs rails deviennent des tiroirs

  [ gauche : 0 ]      [ centre : 1fr ]      [ droite : 0 ]
  ┌────┬──────────────────────────────────────────┬────┐
  │ ▣  │            LE FIL                        │  ▣ │
  │fich│   chronologie unique                      │inv│
  │e   │   compositeur en bas                      │ent│
  └────┴──────────────────────────────────────────┴────┘
   ▣ = bouton-poussoir, qui porte son compte
```

```css
/* la seule déclaration de mise en page de tout le document */
.table {
  display: grid;
  grid-template-columns:
    [gauche] minmax(0rem, 1fr)      /* marge G + colonne « vous »,  fusionnées */
    [centre] minmax(0rem, 68ch)     /* le fil : une colonne de lecture        */
    [droite] minmax(0rem, 1.15fr);  /* marge D + colonne de droite, fusionnées */
  gap: var(--e-5);
}
```

Trois pistes, dont **deux élastiques**. Chacune des deux latérales est une
cellule qui contient deux choses : un **rail** collé au bord intérieur, et une
**marge** autour. Le rail a sa propre largeur maximale (`18rem` à gauche,
`24rem` à droite) et ne s'étire pas au-delà ; la marge, c'est ce qui reste.

C'est exactement « quatre colonnes, les extrêmes sont des marges qui servent
d'inventaire » : la fusion piste/marge n'est pas un tours de main, c'est ce qui
permet aux deux d'être la même piste.

**Les trois planchers sont à `0rem`, et c'est tout le mécanisme.** Un plancher
`auto` sur une piste `fr` la empêche de descendre sous son contenu — le
comportement par défaut d'une grille est donc de **déborder** plutôt que de
rétrécir. Avec `0rem` comme plancher, les deux pistes élastiques absorbent tout
le manque, elles tombent à zéro, et la grille **ne peut pas déborder** quelle que
soit la largeur. Ce qui rétrécit en premier, c'est ce qu'on voit le moins
souvent.

Et comme le manque se distribue sur les deux `fr` dans la proportion
`1 : 1,15`, **les deux côtés s'effondrent ensemble** : on ne se retrouve jamais
avec un carnet à droite et une marge vide à gauche. Le carnet de droite est plus
large parce qu'il porte plus de choses, pas parce qu'il est avantagé.

### 4.2 L'ordre de sacrifice

Quand la place manque, elle se prend dans cet ordre. C'est un arbitrage, pas une
cascade de media queries :

| Rang | Ce qui cède | Sous | Ce qui reste visible |
|---|---|---|---|
| 1 | la **marge** autour des deux cellules latérales | ~1480px | tout, le fil ne bouge pas |
| 2 | le rail de droite : 24rem → 18rem, la table passe sous le carnet | ~1180px | tout, plus serré |
| 3 | le rail **de gauche** : la fiche devient un **tiroir gauche** | ~900px | jauges et identité seules |
| 4 | le rail **de droite** : le carnet devient un **tiroir droit** | ~700px | tout, mais par tiroir |
| 5 | la colonne centrale s'élargit, les jauges passent **horizontales en tête** | ~560px | le fil et le compositeur |

Une seule de ces cinq lignes est un point de rupture CSS, et c'est la dernière :
les quatre premières sont des **seuils** de largeur, pas des media queries. Elles
n'ont pas de code CSS, elles ont un **test** (§12) qui vérifie qu'en dessous du
seuil le contenu est bien dans un tiroir, et le tiroir est bien un tiroir — pas un
panneau réduit à rien. Le contenu ne change jamais de logement sans qu'on l'ait
dit.

### 4.3 Ce que contient chaque colonne

**Colonne « vous »** — votre fiche, et rien d'autre. Personne d'autre n'y accède,
donc rien n'y est réellement « privé » : c'est la zone où l'information ne
concerne que vous.

1. **Identité** — nom du champion, titre, région. Le plus gros élément.
2. **Les trois jauges** (§6), dans l'ordre vigueur / âme / vivres.
3. **Les traits** — langues, origine, métier. Les atouts **passifs** de l'ADR
   0009 : ils s'appliquent toujours, sans jet. À côté des jauges parce que c'est
   le même genre de chose — ce que vous êtes sans l'avoir cherché.
4. **Vos atouts** — domaine, déclencheur, force, fréquence. Le **déclencheur est
   affiché en entier, jamais abrégé** : c'est lui qui évite le ridicule (ADR
   0009), donc c'est la seule partie que le joueur a besoin de lire.

Rien d'autre. Ce qui n'est pas « ce que vous êtes sans l'avoir cherché » est dans
la colonne de droite, y compris vos propres serments : un serment est une
promesse faite **à la table**, donc la table le voit.

**Colonne centrale** — le fil, et **rien d'autre** : pas de panneau, pas de
statistique, pas de bouton qui ne concerne pas la narration. Le compositeur est
en bas de cette colonne, jamais en travers de l'écran : sur un portable 13",
2rem gagnés en descendant la zone de lecture valent mieux que l'esthétique d'une
barre flottante, et le bas de l'écran est toujours le pire endroit pour lire.

**Colonne de droite** — la table, puis le carnet. C'est la zone qui **grandit** :
c'est là que le glisser-déposer dépose les cartes.

1. **La table** — qui est là, le tour, les horloges qui tournent.
2. **Le carnet d'objets** (§8) — les cartes.
3. **Les serments et les pistes** — ce que la table a promis, et où elle en est.

**Les marges** — de l'inventaire, et rien d'autre. Elles ne portent jamais de
statistique de personnage ni d'information de partie : si une information est
dans une marge, c'est qu'elle est **en option**. Une marge n'est pas l'endroit où
mettre ce qui n'a pas trouvé de place ailleurs.

### 4.4 Les tiroirs

Un tiroir n'est pas un panneau qui glisse par-dessus : c'est un panneau **qui
prend la place d'une colonne qui n'a plus de place** (règle 7). Il s'ouvre par un
**bouton-poussoir** dans l'en-tête, il reste lisible pendant qu'il est ouvert, et
il se referme en refermant le bouton.

| Tiroir | Contenu | Où il pousse | Fermeture |
|---|---|---|---|
| **gauche** | la fiche : jauges, traits, atouts, serments | depuis le bord gauche, par-dessus la colonne centrale | le bouton-poussoir, ou `Échap` |
| **droit** | la table, puis le carnet d'objets | depuis le bord droit, par-dessus la colonne centrale | idem |
| **bas** | **réservé** — table, horloges, pistes, là où les deux autres ne suffisent pas | depuis le bas, par-dessus le compositeur | idem |

**Un seul tiroir à la fois.** Ouvrir le droit ferme le gauche. La règle 7 n'est pas
une préférence d'esthétique, c'est ce qui rend l'état de l'écran lisible : deux
tiroirs ouverts à des hauteurs différentes, et on ne sait plus lequel est au
premier plan — c'est exactement le symptôme d'un écran cassé.

Le tiroir **gauche est volontairement moins accessible** que le droit, et c'est un
choix de game design autant que d'interface : la fiche est l'information que l'on
consulte, l'inventaire est celle dont on a besoin **tout de suite** au moment de
jouer un mouvement. Sur téléphone, les jauges sont **en haut, en horizontale,
minimalistes** : les trois seules choses qui doivent être visibles sans rien
ouvrir sont les trois jauges, et ce sont les seules à être sorties du tiroir.

Le tiroir **bas** est écrit ici et dessiné dans `/design`, et **construit plus
tard**. Réserver sa place coûte une ligne de grille ; le remplir trop tôt coûte un
panneau qu'il faudra démolir.

### 4.5 Les surfaces du centre

Le centre accueille cinq choses, et seulement celles-là :

1. la lecture de la chronologie ;
2. le compositeur ;
3. l'ouverture d'une **carte d'objet** avec sa toile de dessin (§8.2) ;
4. l'ouverture d'un **mini-jeu** de déverrouillage (§4.6) ;
5. la modale de sélection des destinataires (§7.1).

Toutes sont des calques. Ils naissent au-dessus du centre et **jamais** au-dessus
d'une colonne latérale (règle 8), et il n'y en a **qu'un à la fois** (règle 7).
Ouvrir un calque referme le tiroir qui était ouvert : deux panneaux superposés
n'existent pas dans ce produit.

### 4.6 Le mini-jeu de déverrouillage

L'idée : remplacer le « lancez un dé » d'une porte, d'un coffre ou d'un
trappeau par **un vrai petit jeu de serrure**, écrit ou importé. Sur le web on
peut faire une précision tactile qu'un dé n'offre pas.

**La surface est spécifiée ici** : une modale centrée, même cadre que la carte
annotable, mêmes états (§9), même bouton de fermeture, même règle — jamais
au-dessus d'un tiroir, jamais deux minis-jeux à la fois.

**La mécanique n'est pas tranchée dans ce document**, parce qu'elle est
mécanique avant d'être graphique. Deux façons de faire, qui ne se valent pas :

| | **(a) décoratif** | **(b) réel** |
|---|---|---|
| Principe | le moteur tire le jet, le mini-jeu **le montre** | la performance du joueur **produit** le résultat |
| On peut rater une serrure facile | non | **oui** |
| Coût d'implémentation | nul côté moteur | un type d'événement, une validation serveur, une borne anti-triche |
| ADR 0009 | tombe sous « pas d'animation de dés » : le résultat est déjà fixé quand ça démarre | **ne tombe pas** : ce n'est plus l'animation d'un jet déjà tranché, c'est un test dont la manière de jouer compte |
| Invariant 1 | tient | tient **à condition** que le résultat soit écrit au journal **avant** l'appel au modèle, comme `roll.*` |
| Invariant 4 | tient | tient, mais la rejouabilité repose alors sur le **résultat consigné**, plus sur le recalcul par le flux RNG |

Le fond du problème est là : **un résultat qui vient du client n'est pas un fait,
c'est une affirmation.** Si (b) est retenu, il faut un événement `challenge.*` écrit
avant la narration, que le serveur ne puisse pas accepter d'un client qui annonce
« j'ai réussi » sans avoir joué, et que le rejeu relise tel quel.

C'est un **ADR**, pas une ligne de ce document : ça touche le moteur, le journal et
le budget d'IA. La question est reprise au §11.2, et la surface du §4.5 est prête
dans les deux cas — c'est le seul endroit où il valait la peine de ne rien
trancher.

### 4.7 Les trois états d'une table

| État | Ce qu'on voit | Qui le déclenche |
|---|---|---|
| **Seul** | un seul joueur, la colonne de droite dit ce qu'on attend, le centre reste plein | sous le seuil de joueurs d'un front |
| **Assise** (par défaut) | grille complète, quatre colonnes | la norme |
| **Séparée** | les colonnes latérales **restent**, le fil se scinde en deux sous-fils, chacun avec son entête de portée | ADR 0008 décision 1, une portée `subset` non vide |

Le mode « séparée » ne réinvente pas l'écran : il affiche deux fois le fil, à
deux endroits, parce que **la chronologie de l'histoire ne se scinde pas** (ADR
0008). Chaque bloc porte son jeu de destinataires.


## 5. Le fil à trois rails

### 5.1 Ce qui est déjà tranché

ADR 0008 décision 4 : un seul fil, portée lue par l'indentation et la couleur du
rail, un niveau vide ne s'affiche pas. Cette section écrit la **spécification
visuelle** du rail, pas la forme.

> **Un mot, deux choses.** Dans tout ce document, un **rail** est le filet de
> 2px à gauche d'un bloc du fil, et qui dit à qui le bloc est destiné — c'est le
> mot de l'ADR 0008. Une **colonne** est une zone verticale de l'écran. Un rail
> n'est jamais une colonne, et une colonne n'est jamais un rail. C'est la seule
> homonymie du document et elle est interdite.

### 5.2 L'encodage

Un bloc porte trois informations simultanées, jamais deux.

| Canal | Public | Groupe | Personnel |
|---|---|---|---|
| **Rail** (2px, à gauche) | `--trait` | `--trait` | `--trait` |
| **Rail actif** (couleur) | `--portee-publique` | `--portee-restreinte` | — |
| **Indentation** | 0 | 2rem | 4rem |
| **Glyphe** | `┃` | `┃` | `╏` |
| **Libellé au survol** | « à toute la table » | « à ce groupe » | « à toi seul » |
| **Bandeau de regroupement** | — | `Vous trois, sur la corniche` | `Toi seul` |

**La couleur seule ne dit rien.** Un bloc restreint est rouge, un bloc public
n'est pas rouge : *l'absence* de rouge porte le sens, ce qui est le pire support
possible pour un daltonien et la raison pour laquelle cette rangée du tableau
n'est pas une information.

### 5.3 Pourquoi la règle 2 compte ici plus qu'ailleurs

Trois portées, trois couleurs, et un joueur qui joue en daltonien : si la portée
ne se lit qu'à la teinte, il ne sait plus qui lit son message, et il peut faire
un incident qu'aucune annulation ne répare. Donc : le glyphe change, l'indentation
change, le libellé est toujours présent en texte dans la barre d'outils et dans
l'infobulle. **Le jet `--portee-restreinte` est un redondement, pas l'information.**

### 5.4 Un bloc de narration, annoté

```
  LE COL BATTU PAR LA TEMPÊTE              ← --t-micro, --texte-discret
                                             ← le nom de scène ouvre un groupe
  La corde tient. En bas, les chiens de la
  Griffe d'Hiver ont cessé de japper.      ← --t-lecture, 65–72ch

    ┃ Vous trois, sur la corniche          ← bandeau de portée, --t-micro
    ┃ Katla vous attend près d'un feu mort. ← --t-lecture, indented 2rem
      Elle ne se lève pas.

  Le vent tombe d'un coup.

  ─────────────────────────────────────────  ← --trait, 1px, pleine largeur
  [ à toute la table ▾ ]   Ce que tu fais…  ← le compositeur
```

Le séparateur plein largeur entre deux tours est le seul filet horizontal du
fichier : il marque un changement de **tour**, pas un changement de paragraphe.

---

## 6. Les jauges

### 6.1 La forme

```
  VIGUEUR   ████████████░░░░░░░░   14 / 20
  ÂME       ████████░░░░░░░░░░░░░    8 / 20
  VIVRES    ●●●●○○○○○○○○○○○○○○○○    4
```

- **Vigueur et âme** : une barre. Remplissage proportionnel.
- **Vivres** : des pastilles. Une pastille = un vivres. On ne compte pas des
  vivres en les additionnant dans sa tête.

Le nom de la jauge est **toujours écrit**, jamais abrégé en pictogramme : « âme »
en toutes lettres est la seule chose qui empêche une jauge blanche de se lire
comme une jauge de vigueur vide.

### 6.2 Les trois états, et le quatrième

| État | Rendu |
|---|---|
| **Plein** | 100 %, teinte pleine |
| **Blessé** (vigueur < 50 %) | remplissage partiel + **libellé de la valeur** `14 / 20` |
| **Épuisé** (0) | remplissage vide + le **nom de la jauge passe en `--texte-discret`** |
| **Modifié par un tour** | le trait de la jauge concernée passe en `--accent` pendant le tour |

Le quatrième état est le plus important et le moins évident : quand un tour vient
de toucher votre vigueur, **la couleur ne suffit pas** (règle 2) — c'est la
**position dans le bloc** qui le dit. Le bloc des trois jauges est un composant unique,
pas trois composants identiques empilés, précisément pour que « laquelle a changé »
soit une question d'emplacement et non de couleur.

### 6.3 Ce qui n'est pas une jauge

Le **momentum** n'est pas une jauge. C'est une ressource qui se dépense, elle a
une **fenêtre**, et une fenêtre fermée ne peut plus être dépensée. Elle se rend
comme un badge chiffré près du tour, pas comme une barre : une barre invite à
être cliquée, et une fenêtre de jet n'a rien à faire d'un clic.

### 6.4 L'annexe B : les traitements sprite

Détaillés en **annexe B**, marqués spéculatifs, soumis à la revue de fin de
projet que l'ADR 0009 mentionne pour l'animation. En M1 : **des couleurs.**

---

## 7. Le sélecteur de destinataire

« Le composant le plus important de l'écran » (ADR 0008). Il n'a pas le droit
d'être petit, et il n'a pas le droit d'être un menu qu'on ouvre.

```
┌──────────────────────────────────────────────────────────┐
│  [ à toute la table ▾ ]                                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Ce que tu fais…                                   │  │
│  └────────────────────────────────────────────────────┘  │
│  ⏎ envoyer                              4 / 2000        │  ← --t-micro
└──────────────────────────────────────────────────────────┘
```

### 7.1 Ce qu'il est

Un **segmenté à trois positions**, toujours visible, jamais replié, jamais dans
un `⋯`.

| Position | Libellé | Icône | Portée |
|---|---|---|---|
| 1 | à toute la table | `┃` | `scope: 'table'` |
| 2 | à ce groupe | `┃` | `scope: 'subset'`, destinataires = les joueurs co-présents et choisis |
| 3 | à toi seul | `╏` | `scope: 'private'`, destinataires = `[moi]` |

La position 2 ouvre une **liste de cases à cocher** des joueurs présents, pas un
champ libre : on ne tape pas le nom d'un destinataire, on le **coche** devant
tout le monde. Un joueur ne doit jamais être surpris de qui a lu son message.

### 7.2 La règle de déclassification

ADR 0008 : « répondre dans le commun à ce qui t'a été dit en privé rend cette
information publique ». Rendu : à l'ouverture du compositeur, la portée **reprend
celle du bloc auquel on répond**, et elle est affichée. Si on passe en position 1
alors qu'on répond à un bloc `private`, le sélecteur **affiche un avertissement
avant l'envoi**, pas après :

```
  ⚠ Tu réponds en public à un message que toi seul avais reçu.
```

C'est le seul avertissement bloquant du produit. Un joueur ne doit pas pouvoir
faire cet accident en deux clics.

### 7.3 Rien d'autre ne se pose la question

Un joueur écrit **une seule fois**, dans **un seul champ**, avec **une seule
question de destinataire**. Il n'y a pas de mode « MJ », pas de canal caché, pas
de conversation par joueur (c'est du M1 selon l'ADR 0008, et c'est le M1 de
l'inventaire, pas celui-ci).

---

## 8. Le carnet d'objets

C'est la fonctionnalité de fond, et elle est **V2**. Elle est spécifiée ici pour
que le V1 ne prenne pas de mauvaise décision de layout qui la rend impossible.

### 8.1 La forme

Chaque objet est une **carte** dans la colonne de droite. Une carte, pas une ligne, parce
que l'objet a une identité avant d'avoir un texte.

```
  ┌──────────────┐
  │              │  ← sprite, 4:3, sur --surface-haute
  │   [ sprite ] │
  │              │
  ├──────────────┤
  │ Fiole de soin │  ← --t-base, --texte
  │  ×2          │  ← --t-petit, ambre si > 0, discret si 0
  └──────────────┘
```

Trois règles sur la carte, toutes issues de la frustration qu'on veut éviter :

1. **La quantité est sur la carte, pas dedans.** On sait qu'on a deux fioles sans
   l'ouvrir. Ouvrir une carte pour compter dedans, c'est un aller-retour par
   objet et par tour.
2. **Un objet à 0 reste visible, en `--texte-discret`.** Il n'est pas retiré de
   la main. Savoir qu'on n'a plus rien est une information.
3. **Aucun sprite n'est requis pour qu'un objet existe.** Le sprite est une
  affenage, pas un identifiant : le nom est toujours là. Sans images dans le
   dépôt, un objet sans sprite est un objet à cadre vide, pas un trou.

### 8.2 L'ouverture, et la toile

**Clic gauche → la carte s'ouvre.** Elle s'ouvre **au centre**, en `--z-dialogue`.
Ce n'est pas une page, c'est un calque — et c'est **le seul** calque possible : le
tiroir dans lequel on vient de cliquer se referme avant que la carte apparaisse
(règles 7 et 8).

```
  ┌──────────────────────────────────────────────┐
  │  [ sprite ]        Fiole de soin        ×    │  ← en-tête
  │  ────────────────────────────────────────    │
  │                                              │
  │     zone de dessin, vide, à la plume         │  ← la toile
  │                                              │
  │  ────────────────────────────────────────    │
  │  Conserve 2 usages. 8 / 20 Screen.           │  ← description
  │  Effet : 6 screen · issu de « soin »         │  ← en petit, discret
  └──────────────────────────────────────────────┘
```

**La toile est une surface à l'intérieur de la carte, pas un second panneau.** Elle
couvre la zone de description par-dessus, mais elle n'a pas de cadre, pas
d'en-tête, pas de bouton de fermeture : ce n'est pas une modale, c'est la
surface d'écriture de la modale. C'est la seule superposition autorisée dans le
produit, et elle ne l'est que parce qu'elle n'est pas un panneau — **si on lui
donnait un en-tête, ce serait deux panneaux, et la règle 7 le refuse.**

Elle accepte trois gestes : trait libre, gomme, et **main levée** (la main lève la
toile, on lit la carte en dessous). Il n'y a pas de quatrième geste : pas de
formes, pas de couleurs, pas de texte, pas d'effacement d'historique. Un carnet,
pas un logiciel de dessin.

L'annotation vit **sur l'ouverture d'un objet**, pas sur l'objet. Fermer la
carte, c'est refermer l'annotation. Il n'y a pas de « mes notes » séparées.

### 8.3 Partager une ouverture

Le geste central : **un joueur ouvre un objet, et les autres le voient
s'ouvrir.**

| Geste | Effet |
|---|---|
| **Glisser la carte sur la carte d'un allié** (colonne de droite) | l'ouverture est **partagée** avec ce joueur : il voit la même carte, la même toile, et il peut dessiner dedans |
| **Clic droit sur la carte** | menu : *Partager l'ouverture avec…* · *Ne rien partager* |
| *Partager avec…* | modale : liste des joueurs présents, **cases à cocher**, aucun champ libre, le même composant que le sélecteur de destinataire (§7) |
| **Clic droit sur un bloc du fil** | le même menu, sur un bloc : *Partager cette vue avec…* |

Le glisser-déposer et le clic droit mènent **au même composant**. C'est le point
de conception : il n'y a pas deux façons de partager une vue, il y en a deux pour
arriver au même sélecteur de destinataires, parce que glisser c'est le geste
rapide et que le clic droit c'est le geste qu'on fait quand on sait déjà qui.

### 8.4 Ce qui se partage, et ce qui ne se partage pas

C'est la règle la plus fine, et c'est elle qui décide si le carnet est un
inventaire ou un journal. **Ce qui se partage dépend de la nature de l'objet,
jamais de sa valeur, jamais de qui le tient.**

| Nature | Se partage | Ne se partage **jamais** | Pourquoi |
|---|---|---|---|
| **Consommable** (fiole, ration, potion) | la **quantité**, et l'**effet** obtenu | **le fait qu'on l'a consulté** | personne n'a besoin de savoir que tu as lu la fiole. Ce qui compte à l'oral, c'est « j'en ai plus, donnez-moi ». Le fait qu'on l'a lu est une révélation gratuite, et une révélation gratuite casse la fiction |
| **Utilisable** (arme portée, botte, artefact) | l'**effet** — ce qu'il fait, ce qu'il vient de faire | la consultation du texte de règle, l'ordre des charges | l'effet est public par nature : il vient d'arriver. Le texte de règle, non |
| **Outil** (corde, carte, lanterne) | ses **fonctionnalités** — ce qu'il permet, ce qu'il ne permet pas | l'état interne, l'historique d'usage | on se passe l'outil : « prends la lanterne, elle voit dans le noir ». On ne se passe pas le carnet de notes |
| **Secret** (lettre cachée, sceau) | rien, au choix du détenteur | tout, par défaut | il n'existe que pour être gardé |
| **Unique** (artefact de l'histoire) | **rien** | tout | il n'y en a qu'un ; le partager, c'est le donner |

La règle de fond, en une phrase : **on partage ce qu'un joueur dirait à voix
haute autour de la table, et rien d'autre.**

Conséquence d'implémentation, et elle est structurante : `PartagePolicy` est une
fonction de la **nature** (`kind`) de l'objet, lue dans le contenu versionné. Pas
un drapeau posé à la main sur chaque objet, pas une décision du client. Le client
ne fait que la **lire** — il ne décide pas ce qui est partageable, sinon
l'invariant 3 (« le serveur est l'autorité ») est rompu.

### 8.5 Pourquoi c'est V2 et pas M1

`ADR 0008` : « l'inventaire vivant sur les côtés de la table, le partage
d'objets, la carte annotable et le carnet de notes libre sont des fonctionnalités
de M1 ». Elles reposent sur **une liste de destinataires** — c'est-à-dire
exactement sur ce que l'ADR a posé. Ce document n'ajoute donc rien de neuf au
modèle : il donne une forme à une décision de données déjà prise.

En M1, l'inventaire est une **liste** dans la colonne de gauche (noms + quantités,
clic → description en lecture seule, aucun partage, aucune toile). En V2, il
devient le carnet du §8. La colonne de droite lui est réservée dès M1, vide et étiquetée,
pour que la mise en page ne bouge pas quand il arrive.

---

## 9. Les états

Chaque composant qui a un état vide a une ligne dans ce tableau. Il n'y a pas de
composant avec un état vide non décrit : un état vide non décrit est un écran
blanc sur une soirée de jeu.

| Composant | Vide | Chargement | Erreur | Désactivé | Survol | Focus |
|---|---|---|---|---|---|---|
| `Jauge` | libellé seul, « — » | squelette **statique** (pas de shimmer) | trait en `--annule`, valeur conservée | opacité 0.5, valeur **lisible** | titre natif = `14 / 20` | contour `--trait-fort` |
| `Destinataire` | liste cochée, la table cochée par défaut | aucun (valeur par défaut) | le choix **reste** affiché, un `--annule` en ligne | — | — | idem |
| `Fil` | un bloc d'amorce écrit par le moteur | rien, le fil ne bouge pas | bandeau `--annule-aplat`, **le fil reste lisible en dessous** | — | surlignage 1 ligne | bloc focalisable, `Enter` déplie |
| `Compositeur` | placeholder « Ce que tu fais… » | bouton `⏎ envoyer` en `désactivé`, **texte du champ conservé** | l'erreur s'affiche **au-dessus** du champ, le brouillon n'est jamais perdu | bouton désactivé, jamais caché | — | contour `--trait-fort` |
| `Carte` | — | cadre vide + nom | — | opacité 0.5, **nom toujours lisible** | élévation 1px, `--surface-haute` | contour `--trait-fort` |
| `Toile` | grille de points 16px, `--trait` | — | trait perdu ? **le trait est déjà parti** | pointeur levée | — | — |
| `Tiroir` | le tiroir fermé montre son bouton-poussoir **avec son compte** (`inventaire · 4`) | l'ouverture est instantanée, il n'y a rien à charger | le tiroir ne s'ouvre pas sur une erreur de chargement : il s'ouvre **vide**, avec son `EmptyState` | — | le bouton-poussoir reste visible pendant l'ouverture | `aria-expanded` sur le bouton, `Échap` referme |
| `Modale` | — | squelette **statique**, titre déjà écrit | un bandeau dans le calque, **le calque reste** | le bouton `×` est toujours actif | — | piégeage du focus à l'entrée, restitution à la sortie |

Trois règles qui valent plus que le tableau :

- **Un brouillon n'est jamais perdu.** Une erreur réseau, un retour du serveur, un
  rechargement : le texte du compositeur est dans le store, pas dans le DOM.
- **Désactivé n'est pas invisible.** Un élément désactivé qui disparaît est
  impossible à retrouver ; un élément désactivé qui s'efface ne se voit plus.
  L'opacité baisse, le texte reste.
- **Un tiroir fermé announce son contenu.** Un bouton-poussoir nu est un bouton
  dont on ne devine pas l'usage ; il porte le nombre d'objets qu'il contient,
  parce que c'est le seul chiffre d'un tiroir qui compte.

---

## 10. Ce que l'interface ne fait pas

| Interdit | Pourquoi |
|---|---|
| Des onglets qui masquent un canal | ADR 0008, disqualifiant |
| Un mode caché, un « envoyer en secret » | idem |
| Une animation de jet | ADR 0009, réexaminable en fin de projet |
| Une animation d'apparition dans le fil | `global.css` : « lisible tout de suite » |
| Un bouton qui n'explique pas ce qu'il va envoyer | invariant 3 |
| Un champ libre pour désigner un destinataire | §7.1, on coche devant tout le monde |
| Un compteur de tokens, de temps, de coût | le joueur ne joue pas au budget |
| Un écran qui dit « bogue » | les refus ont des phrases métier (`error-messages.ts` existe) |
| **Deux panneaux l'un sur l'autre**, à n'importe quel moment | règle 7 |
| **Deux tiroirs ouverts** à la fois | §4.4 |
| **Une modale qui naît hors du centre**, ou au-dessus d'un tiroir | règles 7 et 8 |
| **Une modale dans une modale** | idem — c'est ce que deviendrait la toile si on lui donnait un en-tête |
| Un tiroir qui **recouvre** une colonne au lieu de la remplacer | §4.4 |
| Un objet qui **disparaît** quand la place manque | §4.2, un tiroir prend sa place, il ne le supprime pas |
| Un sprite sans le nom écrit à côté | le texte est la source, le sprite le redouble |

Et le symétrique, qui est une exigence :

| Obligatoire | Où |
|---|---|
| Toute action du client est une **intention** nommée | `packages/contracts/src/intents` |
| Le client ne calcule **aucun** résultat | `ws/store.ts` est un miroir, jamais une autorité |
| Chaque jet est consultable via **« Pourquoi ? »**, replié par défaut | ADR 0009, `ProofPanel.tsx` |
| Un panneau vide dit **ce qu'il attend** | règle 5 |
| Un calque ouvert **referme** ce qui était ouvert | règle 7 |
| Un tiroir fermé **annonce** son contenu | §9, un bouton nu est un bouton incompréhensible |

---

## 11. Arbitrages déjà pris, et ce qui reste ouvert

### 11.1 Pris, dans ce document

| Décision | Raison |
|---|---|
| Code-first, pas Figma | il n'y a pas de designer dans la boucle |
| La maquette vit dans la route `/design` du client | la maquette et le produit ne peuvent pas diverger |
| Zéro dépendance, pas de Storybook | `pnpm-lock.yaml` est contesté par 3 PRs |
| Les jetons dans un fichier séparé, importé par `global.css` | un seul point d'entrée à lire |
| 3 étages, un seul test qui fait respecter la règle | un test plutôt qu'une revue |
| Quatre colonnes, les deux extrêmes élastiques | le centre est une colonne de lecture ; les côtés sont de la place à objets |
| **Les deux cellules latérales sont `minmax(0rem, 1fr)`**, pas `18rem` fixe | une piste à plancher `auto` refuse de descendre sous son contenu : la grille déborde au lieu de rétrécir |
| Les marges et les rails sont **la même piste** | c'est ce qui permet à une marge de ne pas être un panneau vide qui occupe de la place |
| La gauche et la droite s'effondrent **ensemble** (`1fr` / `1.15fr`) | pas de carnet à droite pendant qu'une marge reste vide à gauche |
| **Jamais deux panneaux superposés** (règle 7) | deux calques d'un coup rendent l'état de l'écran illisible |
| **Toute modale naît au centre** (règle 8) | déduit de la règle 7 : un calque au-dessus d'un panneau latéral en est un second |
| **Un tiroir remplace une colonne, il ne la recouvre pas** | c'est la même règle 7 appliquée à l étroite |
| **Un seul tiroir à la fois** | idem |
| Le tiroir gauche est **moins** accessible que le droit | l'inventaire est ce dont on a besoin tout de suite ; la fiche se consulte |
| Les 12 `move.*` ne deviennent pas une barre | ce sont des actions **induites dans le texte**, pas un jeu de cases |
| Les colonnes latérales sont réservées dès M1, vides et étiquetées | le V2 ne doit pas faire bouger la mise en page |
| Le sélecteur de destinataire est toujours visible | ADR 0008, le composant le plus important |
| `PartagePolicy` vit dans le contenu, pas dans le client | invariant 3 |
| La toile de dessin est **une surface dans la carte**, pas une modale | sinon ce sont deux panneaux superposés |
| Le vocabulaire est **élan**, jamais « souffle » | le mot du cahier des charges |
| **`--trait` reste sous 3:1, c'est un choix** | 1.4.11 ne vise que ce qui *identifie* un composant ; un panneau est identifié par son titre, un anneau de focus ne peut l'être que par lui-même |
| `--trait-fort` sert au **focus**, pas aux bordures de panneau | c'est le seul filet qui doit passer 3:1, donc c'est le seul qui doit dire quelque chose |

### 11.1 bis Ce qui est fait, et ce qui reste dû

`styles/tokens.css` et `styles/tokens.test.ts` existent. 52 tests, tous verts,
et chacun a été **prouvé en violant la règle** qu'il garde : un `#hex` dans une
feuille, un `var(--p-…)` hors jetons, un `px`, un `var(--typo)`, un plancher de
grille trop large, l'import supprimé, l'ancien `--annule` à 4,22:1 — chacun fait
échouer exactement le test qui le regarde.

Une seule dette reste, et elle est **comptée** en bas de `tokens.test.ts` :

| Dette | Où | Pourquoi pas maintenant |
|---|---|---|
| 15 valeurs `rem` écrites en dur, hors `--e-1`…`--e-12` | `global.css` | `global.css` a été écrit avant que l'échelle existe. Toutes sont des paddings et des gaps de 0,35 à 1,5rem : les arrondir à l'échelle ferait grossir l'existant, et le resserrer ferait casser `screens.test.tsx`. Le cliquet interdit d'en **ajouter** une seizième ; migrer une règle fait baisser le nombre, et le test oblige à dire le nouveau |
| Les 6 teintes de `TableRoom` | §2.1 | le test qui compte les `--p-*` réellement utilisés n'a rien à mesurer tant que `TableRoom` est le coquillage M0 |

### 11.2 Ouvert — à trancher en jouant, pas en réunion

| Question | Ce qu'il faut pour trancher |
|---|---|
| **Le mini-jeu de serrure est-il réel ou décoratif ?** (§4.6) | un **ADR**, pas une partie : ça touche le moteur, le journal et le budget d'IA. La surface est prête dans les deux cas |
| **L'âme en pastilles** se lit-elle, ou se confond-elle avec du texte ? | une partie à 5, regard sur la colonne de gauche |
| **La toile** est-elle une surface par ouverture, ou persistante par objet ? | le cas réel : fermer puis r'ouvrir une carte pour vérifier |
| **Le glisser-déposer** est-il le geste principal, ou un raccourci ? | un groupe qui n'a jamais utilisé le clic droit |
| **Vivres** : une pastille = un vivres, ou 3 vivres ? | la valeur réelle en jeu |
| **La marge gauche** porte-t-elle vraiment de l'inventaire, ou vaut-il mieux une vraie marge ? | un écran 2560px avec le carnet étalé des deux côtés |
| **Le tiroir bas** est-il nécessaire, ou est-ce un panneau de trop ? | un téléphone en usage réel, pas une maquette |
| **La marque du groupe** dans la colonne de droite (où est la bande) | ADR 0008 le renvoie au M1 ; la maquette doit au moins réserver la place |
| Le mini-jeu se joue-t-il au téléphone, ou pas du tout ? | dépend entièrement de la réponse à la première question |

---

## 12. Chaque promesse nomme son test

Rien dans ce document n'est « à voir ». Chaque ligne est soit un fichier, soit
un test.

| Promesse | Où elle tient | Test |
|---|---|---|
| Un composant ne référence que l'étage 2 et 3 | `styles/tokens.css` | `styles/tokens.test.ts` — un `#hex`, un `rgb(`, un `px` ou un `var(--p-…)` hors jeton échoue |
| Le compte de 6 teintes tient | §2.1 | `tokens.test.ts` — le nombre de `--p-*` effectivement utilisés par `TableRoom` ≤ 6 |
| Les 15 contrastes promis sont promis | §2.2 | `tokens.test.ts` — 15 paires texte/fond recalculées, ≥ 4,5 chacune |
| Un filet qui dit quelque chose est fort | §2.2 | `tokens.test.ts` — `--trait-fort` ≥ 3:1 sur les trois fonds ; et `--trait` reste **sous** 3:1, ce qui est assumé |
| Les 3 jauges se distinguent sans la couleur | règle 2 | `Jauge.test.tsx` — rendu `sans-couleur` : glyphes et libellés suffisent |
| La portée ne se lit pas à la couleur seule | §5.3 | `Journal.test.tsx` — chaque portée a un glyphe et un libellé en texte |
| Le sélecteur de destinataire est toujours rendu | §7 | `screens.test.tsx` — présent sur toute la table, jamais dans un menu |
| On ne déclassifie pas sans prévenir | §7.2 | `Destinataire.test.tsx` — réponse publique à un bloc privé ⇒ avertissement bloquant |
| Un brouillon n'est jamais perdu | §9 | `screens.test.tsx` — erreur réseau puis retour : le champ est intact |
| Le jeu de la jauge modifiée est une position, pas une couleur | §6.2 | `Jauge.test.tsx` — la jauge modifiée est à l'emplacement attendu |
| `PartagePolicy` vient du contenu, pas du client | §8.4 | `PartagePolicy.test.ts` — le client ne contient aucune table de partage |
| Le momentum n'est pas une jauge | §6.3 | `Jauge.test.tsx` — aucun composant `Jauge` ne rend de momentum |
| **Jamais deux panneaux superposés** | règle 7 | `atMostOneDialog.test.tsx` — à tout instant, `queryAllByRole('dialog')` + `[aria-modal]` ≤ 1, tiroirs compris |
| Ouvrir un calque referme le tiroir | règles 7 et 8 | `atMostOneDialog.test.tsx` — ouvrir une carte depuis un tiroir ouvert laisse 0 tiroir et 1 modale |
| La toile n'est pas une modale | §8.2 | `atMostOneDialog.test.tsx` — la carte annotable contient 1 `dialog`, pas 2, et aucun second en-tête |
| Une modale naît au centre | règle 8 | `atMostOneDialog.test.tsx` — aucune modale n'est rendue à l'intérieur d'une colonne latérale |
| La grille ne déborde pas | §4.1 | `tokens.test.ts` — la **somme** des planchers d'une grille ≤ `--seuil-tiroir-tout`, sinon le test échoue |
| Un seul tiroir à la fois | §4.4 | `Tiroir.test.tsx` — ouvrir le droit ferme le gauche |
| Le tiroir fermé annonce son contenu | §9 | `Tiroir.test.tsx` — le bouton-poussoir porte le compte d'objets |
| Le tiroir gauche est moins accessible que le droit | §4.4 | `screens.test.tsx` — sur écran étroit, le bouton de l'inventaire est avant celui de la fiche dans l'ordre de lecture |
| La colonne de droite est réservée et étiquetée en M1 | §4.3 | `screens.test.tsx` — la colonne existe, vide, avec son `EmptyState` |
| `/design` rend chaque jeton, chaque état et chaque largeur | §0.2 | `design.test.tsx` — la route rend sans erreur, la liste d'échantillons est complète, et les trois largeurs de §4.2 sont rendues |
| Le mini-jeu reste une surface unique | §4.6 | `atMostOneDialog.test.tsx` — le mini-jeu est un `dialog`, jamais un `dialog` dans un `dialog` |
| Aucune dépendance nouvelle | §0.6 | le diff de `pnpm-lock.yaml` reste vide |

---

## Annexe A — Le langage d'un objet

Format de contenu versionné, en lecture seule depuis le client. Il n'est pas
figé ici : c'est la structure que **tout** le §8 consume, et le premier
`item.*` du dépôt décidera de sa forme finale.

| Champ | Contenu | Vrai pour |
|---|---|---|
| `id` | clé stable, slug ASCII | tout |
| `nom` | affiché sur la carte | tout |
| `nature` | `consommable` · `utilisable` · `outil` · `secret` · `unique` | tout |
| `sprite` | chemin optionnel | tout |
| `quantite` | entier, dans la main du joueur | consommable |
| `description` | texte, révélé à l'ouverture | tout |
| `effet` | texte, partageable par construction | consommable, utilisable |
| `fonctionnalites` | liste, partageable par construction | outil |
| `divisible` | `oui` · `non` — peut-on en donner une partie | consommable |
| `note_partage` | texte libre du_content, affichable ou non | tout |

`divisible` est la seule chose qui décide si on peut **donner** un objet, et elle
est indépendante de `nature` : une fiole est consommable et divisible, une épée
est utilisable et ne l'est pas. Une règle, un champ.

---

## Annexe B — Jauges : traitements sprite (spéculatif)

**Rien de cette annexe n'est en M1.** Ces traitements sont les mêmes que ceux
discutés pour l'interface, et ils tombent sous la clause de l'ADR 0009 (« point
réexaminable en toute fin de projet, sans engagement »). Ils sont notés ici pour
que la décision de fin de projet ait des options sous les yeux, et pas pour
qu'on les écrive.

| Jauge | Traitement | Ce qu'il faut trancher |
|---|---|---|
| **Vigueur** | un tube de verre, liquide **rouge qui monte et descend** | la hauteur du tube est la seule donnée, alors que `--annule` en texte est plus lisible. Le sprite remplace-t-il la barre, ou la double-t-il ? |
| **Âme** | un tube de verre, **petites billes blanches** en suspension, la **densité** = la quantité | un nombre dense de points se lit-il, ou se lit-il comme du bruit ? Doute sérieux, et c'est le cas le plus faible des trois |
| **Vivres** | non tranché | — |

Le point commun, et c'est ce qui le bloque : une animation de niveau, si belle
soit-elle, ne peut pas être **la seule** façon de lire la valeur, parce qu'elle
n'est ni dans le DOM, ni imprimable, ni lisible par un lecteur d'écran, ni
disponible dans une capture d'écran d'archive. Le jour où un sprite est accepté,
la barre en texte reste derrière lui.

**C'est aussi la réponse à « l'âme se confond-elle avec du texte » :** oui, et un
nuage de billes blanches se confondrait encore plus. La forme portera l'information
avant la couleur, et l'os avant le rouge.
