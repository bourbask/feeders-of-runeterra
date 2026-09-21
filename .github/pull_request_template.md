# <!-- M0-XX · titre de la fiche -->

## Ce que ça fait, et pourquoi

<!-- Le pourquoi, pas la liste des fichiers : le diff dit déjà quels fichiers ont bougé. -->

## Critères d'acceptation

<!-- Un critère par ligne, la commande réellement lancée, le code de sortie réellement obtenu.
     Aucun code de sortie déduit. -->

| Critère | Commande | Attendu | Obtenu |
| ------- | -------- | ------- | ------ |
|         |          |         |        |

## Garde-fous prouvés en les violant

<!-- Un garde-fou non prouvé est considéré comme absent. Pour chacun : la violation écrite,
     ce qui a échoué, et le retour à l'état initial. -->

| Garde-fou | Violation écrite | Résultat |
| --------- | ---------------- | -------- |
|           |                  |          |

## Écarts par rapport à la spécification

<!-- Une correction silencieuse de spécification est le pire défaut possible ici.
     Si la spec est fausse, contradictoire ou impossible : le dire, et proposer un ADR. -->

- [ ] Aucun écart, ou chaque écart est listé ci-dessous avec sa justification.

## Cases à cocher

- [ ] `pnpm verify` a été lancée, et les échecs restants sont ceux de commandes dont la
      cible n'est pas encore livrée (elles annoncent elles-mêmes la tâche qui les remplira).
- [ ] `pnpm format` a été lancée, et `git status` ne montre aucune modification dans `docs/`.
- [ ] **Un fichier doré modifié est justifié dans le message de commit** — ou aucun corpus
      doré n'a bougé.
- [ ] Aucun document de `docs/design/` ni `docs/ARCHITECTURE.md` n'a été modifié.
- [ ] Interface, contenu de jeu et documentation en français ; code, identifiants et
      commentaires en anglais.
- [ ] Les quatre invariants tiennent : le moteur décide et l'IA raconte, la mémoire est
      dans la base, le serveur est l'autorité, tout état de partie est rejouable.
