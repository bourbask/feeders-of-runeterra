# ADR 0008 — Qui voit quoi : portée de visibilité et modèle de perception

Statut : **acté** · Date : 24 septembre 2026 · Décideurs : le porteur du projet et Théo, avec le tech lead
Origine : séance de conception du 23 septembre avec Théo, joueur de jeu de rôle expérimenté.

## Le problème que le modèle actuel ne sait pas traiter

Tout le modèle suppose **un journal partagé et une scène commune** : tout le monde voit tout.
Ça tient tant que la bande reste groupée. Le jour où trois joueurs partent en éclaireur pendant
que deux gardent le camp, plus rien ne tient.

Ironsworn ne nous aide pas ici, et ce n'est pas un oubli de sa part : son mode coopératif
suppose une bande qui agit ensemble. C'est un trou réel, et il touche trois choses à la fois —
l'enveloppe d'événement, le protocole, et l'invariant 4.

## Décision 1 — le minimum entre en M0, le reste en M1

**Ce qui entre maintenant**, avant que M0-08 ne gèle le protocole :

- une **portée de visibilité sur l'enveloppe d'événement**, pas sur les 71 charges utiles :
  `{ scope: 'table' | 'subset' | 'private', recipients?: PlayerId[] }` ;
- la **diffusion adressée** dans le protocole : le serveur décide qui reçoit quoi, le client
  ne filtre rien (invariant 3 — un filtrage côté client n'est pas une confidentialité, c'est
  une suggestion) ;
- la rejouabilité **par destinataire** : rejouer le journal du point de vue d'un joueur doit
  redonner exactement ce qu'il a vu, ni plus ni moins. C'est ce qui rend l'invariant 4 encore
  vrai quand les entrées ont des destinataires différents.

**Ce qui attend M1** : le tchat par joueur en plus du tchat global, le drapeau « j'agis
discrètement » qui décide de la portée, et le rendu d'une scène par groupe quand la bande se
sépare.

Motif du découpage : ajouter un champ à l'enveloppe aujourd'hui coûte une ligne. L'ajouter
quand des campagnes tournent coûte une migration de journal, sur la donnée la plus précieuse
du produit.

**Conséquence à connaître, côté coût** : une bande séparée en deux groupes, c'est deux
narrations au lieu d'une pour le même tour. Le conteur écrit une scène par portée, pas une
scène tronquée. Acceptable — et c'est un argument de plus pour le port narrateur de l'ADR 0002,
qui permet de choisir un fournisseur selon le prix.

## Décision 2 — les traits sont passifs, les découvertes se gagnent

Deux questions n'en faisaient qu'une : l'elfe qui parle elfe sans qu'on le lui demande, et le
personnage qui ne doit pas apprendre ce qu'il n'a pas perçu.

**Ce qui découle du personnage est automatique et sans jet.** Les traits — langues, origine,
métier, ce que la fiche établit — arrivent dans le contexte du conteur et s'appliquent
toujours. Un joueur n'a jamais à déclarer qu'il comprend sa propre langue.

**Tout le reste se gagne par un mouvement.** Il n'existe pas de score de perception passive, et
donc aucun jet caché dont personne ne voit passer le résultat. Ce qui se trame derrière la
porte s'obtient par *Rassembler des informations* ou *Assurer un avantage*.

Options écartées, et pourquoi : une perception chiffrée à la D&D aurait été familière, mais elle
ajoute un nombre par fiche et des jets que le joueur ne voit pas — mal adapté à une table sans
MJ humain, où personne n'est là pour arbitrer le secret. Le dépouillement total à la Ironsworn
aurait obligé à déclarer qu'on écoute aux portes même pour comprendre ce qu'on entend.

## Décision 3 — le conteur ne peut écrire que ce que le destinataire perçoit

C'est la mise en garde de Théo, et elle est décisive : *« ne pas détailler trop ce qu'il se
passe, sinon inutile d'avoir une perception par perso »*. Si le narrateur décrit tout, la
perception devient décorative.

Donc ce n'est **pas une consigne de style**, c'est mécanique. Le moteur calcule, pour chaque
destinataire, la liste des faits perceptibles, et le conteur n'a le droit d'utiliser que
celle-là. C'est le mécanisme des faits de scène déjà validé au prototype, avec un filtre par
joueur devant.

Une assertion d'éval en découle, à écrire avec le reste du corpus : une narration qui mentionne
un fait absent de la liste fournie au destinataire échoue.

## Ce que ça change, et pour qui

- **M0-05** (contrats d'événements) : la portée rejoint l'enveloppe. Petit, mais à faire avant
  fusion — c'est une tâche dédiée, séparée du cycle de correction en cours pour ne pas le
  brouiller.
- **M0-08** (protocole) : la diffusion devient adressée. À cadrer avant que le protocole gèle.
- **M0-16** (contenu) : les fiches de champion portent des **traits**.
- **M0-18 / M0-22** (couche IA) : le contexte est construit **par destinataire**, et l'assertion
  correspondante rejoint le corpus.
- **M1** : tchat par joueur, drapeau de discrétion, rendu par groupe.

## Ce qui reste ouvert, et qui n'est pas de cet ADR

L'inventaire vivant sur les côtés de la table, le partage d'objets, la carte annotable et le
carnet de notes libre sont des fonctionnalités de M1. Elles reposent toutes sur la même
primitive de transfert — consultable, divisible, indivisible — et sur une liste de
destinataires, c'est-à-dire exactement sur la décision 1. Elles seront spécifiées en leur temps ;
rien de ce qui est décidé ici ne les contraint autrement que par cette liste.
