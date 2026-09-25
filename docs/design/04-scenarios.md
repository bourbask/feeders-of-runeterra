# 04 — Construire un scénario : ce que la recherche dit, et ce qu'on en retient

Ce document est une **synthèse de recherche**, pas une spécification. Il dit ce qu'un scénario doit
contenir pour tenir debout, d'où ça vient, et ce qu'on en garde. La spécification qui en découle est
l'ADR 0012.

---

## 1. Le principe que toute la littérature répète

> **On prépare une situation, pas une histoire.**

C'est la phrase qui revient partout, de Justin Alexander (*Don't Prep Plots*) aux *Fronts* de Dungeon
World. Un scénario préparé comme une histoire suppose ce que les joueurs vont faire ; dès qu'ils font
autre chose, il faut les y ramener — et c'est ce qu'on appelle un rail.

Une situation, elle, est un état du monde : des gens qui veulent des choses incompatibles, une
menace qui avance, et des lieux où ça se joue. Elle n'a pas besoin que les joueurs fassent quoi que
ce soit de précis. Elle réagit.

La formulation la plus courte trouvée : **« les joueurs n'ont pas besoin d'une histoire, ils ont
besoin d'un problème ».**

**Ce qu'on en retient.** Notre générateur ne produit jamais une suite d'événements. Il produit un
**état initial du monde** plus des **menaces qui avancent toutes seules**.

---

## 2. Le front : ce qui se passe si personne ne fait rien

Dungeon World appelle **front** un faisceau de dangers liés, avec un ou plusieurs *impending dooms* —
les choses horribles qui arriveront sans intervention.

Sa pièce maîtresse est le **grim portent** : la liste ordonnée des étapes concrètes que la menace
franchit **si les joueurs n'interviennent pas**. Ce n'est pas un compte à rebours abstrait, c'est une
chaîne de conséquences dont chaque maillon est une scène possible.

**Ce qu'on en retient, et c'est un cadeau :** le moteur a déjà des **horloges** à 4, 6, 8 ou 10
segments. Un front, c'est une horloge dont **chaque segment porte son présage**. Rien à inventer
côté mécanique — le vocabulaire manquait, pas la machinerie.

C'est aussi la réponse à « faut-il construire l'apparition des perturbations en amont ? ». Oui —
mais comme une **chaîne de conséquences**, jamais comme un programme de rencontres. On prépare ce
qui arrive si on ne fait rien. Ce qui arrive parce qu'on a fait quelque chose, c'est le jeu.

---

## 3. Le nœud : la pièce de puzzle, et la règle qui l'empêche de coincer

Justin Alexander décrit la **conception par nœuds** : on découpe le scénario en situations, et on
place dans chacune des pistes vers les autres. Les joueurs circulent dans un **graphe**, pas dans une
séquence.

Sa règle des trois indices dit : pour toute conclusion qu'on veut voir atteinte, placer **au moins
trois** indices qui y mènent. Sa version inversée, celle qui nous intéresse, dit : **tant que les
joueurs ont accès à trois pistes, quelles qu'elles soient, le scénario avance.**

> **Un mot sur « arborescence ».** C'est l'intuition naturelle, et c'est le piège. Un arbre n'a
> qu'un chemin de la racine à chaque feuille : c'est un rail avec des embranchements. Un **graphe**
> laisse arriver au même endroit par plusieurs côtés, et c'est précisément ce qui fait qu'on ne peut
> pas rater le scénario. La différence n'est pas cosmétique, elle est la totalité du sujet.

**Ce qu'on en retient :** un nœud porte **au moins trois pistes sortantes**, et cette règle devient
un contrôle de `content:check`. Un graphe de scénario dont un nœud a moins de trois pistes est un
contenu qui ne part pas. La crainte du rail cesse d'être une intention et devient un test.

---

## 4. Les questions d'enjeu

La pratique recommande d'écrire 1 à 3 **questions d'enjeu** avant de jouer : des questions sur des
gens, des lieux ou des groupes, dont la résolution fait que *plus rien ne sera pareil*.

Leur fonction n'est pas de décider à l'avance, c'est de **savoir ce qu'on cherche à découvrir**.
Elles empêchent la partie de tourner à vide sans imposer de réponse.

**Ce qu'on en retient :** chaque nœud porte une question d'enjeu. Elle sert deux fois — elle oriente
le conteur, et elle donne au moteur un critère de « ce nœud est résolu ».

---

## 5. Ce qu'Ironsworn apporte déjà, et qu'on n'a pas à refaire

Notre moteur en descend, donc ces pièces existent :

| Pièce d'Ironsworn | Chez nous | Ce que ça fait |
|---|---|---|
| **Serment** | `Vow` + piste de progression | l'objectif, avec son rang et sa mesure d'avancement |
| **Oracles** | `content/oracles/**` | la réponse quand personne n'a prévu la question |
| **Vérités du monde** | `content/truths/freljord-truths.json` | ce qui est vrai avant que quiconque joue |
| **Liens** | piste de genre `bond` | ce qui attache un personnage à quelqu'un |

Ironsworn est conçu pour jouer **sans scénario préparé** : les oracles improvisent, les serments
donnent la direction. C'est exactement le filet dont on a besoin quand les joueurs sortent du cadre —
et il est déjà livré.

---

## 6. La liste, après synthèse : ce qu'un scénario doit définir

| # | Élément | Question à laquelle il répond | Sans lui |
|---|---|---|---|
| 1 | **Période** | quand ? | anachronismes — un personnage croise quelqu'un mort depuis trois siècles |
| 2 | **Lieu** | où ? | la scène flotte |
| 3 | **Front** | ce qui avance sans nous | rien ne presse, la partie tourne à vide |
| 4 | **Enjeu** | ce qu'on perd si le front aboutit | la menace n'inquiète personne |
| 5 | **Figures** | qui veut quoi | des silhouettes, pas des gens |
| 6 | **Nœuds** | où ça se joue | rien à explorer |
| 7 | **Pistes** | comment on passe d'un nœud à l'autre | un rail, ou une impasse |
| 8 | **Ressort** | pourquoi CES personnages | la bande est spectatrice de sa propre aventure |
| 9 | **Serment d'ouverture** | ce qu'on jure de faire | pas de mesure d'avancement |
| 10 | **Question d'enjeu** | ce qu'on cherche à découvrir | on ne sait pas quand c'est fini |

Ces dix éléments sont **le questionnaire** que l'outil fera parcourir au modèle.

---

## 7. Le lore du Freljord : ce qu'on sait, et d'où

Le Freljord a une frise documentée, ce qui en fait un terrain idéal pour des **périodes**.

| Époque | Ce qui la définit |
|---|---|
| Avant les Sœurs | les demi-dieux du nord règnent ; les Yétis ont leur magie |
| Le pacte | Lissandra traite avec les Regards pour l'immortalité, à l'insu de ses sœurs |
| L'union des Trois Sœurs | Avarosa, Serylda et Lissandra unissent le Freljord et abattent les anciens dieux |
| La Guerre des Trois Sœurs | la rupture, la Vraie Glace, le rituel de l'Abîme Hurlant |
| La Longue Nuit | les Regards emmurés, les Yétis rendus sauvages, le monde refroidi |
| Le Freljord moderne | trois factions — Avarosans, Griffe d'Hiver, Gardiens du Gel — et trois prétendantes |

La division moderne en trois est remarquablement nette : les **Avarosans** agraires et pacifiques,
la **Griffe d'Hiver** guerrière, les **Gardiens du Gel** mystiques. Trois manières de vouloir le
même territoire — c'est-à-dire, en langage de scénario, **trois fronts qui se gênent**.

> **Ce qu'on prend, et ce qu'on n'écrit pas.** On prend **la charpente** — les époques, les
> factions, les tensions, les lieux. On **écrit nos propres textes**. Aucun paragraphe de Riot n'est
> recopié dans `content/`. C'est une exigence juridique (la tolérance des fan-projects couvre le
> gratuit et l'original, pas la reproduction) et une exigence de qualité : un corpus recopié
> apprendrait au conteur à imiter une voix qui n'est pas la nôtre.

---

## 8. Pourquoi c'est un modèle qui assemble, et pas un tirage au sort

Un tirage aléatoire donnerait de la variété sans cohérence : une marchande dans une période où le
commerce n'existe pas, un allié d'une faction qui n'est pas encore née.

Un humain donnerait de la cohérence, mais il faut un humain — c'est exactement la contrainte qu'on
cherche à lever.

Un modèle **à qui on ne laisse que des choix fermés** donne les deux : il décide en tenant compte de
ce qui précède, il ne répète pas, et il ne peut rien inventer parce qu'on ne lui laisse pas la place.

**C'est l'invariant 1, appliqué au scénario** : le moteur pose les questions et ferme les réponses
possibles, le modèle choisit. Il habille, il ne décide pas des règles — ici, il assemble, il
n'invente pas les pièces.

---

## Sources

- Justin Alexander, *Don't Prep Plots* et *Node-Based Scenario Design* (parties 1 à 6), thealexandrian.net
- Justin Alexander, *The Three Clue Rule* et son inversion
- *Fronts*, Dungeon World SRD
- Ironsworn et Ironsworn: Starforged, Shawn Tomkin — serments, oracles, vérités du monde
- Riot Games, politique de contenu créé par les fans et conditions de service
- League of Legends Universe et wikis communautaires, pour la frise du Freljord
