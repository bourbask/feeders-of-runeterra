# ADR 0003 — `build` avant `deps` dans la chaîne d'intégration

Statut : **accepté** · Date : 21 septembre 2026 · Proposé par : M0-03 · Décideur : tech lead

> Numéro arbitré : M0-03 garde 0003, M0-04 prend 0004 s'il lui en faut un, le lead
> écrit 0005 (tsup) et 0006 (EffectSchema). Plus rien à renuméroter.
>
> Le principe — `deps` après `build` — est acté. L'argumentaire de coût de la première
> version était faux : il s'appuyait sur un mécanisme de cache qui ne pouvait pas
> fonctionner tel qu'écrit. La section « Pourquoi ce n'est pas un coût » a été refaite
> à partir des mesures, et le mécanisme a été corrigé dans l'action de préparation.

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
- `deps` relance `pnpm build` et obtient un succès de cache : il récupère les `dist/`
  sans rien reconstruire. Cela suppose que le cache Turborepo contienne les sorties de
  `build` — ce que la première version de cet ADR affirmait sans que le mécanisme le
  garantisse. Voir la section suivante.
- Le chemin critique passe de trois travaux en série (`install → deps → test-unit`) à
  quatre (`install → build → deps → test-unit`). C'est le seul coût réel : un
  démarrage de runner. Mesuré sur la série 1 de la PR #3 : `install` 16 s, `build`
  18 s, `deps` 14 s, `test-unit` 17 s — le travail ajouté en série coûte une vingtaine
  de secondes sur un budget de huit minutes. Le budget est remesuré à chaque PR (voir
  `docs/runbook/ci.md` §3) ; si l'arbitrage bascule, c'est cette mesure qui le dira.

## Le mécanisme de cache, corrigé après mesure

La première version de cet ADR écrivait : « le cache Turborepo est indexé sur le SHA du
commit, `build` le remplit, `deps` le retrouve ». Les douze travaux partageaient alors
une clé unique, `turbo-${{ runner.os }}-${{ github.sha }}`. C'était une course, pas un
mécanisme :

- `pnpm lint` (`turbo run lint`, sans `dependsOn: ^build` dans `turbo.json`) remplit
  `.turbo/cache` et ne produit **aucun** `dist/` ;
- `lint` et `build` démarrent tous deux juste après `install`. Le premier arrivé
  réserve la clé, le second reçoit un refus et ne sauvegarde rien ;
- sur la série 1 de la PR #3, c'est `build` qui a réservé la clé, et le journal de
  `lint` porte `Failed to save: Unable to reserve cache with key turbo-Linux-<sha>,
  another job may be creating this cache`. Le résultat était bon ; l'ordre d'arrivée
  ne l'était que par chance.

Le jour où `lint` finit avant `build`, `deps` restaure un cache sans `dist/` et
reconstruit pour de vrai. La construction reste correcte — c'est le chiffrage qui
devient faux, et un ADR dont le motif chiffré est faux ne motive plus rien.

Correction : **un seul travail écrit le cache**. `build` passe `turbo-cache: write` à
`.github/actions/setup-node-pnpm` et obtient une étape `actions/cache` complète ; les
onze autres travaux n'ont qu'un `actions/cache/restore`, sans sauvegarde, donc sans
réservation de clé. La clé le nomme : `turbo-build-${{ runner.os }}-${{ github.sha }}`.
`deps` dépend de `build`, donc la clé exacte existe déjà quand il la demande.

Ce qui reste vrai des trois autres travaux en parallèle de `build` (`format`, `lint`,
`typecheck`) : ils ne trouvent que le repli par préfixe, ou rien. Ils n'ont pas de
`dist/` à y gagner, et ils ne peuvent plus polluer ce que `deps` restaurera.

## L'alternative écartée

Laisser `deps` avant `build` et lui faire construire les paquets dans une étape à lui,
sans `needs: build`. Ça marche, mais les deux travaux construisent alors en parallèle
sans se passer le cache : on paie la construction deux fois pour économiser un
démarrage de runner.

## Ce qu'on ne décide pas ici

La contradiction sur `@for/testkit` (§1.1 contre §1.2 règle 6), toujours ouverte dans
ADR 0002, reste ouverte : aucune règle `dependency-cruiser` ne couvre cette arête, et
l'ordre des travaux n'y change rien.

## Conséquence si le lead avait refusé

`deps` serait resté après `install` seul, et §8 appliqué à la lettre. Il aurait fallu
écrire dans `docs/runbook/ci.md` que « dépendance orpheline » signifie, en CI, « arête
de paquet franchie » — un avertissement que personne ne lit au moment où il en aurait
besoin. Le lead a tranché dans l'autre sens ; ce paragraphe reste pour mémoire.
