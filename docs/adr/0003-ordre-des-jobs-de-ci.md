# ADR 0003 — `build` avant `deps` dans la chaîne d'intégration

Statut : **proposé** · Date : 21 septembre 2026 · Proposé par : M0-03 · Décideur : tech lead

> Numéro à confirmer : la vague 2 travaille en parallèle et M0-02 comme M0-04 peuvent
> proposer un ADR dans la même fenêtre. Si 0003 est déjà pris, renuméroter.

---

## Le problème

`docs/design/01-architecture.md` §8 ordonne les douze travaux ainsi : « Les jobs 2 à 5
tournent en parallèle après 1 ; 6 à 11 après 5 ; 12 après 6. » Le travail 5 est `deps`
(dependency-cruiser), le travail 12 est `build`. `deps` s'exécute donc sur un arbre où
aucun `dist/` n'existe.

ADR 0002, section ouverte, a mesuré ce que ça donne :

> Une violation d'arête par import de spécificateur nu est rapportée comme « dépendance
> orpheline » tant que les `dist/` n'existent pas, parce que les paquets de l'espace de
> travail se résolvent à travers eux. Le garde-fou tient — l'exécution échoue —, c'est le
> message qui trompe.

Le garde-fou n'est donc pas en danger. Ce qui est en danger, c'est son usage : un
développeur — humain ou agent — à qui l'on annonce « dépendance orpheline » cherche un
fichier oublié, pas une frontière de paquet franchie. Il corrigera la mauvaise chose, ou
ajoutera une exception à la mauvaise règle. Un diagnostic trompeur finit par être
contourné, et une frontière contournée ne sépare plus rien.

## La décision proposée

Une seule arête du graphe change :

|              | §8                            | Proposé                     |
| ------------ | ----------------------------- | --------------------------- |
| `build` (12) | après `test-unit` (6)         | après `install` (1)         |
| `deps` (5)   | après `install` (1)           | après `build`               |
| 6 à 11       | après `deps`                  | après `deps` — **inchangé** |
| 2, 3, 4      | après `install`, en parallèle | **inchangé**                |

Les douze travaux restent les douze travaux, tous bloquants, sous les mêmes identifiants.

## Pourquoi ce n'est pas un coût

- Turborepo enchaîne déjà `^build` avant `test` et avant `typecheck` (`turbo.json`) :
  construire les paquets n'est pas un travail supplémentaire, c'est un travail déplacé.
- Le cache Turborepo est indexé sur le SHA du commit. `build` le remplit ; `deps`
  relance `pnpm build`, obtient un succès de cache et récupère les `dist/` sans rien
  reconstruire. Sur un échec de cache, `deps` construit pour de vrai : correct dans les
  deux cas, seulement plus lent dans le second.
- Le chemin critique passe de trois travaux en série (`install → deps → test-unit`) à
  quatre (`install → build → deps → test-unit`). C'est le seul coût réel : un
  démarrage de runner. Le budget de huit minutes est mesuré à chaque PR (voir
  `docs/runbook/ci.md` §3) ; si l'arbitrage bascule, c'est cette mesure qui le dira.

## L'alternative écartée

Laisser `deps` avant `build` et lui faire construire les paquets dans une étape à lui,
sans `needs: build`. Ça marche, mais les deux travaux construisent alors en parallèle
sans se passer le cache : on paie la construction deux fois pour économiser un
démarrage de runner.

## Ce qu'on ne décide pas ici

La contradiction sur `@for/testkit` (§1.1 contre §1.2 règle 6), toujours ouverte dans
ADR 0002, reste ouverte : aucune règle `dependency-cruiser` ne couvre cette arête, et
l'ordre des travaux n'y change rien.

## Conséquence si le lead refuse

`deps` reste après `install` seul, et §8 est appliqué à la lettre. Il faut alors écrire
dans `docs/runbook/ci.md` que « dépendance orpheline » signifie, en CI, « arête de
paquet franchie » — un avertissement que personne ne lit au moment où il en aurait
besoin, mais c'est un choix défendable et il appartient au lead.
