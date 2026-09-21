# ADR 0004 — Le retour arrière d'image et les données

- **Statut** : proposé
- **Date** : 2026-09-21
- **Tâche d'origine** : M0-04 (image, composition, déploiement, sauvegardes)
- **À trancher avant** : M0-14

## Contexte

`docs/design/01-architecture.md` §9.3, point 5, décrit ce que fait le chemin d'échec du
déploiement :

> en cas d'echec : `infra/scripts/deploy.sh rollback` repointe sur le tag precedent,
> restaure la sauvegarde **seulement** si une migration a ete appliquee, et echoue le workflow.

`infra/scripts/deploy.sh` tel que livré en M0-04 fait la première et la troisième chose. Il ne
fait **pas** la deuxième : le retour arrière ne touche jamais aux données.

Cet écart n'avait été inscrit nulle part ailleurs que dans un commentaire d'en-tête du script.
C'était une correction silencieuse de la spécification, ce que les règles de travail interdisent
explicitement. Cet ADR est là pour le remonter à hauteur de décision.

## La raison technique du report

La condition « seulement si une migration a été appliquée » n'est pas implémentable aujourd'hui :
**rien ne permet de savoir qu'une migration a été appliquée.**

- il n'y a pas de table de migrations : le schéma arrive en M0-11, le moteur de migrations en
  M0-14 ;
- `deploy.sh` ne peut pas non plus le déduire de l'image : deux étiquettes successives peuvent
  très bien porter le même schéma ;
- le comparer à la sauvegarde pré-déploiement supposerait ouvrir la base pendant que le service
  écrit, ce que le runbook interdit par ailleurs (`backup-restore.md` §0).

Implémenter la condition maintenant reviendrait donc à choisir l'une des deux branches en dur.
Restaurer systématiquement « par précaution » est la pire des deux : cela effacerait toutes les
parties jouées depuis la dernière sauvegarde, à chaque retour arrière, y compris pour un retour
arrière dû à un `/readyz` rouge sans le moindre changement de schéma. Six heures de jeu perdues
(période de sauvegarde) pour corriger une erreur qui n'a pas touché aux données.

## Décision à prendre

Deux options, entre lesquelles ce projet doit trancher.

**Option A — le retour arrière ne touche jamais aux données.**
`deploy.sh rollback` repointe l'image, point. Une reprise de schéma est une opération manuelle,
avec `restore.sh` et quelqu'un qui a lu `docs/runbook/backup-restore.md`. La spécification §9.3
point 5 est amendée en conséquence.
Pour : aucune perte de données involontaire, un seul comportement à connaître le jour de la
panne. Contre : un retour arrière derrière une migration destructrice laisse un schéma neuf sous
un code ancien, et il faut un humain pour le voir.

**Option B — restauration conditionnelle, à partir de M0-14.**
Le moteur de migrations écrit, à chaque migration appliquée, une ligne horodatée dans une table
`schema_migrations`. `deploy.sh` compare l'horodatage de la dernière migration à celui de la
sauvegarde pré-déploiement : s'il est postérieur, une migration a été appliquée pendant ce
déploiement et le retour arrière restaure. La spécification est tenue telle qu'elle est écrite.
Pour : conforme à §9.3. Contre : le chemin le plus destructeur du système devient aussi le plus
rarement exercé — il ne se déclenche que dans un incident, c'est-à-dire jamais en répétition.
Il faudrait alors l'exercer explicitement dans l'exercice trimestriel de `backup-restore.md` §4.

## Ce qui est fait en attendant

`deploy.sh` implémente l'option A, et le dit en toutes lettres dans son en-tête, dans
`docs/runbook/deploy.md` §5 et ici. C'est un état provisoire, pas une décision.

Aucune des deux options n'est bloquante pour M0 : sans schéma (M0-11) et sans moteur de
migrations (M0-14), aucun déploiement ne peut appliquer de migration, donc la condition de §9.3
point 5 est vide de toute façon. L'ADR doit être tranché **avant M0-14**, parce que l'option B
impose une contrainte au moteur de migrations — la table horodatée — qu'il est bien moins cher
d'écrire dès le départ que d'ajouter après coup.

## Conséquences

- Si A : amender `docs/design/01-architecture.md` §9.3 point 5, et retirer la mention de report
  de l'en-tête de `deploy.sh`.
- Si B : M0-14 livre `schema_migrations` avec un horodatage, et M0-30 ajoute le chemin de
  restauration conditionnelle à `deploy.sh` plus un exercice dédié dans le runbook.
