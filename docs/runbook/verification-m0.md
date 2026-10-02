# Recette de M0 — la preuve que le socle tient

Ce qu'on exécute, dans l'ordre, pour dire que le jalon M0 est fini. Chaque ligne est une
commande et un code de sortie, jamais une affirmation.

Deux choses ne sont pas automatisables et sont marquées **MANUEL** : la connexion Discord de
bout en bout, et la lecture de la CI sur une PR de démonstration. Elles ne sont pas cochées par
cette page ; elles sont décrites pour qu'un humain les fasse et consigne ce qu'il a vu.

---

## 0. Avant de mesurer

| Geste | Pourquoi |
| --- | --- |
| `rm -rf packages/*/dist packages/*/*.tsbuildinfo .turbo packages/*/.turbo` | sinon l'aval lit un `dist/` périmé |
| `pnpm install --frozen-lockfile` | le `pnpm-lock.yaml` du dépôt, pas celui du poste |
| `--force` sur chaque tâche turbo | sans lui, turbo rejoue les journaux d'un **autre** worktree |

Node 24 (`.nvmrc`), pnpm 12 (`packageManager`). `NARRATOR_PROVIDER=stub` partout : aucune clé,
aucun réseau, aucune facture.

---

## 1. Les portes, sur un clone neuf

| Commande | Attendu |
| --- | --- |
| `pnpm install && pnpm verify` | `0`, en moins de 3 min |
| `pnpm exec turbo run build typecheck lint test --force` | `0` |
| `pnpm exec turbo run typecheck:tests --force` | `0` — **tâche distincte**, travail 4 de la CI |
| `pnpm run depcruise check:workspace format:check` | `0` |
| `pnpm run content:check test:golden` | `0` |
| `pnpm test:coverage` | `0`, seuil global 70 % |

`pnpm verify` enchaîne `format:check`, `lint`, `typecheck` (qui inclut `typecheck:tests`),
`depcruise`, `check:workspace`, `check:ci`, `content:check`, `test`, `test:golden`, `sim run`
et `eval:offline`. Deux commandes restent **hors** de `verify` : `pnpm test:coverage` (le seul
évaluateur du seuil global, travail 6) et les cibles de base, qui écrivent un fichier — c'est
`scripts/smoke-m0.sh` qui les enchaîne sur une base jetable.

---

## 2. La base

```bash
pnpm db:reset      # 0 — base remise à zéro, 248 entrées de journal
pnpm db:check      # 0 — les 12 oracles d'intégrité
```

Le contrôle 9 (`dump -> db:rebuild -> dump -> comparaison octet à octet`) est celui qui attrape
une projection mutée hors du réducteur. Il n'est **jamais** désactivé.

---

## 3. Le parcours de bout en bout

```bash
bash scripts/smoke-m0.sh   # 0
```

Elle enchaîne, sur une base jetable, dans un dossier temporaire supprimé à la sortie :

| Étape | Ce qu'on doit voir |
| --- | --- |
| installation | `pnpm install --frozen-lockfile : 0` |
| construction | `pnpm build : 0` |
| base | `db:migrate`, `db:seed`, puis la ligne que `db:check` écrit lui-même : « 12 oracles … Aucun défaut. » |
| démarrage | `/readyz : 200` |
| socket | `s2c.welcome` + `s2c.snapshot` + `s2c.presence`, dans cet ordre |
| reprise | des `s2c.event` livrés, avec leur `deliverySeq` |
| **un tour vivant** | `c2s.intent` soumis par un joueur dont le personnage est **actif**, puis le premier `s2c.event` **de ce tour-là** |
| « Pourquoi ? » | `c2s.why` → `s2c.turn_proof` sur ce tour, `firstSeq` **égal** au `seq` de l'événement reçu, chaque entrée dans `[firstSeq, lastSeq]`, trame < 8 Kio |
| arrêt | `SIGTERM : arrêt propre` |

Le tour vivant est ce que M0-30 a ajouté après recette : la sonde prouvait `c2s.why` sur des
entrées **amorcées**, redemandées par `c2s.resume`, là où le critère P22 écrit « après réception
du premier `s2c.event` d'un tour ». Aucune autre suite du dépôt ne joue un tour vivant sur une
socket — le simulateur ne branche pas `narrateTurn` (§9). C'est la différence entre « le serveur
démarre » et « la table tourne ».

L'`id` d'enveloppe de l'intention **devient** le `correlationId` du tour, et la sonde le tire de
l'espace `facade00-…` : avec le préfixe nul, il entrait en collision avec un `correlationId` du
seed et la preuve couvrait deux tours (`[7, 253]` au lieu de `[249, 253]`).

Un échec affiche les trente dernières lignes du journal du serveur : la sonde ne demande pas
d'aller le chercher.

---

## 4. Le canari — le critère qui justifie tout le reste

```bash
bash scripts/canary-regle.sh   # 0
```

Il met `TICKS_PER_MILESTONE.dangereux` à 7, reconstruit le `dist/` du moteur, lance les trois
suites, exige que **les trois** rougissent sous 30 s, puis restaure le fichier **par copie** —
**et reconstruit le `dist/`**. Les deux, dans le même `trap`. Restaurer la seule source laissait
`packages/engine/dist/types/progress.js` sur la constante violée : `git status` vide, source
juste, et `pnpm sim run` **rouge** après un canari réussi.

| Suite | Commande |
| --- | --- |
| test unitaire du moteur | `vitest run src/progress-track.test.ts src/index.test.ts` |
| corpus doré | `pnpm test:golden` |
| scénario du simulateur | `pnpm sim run` |

Une suite restée verte fait sortir le script en **1** en la nommant : c'est alors le socle qui
est en défaut, pas le canari.

**Contre-sonde du canari lui-même** : remplacer `AFTER` par la valeur d'origine (`dangereux: 8`)
doit faire sortir le script en **1**, avec les trois suites marquées « le canari n'a PAS
détecté ». Sans ça, un canari qui ne modifie rien sortirait en 0 et ne prouverait rien.

### Ce que le canari dit, et sur quelles constantes

Le script porte sur **une** constante. Le protocole rejoué sur d'autres, à la main, a montré que
la phrase du jalon — « modifier une constante de règle fait rougir trois suites » — n'est pas
vraie partout. Mesuré (`pnpm test:golden` seul, après `tsc -b packages/engine --force`) :

| Corpus doré | Constantes qu'il attrape |
| --- | --- |
| `challenge-matrix` | `ACTION_DIE`, `CHALLENGE_DIE`, `ACTION_SCORE_CAP` |
| `momentum-rules` | `DEFAULT_MOMENTUM_BOUNDS` |
| `progress-rolls` | `TICKS_PER_MILESTONE`, `TICKS_PER_BOX`, `MAX_PROGRESS_BOXES` |
| `gauge-rules` *(M0-30)* | `GAUGE_MIN`, `GAUGE_MAX` |

**Aucun corpus** ne couvre, mesuré une par une : `PRICE_DIE`, `DEFAULT_HARM`, `ATTRIBUTE_MIN`,
`ATTRIBUTE_MAX`, `CLOCK_ADVANCE_MIN`, `CLOCK_ADVANCE_MAX`, `SCENE_PRESENCE_MAX`,
`LIKELIHOOD_THRESHOLDS`. Les changer laisse la porte dorée **verte**. C'est signalé plutôt que
refermé en douce : chacune demande un corpus qui joue la mécanique concernée (le prix, les
dégâts, les horloges, les oracles, la scène), pas une ligne de plus dans un corpus existant.

---

## 5. Le simulateur et l'éval

```bash
pnpm sim run                                  # 0 — 7 scénarios verts, < 20 s
env -u NARRATOR_API_KEY pnpm eval:offline     # 0 — et un rapport dans reports/ai-eval/
pnpm eval:smoke --provider=stub               # 0 — docs/runbook/conteur-fumee.md, verdict daté
pnpm eval:probe --provider=stub               # 0 — docs/runbook/conteur-fournisseurs.md, daté
```

---

## 6. L'image et le déploiement

```bash
pnpm build                                                      # 0
docker build -f infra/Dockerfile -t for-m0:full .               # 0 — image COMPLÈTE
docker run --rm --entrypoint id for-m0:full -u                  # ne doit PAS afficher 0
docker inspect --format '{{.Config.Healthcheck.Test}}' for-m0:full   # non vide
docker compose -f infra/docker-compose.yml config               # 0
```

M0-04 ne construisait que l'étape `build` ; c'est **ici** que l'image complète est exigée.

---

## 7. La CI

```bash
grep -c 'continue-on-error' .github/workflows/ci.yml   # 0
bash scripts/check-ci-jobs.sh                          # 0
```

**MANUEL — lire la CI sans se tromper.** Une PR en conflit n'a pas une CI rouge : elle n'a
**pas de CI du tout**, parce que le déclencheur `pull_request` porte sur la ref de fusion que
GitHub ne fabrique pas. Donc :

```bash
gh pr view <n> --json headRefOid,statusCheckRollup
```

Compter les check-runs **sur le sha de tête**. Un tableau vide n'est pas un succès. Les douze
travaux doivent être présents et verts, et plus aucune étape ne tolère l'échec.

**MANUEL — le déploiement.** Un `push` sur `main` déclenche `.github/workflows/deploy.yml`.
Consigner ici l'exécution : date, sha, numéro de run, verdict.

| Date | Sha | Run | Verdict |
| --- | --- | --- | --- |
| _(à remplir)_ | | | |

---

## 8. MANUEL — la connexion Discord de bout en bout

**Cette étape n'est pas automatisable, elle n'est pas cochée, et elle reste à faire par un
humain.** Elle exige une application Discord réelle, un navigateur, et un compte. Aucune sonde
du dépôt ne la couvre : `scripts/smoke-m0.sh` pose sa session par `createSession`, c'est-à-dire
*après* OAuth, précisément parce qu'il ne peut pas traverser Discord.

### Ce qu'il faut avoir sous la main

| Élément | Où |
| --- | --- |
| une application Discord | <https://discord.com/developers/applications> |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | onglet **OAuth2** de l'application |
| l'URL de rappel déclarée | `http://localhost:8787/api/auth/discord/callback`, à ajouter dans **Redirects** |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| un compte Discord | n'importe lequel ; il deviendra un `players` |

### La procédure

1. `cp .env.example .env`, puis renseigner les quatre variables ci-dessus et
   `NARRATOR_PROVIDER=stub` ;
2. `pnpm db:reset` ;
3. `pnpm dev` — le serveur sur `:8787`, la SPA sur `:5173` ;
4. ouvrir <http://localhost:5173>, cliquer **se connecter avec Discord** ;
5. autoriser l'application sur l'écran Discord ;
6. revenir sur la SPA.

### Ce qu'on doit voir, et ce qui compte

| Point de contrôle | Attendu |
| --- | --- |
| l'écran d'autorisation Discord | demande la portée **`identify` seule** — aucune mention de l'adresse e-mail |
| après le retour | la liste des campagnes, et le pseudo Discord en haut |
| le cookie | `fr_session`, `HttpOnly`, `SameSite=Lax` — visible dans l'inspecteur, **illisible en JavaScript** |
| la base | `SELECT discord_username FROM players` rend le compte utilisé |
| `auth_sessions` | une ligne, dont la colonne d'identifiant est un **SHA-256**, jamais le cookie |
| la table | rejoindre une campagne ouvre la socket : `s2c.welcome`, le journal du seed, la présence |
| « Pourquoi ? » | replié par défaut sur chaque scène ; déplié, il rend le mouvement, les dés, les effets |
| déconnexion | les deux cookies sont effacés, et revenir sur `/` redemande Discord |

### Ce qu'on consigne

Date, version du dépôt (`git rev-parse --short HEAD`), compte utilisé, capture de l'écran
d'autorisation Discord (elle porte la portée demandée), et le verdict.

| Date | Sha | Compte | Verdict |
| --- | --- | --- | --- |
| _(à remplir)_ | | | |

---

## 9. Ce que cette recette ne prouve pas

- **la connexion Discord** : §8, manuelle, non cochée ;
- **le conteur du simulateur** : `@for/sim` pilote le vrai service, le vrai hub et le vrai
  moteur, mais **pas** le vrai tour de conteur — il compose `createCampaignService` sans
  `narrateTurn`, donc les sept scénarios tournent sur la narration de remplacement de M0-24.
  Le vrai tour (`runNarrationTurn`) est tenu par `packages/server/tests/ai/turn.test.ts` et
  exercé en production par `gamePlugin` ;
- **un fournisseur réel** : cette recette tourne avec `NARRATOR_PROVIDER=stub`, donc **aucune
  socket ne s'ouvre vers un modèle ici**. Ce n'est pas une limite du serveur : depuis M0-30 le
  serveur compose l'adaptateur d'`@for/ai` qui correspond au réglage, et le tableau ci-dessous
  dit lequel. `pnpm eval:probe` mesure un fournisseur, et son verdict informe une décision — il
  ne ferme pas une porte ;
- **la montée en charge** : aucune. SQLite WAL suppose un écrivain unique, et le `compose`
  déclare un seul réplica.

### Quel réglage donne quel fournisseur

Jusqu'à M0-30 `game/index.ts` appelait `buildNarrator(deps.env)` **sans le sélecteur
d'`@for/ai`** : tout réglage autre que `stub` rendait un port qui lève `unavailable` au premier
appel, le repli déterministe du moteur prenait la main, et **aucune configuration de ce serveur
ne parlait à un modèle**. Rien ne rougissait, parce que le repli fonctionne. Mesuré en recette,
`NARRATOR_PROVIDER=ollama` : `narration.gm_failed`, `errorKind: api_error`, aucune socket ouverte.

| `NARRATOR_PROVIDER` | Autres variables exigées | Ce que le serveur compose |
| --- | --- | --- |
| `stub` *(le réglage livré)* | aucune | l'adaptateur `stub` d'`@for/ai` : aucun transport, aucune clé, aucune sortie réseau |
| `anthropic` | `NARRATOR_API_KEY` | l'adaptateur `anthropic` : flux, outils, sortie structurée, cache de préfixe |
| `openai-compatible` | `NARRATOR_BASE_URL`, `NARRATOR_API_KEY`, `NARRATOR_MODEL` | l'adaptateur passerelle (OpenRouter, Groq, Together) |
| `ollama` | `NARRATOR_BASE_URL`, `NARRATOR_MODEL` | l'adaptateur local ; `NARRATOR_TIMEOUT_MS` est à monter pour un modèle qui charge à froid |

`env.ts` refuse de démarrer si la variable exigée manque — le défaut silencieux n'existe pas.

**`NARRATOR_MODEL` n'est exigé que des deux du bas, et ce n'est pas un oubli** (issue #89).
`anthropic` a un défaut nommé, `ANTHROPIC_DEFAULT_MODEL` ; les deux autres n'en ont pas, et ne
peuvent pas en avoir : l'un sert ce que son hôte a téléchargé, l'autre ce que sa passerelle
expose. Inventer un nom pour eux échangerait un modèle vide contre un modèle faux — le même 400,
un pas plus loin de la cause.

Mesuré avant le correctif : le corps partait avec `"model":""`, le fournisseur répondait 400, et
le tour retombait sur la prose de repli du moteur. **Rien ne rougissait, parce que le repli
fonctionne** — c'est le même aveuglement que celui du sélecteur ci-dessus, trouvé de la même
façon, en lisant le corps de la requête plutôt qu'en vérifiant qu'elle partait.

`NARRATOR_MODEL_STRUCTURED` reste facultatif partout : vide, il retombe sur `NARRATOR_MODEL`.
Le réglage que `.env.example` et `infra/docker-compose.dev.yml` livrent est `stub`, clé vide :
le dépôt est public, et un serveur qui tenterait un appel réseau à l'amorçage ne serait pas
acceptable.

**Tenu par** `packages/server/tests/game/narrator-wiring.test.ts`, qui lit le port que le
processus a réellement composé (décorateur `app.narrator`) pour chacune des quatre
configurations. Retirer `selectNarrator` de `game/index.ts` fait tomber sept de ses neuf tests.

**Et pour le modèle**, `packages/ai/tests/narrator-model-required.test.ts` : les deux adaptateurs
refusent **à la construction**, sans ouvrir de socket, et `packages/server/src/env.test.ts`
refuse la configuration en nommant la variable. Remettre `config.model ?? ''` fait tomber huit
des dix-sept tests du premier ; retirer la clause d'`env.ts` en fait tomber deux du second.
