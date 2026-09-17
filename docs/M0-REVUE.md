# M0 — Revue du socle avant exécution

> **Statut** : revue critique du plan, menée avant qu'une ligne de code soit écrite.
> **Portée** : `docs/ARCHITECTURE.md`, `docs/design/01-architecture.md`,
> `docs/design/02-mj-ia.md`, `docs/design/03-donnees.md`, `docs/M0-TASKS.md`.
> **Date** : 2026-09-17.
>
> Ce que je cherchais : ce qui va casser quand trente agents travaillent en parallèle sur ces
> documents. Collisions de fichiers, critères qu'un testeur ne peut pas trancher, trous de
> périmètre, pentes glissantes vers une violation d'invariant, ordre irréaliste, et
> sur-ingénierie.
>
> **Ce qui a été corrigé l'est directement dans les fichiers.** Ce qui demande un arbitrage
> produit est listé en §1 et attend une réponse. Rien n'a été supprimé sans être remplacé.

---

## 0. Verdict

> **Ce document porte TROIS passes de revue et UNE passe d'arbitrage.** La première (§0 à §10) a
> été menée avant les trois arbitrages du tech lead. La seconde (**§11**) a relu les six
> documents après l'application de ces arbitrages et l'entrée des trois enseignements du
> prototype, et c'est elle qui porte le verdict de revue. **§12** consigne les **cinq
> arbitrages** rendus ensuite par le lead, qui closent les quatre points laissés ouverts en
> §11.7. **§13** est la recette de cette application : elle vérifie que les cinq arbitrages sont
> appliqués partout et qu'aucun document ne porte plus la version contraire, et elle porte le
> verdict courant. Quand deux sections divergent, **la plus récente fait foi** :
> §13 > §12 > §11 > §0-§10.

**Non, pas en l'état — mais il s'en faut de peu.**

Le plan est d'une qualité inhabituelle : les quatre invariants sont portés par des frontières
de paquets et des tests nommés, pas par de la discipline ; le découpage en vagues respecte
presque partout la règle « deux tâches d'une même vague ne partagent pas un fichier » ; et le
critère de recette de M0 (« modifier une constante de règle doit faire rougir trois suites en
trente secondes ») est le bon critère.

Ce qui bloquait :

1. **Deux tâches avaient un critère d'acceptation faux par construction** — M0-16
   (`pnpm content:check` sans aucune fiche de champion) et M0-04 (`docker build` complet avant
   que le serveur et le client produisent un `dist/`). Un agent testeur consciencieux aurait
   rejeté un travail correct.
2. **`ChampionSchema` n'avait pas de champ `aliases`**, alors que tout le verrouillage de
   distribution — l'invariant produit le plus visible pour les joueurs — en dépend, dans quatre
   documents et trois tâches.
3. **Trois documents décrivaient trois mécanismes différents pour le choix de conséquence de
   prix**, dont un qui laissait le modèle désigner une conséquence mécanique.
4. **Onze tâches sur vingt-neuf portaient au moins un critère non tranchable** à la commande.

Tout cela est corrigé ci-dessous. Les deux points d'arbitrage du §1 **ont depuis été tranchés
par le tech lead** ; §1 conserve l'analyse, mais les décisions qui font foi y sont écrites en
tête de chaque point. Un troisième arbitrage, postérieur à cette revue, a transformé le conteur
en **port** (voir §1bis). Le socle est exécutable.

---

## 1. Les deux points d'arbitrage — TRANCHÉS

> **Statut : clos.** Les deux points ci-dessous ont été tranchés par le tech lead après cette
> revue. La décision qui fait foi est en tête de chaque point ; l'analyse qui suit est conservée
> comme mémoire du raisonnement, **pas** comme une question ouverte. Les valeurs « appliquées
> par défaut » décrites plus bas ont toutes deux été **remplacées**.

### A1 · Le choix de conséquence de « payer le prix » (P10) — **TRANCHÉ**

> **DÉCISION DU TECH LEAD : le moteur tire, point final.**
> Le moteur lance le d12 sur `pay-the-price`, applique l'entrée tirée, écrit `roll.price_paid`,
> puis transmet cette entrée au conteur comme un **fait imposé**, à intégrer tel quel dans la
> narration. Le modèle ne choisit rien, ne propose rien, ne reformule pas l'entrée en autre
> chose. **Personne d'autre ne choisit non plus** : la valeur par défaut proposée ci-dessous —
> faire trancher le joueur via `playerChoices` — est **abandonnée**. L'outil `propose-price`,
> le payload `kind: 'price_choice'`, le champ `optionId` et le champ `playerChoices` sont
> supprimés de toutes les specs. Quand l'entrée porte plusieurs `suggestedEffects`, un second
> tirage sur le flux RNG `price` tranche, et l'index va dans `roll.price_paid.effectIndex`
> (rejouable, invariant 4). Appliqué dans `ARCHITECTURE.md` §4.4, `01-architecture.md` §2.7,
> `02-mj-ia.md` §3.4, `03-donnees.md` §3.4 et §4.6, et M0-29.

**Trois documents, trois états.** `ARCHITECTURE.md` §4.4 dit que le modèle transmet un
`optionId` dans une liste fermée. `03-donnees.md` §3.4 décrit le circuit `price_choice` en
détail, et en fait un point de revue explicite. `01-architecture.md` §2.7 listait un fichier
`packages/ai/src/tools/propose-price.ts`. Mais `02-mj-ia.md` §3.4 **gèle un tableau de douze
outils** — pour le cache de prompt — et **aucun** ne porte d'`optionId`.

Il n'existe donc, aujourd'hui, aucun chemin par lequel le modèle pourrait désigner une option
de prix. Le critère d'acceptation de M0-29 (« un `optionId` hors liste produit
`narration.proposal_rejected` ») testait un circuit inexistant.

**Ce que j'ai appliqué par défaut** : en M0, aucun outil de prix n'est exposé au modèle. Le
joueur désigne l'option (`move.resolved.playerChoices`) ; à défaut de choix exprimé, le moteur
prend l'option de tête, de façon déterministe. C'est la lecture la plus conservatrice de
l'invariant 1, et la seule compatible avec la liste gelée de douze outils.

**Ce qui a été répondu** : ni treizième outil, ni choix du joueur. Le moteur tire et impose.
C'est la seule lecture qui ne laisse aucune brèche à surveiller — et, accessoirement, celle qui
rend le prix le plus tranchant en jeu : un prix qu'on ne choisit pas est un prix.

### A2 · Le coût en vivres d'une transition de scène (P11) — **TRANCHÉ**

> **DÉCISION DU TECH LEAD : `time_shift` est retiré de l'outil.**
> `propose_scene_transition` ne propose plus qu'un **changement de lieu**. Le champ disparaît du
> schéma d'entrée, de la description de l'outil et de toute la chaîne de traitement. Le temps
> écoulé et son coût éventuel découlent **exclusivement du mouvement joué** — par exemple
> `endure-cold` —, calculés par le moteur à partir de sa table de mouvements, jamais d'une
> valeur fournie par le modèle. C'est plus fort que la valeur par défaut décrite ci-dessous
> (« `time_shift` purement narratif ») : il ne s'agit pas de neutraliser un champ, mais de ne
> pas le laisser exister. Un champ neutralisé se remécanise un jour ; un champ absent, non.
> Appliqué dans `02-mj-ia.md` §3.3 et `ARCHITECTURE.md` §4.4.

`propose_scene_transition` laissait le modèle choisir un `time_shift`
(`aucun` … `plusieurs_jours`), et `02-mj-ia.md` §3.3 note qu'« un déplacement peut coûter des
vivres, calculé et appliqué par le moteur ».

**C'est la pente glissante la plus nette de tout le dossier.** Le moteur applique le coût, donc
la lettre de l'invariant 1 est sauve. Mais c'est le modèle qui choisit l'entrée qui détermine le
coût : il décide donc, indirectement, d'une mutation de jauge. Et mécaniquement, l'événement
`character.gauge_changed` qui en résulte devient **atteignable par un circuit de proposition**,
alors que la liste close de `03-donnees.md` §0.5 ne contient que `entity.*`, `clock.*` et
`scene.*`. Conséquence concrète : `packages/server/tests/proposal-surface.test.ts` deviendrait
rouge le jour où quelqu'un implémente le handler — et la tentation sera d'élargir la liste. Une
liste close qu'on élargit une fois n'est plus une liste close.

**Ce que j'ai appliqué par défaut** : en M0, `time_shift` est **purement narratif**. Aucune
conséquence mécanique n'est attachée à une transition de scène. Le coût d'un voyage passe par
un mouvement de joueur (`endure-cold`, piste de périple), jamais par une proposition du
conteur.

**Ce qui a été répondu** : aucun événement de jauge ne devient atteignable depuis le modèle. Le
champ est retiré plutôt que neutralisé, ce qui ferme la porte de derrière au lieu de la
surveiller.

---

## 1bis · Le conteur devient un port (P15) — **TRANCHÉ, postérieur à cette revue**

Cette revue n'avait pas relevé le point, parce qu'il n'était pas une incohérence entre
documents : `02-mj-ia.md` était cohérent avec lui-même, mais écrit en supposant un fournisseur
unique — identifiants de modèle, `stop_reason`, seuils de mise en cache, format d'appel
d'outils, classes d'exception de SDK. C'était une dépendance, pas une divergence.

> **DÉCISION DU TECH LEAD** : le serveur ne parle plus à un fournisseur mais à une **interface
> unique**, `NarratorPort`, avec deux opérations — `narrer()` en flux et `structurer()` qui rend
> du JSON validé contre un schéma — et **trois adaptateurs** derrière : `anthropic`,
> `openai-compatible` (OpenRouter, Groq, Together) et `ollama` (local), plus un `stub` sans
> réseau. Tout ce qui est propre à un fournisseur descend dans son adaptateur ; le reste de la
> spec ne nomme plus aucun fournisseur, et un test le vérifie. Configuration par cinq variables
> `NARRATOR_*` — **trois variables d'appoint les ont rejointes depuis** (§12 A3). Une matrice de dégradation explicite dit ce qui se passe quand un adaptateur ne
> sait pas appeler d'outils ou quand le modèle rend du JSON malformé, sous une seule règle :
> **on dégrade la prose, jamais l'équité**.

**Ce que cela change pour la revue** : la nouvelle tâche **M0-31** mesure un fournisseur gratuit
contre le corpus d'assertions, au début de la vague 8 et non à la fin du jalon. Sans cette
mesure, « le conteur marche sans budget » resterait une croyance. *(Depuis, le lead a jugé la
vague 8 trop tardive pour le **signal** : **M0-32**, sonde de fumée, le sort une vague plus tôt
avec sept assertions écrites à la main — voir §12 A7.)*

---

## 2. Collisions de fichiers — croisement des champs « Fichiers touchés »

J'ai croisé les listes, vague par vague. **Il n'y a aucune collision directe de chemin dans une
même vague** — c'est remarquable, et le mécanisme qui l'assure (M0-20 crée les quatre
modules-greffons vides que M0-23, M0-24 et M0-25 remplissent séparément) est bien vu.

Deux problèmes de partage, en revanche, tous deux corrigés :

### C1 · M0-16 et M0-21 se partageaient `content/manifest.json` — et pire

Elles étaient dans deux vagues différentes, donc pas de collision au sens strict. Mais elles se
partageaient `content/manifest.json` **et** `packages/content/src/generated/index.ts`, et
surtout M0-16 ne pouvait pas satisfaire son propre critère principal. **Corrigé** : M0-21 est
absorbée par M0-16, qui devient la seule tâche autorisée à écrire dans `content/**`. La vague 7
passe de cinq à quatre tâches, et M0-26 / M0-27 dépendent désormais de M0-16.

### C2 · Trois tâches d'une même vague jugées sur la suite de tests d'un paquet partagé

C'est une collision d'un autre genre, et elle est plus vicieuse qu'un conflit de fichier :
M0-23, M0-24 et M0-25 livrent toutes dans `@for/server` et étaient toutes jugées sur
`pnpm --filter @for/server test`. Chacune est rouge tant que les deux autres ne sont pas
terminées. Même chose pour M0-08, M0-09 et M0-12 dans `@for/contracts`. Un agent testeur
appliquant le critère à la lettre rejette trois travaux corrects ; un agent qui « comprend » le
rejette au jugé, ce que ce document interdit explicitement.

**Corrigé** : chaque tâche cite désormais **ses** fichiers de test
(`pnpm --filter <pkg> exec vitest run tests/<dossier>`), et c'est M0-30 qui exige la suite
complète. La règle est écrite en §1 du document de tâches (règle 7).

---

## 3. Ordre irréaliste — ce qui présuppose ce qui n'existe pas

### O1 · M0-04 : `docker build` complet en vague 2 (bloquant)

L'étape `runtime` du `Dockerfile` copie `packages/server/dist/main.js` et
`packages/client/dist`. En vague 2, `packages/server` et `packages/client` sont des squelettes
sans point d'entrée ni `index.html` : `main.ts` arrive en M0-20 (vague 6), le client en M0-19.
`docker build` ne peut pas sortir en 0, et trois des sept critères de M0-04 étaient donc faux.

**Corrigé** : M0-04 est jugée sur `docker build --target build`, ce qui teste ce qu'on veut
vraiment tester tôt — **la compilation de `better-sqlite3`, module natif, dans l'image**. La
construction complète est un critère de M0-30.

### O2 · M0-16 : `pnpm content:check` sans aucune fiche de champion

La passe 4 du chargeur compare `expectedCounts` du manifeste à ce qui a été chargé, et
`expectedCounts.champions` est un `z.number().int().positive()`. Avec zéro fiche, la commande ne
peut pas sortir en 0. Les fiches arrivaient une vague plus tard. **Corrigé** par la fusion C1.

### O3 · M0-10 : détection d'alias sans données d'alias

Le critère « `expectNoReservedChampion` détecte “la Griffe de Givre” pour Sejuani » est en
vague 4 ; les fiches de champion et leurs alias arrivent en vague 6. Et `@for/testkit` n'a pas
le droit de dépendre de `@for/content`. **Corrigé** : l'assertion prend la liste d'alias en
argument, et la fixture la fournit en dur.

### O4 · `tests/fixtures/prev-release.sqlite` en M0

M0-26 devait livrer une fixture « base de la release précédente » pour tester les migrations sur
données réelles. Il n'y a pas de release précédente : le fichier serait une copie de ce que
`0000_init.sql` vient de créer, et le test ne testerait rien. **Corrigé** : le fichier est généré
par le workflow de déploiement à la première release, et le test s'active à ce moment-là.
`03-donnees.md` §5.4 le prévoyait déjà ainsi.

---

## 4. Trous — livrables que personne ne prenait

| # | Trou | Traitement |
|---|---|---|
| T1 | **`ChampionSchema` n'avait pas de champ `aliases`**, alors que `02-mj-ia.md` §2.2 dit « chaque fiche porte un tableau `aliases` », que l'assertion `no_reserved_champion` (§8.4) et le post-filtre de production s'appuient dessus, et que M0-10 et M0-21 avaient des critères qui l'exigeaient | Champ obligatoire ajouté au schéma unique (`03-donnees.md` §4.5), omis de `ForgeOutputSchema` (un modèle ne choisit pas les noms sous lesquels on le reconnaîtra), et critère ajouté à M0-09 |
| T2 | **`content/champions-index.json`** — l'annuaire des ~170 champions avec leurs alias — était cité par la forge (V2 : région canonique ; V7 : aucun autre champion nommé) et par le bloc `<lore>`, mais **absent de l'arborescence de contenu et de toute tâche**. M0-22 devait implémenter V7 contre un fichier inexistant | Fichier et `ChampionIndexSchema` ajoutés (`03-donnees.md` §4.1 et §4.7), livrés par M0-16, avec un périmètre M0 explicite (les champions du contenu et du seed, pas les 170) et un invariant de chargeur qui vérifie la cohérence fiche ↔ annuaire |
| T3 | **`ai_calls.trim_level`** est écrit à chaque tour selon `02-mj-ia.md` §4.4 et §3.4, et M0-22 a un critère dessus — la colonne n'existait pas dans le DDL | Colonnes `trim_level` et `context_hash` ajoutées |
| T4 | **Les seuils de couverture** (engine 95/90, contracts 90, db 80, global 70) n'appartenaient à aucune tâche. Quatre tâches en dépendent pour leur critère d'acceptation | Attribués à M0-01 (`vitest.workspace.ts` + configs de paquet), avec un critère qui prouve qu'ils sont appliqués par le runner |
| T5 | **`packages/ai/src/index.ts` absent des fichiers de M0-22** : rien de ce que la tâche livre (contexte, assertions, validateurs) n'aurait été importable par M0-27 ni M0-29 | Ajouté |
| T6 | **Quatre commandes citées dans des critères ou la CI n'existent nulle part** : `pnpm db:generate --check` (drizzle-kit n'a pas ce drapeau), `pnpm ai:eval` (workflow nocturne), `pnpm eval:record`, `pnpm db:check-schema`. La liste de scripts de `01-architecture.md` §2.2 omettait aussi `lint`, `typecheck`, `format:check`, `depcruise`, `check:workspace` — tous utilisés par la CI et par `pnpm verify` | Liste rendue exhaustive et déclarée contractuelle ; commandes corrigées dans la CI et dans M0-11 ; règle 8 ajoutée au découpage ; `scripts/check-ci-jobs.sh` (M0-03) vérifie désormais que **toute commande d'un `run:` existe dans le `package.json` racine** |
| T7 | **`roll_oracle` était un troisième circuit d'écriture depuis le modèle**, non couvert par le garde-fou. Classé « lecture », il écrit pourtant au journal ; `proposal-surface.test.ts` ne surveillait que les `propose_*` | `ReadOnlyTool.journalOnly`, vide partout sauf `roll_oracle`, et le test vérifie désormais **deux** listes closes. `ARCHITECTURE.md` §1 amendé |
| T8 | **M0-16 et M0-21 n'avaient aucun fichier de test** dans leurs fichiers touchés, alors que cinq de leurs critères commençaient par « un test vérifie que… » | `packages/content/tests/game-content.test.ts` ajouté aux livrables de M0-16 |
| T9 | **`propose_vow_hook` n'écrivait rien en base** (`03-donnees.md` §0.5) tout en étant soumis à la règle « toute proposition produit un `narration.proposal_accepted` ou `_rejected` — une proposition qui disparaît sans trace est un bug » | Ligne réécrite : aucun événement **d'état**, mais bien les deux événements de proposition |
| T10 | ~~**`.env.example` du dépôt décrivait un conteur agnostique**~~ — **CE CONSTAT EST RENVERSÉ, voir §12.** À la date de la première passe, la stack verrouillée ne connaissait qu'un fournisseur ; le tech lead a depuis tranché l'inverse, et le conteur *est* un port agnostique. Ce que la première passe prenait pour une contradiction du dépôt était en réalité la bonne intuition | `.env.example` est agnostique et le reste, réécrit sur `01-architecture.md` §9.4 et `02-mj-ia.md` §0.6. Seul `.nvmrc` remis à `24` survit de cette ligne |

Pas de trou sur le reste : les trois tests gardiens de l'invariant 1
(`tool-surface`, `proposal-surface`, `ai-cannot-mutate`), celui de l'invariant 2
(`context-budget`), celui de l'invariant 3 (`ws-protocol`) et ceux de l'invariant 4
(`db:check` contrôle 9, `replay-equivalence`) sont tous attribués à une tâche nommée. Les
runbooks aussi — ils étaient quatre à la date de cette passe, six depuis (`conteur-fumee.md`
est venu avec M0-32, §12 A7) ; la liste à jour est dans `01-architecture.md` §2.1.

---

## 5. Critères d'acceptation mous — réécrits

La règle du document est excellente (« si les commandes sortent en code 0, la tâche est
acceptée ; aucun jugement au doigt mouillé »), mais onze tâches la violaient. Les plus graves :

| Tâche | Critère mou | Réécriture |
|---|---|---|
| M0-02 | « Un test compte les membres de `GameEvent` et échoue si le total n'est pas 70 » — **une union TypeScript ne se compte pas à l'exécution** | Le moteur exporte `GAME_EVENT_TYPES` (les 71 chaînes — 70 à la date de cette revue, plus `scene.facts_updated`) gardé par un contrôle d'exhaustivité au type ; le critère est une commande `node -e` qui vérifie longueur et unicité, plus un patch qui doit casser `typecheck` |
| M0-02 | `grep -rInE '[éèêàçûôîï]'` pour « aucune chaîne française dans le moteur » — laisse passer **toutes les majuscules accentuées** et `œ` | `grep -rlnP '[À-ÖØ-öø-ÿŒœ]'` |
| M0-07 | « au moins un test unitaire **et** un corpus doré sont rouges » — indécidable à l'œil sur une sortie de trois cents lignes | Rapport JSON de Vitest + deux expressions `jq` qui doivent toutes deux renvoyer `true` |
| M0-14 | « son rapport affiche les trois erreurs d'un coup, avec au moins une suggestion » | `grep -c '^\s*→'` vaut 3, et au moins une ligne contient `(suggestion :` |
| M0-22 | « reste sous 12 500 tokens **à tous les âges de campagne testés** » — « testés » par qui ? | Quatre points de mesure nommés : `seq` = 40, 300, 1 000, 2 000 |
| M0-26 | « `--minimal` produit **≈ 40** événements » — un « ≈ » ne se tranche pas | Constante exportée `DEMO_MINIMAL_EVENT_COUNT`, comparée à `SELECT count(*) FROM events` |
| M0-29 | « une **alerte journalisée** » | Le test capture le logger et exige une ligne `warn` portant `event: 'reserved_champion_leak'`, `campaignId`, `assertion` |
| M0-03 | « Un script de vérification `grep` confirme la présence des 12 identifiants » — quel script ? il n'était pas livré | `scripts/check-ci-jobs.sh`, ajouté aux livrables, avec un patch de vérification |
| M0-05 | « Ajouter un champ obligatoire à `CampaignState` … fait sortir `pnpm typecheck` en code non nul » | Le patch exact est écrit (`readonly probe: string;`), ainsi que le fichier que l'erreur doit pointer |
| M0-04 | `docker run --entrypoint id … n'affiche pas 0` | Remplacé par un `grep -qE '^USER'` sur le `Dockerfile`, tranchable sans exécuter l'image |
| M0-11 | `pnpm db:generate --check` | `pnpm db:check-schema`, plus un patch qui doit le faire sortir en 1 |

---

## 6. Invariants — surface d'outils du MJ IA

J'ai passé les douze outils au crible, en cherchant celui qui, **en pratique**, laisserait le
modèle décider d'une issue.

**Ce qui tient, et tient bien.** Les dés sont tirés avant l'appel. Le `<fait>` est au passé
composé, les chiffres sont en toutes lettres, le post-filtre interdit tout caractère numérique.
`propose_clock_advance` est borné par `MAX_CLOCK_ADVANCE_BY_OUTCOME` (`franche` → 0), et un
dépassement est **ajusté**, pas refusé — donc le modèle ne peut pas apprendre à demander plus.
La conséquence d'une horloge pleine est déclenchée par le moteur, au tour suivant.
`check_name_allowed` ne révèle jamais **quel** champion est visé. Le contrat de retour commun
`applied / adjusted / rejected` avec la consigne « écris à partir de `applied`, jamais de ta
demande » est le bon design. Et surtout, l'ordre du pipeline — moteur, journal, commit,
diffusion, **puis** narration hors transaction — signifie qu'une panne du modèle dégrade le
texte, jamais la partie. C'est vérifiable, et c'est vérifié.

**Les trois failles trouvées**, toutes traitées :

1. **`propose_scene_transition` → coût en vivres** : le modèle choisit l'entrée qui détermine
   une mutation de jauge, et l'événement résultant sort de la liste close. → **A2, tranché :
   `time_shift` est retiré de l'outil.**
2. **`price_choice`** : un circuit décrit dans trois documents, dont deux le placent chez le
   modèle, et aucun outil pour le porter. → **A1, tranché : le moteur tire, point final ; le
   circuit est supprimé, pas déplacé.**
3. **`roll_oracle`, outil « de lecture » qui écrit au journal** : circuit d'écriture depuis le
   modèle que `proposal-surface.test.ts` ne regardait pas. → **corrigé** (T7).

Deux points de vigilance, non bloquants, que je signale sans les corriger :

- **`roll_oracle` laisse le modèle choisir `likelihood`.** Il fixe donc la probabilité d'une
  réponse. C'est acceptable — l'oracle porte sur le monde, jamais sur l'action d'un joueur, et
  le dé est tiré par le moteur — mais la frontière tient à une phrase de prompt. J'ai ajouté au
  document la règle serveur correspondante (refus d'une question `yes-no` qui porte sur l'issue
  d'un mouvement en cours). À surveiller dans les premières parties réelles.
- **La fenêtre roulante des douze derniers tours contient la narration verbatim du modèle.**
  Ce n'est pas une violation de l'invariant 2 — elle est reconstruite depuis la base
  (`ai_turn_renders` + `narration.gm_message`) et bornée — mais un agent qui lit
  « aucun historique de conversation n'est conservé côté modèle » puis découvre douze tours
  d'historique dans `messages[]` va croire à une contradiction. Vaudrait une phrase.

---

## 7. Sur-ingénierie — ce que j'ai coupé, et pourquoi

Un socle trop gros retarde la première partie jouable. Quatre coupes, toutes appliquées :

1. **N1 et N2 de l'éval IA, retirés de M0-27.** `run-live.ts`, `run-judge.ts` et le dossier
   `forge/` consomment une clé d'API, ne tournent sur aucune porte bloquante, et évaluent la
   qualité d'un conteur qui n'a encore raconté aucune partie. Ce qui protège en M0, c'est N0,
   et N0 seul est bloquant. Les scripts existent et sortent en 1 avec « jalon M1 ». **Gain : le
   tiers d'une grosse tâche.**
2. **`age` + `restic` dans `backup.sh`, reportés.** Chiffrer et répliquer hors site des
   sauvegardes d'une base qui ne contient aucun joueur réel, c'est une clé privée à gérer
   aujourd'hui pour une valeur nulle. `VACUUM INTO` + `integrity_check` + `foreign_key_check` +
   `zstd` + rétention restent en M0 — c'est la partie qui attrape les vraies erreurs. Le reste
   s'active au premier joueur, comme Litestream, déjà reporté pour la même raison.
3. **`pnpm sim fuzz` retiré de la porte de PR.** Le cas dangereux — la trame malformée — est
   couvert par `envelope-fuzz.test.ts` (10 000 entrées, M0-08). Fuzzer des intentions valides
   contre un moteur sans feature de jeu achète peu et introduit du risque d'instabilité sur une
   porte visée à huit minutes. Le mode existe et tourne à la demande ; il devient bloquant en M1.
4. **`prev-release.sqlite`, reporté** (O4) : un garde-fou qui ne garde rien.

Et une simplification qui n'est pas une coupe : **le seed de 248 événements — 244 à la date de cette revue — ne doit pas être
écrit à la main.** Il doit être produit en jouant une liste d'intentions scriptée à travers le
vrai `decide()` avec le RNG seedé. Un journal saisi à la main est un second moteur de règles à
maintenir : il dérive au premier ajustement de payload, et il peut contenir des états que le
moteur ne produirait jamais — ce qui rendrait `db:check` contrôle 9 menteur, précisément là où
on lui fait le plus confiance. La liste d'intentions, elle, se relit en PR. C'est écrit dans
M0-26.

**Ce que je n'ai pas coupé, et qui mérite qu'on le dise.** Le corpus doré de ~300 lignes, la
campagne longue de 2 000 événements, les douze oracles de `db:check`, les sept scénarios du
simulateur et le seed couvrant les 71 types d'événements *paraissent* démesurés pour un jalon
sans feature de jeu. Ils ne le sont pas : ce sont exactement les objets qui rendent vrai le
critère de recette (« casser une constante de règle fait rougir trois suites en trente
secondes »). C'est le cœur de la commande, et c'est ce qui rentabilisera les jalons suivants.
Couper là serait se tromper de cible.

---

## 8. Divergences entre documents, corrigées en silence

Ces points ne changent rien au plan, mais ils auraient fait perdre une heure à quelqu'un :

- `03-donnees.md` §3.1 déclarait `type GameEvent = z.infer<typeof GameEventSchema>` — l'inverse
  exact de la règle de miroir de `ARCHITECTURE.md` §4.3, qui veut que le type canonique vienne
  du moteur. Appliqué tel quel, cela créait la dépendance runtime `engine → contracts` que toute
  l'architecture cherche à éviter. → réécrit avec `satisfies z.ZodType<GameEvent>`.
- `03-donnees.md` §6.7 faisait dépendre `GET /healthz` de `quick_check`, de la taille du WAL, de
  l'âge de la dernière sauvegarde et de l'espace disque — alors que `01-architecture.md` §6 et
  `ARCHITECTURE.md` §4.5 disent l'inverse, et pour une bonne raison : **une sauvegarde en retard
  aurait suffi à sortir le conteneur de la rotation.** → les trois sondes sont désormais
  distinguées dans un tableau, et le bloc profond est déplacé sous `/api/admin/health`.
- `03-donnees.md` §7.1 décrivait encore le seed avec « 6 chroniques en couche 0, 2 en couche 1,
  1 en couche 2 » — le modèle à trois couches abandonné par l'arbitrage. Idem pour la ligne
  « compaction hiérarchique » en §0, et pour le contrôle 11 de `db:check` qui interrogeait des
  colonnes (`covers_from_seq`, `covers_to_seq`) qui n'existent pas.
- `03-donnees.md` §1.7 citait `chronicles.facts_json` (le DDL porte `doc_json`) et « ~60 formes »
  d'événements (il y en avait 70 à la date de cette revue, 71 depuis — je les ai comptés : 5 + 5 + 17 + 8 + 3 + 6 + 5 + 2 + 7 + 4 + 2 +
  1 + 5).
- `03-donnees.md` §4.5 renvoyait aux réparations « V1→V10 » quand `02-mj-ia.md` §9.5 en définit
  douze.
- `01-architecture.md` §2.7 listait `propose-price.ts`, `get-state.ts`, `propose-npc.ts` — des
  noms de fichiers qui ne correspondent à aucun des douze outils gelés en `02-mj-ia.md` §3.4.
  *(Depuis l'arbitrage A1, `propose-price.ts` n'est pas seulement mal nommé : il n'a plus de
  raison d'exister.)*
- `01-architecture.md` §8 disait que `pnpm verify` couvre « les jobs 2 à 9 », alors que §2.2 dit
  2 à 10 et que `verify` inclut bien `eval:offline` (job 10).
- `02-mj-ia.md` faisait mesurer `prompt-size.test.ts` par `countTokens` — **un appel réseau**,
  dans un test que M0-18 doit faire passer sans clé d'API. → estimateur local + référence
  commitée en PR, rapprochement avec `countTokens` au nocturne.
- M0-22 parlait de « 13 assertions » ; `02-mj-ia.md` §8.4 en définissait 14 — et 29 depuis les trois enseignements du prototype (voir §11 ci-dessous).

---

## 9. Ce que je n'ai pas touché et qui reste vrai

Les dix risques connus de `ARCHITECTURE.md` §9 sont bien identifiés et bien calibrés. Trois
méritent d'être relus avant de démarrer, parce qu'ils vont mordre tôt :

- le **miroir `engine ↔ contracts`** avec `exactOptionalPropertyTypes` (une demi-journée de mise
  au point annoncée — prévoyez-la sur M0-05, pas sur la tâche qui la découvrira) ;
- la **segmentation de phrases françaises** (`3 à 5 phrases`), source la plus probable de replis
  moteur injustifiés, donc visibles par les joueurs. M0-22 a déjà le bon critère : vingt exemples
  minimum ;
- le **partage des assertions entre eval et post-filtre de production** : durcir une assertion
  pour la CI durcit la production le même jour. La contrepartie est écrite ; il faudra s'en
  souvenir la première fois qu'on voudra « juste resserrer une regex ».

---

## 10. Résumé pour décision

| | |
|---|---|
| **Corrigé directement dans les fichiers** | 10 trous, 11 critères mous, 2 collisions, 4 ordres irréalistes, 4 coupes de périmètre, 9 divergences inter-documents |
| **Reste à arbitrer** | **Rien sur l'architecture.** A1 et A2 ont été tranchés (§1), un troisième arbitrage a transformé le conteur en port (§1bis), et les quatre points laissés ouverts par la seconde passe (§11.7) ont été tranchés à leur tour, avec un cinquième que le lead a soulevé lui-même (**§12**). **Un point de découpage reste ouvert** : la sonde de fumée M0-32 est placée en vague 7, le lead la voulait en vague 4 ; le coût réel du redécoupage est chiffré en **§12 A7** et en **§13** (voir aussi le tableau de §13.4) |
| **Tâches** | 31 (M0-21 absorbée par M0-16 ; M0-31 pour le corpus complet en vague 8 ; **M0-32** pour le signal précoce en vague 7) |
| **Verdict** | Exécutable. Le seul inconnu qui reste est **éditorial, pas architectural** : quel fournisseur gratuit produit une prose acceptable. La **sonde de fumée M0-32** en donne le signal dès la vague 7, et **M0-31** la mesure complète au début de la vague 8 |

---

# 11. Seconde passe — après les trois arbitrages et les trois enseignements du prototype

> **Date** : 2026-09-17, après la première passe ci-dessus.
> **Ce qui avait changé entre les deux passes** : les arbitrages A1 (le moteur tire le prix) et
> A2 (`time_shift` supprimé) ont été appliqués ; le conteur est devenu un **port** avec trois
> adaptateurs ; et les trois enseignements d'une session de prototype réellement jouée sont
> entrés dans la spec — registre de saga (`conteur/2.0.0`), état de scène structuré
> (`scene.facts_updated` + `scene_state` + bloc `<scene_apres>`), droit de refus borné.
> Deux agents ont écrit dans les mêmes fichiers pendant cette période ; c'est ce que cette passe
> devait vérifier.
>
> **Ce qui est corrigé l'est directement dans les fichiers.** Ce qui demande une décision du
> tech lead est en §11.6.

## 11.1 Verdict de la seconde passe

**Non, pas encore — mais les onze points bloquants trouvés étaient tous corrigeables sans
arbitrage, et ils le sont.** Aucun n'était une erreur de conception : c'étaient des **restes de
la version précédente** laissés par deux réécritures concurrentes, et des **critères
d'acceptation faux par construction** — la catégorie exacte que la première passe avait déjà
trouvée deux fois, et qui coûte le plus cher parce qu'elle fait rejeter du travail correct.

Les deux arbitrages, eux, tiennent partout.

## 11.2 Les deux arbitrages du lead — vérification exhaustive

**A1 — « payer le prix » : le moteur tire, point final.** Appliqué **partout**, sans reste.
`propose-price.ts` a disparu de l'arborescence de `01-architecture.md` §2.7, `price_choice` du
catalogue d'événements (`03-donnees.md` §3.4, avec la mention explicite « il n'existe pas de
`price_choice` » sur `narration.gm_proposal`), `optionId` et `playerChoices` de `move.resolved`,
et la liste gelée des douze outils n'en porte aucun. Le d12, `roll.price_paid`, le fait imposé
dans `<fait>`, le second tirage sur le flux `price` pour départager plusieurs effets et l'index
dans `effectIndex` sont cohérents entre `02` §3.4/§4.5, `03` §3.4/§4.6 et `ARCHITECTURE.md`
§4.4. **Un seul reste trouvé, et il était sérieux** : le commentaire de `PriceTableSchema`
(`03-donnees.md` §4.6) disait encore, trois lignes au-dessus du paragraphe d'arbitrage, que le
moteur « ne l'applique pas automatiquement : elle devient une proposition validée ». Un agent
qui implémente le schéma lit le commentaire du schéma. **Corrigé.**

**A2 — `time_shift` supprimé.** Aucun reste : le champ n'existe plus dans le schéma d'entrée, ni
dans la description de l'outil, ni dans la chaîne de traitement, et il est doublé de deux
garde-fous exécutables (`no_time_skip` en assertion dure et en post-filtre ; un test de surface
d'outils qui échoue si la clé réapparaît). La règle 7 du prompt système le porte côté modèle.

## 11.3 Les onze points bloquants — corrigés dans cette passe

| # | Où | Ce qui n'allait pas | Correction |
|---|---|---|---|
| B1 | `01-architecture.md` §2.7 | **`packages/ai/src/client.ts` — `createClaudeClient(config)`**. Un client nommé d'après un fournisseur, au cœur de `@for/ai`, en contradiction frontale avec le port. Toute la sous-section datait d'avant le refactor **et** d'avant le prototype : pas de `scene-render.ts`, pas de `outputs/scene.ts` ni `refusal.ts`, pas de `assertions/`, pas de `narration/run.ts`, des prompts en `.md` là où M0-18 livre des `.ts`, et un dossier `eval/` **à l'intérieur de `packages/ai`** — c'est-à-dire exactement le cycle `ai ↔ ai-eval` que `dependency-cruiser` interdit | Sous-section réécrite sur `02-mj-ia.md` §10, qui fait autorité. `client.ts` supprimé, avec une ligne qui dit qu'il n'existe aucun client de fournisseur hors de `narrator/adapters/` |
| B2 | `01-architecture.md` §3.5 | « un test n'appelle jamais l'**API Claude** » — un nom de fournisseur dans une règle transverse | Reformulé : « n'appelle jamais un fournisseur de modèle, quel qu'il soit » |
| B3 | `03-donnees.md` §4.6 | Le reste d'A1 décrit en §11.2 | Commentaire réécrit ; `suggestedEffects` explicitement requalifié (« malgré son nom hérité, il n'a rien d'une suggestion ») |
| B4 | `03-donnees.md` §1.1 | `ai_calls.purpose` acceptait `('narration','forge','chronicle','oracle_flavor','eval')` — **`judge` manquait**, alors que N2 appelle `structurer({ purpose: 'judge' })` : la première notation du juge aurait violé la contrainte `CHECK`. Et `oracle_flavor` / `eval` ne se rattachent à **aucun** usage du port, donc à aucune résolution de modèle (§0.6) | `CHECK (purpose IN ('narration','forge','chronicle','judge'))` — exactement les usages du port. Une exécution d'éval se distingue par `eval_tags_json` |
| B5 | `01-architecture.md` §5.4 | L'union close de `s2c.narration_error` ne portait pas `action_impossible`, que le droit de refus émet. `01` §5 **fait autorité** sur le protocole : le code n'aurait pas existé dans `@for/contracts`, et M0-29 avait un critère dessus | Code ajouté, avec la règle d'ordre (émis **après** `s2c.narration_done`) |
| B6 | `01-architecture.md` §8, job 11 | `pnpm sim fuzz` déclaré **bloquant sur PR**, en contradiction directe avec M0-28 et avec §7.3 de cette revue | Retiré de la porte de PR, avec la raison écrite dans la table |
| B7 | `02-mj-ia.md` §0.7 | **Le test de neutralité était faux par construction** : il interdisait `anthropic`, `openai`, `ollama` hors §0.3–§0.6, alors que ces mots apparaissent nécessairement en §0.1 (l'union `NarratorProviderId`, qui est le vocabulaire du port lui-même), en §10 (les chemins `adapters/<id>.ts`), en §11 et dans la phrase de §0.7 qui les énumère. Rouge à sa première exécution — donc désactivé dans la semaine | Scindé en **deux règles** : N1 (faits d'API : `stop_reason`, `cache_control`, `output_config`, `max_tokens`, `claude-`, `gpt-`, …) interdits partout sauf §0.3–§0.6 ; N2 (noms de fournisseur) interdits partout sauf cinq exemptions **nominatives et closes**. Vérifié : le document passe désormais les deux règles |
| B8 | M0-12 | Même faute, côté code : `grep -rn "anthropic\|openai\|ollama\|…" packages/contracts/src \| wc -l` devait afficher `0`, alors que la tâche livre `src/ai/narrator-port.ts`, qui **contient** l'union `NarratorProviderId`. Critère impossible à satisfaire | Réécrit en deux commandes tranchables : faits d'API à `0` ; noms de fournisseur confinés au seul fichier du port. Plus un test qui vérifie que l'union et le `CHECK` de `ai_calls.provider` portent les mêmes quatre valeurs |
| B9 | M0-29 | Troisième faute du même genre : `grep -rn "price_choice\|optionId\|playerChoices\|propose_price" … \| wc -l` devait afficher `0`, mais **`optionId` est un champ légitime de `campaign.truth_set`** — le choix d'une vérité de campagne par un joueur, sans le moindre rapport avec le prix | `optionId` sorti du premier `grep` et traité par une commande dédiée qui borne ses occurrences au payload `campaign.truth_set` |
| B10 | M0-24 / M0-29 | **Deux tâches créaient chacune un `narrator.ts`** — `src/game/narrator.ts` (M0-24, vague 7) et `src/ai/narrator.ts` (M0-29, vague 8) — tous deux décrits comme « la sélection du port » et le second comme « **la seule chose** qui lise la configuration du conteur ». Deux fichiers pour un rôle unique, et deux propriétaires | Un seul fichier, `packages/server/src/ai/narrator.ts`, **propriété de M0-24** (la vague 7 en a besoin) et seulement **consommé** par M0-29, avec l'exclusion écrite dans les deux fiches. `01-architecture.md` §2.8 aligné |
| B11 | `02-mj-ia.md` §2.1 + `03-donnees.md` §4.6 + M0-09/M0-16/M0-22 | Deux dégâts d'écriture concurrente. *(a)* Le prompt système portait **deux règles numérotées 6** : la règle du prix (6), celle du saut de temps (7), puis la règle du bloc `<scene>` de nouveau numérotée 6 — dans un texte que M0-18 doit vérifier « porte les règles 6 et 7 ». *(b)* L'assertion **dure** `price_respected` — qui est aussi un post-filtre de production — cherche « au moins un mot-clé de l'entrée tirée (liste `keywords` du contenu) », et **aucun schéma de contenu ne définissait `keywords`** : la moitié de l'assertion était inimplémentable | *(a)* La règle de scène devient **8**. *(b)* `keywords` ajouté à `PriceTableSchema.entries` (obligatoire, 1 à 6 entrées, sans chiffre), plus les critères correspondants en M0-09, M0-16 et M0-22 |

## 11.4 Corrections mineures, appliquées en silence

- **Deux `P15` dans le tableau des points tranchés de M0-TASKS** : l'arbitrage du port et
  l'enseignement 1 du prototype portaient le même numéro, et trois fiches renvoyaient à « P15 »
  en désignant l'un ou l'autre. L'arbitrage du port devient **P18** ; P15/P16/P17 restent les
  trois enseignements.
- **`spec-neutrality.test.ts` n'appartenait à aucune tâche** alors que `02-mj-ia.md` §0.7 et §10
  l'exigent. Ajouté aux livrables **et** aux fichiers touchés de M0-18, avec son critère.
- **M0-29 testait `src/ai/scene-state.ts` et `src/ai/refusal.ts` sans les livrer** : les deux
  fichiers étaient dans les critères et absents des livrables. Ajoutés, avec la précision que
  `refusal.ts` appelle `revertTurn()` de M0-24 plutôt que de refaire une annulation.
- **Seed** : le journal est passé à 248 événements sans que les deux séances soient recomptées
  (180 + 64 = 244). La séance en cours passe à **68**, et la somme est écrite dans le tableau.
- **`.env.example`** visait encore `min(12500, fenêtre × 0,6)` quand toute la spec vise 14 000.
- **`02-mj-ia.md` §8.2** : le cas d'éval citait `"table": "payer_le_prix"` là où l'identifiant de
  contenu est `pay-the-price`. Un identifiant faux dans le seul exemple complet de la spec est
  celui que trois agents recopieront.
- **Compte d'assertions** : M0-22 annonce 28, le §8.4 énumère 29 identifiants. Ce n'était pas une
  erreur mais une ambiguïté (`refusal_is_outcome_blind` est un grader de **corpus**, livré par
  M0-27, pas une fonction `(output, ctx)`). Le calcul est désormais écrit, et le compte se
  tranche par une commande. M0-31 disait « les 16 assertions » : ce sont les **16 dures**.
- **Deux critères « pas de duplication d'assertions »** reposaient sur `grep -rn "assertions" …`,
  qu'un runner lisant `case.expect.assertions` déclenche forcément. Remplacés par une recherche
  de **définitions** d'assertion, plus une égalité d'ensembles avec `Object.keys(ASSERTIONS)`.
- **M0-20** ne vérifiait rien de la validation conditionnelle du conteur, alors que `buildNarrator`
  lit `env.NARRATOR_TOOLS` et `env.NARRATOR_TIMEOUT_MS` sans condition : un défaut manquant
  produirait un `undefined` silencieux. Critère ajouté.
- **Libellé du circuit 1** (`03-donnees.md` §0.5, `ARCHITECTURE.md` §1) : il disait « un outil
  `propose_*` », mais `scene.facts_updated` vient du bloc `<scene_apres>`, qui n'est pas un
  outil. Un test écrit à la lettre du libellé n'aurait pas couvert le nouveau circuit.
  Reformulé en « une proposition du modèle validée par le serveur — outil `propose_*` **ou**
  bloc `<scene_apres>` ».
- **La famille `narration.*` n'était bornée nulle part.** Ajouter `kind: 'scene_facts'` et
  `kind: 'refusal'` à `narration.gm_proposal` avait l'air d'ouvrir deux types atteignables depuis
  le modèle hors des listes closes. C'est écrit maintenant, dans les deux documents : ces listes
  portent sur l'**état de partie**, `narration.*` est une **trace** sans valeur de jeu que le
  réducteur ne lit pas, et ce qui compte est ce que le serveur écrit **ensuite** — ce que les
  trois listes énumèrent déjà.
- **`system.reverted.byPlayerId`** était obligatoire alors qu'un refus du conteur n'a pas
  d'auteur humain : rendu `string | null`, avec le cas nommé.
- **Invariant 2** : la phrase que la première passe réclamait sur la fenêtre roulante de douze
  tours est écrite dans `ARCHITECTURE.md` §1.

## 11.5 Les quatre invariants contre la surface d'outils finale

**Invariant 1 — le moteur décide.** Douze outils, toujours douze, `TOOLS_VERSION` inchangée. Le
bloc `<scene_apres>` n'est pas un treizième outil et ne consomme aucun des trois appels du tour.
Trois circuits d'écriture, trois listes closes tenues séparément, et un test par liste. Le
circuit le plus exposé — le refus — ne transporte qu'une `cause` d'une énumération de quatre
valeurs et un nom : aucune valeur, aucun `targetSeqs`, aucun `EngineEffect`. **Tient.**

**Invariant 2 — la mémoire est dans la base.** L'état de scène est la seule addition de mémoire
de cette passe, et elle est faite **au bon endroit** : un événement de journal comme source de
vérité, une projection comme cache, rien dans la chronique, et une règle de préséance explicite
quand les deux se contredisent (`<scene>` gagne, et le contrôle C9 rejette la chronique fautive).
Il n'y a donc pas deux mémoires concurrentes de la présence — c'était le risque principal, et il
est fermé par construction plutôt que par discipline. Le budget reste borné : `<scene>` pèse 900
tokens, plafonné par 8 présents et 8 partis, avec un `CHECK` SQL en seconde ligne. **Tient.**

**Invariant 3 — le serveur est l'autorité.** Le bloc `<scene_apres>` ne sort jamais du serveur
(retenue de fin de flux, test dédié en M0-29), le texte joueur est échappé, `<scene_apres>` est
dans la liste des balises neutralisées, et F1 fait tomber tout bloc dupliqué. Un joueur qui
réussirait à faire écrire un faux bloc n'obtient rien de plus qu'un bloc ignoré. **Tient.**

**Invariant 4 — tout est rejouable.** `scene.facts_updated` porte un **instantané complet et
borné**, pas un delta — le réducteur reste total et sans jugement. Le second tirage du prix passe
par un flux RNG nommé et son index est persisté. Une annulation ne rend jamais un index au
générateur. `db:check` contrôle 9 couvre `scene_state` comme toute projection de zone C, et
l'arbitrage de ne **pas** ajouter un treizième oracle est le bon : un contrôle dédié aurait donné
l'illusion d'une garantie là où elle existe déjà. **Tient.**

## 11.6 Le droit de refus — la frontière est-elle étanche ?

**Oui, pour ce qu'on lui demande de garantir**, et la garantie est mécanique, pas déclarative :
`proveRefusal` lit l'état **au moment du `move.declared`** et jamais l'issue ; c'est une fonction
pure ; et `refusal_is_outcome_blind` rejoue l'intégralité du corpus avec les dés inversés en
exigeant le **même ensemble** de refus retenus. Il n'existe aucune façon de faire passer ce test
en trichant. S'y ajoutent quatre verrous : un refus par tour, trois retenus sur vingt tours, la
supervision de corrélation refus/issue, et l'index RNG jamais rendu — sans quoi le refus serait
devenu une machine à relancer jusqu'au bon résultat.

**Un point mérite l'attention du lead**, et il n'est pas une faille de l'invariant 1 : un refus
prouvé ne se produit que lorsque le moteur a **déjà résolu** une action contre une cible que
l'état donne pour absente, morte ou hors de portée. Autrement dit, le droit de refus rattrape, à
la fin du tour, ce que la validation d'intention n'a pas attrapé au début. Pour une cible
**structurée** (une entité de la scène), ce contrôle appartient à l'étape 2 du chemin d'une
intention, et le tour devrait être refusé avant les dés, par un `s2c.rejected` — ce qui est plus
honnête pour le joueur et ne coûte rien. Le droit de refus resterait alors ce pour quoi il a été
conçu : les cas que le moteur **ne peut pas** connaître, typiquement l'objet de fiction qui
n'existe pas. C'est une décision de règles, pas de technique : voir §11.7, point 3 — **tranché depuis, par la
négative** (§12 A6). Le refus reste après le jet, et le coût visible pour le joueur est payé
autrement : le tour annulé s'affiche **marqué annulé, avec sa preuve consultable**.

## 11.7 Ce qui demandait une décision du tech lead — **LES QUATRE SONT TRANCHÉS**

> **Statut : clos.** Les quatre points ci-dessous ont été arbitrés le 2026-09-17, avec un
> cinquième que le lead a soulevé de lui-même. Les décisions qui font foi sont en **§12** ;
> l'analyse ci-dessous est conservée comme mémoire du raisonnement, **pas** comme une question
> ouverte. Correspondance : point 1 → §12 A3 ; point 2 → §12 A4 ; point 3 → §12 A6 ;
> point 4 → §12 A5.

Rien de ceci n'empêchait de démarrer ; les quatre points se rattrapaient en quelques lignes.

1. **Trois variables d'environnement au-delà des cinq nommées** — `NARRATOR_TOOLS`,
   `NARRATOR_TIMEOUT_MS`, `NARRATOR_CONTEXT_WINDOW`. Elles sont justifiées (le support des outils
   dépend du modèle et pas de la passerelle ; un modèle local qui charge à froid dépasse 60 s
   sans être en panne ; la fenêtre gouverne le budget), documentées comme facultatives et propres
   à un adaptateur, et `01-architecture.md` §9.4 les porte. Elles n'ont pas été arbitrées.
2. **La réécriture de `.env.example`** est une modification de fichier de dépôt, pas une mise en
   cohérence de spec : elle renverse le point P6 de la première passe. Elle est conforme à la
   décision « le conteur est un port », mais elle mérite une confirmation explicite.
3. **Faut-il valider la présence de la cible à l'étape 2 du chemin d'une intention ?** Voir
   §11.6. Si oui, le droit de refus se restreint aux cas de fiction pure et le joueur ne voit
   plus jamais un tour résolu puis annulé pour une cible que le serveur savait absente. Si non,
   l'aller-retour visible reste la norme pour ce cas-là, ce qui est assumé en §4.8.4 mais
   arrivera plus souvent que « quelques fois par session ».
4. **Le départage d'un prix à plusieurs `suggestedEffects`** (second tirage sur le flux `price`,
   index dans `roll.price_paid.effectIndex`) est une **déduction** de la décision « le moteur
   tire », pas la décision elle-même. L'alternative — « le moteur prend toujours le premier
   effet » — est plus simple et tout aussi rejouable. Les deux sont compatibles avec les
   invariants 1 et 4 ; la spec porte aujourd'hui la première.

Trois points de la passe précédente restent par ailleurs ouverts et sont écrits comme tels dans
`02-mj-ia.md` §11.2 : les **seuils posés sans données de jeu réel** (quota de refus, bornes du
bloc de scène, longueur de phrase, marqueurs d'absence), le **caractère dur de
`banned_style_lexicon`** — qui augmentera mécaniquement le taux de replis moteur au démarrage —,
et **quel fournisseur gratuit tient la table**, dont le signal précoce vient désormais de M0-32
(vague 7) et la mesure complète de M0-31 (vague 8). Aucun n'est une question d'architecture.

---

# 12. Les cinq arbitrages du tech lead — appliqués

> **Date** : 2026-09-17, après la seconde passe. **Ce sont des décisions, pas des propositions.**
> Elles closent §11.7 en entier. Un seul agent a écrit cette passe d'application, précisément
> parce que la précédente avait souffert d'écritures concurrentes.

## A3 · Les trois variables d'environnement d'appoint — **VALIDÉES**

`NARRATOR_TOOLS` (`on` | `off` | `probe`), `NARRATOR_TIMEOUT_MS` et `NARRATOR_CONTEXT_WINDOW`
rejoignent officiellement les cinq `NARRATOR_*` de base. **Motif retenu**, écrit dans les trois
documents pour qu'on ne le redécouvre pas : *le support des outils dépend du modèle et non de la
passerelle, et un modèle local qui charge à froid dépasse 60 s sans être en panne.*

Elles restent facultatives et propres à un adaptateur, et elles sont désormais documentées **de
la même façon aux trois endroits**, avec leur valeur par défaut **et** l'adaptateur concerné :
`.env.example`, `02-mj-ia.md` §0.6 (tableau qui fait autorité), `01-architecture.md` §9.4.
`ARCHITECTURE.md` §4.5 porte la ligne de renvoi. Un reste corrigé au passage : l'adaptateur
`anthropic` codait `timeout: 60_000` en dur dans son constructeur au lieu de lire
`config.timeoutMs` — une variable validée qui n'aurait rien piloté sur l'un des quatre
adaptateurs.

## A4 · La réécriture de `.env.example`, et le **renversement de P6**

**Validée.** Et le point P6 de la revue de socle — « il n'y a qu'un fournisseur : Anthropic » —
est **officiellement RENVERSÉ** : ce n'est plus une décision en vigueur, nulle part. Le produit
doit pouvoir tourner sur un **fournisseur gratuit** ou sur un **modèle local**.

Conséquence sur ce document : le trou **T10** de la première passe (§4) reposait sur la lecture
renversée, et il est annoté comme tel. Ce que la première passe prenait pour une contradiction
du dépôt était la bonne intuition. `M0-TASKS.md` porte la trace en P6 et en P20.

## A5 · Le départage d'un prix à plusieurs `suggestedEffects` — **VALIDÉ tel que spécifié**

Second tirage sur le flux RNG `price`, index journalisé dans `roll.price_paid.effectIndex`.
**Le moteur décide, et c'est rejouable.** L'alternative « toujours le premier effet » est
abandonnée.

Vérification faite document par document : `03-donnees.md` §3.4, §4.6 et le commentaire de
`PriceTableSchema`, `02-mj-ia.md` §3.4 et §4.5, M0-29 — tous cohérents, et **aucun** ne laisse
entendre que le modèle ou le joueur choisit. Un manque comblé : `ARCHITECTURE.md` §4.4, qui est
le document d'autorité, décrivait le tirage du d12 mais **pas** le départage à plusieurs effets ;
la ligne y est désormais écrite.

## A6 · Le refus reste **APRÈS** le jet — confirmé, avec une transparence nouvelle

Un contrôle de faisabilité avant les dés remettrait le modèle dans le chemin de décision :
**inacceptable**. La conséquence est assumée — un joueur voit brièvement le résultat d'un tour
qui sera ensuite annulé. Le point 3 de §11.7 est donc tranché par la **négative** : on ne
déplace pas la vérification de cible à l'étape 2 du chemin d'une intention.

**Ce que l'arbitrage ajoute**, et qui change l'expérience sans toucher aux invariants :

1. **Le détail mécanique d'une scène n'est pas affiché par défaut.** Mouvement, dés, calcul,
   effets, prix, présage : tout cela est replié derrière une commande **« Pourquoi ? »**
   attachée à chaque scène. La fiction reste propre ; la preuve reste consultable.
2. **Un tour annulé est montré comme annulé**, avec sa preuve, jamais en disparaissant. Le
   `s2c.event` du `system.reverted` devient un **vecteur de marquage**. Deux formulations
   contraires traînaient dans les specs — `01-architecture.md` §5.4 et `02-mj-ia.md` §6.2
   disaient toutes deux que ces événements « retirent les lignes du journal côté client » — et
   elles sont corrigées.
3. **La preuve est une projection du journal**, pas une donnée fabriquée pour l'affichage :
   `TurnProofDto`, construite à la demande par `buildTurnProof(events, viewerId)`, fonction pure
   qui ne tire aucun dé et n'appelle pas le moteur. Chaque entrée porte son `eventSeq`.
   Transport : `c2s.why { correlationId }` → `s2c.turn_proof { correlationId, proof, truncated }`.
   **Bornes** : 32 effets, 120 caractères par libellé, **8 Kio** de JSON sérialisé — trente fois
   moins que la trame sortante de 256 Kio.

Effet de bord vérifié : la preuve ne montre **rien** du modèle (ni raisonnement, ni appel
d'outil, ni proposition refusée), donc elle ne contredit pas `02-mj-ia.md` §6.5 ; la phrase le
dit maintenant explicitement. Et le point 14 des questions ouvertes de `02-mj-ia.md` §11.2
(« faut-il montrer au joueur qu'un refus a eu lieu ? ») est clos par la même décision.

Tâches touchées : M0-05 (le DTO), M0-08 (les deux messages et leur borne), M0-19 (l'affordance
et le marquage côté client), M0-20 (`getTurnProof` dans l'interface), M0-24 (le constructeur
pur), M0-25 (le routage), M0-29 (l'ordre de diffusion d'un refus), M0-30 (l'aller-retour dans
le parcours de recette).

## A7 · La validation d'un fournisseur gratuit est **SCINDÉE**

En vague 8, c'est trop tard : si un modèle gratuit ne tient pas le prompt contraint, toute la
couche se conçoit différemment. **M0-32** est créée — sonde de **fumée**, sept assertions écrites
à la main (le lead en demandait six à huit), verdict lisible par un humain, aucune dépendance au
corpus complet, **aucun blocage de la CI**. **M0-31** garde le corpus complet en vague 8, et sa
fiche dit désormais explicitement que le signal précoce vient de la sonde de fumée.

> **Une réserve, et elle appartient au lead.** La consigne était « vague 4 au plus tard ». Or la
> sonde ne dépend que de deux livrables — le **prompt intégral** et le **port du narrateur** —
> et **les deux sont livrés par M0-18, en vague 6**, elle-même bloquée par M0-12 et M0-14
> (vague 5). **La vague 7 est donc le plus tôt atteignable** sans redécouper le reste ; c'est ce
> qui a été appliqué, et cela fait gagner une vague entière sur l'état précédent.
>
> **Correction de la troisième passe — le chiffrage ci-dessous était faux, et il l'était dans le
> sens optimiste.** Le redécoupage proposé (`narrator-port.ts` de M0-12 vers M0-05 en vague 3,
> puis `src/narrator/**` + `src/prompts/conteur.system.ts` de M0-18 vers une nouvelle tâche de
> vague 4) **n'atteint pas la vague 4** : une tâche n'est jamais dans la même vague que celle
> dont elle dépend, donc si le port et le prompt sortent en vague 4, la sonde sort en **vague 5**.
> Il oubliait en outre `SceneBlockSchema` (`packages/contracts/src/ai/scene.ts`, M0-12,
> **vague 5**), dont l'assertion 7 de la sonde a besoin. Le coût réel de la vague 4 est
> recalculé dans la fiche M0-32 : **deux fiches neuves** (une de vague 2 pour
> `contracts/src/ai/{narrator-port,scene}.ts`, une de vague 3 pour `packages/ai/src/narrator/**`
> et le prompt), **trois réécrites** (M0-05, M0-12, M0-18), **trois vagues touchées**, et un
> `@for/ai` qui compilerait en vague 3 contre un `@for/contracts` rempli dans la même vague par
> M0-05 — précisément le couplage intra-vague que la règle 2 du découpage interdit.
>
> C'est un arbitrage de découpage, pas une mise en cohérence : il n'a pas été pris
> unilatéralement, ni par la passe d'application, ni par cette passe de recette. La fiche M0-32
> porte la même réserve, au même niveau de détail.

---

# 13. Troisième passe — recette des cinq arbitrages

> **Date** : 2026-09-17, après la passe d'application de §12. **Rôle** : test master, pas
> auteur. Objet : vérifier que les cinq arbitrages sont appliqués **partout**, et surtout
> qu'**aucun document ne porte encore la version contraire ailleurs** — c'est le mode d'échec
> qui avait frappé la passe précédente, quand plusieurs agents écrivaient les mêmes fichiers.
> Cette passe-ci a relu les huit fichiers modifiés en entier et croisé chaque décision par
> `grep` sur les six documents plus `.env.example`.

## 13.1 Les cinq arbitrages — état après recette

| | Arbitrage | Appliqué | Reste contraire ailleurs ? |
|---|---|---|---|
| A3 | Trois variables d'appoint validées | oui — `.env.example`, `02-mj-ia.md` §0.6 (table d'autorité), `01-architecture.md` §9.4, `ARCHITECTURE.md` §4.5, ADR 0001, et vérifié par M0-20 | **non.** Les trois écritures portent les mêmes défauts et les mêmes adaptateurs. Aucune occurrence résiduelle de « cinq variables » seule. `timeout: 60_000` en dur ne subsiste dans aucun des quatre adaptateurs |
| A4 | `.env.example` agnostique, P6 renversé | oui — dépôt, `ARCHITECTURE.md` §4.5, `01-architecture.md` §9.4, `02-mj-ia.md` §11.1, P6/P20, T10 annoté | **non.** Aucune occurrence de `ANTHROPIC_API_KEY`, `AI_MODEL_*`, `AI_ENABLED`, `DATABASE_URL` hors des lignes qui les déclarent disparus |
| A5 | Départage de prix par second tirage `price` | oui — `ARCHITECTURE.md` §4.4, `02-mj-ia.md` §3.4 et §11.1, `03-donnees.md` §3.4, §4.6 et `PriceTableSchema`, M0-29 | **non.** Aucun document ne laisse le modèle ni le joueur choisir ; `optionId` n'apparaît que dans `campaign.truth_set`, et le critère de M0-29 le dit |
| A6 | Refus après les dés + « Pourquoi ? » + tour annulé montré | oui — `ARCHITECTURE.md` §4.4, `01-architecture.md` §2.4/§2.8/§2.9/§5.2/§5.4/§5.6, `02-mj-ia.md` §4.8.3/§4.8.4/§4.8.6/§6.2/§6.5/§11.1/§11.2, `03-donnees.md` §0.5/§3.7, M0-05, M0-08, M0-19, M0-20, M0-24, M0-25, M0-29, M0-30 | **non.** Plus aucune formulation « retirent les lignes du journal côté client » : les deux occurrences connues sont corrigées, et il n'y en avait pas de troisième |
| A7 | Sonde de fumée scindée | oui — M0-32 créée, M0-31 ajustée, `01-architecture.md` §2.1/§2.2, `02-mj-ia.md` §8.5/§10/§11.2, `ARCHITECTURE.md` §5/§7 | **une incohérence trouvée et corrigée** : `01-architecture.md` §2.2 annonçait « 6 à 8 assertions » là où quatre autres endroits disaient « sept ». Harmonisé : sept livrées, borne contractuelle 6–8. **Et le placement reste en vague 7** : voir §13.3 |

## 13.2 La preuve « Pourquoi ? » est bien une projection, pas une donnée fabriquée

C'était le risque principal pour l'invariant 4 : une preuve stockée serait une seconde source de
vérité, et deux sources divergent toujours. Vérifié point par point.

1. **Rien n'est persisté.** `TurnProof` est un DTO, jamais une table ni une colonne. Le DDL de
   `03-donnees.md` §1 ne gagne rien, et §0.5 la nomme explicitement « calculée à la demande,
   jamais stockée et jamais dénormalisée ».
2. **Rien n'est recalculé.** `buildTurnProof(events, viewerId)` est pure, ne lit pas la base,
   n'appelle ni `decide()` ni `rollChallenge()`. Trois critères de M0-24 le tranchent à la
   commande, dont un `grep` sur le fichier lui-même.
3. **Chaque entrée porte sa provenance.** L'`eventSeq` par entrée est le mécanisme qui
   distingue une projection d'une donnée d'affichage : une entrée sans `eventSeq` est refusée
   par `zTurnProof` (critère de M0-05) et par le test de M0-24.
4. **Le `.strict()` ferme la fuite qui aurait compté.** La preuve expose `rngStream` et
   `rngDrawIndex`, ce qui est sain — ce sont des faits de journal — **à condition** que la
   graine de campagne ne sorte jamais. Le schéma étant clos et énuméré champ par champ,
   `campaigns.rng_seed` ne peut pas y apparaître par accident. Rien à corriger.
5. **Aucune duplication d'information.** Ce que la preuve montre est exactement ce que le
   journal contient ; le client n'en recompose jamais rien (critère de rendu de M0-19), et
   au-delà des bornes il est renvoyé vers `GET /api/campaigns/:id/log`, c'est-à-dire vers la
   même source. L'invariant 4 n'est pas menacé.

**Une ambiguïté levée au passage.** `01-architecture.md` §5.4 disait que le `correlationId`
voyage « dans l'enveloppe » de `s2c.event`, sans dire laquelle — or le document insiste par
ailleurs pour ne jamais confondre deux enveloppes. Il s'agit de l'enveloppe **d'événement**
(`EventEnvelopeSchema`, `03-donnees.md` §3.1), héritée par chaque variante de `GameEvent` et
transportée dans `p.event` ; l'enveloppe WebSocket de §5.1 reste `{ v, t, id, ts, seq?, p }` et
**ne bouge pas**. La phrase le dit maintenant.

## 13.3 La sonde de fumée — indépendante, oui ; en vague 4, non

**Indépendance : vérifiée, et elle tient.** M0-32 ne dépend que de M0-18. Elle n'importe que
`CONTEUR_SYSTEM_PROMPT` et le port depuis `@for/ai`, plus `SceneBlockSchema` depuis
`@for/contracts` ; elle n'utilise ni le constructeur de contexte de M0-22 (même vague) ni le
harnais N0 de M0-27 (vague suivante), et deux `grep` le tranchent. Ses trois cas et ses sept
assertions vivent dans `smoke/` et ne sont importés par personne. C'est la seule duplication
autorisée du corpus, et elle est bornée.

**Placement : vague 7, et le lead doit trancher.** La consigne était « vague 4 au plus tard ».
Le chiffrage de la passe d'application se voulait la preuve qu'on ne pouvait pas mieux faire ;
il était faux, et faux dans le sens optimiste — il aboutissait à la vague 5, pas 4, et il
oubliait `SceneBlockSchema`. Le calcul corrigé est en §12 A7 et dans la fiche M0-32 : atteindre
réellement la vague 4 demande de faire démarrer la chaîne en **vague 2**, soit deux fiches
neuves, trois réécrites, trois vagues touchées, et un `@for/ai` qui compilerait contre un
`@for/contracts` rempli dans la même vague — le couplage intra-vague que la règle 2 interdit.

**Ce que cette passe n'a pas fait, et pourquoi.** Elle n'a pas redécoupé. La règle 5 du
découpage — « aucun agent ne modifie une spec, une divergence remonte au tech lead » — vaut
d'autant plus pour une décision d'ordonnancement qui déplace six fichiers et rouvre trois
fiches acceptées. Le rôle de cette passe était de donner au lead un chiffrage juste, pas de
choisir à sa place. **Le point reste ouvert, et c'est le seul.**

## 13.4 Corrections appliquées par cette passe

| # | Où | Ce qui n'allait pas | Corrigé |
|---|---|---|---|
| 1 | `01-architecture.md` §2.2 | « 6 à 8 assertions » contre « sept » dans quatre autres endroits — exactement le reste de version qu'on traquait | oui : sept livrées, borne 6–8 |
| 2 | `M0-TASKS.md` M0-01 | La boucle qui vérifie « toutes les commandes de §2.2 existent » n'avait pas été mise à jour avec `eval:smoke`. Le script aurait pu manquer du `package.json` racine sans qu'aucun critère ne le voie, et M0-32 comme M0-30 citent la commande (règle 8) | oui : `eval:smoke` ajouté à la boucle |
| 3 | `M0-TASKS.md` M0-32 | Critère **faux par construction** : il chargeait `packages/ai-eval/smoke/dist/assertions.js`, c'est-à-dire une arborescence de `dist/` par sous-dossier que rien ne spécifie | oui : la sonde imprime `assertions: 7` et sort en 1 hors borne — tranchable sans hypothèse de build |
| 4 | `M0-TASKS.md` M0-32 | « M0-27 **et M0-31** complètent `packages/ai-eval/package.json` en vague 8 » — or M0-31 ne le porte pas dans ses fichiers touchés, et deux écrivains dans la même vague violeraient la règle 2 | oui : M0-27 seule ; M0-31 n'y touche pas |
| 5 | `ARCHITECTURE.md` §5 | La ligne `@for/ai-eval` ne listait pas `@for/contracts`, alors que M0-32 l'y déclare pour `SceneBlockSchema`. `check:workspace` et `depcruise` auraient eu deux vérités | oui : dépendance ajoutée |
| 6 | `01-architecture.md` §5.4 | « son enveloppe » sans dire laquelle, dans un document qui interdit par ailleurs de confondre deux enveloppes | oui : enveloppe d'événement nommée, enveloppe WS explicitement inchangée |
| 7 | `M0-REVUE.md` §10 | « Reste à arbitrer : **Rien** », alors que §12 A7 laissait une décision de découpage au lead | oui : « rien sur l'architecture », plus le renvoi |
| 8 | `M0-TASKS.md` P23 · `M0-REVUE.md` §12 A7 · fiche M0-32 | Chiffrage du redécoupage faux dans le sens optimiste (vague 5 présentée comme vague 4 ; `SceneBlockSchema` oublié) | oui : recalculé aux trois endroits, avec le risque de couplage intra-vague nommé |

## 13.5 Les quatre invariants contre la surface d'outils finale

- **Invariant 1 — le moteur décide, l'IA raconte.** La surface d'outils **n'a pas bougé** : 12
  outils gelés, `TOOLS_VERSION` inchangée, aucun outil de prix, pas de `time_shift`. Les deux
  objets ajoutés par cette série d'arbitrages ne sont pas des outils : `c2s.why` est un message
  **client**, et `s2c.turn_proof` une réponse de **lecture**. Le modèle ne les voit ni ne les
  appelle. Le départage de prix (A5) va dans le sens de l'invariant : il retire au modèle **et**
  au joueur un choix que la lecture naïve leur laissait. `proposal-surface.test.ts` garde
  toujours ses trois listes closes, jamais fondues.
- **Invariant 2 — la mémoire est dans la base.** La preuve est construite à partir du journal,
  à la demande, et **hors** de toute fenêtre de contexte : elle n'entre dans aucun prompt et ne
  consomme aucun budget de `min(14 000, fenêtre × 0,6)`. `NARRATOR_CONTEXT_WINDOW` (A3) rend au
  contraire ce budget explicitement dépendant de l'adaptateur, ce qui le rend mesurable.
- **Invariant 3 — le serveur est l'autorité.** `c2s.why` ne transporte qu'un `correlationId` ;
  M0-08 le soumet au même test que tout autre `c2s.*`, et M0-25 exige qu'après cent appels
  `events` n'ait pas grandi. Le client **ne recompose jamais** une preuve depuis son état local
  (critère de rendu de M0-19) : il affiche la projection du serveur, ou rien. Un `correlationId`
  d'une autre campagne est traité comme inconnu.
- **Invariant 4 — tout est rejouable.** A5 journalise l'index du second tirage
  (`roll.price_paid.effectIndex`), donc le départage se rejoue à l'identique. A6 ne persiste
  rien de neuf et confirme que l'index de tirage RNG n'est **jamais** rendu après annulation.
  La preuve est une projection, donc elle ne peut pas diverger de sa source — §13.2.

## 13.6 Collisions et critères — nouveau croisement

**Collisions de fichiers, vague par vague** : aucune. Les deux zones à risque de cette série
sont la vague 7, où M0-32 arrive dans `packages/ai-eval/**` pendant que M0-22 est dans
`packages/ai` et M0-23/24/25 dans `packages/server`, et la vague 8, où M0-27 et M0-31 se
partagent `packages/ai-eval` — `src/`, `cases/`, `chronicle/`, `forge/` pour l'une, `probe/`
pour l'autre, `smoke/` pour personne. Le seul fichier réellement partagé,
`packages/ai-eval/package.json`, n'a qu'un écrivain par vague après la correction 4 de §13.4.
Côté serveur, `getTurnProof` est déclarée dans l'**interface** de M0-20 (vague 6) et
implémentée par M0-24 pendant que M0-25 la consomme : c'est le mécanisme qui existait déjà
pour les quatre greffons, réemployé, et il tient.

**Critères faux par construction** : un seul trouvé, corrigé (correction 3 de §13.4). Les
autres critères ajoutés par cette série se tranchent tous à la commande, et les trois qui
auraient pu être mous ont été écrits en anticipant le piège — le fichier d'assertions de la
sonde contient forcément la chaîne `ASSERTIONS`, la vérité de campagne porte `optionId` depuis
l'origine, et `select.ts` doit forcément nommer ses quatre adaptateurs. Ces trois exemptions
sont nommées dans les critères eux-mêmes, ce qui est la bonne façon de faire.

## 13.7 Verdict de la troisième passe

**Le socle reste PRÊT, et la vague 1 est exécutable telle quelle.** Les cinq arbitrages sont
appliqués, aucun document ne porte plus de version contraire, la preuve « Pourquoi ? » est une
projection authentique du journal, et les quatre invariants tiennent contre la surface d'outils
finale — qui n'a pas bougé. Huit corrections ont été appliquées ici, dont une seule aurait mordu
un agent en cours de route (le critère faux par construction de M0-32) et une seule aurait laissé
passer un défaut silencieux (`eval:smoke` absent de la boucle de M0-01).

**Une réserve, une seule, et elle est datée** : la sonde de fumée est en vague 7, le lead la
voulait en vague 4. Ce n'est pas une incohérence de spec — c'est une décision d'ordonnancement
dont le coût est maintenant chiffré juste. Elle ne bloque ni M0-01, ni les six vagues qui
suivent : elle se tranche à tout moment avant la fin de la vague 1, et elle ne coûte alors que
la réécriture de fiches qui n'ont pas encore été prises.
