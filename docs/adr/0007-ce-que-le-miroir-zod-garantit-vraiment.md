# ADR 0007 — Ce que `satisfies z.ZodType<T>` garantit vraiment, et ce qui garde le miroir

Statut : **acté** · Date : 24 septembre 2026 · Décideur : tech lead
Découvert par le développeur de M0-05, reproduit et étendu par son testeur.
Concerne tout paquet qui mirroite un type du moteur en schéma Zod — M0-05, M0-08, M0-09, M0-12.

## L'hypothèse qui était fausse

Toute la stratégie de contrats du projet reposait sur une phrase : « le miroir est garanti par
`satisfies z.ZodType<T>` ». Le compilateur devait refuser qu'un schéma diverge de son type.

Mesuré, il ne refuse presque rien.

| Divergence | Le compilateur la voit ? |
|---|---|
| Un champ **manquant** dans un objet mirroité | **oui** |
| Un champ **en trop** | non |
| Une **variante d'union absente** | non |
| Une **variante inventée** | non |
| Un **enum rétréci** côté schéma | non |

La cause de la dernière ligne, qui est la plus dangereuse : **`ZodType` est covariant en
sortie**. Un schéma qui n'accepte que `'roll'` reste parfaitement assignable à un type dont le
mode vaut `'roll' | 'gm_choice'`. Le miroir peut donc rétrécir en silence, et rien ne bronche.

## Comment ça s'est vu

Pas en relisant le code. Le testeur de M0-05 a réécrit `PAY_PRICE_MODES = ['roll', 'gm_choice']`
dans le moteur — la régression exacte que l'ADR 0006 existe pour interdire — puis a lancé les
quatre portes du dépôt : `typecheck` 0, `test` 0 sur dix-sept tâches, `lint` 0, `depcruise` 0.

Le test livré n'inspectait que la copie recopiée dans les contrats, jamais le tuple du moteur
qui porte l'invariant. Le commentaire de ce tuple dit pourtant lui-même : *« Keeping this tuple
at one member is what stops the effect executor from growing a second state-writing path. »*
C'était donc bien lui, et lui seul, qui n'était gardé par rien.

À noter, parce que c'est la bonne façon de travailler : le développeur avait **trouvé et publié
lui-même** une première instance du défaut, sur le catalogue des 71 événements. Il avait corrigé
son propre commentaire et remonté la mesure. Il l'avait simplement refermée pour deux unions
sur trois.

## La règle, à partir de maintenant

**Un miroir n'est garanti que par un test d'exécution qui compare les deux listes membre à
membre.** Le `satisfies` reste utile — il attrape les champs manquants, ce qui n'est pas rien —
mais il ne se substitue jamais à ce test.

**Précision ajoutée le 24 septembre**, parce que la première formulation a été lue trop
étroitement et a coûté une passe : « toute constante » veut dire **les tuples `as const`, les
scalaires ET les Records**. Un nombre recopié est *pire* qu'un enum recopié — un enum garde au
moins la paire `satisfies` + `AssertNever` à la compilation, alors que le compilateur ne voit
dans un nombre qu'un `number`. Mesuré : `ATTRIBUTE_MAX` porté de 3 à 4 dans le moteur, plus
`CLOCK_ADVANCE_MAX` et `ACTION_SCORE_CAP`, reconstruction complète — les quatre portes restent
vertes et les recopies des contrats disent toujours les anciennes valeurs.

La règle opératoire, pour ne pas avoir à juger au cas par cas : **énumérer le barrel de
`@for/engine` en entier**, et justifier par écrit chaque constante exportée qu'on décide de ne
pas comparer. Le tri « les importantes » n'est pas un critère.

Concrètement : toute constante du moteur qui porte un invariant figure dans le `it.each` de
`packages/contracts/tests/exhaustive-union.test.ts`, qui porte déjà ce motif pour neuf enums.
Ce fichier importe des **valeurs** du moteur, et il en a le droit : il est hors du `from` de la
règle `dependency-cruiser` et exclu du cruise par `exclude: { path: '(coverage|\.test\.ts$)' }`.
Ce n'était pas une impossibilité technique, c'était un oubli.

## Le corollaire, ajouté le 25 septembre : aucun chiffre ne se compare à lui-même

Un test qui **borne avec la constante qu'il vérifie** est inerte, exactement comme une recopie
non comparée. Il passe toujours, et il ne prouve rien.

Mesuré sur M0-12 : deux plafonds — celui de la chronique, celui de la prose — étaient vérifiés
par un test qui lisait la constante puis comparait la constante à elle-même. Verts, et
parfaitement vides.

La règle opératoire :

| D'où vient le chiffre | Comment il se teste |
|---|---|
| d'un critère d'acceptation | écrit **en toutes lettres** dans le test |
| du moteur | comparé **au moteur**, valeur contre valeur |
| de nulle part ailleurs | il ne se compare pas à lui-même |

Même famille que la covariance : dans les deux cas, le test a l'air de garder quelque chose et
ne garde rien. C'est le cinquième mode de « règle présente et inerte » trouvé sur ce projet, et
le premier qui ne vient ni d'une configuration ni d'une propriété du langage, mais d'une manière
d'écrire un test.

Et la preuve se fait **dans les deux sens** : rouge quand on élargit la source canonique, vert
quand on la remet. Prouver que le test existe ne vaut rien.

## Pourquoi cet ADR existe plutôt qu'une simple correction

Parce que M0-08, M0-09 et M0-12 vont toutes écrire des miroirs, et qu'elles l'auraient fait sous
l'hypothèse qu'on vient de démentir. Une erreur d'hypothèse partagée ne se corrige pas dans le
fichier où on l'a trouvée.

C'est le quatrième cas de **règle présente et inerte** du projet, et le plus instructif : les
trois premiers venaient d'une configuration mal branchée. Celui-ci vient d'une propriété du
langage que personne n'avait vérifiée.
