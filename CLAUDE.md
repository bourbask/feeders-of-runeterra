# Feeders of Runeterra — instructions de travail

Une table de jeu de rôle multijoueur au Freljord, avec un maître de jeu tenu par une IA.
Le vocal reste sur Discord.

**Un terme t'arrête ?** `docs/GLOSSAIRE.md` — les mots du jeu et les mots du code, expliqués sans rien supposer. Si un terme manque, c'est un défaut du glossaire.

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
pnpm typecheck       # le code de production SEULEMENT
pnpm typecheck:tests # les fichiers de test — tâche turbo distincte, job 4 de la CI
pnpm lint
pnpm format          # avant de committer
pnpm check:workspace # cohérence des package.json et de la liste contractuelle de commandes
pnpm db:reset        # base locale remise à zéro puis réamorcée
pnpm sim run <scénario>
```

**`pnpm typecheck` ne regarde pas les fichiers de test.** Ce sont deux tâches turbo distinctes, et
`turbo run build typecheck lint test` ne couvre donc pas les `*.test.ts`. Un type élargi côté moteur
passe les quatre portes locales et tombe au job 4 de la CI, sur une fixture de test qui ne compile
plus. Toute mesure de recette lance **les deux**.

`pnpm verify` **n'a pas à être verte avant la fin de M0** : la porte se ferme progressivement,
tâche après tâche, et c'est M0-30 qui la referme entièrement. Ne cherche pas à rendre vertes des
commandes dont la cible n'est pas encore livrée — elles t'annoncent d'elles-mêmes quelle tâche
les remplira.

## Une promesse nomme le test qui la tient

Un en-tête de fichier qui affirme une propriété — surtout en capitales, surtout une propriété de
sécurité — **nomme le test qui la tient**, ou ne l'affirme pas.

C'est le défaut le plus fréquent trouvé en recette, et il revient à chaque passe :

| Promesse écrite | Ce que mesurait le test |
|---|---|
| « la portée est `identify` seule : une portée qu'on ne demande pas ne peut pas fuiter » | rien — l'élargir à `email` laissait 117 tests verts |
| « les deux cookies sont effacés à **chaque** sortie » | la moitié du titre du test, pas les cookies |
| « `deleted_at IS NULL` est dans le SQL : un joueur anonymisé ne doit pas se reconnecter » | rien |
| « `SESSION_SECRET` sert de poivre pour que la colonne ne devienne pas la liste des adresses » | rien |
| « rejouer du point de vue d'un joueur redonne exactement ce qu'il a vu » | rien — le destinataire était absent du double de test |

**Pourquoi c'est pire qu'une absence de commentaire** : le lecteur suivant fait confiance et ne
vérifie pas. Une garantie annoncée et non tenue se propage — trois tâches ont construit dessus.

La forme qui marche, appliquée spontanément par un développeur en vague 7 :

```ts
// THE SCOPE IS `identify` ALONE — held by
// tests/http/oauth.test.ts « redirige vers discord.com … »
```

Et la réciproque vaut aussi : si aucun test ne peut la tenir, la phrase descend d'un cran et dit ce
que le code **fait**, pas ce qu'on **aimerait** qu'il garantisse.

## Écrire la documentation

- Des **tableaux et des listes**, pas des paragraphes. Une définition tient en une ligne.
- Le **mot simple d'abord**, le terme technique seulement s'il apporte quelque chose. `id` est
  un identifiant ; ce qu'on en fait se dit après, en français.
- Pas de préambule, pas de phrase qui annonce ce que le document va faire.
- Une référence au code (`c2s.intent`, `zGameEvent`) se montre avec un exemple réel plutôt
  qu'elle ne se décrit.

## Écrire un commit ou une PR

Format : **symptôme, cause, correctif, preuve**. Une ligne chacun quand c'est possible.

- Pas de récit, pas de « ce qui est intéressant ici ».
- La preuve est une commande et son code de sortie, pas une affirmation.
- Une PR tient en dix lignes. Si elle en fait trente, c'est un ADR qui se cache : écris l'ADR
  et renvoie-y.
- Le raisonnement long va dans `docs/adr/`. La PR dit ce qui change et comment le vérifier.

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
- **Aucun chiffre ne se compare à lui-même.** Un test qui borne avec la constante qu'il vérifie
  passe toujours et ne prouve rien. Un chiffre qui vient d'un critère d'acceptation s'écrit en
  toutes lettres dans le test ; un chiffre qui vient du moteur se compare au moteur. ADR 0007.
- **`z.toJSONSchema` écrit `additionalProperties: false` même sur un objet non strict**, en mode
  par défaut. Toute vérification de strictness par le JSON Schema doit passer `io: 'input'`, et
  doubler d'un test d'exécution — sinon elle est verte pour la mauvaise raison.
- **Douze jobs verts ne sont pas douze portes fermées.** Les jobs 8 à 11 — migrations, contenu,
  éval hors ligne, simulateur — portent un `continue-on-error` marqué `TODO M0-30` : ils
  **restent verts en échouant**, et seule la conclusion de leur étape le dit. Une PR en conflit,
  elle, n'a pas une CI rouge : elle n'a **pas de CI du tout**, parce que le déclencheur
  `pull_request` porte sur la ref de fusion que GitHub ne fabrique pas. Dans les deux cas,
  « aucun échec » ne veut pas dire « tout est passé ». Compte les check-runs sur le sha de tête,
  et regarde les conclusions d'étapes.

## Trois pièges de l'environnement, déjà payés

- **pnpm 12 nomme le réglage `allowBuilds`**, une table paquet → booléen dans
  `pnpm-workspace.yaml`. L'ancien `onlyBuiltDependencies` est ignoré en silence et l'installation
  échoue sur `ERR_PNPM_IGNORED_BUILDS` sans dire pourquoi. Toute nouvelle dépendance à binaire
  natif (`better-sqlite3` arrive en M0-11) devra y être ajoutée, en connaissance de cause.
- **zsh ne découpe pas les variables non quotées.** Une boucle `for c in "install --frozen-lockfile"`
  puis `pnpm $c` passe la chaîne entière comme un seul argument. Ça ne casse que les scripts de
  recette, mais ça les casse en silence.
- **`git checkout <branche> && git reset --hard` est un piège dans ce dépôt.** Les agents
  travaillent en worktrees, et une branche déjà prise par un worktree fait **échouer** le
  `checkout`. Si la sortie passe par un `| tail`, le code de retour devient celui du `tail` —
  donc 0 — et le `reset --hard` s'exécute **sur la branche courante**, qui n'est pas celle
  qu'on visait. Déjà payé une fois : le pointeur de `lead/regle-du-chiffre-qui-se-compare-a-lui-meme`
  a été perdu, récupéré au reflog. Deux règles : un `reset --hard` se fait toujours avec
  `git -C <worktree>` et un chemin explicite, jamais enchaîné derrière un `checkout` ; et le
  worktree principal reste sur `develop`, pour que la victime d'un accident soit une branche
  qu'on peut retrouver sur `origin`.
