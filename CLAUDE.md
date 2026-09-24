# Feeders of Runeterra — instructions de travail

Une table de jeu de rôle multijoueur au Freljord, avec un maître de jeu tenu par une IA.
Le vocal reste sur Discord.

**À lire en premier :** `docs/ARCHITECTURE.md`. Puis la spec de détail qui concerne ta tâche,
et ta fiche dans `docs/M0-TASKS.md`.

## Les quatre invariants

Ils ne se discutent pas, et chacun est tenu par une frontière de code ou un test nommé — pas
par de la discipline.

1. **Le moteur décide, l'IA raconte.** Aucun outil exposé au modèle ne modifie une jauge, ne
   tranche une réussite ni ne décide d'une mutation d'état, même indirectement. Le résultat est
   calculé par `@for/engine` **avant** l'appel au modèle et lui est transmis comme un fait acquis
   à habiller. Si tu te surprends à donner au modèle un paramètre que le moteur convertira
   ensuite en coût, tu es en train de violer cet invariant par la porte de derrière.
2. **La mémoire vit dans la base**, jamais dans la fenêtre de contexte. État structuré plus une
   chronique compactée.
3. **Le serveur est l'autorité.** Le client n'envoie que des intentions.
4. **Tout état de partie est rejouable** depuis un journal d'événements en ajout seul. Depuis
   l'ADR 0008, les entrées portent une **portée de visibilité** : rejouer le journal du point de
   vue d'un joueur doit redonner exactement ce qu'il a vu, ni plus ni moins.

## Frontières mécaniques

- `@for/engine` est **pur**. Son `tsconfig` ne lui donne aucun typage ambiant (`types: []`), donc
  `import { readFileSync } from 'node:fs'` est une **erreur de compilation** (`TS2307`). Attention
  à la portée exacte de cette garantie : l'import à effet de bord nu, `import 'node:fs';`, compile
  sans broncher — c'est le lint qui l'attrape, pas le compilateur. Les deux filets sont là, mais
  ils n'ont pas la même maille. Ni horloge ni hasard ambiants non plus : `new Date()` et
  `Math.random()` sont interdits par le lint, dans le moteur comme dans `server/src/game`.
  Ce dont tu as besoin arrive par un paramètre.
- Le graphe de dépendances entre paquets est vérifié par `pnpm depcruise`, pas par la bonne volonté.
- **`satisfies z.ZodType<T>` ne garde pas le miroir.** Il attrape un champ manquant, et c'est
  tout : ni un champ en trop, ni une variante d'union absente ou inventée, ni un enum rétréci
  côté schéma — `ZodType` est covariant en sortie. Un miroir n'est garanti que par un test
  d'exécution qui compare les deux listes membre à membre (`exhaustive-union.test.ts`).
  Mesuré, pas supposé : ADR 0007.
- Les assertions de style du conteur vivent dans `@for/ai`, jamais dans `@for/ai-eval` : elles
  servent à la fois d'eval et de post-filtre de production.

## Les commandes du quotidien

```
pnpm verify          # la porte de merge locale : si elle passe, la CI passe
pnpm test            # tous les paquets
pnpm typecheck
pnpm lint
pnpm format          # avant de committer
pnpm check:workspace # cohérence des package.json et de la liste contractuelle de commandes
pnpm db:reset        # base locale remise à zéro puis réamorcée
pnpm sim run <scénario>
```

`pnpm verify` **n'a pas à être verte avant la fin de M0** : la porte se ferme progressivement,
tâche après tâche, et c'est M0-30 qui la referme entièrement. Ne cherche pas à rendre vertes des
commandes dont la cible n'est pas encore livrée — elles t'annoncent d'elles-mêmes quelle tâche
les remplira.

## Conventions

- Interface, contenu de jeu et documentation : **en français**. Code, identifiants et
  commentaires : **en anglais**.
- Un export par défaut n'est admis que dans les `.tsx` et les fichiers de configuration.
- Les imports de type sont explicites (`import type`).
- Pas de `console.log` dans `engine`, `contracts`, `content` ni `client`.
- Les tests vivent à côté de ce qu'ils testent, en `*.test.ts`.

## Git

Une tâche, une branche, une PR vers `develop`. `main` est la branche déployée.
Nommage : `feat/M0-07-moteur-des`, `fix/...`, `docs/...`.

## Mesurer sans se faire mentir

Deux façons d'obtenir un vert qui ne veut rien dire, toutes deux rencontrées en recette :

- **Une sonde qui touche `@for/engine` exige un `tsc -b --force` avant de relancer les tests.**
  Sans ça, les paquets en aval lisent un `dist/` périmé : tu élargis une constante du moteur,
  tout reste vert, et tu conclus que le garde-fou est inerte — ou pire, qu'il mord alors qu'il
  ne mord pas.
- **Le cache turbo rejoue les journaux d'un autre worktree.** Une mesure faite sans `--force`
  peut t'afficher la sortie de quelqu'un d'autre. Toute mesure de recette se fait avec
  `--force`, ou en invoquant `vitest run` directement.

## Deux pièges de l'environnement, déjà payés

- **pnpm 12 nomme le réglage `allowBuilds`**, une table paquet → booléen dans
  `pnpm-workspace.yaml`. L'ancien `onlyBuiltDependencies` est ignoré en silence et l'installation
  échoue sur `ERR_PNPM_IGNORED_BUILDS` sans dire pourquoi. Toute nouvelle dépendance à binaire
  natif (`better-sqlite3` arrive en M0-11) devra y être ajoutée, en connaissance de cause.
- **zsh ne découpe pas les variables non quotées.** Une boucle `for c in "install --frozen-lockfile"`
  puis `pnpm $c` passe la chaîne entière comme un seul argument. Ça ne casse que les scripts de
  recette, mais ça les casse en silence.
