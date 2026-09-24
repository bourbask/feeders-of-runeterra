# Glossaire

Ce document existe parce que la documentation du projet est devenue lisible pour ceux qui
l'écrivent et opaque pour tous les autres. Il se lit sans rien connaître du code.

Deux parties : **les mots du jeu**, qu'un joueur rencontre à table, et **les mots du code**,
qu'on croise dans les spécifications. Si un terme vous arrête quelque part et qu'il n'est pas
ici, c'est un défaut de ce fichier — signalez-le.

---

## Première partie — les mots du jeu

### Les trois jauges

Chaque personnage porte trois compteurs, chacun de **0 à 5**. C'est tout ce qui le décrit en
termes de santé et de ressources.

| Jauge | Ce qu'elle mesure | Ce que 0 veut dire |
|---|---|---|
| **Vigueur** | l'état du corps | tu es au bout, physiquement |
| **Âme** | la volonté, le moral | tu es brisé, tu ne veux plus |
| **Vivres** | ce qu'il reste à manger et à brûler | la faim et le froid gagnent |

Il n'y a pas de « points de vie ». Une jauge ne descend jamais toute seule : elle descend parce
qu'un mouvement a coûté quelque chose, et le moteur l'applique avant que le conteur ne raconte.

### Le Souffle

Une quatrième valeur, à part, qui va de **−6 à +10** et commence à +2. C'est l'élan : il monte
quand les choses vont bien, il descend quand elles vont mal.

Deux usages :

- **le brûler** — si ton Souffle est supérieur au résultat de ton jet, tu peux le dépenser pour
  remplacer ce résultat. Il retombe alors à +2. C'est la ressource qui transforme un échec en
  réussite, une fois.
- **quand il est négatif**, il te sabote : si ton dé d'action tombe sur la valeur absolue de ton
  Souffle négatif, ce dé est annulé.

### Les cinq attributs

`vif` (vitesse et précision) · `cœur` (volonté, lien, charisme) · `fer` (force et endurance) ·
`ombre` (ruse et discrétion) · `esprit` (perception, savoir, magie).

Chacun vaut **1, 2 ou 3**, et la répartition à la création est toujours la même : **3, 2, 2, 1, 1**.
Pas de progression de niveau : un personnage ne devient pas meilleur, il devient différent.

### Le jet de défi

La mécanique centrale, héritée d'Ironsworn. On lance **un dé à six faces** (le *dé d'action*),
on y ajoute un attribut et d'éventuels bonus, et on compare le total à **deux dés à dix faces**
(les *dés de défi*).

| Résultat | Nom | Ce que ça veut dire |
|---|---|---|
| bat les deux | **réussite franche** | ça marche |
| bat un seul | **réussite partielle** | ça marche, mais ça coûte |
| n'en bat aucun | **échec** | ça ne marche pas, ou pas comme prévu |

Si les deux dés de défi affichent la même valeur, c'est un **présage** : un retournement
s'ajoute au résultat, quel qu'il soit.

### Les mouvements

Les onze actions codifiées du jeu. On ne lance pas les dés « pour voir » : on déclare un
mouvement, et c'est lui qui dit ce qui arrive à chaque résultat.

*Affronter le danger · Assurer un avantage · Rassembler des informations · Sonder une âme ·
Frapper · Encaisser · Endurer le froid · Jurer un serment · Accomplir son serment ·
Atteindre un jalon · Renier son serment.*

### Payer le prix

Quand ça tourne mal, le moteur **tire sur une table** de douze conséquences et transmet celle
qui sort comme un fait imposé. Ni le conteur ni le joueur ne choisit sa propre punition — c'est
une décision d'architecture, pas une sévérité gratuite (voir l'ADR 0006).

### Les jauges de progression

Un serment, un affrontement ou un voyage n'a pas de points de vie : il a une **jauge de
progression** de dix cases. Chaque case vaut quatre crans, et la vitesse de remplissage dépend
du **rang** de l'objectif :

| Rang | Crans gagnés par jalon |
|---|---|
| Gênant | 12 |
| Dangereux | 8 |
| Redoutable | 4 |
| Extrême | 2 |
| Épique | 1 |

Un serment épique se gagne donc très lentement — c'est exactement l'intention.

### Le serment (ou vœu)

Ce sur quoi ton personnage engage sa parole. C'est la colonne vertébrale d'une campagne :
tu jures, tu progresses par jalons, et un jour tu jettes les dés pour savoir si tu l'accomplis.

### L'horloge

Une jauge d'une autre nature : elle mesure ce que **le monde** fait pendant que tu agis. « La
colonne de la Griffe d'Hiver atteint le col » avance qu'on s'en occupe ou non. C'est ce qui
donne au temps un poids.

### L'oracle

Le mécanisme qui remplace le maître de jeu quand il faut trancher une question que personne
n'a prévue. Deux formes : une **question fermée** pondérée par la probabilité (« presque
certain », « peu probable »…), et des **tables évocatrices** qui donnent des lieux, des noms,
des complications.

### Le conteur

Le modèle de langage qui écrit les scènes. Il **ne décide de rien** : les dés et le moteur ont
déjà tranché quand il commence à écrire. Il habille un résultat acquis.

### Le trait, et la portée

Un **trait** est ce que ta fiche établit et qui s'applique toujours, sans jet : une langue, une
origine, un métier. Un elfe comprend l'elfe sans avoir à le demander.

Une **portée** dit qui voit une information : `table` (tout le monde), `subset` (un groupe qui
s'est séparé), `private` (toi seul).

---

## Seconde partie — les mots du code

### `c2s` et `s2c`

Client to server, et server to client. Ce sont des **préfixes de nom de message**, pas des
objets.

Voilà ce qui circule réellement sur le fil :

```jsonc
// du client vers le serveur
{ "v": 1, "t": "c2s.intent", "id": "<uuid>", "p": { "intent": { … } } }

// du serveur vers le client
{ "v": 1, "t": "s2c.event", "id": "<uuid>", "ts": 1758…, "seq": 412, "p": { … } }
```

- **`t`** est le type du message. `c2s.intent` est donc une **valeur de `t`** — un nom — et non
  un chemin de propriété. L'intention elle-même vit dans `p.intent`.
- **`v`** est la version du protocole. Si elle ne correspond pas, la connexion se ferme.
- **`id`** est une clé d'**idempotence** : renvoyer deux fois le même `id` rend le même résultat
  sans rejouer l'action. C'est ce qui rend une reconnexion sans danger.
- **`p`** est la charge utile, et son contenu dépend de `t`.
- **`seq`** n'existe que dans le sens serveur → client : c'est un numéro qui ne recule jamais,
  la seule horloge logique du système.

Il existe **huit** messages du client vers le serveur. Un seul modifie quoi que ce soit :
`c2s.intent`. Les autres ouvrent la session, rattrapent ce qu'on a manqué, ou demandent une
lecture.

### Intention

Ce que le client a le droit d'envoyer : **une envie**, jamais un résultat. « Je tente de
convaincre Hjalmar » est une intention. « J'ai réussi » n'en est pas une, et aucun message ne
permet de le dire. C'est l'invariant 3 : le serveur est l'autorité.

### Événement

Ce que le serveur écrit dans le journal une fois qu'il a tranché. Un événement est **définitif
et jamais modifié** : on en ajoute, on n'en corrige pas. Rejouer tous les événements d'une
campagne depuis le début redonne exactement son état — c'est l'invariant 4, et c'est ce qui
permet de reconstruire, de déboguer et d'annuler.

Il en existe soixante et onze types.

### Projection

Un raccourci calculé à partir des événements, pour ne pas avoir à tout rejouer à chaque
affichage. Une projection est **jetable** : si elle diverge, on l'efface et on la reconstruit
depuis le journal, qui, lui, fait foi.

### Instantané (*snapshot*)

Une photo de l'état à un moment donné, gardée pour éviter de rejouer dix mille événements au
chargement. Même statut qu'une projection : une commodité, jamais une source de vérité.

### Chronique

Un résumé compacté de ce qui s'est passé dans la campagne, régénéré périodiquement. Il existe
parce qu'un modèle de langage ne peut pas lire six mois de journal à chaque scène. C'est la
mémoire longue du conteur.

### Miroir

Les règles du jeu sont écrites une fois dans le moteur, et **recopiées** en schémas de
validation dans les contrats. Cette recopie est un miroir, et un miroir peut diverger en
silence : c'est arrivé, et l'ADR 0007 raconte comment. D'où la règle — tout miroir est vérifié
par un test qui compare les deux listes membre à membre.

### Garde-fou

Tout ce qui **échoue** quand quelqu'un enfreint une règle du projet : une règle de lint, un
test, une vérification de dépendances. Sur ce projet, un garde-fou n'est considéré comme
existant que s'il a été **prouvé en le violant** — et dans les deux sens : il doit échouer avec,
et passer sans. Trois garde-fous ont été trouvés déclarés mais inertes ; c'est le mode d'échec
numéro un ici.

### Corpus doré (*golden*)

Une sortie de référence, figée dans un fichier. Le test rejoue le calcul et compare octet à
octet. Quand la comparaison échoue, ou bien le code a régressé, ou bien la référence doit être
mise à jour sciemment — jamais automatiquement.

### ADR

*Architecture Decision Record.* Un document court qui acte une décision et **dit pourquoi**.
Ils vivent dans `docs/adr/` et se lisent dans l'ordre. La règle du projet : une spécification ne
se corrige jamais en silence — on écrit un ADR, on le date, et on assume.

### Les quatre invariants

Les règles qui ne se discutent pas. Chacune est tenue par du code, pas par de la discipline :

1. **Le moteur décide, l'IA raconte.**
2. **La mémoire vit dans la base**, jamais dans la fenêtre de contexte.
3. **Le serveur est l'autorité** ; le client n'envoie que des intentions.
4. **Tout est rejouable** depuis le journal, y compris du point de vue d'un seul joueur.

---

## Les paquets, en une phrase chacun

| Paquet | Ce qu'il fait |
|---|---|
| `@for/engine` | les règles du jeu. Pur : ni réseau, ni horloge, ni hasard ambiant |
| `@for/contracts` | les formes de données partagées par tout le reste |
| `@for/content` | le contenu versionné : champions, tables, régions |
| `@for/testkit` | les outils qui rendent les tests reproductibles |
| `@for/db` | la base et le journal d'événements |
| `@for/ai` | le conteur : prompts, adaptateurs, garde-fous de style |
| `@for/ai-eval` | la mesure de la qualité des sorties du conteur |
| `@for/server` | l'autorité : HTTP, connexion Discord, table en temps réel |
| `@for/client` | ce que les joueurs voient |
| `@for/sim` | joue des parties entières sans navigateur et sans IA, pour tester |
