# ADR 0012 — Le scénario s'assemble, il ne s'invente pas

Statut : **acté** · Date : 26 septembre 2026 · Décideurs : le porteur du projet (l'intention), le tech lead (la forme)
Origine : la séance de conception du 25 septembre au soir, et la mesure de M0-32.
Recherche : `docs/design/04-scenarios.md`.

## Ce qu'on veut, dans les mots du porteur

> *« on devra le mettre sur des rails […] pour ne lui donner que de la liberté créative à choisir
> entre tel ou tel élément […] préparer d'abord des pièces de puzzle qu'il pourra ensuite assembler
> pour déterminer un scénario global en fonction de règles prédéfinies de cohérence »*

et, sur la limite à ne pas franchir :

> *« tant que c'est cohérent, on devrait pas empêcher les joueurs de faire un truc, même si ça match
> pas exactement le scénario attendu »*

Ces deux phrases tirent dans des directions opposées — contraindre le modèle, libérer les joueurs —
et c'est exactement le bon cahier des charges. Cet ADR dit comment on tient les deux.

---

## Décision 1 — le modèle choisit, il n'invente jamais

C'est **l'invariant 1 appliqué au scénario**. Le moteur pose une question et **ferme la liste des
réponses** ; le modèle en choisit une et dit pourquoi en une phrase. Un identifiant inventé est
refusé et la question est reposée.

| | |
|---|---|
| Ce que le modèle produit | **un identifiant** pris dans une liste, plus une justification en une phrase |
| Ce qu'il ne produit jamais | une pièce, un lieu, un personnage, une règle |
| Ce qui valide | l'identifiant résout, ou l'étape échoue |

**Pourquoi ça compte plus qu'il n'y paraît.** M0-32 a mesuré que les modèles gratuits locaux
**n'écrivent pas de sortie structurée** — 24 échantillons, zéro bloc de scène. Une génération de
scénario qui demanderait un gros document JSON échouerait chez eux exactement de la même façon.
Une question fermée à la fois, en revanche, un modèle de 3 milliards de paramètres sait le faire.

**La contrainte de budget ne s'applique pas ici.** Un scénario se construit **une fois par
campagne**, pas à chaque tour. L'ADR 0011 plafonne le tour à 7 000 tokens parce qu'il est multiplié
par soixante ; la construction, elle, peut être lente, bavarde et faite sur un modèle plus gros.

---

## Décision 2 — le vocabulaire des pièces

Six familles neuves, qui s'ajoutent au contenu existant sans rien lui retirer :

| Pièce | Ce que c'est | Devient, dans le moteur |
|---|---|---|
| **période** | une tranche de la frise : ce qui est vrai alors, ce qui ne l'est pas encore | filtre sur toutes les autres pièces |
| **front** | ce qui avance si personne n'intervient, un présage par segment | une **horloge** 4/6/8/10 |
| **nœud** | une situation — un lieu, un affrontement, une rencontre — avec sa question d'enjeu | une **scène** quand on y arrive |
| **figure** | un personnage défini par ce qu'il veut, pas par ses chiffres | une **entité** `npc` |
| **ressort** | pourquoi CES personnages sont concernés | un **serment** et des **liens** |
| **rencontre** | marchands, alliés, bêtes, trouvailles | tirée à l'**oracle**, jamais programmée |

**Rien de tout ça n'ajoute une primitive au moteur.** Horloges, entités, scènes, serments et pistes
de progression existent déjà. Ce qui manquait est le vocabulaire, pas la machinerie — et c'est la
raison pour laquelle ce chantier est du contenu et un outil, pas une refonte.

---

## Décision 3 — deux étapes, et les personnages au milieu

Le porteur hésitait : le scénario avant ou après le choix des personnages ? **Les deux, et c'est ce
qui lève l'hésitation.**

| Étape | Quand | Ce qui se décide | Pourquoi là |
|---|---|---|---|
| **A — la situation** | avant les personnages | période, région, front, nœuds disponibles | l'état du monde ne dépend de personne |
| **B — les ressorts** | après les personnages | pourquoi cette bande, le serment d'ouverture, les liens | on ne peut accrocher que des gens qu'on connaît |

Un scénario entièrement bâti avant la distribution ne peut accrocher personne : il ignore les
serments, les alias et les atouts des fiches. Un scénario entièrement bâti après est un scénario
écrit sur mesure pour la bande, donc un rail. La coupure est à cet endroit précis.

---

## Décision 4 — trois pistes par nœud, et c'est un contrôle, pas une intention

La règle des trois indices inversée : **tant que les joueurs ont trois pistes, le scénario avance.**

`content:check` refuse un graphe où :

- un nœud porte **moins de trois pistes sortantes** ;
- un nœud n'est atteignable depuis aucun autre ;
- une piste pointe vers un nœud d'**une autre période** ;
- un front porte plus de présages que son horloge n'a de segments.

**Un graphe qui échoue est un contenu qui ne part pas.** La crainte du rail cesse d'être une
vigilance et devient une commande qui sort en code non nul.

---

## Décision 5 — sortir du cadre est prévu, en trois couches

C'est la deuxième phrase du porteur, et c'est elle qui décide de la forme.

| Les joueurs font… | Ce qui répond |
|---|---|
| ce qu'une **piste** couvre | le nœud visé |
| ce qu'aucune piste ne couvre, mais qu'un **nœud** couvre | ce nœud — le graphe n'est pas un arbre |
| **rien de tout ça** | l'**oracle** répond, et un fil (`thread`) naît |

La troisième couche est la réponse d'Ironsworn, et elle est déjà livrée. **Personne ne s'entend
jamais dire non.** Le scénario n'est pas ce qui doit arriver ; c'est ce qui était prêt.

---

## Décision 6 — rejouable, donc tiré sur un flux nommé

L'ordre des candidats présentés au modèle est mélangé sur un **flux de hasard nommé**, amorcé par
campagne. Deux conséquences :

- le même contenu donne des scénarios différents, ce qui est la condition de la rejouabilité ;
- la construction se **rejoue à l'identique**, donc l'invariant 4 tient jusque dans la genèse.

Sans le flux nommé, on aurait de la variété et aucune reproductibilité : impossible de rejouer une
campagne, impossible de déboguer une genèse ratée.

---

## Décision 7 — la charpente est empruntée, les textes sont à nous

Le Freljord fournit une frise et des factions. **On les prend.** On ne recopie **aucun texte** de
Riot dans `content/`.

Deux raisons, et elles suffisent chacune :

- la tolérance de Riot pour les projets de fans couvre le **gratuit et l'original**, pas la
  reproduction. Notre dépôt est public et le restera ;
- un corpus recopié apprendrait au conteur à imiter une voix qui n'est pas la nôtre — c'est le même
  motif que le refus des scènes de référence écrites par une IA.

---

## Ce que cet ADR ne tranche pas

- **le nombre de pièces** nécessaire pour que ça ne se répète pas. Ça se mesure en jouant, comme
  l'équilibrage des atouts de l'ADR 0009 ;
- **quel modèle** construit le scénario. La construction supporte un modèle plus gros et plus lent
  que le tour ; laquelle exactement se mesure, et la sonde de M0-32 sait déjà le faire ;
- **si le front avance au temps réel ou au tour.** Ça touche la boucle de jeu, pas le vocabulaire.
