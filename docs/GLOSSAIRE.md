# Glossaire

Les mots du jeu et les mots du code. Se lit sans connaître le projet.
Un terme manque ? C'est un défaut de ce fichier — signalez-le.

---

## Les mots du jeu

### Jauges

Trois compteurs par personnage, de **0 à 5**. Pas de points de vie.

| Jauge | Mesure | À 0 |
|---|---|---|
| **Vigueur** | le corps | tu es au bout physiquement |
| **Âme** | la volonté | tu es brisé |
| **Vivres** | nourriture et combustible | la faim et le froid gagnent |

Une jauge ne bouge que parce qu'un mouvement l'a coûté. Le moteur l'applique avant que le
conteur écrive.

### Souffle

Une quatrième valeur, de **−6 à +10**, départ à **+2**. L'élan : ce que ton personnage a
accumulé de vitesse, de confiance et de chance.

**Le brûler, c'est réécrire un jet que tu as déjà vu.** C'est la seule chose du jeu qui
rattrape un mauvais résultat, et elle ne se déclenche jamais toute seule.

Quatre mots ci-dessous viennent du **Jet de défi**, défini plus bas — ils s'y lisent en entier :

| Le mot | En une ligne |
|---|---|
| **score** | ce que tu totalises : ton dé d'action + ton attribut + tes bonus, plafonné à 10. |
| **dés de défi** | les deux d10 que ton score doit battre. |
| **réussite franche** | tu bats les deux : ça marche. |
| **échec** | tu n'en bats aucun : ça ne marche pas. |

La brûlure, question par question :

| Question | Réponse |
|---|---|
| **Quand ?** | **après** le lancer. Les dés sont sur la table, tu les lis, **puis** tu décides. |
| **Ce que ça fait** | ton souffle **remplace** ton score, il ne s'y ajoute pas. |
| **Ce que ça change** | l'issue elle-même : souffle 8 contre des dés de défi de 6 et 7, un **échec** devient une **réussite franche**. |
| **Ce qui s'applique alors** | les conséquences de la **nouvelle** issue. Le prix de l'échec n'est jamais payé. |
| **Ce que ça coûte** | le souffle retombe à **+2**. Il était à 8 : tu viens de dépenser plusieurs tours d'élan. |
| **Quand c'est refusé** | si ton souffle ne **dépasse** pas ton score — il n'y aurait rien à gagner — ou s'il est négatif. |

Tant que tu n'as pas répondu, **le tour n'est pas fini** : le mouvement a lancé ses dés, il n'a
appliqué aucune conséquence. Trois réponses ferment la fenêtre, et rien d'autre.

| La réponse | Ce qui arrive |
|---|---|
| **Je brûle** | le souffle remplace le score, l'issue est révisée, et ce sont ses conséquences qui s'appliquent. |
| **Je garde** | les dés restent tels quels, et les conséquences de l'issue d'origine s'appliquent. |
| **Tu fais autre chose** | le filet de sécurité : ton action suivante ferme la fenêtre comme un « je garde ». Un onglet fermé ne laisse pas un tour en suspens. |

Le premier jet n'est **jamais** réécrit : la révision s'ajoute au journal à côté de lui, et la
commande « Pourquoi ? » montre les deux.

| Autre usage | Effet |
|---|---|
| **Souffle négatif** | si ton dé d'action égale sa valeur absolue, ce dé est annulé — il compte pour zéro, il n'est pas relancé. |

### Attributs

Cinq, valant **1, 2 ou 3**. Répartition imposée à la création : **3/2/2/1/1**.

| Attribut | Couvre |
|---|---|
| `vif` | vitesse, précision |
| `cœur` | volonté, lien, charisme |
| `fer` | force, endurance |
| `ombre` | ruse, discrétion |
| `esprit` | perception, savoir, magie |

Pas de niveaux. Un personnage ne devient pas meilleur, il devient différent.

### Jet de défi

1d6 (**dé d'action**) + attribut + bonus : leur somme est ton **score**, plafonné à **10**.
Il se lit contre **2d10**, les **dés de défi**.

| Résultat | Nom | Sens |
|---|---|---|
| bat les deux | réussite franche | ça marche |
| bat un seul | réussite partielle | ça marche, ça coûte |
| n'en bat aucun | échec | ça ne marche pas |

**Présage** : les deux dés de défi affichent la même valeur → un retournement s'ajoute, quel que
soit le résultat.

### Mouvements

Les onze actions codifiées. On ne lance pas les dés « pour voir » : on déclare un mouvement, et
c'est lui qui dit ce qui arrive à chaque résultat.

Affronter le danger · Assurer un avantage · Rassembler des informations · Sonder une âme ·
Frapper · Encaisser · Endurer le froid · Jurer un serment · Accomplir son serment ·
Atteindre un jalon · Renier son serment.

### Payer le prix

Quand ça tourne mal, le moteur tire sur une table de douze conséquences. L'entrée tirée est
imposée. Ni le conteur ni le joueur ne choisit (ADR 0006).

### Jauge de progression

Un serment, un combat ou un voyage a **dix cases** de **quatre crans**. Le rang décide de la
vitesse.

| Rang | Crans par jalon |
|---|---|
| Gênant | 12 |
| Dangereux | 8 |
| Redoutable | 4 |
| Extrême | 2 |
| Épique | 1 |

### Autres termes du jeu

| Terme | Définition |
|---|---|
| **Serment** (vœu) | ce sur quoi ton personnage engage sa parole. La colonne vertébrale d'une campagne. |
| **Horloge** | une jauge qui mesure ce que *le monde* fait. Elle avance qu'on s'en occupe ou non. |
| **Oracle** | ce qui remplace le maître de jeu : questions fermées pondérées, et tables de lieux, noms, complications. |
| **Conteur** | le modèle de langage qui écrit les scènes. Il ne décide de rien : les dés ont tranché avant. |
| **Trait** | ce que ta fiche établit et qui s'applique sans jet — une langue, une origine, un métier. |
| **Portée** | qui voit une information : `table`, `subset` (un groupe séparé), `private`. |

### Les mots du scénario

Les six familles de pièces qu'un scénario assemble (ADR 0012). Aucune n'ajoute une primitive au
moteur : chacune se traduit en quelque chose qui existait déjà.

| Terme | Définition | Devient |
|---|---|---|
| **Période** | une tranche de la frise du Freljord : ce qui est vrai alors, et ce qui ne l'est **pas encore**. | un filtre sur toutes les autres pièces |
| **Front** | ce qui avance si personne n'intervient, avec un **présage** par étape. | une horloge de 4, 6, 8 ou 10 segments |
| **Présage** (de front) | une étape concrète que la menace franchit. À ne pas confondre avec le **présage des dés**, qui est un doublé. | un segment d'horloge |
| **Nœud** | une situation — un lieu, un affrontement, une révélation — avec sa question d'enjeu. Jamais un déroulé. | une scène, quand la bande y arrive |
| **Piste** | une façon de sortir d'un nœud vers un autre. Un nœud en porte **au moins trois**, vers trois endroits différents. | rien : c'est du contenu que le conteur lit |
| **Point d'entrée** | un nœud où la bande peut commencer (`entryPoint`). Tout autre nœud doit être atteignable depuis l'un d'eux, sinon c'est du travail perdu. | la scène initiale de la campagne |
| **Îlot** | un groupe de nœuds reliés entre eux et à rien d'autre : chacun a bien des pistes qui mènent à lui, mais aucune ne vient d'un point d'entrée. Refusé par la cinquième passe. | rien : le contenu ne part pas |
| **Figure** | quelqu'un défini par ce qu'il **veut**, ce qu'il **refuse** et ce qu'il **sait**. Aucun chiffre. | une entité `npc` |
| **Ressort** | pourquoi *ces* personnages-là sont concernés. Se choisit après la distribution. | un serment et des liens |
| **Rencontre** | marchand, allié, bête, trouvaille, obstacle. **Tirée à l'oracle**, jamais programmée. | un tirage d'oracle |

---

## Les mots du code

### `c2s` et `s2c`

Client to server, server to client. Des **préfixes de nom de message**, pas des objets.

```jsonc
// client → serveur
{ "v": 1, "t": "c2s.intent", "id": "<uuid>", "p": { "intent": { … } } }

// serveur → client
{ "v": 1, "t": "s2c.event", "id": "<uuid>", "ts": 1758…, "seq": 412, "deliverySeq": 37, "p": { … } }
```

| Champ | Contenu |
|---|---|
| `t` | le type du message. `c2s.intent` est une **valeur de `t`**, pas un chemin de propriété. |
| `v` | version du protocole. Si elle ne correspond pas, la connexion se ferme. |
| `id` | l'identifiant du message, un UUID. Le serveur s'en sert pour ne pas rejouer deux fois la même action si le message revient. |
| `p` | la charge utile. Son contenu dépend de `t`. |
| `seq` | serveur → client seulement. Le numéro de l'événement dans le journal de la campagne. Il ne recule jamais, mais il n'est **pas** l'horloge unique du système : depuis l'ADR 0010, `deliverySeq` en est la seconde. |
| `deliverySeq` | serveur → client seulement. Le **numéro de livraison** : le compte des messages envoyés à **ce** joueur-là, sans trou. C'est lui, et lui seul, qui permet de voir qu'un message a été perdu, et c'est lui que `c2s.resume` porte. ADR 0010. |

Huit messages du client vers le serveur. **Un seul modifie quelque chose** : `c2s.intent`. Les
autres ouvrent la session, rattrapent ce qui a été manqué, ou demandent une lecture.

### Le vocabulaire de l'état

| Terme | Définition |
|---|---|
| **Intention** | ce que le client a le droit d'envoyer : une envie. « Je tente de convaincre Hjalmar. » Jamais un résultat — aucun message ne permet de dire « j'ai réussi ». |
| **Événement** | ce que le serveur écrit au journal une fois qu'il a tranché. Définitif. On en ajoute, on n'en corrige pas. Il en existe 71 types. |
| **Journal** | la suite des événements. Le rejouer depuis le début redonne exactement l'état d'une campagne. |
| **Projection** | un raccourci calculé depuis le journal pour éviter de tout rejouer à l'affichage. Jetable : si elle diverge, on l'efface et on la reconstruit. |
| **Instantané** | une photo de l'état à un moment donné, pour ne pas rejouer dix mille événements au chargement. Commodité, jamais source de vérité. |
| **Chronique** | un résumé compacté de la campagne, régénéré régulièrement. Un modèle ne peut pas lire six mois de journal à chaque scène : c'est la mémoire longue du conteur. |

### Le vocabulaire de la qualité

| Terme | Définition |
|---|---|
| **Miroir** | les règles sont écrites dans le moteur, puis recopiées en schémas de validation dans les contrats. Cette recopie peut diverger en silence (ADR 0007), donc un test compare les deux listes membre à membre. |
| **Garde-fou** | tout ce qui échoue quand on enfreint une règle : lint, test, vérification de dépendances. Il n'existe que s'il a été **prouvé en le violant**, dans les deux sens : rouge avec, vert sans. |
| **Passe** | une étape de `pnpm content:check`. Il y en a **cinq** : 1 la syntaxe, 2 la forme d'un fichier, 3 les références, 4 les invariants globaux, 5 **le graphe de scénario** — la seule qui lise deux pièces ensemble. L'ordre est la garantie : une référence morte tombe en 3, jamais en 5, sinon le message enverrait le lecteur au mauvais endroit. |
| **Corpus doré** | une sortie de référence figée dans un fichier. Le test rejoue le calcul et compare octet à octet. Une référence ne se met jamais à jour toute seule. |
| **ADR** | un document court qui acte une décision et dit pourquoi. Dans `docs/adr/`, numérotés, à lire dans l'ordre. Une spécification ne se corrige jamais en silence. |

### Les quatre invariants

Tenus par du code, pas par de la discipline.

1. **Le moteur décide, l'IA raconte.**
2. **La mémoire vit dans la base**, jamais dans la fenêtre de contexte.
3. **Le serveur est l'autorité** ; le client n'envoie que des intentions.
4. **Tout est rejouable** depuis le journal, y compris du point de vue d'un seul joueur.

### Les dix paquets

| Paquet | Rôle |
|---|---|
| `@for/engine` | les règles. Pur : ni réseau, ni horloge, ni hasard ambiant. |
| `@for/contracts` | les formes de données partagées par tout le reste. |
| `@for/content` | le contenu versionné : champions, tables, régions. |
| `@for/testkit` | les outils qui rendent les tests reproductibles. |
| `@for/db` | la base et le journal. |
| `@for/ai` | le conteur : prompts, adaptateurs, garde-fous de style. |
| `@for/ai-eval` | la mesure de la qualité des sorties du conteur. |
| `@for/server` | l'autorité : HTTP, Discord, table en temps réel. |
| `@for/client` | ce que les joueurs voient. |
| `@for/sim` | joue des parties entières sans navigateur ni IA, pour tester. |
