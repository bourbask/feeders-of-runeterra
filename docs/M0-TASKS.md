# M0 — Découpage en tâches

> M0 construit les fondations : aucune fonctionnalité de jeu, mais tout l'outillage qui permet à
> un agent développeur de savoir **en quelques secondes s'il a cassé quelque chose**.
> **32 tâches**, **9 vagues**. (M0-21 est absorbée par M0-16 ; M0-31 a été ajoutée par le tech
> lead pour mesurer un fournisseur gratuit sur le corpus complet ; **M0-32** par le même
> arbitrage, pour obtenir le **signal précoce** bien avant la vague 8.)
>
> Une **vague** est un groupe de tâches menées en même temps par des agents différents ; elle ne
> démarre que lorsque la précédente est finie. Chaque tâche va à **un agent développeur**, puis à
> **un agent testeur distinct** qui exécute les commandes de « Critères d'acceptation » : toutes
> en code 0, la tâche est acceptée. Aucun jugement au doigt mouillé.
>
> Autorité : `docs/ARCHITECTURE.md`, puis `docs/design/01-architecture.md`,
> `docs/design/02-mj-ia.md`, `docs/design/03-donnees.md`.

---

## 1. Règles du découpage

1. **Une tâche = une session de travail = un agent.** Si une tâche déborde, elle est mal
   découpée : le signaler plutôt que de la bâcler.
2. **Deux tâches de la même vague ne partagent jamais un fichier.** La liste « Fichiers
   touchés » de chaque fiche est contractuelle : un agent qui a besoin d'écrire ailleurs
   s'arrête et remonte le problème.
3. **Les fichiers partagés sont attribués à un propriétaire unique.** Le `package.json` racine
   et tous les scripts de commande sont écrits une fois pour toutes en M0-01. Le
   `package.json` de chaque paquet appartient à la tâche qui crée ce paquet.
4. **`pnpm verify` ne devient vert qu'à la toute fin** (M0-30). Pendant la construction, chaque
   tâche n'est jugée que sur ses propres critères.
5. **Aucun agent ne modifie une spec.** Une divergence constatée entre le code et une spec
   remonte au tech lead ; elle se règle par un ADR, pas par une correction silencieuse.
6. **Un critère d'acceptation se tranche à la commande, jamais à l'appréciation.** « Un test
   vérifie que… » n'est un critère que si le fichier de test figure dans « Fichiers touchés »
   et que la commande qui l'exécute est écrite. Un critère qu'un agent testeur ne peut pas
   trancher sans lire le code est un critère à réécrire.
7. **Un critère ne lance jamais la suite entière d'un paquet que plusieurs tâches de la même
   vague remplissent.** Trois tâches qui livrent dans `@for/server` ne peuvent pas toutes être
   jugées sur `pnpm turbo run test --filter @for/server` : chacune serait rouge à cause des deux autres.
   Chacune cite **ses** fichiers de test (`vitest run <chemins>`), et c'est M0-30 qui exige la
   suite complète.
8. **Toute commande citée dans un critère existe dans la liste contractuelle de
   `01-architecture.md` §2.2.** Si elle n'y est pas, c'est soit une commande à ajouter à
   M0-01, soit un critère à réécrire. Une commande inventée dans un critère est un critère
   intestable.

## 2. Vue d'ensemble des vagues

| Vague | Ce qu'on construit | Tâches |
|---|---|---|
| 1 | Le squelette du dépôt : espaces de travail, TypeScript strict, lint, orchestrateur | M0-01 |
| 2 | Le moteur de règles nu (types, hasard reproductible), la chaîne d'intégration, l'image Docker | M0-02 · M0-03 · M0-04 |
| 3 | Les contrats de données partagés, et la boîte à outils de test déterministe | M0-05 · M0-06 |
| 4 | Les dés, le protocole réseau, les schémas de contenu, les fixtures, le schéma de base | M0-07 · M0-08 · M0-09 · M0-10 · M0-11 |
| 5 | Les mouvements et le journal rejouable, le chargeur de contenu, l'accès base, les schémas IA | M0-12 · M0-13 · M0-14 · M0-15 |
| 6 | Le contenu de jeu **et les fiches de champion**, la reconstruction de base, les prompts du conteur, la page table, le serveur | M0-16 · M0-17 · M0-18 · M0-19 · M0-20 |
| 7 | Le contexte IA, l'authentification Discord, l'orchestration, le WebSocket, **la sonde de fumée d'un fournisseur gratuit**, **et la brûlure du souffle en deux temps** | M0-22 · M0-23 · **M0-34** (avant M0-24) · M0-24 · M0-25 · **M0-32** (à démarrer en premier) |
| 8 | La campagne de démonstration, le harnais d'éval, le simulateur, les travailleurs IA, **et la mesure complète d'un fournisseur gratuit** | **M0-31** (à démarrer en premier) · M0-26 · M0-27 · M0-28 · M0-29 |
| 9 | L'assemblage : le parcours de bout en bout qui prouve que le socle tient | M0-30 |

**Repères de taille** : *petite* ≈ une demi-session, *moyenne* ≈ une session, *grosse* ≈ une
session dense. Aucune tâche ne dépasse une session.

## 3. Points à trancher par le tech lead (n'arrêtent aucune tâche)

Relevés pendant la lecture des specs. Chacun a une valeur par défaut, pour ne bloquer personne ;
une décision contraire se rattrape en quelques lignes.

**État au 2026-09-17** : la revue de socle (`docs/M0-REVUE.md`) a corrigé les specs sur P1 à P6
et P8 à P14. Ces lignes restent comme mémoire ; plus rien à trancher dessus, sauf là où c'est
écrit noir sur blanc.

**Seconde série d'arbitrages, même date** : les quatre points laissés ouverts par la seconde
passe de revue (`M0-REVUE.md` §11.7) sont tranchés, plus un cinquième soulevé par le lead —
**P19 à P23**. Ce sont des décisions, pas des propositions : `M0-REVUE.md` §12 en porte la
trace, et **plus aucun point n'est en attente d'arbitrage**.

| # | Point | Valeur retenue pour M0 | État |
|---|---|---|---|
| P1 | `03-donnees.md` §4.8 passe 4 exigeait « 20 champions `handwritten` minimum », alors que les 20 fiches relèvent de la V1 | Le seuil est lu dans `content/manifest.json` (`expectedCounts.champions`). M0 livre **3** fiches. Le seuil passera à 20 en M1 sans toucher au code | corrigé dans la spec |
| P2 | `03-donnees.md` §7.1 décrivait le seed avec « 6 chroniques en couche 0, 2 en couche 1, 1 en couche 2 » — modèle à trois couches abandonné | Le seed écrit **3 versions d'un document unique**, écrites à la main, sans appel IA | corrigé dans la spec |
| P3 | `03-donnees.md` §1.7 citait `chronicles.facts_json`, absent du DDL §1.5 qui porte `doc_json` | `doc_json` fait foi | corrigé dans la spec |
| P4 | `db:check` contrôle 11 interrogeait `covers_from_seq` / `covers_to_seq`, colonnes inexistantes | Contrôle 11 : `version` dense de 1 à N, `source_event_seq` croissant et ≤ `campaigns.seq` | corrigé dans la spec |
| P5 | `.nvmrc` valait `26`, les specs disent Node 24 partout | **24** | corrigé dans le dépôt |
| P6 | `.env.example` décrivait un conteur agnostique (`NARRATOR_PROVIDER`, OpenRouter) et `DATABASE_URL` | **RENVERSÉ par le tech lead, confirmé depuis** (voir P20) : « il n'y a qu'un fournisseur : Anthropic » **n'est plus une décision en vigueur**, nulle part. Le conteur *est* agnostique : le produit doit pouvoir tourner sur un fournisseur gratuit ou un modèle local. `.env.example` porte `NARRATOR_PROVIDER`, `NARRATOR_BASE_URL`, `NARRATOR_API_KEY`, `NARRATOR_MODEL`, `NARRATOR_MODEL_STRUCTURED` et `DATABASE_PATH`. `ANTHROPIC_API_KEY`, `AI_MODEL_*` et `AI_ENABLED` n'existent plus | **tranché** — appliqué dans le dépôt et dans les quatre specs |
| P7 | La spec ne disait pas si `pnpm verify` doit être vert avant la fin du jalon | Non. La porte est progressive, et M0-30 la ferme | tranché |
| P8 | `ChampionSchema` n'avait **aucun champ `aliases`**, alors que tout le verrouillage de distribution en dépend (`02-mj-ia.md` §2.2, §8.4, M0-10, M0-21) | `aliases: z.array(FrTextSchema).min(1).max(12)`, obligatoire, ajouté au schéma unique | corrigé dans la spec |
| P9 | `content/champions-index.json` (les ~170 champions et leurs alias) était cité par la forge (V2, V7) mais absent de l'arborescence de contenu et de toute tâche | Fichier et `ChampionIndexSchema` ajoutés à `03-donnees.md` §4.1/§4.7 ; livré par M0-16, limité en M0 aux champions cités par le contenu et le seed | corrigé dans la spec |
| P10 | Trois documents décrivaient trois états du choix de conséquence de prix : un outil `propose-price.ts` (01 §2.7), un `optionId` transmis par le modèle (ARCHITECTURE §4.4), et une liste gelée de 12 outils qui n'en contient aucun (02 §3.4) | **Le moteur tire, point final.** Le moteur lance le d12 sur `pay-the-price`, applique l'entrée tirée, écrit `roll.price_paid`, puis transmet cette entrée au conteur comme un **fait imposé** à intégrer tel quel. **Personne ne choisit** : ni le modèle, ni le joueur. `propose-price.ts`, `kind: 'price_choice'`, `optionId` et `playerChoices` sont **supprimés partout**. Quand l'entrée porte plusieurs `suggestedEffects`, un second tirage sur le flux RNG `price` tranche, et l'index va dans `roll.price_paid.effectIndex` | **tranché par le tech lead** — appliqué dans ARCHITECTURE §4.4, 01 §2.7, 02 §3.4, 03 §3.4 et §4.6, et M0-29 |
| P11 | `propose_scene_transition` laisse le modèle choisir un `time_shift` dont le moteur tire une perte de vivres : le modèle décide donc indirectement d'une mutation de jauge, et l'événement `character.gauge_changed` devient atteignable par un circuit de proposition, hors de la liste close | **`time_shift` est retiré de l'outil.** `propose_scene_transition` ne propose plus qu'un **changement de lieu** : plus de champ dans le schéma d'entrée, plus de mention dans la description, plus rien dans la chaîne de traitement. Le temps écoulé et son coût éventuel découlent **exclusivement du mouvement joué** (par exemple `endure-cold`), calculés par le moteur à partir de sa table de mouvements | **tranché par le tech lead** — appliqué dans `02-mj-ia.md` §3.3 et ARCHITECTURE §4.4 |
| P12 | `roll_oracle` est classé « lecture » mais écrit au journal : c'était un troisième circuit d'écriture depuis le modèle, non couvert par `proposal-surface.test.ts` | `ReadOnlyTool.journalOnly`, vide partout sauf `roll_oracle` = `['roll.oracle_resolved','roll.yes_no_resolved']`, et le test vérifie **trois** listes closes *(deux à l'époque ; la troisième — le droit de refus — est arrivée avec P22, voir M0-29)* | corrigé dans la spec |
| P13 | `prompt-size.test.ts` devait mesurer par `countTokens` — un appel réseau — alors que toute la CI de M0 tourne sans clé | Estimateur local + référence commitée en PR ; rapprochement avec `countTokens` au nocturne | corrigé dans la spec |
| P14 | `ai_calls` n'avait pas de colonne `trim_level`, que `02-mj-ia.md` §4.4 écrit à chaque tour | Colonnes `trim_level` et `context_hash` ajoutées au DDL | corrigé dans la spec |
| P15 | **Prototype joué, enseignement 1** : le ton produit était « fade et trop flou, on a du mal à s'y plonger ». Un prompt qui demande un ton « âpre, sensoriel, concret » ne suffit pas — le modèle produit de la prose d'IA reconnaissable | `conteur/2.0.0` : ancrage de registre nommé (**la saga islandaise**), liste noire close, trois obligations, et surtout une **paire d'exemples bon/mauvais sur la même situation** avec l'explication de ce qui cloche. Le prompt passe de ≈ 1 250 à ≈ 2 200 tokens ; seuil de `prompt-size.test.ts` relevé à 1 900 ; huit assertions de registre ajoutées, dont cinq dures | corrigé dans la spec |
| P16 | **Prototype joué, enseignement 2** : incohérence factuelle en **trois échanges** — un PNJ décrit en fuite réapparaît endormi dans son abri. Cause racine : le contexte envoyait les dernières entrées du journal **en prose**, et le modèle les réinterprétait | **État de scène structuré** : événement `scene.facts_updated` + projection `scene_state`, injecté comme donnée d'autorité (`<scene>`), et bloc `<scene_apres>` rendu par le modèle, validé, borné et fusionné par le serveur. Un bloc absent ou malformé ne casse rien. Les partis sont **monotones** dans une scène. `02-mj-ia.md` §2.3, §4.7 ; `03-donnees.md` §1.4, §3.4, §3.5 | corrigé dans la spec |
| P17 | **Prototype joué, enseignement 3** : le modèle accepte tout et invente une justification, faute d'avoir un moyen légitime de refuser. Verdict du joueur : « on peut proposer un truc wtf, mais la conséquence doit trouver une logique face à l'action » | **Droit de refus borné à la possibilité matérielle**, jamais à l'issue. Quatre causes closes, preuve recalculée par le serveur sur l'état **à la déclaration**. Un refus prouvé annule le tour par `system.reverted` sur le groupe `correlation_id` ; l'index RNG n'est jamais libéré ; un jet annulé **laisse une trace**. Une proposition absurde mais possible n'est **jamais** refusée. Anti-abus : `refusal_is_outcome_blind` rejoue le corpus dés inversés. `02-mj-ia.md` §4.8 ; `03-donnees.md` §0.5, §3.7 | corrigé dans la spec |
| P18 | `02-mj-ia.md` était écrit en supposant un fournisseur unique : identifiants de modèle, codes d'arrêt, seuils de cache, format d'appel d'outils et classes d'exception de SDK traversaient toute la spec. Impossible d'utiliser un fournisseur gratuit ou un modèle local sans réécrire la couche IA | **Le conteur devient un PORT**, pas un fournisseur : `NarratorPort`, deux opérations (`narrer()` en flux, `structurer()` qui rend du JSON validé), une énumération d'erreurs neutre, et **trois adaptateurs** — `anthropic`, `openai-compatible`, `ollama` — plus un `stub` sans réseau. Tout ce qui est propre à un fournisseur descend dans son adaptateur (`02-mj-ia.md` §0.3 à §0.5) ; le reste de la spec ne nomme plus aucun fournisseur, et un test le vérifie (§0.7). Configuration par les cinq `NARRATOR_*` *(depuis P19 : cinq de base **et trois d'appoint**)*. Matrice de dégradation explicite (§0.2), gouvernée par une seule règle : **on dégrade la prose, jamais l'équité** | **tranché par le tech lead** — appliqué dans les quatre specs, `.env.example`, et les tâches M0-12, M0-18, M0-20, M0-22, M0-27, M0-29 et la nouvelle M0-31 |
| P19 | Les trois variables d'environnement au-delà des cinq nommées (`NARRATOR_TOOLS`, `NARRATOR_TIMEOUT_MS`, `NARRATOR_CONTEXT_WINDOW`) n'avaient jamais été arbitrées (`M0-REVUE.md` §11.7, point 1) | **VALIDÉES.** Elles rejoignent officiellement les cinq `NARRATOR_*` de base. Motif retenu : *le support des outils dépend du modèle et non de la passerelle, et un modèle local qui charge à froid dépasse 60 s sans être en panne*. Toutes trois restent facultatives et propres à un adaptateur ; leur valeur par défaut et l'adaptateur concerné sont écrits **au même endroit et de la même façon** dans `.env.example`, `02-mj-ia.md` §0.6 et `01-architecture.md` §9.4 | **tranché par le tech lead** — appliqué dans `.env.example`, `02-mj-ia.md` §0.3 et §0.6, `01-architecture.md` §9.4, `ARCHITECTURE.md` §4.5, et vérifié par M0-20 |
| P20 | La réécriture de `.env.example` en fichier agnostique du fournisseur n'avait pas été confirmée (`M0-REVUE.md` §11.7, point 2) | **VALIDÉE, et le point P6 est officiellement RENVERSÉ.** « Il n'y a qu'un fournisseur : Anthropic » n'est plus une décision en vigueur : le produit doit pouvoir tourner sur un fournisseur **gratuit** ou sur un **modèle local**. Toute occurrence contraire est un reste à corriger, pas une règle | **tranché par le tech lead** — appliqué dans `.env.example`, `ARCHITECTURE.md` §4.5, `01-architecture.md` §9.4, et tracé dans `M0-REVUE.md` §12 |
| P21 | Le départage d'un prix portant plusieurs `suggestedEffects` était une **déduction** de « le moteur tire », pas la décision elle-même (`M0-REVUE.md` §11.7, point 4) | **VALIDÉ tel que spécifié** : second tirage sur le flux RNG `price`, index journalisé dans `roll.price_paid.effectIndex`. Le moteur décide, et c'est rejouable. L'alternative « toujours le premier effet » est **abandonnée**. Aucun document ne doit laisser entendre que le modèle ou le joueur choisit | **tranché par le tech lead** — vérifié dans `ARCHITECTURE.md` §4.4, `02-mj-ia.md` §3.4 et §4.5, `03-donnees.md` §3.4 et §4.6, et M0-29 |
| P22 | Fallait-il vérifier la présence de la cible **avant** les dés, à l'étape 2 du chemin d'une intention (`M0-REVUE.md` §11.6 et §11.7, point 3) ? | **NON. Le refus reste APRÈS le jet.** Un contrôle de faisabilité avant les dés remettrait le modèle dans le chemin de décision : inacceptable. Conséquence assumée — un joueur voit brièvement le résultat d'un tour qui sera ensuite annulé. **Nouveau** : ce tour annulé n'est pas effacé de l'affichage, il est **montré comme annulé, avec sa preuve consultable**. Le détail mécanique d'une scène (mouvement, dés, calcul, effets, prix, présage) n'est **pas** affiché par défaut : il est replié derrière une commande **« Pourquoi ? »** attachée à chaque scène. Cette preuve est une **projection du journal** (`TurnProofDto`), calculée à la demande sur le groupe `correlation_id`, portée par `c2s.why` → `s2c.turn_proof`, bornée à 32 effets / 120 caractères par libellé / **8 Kio** sérialisés | **tranché par le tech lead, avec l'utilisateur** — appliqué dans `ARCHITECTURE.md` §4.4, `01-architecture.md` §2.4, §2.8, §2.9, §5.2, §5.4, §5.6, `02-mj-ia.md` §4.8.3, §4.8.4, §4.8.6, §6.2, §6.5, `03-donnees.md` §0.5 et §3.7, et les tâches M0-05, M0-08, M0-19, M0-20, M0-24, M0-25, M0-29, M0-30 |
| P23 | Valider un fournisseur gratuit en **vague 8** (M0-31), c'est trop tard : si un modèle gratuit ne tient pas le prompt contraint, toute la couche se conçoit différemment | **SCINDER.** Une tâche de **fumée** (**M0-32**) sort le signal dès que le prompt intégral et le port existent : six à huit assertions écrites à la main — **sept sont livrées**, et la borne 6–8 est vérifiée par la sonde elle-même —, un verdict lisible par un humain (*tel fournisseur, tel modèle, tant d'assertions passées sur tant*), aucune dépendance au corpus complet d'assertions, et **aucun blocage de la CI** — elle informe une décision. M0-31 garde le corpus complet en vague 8. **Réserve appliquée, chiffrage corrigé à la troisième passe** : le lead demandait « vague 4 au plus tard » ; le prompt intégral et le port viennent de M0-18, en **vague 6**, donc **la vague 7 est le plus tôt atteignable sans redécouper**. Le redécoupage chiffré par la passe d'application aboutissait à la vague **5**, pas 4, et oubliait `SceneBlockSchema`. Coût réel de la vague 4 : **§12 A7 de `M0-REVUE.md`** et fiche M0-32 — trois vagues touchées, deux fiches neuves, trois réécrites, un couplage de compilation intra-vague que le système de vagues existe pour empêcher. **Décision de découpage, elle appartient au lead** | **tranché par le tech lead** — appliqué en M0-32 (nouvelle) et M0-31 (fiche ajustée) ; **placement en vague 7, réserve ouverte** |

---

# Les fiches de tâches

Format commun : ce à quoi elle sert, ce qu'elle livre, comment on vérifie qu'elle est finie,
quels fichiers elle a le droit de toucher.

---

## Vague 1 — Le squelette

### M0-01 · Socle du monorepo et outillage
**Taille** : grosse · **Dépend de** : rien · **Parallélisable** : non (vague seule)

**À quoi ça sert.** La fondation que toutes les autres tâches importent : espaces de travail
pnpm, configuration TypeScript stricte partagée, règles de lint qui rendent les invariants
mécaniques, orchestrateur de tâches, et les dix paquets vides prêts à être remplis. Tant que ce
n'est pas fini, personne d'autre ne commence.

**Livrables**
- `pnpm-workspace.yaml` (`packages/*`, `tooling/*`), `package.json` racine avec **tous** les
  scripts de `01-architecture.md` §2.2 — y compris ceux dont la cible n'existe pas encore.
- `turbo.json`, `tsconfig.json` racine (solution-style, références vers chaque paquet),
  `vitest.workspace.ts`, `eslint.config.js`, `prettier.config.js`, `.dependency-cruiser.cjs`.
- `tooling/tsconfig/{base,library,node,react,test}.json` exactement comme en §4.1.
- `tooling/eslint-config/{index,react,engine-purity}.js` avec les règles non négociables de
  §4.2, et `tooling/prettier-config/index.json`.
- `scripts/check-workspace.ts` (cohérence des `package.json`, scripts obligatoires, versions),
  `scripts/new-package.ts`.
- Les dix paquets `packages/{engine,contracts,content,testkit,db,ai,ai-eval,server,client,sim}`
  réduits à `package.json` + `tsconfig.json` + `tsconfig.test.json` + `src/index.ts` + un test
  trivial, avec les cinq scripts obligatoires.
- `.nvmrc` (24), `.gitattributes` (`*.golden.json -diff`), `.editorconfig`, `.env.example`
  réécrit sur §9.4, `CLAUDE.md` (rappel des quatre invariants + commandes), `pnpm-lock.yaml`.
- **Les seuils de couverture** (`coverage.thresholds` de `01-architecture.md` §8, job 6 :
  `engine` 95 %/90 %, `contracts` 90 %, `db` 80 %, global 70 %) écrits **ici**, dans
  `vitest.workspace.ts` et les `vitest.config.ts` de paquet. Un seuil qui n'existe que dans un
  tableau de documentation n'est pas un seuil : plus loin, quatre tâches s'appuient dessus.

**Critères d'acceptation**
- `pnpm install --frozen-lockfile` sort en 0 (le lockfile est commité et à jour).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test` sortent en 0.
- `pnpm depcruise` sort en 0 et `pnpm check:workspace` sort en 0.
- `pnpm check:workspace` sort en **1** si l'on retire le script `test` d'un `package.json` de
  paquet (le testeur applique puis annule cette modification).
- `node -p "Object.keys(require('./packages/engine/package.json').dependencies ?? {}).length"`
  affiche `0`.
- `grep -q '^24' .nvmrc` et `grep -q 'NARRATOR_PROVIDER' .env.example` et
  `grep -q 'DATABASE_PATH' .env.example` sortent en 0, et
  `grep -qE 'ANTHROPIC_API_KEY|AI_MODEL_|AI_ENABLED|DATABASE_URL' .env.example` sort en **1**
  (les noms de l'ancienne configuration mono-fournisseur ont disparu, cf. P6 et P18).
- **Toutes** les commandes de la liste contractuelle de `01-architecture.md` §2.2 existent :
  `for c in dev build verify test lint typecheck format:check format depcruise check:workspace
  test:golden golden:update sim db:generate db:check-schema db:migrate db:studio db:seed
  db:reset db:rebuild db:check content:index content:check eval:offline eval:record eval:live
  eval:judge eval:smoke eval:probe; do node -e "process.exit(require('./package.json').scripts['$c']?0:1)"
  || echo "MANQUE $c"; done` n'affiche rien. *(`eval:smoke` est dans la liste depuis P23 : la
  commande existe dès M0-01, même si M0-32 ne la remplit qu'en vague 7.)*
- `pnpm test --coverage` sur `@for/engine` sort en code non nul si l'on abaisse artificiellement
  la couverture (preuve que les seuils sont appliqués par le runner, pas seulement documentés).
- Un `import 'node:fs'` ajouté dans `packages/engine/src/index.ts` fait sortir `pnpm lint` en
  code non nul (vérification de `engine-purity`).

**Fichiers touchés** : `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`,
`tsconfig.json`, `vitest.workspace.ts`, `eslint.config.js`, `prettier.config.js`,
`.dependency-cruiser.cjs`, `.nvmrc`, `.gitattributes`, `.editorconfig`, `.env.example`,
`CLAUDE.md`, `tooling/**`, `scripts/check-workspace.ts`, `scripts/new-package.ts`,
`packages/*/package.json`, `packages/*/tsconfig.json`, `packages/*/tsconfig.test.json`,
`packages/*/src/index.ts`, `packages/*/src/index.test.ts`

---

## Vague 2 — Moteur nu, intégration continue, image

### M0-02 · Moteur : types de domaine, hasard reproductible, pureté
**Taille** : grosse · **Dépend de** : M0-01 · **Parallélisable** : oui

**À quoi ça sert.** `@for/engine` est le cœur des règles et la seule couche autorisée à
trancher une issue. Cette tâche pose son vocabulaire de types — dont le catalogue fermé des
**71 types d'événements** — et son générateur de hasard reproductible. Tout le reste du projet
en dérive : les contrats Zod en sont le miroir, la base stocke les payloads, le simulateur les
rejoue.

**Livrables**
- `src/result.ts` (`Result<T,E>`, `ok`, `err`, `isOk`), `src/ids.ts` (identifiants marqués,
  `IdFactory`), `src/rng.ts` (`Rng`, `TracingRng`, `createSeededRng`, `createCampaignRng` —
  cyrb128 + sfc32, rejet du biais modulo, sans aucune dépendance).
- `src/types/` : `attributes`, `gauges`, `progress`, `character`, `clock`, `vow`, `campaign`
  (`CampaignState` de `03-donnees.md` §3.5), `scene` (`SceneState`, `ScenePresence`,
  `SceneAbsence` — `03-donnees.md` §3.5), `effects` (`EngineEffect`), `events` (`GameEvent`,
  union discriminée des **71** types de §3.4), `intents`, `brief`, `violations`.
- `src/index.ts` (seule surface publique), `tsup.config.ts`, `tests/purity.test.ts`.

**Critères d'acceptation**
- `pnpm turbo run build typecheck lint test --filter @for/engine` sort en 0.
- `tests/purity.test.ts` échoue si l'on ajoute `import 'node:crypto'`, `Math.random()`,
  `new Date()` ou `process.env` dans `src/` (le testeur applique les quatre patchs, un par un).
- Le moteur exporte `export const GAME_EVENT_TYPES = [...] as const` (les 71 chaînes, ordre du
  catalogue) **et** un garde de type `satisfies readonly GameEvent['type'][]` doublé d'un
  contrôle d'exhaustivité (`Exclude<GameEvent['type'], typeof GAME_EVENT_TYPES[number]>` doit
  valoir `never`). Une union TypeScript ne se compte pas à l'exécution : sans cette constante,
  le critère ci-dessous est intestable.
- `node -e "const{GAME_EVENT_TYPES:t}=require('./packages/engine/dist/index.js');
  process.exit(t.length===71 && new Set(t).size===71 ? 0 : 1)"` sort en 0.
- Le testeur retire un type de `GAME_EVENT_TYPES` : `pnpm turbo run typecheck --filter @for/engine` sort
  en code non nul (le garde d'exhaustivité, pas un test).
- Un test vérifie que `createSeededRng('freljord')` produit deux fois la même série de 100
  tirages, et que `createCampaignRng(seed, seq, stream)` est reproductible sans état.
- `LC_ALL=C.UTF-8 grep -rlnP '[À-ÖØ-öø-ÿŒœ]' packages/engine/src | wc -l` affiche `0` — la
  classe couvre les majuscules accentuées et `œ`, que `[éèêàçûôîï]` laissait passer. Aucune
  chaîne française en dur dans le moteur ; les valeurs d'énumération
  `vif|coeur|fer|ombre|esprit`, `presage`, `echec`… sont sans accent par construction.

**Fichiers touchés** : `packages/engine/src/{index,result,rng,ids}.ts`,
`packages/engine/src/types/**` (dont `types/scene.ts`), `packages/engine/tests/purity.test.ts`,
`packages/engine/tsup.config.ts`, `packages/engine/package.json`

---

### M0-03 · Chaîne d'intégration continue
**Taille** : moyenne · **Dépend de** : M0-01 · **Parallélisable** : oui

**À quoi ça sert.** Le filet qui attrape les régressions avant la fusion. Les douze travaux de
`01-architecture.md` §8 sont écrits maintenant, dans l'ordre et avec les bonnes commandes ; ceux
dont la cible n'existe pas encore sont marqués tolérants à l'échec, et M0-30 retire ces
marqueurs.

**Livrables**
- `.github/workflows/ci.yml` : les 12 travaux du tableau §8, dans l'ordre de dépendance
  indiqué, cache pnpm + cache Turborepo, `concurrency: ci-${{ github.ref }}` avec annulation.
  Chaque travail non encore livrable porte `continue-on-error: true` suivi du commentaire
  `# TODO M0-30: retirer`.
- `.github/workflows/ai-eval.yml` : nocturne + manuel + étiquette `run-ai-eval`, non bloquant.
  Il lance `pnpm eval:live` puis `pnpm eval:judge` — qui sortent en 1 avec « niveau N1/N2 :
  jalon M1 » tant que M0-27 n'a livré que N0. Le déclencheur `schedule` est donc **commenté** en
  M0, activé en M1 : un workflow nocturne rouge toutes les nuits, plus personne ne le regarde.
- `.github/CODEOWNERS`, `.github/pull_request_template.md` (case « un fichier doré modifié est
  justifié dans le message de commit »), `.github/actionlint.yaml`.
- `docs/runbook/ci.md` : protection de branche à appliquer sur `main`, budget de 8 minutes,
  définition de « rouge ».

**Critères d'acceptation**
- `actionlint` sort en 0 sur les trois workflows.
- `bash scripts/check-ci-jobs.sh` (livré par cette tâche) sort en 0 : il vérifie la présence
  des 12 identifiants de travail (`install`, `format`, `lint`, `typecheck`, `deps`, `test-unit`,
  `test-golden`, `migrations`, `content`, `ai-eval-offline`, `sim`, `build`) et **que chaque
  commande citée dans un `run:` figure dans les scripts du `package.json` racine** — c'est ce
  qui attrape un `pnpm db:generate --check` ou un `pnpm ai:eval` qui n'existent pas.
  Le testeur renomme un travail : le script sort en 1.
- `grep -c 'TODO M0-30' .github/workflows/ci.yml` est égal au nombre de
  `continue-on-error: true` présents (aucun marqueur orphelin).
- Aucun secret en clair : `grep -rIn 'NARRATOR_API_KEY: [^$]' .github/` ne renvoie rien.

**Fichiers touchés** : `.github/workflows/ci.yml`, `.github/workflows/ai-eval.yml`,
`.github/CODEOWNERS`, `.github/pull_request_template.md`, `.github/actionlint.yaml`,
`scripts/check-ci-jobs.sh`, `docs/runbook/ci.md`

---

### M0-04 · Image Docker, composition, déploiement, sauvegardes
**Taille** : moyenne · **Dépend de** : M0-01 · **Parallélisable** : oui

**À quoi ça sert.** L'emballage et la mise en ligne, dès maintenant : une image unique qui sert
l'API et le site, Caddy en façade, un déploiement par SSH déclenché après une CI verte, et
surtout des sauvegardes vérifiées. Tôt, pour ne pas découvrir tard que le module natif SQLite ne
compile pas dans l'image.

**Livrables**
- `infra/Dockerfile` multi-étapes (`base`/`deps`/`build`/`runtime`), utilisateur non root,
  `HEALTHCHECK` sur `/healthz`, `ENTRYPOINT ["node","dist/main.js"]`, outils de compilation
  natifs retirés de l'image finale. Repli documenté vers `node:24-bookworm-slim`.
- `infra/docker-compose.yml` (un seul réplica, commentaire explicite sur l'écrivain unique),
  `infra/docker-compose.dev.yml`, `infra/Caddyfile` (TLS, HSTS, `@ws` sans tampon).
- `infra/scripts/{deploy,backup,restore}.sh`. **Périmètre M0 de `backup.sh`** : `VACUUM INTO`,
  `integrity_check`, `foreign_key_check`, compression `zstd`, rétention locale. Le chiffrement
  `age` et la copie hors site `restic` sont **écrits dans le runbook, laissés commentés** :
  aucun joueur réel à protéger en M0, et une clé `age` à gérer maintenant est un coût
  d'exploitation sans contrepartie. Ils s'activent au premier joueur, comme Litestream.
- `.dockerignore`, `.github/workflows/deploy.yml` (sur `workflow_run` de la CI, sauvegarde
  préalable, `docker compose up -d --wait`, vérification `/readyz`, rollback).
- `docs/runbook/deploy.md` et `docs/runbook/backup-restore.md`, dont le paragraphe
  « pourquoi il n'y aura jamais deux instances » et la ligne Litestream à décommenter en M1.

> **Ordre.** En vague 2, `packages/server` n'a pas de `dist/main.js` et `packages/client` ne
> produit pas de `dist/` : l'étape `runtime` du `Dockerfile`, qui copie ces deux répertoires,
> **ne peut pas** réussir. Deux conséquences :
> 1. cette tâche livre un `index.html` et un `vite.config.ts` minimaux **seulement si** le
>    squelette de M0-01 n'en a pas — sinon elle ne touche pas `packages/client` ;
> 2. le critère de construction d'image ci-dessous s'arrête à l'étape `build`
>    (`--target build`). La construction complète de l'image est un critère de **M0-30**, pas
>    de celui-ci. Un critère qu'on sait faux à l'avance est pire qu'un critère absent.

**Critères d'acceptation**
- `docker build -f infra/Dockerfile --target build -t for-m0:build .` sort en 0 (les modules
  natifs, dont `better-sqlite3`, compilent — c'est **la** question qu'on veut trancher tôt).
- `hadolint infra/Dockerfile` sort en 0 et l'étape `runtime` déclare un utilisateur non root :
  `grep -qE '^USER (app|[0-9]+)' infra/Dockerfile`.
- `grep -q 'HEALTHCHECK' infra/Dockerfile` sort en 0.
- `docker compose -f infra/docker-compose.yml config` sort en 0 et
  `docker compose -f infra/docker-compose.yml config | grep -c 'replicas: 1'` vaut 1.
- `shellcheck infra/scripts/*.sh` sort en 0.
- `actionlint .github/workflows/deploy.yml` sort en 0 (cette tâche **ne fournit pas**
  `.github/actionlint.yaml` : ce fichier appartient à M0-03, de la même vague — règles 2 et 3
  du découpage).
- `infra/scripts/backup.sh` exécuté sur une base SQLite jetable produit une archive et sort en
  0 ; la même commande sur une base corrompue sort en 1.

**Fichiers touchés** : `infra/**`, `.dockerignore`, `.github/workflows/deploy.yml`,
`docs/runbook/deploy.md`, `docs/runbook/backup-restore.md`,
`packages/client/{index.html,vite.config.ts}` *(les stubs minimaux de l'encadré « Ordre »
ci-dessus ; le propriétaire du client reste M0-19, vague 6, qui les remplace)*

---

## Vague 3 — Contrats et boîte à outils de test

### M0-05 · Contrats : état, événements, intentions, erreurs
**Taille** : grosse · **Dépend de** : M0-02 · **Parallélisable** : oui

**À quoi ça sert.** `@for/contracts` est le miroir Zod des types du moteur : il valide tout ce
qui entre et sort du système. Cette tâche livre le noyau — état de campagne, 71 événements,
intentions, projection vue par un joueur, erreurs — et le test qui **casse la compilation**
quand le moteur évolue sans son schéma.

**Livrables**
- `src/{primitives,version,errors,upcast,index}.ts`, `src/core/**` (dont `core/scene-state.ts`,
  miroir Zod de `SceneState` avec ses bornes : 8 présents, 8 partis, `name` ≤ 40, `state` ≤ 60),
  `src/events/**` (les 71 variantes), `src/intents/**`, `src/dto/table-state.ts`.
- `src/dto/turn-proof.ts` : `zTurnProof` / `TurnProofDto` — la **preuve d'un tour** dépliée par
  la commande « Pourquoi ? » (P22), à la lettre de `01-architecture.md` §5.4. **Projection du
  journal**, pas miroir du moteur : `.strict()`, `status`, `revertedBy`,
  `move`, `roll`, `revision`, `effects` (**max 32**), `price`, `presage`, `narration`, et
  **un `eventSeq` sur chaque entrée**. Elle vit ici : M0-05 est le propriétaire unique de
  `src/dto/**` ; le message qui la transporte appartient à M0-08.
- Les index de sous-dossier `src/{ws,http,content,ai}/index.ts` créés **vides mais exportés**
  par le barrel, pour que les tâches de la vague 4 les remplissent sans toucher `src/index.ts`.
- `tests/engine-parity.test.ts`, `tests/exhaustive-union.test.ts`, `tests/event-catalog.test.ts`
  (lit `docs/design/03-donnees.md` §3.4 et compare la liste des types au markdown).

**Critères d'acceptation**
- `pnpm turbo run build typecheck lint test --filter @for/contracts` sort en 0. *(Seule tâche à livrer
  dans `@for/contracts` à cette vague : la suite entière est un critère légitime ici.)*
- `tests/event-catalog.test.ts` échoue si l'on retire une ligne du tableau de la spec ou une
  variante du schéma (le testeur applique les deux patchs).
- Un test vérifie qu'un `scene.facts_updated` portant neuf entrées dans `present` est refusé, et
  qu'une entrée de `absent` dont la `cause` n'appartient pas à
  `parti | mort | hors_de_portee` est refusée.
- Le testeur ajoute `readonly probe: string;` au type `CampaignState` de `@for/engine` sans
  toucher `zCampaignState` : `pnpm typecheck` sort en code non nul, et le message pointe le
  `satisfies z.ZodType<CampaignState>` de `packages/contracts/src/core/campaign-state.ts`.
  Il restaure ensuite le fichier.
- La couverture de `packages/contracts` est ≥ 90 % lignes (`pnpm turbo run test --filter @for/contracts
  --coverage`).
- `grep -rn "z.infer" packages/contracts/src/core/campaign-state.ts` ne renvoie aucune
  déclaration de `CampaignState` (le type canonique vient du moteur, pas du schéma).
- Un test vérifie que `zTurnProof` refuse un `effects` de 33 entrées, refuse une entrée
  d'`effects` **sans `eventSeq`** (une preuve sans provenance est une donnée fabriquée pour
  l'affichage, exactement ce que P22 interdit), refuse une clé inconnue (`.strict()`), et
  **accepte** une preuve `status: 'reverted'` portant `revertedBy { seq, reason }`.

**Fichiers touchés** : `packages/contracts/src/{index,primitives,version,errors,upcast}.ts`,
`packages/contracts/src/core/**`, `packages/contracts/src/events/**`,
`packages/contracts/src/intents/**`, `packages/contracts/src/dto/**` (y compris
`dto/turn-proof.ts`),
`packages/contracts/src/{ws,http,content,ai}/index.ts`,
`packages/contracts/tests/{engine-parity,exhaustive-union,event-catalog}.test.ts`,
`packages/contracts/package.json`

---

### M0-06 · Boîte à outils de test : hasard scripté, horloge figée, corpus dorés
**Taille** : moyenne · **Dépend de** : M0-02 · **Parallélisable** : oui

**À quoi ça sert.** Un test ne dépend jamais du hasard ni de l'heure. Cette tâche livre les
substituts déterministes et le comparateur de corpus dorés, l'outil qui rend une modification de
règle **visible en diff** au lieu de silencieuse.

**Livrables**
- `src/rng/scripted.ts` (`scriptedRng([...])`, erreur explicite `ScriptedRngExhausted`),
  `src/rng/seeded.ts` (ré-export + graines nommées `SEEDS`).
- `src/clock/fixed.ts` (`fixedClock(ISO)`), `src/ids/counter.ts` (`counterIds('ev')`).
- `src/golden/stable-stringify.ts` (clés triées, nombres normalisés, 2 espaces, `\n` final) et
  `src/golden/runner.ts` (`expectGolden`, réécriture si `GOLDEN_UPDATE=1`).
- `src/index.ts` exportant le tout, plus un `src/fixtures/index.ts` vide que M0-10 remplira.

**Critères d'acceptation**
- `pnpm turbo run build typecheck lint test --filter @for/testkit` sort en 0.
- Un test vérifie qu'un `scriptedRng` épuisé lève `ScriptedRngExhausted` avec le nombre de
  tirages consommés dans le message.
- Un test vérifie que `stableStringify` donne le même octet pour deux objets aux clés
  permutées, et termine par un saut de ligne.
- Un test en dossier temporaire vérifie qu'`expectGolden` échoue sur dérive, et réécrit le
  fichier quand `GOLDEN_UPDATE=1`.
- Aucun test n'écrit hors de `os.tmpdir()` : `grep -rn "writeFileSync(" packages/testkit/src |
  grep -v tmpdir` ne renvoie que le runner doré.

**Fichiers touchés** : `packages/testkit/src/{index}.ts`, `packages/testkit/src/rng/**`,
`packages/testkit/src/clock/**`, `packages/testkit/src/ids/**`,
`packages/testkit/src/golden/**`, `packages/testkit/src/fixtures/index.ts`,
`packages/testkit/package.json`

---

## Vague 4 — Dés, protocole, contenu, fixtures, base

### M0-07 · Moteur : dés, jauges, souffle, progression
**Taille** : grosse · **Dépend de** : M0-02, M0-06 · **Parallélisable** : oui

**À quoi ça sert.** Le calcul des règles prototypées : le jet de défi (1d6 + attribut contre
2d10), le souffle et sa brûlure, les jauges 0-5, les crans de progression par rang. Le corpus
doré associé est l'oracle de référence du projet : si quelqu'un modifie une constante de règle,
la diff doit rester lisible.

**Livrables**
- `src/dice/{challenge,progress,oracle,price,presage}.ts` aux signatures exactes de
  `01-architecture.md` §2.3.
- `src/momentum.ts` (brûlure, annulation par souffle négatif, bornes −6/+10, retour à +2),
  `src/gauges.ts` (delta borné, seuils), `src/progress-track.ts` (12/8/4/2/1 crans, 10 cases,
  40 crans).
- Tests colocalisés pour chaque fichier, et
  `tests/golden/{challenge-matrix,momentum-rules,progress-rolls}.golden.json` — la matrice de
  défi ne contient **que les combinaisons porteuses d'une décision** (≈ 300 lignes) : bornes du
  souffle, égalité `|souffle| == dé d'action`, franchissement du plafond à 10, dés de défi
  égaux, les trois issues autour de chaque seuil.

**Critères d'acceptation**
- `pnpm turbo run test --filter @for/engine -- --coverage` sort en 0 avec ≥ 95 % lignes et ≥ 90 % branches
  sur les fichiers livrés.
- `pnpm test:golden` sort en 0.
- Le testeur remplace `TICKS_PER_MILESTONE.dangereux` par `7`, puis lance
  `pnpm --filter @for/engine exec vitest run --reporter=json --outputFile=/tmp/canari.json` :
  la commande sort en code non nul **en moins de 30 secondes**, et
  `jq -r '[.testResults[] | select(.status=="failed") | .name] | map(select(test("/tests/golden/")))
  | length > 0' /tmp/canari.json` **et** la même expression avec `test("/src/.*\\.test\\.ts$")`
  renvoient toutes deux `true` : au moins un test unitaire **et** au moins un corpus doré sont
  rouges. Il restaure ensuite le fichier. *(« au moins un des deux est rouge » ne se tranche pas
  à l'œil sur une sortie de 300 lignes.)*
- `GOLDEN_UPDATE=1 pnpm test:golden` régénère les trois fichiers et `git diff --exit-code`
  sort ensuite en 0 (les dorés commités sont à jour).
- Un test vérifie que deux dés de défi identiques produisent `presage: true` quelle que soit
  l'issue.

**Fichiers touchés** : `packages/engine/src/dice/**`,
`packages/engine/src/{momentum,gauges,progress-track}.ts`, `packages/engine/src/index.ts`,
`packages/engine/tests/dice/**`, `packages/engine/tests/golden/challenge-matrix.golden.json`,
`packages/engine/tests/golden/momentum-rules.golden.json`,
`packages/engine/tests/golden/progress-rolls.golden.json`

---

### M0-08 · Contrats : protocole WebSocket et surface HTTP
**Taille** : moyenne · **Dépend de** : M0-05 · **Parallélisable** : oui

**À quoi ça sert.** Ici, l'invariant 3 devient mécanique : **aucun message venant du client ne
transporte un résultat**. Le test associé refuse à la compilation tout message `c2s.*` qui
porterait une jauge, un dé ou un état.

**Livrables**
- `src/ws/{envelope,c2s,s2c,codes}.ts` : enveloppe `{ v, t, id, ts, seq?, p }`, les **8** messages
  client et les **15** messages serveur de `01-architecture.md` §5, les codes de fermeture 4001-4011.
  Les deux derniers viennent de la preuve « Pourquoi ? » (P22) : `c2s.why
  { correlationId }`, message de **lecture** qui ne transporte aucun résultat, et
  `s2c.turn_proof { correlationId, proof: TurnProofDto, truncated: boolean }`, qui reprend le
  `zTurnProof` de M0-05 sans le redéclarer.
- `src/http/{auth,tables,characters,content,health}.ts` pour les routes de §6.
- `tests/ws-protocol.test.ts` (invariant 3) et `tests/envelope-fuzz.test.ts`.

**Critères d'acceptation**
- `pnpm --filter @for/contracts exec vitest run tests/ws-protocol.test.ts tests/envelope-fuzz.test.ts`
  sort en 0. *(Pas la suite entière du paquet : M0-09 et M0-12 y livrent en parallèle.)*
- `tests/ws-protocol.test.ts` sort en code non nul si l'on ajoute un champ `gauge` ou un
  `zGameEvent` à n'importe quel schéma `c2s.*` (le testeur applique le patch).
- `tests/envelope-fuzz.test.ts` passe 10 000 entrées aléatoires (chaînes, binaire, JSON
  malformé, profondeur 50) dans `zC2SEnvelope.safeParse` sans qu'aucune ne lève.
- Un test vérifie que `seq` n'est présent que sur `s2c.event` et que `chunk` n'apparaît que
  dans les charges utiles de narration.
- Un test compte les membres des deux unions : `zC2SMessage` en porte **8**, `zS2CMessage`
  **15**, et les deux listes sont sans doublon (`node -e` sur les `options` du
  `discriminatedUnion`).
- `c2s.why` ne porte **que** `correlationId` : le testeur y ajoute un champ `seq`, `outcome` ou
  `event` — `tests/ws-protocol.test.ts` sort en code non nul, comme pour tout autre `c2s.*`.
- Un test vérifie la **borne de taille** de `s2c.turn_proof` : une preuve construite au maximum
  de ses bornes (32 effets, libellés de 120 caractères) sérialise à **moins de 8 Kio**, et le
  schéma refuse au-delà. C'est la garantie qu'une preuve ne peut pas approcher la trame sortante
  de 256 Kio (`01-architecture.md` §5).
- `src/index.ts` n'a pas été modifié : `git diff --name-only` ne le mentionne pas.

**Fichiers touchés** : `packages/contracts/src/ws/**`, `packages/contracts/src/http/**`,
`packages/contracts/tests/ws-protocol.test.ts`,
`packages/contracts/tests/envelope-fuzz.test.ts`

---

### M0-09 · Contrats : schémas du contenu de jeu
**Taille** : moyenne · **Dépend de** : M0-05 · **Parallélisable** : oui

**À quoi ça sert.** Le contenu de jeu est du JSON relu en PR ; ces schémas empêchent un fichier
mal écrit de démarrer le serveur. Deux vérifications comptent plus que les autres : la
répartition d'attributs 3/2/2/1/1 et la **couverture complète d'un dé** par une table d'oracle.

**Livrables**
- `src/content/{common,effect,move,champion,champion-index,oracle,price-table,presage-table,region,asset,condition,truth,manifest,settings}.ts`,
  repris à la lettre de `03-donnees.md` §4.2 à §4.7, y compris `coversDie`, `AttributeSpreadSchema`,
  `ChampionSchema.aliases`, `ChampionIndexSchema` et `CampaignSettingsSchema` en `.strict()`.
- Tests unitaires par schéma.

**Critères d'acceptation**
- `pnpm --filter @for/contracts exec vitest run tests/content` sort en 0. *(Pas la suite entière
  du paquet : M0-08 et M0-12 y livrent en parallèle.)*
- Un test vérifie que `ChampionSchema` refuse une fiche **sans `aliases`** et qu'il en accepte
  une avec au moins un alias (champ obligatoire, `03-donnees.md` §4.5 — c'est la seule source
  du verrouillage de distribution), et que `ChampionIndexSchema` refuse deux champions qui
  partageraient un alias après normalisation.
- Un test vérifie qu'une table d12 à laquelle il manque l'entrée 9 est refusée avec le message
  « trou dans la table : 9..9 non couvert », et qu'un chevauchement est refusé distinctement.
- Un test vérifie que `PriceTableSchema` refuse une entrée **sans `keywords`** et une entrée dont
  un `keywords` contient un chiffre (`03-donnees.md` §4.6). Ce champ est obligatoire parce que
  l'assertion dure `price_respected` — qui est aussi un post-filtre de production — n'a aucune
  autre source contre laquelle vérifier que le prix imposé a bien été mis en scène.
- Un test vérifie que la répartition `[3,3,2,1,1]` est refusée et que `[3,2,2,1,1]` passe, dans
  n'importe quel ordre d'attributs.
- Un test vérifie qu'une clé inconnue dans `CampaignSettings` lève.
- Un test vérifie qu'un `op` inconnu dans `EffectSchema` est refusé.

**Fichiers touchés** : `packages/contracts/src/content/**`,
`packages/contracts/tests/content/**`

---

### M0-10 · Fixtures et assertions de domaine
**Taille** : moyenne · **Dépend de** : M0-05, M0-06 · **Parallélisable** : oui

**À quoi ça sert.** Règle transverse : **aucun test n'écrit un état de table à la main**. Sans
constructeurs partagés, un champ ajouté au moteur oblige à toucher cinquante fichiers de test.
Cette tâche livre aussi la campagne longue (≈ 2 000 événements), preuve de l'invariant 2.

**Livrables**
- `src/fixtures/{characters,table,events,campaigns}.ts` : `aCharacter()`, `aTableState()`,
  `anEvent()`, `LONG_CAMPAIGN`.
- `src/assertions.ts` : `expectValidState`, `expectNoReservedChampion`, `expectSeqContiguous`.

**Critères d'acceptation**
- `pnpm turbo run test --filter @for/testkit` sort en 0.
- Un test vérifie que l'état produit par `aTableState()` passe `zCampaignState.parse` sans
  aucune option, et que chaque constructeur a des valeurs par défaut complètes.
- Un test vérifie que `LONG_CAMPAIGN` contient ≥ 2 000 événements avec des `seq` contigus à
  partir de 1, et que `expectSeqContiguous` détecte un trou introduit volontairement.
- `expectNoReservedChampion` détecte un alias (pas seulement le nom d'affichage) : test sur
  « la Griffe de Givre » pour Sejuani. **L'assertion prend la liste d'alias en argument** et la
  fixture la fournit en dur : `@for/testkit` (vague 4) ne peut pas dépendre de
  `content/champions/` (vague 6) ni de `@for/content`. Un test vérifie aussi la normalisation :
  « LA GRIFFE-DE-GIVRE » et « la griffe de givre » sont détectés comme le même alias.

**Fichiers touchés** : `packages/testkit/src/fixtures/**`, `packages/testkit/src/assertions.ts`,
`packages/testkit/tests/**`

---

### M0-11 · Base : schéma Drizzle, migrations, ouverture SQLite
**Taille** : grosse · **Dépend de** : M0-05 · **Parallélisable** : oui

**À quoi ça sert.** Le DDL complet de `03-donnees.md` §1, y compris les trois triggers qui
rendent le journal **réellement** append-only. Ces triggers sont des contraintes, pas de la
discipline, et un test doré vérifie qu'une migration ne les a pas perdus.

**Livrables**
- `drizzle.config.ts`, `src/client.ts` (les sept PRAGMA de §0.2, `foreign_keys` repassé à
  chaque connexion), `src/schema/**` (les 21 tables, dont `scene_state` — `03-donnees.md` §1.4),
  `src/migrate.ts`.
- `migrations/0000_init.sql` + `migrations/meta/_journal.json`, écrits à la main là où
  drizzle-kit ne sait pas faire (triggers, index partiels), et `schema.expected.sql` normalisé.
- `tests/{pragmas,migrations,append-only}.test.ts`, sur base **fichier** temporaire (pas
  `:memory:`, à cause du WAL).

**Critères d'acceptation**
- `pnpm turbo run test --filter @for/db` sort en 0.
- `pnpm db:migrate` sur une base vide temporaire sort en 0, puis le dump normalisé est **égal
  octet à octet** à `schema.expected.sql` (assertion du test).
- Un `UPDATE events SET type='x'` et un `DELETE FROM events` lèvent tous les deux ; le message
  contient `append-only`.
- Un `INSERT` dans `events` avec un `seq` non alloué lève (`events_seq_dense`).
- Un `INSERT` dans `scene_state` avec neuf entrées dans `present_json` lève
  (`scene_state_present_bounded`) ; idem pour `absent_json`.
- Une insertion violant une clé étrangère lève (preuve que `foreign_keys` est bien actif sur la
  connexion, pas seulement dans le fichier).
- `pnpm db:check-schema` sort en 0 : aucune migration en attente **et** le dump normalisé est
  égal à `schema.expected.sql`. *(`drizzle-kit generate` n'a pas de drapeau `--check` ; la
  commande citée précédemment n'existait pas.)*
- Le testeur ajoute une colonne dans un fichier de `src/schema/` sans générer la migration :
  `pnpm db:check-schema` sort en 1.

**Fichiers touchés** : `packages/db/drizzle.config.ts`, `packages/db/src/{client,migrate}.ts`,
`packages/db/src/schema/**`, `packages/db/migrations/**`, `packages/db/schema.expected.sql`,
`packages/db/tests/{pragmas,migrations,append-only}.test.ts`, `packages/db/package.json`

---

## Vague 5 — Mouvements, chargeur, dépôts, schémas IA

### M0-12 · Contrats : schémas d'entrée-sortie de l'IA
**Taille** : moyenne · **Dépend de** : M0-09 · **Parallélisable** : oui

**À quoi ça sert.** Tout ce que le modèle produit entre par une seule porte : ces schémas. La
forge de fiches n'a **aucun privilège** — ce qu'elle remplit est un sous-ensemble dérivé du
schéma unique de champion.

**Livrables**
- `src/ai/narrator-port.ts` : **le port du conteur** (`02-mj-ia.md` §0.1) — `NarratorTextBlock`,
  `NarratorMessage`, `NarratorToolSpec`, `NarrateRequest`, `NarrateEvent`, `NarrateResult`,
  `StructureRequest<T>`, `StructureResult<T>`, `NarratorCapabilities`, `NarratorPort`,
  `NarratorConfig`, `NarratorErrorCode` et la classe `NarratorError`. **Aucun nom de
  fournisseur, aucun identifiant de modèle, aucun code HTTP.**
- `src/ai/scene.ts` : `SceneBlockSchema` — le bloc `<scene_apres>` que le conteur rend après sa
  prose (`02-mj-ia.md` §2.3), `.strict()`, avec ses bornes (8 présents, 8 partis, `nom` ≤ 40,
  `etat` ≤ 60, `cible` ≤ 60) et son champ `refus` nullable à quatre causes closes.
- `src/ai/narration.ts` (`zNarrationBrief`, `zNarrationOutput`), `src/ai/forge.ts`
  (`ForgeOutputSchema = ChampionSchema.omit({...})`), `src/ai/chronicle.ts` (`ChronicleDoc` avec
  ses plafonds durs et la provenance obligatoire par `event_seq`), `src/ai/tools.ts` (entrées et
  sorties des **12** outils de `02-mj-ia.md` §3.4 — ni plus, ni moins : **aucun outil de prix**,
  cf. P10), y compris le type `ReadOnlyTool` et son champ `journalOnly` (vide partout sauf
  `roll_oracle`, cf. P12).
- Tests unitaires associés.

**Critères d'acceptation**
- `pnpm --filter @for/contracts exec vitest run tests/ai` sort en 0. *(Pas la suite entière du
  paquet.)*
- Un test vérifie que `ForgeOutputSchema` omet exactement `schemaVersion`, `id`, `source`,
  `portraitUrl`, `relations`, `aliases`, et conserve **tous** les autres champs de
  `ChampionSchema` (comparaison de jeux de clés, pas de liste écrite à la main). `aliases` est
  omis délibérément : un modèle ne choisit jamais les noms sous lesquels on le reconnaîtra,
  ils viennent de `content/champions-index.json`.
- Un test vérifie qu'un `premise` de 401 caractères est refusé, et qu'un fait de chronique sans
  `event_seq` est refusé.
- Un test vérifie que `SceneBlockSchema` refuse une neuvième entrée dans `presents`, refuse une
  `cause` hors des quatre valeurs closes, refuse une clé inconnue (`.strict()`), et **accepte**
  un objet où `presents`, `partis`, `lieu` et `refus` sont tous absents — un bloc minimal ne doit
  jamais être une erreur (`02-mj-ia.md` §2.3, F5).
- Un test convertit chaque schéma d'outil en JSON Schema et vérifie
  `additionalProperties: false` partout et `required` complet.
- Un test vérifie que le schéma d'entrée de `propose_scene_transition` a exactement les clés
  `to_place_id` et `new_place_name` — **et pas de `time_shift`** (P11).
- **Neutralité du port, en deux commandes** (P18). La première interdit les **faits d'API** :
  `grep -rnE "claude-|gpt-|stop_reason|cache_control|output_config|@anthropic-ai" packages/contracts/src | wc -l`
  affiche `0`. La seconde borne les **noms de fournisseur** à l'unique endroit qui a le droit de
  les écrire — l'union `NarratorProviderId` :
  `grep -rlniE "anthropic|openai|ollama" packages/contracts/src` n'affiche que
  `packages/contracts/src/ai/narrator-port.ts`. *(Un critère qui interdirait ces trois mots
  partout serait faux par construction : le port doit bien nommer ses propres adaptateurs
  quelque part, et c'est là.)*
- Un test vérifie que `NarratorProviderId` vaut exactement
  `['stub','anthropic','openai-compatible','ollama']` et que le `CHECK` de `ai_calls.provider`
  (`03-donnees.md` §1.1) porte les mêmes quatre valeurs, dans le même ordre — les deux listes
  dérivent l'une de l'autre ou divergeront.

**Fichiers touchés** : `packages/contracts/src/ai/**`, `packages/contracts/tests/ai/**`

---

### M0-13 · Moteur : mouvements, décision, réducteur, repli narratif
**Taille** : grosse · **Dépend de** : M0-07, M0-10 · **Parallélisable** : oui

**À quoi ça sert.** Le cœur des invariants 1 et 4 : `decide()` tire les dés et tranche,
`reduce()` ne tire jamais rien et rejoue le journal à l'identique. La règle d'or est vérifiée par
le type : ajouter un événement sans le traiter dans le réducteur **ne compile pas**.

**Livrables**
- `src/moves/` : les 11 mouvements + `MOVE_REGISTRY`.
- `src/decide.ts` (retourne un `Result`, ne lève jamais), `src/reduce.ts` (`reduce`,
  `reduceAll`, `createInitialCampaignState`, `REDUCER_VERSION`), `src/invariants.ts`.
- La branche `scene.facts_updated` du réducteur : remplacement **total** de `CampaignState.scene`
  par l'instantané du payload, listes triées par `ref.id`. `scene.started` reconstruit `present`
  et **vide** `absent` ; `scene.ended` remet `scene` à `null`. Le réducteur ne juge rien : la
  monotonie des partis est garantie en amont, par la fusion serveur (`02-mj-ia.md` §4.7.3).
- `src/narration-fallback.ts` : repli déterministe qui choisit un gabarit **fourni par le
  contenu**, avec le flux RNG `fallback`.
- `src/index.ts` complété ; tests colocalisés + `tests/reduce.test.ts` +
  `tests/ai-cannot-mutate.test.ts`.

**Critères d'acceptation**
- `pnpm turbo run test --filter @for/engine -- --coverage` sort en 0 avec ≥ 95 % lignes / 90 % branches sur
  tout le paquet.
- Le testeur supprime une branche du `switch` de `reduce` : `pnpm typecheck` sort en code non
  nul (exhaustivité par le type, pas par un test).
- Un test vérifie que `reduceAll` appliqué deux fois au même journal donne le même hash d'état,
  et que `reduce` ne mute jamais son entrée (état gelé en développement).
- Un test rejoue `scene.started` → `scene.facts_updated` (sortie d'un PNJ) → `scene.facts_updated`
  (le même PNJ absent) et vérifie que `state.scene.absent` le contient une seule fois, que
  `state.scene.present` ne le contient plus, et que les deux listes sont triées par `ref.id`.
- Un test vérifie qu'un `system.reverted` portant sur le groupe d'un tour restaure **exactement**
  l'état d'avant la déclaration : jauges, souffle, conditions, crans de progression, segments
  d'horloge et fenêtre de brûlure (comparaison de hash d'état).
- `tests/ai-cannot-mutate.test.ts` : tout événement de jauge portant `actorKind: 'gm_ai'` est
  rejeté.
- Un test de fuzz passe 500 intentions valides syntaxiquement à `decide` : aucune exception, un
  `Result` dans tous les cas.
- `LC_ALL=C.UTF-8 grep -rlnP '[À-ÖØ-öø-ÿŒœ]' packages/engine/src | wc -l` affiche toujours `0`
  (les gabarits de repli viennent du contenu) — **la même classe qu'en M0-02**, la seule qui
  couvre les majuscules accentuées et `œ`.

**Fichiers touchés** : `packages/engine/src/moves/**`,
`packages/engine/src/{decide,reduce,invariants,narration-fallback,index}.ts`,
`packages/engine/tests/{reduce,ai-cannot-mutate}.test.ts`, `packages/engine/tests/moves/**`

---

### M0-14 · Chargeur de contenu, registre, index généré
**Taille** : grosse · **Dépend de** : M0-09 · **Parallélisable** : oui

**À quoi ça sert.** Le contenu n'est jamais lu depuis le disque à l'exécution : il est importé
statiquement par un fichier généré. Le chargeur fait quatre passes et **échoue bruyamment** au
démarrage plutôt que de laisser un `undefined` remonter jusque dans le prompt du conteur.

**Livrables**
- `src/{load,registry,validate,manifest,index,ui}.ts`, `src/generated/index.ts` (généré),
  `data/labels/{attributes,gauges,outcomes,ui}.json`.
- `scripts/generate-content-index.ts` et la **cible** de `pnpm content:index` /
  `pnpm content:check`. Les deux existent déjà dans le `package.json` racine depuis M0-01, son
  propriétaire unique : **cette tâche ne modifie pas le `package.json` racine**. Si un script
  manque, elle s'arrête et le remonte (règle 3).
- `content-fixtures/` : un bundle **minimal valide** (2 champions, 3 mouvements, 1 table de
  prix, 2 oracles) pour les tests rapides, et une copie volontairement cassée pour tester le
  rapport d'erreurs.
- `tests/{content-validity,generated-index}.test.ts`.

**Critères d'acceptation**
- `pnpm content:check --root content-fixtures` sort en 0.
- `pnpm content:check --root content-fixtures-broken` sort en **1**, et sa sortie contient
  **exactement trois** lignes commençant par `→` (`grep -c '^\s*→'` vaut 3 — les trois erreurs
  sont rapportées d'un coup, pas la première seulement) et **au moins une** ligne contenant
  `(suggestion :` (distance de Levenshtein). Le format est celui de `03-donnees.md` §4.8.
- `pnpm content:index && git diff --exit-code` sort en 0.
- Un test vérifie qu'une référence circulaire entre régions est refusée, et qu'un `id`
  différent du nom de fichier est refusé.
- `grep -rn "readFileSync\|fs\." packages/content/src --include=*.ts | grep -v load.ts` ne
  renvoie rien (aucun accès disque hors du chargeur).

**Fichiers touchés** : `packages/content/src/**`, `packages/content/data/labels/**`,
`packages/content/tests/**`, `packages/content/package.json`,
`scripts/generate-content-index.ts`, `content-fixtures/**`, `content-fixtures-broken/**`

---

### M0-15 · Base : dépôts, journal, allocation de séquence
**Taille** : moyenne · **Dépend de** : M0-11 · **Parallélisable** : oui

**À quoi ça sert.** Le seul chemin d'écriture de l'état de partie. L'allocation de `seq` en un
seul `UPDATE ... RETURNING` sérialise les écritures ; l'idempotence par identifiant d'intention
est la seule protection sérieuse contre le double-jet sur réseau instable.

**Livrables**
- `src/repositories/{events,campaigns,characters,players,chronicles,aiCalls}.ts` :
  `appendEvents` (transaction `BEGIN IMMEDIATE`), `readSince(seq)`, `lastSeq`, insertion
  idempotente d'intention.
- `src/index.ts` complété ; `tests/events-repo.test.ts`.

**Critères d'acceptation**
- `pnpm turbo run test --filter @for/db` sort en 0.
- Un test insère 100 lots d'événements et vérifie que les `seq` sont denses de 1 à N et que
  `campaigns.seq` est égal au maximum.
- Un test fait échouer la troisième insertion d'un lot de trois et vérifie qu'**aucune** ligne
  n'est écrite (atomicité).
- Un test rejoue deux fois la même intention (même identifiant client) et vérifie qu'aucun
  nouvel événement n'est produit et que le résultat renvoyé est identique.
- `grep -rn "fetch\|http" packages/db/src | wc -l` affiche `0` (aucun appel réseau dans la
  couche base).

**Fichiers touchés** : `packages/db/src/repositories/**`, `packages/db/src/index.ts`,
`packages/db/tests/events-repo.test.ts`

---

## Vague 6 — Contenu, reconstruction, prompts, page table, serveur

### M0-33 · Moteur et contrats : le brief est adressé et porte ses faits perceptibles
**Taille** : moyenne · **Dépend de** : M0-13 · **Parallélisable** : oui ·
**Bloque** : M0-18, M0-22

**À quoi ça sert.** Porter la décision 3 de l'ADR 0008 — *« le moteur calcule, pour chaque
destinataire, la liste des faits perceptibles, et le conteur n'a le droit d'utiliser que
celle-là »* — dans un **type**, avant que M0-18 ne gèle les prompts et la surface d'outils.

Aujourd'hui elle n'est portée par rien. Le développeur de M0-12 l'a écrit sans le contourner,
dans l'en-tête de `packages/contracts/src/ai/narration.ts` : *« a field added here alone would be
a contract nothing produces »*. Il avait raison — le porteur va sur le type du moteur d'abord, le
miroir suit.

**Ce qui rend la contrainte mécanique et pas décorative.** Ce n'est pas le champ, c'est le
**canal**. Tant que `@for/ai` bâtit le bloc `<scene>` depuis `state.scene`, filtrer la sortie du
conteur ne sert à rien : l'information est déjà dans sa fenêtre de contexte. Le changement qui
porte est que `@for/ai` lit `brief.perceivableFacts` **et rien d'autre**.

**Le périmètre M0, dit en clair.** La bande reste groupée — `DEFAULT_SCOPE` vaut `table` et la
portée par groupe attend M1 (ADR 0008 décision 1). Le filtre est donc **l'identité** en M0, et
c'est normal. Ce qui entre maintenant est le champ, la fonction de filtrage et le canal étroit ;
M1 ne change que ce que le filtre renvoie — pas le contrat, pas le prompt, pas le corpus doré.

**Livrables**
- `packages/engine/src/types/brief.ts` : `BriefAudience` (`scope`, `recipients`) et
  `BriefPerceivableFact`, plus les deux champs correspondants sur `NarrationBrief`.
- `packages/engine/src/decide.ts` : `buildBrief` les produit. Le filtrage vit dans une fonction
  **nommée et exportée**, pas en ligne — c'est elle que M1 changera.
- `packages/contracts/src/ai/narration.ts` : le miroir Zod, et l'en-tête « WHAT IS NOT HERE »
  retiré parce qu'il ne l'est plus.
- `packages/contracts/tests/exhaustive-union.test.ts` : les constantes neuves comparées membre à
  membre, per ADR 0007.

**Critères d'acceptation**
- `pnpm turbo run build typecheck lint test --force` sort en 0 sur le dépôt entier.
- `brief.audience.recipients` est `null` **exactement quand** `scope` vaut `table` : un test
  écrit les deux sens et le testeur casse chacun.
- Un test vérifie que `perceivableFacts` est **dérivé de la scène**, pas recopié : le testeur
  retire une présence de `state.scene.present`, le fait correspondant disparaît du brief.
- Un test vérifie que la liste est **triée** et **bornée** comme `SceneState` l'est
  (`SCENE_PRESENCE_MAX`), avec au moins **deux** entrées dans la fixture et une assertion de
  **tableau exact** — pas un ensemble, pas deux côtés triés. *(Trois tris inertes ont déjà été
  trouvés sur ce dépôt pour cette raison exacte : fixture à un seul élément.)*
- Le miroir Zod rougit quand le type du moteur gagne un champ, per ADR 0007 : le testeur ajoute
  un champ à `NarrationBrief`, `pnpm turbo run typecheck --force` sort en code non nul.
- **Aucun chiffre ne se compare à lui-même**, et aucun littéral de test n'est importé de `src/`.
- `perceivableFacts` ne porte **aucun chiffre de jeu** — ni jauge, ni segment, ni rang — comme
  `SceneState` n'en porte pas (propriété 1 de `03-donnees.md` §3.5). Un test le vérifie.

**Ce que cette tâche NE fait PAS**
- Les atouts de perception de l'ADR 0009 (`domaine`, `declencheur`, `force`, `frequence`,
  `effet`) : ce sont du **contenu**, ils arrivent en M0-16 et s'équilibrent en M1. Ici on livre
  le **porteur**, pas ce qui le remplit.
- La portée par groupe, le tchat par joueur, le drapeau de discrétion : M1.
- Brancher `@for/ai` sur le champ : c'est **M0-18**, qui prend cette tâche en dépendance.

**Fichiers touchés** : `packages/engine/src/types/brief.ts`, `packages/engine/src/decide.ts`,
`packages/engine/src/decide.test.ts`, `packages/contracts/src/ai/narration.ts`,
`packages/contracts/tests/ai/narration.test.ts`,
`packages/contracts/tests/exhaustive-union.test.ts`

---

### M0-16 · Contenu de jeu versionné (règles, monde et fiches de champion)
**Taille** : grosse · **Dépend de** : M0-13, M0-14 · **Parallélisable** : oui

**À quoi ça sert.** La matière du jeu : les onze mouvements, les oracles, la table « payer le
prix », les présages, les conditions, les vérités du Freljord, les régions, les atouts, les
gabarits de narration de repli, l'annuaire des champions et les trois fiches jouables du seed.
Tout en français, tout relu en PR, rien en base.

> **Pourquoi les fiches de champion sont ici.** `pnpm content:check` valide le bundle **entier** :
> passe 4 compare `expectedCounts` du manifeste à ce qui a été chargé, et exige que chaque fiche
> ait son entrée d'annuaire. Sans champion, le manifeste ne peut pas déclarer un
> `expectedCounts.champions` positif et la commande ne peut pas sortir en 0. Livrer le contenu
> sans les fiches, puis les fiches dans une vague suivante, c'est écrire une tâche dont le
> critère principal est faux par construction. M0-21 est donc absorbée ici.

**Livrables**
- `content/moves/*.json` (les 11), `content/oracles/*.json` (les 9, dont `yes-no`),
  `content/tables/{pay-the-price,presages}.json`, `content/conditions.json`,
  `content/truths/freljord-truths.json`, `content/regions/*.json` (≥ 5, en forêt),
  `content/assets/*.json` (≥ 6), `content/fallbacks/narration.json`, `content/manifest.json`.
- `content/champions-index.json` : l'annuaire (`id`, `displayName`, région canonique,
  **`aliases`**, `playable`). **Périmètre M0** : les champions cités par le contenu et le seed,
  plus ceux du Freljord — pas les 170. Le fichier existe, son schéma est validé ; le compléter
  est un chantier de contenu de M1 (`02-mj-ia.md` §11.2 point 5).
- `content/champions/{braum,ashe,sejuani}.json` : trois fiches **écrites à la main**, chacune
  avec ses alias complets, sa voix, ses atouts de départ, son serment. Fiches de référence
  auxquelles la forge IA sera comparée : même schéma, sans privilège.
- `packages/content/tests/game-content.test.ts` : le fichier de test que les critères ci-dessous
  exigent. *(Sans lui, « un test vérifie que… » n'est pas un critère d'acceptation.)*

**Critères d'acceptation**
- `pnpm content:check` sort en 0.
- `pnpm content:index && git diff --exit-code` sort en 0.
- `pnpm --filter @for/content exec vitest run tests/game-content.test.ts` sort en 0, et ce test
  vérifie que :
  - `content/fallbacks/narration.json` couvre **chaque** couple (mouvement, issue) avec au
    moins 2 variantes — le testeur retire une variante, le test rougit en nommant le couple ;
  - `pay-the-price` a exactement 12 entrées couvrant 1..12, chaque entrée porte au moins un
    `keywords` non vide et sans chiffre (c'est la seule donnée contre laquelle l'assertion dure
    `price_respected` sait noter, `02-mj-ia.md` §8.4), et chaque oracle couvre intégralement
    son dé ;
  - toutes les références croisées se résolvent (atouts, conditions, régions, oracles) et
    aucune région n'est sa propre ancêtre ;
  - les trois fiches portent `source: 'handwritten'`, une répartition 3/2/2/1/1 et **au moins
    un alias en plus du nom** ;
  - chaque fiche a une entrée dans `champions-index.json` avec le même `id`, les mêmes
    `aliases` et la même région ; le testeur retire un alias d'un des deux côtés, le test
    rougit ;
  - aucune fiche ne cite un autre champion de l'annuaire dans ses champs de texte (même
    normalisation que l'assertion `no_reserved_champion`).

**Fichiers touchés** : `content/moves/**`, `content/oracles/**`, `content/tables/**`,
`content/conditions.json`, `content/truths/**`, `content/regions/**`, `content/assets/**`,
`content/fallbacks/narration.json`, `content/champions/**`, `content/champions-index.json`,
`content/manifest.json`, `packages/content/src/generated/index.ts`,
`packages/content/tests/game-content.test.ts`

---

### M0-17 · Base : reconstruction et les douze oracles d'intégrité
**Taille** : moyenne · **Dépend de** : M0-13, M0-15 · **Parallélisable** : oui

**À quoi ça sert.** La preuve de l'invariant 4 : les projections sont jetables. Le contrôle 9
(vider, rejouer, comparer octet à octet) est le seul dispositif qui attrape une projection mutée
hors du réducteur — sinon, un bug silencieux découvert trois mois plus tard.

**Livrables**
- `src/rebuild.ts` (tronque les projections, rejoue le journal, une transaction par campagne),
  `src/check.ts` (les 12 oracles de `03-donnees.md` §7.3, avec la reformulation du contrôle 11
  décidée au point P4), scripts `db:rebuild` et `db:check` du paquet.
- `tests/{rebuild,check}.test.ts`.

**Critères d'acceptation**
- `pnpm turbo run test --filter @for/db` sort en 0.
- Sur une base construite en test : `pnpm db:check` sort en 0 et n'affiche aucune ligne.
- Le testeur modifie directement une jauge dans la table `characters` : `pnpm db:check` sort en
  **1** et nomme le contrôle 9.
- Le testeur supprime un instantané : `pnpm db:rebuild` puis `pnpm db:check` sortent en 0
  (la reconstruction est idempotente).
- Un test vérifie qu'une campagne en cours de reconstruction refuse les intentions et que les
  autres campagnes ne sont pas touchées.
- **Trancher le tri de `truths`, et l'écrire.** `withTruth` (`packages/engine/src/reduce.ts`)
  termine par un `.sort()` sur `truthId` que **rien ne garde** : comparateur inversé ou tri
  retiré entièrement, 563/563 verts. Mesuré en recette de M0-13. La seule fixture qui touche
  `truths` n'en pose qu'une, et une liste d'un élément est triée quoi qu'il arrive. Ce tri n'est
  justifié par aucun commentaire et n'est visé par aucun critère — la propriété de préfixe de
  cache de `03-donnees.md` §3.5 porte sur le bloc `<scene>`, pas sur les vérités. Deux issues
  recevables : deux vérités dans la fixture et un `toEqual` de tableau exact, **ou** retirer le
  tri. Pas de troisième.

**Fichiers touchés** : `packages/db/src/{rebuild,check}.ts`, `packages/db/src/index.ts`
(ré-exports uniquement — le fichier a été créé par M0-15, vague précédente),
`packages/db/tests/{rebuild,check}.test.ts`, `packages/db/package.json`

---

### M0-18 · IA : le port du conteur, ses adaptateurs, les prompts et la surface d'outils gelée
**Taille** : grosse · **Dépend de** : M0-33, M0-12, M0-14 · **Parallélisable** : oui

**À quoi ça sert.** Deux choses qui tiennent ensemble. Le garde-fou de l'invariant 1 côté
modèle : douze outils, en lecture ou en proposition, dans un ordre figé. Un outil qui
trancherait une issue ne doit pas pouvoir exister, et un changement d'ordre invaliderait le
cache de prompt de toutes les campagnes — donc il doit être visible en revue. Et
l'**indépendance de fournisseur** : le serveur parle à un port, pas à une API, ce qui rend le
projet jouable avec un fournisseur gratuit ou un modèle local (P18).

**Livrables**
- `src/narrator/port.ts` (ré-export des types de `@for/contracts` + `NarratorError`) et
  `src/narrator/select.ts` (`selectNarrator(config): NarratorPort`).
- **Les quatre implémentations du port** (`02-mj-ia.md` §0.2 à §0.6) :
  `src/narrator/adapters/stub.ts` (gabarits de repli, zéro réseau — c'est lui qui fait tourner
  la CI et le simulateur), `adapters/anthropic.ts`, `adapters/openai-compatible.ts`,
  `adapters/ollama.ts`. Chacun **annonce ses capacités** et **classe ses erreurs** dans
  `NarratorErrorCode` ; aucun ne laisse fuir une exception de SDK, de `fetch` ou de parseur.
- `src/prompts/{conteur.system,conteur.campaign,chronicle.system,forge.system}.ts` — textes
  **intégraux** de `02-mj-ia.md`, avec leurs constantes de version. `CONTEUR_PROMPT_VERSION`
  vaut `"conteur/2.0.0"` : le texte porte l'ancrage de registre, la liste noire, les
  obligations, **la paire d'exemples bon/mauvais**, les faits de scène, le droit de refus et la
  spécification du bloc `<scene_apres>`. Aucun de ces morceaux n'est facultatif ; ils viennent
  d'une session réellement jouée (P15 à P17). Le prompt porte aussi les règles 6 (prix imposé,
  P10) et 7 (pas de saut de temps, P11).
- `src/tools/definitions.ts` (les 12 outils, ordre exact, `Object.freeze`, `TOOLS_VERSION`) et
  `src/tools/handlers.ts` (exécution des lectures, validation des propositions).
- `tests/tool-surface.test.ts`, `tests/prompt-size.test.ts`, `tests/tools.snapshot.json`,
  `tests/narrator-port.contract.test.ts`, `tests/narrator-errors.test.ts`,
  `tests/no-env.test.ts`, `tests/setup.ts` (toute sortie réseau fait échouer le test).
- `tests/spec-neutrality.test.ts` : le test de documentation de `02-mj-ia.md` §0.7. Il lit
  `docs/design/02-mj-ia.md` et applique les **deux** règles N1 (faits d'API) et N2 (noms de
  fournisseur) avec leurs exemptions nominatives. Sans lui, la neutralité de la spec n'est
  gardée par rien et se perd en trois mois de retouches — la spec l'exige déjà, aucune tâche ne
  le livrait.

**Critères d'acceptation**
- `pnpm turbo run test --filter @for/ai` sort en 0 **sans aucune variable `NARRATOR_*`** dans
  l'environnement (`env -u NARRATOR_PROVIDER -u NARRATOR_API_KEY`).
- `tests/narrator-port.contract.test.ts` rejoue **le même** contrat contre les **quatre**
  adaptateurs, transport simulé : exactement un `end`, toujours en dernier ; `result.text`
  égal à la concaténation des `delta` ; une erreur levée depuis l'itérateur et jamais autre
  chose qu'un `NarratorError` ; `abortSignal` déclenché ⇒ un `end` portant
  `finish: 'aborted'` **et le texte partiel**. Le testeur supprime l'émission du `end` final
  d'un adaptateur : le test sort en code non nul.
- `tests/narrator-errors.test.ts` : pour chaque adaptateur, une réponse 401, 429, 404, 400 et
  5xx simulée produit respectivement `unauthenticated`, `rate_limited`, `model_not_found`,
  `bad_request`, `unavailable` — et **aucun** `internal`. Un 429 avec `Retry-After: 3` produit
  `retryAfterMs === 3000`.
- `tests/no-env.test.ts` : `grep -rn "process\.env" packages/ai/src | wc -l` affiche `0`. Le
  testeur ajoute un `process.env.NARRATOR_MODEL` dans un adaptateur : le test sort en code non
  nul. (C'est la frontière qui rend l'éval exécutable hors serveur.)
- `grep -rniE "anthropic|openai|ollama|claude-|gpt-|stop_reason|cache_control" packages/ai/src
  --exclude-dir=narrator | wc -l` affiche `0` : **hors du dossier `narrator/`**, rien ne nomme un
  fournisseur. L'exclusion porte sur `narrator/` entier et pas seulement sur `narrator/adapters/`,
  parce que `select.ts` doit forcément nommer les quatre adaptateurs pour les choisir ; c'est le
  seul autre fichier du paquet qui en a le droit.
- `pnpm --filter @for/ai exec vitest run tests/spec-neutrality.test.ts` sort en 0. Le testeur
  ajoute la chaîne `stop_reason` dans une section de `02-mj-ia.md` hors §0.3–§0.6 : le test sort
  en code non nul en citant la ligne.
- Le testeur ajoute un outil nommé `set_gauge` : `tests/tool-surface.test.ts` sort en code non
  nul. Idem pour un outil qui ne serait ni `ReadOnlyTool` ni `ProposalTool`.
- Le testeur permute deux entrées de `TOOL_DEFINITIONS` sans changer `TOOLS_VERSION` : le test
  d'instantané sort en code non nul avec un diff lisible.
- `tests/tool-surface.test.ts` vérifie que le schéma d'entrée de `propose_scene_transition`
  **ne porte pas de clé `time_shift`**, et qu'aucun schéma d'outil ne porte de clé `optionId`
  (P10, P11).
- `tests/prompt-size.test.ts` sort en code non nul si l'on retire un tiers du prompt système
  (seuil de **1 900 tokens**, mesuré par l'estimateur local calibré, référence commitée).
- Un test vérifie que `CONTEUR_SYSTEM_PROMPT` contient les deux exemples de `02-mj-ia.md` §2.1 —
  recherche des ancres `MAUVAIS :` et `BON :` — et **tous** les termes de la liste noire de
  l'assertion `banned_style_lexicon`. C'est le seul garde-fou contre une réécriture du prompt
  qui garderait les règles et jetterait ce qui les rend efficaces.
- Un test vérifie que `CONTEUR_SYSTEM_PROMPT` porte les règles 6 (prix imposé, P10) et 7 (pas
  de saut de temps, P11).
- **Aucun test de cette tâche n'ouvre une socket** : `tests/setup.ts` fait échouer toute sortie
  réseau, et le comptage exact de tokens reste au nocturne (§ 4.2).
- Un test vérifie qu'aucun nom interdit (`apply_damage`, `set_gauge`, `resolve_move`,
  `roll_dice`, `kill_character`, `advance_vow`, `spend_momentum`, `propose_price`) n'apparaît
  dans le registre.
- **`FORBIDDEN_TOOL_NAMES` est épinglé avant d'être parcouru.** Le tuple vit dans
  `@for/contracts` (`src/ai/tools.ts`) et le seul test qui le lit aujourd'hui **itère dessus** :
  le vider ne fait donc rien échouer. Mesuré en recette de M0-12 — tuple réduit à
  `['apply_damage']`, 569/569 verts. `tests/tool-surface.test.ts` écrit les huit noms ci-dessus
  **en toutes lettres** et les compare à `FORBIDDEN_TOOL_NAMES` par `toStrictEqual` **avant** de
  s'en servir comme source de boucle. Preuve dans les deux sens : un nom retiré du tuple rougit,
  restauré vert.

**Fichiers touchés** : `packages/ai/src/index.ts`, `packages/ai/src/narrator/**`,
`packages/ai/src/prompts/**`, `packages/ai/src/tools/**`,
`packages/ai/tests/{tool-surface,prompt-size,narrator-port.contract,narrator-errors,no-env,spec-neutrality}.test.ts`,
`packages/ai/tests/tools.snapshot.json`, `packages/ai/tests/setup.ts`,
`packages/ai/package.json`, `packages/ai/vitest.config.ts`

---

### M0-19 · Client : SPA et page « table » branchée sur le WebSocket
**Taille** : grosse · **Dépend de** : M0-08, M0-14 · **Parallélisable** : oui

**À quoi ça sert.** L'écran minimal exigé par la définition de fini : une page table **vide**
qui se connecte, affiche l'accueil, l'instantané et la présence. Le point important n'est pas
l'ergonomie : le client ne détient **aucune** autorité, il applique les événements reçus pour
l'affichage et se fait écraser par chaque instantané.

**Livrables**
- `index.html`, `vite.config.ts`, `src/{main.tsx,App.tsx,env.ts}`,
  `src/api/{http,queries,error-messages}.ts`, `src/ws/{socket,store}.ts` (reconnexion
  exponentielle, reprise par `deliverySeq`, `safeParse` sur chaque trame),
  *(ADR 0010 décision 1 : la reprise porte `sinceDeliverySeq`, le numéro de livraison dense
  par joueur. « Reprise par `lastSeq` » est caduc — `sinceSeq` n'existe plus sur la socket.)*
  `src/routes/{Login,CampaignList,TableRoom,CharacterPicker}.tsx`,
  `src/features/table/**` (journal, présence, coquilles vides), `src/components/ui/**`,
  `src/styles/**`.
- `src/features/table/Proof/**` : la commande **« Pourquoi ? »** (P22), attachée à
  **chaque scène** du journal, **repliée par défaut** — aucun dé, aucun calcul, aucun effet,
  aucun prix, aucun présage n'est affiché tant que personne ne l'ouvre : la fiction reste
  propre. Ouvrir envoie `c2s.why { correlationId }` (le `correlationId` vient de l'enveloppe des
  `s2c.event` déjà reçus, `03-donnees.md` §3.1) et affiche le `s2c.turn_proof` reçu, tel quel.
  Le client **ne recompose jamais** une preuve depuis son état local : il affiche la projection
  du serveur, ou rien.
- Le traitement de `system.reverted` dans `src/ws/store.ts` : les lignes dont le `seq` figure
  dans `targetSeqs` sont **marquées annulées**, avec la cause portée par `reason`, et
  **conservées à l'écran avec leur commande « Pourquoi ? »**. Elles ne sont jamais retirées.
- Tests de composants purs et du store WS.

**Critères d'acceptation**
- `pnpm turbo run build --filter @for/client` et `pnpm turbo run test --filter @for/client` sortent en 0.
- Le testeur ajoute `import { decide } from '@for/engine'` dans un fichier du client :
  `pnpm lint` sort en code non nul.
- Un test envoie au store une trame `s2c.event` malformée : aucune exception, et le store
  demande une resynchronisation.
- Un test vérifie qu'un `s2c.snapshot` écrase intégralement l'état local, et qu'un trou de
  `deliverySeq` déclenche un `c2s.resume`.
  *(ADR 0010 décision 1 : depuis l'ADR 0008 la diffusion est adressée, donc un trou de `seq` est
  **légitime** chez un joueur qui n'était pas destinataire. Le surveiller ferait redemander sans
  fin des événements auxquels il n'a pas droit. Le critère se mesure dans les deux sens : un trou
  de `deliverySeq` déclenche une reprise, un trou de `seq` seul n'en déclenche aucune.)*
- Un test livre les numéros de livraison 3 puis 1 puis 2 et attend `[1, 2, 3]` dans les lignes du
  journal : le fil se lit dans l'ordre des livraisons, pas dans l'ordre d'arrivée. Le testeur
  retire le tri de `applyEvent` : le test sort en code non nul.
- Un test vérifie qu'un `s2c.events_batch` dont la **première entrée** saute le curseur déclenche
  un `c2s.resume`, qu'un lot qui prend la suite du curseur n'en déclenche aucun, et que le même
  lot à trou reçu deux fois n'en redemande qu'un seul.
- Un test du store applique un `system.reverted` portant `targetSeqs: [412, 413, 414]` : les
  trois lignes sont toujours présentes dans le journal affiché, **marquées annulées**, avec la
  cause lisible. Le testeur remplace le marquage par une suppression : le test sort en code non
  nul. *(P22 : un tour annulé se montre, il ne disparaît pas.)*
- Un test de rendu vérifie qu'une scène **non dépliée** n'affiche aucun chiffre de dé, aucun
  total, aucun nom d'effet ni aucun libellé de prix, et qu'un clic sur « Pourquoi ? » émet
  exactement un `c2s.why { correlationId }` — jamais un `c2s.intent`, jamais deux envois pour un
  clic.
- Un test vérifie que le panneau de preuve rend **uniquement** ce que porte `s2c.turn_proof` :
  le testeur retire le `roll` de la charge utile reçue, la ligne « jet » disparaît de l'affichage
  au lieu d'être reconstruite depuis l'état local.
- `grep -rn "@for/db\|@for/ai\|@for/server" packages/client/src | wc -l` affiche `0`.

**Fichiers touchés** : `packages/client/index.html`, `packages/client/vite.config.ts`,
`packages/client/src/**`, `packages/client/tests/**`, `packages/client/package.json`

---

### M0-20 · Serveur : socle applicatif, environnement, santé
**Taille** : moyenne · **Dépend de** : M0-08, M0-11, M0-14 · **Parallélisable** : oui

**À quoi ça sert.** Le processus, sa configuration validée au démarrage, ses journaux avec
rédaction des secrets, ses sondes de santé, et surtout **le point de composition** : `app.ts`
enregistre quatre greffons (auth, HTTP, WebSocket, jeu) livrés en vague 7. C'est ce qui permet à
trois agents de travailler en parallèle sur le serveur.

**Livrables**
- `src/main.ts` (charge l'environnement, ouvre la base, migre sous verrou, écoute),
  `src/app.ts` (`buildApp(deps)`, n'écoute pas, enregistre les quatre greffons **et ne sera plus
  modifié**), `src/env.ts` (`zEnv.parse`, crash explicite), `src/deps.ts` (`AppDeps`),
  `src/logger.ts` (pino + rédaction), `src/errors.ts` (`AppError`, `errorHandler`).
- `src/http/health.ts` (`/healthz`, `/readyz`, `/api/admin/health`).
- `src/game/types.ts` : **interfaces seules** — `CampaignService` (dont `getTurnProof`,
  `01-architecture.md` §2.8), `NarratorPort` (ré-exporté de `@for/contracts`),
  `SubmitIntentInput/Result` — que M0-24 implémentera et que M0-25 consommera. `getTurnProof`
  figure **ici**, dans l'interface, parce que M0-25 la consomme dans la même vague que M0-24
  l'implémente (P22).
- Les quatre modules-greffons vides `src/{auth,http,ws,game}/index.ts`.
- `tests/http/health.test.ts`.

**Critères d'acceptation**
- `pnpm turbo run test --filter @for/server` sort en 0.
- `app.inject({ method:'GET', url:'/healthz' })` renvoie 200 **sans** base ouverte.
- `/readyz` renvoie 503 tant que les migrations ne sont pas appliquées, 200 après.
- Lancer `node dist/main.js` sans `SESSION_SECRET` sort en code 1 et écrit le nom de la
  variable manquante sur la sortie d'erreur.
- Un test vérifie qu'un journal contenant un cookie ou `NARRATOR_API_KEY` ressort rédigé.
- **Le verdict `healthy` d'`/api/admin/health` est exercé conjonction par conjonction.** Ses six
  conditions ne sont observées par aucun test aujourd'hui : mesuré en recette, la comparaison du
  WAL à son plafond **inversée** laisse `tsc -b --force` à 0 et les 33 tests du paquet verts — un
  WAL plus gros que le plafond devient une raison d'être sain sans qu'une ligne rougisse. Sortir
  le verdict en fonction pure des six champs déjà calculés, et l'exercer dans les deux sens : une
  lecture saine sauf ce champ rend `false`, le même champ dans les clous rend `true`.
- `grep -rn "process.env" packages/server/src | grep -v "src/env.ts" | wc -l` affiche `0`.
- Un test vérifie que `zEnv` applique la validation **conditionnelle** du conteur
  (`02-mj-ia.md` §0.6) : `NARRATOR_PROVIDER=openai-compatible` sans `NARRATOR_BASE_URL` échoue
  en nommant la variable ; `NARRATOR_PROVIDER=ollama` avec `NARRATOR_API_KEY` **vide** passe ;
  `NARRATOR_PROVIDER=stub` passe sans aucune autre variable. Et que les trois variables
  d'appoint reçoivent leurs **valeurs par défaut** (`NARRATOR_TOOLS='probe'`,
  `NARRATOR_TIMEOUT_MS=60000`, `NARRATOR_CONTEXT_WINDOW=null`) : `buildNarrator`
  (`01-architecture.md` §2.8) les lit sans condition, donc `undefined` y serait un bug de
  configuration silencieux.

**Fichiers touchés** : `packages/server/src/{main,app,env,deps,logger,errors}.ts`,
`packages/server/src/http/health.ts`, `packages/server/src/game/types.ts`,
`packages/server/src/{auth,http,ws,game}/index.ts`,
`packages/server/tests/http/health.test.ts`, `packages/server/package.json`

---

## Vague 7 — Contexte IA, Discord, orchestration, sockets, sonde de fumée

### M0-21 · ~~Contenu : les trois fiches de champion du seed~~ — **absorbée par M0-16**

Cette tâche n'existe plus. Ses livrables (`content/champions/{braum,ashe,sejuani}.json`,
`expectedCounts`) sont passés dans **M0-16**, seule tâche autorisée à écrire dans `content/**` et
`content/manifest.json`.

**Raison** : M0-16 et M0-21 se partageaient `content/manifest.json` et
`packages/content/src/generated/index.ts`, et surtout le critère d'acceptation principal de
M0-16 (`pnpm content:check` sort en 0) était **impossible à satisfaire** sans les fiches que
M0-21 devait livrer une vague plus tard. Une tâche dont le critère dépend d'une tâche qui vient
après elle n'est pas une tâche.

**Conséquence sur les dépendances** : M0-26 et M0-27 dépendaient de M0-21 ; elles dépendent
désormais de **M0-16**. La vague 7 est passée de cinq à quatre tâches, puis **revenue à cinq**
avec l'ajout de M0-32 par P23 — c'est ce que portent §2 et §4.

---

### M0-22 · IA : contexte, budget, assertions, forge et chronique (parties pures)
**Taille** : grosse · **Dépend de** : M0-18 · **Parallélisable** : oui

**À quoi ça sert.** La réponse à l'invariant 2 : le contexte est **reconstruit** à chaque appel,
borné, et il pèse la même chose au sixième mois qu'à la deuxième semaine. Les assertions livrées
ici servent deux fois — notation dans l'éval, post-filtre en production.

**Livrables**
- `src/context/builder.ts` (l'ordre exact des blocs de `02-mj-ia.md` §4.1, échappement du texte
  joueur), `src/context/scene-render.ts` (rendu **déterministe** du bloc `<scene>` depuis
  `SceneState` : listes triées par `ref.id`, et ligne « aucun » explicite quand `absent` est
  vide — une absence de ligne se lit comme une absence d'information) et `src/context/budget.ts`
  (estimateur local + échelle de troncature T1→T8).
- `src/narration/{run,postfilter}.ts`. `run.ts` tient la **boucle d'outils au-dessus du port**
  (`02-mj-ia.md` §0.1, contrat 5) : `narrer()` est mono-coup, `run.ts` consomme les `tool_call`,
  exécute le handler, ajoute un `tool_result` et rappelle `narrer()`, trois itérations au
  maximum puis `toolPolicy: 'none'`. **Aucun adaptateur ne boucle tout seul** : sinon la
  validation serveur des propositions devient inatteignable.
- `src/assertions/*.ts` : les **28** assertions de §8.4, fonctions pures, chacune marquée
  `hard: true | false` — le post-filtre de production ne consomme que les dures.
  *(Le §8.4 énumère 29 identifiants : 16 au tableau principal, 8 de registre, 2 de cohérence de
  scène, 3 de refus. `refusal_is_outcome_blind` n'en fait pas partie — c'est un grader de
  **corpus**, livré par M0-27 dans `packages/ai-eval/src/graders/`, pas une fonction
  `(output, ctx)`. 29 − 1 = 28, et le compte se tranche à la commande :
  `node -e "process.exit(Object.keys(require('./packages/ai/dist/assertions/index.js').ASSERTIONS).length===28?0:1)"`.)*
  `price_respected` (P10) et `no_time_skip` (P11) sont dures. Les douze ajoutées par P15 à P17 :
  dures — `banned_style_lexicon`, `no_named_emotion`,
  `sentence_length_cap`, `max_one_dialogue_line`, `no_atmosphere_ending`,
  `no_absent_reappearance`, `scene_block_consistent` ; souples — `adverb_budget`, `no_triads`,
  `no_anonymous_recurrent`, plus les deux assertions de cas `no_refusal` et `refusal_matches`.
  `ends_concrete` reste optionnelle et réservée à N2. **Les souples le sont délibérément** :
  leur heuristique sur la morphologie du français est bonne sans être parfaite, et les rendre
  bloquantes augmenterait le taux de replis moteur visibles par les joueurs.
- `packages/ai/src/index.ts` complété : sans ça, rien de ce qui est livré ici n'est importable
  par M0-27 ni par M0-29. *(Le fichier appartenait à M0-18, vague précédente : pas de collision.)*
- `src/outputs/{narration,forge,chronicle}.ts`, `src/chronicle/{build,validate}.ts` (C1→**C9**),
  `src/forge/{build,validate}.ts` (V1→V12).
- `src/outputs/scene.ts` : extraction du bloc `<scene_apres>` (F1→F8) puis `mergeSceneBlock`
  (S1→S10). Fonctions **pures**, qui ne lèvent jamais : sur une entrée absente, tronquée ou
  malformée, elles renvoient l'état de scène précédent inchangé.
- `src/outputs/refusal.ts` : `proveRefusal` (R1→R7). Fonction **pure** qui lit l'état à la
  déclaration et **jamais** l'issue du jet.
- `tests/{context-budget,outputs,assertions,degradation,scene-merge,refusal-proof}.test.ts`.

**Critères d'acceptation**
- `env -u NARRATOR_PROVIDER -u NARRATOR_API_KEY pnpm turbo run test --filter @for/ai` sort en 0 (aucun
  appel réseau ; `@for/ai` n'a qu'une tâche livrante dans cette vague, la suite entière est donc
  un critère légitime ici).
- `tests/degradation.test.ts` instancie un port factice pour les **16 combinaisons** de
  capacités (`streaming`, `tools`, `structuredOutput`, `promptCache`) et vérifie que le tour
  produit toujours soit une narration conforme, soit le repli moteur — et **jamais** un
  `EngineEffect`, un événement `character.*` ou un `roll.*` issu de la couche IA. Le testeur
  met `tools: false` : `run.ts` n'envoie pas `tools`, ne traite aucun `tool_call`, et
  `<consignes_du_tour>` gagne la ligne « n'introduis aucun personnage, lieu ou fil nouveau ».
- Un test vérifie qu'un `tool_call` dont les arguments ne valident pas contre `inputSchema`
  est **abandonné** (log `tool_call_dropped`, réémission en `toolPolicy: 'none'`) et **jamais
  réparé** en une valeur plausible.
- Un test vérifie que `price_respected` échoue sur une narration qui écrit « mais tu en sors
  indemne » alors que le `<fait>` impose « Un allié se retourne contre toi », et qu'elle échoue
  **aussi** sur une narration qui ne reprend aucun `keywords` de l'entrée tirée. Ces mots-clés
  viennent du contenu versionné (`03-donnees.md` §4.6, `PriceTableSchema.entries[].keywords`) :
  sans eux, l'assertion n'a rien contre quoi noter et ne teste que la moitié de la règle.
- Un test vérifie que `no_time_skip` échoue sur « le lendemain matin » quand le `<fait>` ne
  porte aucun saut, et passe quand le `<fait>` en porte un.
- `tests/context-budget.test.ts` vérifie que le contexte assemblé sur `LONG_CAMPAIGN` reste
  sous `min(14 000, capabilities.contextWindowTokens × 0,6)` tokens estimés — le test est joué
  **deux fois**, avec une fenêtre large (14 000) et une fenêtre étroite de 8 192 (soit ≈ 4 900,
  cas du modèle local) — **aux quatre points de mesure `seq` = 40, 300, 1 000, 2 000**, et
  que les niveaux de troncature sont appliqués dans l'ordre T1→T8 (assertion sur la valeur de
  `trim_level` retournée par le constructeur, colonne `ai_calls.trim_level`). Le testeur gonfle
  artificiellement la chronique : le test montre `trim_level` croissant, jamais un saut.
- Un test vérifie que `<fait>`, `<intention>`, `<scene>` et le prompt système ne sont **jamais**
  tronqués, y compris après T8.
- `tests/scene-merge.test.ts` couvre les dix règles S1→S10, nommément : une entrée de `presents`
  désignant quelqu'un déjà dans `absent` est **ignorée** (S5) ; une personne présente avant le
  tour et absente des deux listes du bloc **reste présente** (S9) ; une `cause: 'mort'` sur une
  entité que le journal ne donne pas pour morte est **ramenée à `parti`** (S4) ; un personnage
  joueur placé dans `partis` est **ignoré** (S3) ; et un bloc absent, tronqué, mal fermé ou non
  parsable renvoie l'état précédent **à l'octet près**, sans lever.
- `tests/refusal-proof.test.ts` : le même cas, joué une fois avec l'issue `franche` et une fois
  avec `echec`, produit **exactement** le même verdict de `proveRefusal`. Le testeur branche
  l'issue sur la preuve (une ligne) : le test sort en code non nul. C'est le garde-fou anti-abus
  du droit de refus, et il n'a aucune façon de passer en trichant.
- Un test vérifie qu'une proposition absurde **mais matériellement possible** ne produit aucun
  refus retenu : le tour se joue normalement.
- Un test vérifie que `scene-render.ts` produit deux fois le même octet à `SceneState` égal,
  quel que soit l'ordre d'insertion des présents (stabilité du préfixe de cache de prompt).
- Un test de segmentation de phrases couvre ≥ 20 exemples français (points de suspension,
  abréviations, dialogues entre guillemets) — c'est la source la plus probable de faux échecs.
- Un test vérifie qu'une intention contenant `</consignes_du_tour>` ressort échappée.
- Un test vérifie la réparation déterministe V3 : `[3,3,2,1,1]` devient `[3,2,2,1,1]` avec
  départage par l'ordre `vif, coeur, fer, ombre, esprit`.

**Fichiers touchés** : `packages/ai/src/context/**`, `packages/ai/src/narration/**`,
`packages/ai/src/assertions/**`, `packages/ai/src/outputs/**`, `packages/ai/src/chronicle/**`,
`packages/ai/src/forge/**`,
`packages/ai/tests/{context-budget,outputs,assertions,degradation,scene-merge,refusal-proof}.test.ts`

---

### M0-23 · Serveur : connexion Discord et surface HTTP
**Taille** : grosse · **Dépend de** : M0-15, M0-20 · **Parallélisable** : oui

**À quoi ça sert.** Le squelette d'authentification exigé par M0 : OAuth 2 avec PKCE, un cookie
de session dont la base ne stocke que l'empreinte, et les routes de lecture dont le client a
besoin. Une fuite de la base ne doit donner **aucune** session utilisable.

**Livrables**
- `src/auth/{discord,session,guards}.ts` : démarrage du flux (état + PKCE en cookie),
  rappel, création du joueur, cookie `fr_session` (`HttpOnly`, `Secure`, `SameSite=Lax`,
  30 jours, rotation), purge des `oauth_states` expirés.
- `src/http/{auth,campaigns,characters,content}.routes.ts` : les routes de
  `01-architecture.md` §6, avec `fastify-type-provider-zod`.
- `tests/http/*.test.ts`, avec le client HTTP Discord **injecté** (aucun appel réseau réel).

**Critères d'acceptation**
- `pnpm --filter @for/server exec vitest run tests/http` sort en 0, sans accès réseau.
  *(Pas la suite entière : M0-24 et M0-25 livrent dans `@for/server` en parallèle.)*
- `GET /api/auth/discord/start` renvoie 302 vers `discord.com` avec `state`, `code_challenge`
  et `code_challenge_method=S256`, et pose les cookies correspondants.
- Le rappel avec un `state` inconnu ou expiré renvoie 400 et ne crée aucun joueur.
- `GET /api/me` renvoie 401 sans cookie et 200 avec ; `POST /api/auth/logout` révoque la
  session (la requête suivante renvoie 401).
- Une mutation sans l'en-tête `X-Requested-With: for-app` renvoie 403.
- Un test lit la table `auth_sessions` et vérifie que le secret du cookie **ne s'y trouve pas**,
  seulement son SHA-256.

**Fichiers touchés** : `packages/server/src/auth/**`,
`packages/server/src/http/{auth,campaigns,characters,content}.routes.ts`,
`packages/server/src/http/index.ts`, `packages/server/tests/http/**`

---

### M0-24 · Serveur : le chemin d'une intention
**Taille** : grosse · **Dépend de** : M0-13, M0-15, M0-20, **M0-34** · **Parallélisable** : oui

**À quoi ça sert.** **Le seul** chemin d'écriture de l'état de partie, et l'endroit où les
quatre invariants se rencontrent : valider, autoriser, décider (les dés sont tirés ici),
persister dans une transaction courte **sans le moindre appel réseau**, diffuser, puis — hors
transaction — demander à l'IA d'habiller le fait déjà acquis.

**Livrables**
- `src/game/campaign-service.ts` (implémente l'interface livrée en M0-20),
  `src/game/intent-pipeline.ts`, `src/game/write-queue.ts` (une file par campagne ; le code de
  refus est `move_in_progress`, jamais `not_your_turn`).
- `src/game/revert.ts` : `revertTurn(campaignId, correlationId, reason)` — rassemble le groupe
  `correlation_id` complet, écrit `system.reverted`, supprime les instantanés
  `>= min(targetSeqs)` et reconstruit les projections (`03-donnees.md` §3.7). Seul chemin
  d'annulation, partagé par la correction d'administration et par le droit de refus du conteur
  (M0-29). **Il ne rend jamais un index de tirage au RNG.**
- `src/ai/narrator.ts` : sélection du port (`selectNarrator`), avec l'adaptateur `stub`
  déterministe par défaut (c'est ce qui permet au simulateur de tourner sans IA). **Seul endroit
  du serveur qui lise la configuration du conteur**, et cette tâche en est le
  **propriétaire unique** : M0-29, qui écrit dans le reste de `src/ai/**`, le consomme sans le
  réécrire. Le fichier vit sous `ai/` et non `game/` pour être à côté des autres modules qui
  parlent au port (`02-mj-ia.md` §10, `01-architecture.md` §2.8).
- `src/game/turn-proof.ts` : `buildTurnProof(events, viewerId): TurnProofDto` — la **preuve
  « Pourquoi ? »** (P22). Fonction **pure** : elle projette les événements déjà persistés du
  groupe `correlation_id`, applique la même règle de visibilité que `getSnapshot`
  (`visibility: 'gm'` retiré), et **ne tire aucun dé** : ni `decide()`, ni `rollChallenge()`, ni
  le moteur d'aucune façon. `campaign-service.getTurnProof` lit les événements du groupe, puis
  appelle cette fonction.
- `src/game/snapshots.ts` (tous les 200 événements + jalons), `src/game/chronicle.ts`
  (déclenchement, sans le travailleur).
- `intent-pipeline.closeAllBurnWindows(deps, campaignId)` : la **clause du statut de campagne**
  que M0-34 laisse au serveur (`03-donnees.md` §3.4). Une campagne qui n'est plus `active`
  refuse tout, fermeture comprise, donc le chemin d'administration qui écrira
  `campaign.status_changed` (M0-27) **appelle cette fonction d'abord** ; une réponse non vide
  nomme ce qui a empêché, et le statut ne s'écrit pas.
- `tests/game/*.test.ts`.

**Critères d'acceptation**
- `pnpm --filter @for/server exec vitest run tests/game` sort en 0. *(Pas la suite entière :
  M0-23 et M0-25 livrent dans `@for/server` en parallèle.)*
- Un test de bout en bout avec RNG seedé et l'adaptateur `stub` vérifie la chaîne complète :
  événements persistés, projections à jour, `brief` produit.
- Rejouer la même intention (même identifiant client) ne relance **pas** les dés : les
  événements renvoyés sont identiques, et `events` n'a pas grandi.
- Un test vérifie que le narrateur n'est appelé qu'**après** le commit (espion sur la
  transaction) : aucun appel réseau sous verrou d'écriture.
- Deux soumissions concurrentes sur la même campagne produisent des `seq` denses et ordonnés ;
  sur deux campagnes différentes, elles ne se bloquent pas.
- Une intention invalide renvoie un `Result` en erreur, jamais une exception, et la réponse
  porte un code de l'union fermée.
- Un test annule un tour complet par `revertTurn` et vérifie que le hash d'état est **égal** à
  celui d'avant la déclaration — jauges, souffle, conditions, crans de progression, segments
  d'horloge et fenêtre de brûlure comprises — tandis que `events` a **grandi** d'une ligne
  `system.reverted` et que le `rng_draw_index` du flux `action` n'a pas reculé.
- Un test vérifie qu'annuler un `roll.action_resolved` **sans** son `character.gauge_changed`
  est impossible : `revertTurn` ne prend pas de liste de `seq`, seulement un `correlation_id`.
- Un test vérifie la fenêtre de brûlure du souffle en deux temps : `roll.action_resolved
  { burnWindow: true }` → `momentum.burn` → `character.momentum_burned` + `roll.action_revised`,
  sans jamais réécrire le premier jet.
- **La table est libre, donc DEUX fenêtres ouvertes à la fois sont l'état normal** et non un cas
  limite (`ARCHITECTURE.md` §4.4 : « ordre du tour : aucun »). Un test nommé ouvre une fenêtre
  pour A puis une pour B, et chacun ferme la sienne : la fenêtre se cherche par le `rollId` que
  l'intention vise, ou par le personnage concerné — **jamais « la dernière du journal »**, qui
  perd le tour du premier joueur en silence. Le moteur en livre la mécanique en **M0-34** ; ce qui se
  vérifie **ici** est la part du serveur : `Decision.pending` persisté, **aucun appel au
  conteur** tant que la fenêtre est ouverte, la fenêtre rendue en `ctx.burnWindow` sur
  l'intention de fermeture, et le filet de sécurité branché sur `burnWindowClosedBy` — une
  intention qui écrirait sur le même personnage ferme d'abord par `momentum.keep`.
- **La preuve est une projection du journal, pas une donnée fabriquée** (P22). Trois critères,
  tous tranchables :
  1. `grep -rnE "decide\(|rollChallenge\(|rollProgress\(|Math\.random" packages/server/src/game/turn-proof.ts | wc -l`
     affiche `0`.
  2. Un test donne à `buildTurnProof` les événements d'un tour, puis vérifie que **chaque**
     entrée de la preuve porte un `eventSeq` appartenant au groupe fourni — le testeur ajoute un
     libellé sans `eventSeq` : le test sort en code non nul.
  3. Un test appelle `getTurnProof` sur un tour annulé : la preuve porte `status: 'reverted'` et
     `revertedBy { seq, reason: 'gm_refusal:<cause>' }`, et **contient toujours** le jet, les
     effets, le prix et le présage du tour annulé — annuler n'efface pas la preuve, c'est tout
     l'intérêt.
- Un test vérifie que `buildTurnProof` est **pur** : appelé deux fois sur la même entrée, il rend
  le même octet (`stableStringify`), et il n'ouvre aucune connexion à la base.

**Fichiers touchés** : `packages/server/src/game/{campaign-service,intent-pipeline,write-queue,snapshots,chronicle,revert,turn-proof,index}.ts`,
`packages/server/src/ai/narrator.ts`, `packages/server/tests/game/**`

**Cinq fichiers de plus sous `src/game/`, et pourquoi** *(livré)* :

| Fichier | Ce qu'il porte, et pourquoi il n'est pas dans un autre |
|---|---|
| `content.ts` | l'adaptateur `ContentRegistry` → `EngineContent`, qui n'existait nulle part : M0-14 a livré le registre, M0-13 le port, personne ne les avait joints |
| `journal.ts` | relire une entrée du journal en valeur du moteur (upcast + `zGameEvent`), une fois pour les trois lecteurs — fenêtre, preuve, annulation |
| `burn-window.ts` | la fenêtre de brûlure **dérivée du journal**, ce que l'invariant 4 exige et ce qui la fait revenir seule après une annulation |
| `table-state.ts` | `project(CampaignState, viewerId)`, appelé par `getSnapshot` |
| `dispositions.ts` | la conversion des cinq dispositions proposables vers les quatre du moteur, **qui refuse** les deux qui n'ont pas d'équivalent |

---

### M0-25 · Serveur : hub WebSocket
**Taille** : grosse · **Dépend de** : M0-08, M0-20 · **Parallélisable** : oui

**À quoi ça sert.** La table live : une connexion suit une campagne, reçoit les événements dans
l'ordre strict des `seq` sans trou, sait reprendre après une coupure, et refuse poliment ce qui
dépasse. Cette tâche consomme l'**interface** `CampaignService` livrée en M0-20, pas son
implémentation.

**Livrables**
- `src/ws/hub.ts` (`TableHub` : abonnements, diffusion, reprise par `seq`),
  `src/ws/connection.ts` (cycle de vie, heartbeat 25 s / 60 s, contre-pression, trames 64 Kio
  entrantes / 256 Kio sortantes), `src/ws/handlers.ts` (routage des **8** messages `c2s.*`,
  limitation de débit de §5.6, dont **10 `c2s.why` / 10 s**). Le handler de `c2s.why` appelle
  `CampaignService.getTurnProof` et renvoie `s2c.turn_proof` : il ne lit pas la base lui-même,
  ne construit aucune preuve, et **ne décide rien** (P22).
- `tests/ws/*.test.ts`, avec des paires de sockets en mémoire et un faux `CampaignService`.

**Critères d'acceptation**
- `pnpm --filter @for/server exec vitest run tests/ws` sort en 0. *(Pas la suite entière :
  M0-23 et M0-24 livrent dans `@for/server` en parallèle.)*
- Une connexion sans session valide est fermée avec le code **4002** ; un `v` différent ferme
  en **4001** ; une campagne interdite ferme en **4003**.
- Après `c2s.hello`, le client reçoit `s2c.welcome`, puis un rattrapage ou un `s2c.snapshot`,
  puis `s2c.presence`.
- Un test injecte 50 événements et vérifie l'ordre strict et l'absence de trou ; après une
  coupure, `c2s.resume { sinceSeq }` renvoie exactement les manquants.
- Six `c2s.intent` en 10 s déclenchent `s2c.error { code: 'rate_limited' }` ; au troisième
  dépassement, fermeture **4008**.
- Une trame de 65 Kio ferme en **4009**.
- Sans `c2s.pong` pendant 60 s (horloge simulée), la connexion est fermée.
- `c2s.why { correlationId }` reçoit un `s2c.turn_proof` portant le même `correlationId` ; un
  `correlationId` inconnu de la campagne reçoit un `s2c.error` dont le `code` appartient à
  l'union fermée `AppErrorCode`, et un `correlationId` appartenant à **une autre campagne** est
  traité comme inconnu — jamais servi. Onze `c2s.why` en 10 s déclenchent
  `s2c.error { code: 'rate_limited' }`.
- Un test vérifie que `c2s.why` **ne mute rien** : après cent appels, `events` n'a pas grandi
  d'une ligne et aucune narration n'a été relancée.
- `grep -rn "decide(\|reduce(\|buildTurnProof(" packages/server/src/ws | wc -l` affiche `0`
  (le hub ne décide rien, et ne construit pas davantage la preuve : il route).

**Fichiers touchés** : `packages/server/src/ws/{hub,connection,handlers,index}.ts`,
`packages/server/tests/ws/**`

---

### M0-32 · Sonde de FUMÉE : un fournisseur gratuit tient-il le prompt contraint ?
**Taille** : petite · **Dépend de** : **M0-18, et rien d'autre** · **Parallélisable** : oui
· **À démarrer en PREMIER dans la vague 7**

> **La dépendance est la décision** (P23). M0-18 apporte les deux seuls livrables dont la sonde a
> besoin : le **prompt intégral** et le **port du narrateur** avec ses adaptateurs — plus, par
> transitivité, `SceneBlockSchema` de M0-12. Elle **ne dépend pas** de M0-22 (corpus d'assertions
> et constructeur de contexte, même vague) ni de M0-27 (harnais N0, vague suivante) : l'une des
> deux dans ses `depend_de`, et la sonde retombe en vague 8, sans raison d'être.

**À quoi ça sert.** Sortir le **signal précoce**. Si un modèle gratuit est incapable de tenir le
prompt contraint — registre, deuxième personne, pas de décision d'issue, bloc de faits bien
formé —, alors **toute la couche se conçoit différemment**, et l'apprendre en vague 8 coûte trop
cher. Cette tâche ne mesure pas la qualité : elle répond à une seule question, le plus tôt
possible, *est-ce que ça tient debout ?*

> **Placement — ce qui a été appliqué, et la réserve (chiffrage corrigé à la troisième passe).**
> Le tech lead demandait cette tâche en **vague 4 au plus tard**. Elle ne dépend que du
> **prompt intégral** et du **port du narrateur** — mais ces deux livrables sont ceux de
> **M0-18, en vague 6**, elle-même bloquée par M0-12 et M0-14 (vague 5). **La vague 7 est donc
> le plus tôt atteignable sans redécouper**, et c'est ce qui est écrit ici.
>
> Le chiffrage de la passe d'application (« sortir `narrator-port.ts` de M0-12 vers M0-05, et
> `narrator/**` + `conteur.system.ts` de M0-18 vers une tâche de vague 4 ») **ne donne pas la
> vague 4**, comme l'a relevé la troisième passe : une tâche n'est jamais dans la même vague que
> celle dont elle dépend, donc port et prompt en vague 4 ⇒ sonde en **vague 5**. Ce chiffrage
> oubliait aussi `SceneBlockSchema` (`packages/contracts/src/ai/scene.ts`, M0-12, **vague 5**),
> dont l'assertion 7 a besoin.
>
> **Le vrai coût de la vague 4**, si le lead la veut :
> 1. une tâche neuve de **vague 2** (dépendant de M0-01 seul) qui livre
>    `packages/contracts/src/ai/{narrator-port,scene}.ts` — ces deux fichiers ne référencent
>    aucun type du moteur, donc ils n'ont pas besoin de M0-02 ;
> 2. une tâche neuve de **vague 3** qui livre `packages/ai/src/narrator/**`,
>    `packages/ai/src/prompts/conteur.system.ts` et `packages/ai/package.json` ;
> 3. la sonde en **vague 4** ;
> 4. réécriture de **M0-05** (elle ne crée plus `src/ai/index.ts` vide, elle hérite d'un dossier
>    déjà peuplé et doit l'exporter sans l'écraser), de **M0-12** (amputée du port et de
>    `scene.ts`, ses deux critères de neutralité suivent) et de **M0-18** (amputée des
>    adaptateurs et d'un prompt, donc de `narrator-port.contract`, `narrator-errors` et d'une
>    partie de `prompt-size`).
>
> **Risque à porter explicitement** : un `@for/ai` bâti en vague 3 compile contre un
> `@for/contracts` que M0-05 remplit **dans la même vague**, et
> `packages/contracts/src/index.ts` aurait deux écrivains dans deux vagues successives — le
> couplage intra-vague que la règle 2 du découpage existe pour empêcher. Deux fiches neuves,
> trois réécrites, trois vagues touchées : **c'est une décision de découpage, pas une mise en
> cohérence — elle appartient au lead**, et elle reste ouverte.

**Ce qu'elle n'est pas.** Pas M0-31 : elle ne note pas contre le corpus complet, ne compare pas
les fournisseurs entre eux, ne recommande pas de défaut pour le dépôt, et **ne bloque pas la
CI**. Elle informe une décision.

**Livrables**
- `packages/ai-eval/smoke/cases/*.case.json` : **3 cas**, écrits ici et sans dépendance au
  corpus de M0-27 — une issue `franche`, un `echec`, et un tour portant un **prix imposé**.
  Chaque cas porte son `<fait>`, son `<intention>`, son `turn.scene_in` et la liste de champions
  verrouillés **en dur** (pas de `@for/content` : la fixture se suffit).
- `packages/ai-eval/smoke/assertions.ts` : **sept** assertions, écrites à la main, **gelées** —
  six au minimum, huit au maximum, et la borne est vérifiée par une commande. Elles portent sur
  ce qui est vital **et** mesurable sans le corpus complet :
  1. `length_in_range` — la narration tient dans les bornes du § 2.1 (3 à 5 phrases) ;
  2. `second_person_singular` — elle s'adresse au joueur en **« tu »**, jamais en « vous » ni à
     la troisième personne ;
  3. `no_outcome_decision` — elle ne tranche **aucune** issue : aucun caractère numérique,
     aucun vocabulaire de jet (« tu réussis », « tu échoues », « jet », « dé ») ;
  4. `no_locked_champion` — aucun nom **ni alias** de la liste verrouillée du cas ;
  5. `no_final_question` — elle ne se termine pas par une question posée au joueur ;
  6. `scene_block_present` — un bloc `<scene_apres>` est présent, **unique** et fermé ;
  7. `scene_block_wellformed` — ce bloc valide contre `SceneBlockSchema` de `@for/contracts`
     (livré en vague 5, donc disponible).
  *(Ces sept assertions sont **la seule duplication autorisée** du corpus de production, et elle
  est bornée : elles vivent dans `smoke/`, ne grandissent pas, et personne ne les importe. M0-31
  et M0-27, eux, notent avec les assertions de `@for/ai` et rien d'autre — leurs critères le
  vérifient déjà sur `probe/` et `src/`, pas sur `smoke/`.)*
- `packages/ai-eval/smoke/run-smoke.ts` : construit une `NarrateRequest` **minimale** —
  `system[]` = le **prompt intégral** de production (`CONTEUR_SYSTEM_PROMPT`, **importé de
  `@for/ai`, jamais recopié**) et un dernier message `user` assemblé ici à partir du cas —, puis
  appelle le **port réel** pour le `--provider=<id>` demandé, `n = 2` échantillons par cas, et
  note. Elle **n'utilise pas** le constructeur de contexte de M0-22, livré dans la même vague :
  c'est ce qui la rend précoce, et ce qui la distingue de M0-31, qui rejoue la requête de
  production complète.
- `packages/ai-eval/smoke/report.ts` : le **verdict lisible par un humain**, en moins de vingt
  lignes — *tel fournisseur, tel modèle, tant d'assertions passées sur tant*, puis la liste des
  assertions tombées avec un extrait de la sortie fautive.
- `docs/runbook/conteur-fumee.md` : le verdict daté de la première exécution réelle, et la
  phrase qui en découle (« on continue », ou « ce modèle ne tient pas le prompt, voici sur quoi
  il tombe »).
- Le script `pnpm eval:smoke` (déclaré dans le `package.json` racine par M0-01, comme toutes les
  commandes : `01-architecture.md` §2.2).
- `packages/ai-eval/package.json` : **première** livraison dans `@for/ai-eval` (vague 7), donc
  elle y déclare les dépendances `@for/ai` et `@for/contracts` et le script `eval:smoke` du
  paquet. **M0-27 seule** le complète en vague 8 ; **M0-31 n'y touche pas** (sa
  liste de fichiers ne le porte pas, et son script `eval:probe` est déclaré à la racine par
  M0-01). Un seul écrivain par vague, donc aucune simultanéité.

**Critères d'acceptation**
- `pnpm eval:smoke --provider=stub` sort en **0** sans réseau ni clé : le harnais est exerçable
  en CI même si la mesure ne l'est pas. Deux exécutions donnent **le même verdict, au caractère
  près** (le `stub` est déterministe ; son taux de réussite, lui, n'a aucune valeur d'information
  — ce n'est pas un modèle).
- Sans `NARRATOR_API_KEY` et sans `NARRATOR_BASE_URL`,
  `pnpm eval:smoke --provider=openai-compatible` sort en **1** avec un message nommant la
  variable manquante — jamais une trace de pile.
- **Elle ne bloque pas la CI, et c'est vérifiable** : `grep -c "eval:smoke" .github/workflows/ci.yml`
  affiche `0`, et une exécution dont une assertion échoue sort quand même en **0**. Le code de
  sortie non nul est réservé aux **erreurs d'exécution** (variable manquante, fournisseur
  injoignable), jamais à un verdict défavorable : un verdict est une information, pas une porte.
- Le verdict tient sur **moins de vingt lignes** et porte, dans cet ordre : le fournisseur, le
  nom de modèle exact, le nombre d'appels, `n / 7` assertions passées — `7` étant le total
  réellement chargé, jamais une constante écrite dans le rapport —, puis les assertions tombées.
  Le testeur lit la sortie et sait quoi faire sans ouvrir un JSON.
- **Le compte d'assertions est borné, et la sonde le vérifie elle-même au démarrage.**
  `pnpm eval:smoke --provider=stub` écrit en première ligne `assertions: 7`, et sort en **1**
  avec un message nommant la borne si le compte quitte l'intervalle 6–8. Le testeur en ajoute
  une neuvième : la commande sort en **1**. *(Un dépassement de borne est une erreur de
  configuration du harnais, pas un verdict : le code non nul est donc cohérent avec la règle
  ci-dessus. Et le critère se tranche sans supposer où le paquet émet son `dist/` — une
  hypothèse d'arborescence de build serait un critère faux par construction.)*
- **Aucune dépendance au corpus complet ni au constructeur de contexte** (c'est la raison
  d'être de la scission), en deux commandes plutôt qu'en une — le fichier d'assertions de la
  sonde contient forcément la chaîne `ASSERTIONS`, et un critère qui l'interdirait serait faux
  par construction :
  1. `grep -rnE "@for/ai-eval|packages/ai-eval/src|graders|@for/ai/(dist|src)/context" packages/ai-eval/smoke | wc -l`
     affiche `0` ;
  2. `grep -rn "ASSERTIONS" packages/ai-eval/smoke | grep -v "SMOKE_ASSERTIONS" | wc -l`
     affiche `0`.
  La tâche n'importe que `CONTEUR_SYSTEM_PROMPT` et le port depuis `@for/ai`, plus
  `SceneBlockSchema` depuis `@for/contracts`.
- Le prompt est **le vrai**, pas une copie : un test compare le `system[0]` de la requête
  construite à `CONTEUR_SYSTEM_PROMPT` importé, **à l'octet près**, et vérifie que le rapport
  porte `CONTEUR_PROMPT_VERSION`. Le testeur modifie un caractère du prompt système :
  `pnpm eval:smoke --provider=stub` reflète le changement au lieu de l'ignorer.
- Le fournisseur injoignable (port simulé rendant `unavailable`) produit un message d'une ligne
  et le code **1**, sans trace de pile et sans laisser un rapport à moitié écrit.

**Fichiers touchés** : `packages/ai-eval/smoke/**`, `packages/ai-eval/package.json`,
`docs/runbook/conteur-fumee.md`
*(Ne touche ni `packages/ai-eval/src/**`, qui appartient à M0-27, ni `packages/ai-eval/probe/**`,
qui appartient à M0-31. Aucune collision dans la vague 7 : M0-22 livre dans `packages/ai`,
M0-23, M0-24 et M0-25 dans `packages/server`.)*

---

### M0-34 · Moteur : la brûlure en deux temps, comme la spec l'écrit
**Taille** : moyenne · **Dépend de** : M0-13 · **Parallélisable** : oui
· **À démarrer AVANT M0-24 dans la vague 7**

**À quoi ça sert.** Faire que brûler son souffle serve à quelque chose. `03-donnees.md` §3.4 et
`ARCHITECTURE.md` §4.4 écrivent la brûlure en deux temps depuis le début ; `decide()` appliquait
les effets **immédiatement**, au moment où il écrivait `roll.action_resolved`. Mesuré en recette
de M0-13 : le joueur vidait la ressource la plus rare du jeu et prenait les dégâts quand même —
ni `character.momentum_burned` ni `roll.action_revised` ne produisaient le moindre effet de jeu.
Ce n'est pas un arbitrage de conception, c'est une divergence entre la spec et l'implémentation,
et **la spec fait foi**.

**Livrables**
- `packages/engine/src/decide.ts` : quand `roll.action_resolved` porte `burnWindow: true`,
  `decide()` n'émet **ni effet ni `move.resolved`**, et rend la fenêtre dans
  `Decision.pending`. Trois fermetures, et trois seulement : `momentum.burn` (les effets de
  l'issue **révisée**), `momentum.keep` (ceux de l'issue **initiale**), et le filet de sécurité
  de `03-donnees.md` §3.4, tenu par le prédicat exporté `burnWindowClosedBy(window, event)`.
- `packages/engine/src/types/intents.ts` : l'intention `momentum.keep { rollId }`, dans le type
  **et** dans le tuple `INTENT_TYPES` que gardent `satisfies` + `AssertNever`.
- `packages/contracts/src/intents/index.ts` : `zMomentumKeepIntent`, membre de `zIntent`.
- `docs/GLOSSAIRE.md` : l'entrée **Souffle** réécrite — quand, pourquoi, ce que ça coûte.
- Les trois specs remises d'accord avec le code : `ARCHITECTURE.md` §4.4,
  `docs/design/03-donnees.md` §3.4, `docs/design/01-architecture.md` §5.3.

**Critères d'acceptation**
- Un jet qui ouvre la fenêtre écrit **exactement** `move.declared` puis `roll.action_resolved`,
  et rien d'autre : ni `roll.price_paid`, ni `move.resolved`.
- `momentum.burn` sur un échec que le souffle transforme en réussite franche applique les effets
  de la **réussite franche** ; le prix de l'échec n'est jamais tiré.
- `momentum.keep` applique les effets de l'issue initiale et ne dépense **aucun** souffle.
- Le premier jet n'est jamais réécrit : `roll.action_revised.revisedFromSeq` pointe dessus, et
  `move.resolved.rollSeq` pointe sur le **jet**, pas sur la révision.
- **La révision ne tire rien** : tous les flux du contexte de fermeture sont scriptés **vides**
  (un générateur scripté épuisé lève), et l'index de tirage du flux `action` après la fermeture
  vaut celui d'après le jet — deux opérandes, deux origines.
- Rejouer la séquence complète deux fois rend le même état (`stableStringify`).
- Le miroir Zod **rougit dans les deux sens** quand `INTENT_TYPES` et `zIntent` divergent :
  `exhaustive-union.test.ts` et `ws-protocol.test.ts`, mesurés en ajoutant le membre au moteur
  seul.
- `turbo run build typecheck lint test --force` puis `turbo run typecheck:tests --force` sortent
  en 0.

**Ce que la tâche ne fait pas** : toucher au serveur (M0-24), inventer une règle d'équilibrage,
élargir le périmètre.

**Contrat pour M0-24**, parce que le serveur le consomme :
`decide()` rend `Decision.pending: BurnWindow | null`. Non nul, le tour n'est **pas** fini : le
serveur persiste la fenêtre, **n'appelle pas le conteur**, et la rend en `ctx.burnWindow` sur
l'intention de fermeture. Une annulation (`system.reverted`) la jette — c'est ce qui fait
revenir la fenêtre de brûlure avec le reste (`03-donnees.md` §3.7, point 1). Le filet se
branche sur `burnWindowClosedBy` : avant de traiter une intention qui écrirait sur le même
personnage, le serveur ferme d'abord par `momentum.keep`.

La fenêtre porte désormais, en plus du jet : le `correlationId` du tour, l'`id` du
`move.declared`, et le `MovePlan` décidé à la déclaration. Que des valeurs — elle se sérialise
en JSON telle quelle, et c'est ce que le serveur persiste.

**Une fenêtre ouverte doit toujours pouvoir se fermer.** Les dés sont écrits et lus ; il ne
reste dû que leurs conséquences. Deux moitiés, et elles ne se tiennent pas au même endroit :

| Ce qui change sous la fenêtre | Qui le tient, et comment |
|---|---|
| la **scène** (`scene.ended`, cible partie) | **le moteur**. Le `MovePlan` est porté par la fenêtre, pas recalculé à la fermeture : la faisabilité a été tranchée avant les dés. Personne ne peut ordonner les transitions de scène du conteur contre la décision d'un joueur, donc ça ne peut pas être une règle de serveur |
| le **statut de campagne** (`paused`, `archived`) | **le serveur**, et c'est une clause de ce contrat : le serveur **ferme toute fenêtre ouverte de la campagne par `momentum.keep` avant d'écrire le changement de statut**. `decide()` refuse tout sur une campagne non active — c'est voulu, une pause n'est pas un demi-arrêt —, et la pause est une intention humaine sérialisée sur la même file d'écriture (`03-donnees.md` §0.3), donc l'ordre est tenable |
| le **personnage** (mort, retraite, départ) | **le filet**, déjà : ces événements portent le personnage en `subject_character_id`, donc `burnWindowClosedBy` les voit et la fenêtre se ferme avant. `scene.ended`, lui, ne porte aucun sujet — c'est pourquoi la première ligne n'est pas du ressort du filet |

Mesuré côté moteur : `decide.test.ts` → « the scene ends between the dice and the decision »
(la fenêtre se ferme, l'effet tombe), « une campagne en pause » (le refus `campaign_not_active`,
qui est la raison d'être de la clause ci-dessus) et « refuses a closing whose character died in
between » (le filet, dans les deux sens).

**Fichiers touchés** : `packages/engine/src/{decide.ts,decide.test.ts,index.test.ts}`,
`packages/engine/src/types/intents.ts`,
`packages/contracts/src/intents/{index.ts,index.test.ts}`,
`packages/contracts/tests/ws-protocol.test.ts`, `docs/GLOSSAIRE.md`, `docs/ARCHITECTURE.md`,
`docs/design/{01-architecture,03-donnees}.md`, `docs/M0-TASKS.md`
*(Aucune collision dans la vague 7 : M0-22 livre dans `packages/ai`, M0-23, M0-24 et M0-25 dans
`packages/server`, M0-32 dans `packages/ai-eval`.)*

---

## Vague 8 — Démonstration, éval, simulateur, travailleurs

### M0-26 · Base : la campagne de démonstration
**Taille** : grosse · **Dépend de** : M0-17, M0-16 · **Parallélisable** : oui

**À quoi ça sert.** Un seul seed, quatre usages : lancer l'application en local en une commande,
servir de base aux tests de bout en bout, servir de fixture de migration, donner au harnais
d'éval un état de jeu réaliste. Son déterminisme absolu empêche les corpus dorés de dériver sans
qu'on le voie.

**Livrables**
- `src/seed/demo.ts` : 4 joueurs, 1 campagne, 3 personnages, 2 séances, **248 événements
  couvrant au moins une fois chacun des 71 types**, les jets remarquables (franche, partielle,
  échec, présage, souffle brûlé, souffle négatif annulé, plafonnement à 10), 3 serments,
  2 horloges, 11 entités, 3 versions de chronique écrites à la main, 2 instantanés,
  1 annulation, et le mode `--minimal` (fin de la première scène).
- `DEMO_SEED` (graine, epoch, fabrique d'ULID monotone), garde anti-production.
- `tests/seed-deterministic.test.ts`.
- Le script `db:seed` dans `packages/db/package.json`.

> **Comment écrire les 248 événements.** Pas à la main. Le seed **joue** une liste d'intentions
> scriptée à travers le vrai `decide()` avec le RNG seedé de `DEMO_SEED`, et écrit ce que le
> moteur produit. Saisi à la main, un journal de 248 événements serait un second moteur de règles
> à maintenir : il dérive au premier ajustement de payload et peut contenir des états que le
> moteur ne produirait jamais — ce qui rendrait `db:check` contrôle 9 menteur. La liste
> d'intentions, elle, se relit en PR. Les trois versions de chronique et les textes de narration
> restent écrits à la main (aucun appel IA).

> **`tests/fixtures/prev-release.sqlite` n'est pas livré en M0.** Il n'existe aucune release
> précédente : le fichier serait une copie de la base que la migration `0000_init.sql` vient de
> créer, et le test « migrer depuis la release précédente » ne testerait rien. Il est généré par
> le workflow de déploiement **à la première release** (`03-donnees.md` §5.4) et le test
> correspondant est activé à ce moment-là. Un garde-fou qui ne garde rien coûte du temps
> maintenant et une fausse confiance ensuite.

**Critères d'acceptation**
- `pnpm db:reset` puis `pnpm db:check` sortent en 0.
- Deux exécutions de `pnpm db:seed --force` produisent, après `VACUUM`, deux fichiers de
  **sha256 identique**.
- Un test compte 248 événements et vérifie qu'au moins un exemplaire de chacun des 71 types est
  présent (échoue en nommant les types manquants).
- `NODE_ENV=production pnpm db:reset` sort en **1** sans rien supprimer.
- `pnpm db:seed --minimal` produit un nombre d'événements **exactement égal à la constante
  exportée `DEMO_MINIMAL_EVENT_COUNT`** (assertion du test : `SELECT count(*) FROM events` ==
  cette constante), la première scène est close, et `pnpm db:check` sort en 0. *(« ≈ 40 » ne se
  tranche pas ; une constante, si.)*

**Fichiers touchés** : `packages/db/src/seed/**`,
`packages/db/tests/seed-deterministic.test.ts`, `packages/db/package.json`

---

### M0-27 · Harnais d'éval des sorties IA (niveau hors ligne)
**Taille** : grosse · **Dépend de** : M0-16, M0-22 · **Parallélisable** : oui

**À quoi ça sert.** Savoir en quelques secondes si l'on a cassé le conteur, **sans dépenser un
centime et sans clé d'API**. Deux choses sont vérifiées : l'instantané de la requête construite
(ce qui protège aussi la stabilité du cache de prompt) et les assertions rejouées sur des
sorties enregistrées.

**Livrables**
- `cases/*.case.json` (**≥ 10 cas** couvrant : les trois issues, un présage, une pression sur
  les champions réservés, une tentative d'injection de prompt, **un absent que l'intention
  cherche à interpeller, un bloc `<scene_apres>` volontairement malformé, un refus attendu
  `upheld` et une proposition absurde mais possible attendue sans refus**), avec leurs
  `*.request.json` et `*.recorded.json`. Chaque cas porte `turn.scene_in` et, le cas échéant,
  `expect.scene_out` et `expect.refusal` (`02-mj-ia.md` §8.2).
- `src/{run-offline,record,report}.ts`, `src/graders/**` (`schema`, `lockout`,
  `fact-fidelity`, `style`, **`scene-continuity`**, **`refusal-blindness`**), `chronicle/`
  (fixture + faits dorés, chemin N0 uniquement).

> **Périmètre M0 : N0 et rien d'autre.** `src/run-live.ts` (N1), `src/run-judge.ts` (N2) et le
> dossier `forge/` **ne sont pas livrés ici** : ils consomment une clé d'API, ne tournent sur
> aucune porte bloquante de M0, et leur valeur est nulle tant qu'aucune partie n'a été jouée.
> Les scripts `eval:live` et `eval:judge` existent dans le `package.json` racine depuis M0-01 et
> sortent en 1 avec « niveau N1/N2 : jalon M1 ». En M0, ce qui protège le conteur c'est N0, seul
> niveau bloquant.

**Critères d'acceptation**
- `env -u NARRATOR_API_KEY pnpm eval:offline` sort en 0, en **moins de 5 secondes**, et écrit
  un rapport lisible plus un `eval-report.json`.
- L'instantané de requête comparé est la **`NarrateRequest` du port**, sans rien qui dépende
  d'un fournisseur : changer de `NARRATOR_PROVIDER` ne fait bouger aucun `*.request.json`. Le
  testeur bascule sur un autre adaptateur : `pnpm eval:offline` reste vert.
- Le testeur modifie un caractère du prompt système : `pnpm eval:offline` sort en **1** avec un
  diff de requête lisible.
- Le testeur remplace un `prompt_version` enregistré : `pnpm eval:offline` sort en **1**
  (impossible de changer un prompt sans repasser par un enregistrement).
- Un cas dont la sortie enregistrée nomme un champion réservé fait échouer le grader `lockout`,
  y compris via un alias.
- Un cas dont la sortie enregistrée fait réapparaître, dans son bloc `<scene_apres>`, quelqu'un
  figurant dans `turn.scene_in.absent` fait échouer le grader `scene-continuity`
  (`scene_block_consistent`). Le testeur ajoute ce nom aux `presents` d'un enregistrement :
  `pnpm eval:offline` sort en **1**.
- Le grader `refusal-blindness` rejoue **tout** le corpus avec les issues inversées
  (`franche` ↔ `echec`) et exige le **même ensemble** de refus retenus. Le testeur fait lire
  l'issue à `proveRefusal` : `pnpm eval:offline` sort en **1**, en nommant les cas qui ont
  divergé.
- Le cas « proposition absurde mais possible » exige `refusal: none` : un refus retenu sur ce
  cas fait sortir en **1**. C'est ce qui empêche de fabriquer un conteur qui refuse tout.
- **Aucune assertion n'est réécrite ici**, et cela se tranche en deux commandes plutôt qu'en
  cherchant le mot « assertions » — qu'un runner qui lit `case.expect.assertions` écrit
  forcément : `grep -rnE "^\s*(export )?(const|function) [A-Za-z_]*[Aa]ssert" packages/ai-eval/src | wc -l`
  affiche `0`, et un test vérifie que l'ensemble des identifiants exercés par `eval:offline` est
  **exactement** `Object.keys(ASSERTIONS)` importé de `@for/ai` : une copie locale ferait
  diverger les deux ensembles, et le test nomme l'écart.

**Fichiers touchés** : `packages/ai-eval/cases/**`, `packages/ai-eval/chronicle/**`,
`packages/ai-eval/forge/**`, `packages/ai-eval/src/**`, `packages/ai-eval/package.json`
*(Ne touche pas `packages/ai-eval/probe/**`, qui appartient à M0-31, ni
`packages/ai-eval/smoke/**`, qui appartient à M0-32. `package.json` a été créé par M0-01 puis
rempli par M0-32 en vague 7 : cette tâche le complète, elle ne le réécrit pas.)*

---

### M0-28 · Simulateur de table headless
**Taille** : grosse · **Dépend de** : M0-24, M0-25 · **Parallélisable** : oui

**À quoi ça sert.** La réponse directe à l'objectif du jalon : jouer des parties complètes, sans
navigateur et sans appel IA, contre le **vrai** service applicatif, pour répondre en quelques
secondes à « est-ce que ma modification a cassé une partie ? ».

**Livrables**
- `src/{cli,harness,scripted-narrator,scenario,report}.ts`,
  `src/checks/{invariants,replay-equivalence,lockout,determinism}.ts`.
- Les 7 scénarios de `01-architecture.md` §7.4, leurs corpus dorés
  (`tests/golden/`), et `tests/scenarios.test.ts`.
- Les modes `run`, `list`, `record`, `replay`, `fuzz`.

**Critères d'acceptation**
- `pnpm sim run --format=json` exécute les 7 scénarios, sort en 0, en **moins de 20 secondes**.
- `pnpm sim fuzz --iterations=200 --seed=m0` sort en 0 ; un rejet propre (`s2c.rejected`) est un
  succès, un `500` ou un état invalide est un échec, et la graine d'un échec est imprimée.
  **Le mode existe et tourne à la demande, mais il n'est PAS ajouté à la porte de PR en M0** :
  `packages/contracts/tests/envelope-fuzz.test.ts` (M0-08) couvre déjà le cas dangereux — la
  trame malformée — et un fuzz d'intentions sur un moteur sans feature de jeu achète peu pour
  un risque d'instabilité réel sur une porte visée à 8 minutes. Il devient bloquant en M1, quand
  il y aura de la surface à fuzzer. Le job `sim` de la CI ne lance que `pnpm sim run`.
- Deux exécutions avec la même graine produisent un journal de hash identique.
- Le contrôle de couverture échoue (`move_not_covered`) si l'on retire un mouvement d'un
  scénario : le testeur le vérifie.
- Le testeur remplace `TICKS_PER_MILESTONE.dangereux` par `7` : au moins un scénario est rouge
  en **moins de 30 secondes**.
- `grep -rn "from '@for/ai'" packages/sim/src | grep -v "import type" | wc -l` affiche `0`.

**Fichiers touchés** : `packages/sim/src/**`, `packages/sim/scenarios/**`,
`packages/sim/tests/**`, `packages/sim/package.json`

---

### M0-29 · Serveur : travailleurs IA, diffusion, verrouillage de distribution
**Taille** : moyenne · **Dépend de** : M0-22, M0-24 · **Parallélisable** : oui

**À quoi ça sert.** Tout ce qui, dans la couche IA, touche à la persistance, aux verrous et à la
diffusion — donc tout ce qui n'a pas sa place dans `@for/ai`. C'est ici que se ferme
l'invariant 1 côté serveur : la liste des événements atteignables par une proposition du modèle
est **close**.

**Livrables**
- `src/ai/broadcast.ts` (diffusion en fragments, buffer, rattrapage en cours de génération),
  `src/ai/lockout.ts` (revalidation des champions réservés, défense en profondeur),
  `src/ai/chronicle-worker.ts` (verrou à bail de 10 minutes, anti-rebond, reconstruction
  intégrale toutes les 8 régénérations), `src/ai/forge-worker.ts`, `src/ai/calls.ts`
  (journalisation `ai_calls`, compteur de coût, coupe-circuit).
- `src/ai/scene-state.ts` : applique `mergeSceneBlock` et n'émet `scene.facts_updated` **que**
  si la fusion change quelque chose (`02-mj-ia.md` §4.7).
- `src/ai/refusal.ts` : applique un refus **prouvé** par `proveRefusal` en appelant
  `revertTurn()` de M0-24 — jamais un second mécanisme d'annulation —, tient le quota de §4.8.5
  et journalise les refus rejetés en `narration.proposal_rejected` (`02-mj-ia.md` §4.8).
  *(Ces deux fichiers étaient testés par les critères ci-dessous sans figurer en livrables.)*
- `src/ai/narrator.ts` est **livré par M0-24** et seulement **consommé** ici : le serveur ne
  connaît que `NarratorPort` et n'importe aucun SDK de fournisseur.
- `tests/proposal-surface.test.ts` et `tests/ai/*.test.ts`.

**Critères d'acceptation**
- `env -u NARRATOR_API_KEY pnpm turbo run test --filter @for/server` sort en 0 (port simulé).
- `grep -rn "@anthropic-ai/sdk" packages/server/src | wc -l` affiche `0` : le serveur ne
  connaît aucun SDK de fournisseur, seulement le port.
- `tests/proposal-surface.test.ts` vérifie **trois** listes closes, et sort en code non nul si
  l'une des trois est élargie (le testeur applique les trois patchs, un par un) :
  1. atteignable par un `propose_*` : `entity.introduced`, `entity.updated`,
     `entity.status_changed`, `clock.created`, `clock.advanced`, `scene.started`, `scene.ended`,
     `scene.facts_updated` ;
  2. atteignable par `roll_oracle`, seul outil de **lecture** qui écrive au journal :
     `roll.oracle_resolved`, `roll.yes_no_resolved`, et rien d'autre ;
  3. atteignable par le **droit de refus** du conteur : `system.reverted`, et rien d'autre.
  Sans la deuxième, `roll_oracle` serait un circuit d'écriture depuis le modèle que le garde-fou
  de l'invariant 1 ne regarde pas. Sans la troisième, l'annulation de tour en serait un autre.
  **Les trois listes restent séparées**, jamais fondues : fondues, on élargirait l'une en
  croyant toucher l'autre.
- Le testeur fait rendre à `proveRefusal` un verdict `upheld` sur une cause que l'état ne
  prouve pas : `src/ai/refusal.ts` n'émet **aucun** `system.reverted` et écrit un
  `narration.proposal_rejected` portant `reasonCode: 'refusal_unproven'`.
- Un test vérifie qu'un refus retenu annule le **groupe `correlation_id` complet** du tour —
  jamais une ligne seule — et qu'après reconstruction des projections, le hash d'état est
  **égal** à celui d'avant la déclaration. Un second test vérifie que le `rng_draw_index` du
  flux `action`, lui, **n'a pas reculé** : rejouer la même intention ne redonne pas les mêmes
  dés.
- Un test vérifie le quota : au quatrième refus retenu à l'intérieur d'une fenêtre de vingt
  tours, `src/ai/refusal.ts` rejette (`refusal_quota`) et journalise en `warn` une ligne portant
  `event: 'gm_refusal_rate_high'` et `campaignId`.
- **Un tour annulé est montré comme annulé, jamais effacé** (P22). Un test capture ce qui est
  diffusé après un refus retenu et vérifie l'ordre exact : `s2c.narration_done`, puis
  `s2c.narration_error { code: 'action_impossible' }`, puis le `s2c.event` du `system.reverted`
  portant `targetSeqs` et `reason: 'gm_refusal:<cause>'`. **Aucun message de suppression n'est
  émis** — il n'en existe pas : `grep -rn "delete\|remove_event\|purge" packages/server/src/ai/refusal.ts | wc -l`
  affiche `0`. Un second test appelle `getTurnProof` sur le tour annulé **après** l'annulation :
  la preuve existe toujours, porte `status: 'reverted'`, et contient le jet, les effets, le prix
  et le présage qui ont été annulés.
- Un test vérifie que `src/ai/scene-state.ts` n'émet `scene.facts_updated` **que** si la fusion
  change quelque chose : deux tours consécutifs sans mouvement de scène n'écrivent aucun
  événement.
- Un test vérifie que le diffuseur ne laisse **jamais** sortir le bloc `<scene_apres>` : sur une
  sortie simulée contenant prose + bloc, aucun `s2c.narration_delta` ne porte la chaîne
  `<scene_apres>`, et `narration.gm_message.text` persisté s'arrête avant la balise.
- Une narration citant un champion réservé (nom **ou** alias) est refusée, relancée une fois,
  puis remplacée par le repli moteur, avec `narration.gm_failed
  { errorKind: 'rejected_by_postfilter' }` au journal. Le test **capture le logger** et exige
  une ligne de niveau `warn` portant `event: 'reserved_champion_leak'`, `campaignId` et
  `assertion: 'no_reserved_champion'` — « une alerte journalisée » n'est pas vérifiable, un
  champ de log l'est.
- Un bail de chronique expiré est repris par un autre travailleur (horloge simulée) ; deux
  travailleurs ne régénèrent jamais la même campagne en même temps.
- `NARRATOR_PROVIDER=stub` fait tourner tout le pipeline sans **aucune** sortie réseau : la
  partie avance, la narration est celle des gabarits de repli. C'est le seul interrupteur de
  mode dégradé volontaire ; `AI_ENABLED` n'existe plus et un test échoue si le nom réapparaît.
- Chaque appel simulé écrit une ligne `ai_calls` portant `provider`, `model`, ses quatre
  compteurs de tokens, `finish_reason` **pris dans `NarrateFinish`** et, en cas d'échec,
  `error_code` **pris dans `NarratorErrorCode`**. Le testeur fait rendre à l'adaptateur simulé
  un code hors énumération : l'insertion échoue sur la contrainte `CHECK`.
- Le coupe-circuit réagit aux codes du port, pas à des codes HTTP : un `quota_exhausted` arme
  le mode dégradé **immédiatement** (aucune relance), un `rate_limited` respecte
  `retryAfterMs`, un `bad_request` n'est jamais relancé.
- **Le moteur tire, point final** (P10). Trois vérifications, toutes tranchables à la commande :
  1. `grep -rnE "price_choice|playerChoices|propose_price" packages/server/src packages/ai/src
     packages/contracts/src | wc -l` affiche `0` : ces trois mécanismes n'existent nulle part, ni
     côté modèle ni côté joueur. Pour `optionId`, la commande est
     `grep -rn "optionId" packages/server/src packages/ai/src packages/contracts/src`, et elle
     ne doit afficher **que** des lignes du payload `campaign.truth_set` (le choix d'une vérité
     de campagne par un **joueur**, à la création — sans rapport avec le prix). *(Mettre
     `optionId` dans le premier `grep` rendrait ce critère faux par construction : la vérité de
     campagne porte ce nom depuis l'origine.)*
  2. Un test rejoue un mouvement dont l'issue déclenche « payer le prix » avec un RNG scripté :
     le journal porte un `roll.price_paid` **écrit avant** tout appel au port, et le
     `NarrationBrief` transmis contient le `text` de l'entrée tirée, à l'octet près.
  3. Le testeur fait rendre à l'adaptateur simulé une narration qui remplace le prix par une
     autre conséquence : le post-filtre `price_respected` la refuse, relance une fois, puis
     bascule sur le repli moteur avec
     `narration.gm_failed { errorKind: 'rejected_by_postfilter' }`.
- **`propose_scene_transition` ne fait pas passer le temps** (P11) : le testeur envoie une
  proposition de transition ; le journal ne porte que `scene.ended` / `scene.started`, et
  **aucun** `character.gauge_changed`. Un patch qui ajouterait un coût au handler fait échouer
  `tests/proposal-surface.test.ts` sur la première liste close.

**Fichiers touchés** : `packages/server/src/ai/**`,
`packages/server/tests/proposal-surface.test.ts`, `packages/server/tests/ai/**`
*(Ne touche pas `packages/server/src/ai/narrator.ts`, qui appartient à M0-24.)*

---

### M0-31 · Mesurer un fournisseur gratuit sur le corpus complet
**Taille** : moyenne · **Dépend de** : M0-18, M0-22 · **Parallélisable** : oui
· **À démarrer en PREMIER dans la vague 8**

**À quoi ça sert.** Toute l'architecture du port (P18) repose sur une hypothèse : *un
fournisseur gratuit, ou un modèle local, produit une prose assez bonne pour la table*. Tant
qu'elle n'est pas mesurée, c'est une croyance. Cette tâche la mesure **contre le corpus
complet**, et elle le fait **avant** que le reste de la vague 8 ne se soit installé sur un
fournisseur payant par défaut.

> **Le signal précoce ne vient plus d'ici** (P23). Il vient de **M0-32**, la sonde de fumée de la
> vague 7 : sept assertions écrites à la main, un verdict lisible, aucune dépendance au corpus.
> Si un modèle gratuit ne tient même pas le prompt contraint, on le sait **une vague avant**
> cette tâche-ci, avant que M0-26 à M0-29 ne soient écrites. M0-31 garde ce que la fumée ne peut
> pas donner : les **16 assertions dures** de production, deux passerelles et un modèle local
> comparés sur le même corpus, la matrice de capacités, et la recommandation motivée d'un défaut
> et d'un repli. Les deux ne se remplacent pas — l'une dit *est-ce que ça tient debout*, l'autre
> dit *lequel on prend*.

**Pourquoi pas plus tôt.** Le corpus d'assertions vient de M0-22, en vague 7 ; une mesure lancée
avant lui n'aurait rien contre quoi noter. C'est ce qui borne « tôt » ici, et pourquoi cette
tâche ouvre la vague 8 au lieu de la fermer : son rapport oriente le `NARRATOR_PROVIDER` par
défaut du dépôt et le choix de repli de M0-29, qui se termine après elle.

**Livrables**
- `packages/ai-eval/probe/cases/*.case.json` : **6 cas au minimum**, repris de ceux de M0-27
  (les trois issues, un présage, une pression sur les champions réservés, un tour portant un
  prix imposé).
- `packages/ai-eval/probe/run-probe.ts` : pour chaque `--provider=<id>` demandé, construit la
  **même** `NarrateRequest` que la production, appelle le port réel, applique les **16 assertions dures** de
  `@for/ai/src/assertions` (celles du post-filtre de production, `02-mj-ia.md` §8.6 — pas les
  souples, dont l'heuristique produirait du bruit entre fournisseurs), `n = 2` échantillons par
  cas.
- `packages/ai-eval/probe/report.ts` : écrit `probe-report.json` et un tableau lisible — taux
  de réussite **par assertion** et **par fournisseur**, plus les capacités effectivement
  annoncées par chaque adaptateur (`tools`, `structuredOutput`, `promptCache`,
  `contextWindowTokens`) et le résultat de la sonde d'outils.
- `docs/runbook/conteur-fournisseurs.md` : le rapport, avec la recommandation motivée d'un
  défaut pour le dépôt et d'un repli.
- Le script `pnpm eval:probe` (déclaré dans le `package.json` racine par M0-01, comme toutes
  les commandes : `01-architecture.md` §2.2).

**Périmètre mesuré** : au moins **deux** passerelles `openai-compatible` distinctes et **un**
modèle `ollama` local. L'adaptateur `anthropic` sert de **référence haute**, pas de candidat :
mesuré sur le même corpus, il donne aux taux des autres un point de comparaison.

**Critères d'acceptation**
- `pnpm eval:probe --provider=stub` sort en **0** sans réseau ni clé : le harnais lui-même est
  testable en CI, même si la mesure réelle ne l'est pas.
- Sans `NARRATOR_API_KEY` et sans `NARRATOR_BASE_URL`, `pnpm eval:probe --provider=openai-compatible`
  sort en **1** avec un message nommant la variable manquante — jamais une trace de pile.
- Une exécution réelle produit `probe-report.json` et un tableau où chaque ligne est
  `(fournisseur, assertion, taux)`, et où figure la matrice de capacités de chaque adaptateur.
- Le rapport `docs/runbook/conteur-fournisseurs.md` existe, cite les identifiants de modèle
  exacts testés et la date, et tranche : **un défaut recommandé, un repli recommandé, et la
  liste des assertions qui échouent le plus souvent** chez chaque candidat. Il **cite le verdict
  de fumée** de M0-32 (`docs/runbook/conteur-fumee.md`) et dit si la mesure complète le confirme
  ou le contredit : deux verdicts qui divergent sur le même modèle sont une information, pas une
  contradiction à masquer.
- **La sonde note avec les assertions de production, jamais avec des copies** :
  `grep -rnE "^\s*(export )?(const|function) [A-Za-z_]*[Aa]ssert" packages/ai-eval/probe | wc -l`
  affiche `0`, et le rapport porte, pour chaque assertion, l'identifiant **importé** de
  `@for/ai` — un identifiant absent de `Object.keys(ASSERTIONS)` fait sortir la sonde en **1**.
- Un fournisseur dont `capabilities.tools` est faux est **quand même mesuré** et son rapport
  indique explicitement quelles assertions sont sans objet pour lui — une capacité absente
  n'est pas un échec, c'est une dégradation connue (`02-mj-ia.md` §0.2).

**Fichiers touchés** : `packages/ai-eval/probe/**`, `docs/runbook/conteur-fournisseurs.md`
*(Ne touche ni `packages/ai-eval/src/**`, qui appartient à M0-27, ni `packages/ai-eval/smoke/**`
ni `docs/runbook/conteur-fumee.md`, qui appartiennent à M0-32.)*

---

## Vague 9 — Assemblage

### M0-30 · Parcours de bout en bout : la preuve que le socle tient
**Taille** : grosse · **Dépend de** : M0-26, M0-27, M0-28, M0-29 (et donc de tout le reste)
· **Parallélisable** : non (vague seule)

**À quoi ça sert.** Prouver, sur un poste neuf, que tout s'enchaîne : installation propre,
migrations, seed, lancement, connexion WebSocket, tests verts, build de production, image
Docker, CI verte. Et surtout valider le **critère qui justifie tout le reste** : modifier une
constante de règle doit faire rougir, en moins de 30 secondes, un test unitaire, un corpus doré
**et** un scénario de simulateur.

Seule tâche autorisée à faire de petites corrections de câblage dans n'importe quel paquet — à
condition que chaque correction soit signalée dans le rapport final.

**Livrables**
- `scripts/smoke-m0.sh` : depuis un dépôt propre, enchaîne installation, migrations, seed,
  démarrage, connexion WebSocket authentifiée, réception de `s2c.welcome` + `s2c.snapshot` +
  `s2c.presence`, **un aller-retour `c2s.why` → `s2c.turn_proof` sur un tour du seed**, puis
  arrêt propre.
- `scripts/canary-regle.sh` : applique la modification de `TICKS_PER_MILESTONE.dangereux`,
  lance les trois suites concernées, vérifie qu'elles rougissent toutes les trois en moins de
  30 secondes, puis restaure le fichier. **Sort en 0 quand le canari a bien détecté.**
- `docs/runbook/verification-m0.md` : la procédure de recette, dont la connexion Discord de bout
  en bout en local (étape manuelle, avec sa capture de résultat).
- Retrait de tous les `continue-on-error` temporaires de la CI ; `README.md` mis à jour avec les
  commandes du quotidien.

**Critères d'acceptation**
- Sur un clone neuf : `pnpm install && pnpm verify` sort en 0 en **moins de 3 minutes**.
- `pnpm db:reset && pnpm db:check` sortent en 0 (les 12 oracles).
- `bash scripts/smoke-m0.sh` sort en 0.
- `pnpm sim run` : 7 scénarios verts en moins de 20 secondes.
- `env -u NARRATOR_API_KEY pnpm eval:offline` sort en 0 et produit un rapport.
- `pnpm eval:smoke --provider=stub` sort en 0, et `docs/runbook/conteur-fumee.md` existe et
  porte un verdict daté (M0-32).
- `pnpm eval:probe --provider=stub` sort en 0, et `docs/runbook/conteur-fournisseurs.md` existe
  et porte une recommandation datée (M0-31).
- Le parcours de la preuve tient de bout en bout (P22) : dans `scripts/smoke-m0.sh`, après
  réception du premier `s2c.event` d'un tour, un `c2s.why { correlationId }` renvoie un
  `s2c.turn_proof` dont chaque entrée porte un `eventSeq` du tour, en moins de 8 Kio.
- `pnpm build` et `docker build -f infra/Dockerfile -t for-m0:full .` sortent en 0 (image
  complète : c'est **ici** qu'elle est exigée, M0-04 ne construisait que l'étape `build`) ;
  `docker run --rm --entrypoint id for-m0:full -u` n'affiche pas `0` ;
  `docker inspect --format '{{.Config.Healthcheck.Test}}' for-m0:full` est non vide ;
  `docker compose -f infra/docker-compose.yml config` sort en 0.
- `bash scripts/canary-regle.sh` sort en 0 et son rapport nomme les trois suites rouges.
- `grep -c 'continue-on-error' .github/workflows/ci.yml` affiche `0`.

**Trois garde-fous du socle, mesurés inertes pendant la recette de M0-19** (antérieurs à elle,
sans propriétaire — ils arrivent ici pour ne pas être redécouverts) :
- La règle **nommée** `client-ne-voit-que-les-contrats-et-le-moteur` de
  `.dependency-cruiser.cjs` **tire**. Mesuré : `import '@for/server'` posé en tête de
  `packages/client/src/routes/Login.tsx` sort bien en **1**, mais sous
  `pas-de-dependance-orpheline` — `grep -c "client-ne-voit-que"` sur la sortie affiche `0`. La
  frontière tient ; la règle qui prétend la tenir, non. Soit elle se mesure — un paquet interdit
  **déclaré en dépendance** du client, donc résolu, la fait sortir sous **son** nom — soit elle
  disparaît au profit de celle qui mord. Une règle nommée qui ne peut pas rougir n'est pas un
  garde-fou.
- L'exclusion de `.dependency-cruiser.cjs` couvre `.tsx` comme `.ts`. Mesuré dans les deux sens,
  aujourd'hui asymétrique : `import '@for/db'` en tête de
  `packages/client/src/features/table/Journal.test.tsx` ⇒ `pnpm depcruise` sort en **1** ; le
  même import en tête de `packages/client/src/ws/journal.test.ts` ⇒ **0**. `exclude: { path:
  '(coverage|\\.test\\.ts$)' }` ne voit pas `.tsx`. **Aligner dans le sens strict** : les deux
  extensions sortent en 1, et un import licite depuis un fichier de test reste en 0.
- La configuration de couverture **racine** inclut les `.tsx`. Mesuré : `pnpm test:coverage`
  sort en **0** à 98,5 % et `grep -cE "\.tsx +\|"` sur son rapport affiche **0** — aucun
  composant du premier paquet en `.tsx` n'entre dans le seuil global de 70 %. `vitest.config.ts`
  racine s'arrête à `include: ['packages/*/src/**/*.ts']`. Étendre l'`include` **et** l'`exclude`
  (`**/*.test.ts` ne couvre pas `**/*.test.tsx`), puis vérifier qu'une ligne `.tsx` apparaît au
  rapport et qu'un composant non testé fait descendre le chiffre.
- La CI est verte sur une PR de démonstration, et le workflow de déploiement se déclenche sur
  `main` (exécution enregistrée dans le runbook).
- La connexion Discord fonctionne de bout en bout en local, avec la trace consignée dans
  `docs/runbook/verification-m0.md`.

**Fichiers touchés** : `scripts/smoke-m0.sh`, `scripts/canary-regle.sh`,
`docs/runbook/verification-m0.md`, `README.md`, `.github/workflows/ci.yml`,
`.dependency-cruiser.cjs`, `vitest.config.ts`

---

## 4. Tableau récapitulatif

| Tâche | Titre | Vague | Taille | Dépend de |
|---|---|---|---|---|
| M0-01 | Socle du monorepo et outillage | 1 | grosse | — |
| M0-02 | Moteur : types, hasard, pureté | 2 | grosse | M0-01 |
| M0-03 | Chaîne d'intégration continue | 2 | moyenne | M0-01 |
| M0-04 | Image Docker, déploiement, sauvegardes | 2 | moyenne | M0-01 |
| M0-05 | Contrats : état, événements, intentions | 3 | grosse | M0-02 |
| M0-06 | Boîte à outils de test déterministe | 3 | moyenne | M0-02 |
| M0-07 | Moteur : dés, jauges, souffle, progression | 4 | grosse | M0-02, M0-06 |
| M0-08 | Contrats : WebSocket et HTTP | 4 | moyenne | M0-05 |
| M0-09 | Contrats : schémas du contenu | 4 | moyenne | M0-05 |
| M0-10 | Fixtures et assertions de domaine | 4 | moyenne | M0-05, M0-06 |
| M0-11 | Base : schéma, migrations, PRAGMA | 4 | grosse | M0-05 |
| M0-12 | Contrats : schémas d'E/S de l'IA | 5 | moyenne | M0-09 |
| M0-13 | Moteur : mouvements, décision, réducteur | 5 | grosse | M0-07, M0-10 |
| M0-14 | Chargeur de contenu et index généré | 5 | grosse | M0-09 |
| M0-15 | Base : dépôts et journal | 5 | moyenne | M0-11 |
| M0-16 | Contenu de jeu, annuaire et 3 fiches de champion | 6 | grosse | M0-13, M0-14 |
| M0-17 | Base : reconstruction et `db:check` | 6 | moyenne | M0-13, M0-15 |
| M0-18 | IA : le port du conteur, ses adaptateurs, prompts et outils | 6 | grosse | M0-12, M0-14 |
| M0-19 | Client : SPA et page « table » | 6 | grosse | M0-08, M0-14 |
| M0-20 | Serveur : socle, environnement, santé | 6 | moyenne | M0-08, M0-11, M0-14 |
| ~~M0-21~~ | *absorbée par M0-16* | — | — | — |
| M0-22 | IA : contexte, budget, assertions | 7 | grosse | M0-18 |
| M0-23 | Serveur : Discord et surface HTTP | 7 | grosse | M0-15, M0-20 |
| M0-34 | Moteur : la brûlure en deux temps | 7 | moyenne | M0-13 |
| M0-24 | Serveur : le chemin d'une intention | 7 | grosse | M0-13, M0-15, M0-20, M0-34 |
| M0-25 | Serveur : hub WebSocket | 7 | grosse | M0-08, M0-20 |
| M0-32 | Sonde de fumée d'un fournisseur gratuit | 7 | petite | M0-18 |
| M0-26 | Base : campagne de démonstration | 8 | grosse | M0-17, M0-16 |
| M0-27 | Harnais d'éval hors ligne (N0 seul) | 8 | grosse | M0-16, M0-22 |
| M0-28 | Simulateur de table headless | 8 | grosse | M0-24, M0-25 |
| M0-29 | Serveur : travailleurs IA et verrous | 8 | moyenne | M0-22, M0-24 |
| M0-31 | Mesurer un fournisseur gratuit (corpus complet) | 8 | moyenne | M0-18, M0-22 |
| M0-30 | Assemblage de bout en bout | 9 | grosse | tout |
