# La batterie de sondes standard

Ce que **tout développeur exécute sur son propre travail** avant d'ouvrir sa PR, et ce que le
testeur refait ensuite sans le croire sur parole.

Elle existe parce que les recalages se ressemblent tous : sur trois vagues, la moitié des retours
portaient sur l'un des sept modes ci-dessous, jamais sur la conception. Vingt minutes ici
suppriment un cycle entier.

> **La règle qui gouverne tout le reste.** Un garde-fou se prouve **en le violant, dans les deux
> sens** : rouge AVEC la violation, vert SANS. Montrer qu'un test existe ne vaut rien.

---

## 1. Mesurer sans se faire mentir

| Avant toute mesure | Pourquoi |
|---|---|
| `rm -rf packages/*/dist packages/*/*.tsbuildinfo .turbo packages/*/.turbo` | sinon l'aval lit un `dist/` périmé |
| `tsc -b --force` après toute sonde qui touche `@for/engine` | idem, en pire : le garde-fou semble mordre alors qu'il ne mord pas |
| `--force` sur chaque tâche turbo | sans lui, turbo rejoue les journaux d'un **autre** worktree |

## 2. Les sept modes, et la sonde qui les attrape

| # | Le mode | La sonde |
|---|---|---|
| 1 | une règle de lint sans résolveur, donc muette | écrire la violation qu'elle interdit, exiger le rouge |
| 2 | un `exclude` de configuration qui tue les arêtes qu'il prétend vérifier | violer **depuis** et **vers** le paquet exclu |
| 3 | un seuil qu'aucune commande contractuelle n'atteint | lancer la commande de la fiche, pas une variante |
| 4 | `satisfies z.ZodType<T>` : covariant en sortie, laisse un enum **rétrécir** en silence | retirer un membre du tuple moteur, exiger un test d'exécution rouge |
| 5 | un chiffre comparé à lui-même | remonter chaque opérande à sa définition : deux chemins, ou rien |
| 6 | une liste qui est sa propre source de boucle | **la vider**. Si rien ne tombe, elle ne garde rien |
| 7 | une fixture déjà triée, ou à un seul élément, là où le critère parle d'ordre | fournir au moins **deux** entrées, dans un ordre **non naturel**, et asserter le **tableau exact** |
| 8 | un **double de test plus laxiste que l'interface** qu'il remplace | comparer la signature du faux à celle du vrai : TypeScript accepte une fonction qui prend **moins** de paramètres, donc un argument que le faux ignore devient invisible aux tests |

## 3. Les six questions à se poser sur chaque assertion écrite

1. D'où vient **chaque** opérande ? S'ils remontent à la même définition, l'assertion est vide.
2. Ce chiffre vient d'un **critère d'acceptation** ? Il s'écrit en toutes lettres. Du **moteur** ?
   Il se compare au moteur.
3. Cette liste est-elle **parcourue** au lieu d'être **épinglée** ? La vider doit faire tomber
   quelque chose.
4. Cette fixture a-t-elle **assez d'éléments** pour que l'ordre veuille dire quelque chose ?
5. Ce commentaire décrit-il ce que le test **fait**, ou ce qu'on **aimerait** qu'il garde ? Un
   commentaire qui promet une garantie inexistante est pire qu'une absence.
6. Mon test rougit-il quand je casse **le code**, ou seulement quand je casse **le test** ?
7. Mon **faux** reçoit-il tout ce que le vrai reçoit ? Un `FakeService` déclaré avec un paramètre
   de moins compile sans un mot — et l'argument manquant cesse d'exister pour toute la suite.
   Mesuré : `viewerId` et `playerId` remplacés par une chaîne vide, **153 tests verts**.

## 4. Les portes, toutes

```
turbo run build typecheck lint test --force        # le dépôt entier
turbo run typecheck:tests --force                  # SÉPARÉMENT — job 4 de la CI
pnpm run depcruise check:workspace format:check
pnpm run content:check test:golden
```

**`pnpm typecheck` ne regarde pas les fichiers de test.** Ce sont deux tâches turbo distinctes.
Une PR a déjà été déclarée recevable avec la CI rouge pour cette seule raison.

## 5. Lire la CI sans se tromper

| Ce qu'on voit | Ce que ça veut dire |
|---|---|
| douze jobs verts | les jobs **8 à 11** portent un `continue-on-error` : ils restent verts **en échouant** |
| aucun échec | peut vouloir dire **aucun job** : une PR en conflit n'a pas de CI du tout |

Donc : **compter les check-runs sur le sha de tête**, et regarder les conclusions d'étapes.
`gh pr view <n> --json headRefOid,statusCheckRollup` — un tableau vide n'est pas un succès.

## 5 bis. Ce que les sondes ne trouveront pas

Les sept premiers modes se cherchent. Les défauts trouvés en vague 7 ne se cherchaient pas — ils se
sont vus autrement :

| Trouvé par | Ce que c'était |
|---|---|
| le **rapport de couverture**, fichier par fichier | le seul fichier qui appelait vraiment Discord, à 44 % — quatre mutations, aucun test rouge |
| la **signature du double de test** | `viewerId` absent du faux : la moitié lecture de l'ADR 0008 n'était prouvée par rien |
| **deux acteurs au lieu d'un** | la fenêtre de brûlure cherchée globalement : à deux joueurs, un tour disparaît en silence |
| **deux instants au lieu d'un** | l'état lu avant l'`await`, le curseur après : un événement compté mais jamais envoyé |

La question n'est donc pas seulement « ai-je un garde-fou inerte ? », c'est **« qu'est-ce que je
n'ai pas regardé ? »**. Ouvrir la couverture du plus bas au plus haut, et rejouer le scénario à
deux joueurs, à deux instants, à deux destinataires.

## 6. Avant de committer

- l'arbre est propre : `git status` vide, dans ton worktree **et** dans le dépôt principal ;
- aucune sonde n'est restée en place (restaure **par copie de fichier**, pas par `git checkout` —
  il a déjà effacé une correction non commitée) ;
- aucun secret : le dépôt est **public**. `git check-ignore` sur `.env` et le fichier SQLite ;
- `git -C <ton worktree>` et des chemins explicites. **Jamais** un `reset --hard` enchaîné
  derrière un `checkout` : une branche prise par un autre worktree fait échouer le `checkout`, et
  un `| tail` transforme l'échec en succès. Ça a déjà coûté un pointeur de branche.

## 7. Ce qu'on écrit dans le compte rendu

Pour chaque garde-fou annoncé : **la violation, la commande, le code de sortie, le test qui tombe.**
Puis la restauration et le vert.

Un critère **faux par construction** se **signale**, il ne se contourne pas. Un prédécesseur a été
félicité pour l'avoir fait ; un autre recalé pour l'avoir maquillé.
