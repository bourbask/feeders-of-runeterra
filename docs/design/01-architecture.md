# 01 — Architecture du monorepo « Feeders of Runeterra »

> Statut : **normatif sur la structure du monorepo**. Un agent developpeur qui cree un fichier
> n'a aucune decision de structure a reprendre ici.
> **Autorite superieure : `docs/ARCHITECTURE.md`**, dont la table d'arbitrage tranche toute
> divergence avec `02-mj-ia.md` ou `03-donnees.md`.
> Portee : jalon **M0** (fondations) et cadre des jalons suivants.
> Toute deviation exige un ADR dans `docs/adr/` qui amende explicitement ce fichier.

Langue : **interface et contenu en francais** ; **code, identifiants, commentaires, messages de
log et noms de commits en anglais**. Les chaines destinees au joueur vivent dans `@for/content`
(libelles) ou dans les schemas d'erreur (`userMessage`), jamais en dur dans la logique.

---

## 0. Rappel des invariants et ou ils sont mecaniquement garantis

| # | Invariant | Garanti par | Test qui casse le build |
|---|-----------|-------------|--------------------------|
| 1 | Le moteur decide, l'IA raconte | `@for/engine` est la seule source de `GameEvent`. Les outils modele sont declares dans `@for/ai/src/tools/` et typés `ReadOnlyTool \| ProposalTool`. Aucune `ProposalTool` n'ecrit : elle produit un `Intent` repasse par `decide()`. | `packages/ai/tests/tool-surface.test.ts` : enumere les outils exportes et echoue si un outil n'est ni lecture ni proposition. |
| 2 | La memoire est en base | Le prompt est assemble par `@for/ai/src/context/assemble.ts` a partir de `CampaignState` + `chronicle` + fenetre d'evenements bornee. Aucun historique de conversation n'est conserve cote modele. | `packages/ai/tests/context-budget.test.ts` : le contexte assemble reste sous le budget de tokens quel que soit l'age de la campagne (corpus « campagne longue »). |
| 3 | Le serveur est l'autorite | Le protocole WS n'expose **aucun** message client porteur d'etat : le seul message mutant est `c2s.intent`. `GameEvent` n'est ni construit ni accepte cote client. | `packages/contracts/tests/ws-protocol.test.ts` : echoue si un schema `c2s.*` reference `GameEvent`, `CampaignState` ou un champ de jauge. |
| 4 | Tout etat est rejouable | Journal `events` append-only + `reduce()` pur. Les snapshots ne sont qu'un cache. | `packages/sim` : `replay-equivalence` — rejouer le journal depuis zero doit donner un etat byte-identique au snapshot. |

---

## 1. Packages du monorepo

Gestionnaire : **pnpm workspaces** (pnpm **12** — ADR 0002 §4 ; depuis pnpm 12, l'autorisation
des scripts d'installation s'ecrit `allowBuilds` dans `pnpm-workspace.yaml`, l'ancien
`onlyBuiltDependencies` etant ignore en silence). Node **24 LTS** (`.nvmrc`, `engines` dans le
`package.json` racine, `packageManager` epingle). Tous les packages sont **ESM** (`"type": "module"`).
Scope npm : `@for/*` (prive, jamais publie ; `"private": true` partout).

### 1.1 Tableau des packages

| Package | Chemin | Responsabilite | Deps runtime autorisees |
|---|---|---|---|
| `@for/engine` | `packages/engine` | Regles du jeu. Des, mouvements, jauges, souffle, progression, serments, horloges, reducteur d'evenements, invariants d'etat. **Pur.** | **aucune** |
| `@for/contracts` | `packages/contracts` | Schemas Zod + types deduits : etat, evenements, intentions, protocole WS, routes HTTP, schemas de contenu, schemas d'E/S IA. | `zod` uniquement |
| `@for/content` | `packages/content` | Donnees de jeu versionnees (JSON) + registre typé + libelles francais. Aucun acces disque a l'execution. | `@for/contracts` |
| `@for/testkit` | `packages/testkit` | RNG scriptes, constructeurs de fixtures, runner de corpus dores, assertions de domaine. | `@for/engine`, `@for/contracts` |
| `@for/db` | `packages/db` | Schema Drizzle, migrations SQL, ouverture SQLite WAL, repositories, journal d'evenements, snapshots. | `drizzle-orm`, `better-sqlite3`, `@for/contracts` |
| `@for/ai` | `packages/ai` | **Adaptateurs du port du conteur** (`02-mj-ia.md` §0.3 a §0.5), assemblage de contexte, prompts, surface d'outils, parseurs de sortie, **assertions de style** (partagees eval / post-filtre), construction des requetes de forge et de chronique. **Pas de persistance, pas d'ordonnancement de job, aucune lecture de `process.env`.** | `@anthropic-ai/sdk` (**optionnelle** : seul l'adaptateur `anthropic` l'utilise), `@for/contracts`, `@for/content` |
| `@for/scenario` | `packages/scenario` | Construction guidee d'un scenario (ADR 0012, S-04) : les dix etapes de `docs/design/04-scenarios.md` §6, le port de decision et ses adaptateurs simules, le melange sur le flux nomme `scenario`. **Pur** : `types: []`, aucun acces disque, reseau ou base. | `@for/engine`, `@for/contracts`, `@for/content` |
| `@for/server` | `packages/server` | Fastify : HTTP, OAuth Discord, sessions, hub WebSocket, **service applicatif de table** (orchestration intent -> engine -> db -> diffusion -> IA). | Fastify & co, tous les packages ci-dessus |
| `@for/client` | `packages/client` | SPA Vite + React. Affichage, saisie d'intentions, rendu du journal. | `react`, `@for/contracts`, `@for/engine` (lecture seule) |
| `@for/ai-eval` | `packages/ai-eval` | Harnais d'eval des sorties IA : corpus de cas, sorties enregistrees, runners N0/N1/N2, graders. **Ne contient aucune assertion** : elles vivent dans `@for/ai/src/assertions/`. | `@for/ai`, `@for/content`, `@for/testkit` |
| `@for/sim` | `packages/sim` | Simulateur de table headless (CLI + API) : joue des scenarios scriptes contre le service applicatif reel, sans navigateur ni appel IA. | `@for/server`, `@for/testkit`, `@for/db` |

Outillage partage, **hors** `packages/` :

| Package | Chemin | Contenu |
|---|---|---|
| `@for/tsconfig` | `tooling/tsconfig` | `base.json`, `library.json`, `node.json`, `react.json`, `test.json` |
| `@for/eslint-config` | `tooling/eslint-config` | `index.js`, `react.js`, `engine-purity.js` (regles maison) |
| `@for/prettier-config` | `tooling/prettier-config` | `index.json` |

### 1.2 Graphe de dependances (qui peut importer qui)

```
                         @for/engine        (couche 0 — pur, feuille, zero dep)
                              ^
                              | import type UNIQUEMENT
                              |
                         @for/contracts     (couche 1 — zod)
                         ^     ^      ^
              +----------+     |      +-----------+
              |                |                  |
        @for/content      @for/testkit        @for/db          (couche 2)
              ^                ^                  ^
              |                |                  |
              +-------+ @for/ai   @for/scenario +---------+     (couche 3)
                      |     ^           ^         |
                      +-----+-----------+---------+
                             |
                @for/server        @for/ai-eval                (couche 4)
                 ^        ^
                 |        |
            @for/sim   @for/client*                             (couche 5)
```

`*` : `@for/client` est dessine en couche 5 pour la lecture, **sans arete vers la couche 4**.
Il n'importe ni `@for/server`, ni `@for/ai`, ni `@for/db` (regle 5 ci-dessous) : ses seules
dependances sont `@for/contracts`, `@for/engine` en lecture seule et `@for/content/ui` (§1.1).

`@for/ai-eval` depend de `@for/ai`, jamais l'inverse : les assertions de style vivent dans
`@for/ai/src/assertions/` parce qu'elles servent **aussi** de post-filtre d'execution. Un cycle
`ai <-> ai-eval` est interdit par `dependency-cruiser`.

Regles d'arete, **verifiees en CI** par `dependency-cruiser` (`.dependency-cruiser.cjs`) :

1. `@for/engine` : `dependencies` **doit etre `{}`**. Aucun import hors de son propre `src/`.
   Interdits : builtins Node (`node:*`, `fs`, `path`, `crypto`), `Math.random`, `Date.now`,
   `new Date()`, `performance.now`, `process`, `globalThis`.
2. `@for/contracts` -> `@for/engine` : **type-only** (`import type`). Importer une valeur depuis
   `engine` est une erreur de lint. Rationnel : garder `contracts` fidele aux types du moteur
   sans dependance runtime inverse.
3. `@for/content` n'importe jamais `@for/db`, `@for/ai`, `@for/server`.
4. `@for/ai` n'importe **jamais** `@for/db` : tout etat lui est injecte par le serveur.
   C'est ce qui rend l'eval IA executable hors base.
5. `@for/client` n'importe **jamais** `@for/db`, `@for/ai`, `@for/server`, ni `@for/content`
   (entree principale). Il peut importer `@for/content/ui` (libelles) et `@for/engine`
   **pour affichage seulement** : calcul de cotes, formatage, previsualisation. Une regle ESLint
   (§4.2) lui interdit d'importer `decide`, `reduce`, `reduceAll`, `rollChallenge`,
   `rollProgress`.
6. `@for/testkit` est une `devDependency` partout sauf dans `@for/sim`, ou elle est runtime.
7. Aucun cycle. `dependency-cruiser` echoue sur la regle `pas-de-cycle`.
8. `@for/scenario` n'importe **jamais** `@for/db`, `@for/server`, `@for/ai`, `@for/ai-eval`,
   `@for/sim` ni `@for/client` (regle `scenario-ne-touche-ni-la-base-ni-le-serveur`). Son
   `tsconfig` porte `types: []`, donc un builtin Node ne compile pas, et un bloc de lint
   `pureteDuScenario` attrape l'import a effet de bord nu, que le compilateur laisse passer.
   Un modele reel se branche derriere `ScenarioDecisionPort` depuis `@for/server` ; le paquet
   ne nomme aucun SDK.

### 1.3 Purete de `@for/engine` — definition operationnelle

`@for/engine` est pur si et seulement si :

- son `package.json` a `"dependencies": {}` et `"sideEffects": false` ;
- toutes ses fonctions exportees sont deterministes a `Rng` et `now` donnes ;
- aucune de ses fonctions ne lit ni n'ecrit hors de ses arguments ;
- il compile et s'execute a l'identique sous Node et dans un navigateur ;
- `reduce(state, event)` ne mute jamais `state`. En developpement, les etats sont figes par
  `Object.freeze` derriere la constante de build `__DEV__` (injectee par tsup et Vite,
  valeur `false` en production). `process.env` est interdit dans ce package.

Test gardien : `packages/engine/tests/purity.test.ts`
(lit son propre `package.json`, scanne `dist/index.js` a la recherche des identifiants interdits).

---

## 2. Structure de dossiers

### 2.1 Racine

```
feeders-of-runeterra/
  .github/workflows/ci.yml            # lint + typecheck + tests + build (bloquant)
  .github/workflows/deploy.yml        # build image + push GHCR + SSH (main uniquement)
  .github/workflows/ai-eval.yml       # eval IA (nocturne + label `run-ai-eval`)
  .github/CODEOWNERS
  .github/pull_request_template.md
  .vscode/settings.json
  docs/
    ARCHITECTURE.md                   # DOCUMENT DE REFERENCE — a lire en premier
    design/01-architecture.md         # ce fichier
    design/02-mj-ia.md                # couche IA : MJ, outils, chronique, forge, eval
    design/03-donnees.md              # schema SQLite, journal, contenu versionne, exploitation
    adr/0001-socle-technique.md
    runbook/deploy.md
    runbook/backup-restore.md
    runbook/ci.md                     # M0-03
    runbook/verification-m0.md        # M0-30
    runbook/conteur-fumee.md          # verdict de la sonde de fumee (M0-32)
    runbook/conteur-fournisseurs.md   # mesure complete et recommandation (M0-31)
  tooling/tsconfig/                   # @for/tsconfig
  tooling/eslint-config/              # @for/eslint-config
  tooling/prettier-config/            # @for/prettier-config
  packages/{engine,contracts,content,scenario,testkit,db,ai,ai-eval,server,client,sim}/
  content/                            # contenu de jeu versionne (JSON) — voir 03-donnees.md §4
  infra/
    Dockerfile                        # multi-stage, image unique server+client
    docker-compose.yml                # prod : app + caddy
    docker-compose.dev.yml            # dev : rien d'autre que l'app (sqlite = fichier)
    Caddyfile
    scripts/deploy.sh
    scripts/backup.sh
    scripts/restore.sh
  scripts/
    check-workspace.ts                # coherence des package.json, versions, scripts obligatoires
    generate-content-index.ts         # regenere packages/content/src/generated/index.ts
    new-package.ts                    # gabarit de package
  .dependency-cruiser.cjs
  .editorconfig
  .gitattributes                      # *.json text eol=lf ; golden/** -diff
  .nvmrc                              # 24
  eslint.config.js                    # flat config racine, delegue a @for/eslint-config
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  prettier.config.js
  tsconfig.json                       # solution-style : references vers chaque package
  vitest.workspace.ts
  turbo.json                          # Turborepo — decision actee (ADR 0001)
  README.md
  CLAUDE.md                           # instructions agent : rappel des invariants + commandes
  .env.example
```

`pnpm-workspace.yaml` :

```yaml
packages:
  - "packages/*"
  - "tooling/*"
```

### 2.2 Orchestration des taches

**Turborepo** (`turbo.json`) pour le cache et l'ordonnancement. Scripts obligatoires, presents
a l'identique dans **chaque** package (verifie par `scripts/check-workspace.ts`) :

| Script | Effet |
|---|---|
| `build` | emet `dist/` (tsup pour les libs, `tsc -b` pour les types, `vite build` pour le client) |
| `typecheck` | `tsc -p tsconfig.json --noEmit` |
| `typecheck:tests` | `tsc -p tsconfig.test.json --noEmit` — les tests sont hors du tsconfig de build ; sans cette passe, un fichier de test porte une erreur de type franche sans qu'aucune porte ne bronche |
| `lint` | `eslint .` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |

Scripts racine :

```
pnpm dev            # turbo run dev --parallel   (server tsx watch + client vite)
pnpm build
pnpm verify         # voir la definition exacte ci-dessous  <- porte de merge locale
pnpm test
pnpm test:coverage  # vitest run --coverage a la racine — SEUL chemin qui evalue le seuil
                    #   global de couverture (ADR 0002 §2 et §3) ; c'est le job 6 de la CI
pnpm lint           # turbo run lint
pnpm typecheck      # tsc -b --pretty false
pnpm format:check   # prettier --check .
pnpm format         # prettier --write .
pnpm depcruise      # depcruise --config .dependency-cruiser.cjs packages tooling
pnpm check:workspace # scripts/check-workspace.ts
pnpm test:golden    # corpus dores uniquement
pnpm golden:update  # regenere les corpus (GOLDEN_UPDATE=1)
pnpm sim            # @for/sim CLI  (les sous-commandes : pnpm sim run|list|record|replay|fuzz)
pnpm db:generate    # drizzle-kit generate
pnpm db:check-schema # drizzle-kit check + dump normalise == schema.expected.sql
pnpm db:migrate
pnpm db:studio
pnpm db:seed
pnpm content:index  # scripts/generate-content-index.ts
pnpm content:check  # chargeur 4 passes ; sort en code 1 sur la moindre erreur
pnpm db:reset       # rm data/app.db* + migrate + seed  <- commande du quotidien
pnpm db:rebuild     # reconstruit les projections depuis le journal
pnpm db:check       # 12 oracles d'integrite
pnpm eval:offline   # N0 — zero appel API, tourne sur chaque PR
pnpm eval:record    # rafraichit les sorties enregistrees de N0 (necessite un fournisseur configure)
pnpm eval:live      # N1 — necessite un fournisseur configure ; --provider=<id> pour en cibler un autre
pnpm eval:judge     # N2
pnpm eval:smoke     # sonde de FUMEE : sept assertions ecrites a la main (borne contractuelle
                    #   6 a 8), verdict lisible par un humain, ne bloque jamais la CI (M0-32)
pnpm eval:probe     # sonde un fournisseur candidat contre le corpus d'assertions (M0-31)
```

**Cette liste est exhaustive et contractuelle.** Toute commande citee dans un critere
d'acceptation de `docs/M0-TASKS.md` ou dans un job de CI doit y figurer ; `scripts/check-workspace.ts`
echoue si le `package.json` racine en perd une. Les commandes d'exploitation citees par
`03-donnees.md` mais **hors M0** (`db:snapshot`, `db:gc`, `db:backfill`, `db:export-campaign`,
`db:import-campaign`, `db:purge-player`), ainsi que `hooks:install` (§4.3), ne sont pas livrees
en M0 et n'apparaissent dans aucun critere d'acceptation de ce jalon.

`pnpm verify` = `format:check` + `lint` + `typecheck` + `depcruise` + `check:workspace` +
`content:check` + `test` + `test:golden` + `eval:offline`. Porte de merge locale, **mais pas
la CI entiere** : elle ne lance ni `db:check-schema`, ni `db:migrate`, ni `db:seed` — le job 8
(`migrations`) n'est donc pas couvert du tout. Si elle passe, les jobs 2, 3, 4, 7 et 10 passent ;
les jobs 5, 6 et 9 passent pour la part qu'elle en execute, a l'exception de
`scripts/check-ci-jobs.sh` (job 5), du seuil global de couverture (`test:coverage`, job 6) et de
`content:index && git diff --exit-code` (job 9).

### 2.3 `packages/engine`

```
packages/engine/
  package.json          # dependencies: {} — NON NEGOCIABLE
  tsconfig.json         # extends @for/tsconfig/library.json
  tsup.config.ts
  src/
    index.ts            # SEULE surface publique : re-exporte tout ce qui suit
    result.ts           # Result<T,E>, ok(), err(), isOk()
    rng.ts              # Rng, createSeededRng, RngTrace
    ids.ts              # types de marque (branded ids) + IdFactory
    types/
      attributes.ts     # AttributeId, ATTRIBUTES, ATTRIBUTE_SPREAD
      gauges.ts         # GaugeId, GAUGE_MIN/MAX, MomentumBounds
      progress.ts       # ProgressRank, TICKS_PER_MILESTONE, ProgressTrack
      character.ts      # CharacterSheet, CharacterState
      clock.ts          # Clock (horloge de campagne, 4/6/8/10 segments)
      vow.ts            # Vow
      campaign.ts       # CampaignState (racine de l'etat de partie)
      effects.ts        # EngineEffect (union discriminee declaree par le contenu)
      events.ts         # GameEvent (union discriminee) — catalogue : 03-donnees.md §3.4
      intents.ts        # Intent (union discriminee)
      brief.ts          # NarrationBrief (le fait acquis livre au modele)
      violations.ts     # RuleViolation (code + details, sans texte humain)
    dice/
      challenge.ts      # rollChallenge
      progress.ts       # rollProgress
      oracle.ts         # rollOracle (tables ponderees ; les tables viennent en argument)
      price.ts          # rollPrice (d12, table « payer le prix »)
      presage.ts        # rollPresage (table des presages)
    moves/
      face-danger.ts        # affronter le danger
      secure-advantage.ts   # assurer un avantage
      gather-information.ts # rassembler des informations
      probe-a-soul.ts       # sonder une ame
      strike.ts             # frapper
      endure-harm.ts        # encaisser
      endure-cold.ts        # endurer le froid
      swear-a-vow.ts        # jurer un serment
      reach-a-milestone.ts  # atteindre un jalon
      fulfill-your-vow.ts   # accomplir son serment
      forsake-your-vow.ts   # renier son serment
      index.ts              # MOVE_REGISTRY: Record<MoveId, MoveHandler>
    momentum.ts        # burn, cancel, reset, clamp
    gauges.ts          # applyGaugeDelta, clamp, seuils
    progress-track.ts  # markProgress, fillBoxes, boxesFilled
    decide.ts          # decide(state, intent, ctx) -> Result<Decision, RuleViolation>
    reduce.ts          # reduce, reduceAll, createInitialCampaignState
    invariants.ts      # checkInvariants(state) -> RuleViolation[]
    narration-fallback.ts # repli deterministe : choisit un gabarit FOURNI PAR LE CONTENU
                          #   (aucune chaine francaise en dur dans le moteur)
  tests/
    purity.test.ts
    dice/*.test.ts
    moves/*.test.ts
    reduce.test.ts
    golden/                       # corpus dores (voir §7.3)
      challenge-matrix.golden.json
      momentum-rules.golden.json
      progress-rolls.golden.json
```

**Signatures cles** (a respecter a la lettre) :

```ts
// src/rng.ts
export interface Rng {
  /** Entier uniforme dans [1, sides]. Seule primitive aleatoire du moteur. */
  roll(sides: number): number;
}
export interface RngDraw { readonly sides: number; readonly value: number }
export interface TracingRng extends Rng { trace(): readonly RngDraw[] }
/** PRNG deterministe (cyrb128 + sfc32), implemente sans dependance. */
export function createSeededRng(seed: string): TracingRng;

// src/result.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// src/ids.ts
export type CharacterId = string & { readonly __brand: 'CharacterId' };
export type CampaignId = string & { readonly __brand: 'CampaignId' };
export type EventId = string & { readonly __brand: 'EventId' };
export interface IdFactory { next(): string }

// src/dice/challenge.ts
export interface ChallengeInput {
  readonly attribute: number;   // 1..3
  readonly bonus: number;       // modificateurs additionnels (peut etre negatif)
  readonly momentum: number;    // -6..10
  readonly burnMomentum: boolean;
}
export interface ChallengeRoll {
  readonly actionDie: number;              // d6 brut
  readonly momentumCancelled: boolean;     // souffle negatif == de d'action
  readonly rawScore: number;               // actionDie(+0 si annule) + attribute + bonus
  readonly score: number;                  // min(rawScore, 10), ou momentum si brule
  readonly burned: boolean;
  readonly challengeDice: readonly [number, number];
  readonly outcome: Outcome;               // 'franche' | 'partielle' | 'echec'
  readonly presage: boolean;               // des de defi identiques -> presage
}
export function rollChallenge(input: ChallengeInput, rng: Rng): ChallengeRoll;

// Vocabulaire de domaine — docs/ARCHITECTURE.md §4 : les VALEURS d'enumeration de
// mecanique restent en francais, les identifiants de code sont en anglais.
export type Outcome = 'franche' | 'partielle' | 'echec';
export type Rank = 'genant' | 'dangereux' | 'redoutable' | 'extreme' | 'epique';
export type GaugeId = 'vigueur' | 'ame' | 'vivres';
export type AttributeId = 'vif' | 'coeur' | 'fer' | 'ombre' | 'esprit';

// src/dice/progress.ts
export interface ProgressRoll {
  readonly filledBoxes: number;                    // 0..10
  readonly challengeDice: readonly [number, number];
  readonly outcome: Outcome;
  readonly presage: boolean;
}
export function rollProgress(filledBoxes: number, rng: Rng): ProgressRoll;

// src/decide.ts
export interface DecisionContext {
  readonly rng: Rng;
  readonly ids: IdFactory;
  readonly now: number;          // epoch ms, injecte — le moteur ne lit jamais l'horloge
  readonly actorId: CharacterId;
}
export interface Decision {
  readonly events: readonly GameEvent[];
  readonly brief: NarrationBrief;   // ce que l'IA devra habiller — deja decide
}
export function decide(
  state: CampaignState,
  intent: Intent,
  ctx: DecisionContext,
): Result<Decision, RuleViolation>;

// src/reduce.ts
export function reduce(state: CampaignState, event: GameEvent): CampaignState;
export function reduceAll(state: CampaignState, events: Iterable<GameEvent>): CampaignState;
export function createInitialCampaignState(input: CreateCampaignInput): CampaignState;
export const REDUCER_VERSION = 1;   // bump => les snapshots anciens ne sont plus lus
```

Regle d'or : **`decide` tire les des, `reduce` n'en tire jamais.** `reduce` est deterministe et
sans `Rng` : c'est ce qui rend le rejeu du journal exact (invariant 4).

### 2.4 `packages/contracts`

```
packages/contracts/
  src/
    index.ts                # re-exporte tout
    version.ts              # PROTOCOL_VERSION, EVENT_SCHEMA_VERSION, CONTENT_SCHEMA_VERSION
    primitives.ts           # zId, zTableId, zIsoDate, zSeed, zSlug, zNonEmptyText
    core/
      attributes.ts  gauges.ts  progress.ts
      character.ts          # zCharacterSheet, zCharacterState
      clock.ts  progress-track.ts
      effects.ts            # zEngineEffect (miroir de engine EngineEffect)
      campaign-state.ts     # zCampaignState (miroir exact de engine CampaignState)
    events/
      index.ts              # zGameEvent = discriminatedUnion('type', [...])
      dice.ts  gauges.ts  progress.ts  narrative.ts  session.ts
    dto/
      table-state.ts        # zTableState : PROJECTION par spectateur de CampaignState
                            #   (retire les lignes visibility='gm'). N'est PAS un miroir.
      turn-proof.ts         # zTurnProof : PROJECTION du journal sur un groupe correlation_id
                            #   — la preuve « Pourquoi ? » (02-mj-ia.md §4.8.6). Bornee :
                            #   32 effets, 120 car. par libelle, 8 Kio serialises.
    intents/
      index.ts              # zIntent = discriminatedUnion('type', [...])
      moves.ts  campaign.ts  speech.ts
    ws/
      envelope.ts           # zEnvelope, zC2SEnvelope, zS2CEnvelope
      c2s.ts                # zC2SMessage
      s2c.ts                # zS2CMessage
      codes.ts              # CloseCode, WsErrorCode
    http/
      auth.ts  tables.ts  characters.ts  content.ts  health.ts
    content/
      common.ts  effect.ts  move.ts  champion.ts  oracle.ts  price-table.ts
      presage-table.ts  region.ts  asset.ts  condition.ts  truth.ts  manifest.ts
      settings.ts           # zCampaignSettings, zCampaignTruth
    ai/
      narration.ts          # zNarrationBrief (entree), zNarrationOutput (sortie)
      forge.ts              # zForgedChampion (schema strict de la forge de fiches)
      chronicle.ts          # zChronicleDoc (schema de la chronique compactee)
      tools.ts              # schemas d'entree/sortie de chaque outil expose au modele
    upcast.ts               # upcasters de payload d'evenement (03-donnees.md §3.8)
    errors.ts               # zAppErrorPayload, AppErrorCode (union fermee)
  tests/
    ws-protocol.test.ts     # invariant 3
    engine-parity.test.ts   # invariant de miroir (voir ci-dessous)
    exhaustive-union.test.ts
```

**Regle de miroir `engine` ↔ `contracts`.** Les types canoniques sont ceux du moteur ; les
schemas Zod sont leur validation au bord. Chaque schema miroir est declare ainsi :

```ts
import type { CampaignState } from '@for/engine';
export const zCampaignState = z.object({ /* ... */ }) satisfies z.ZodType<CampaignState>;
export type CampaignStateDto = z.output<typeof zCampaignState>;
```

**Tous** les schemas Zod du projet vivent dans `@for/contracts`, y compris ceux du contenu (§2.5)
et des E/S IA. `@for/content` et `@for/ai` les **importent** sans jamais les redeclarer : c'est ce
qui evite un cycle `content -> contracts -> content`.

`zTableState` (`src/dto/`) est l'exception assumee : pas un miroir du moteur, mais la
**projection** envoyee a un joueur, amputee de tout ce qui porte `visibility: 'gm'`.

`satisfies z.ZodType<T>` fait echouer `typecheck` des que le moteur evolue sans le schema.
Il n'y a **aucune generation de code** : les types sont deduits (`z.output`) ou importes du
moteur. Interdiction d'ecrire a la main une interface qui duplique un `z.output`.

**Consommation.**
- Back : `fastify-type-provider-zod`. Chaque route declare `schema: { body, querystring, params, response }`
  avec des schemas de `@for/contracts/http`. Toute trame WS entrante passe **d'abord** par
  `zC2SEnvelope.safeParse`.
- Front : `@for/contracts` est importe directement (zod est dans le bundle client, assume).
  Reponses HTTP parsees par le client HTTP genere dans `packages/client/src/api/http.ts`,
  trames WS entrantes par `zS2CEnvelope.safeParse` dans `packages/client/src/ws/socket.ts`,
  formulaires par les memes schemas (`@hookform/resolvers/zod`).
- Sortie IA : `zNarrationOutput`, `zForgedChampion` sont les **seuls** points d'entree du texte
  modele dans le systeme. Un `safeParse` en echec = retry borne puis repli deterministe.

### 2.5 `packages/content`

Les **donnees de jeu** vivent a la racine du depot dans `content/` (arborescence exhaustive :
`03-donnees.md` §4.1). `packages/content` ne contient que le chargeur, le registre typé et
les libelles d'interface.

```
content/                           # A LA RACINE DU DEPOT, pas dans packages/
  manifest.json
  moves/*.json  champions/*.json  regions/*.json  oracles/*.json
  tables/{pay-the-price,presages}.json  assets/*.json
  conditions.json  truths/*.json
  fallbacks/narration.json         # gabarits de la narration de repli (moteur)

packages/content/
  data/
    labels/{attributes,gauges,outcomes,ui}.json   # libelles d'interface uniquement
  src/
    index.ts                     # registre COMPLET — serveur / sim uniquement
    ui.ts                        # sous-entree "@for/content/ui" : libelles seuls, leger
    generated/index.ts           # GENERE — imports statiques de tous les JSON de content/
    load.ts                      # loadContent(): ContentBundle, 4 passes (03-donnees.md §4.8)
    registry.ts                  # getChampion(), listChampions(), getOracle(), ...
    validate.ts                  # validateContent(): parse tout via @for/contracts/content
    manifest.ts                  # hash de contenu + CONTENT_VERSION
  tests/
    content-validity.test.ts     # tout JSON parse ; ids uniques ; refs croisees resolues
    generated-index.test.ts      # le fichier genere est a jour (sinon CI rouge)
```

Le contenu n'est **jamais** lu depuis le disque a l'execution : `scripts/generate-content-index.ts`
produit `src/generated/index.ts` avec des `import x from '../../data/...json' with { type: 'json' }`.
CI rejoue le script et fait `git diff --exit-code`.

Le client ne bundle pas le contenu de jeu : il le recupere via
`GET /api/content/manifest` puis `GET /api/content/:kind/:id`, avec `ETag` sur `CONTENT_VERSION`.
Seul `@for/content/ui` (libelles) est importable cote client.

### 2.6 `packages/db`

```
packages/db/
  drizzle.config.ts
  migrations/0000_init.sql, meta/_journal.json   # generees, versionnees, jamais editees a la main
  src/
    index.ts
    client.ts        # openDatabase(path): Database — PRAGMA journal_mode=WAL, foreign_keys=ON,
                     #   busy_timeout=5000, synchronous=NORMAL
    schema/
      index.ts  players.ts  auth-sessions.ts  oauth-states.ts  campaigns.ts
      campaign-members.ts  play-sessions.ts  events.ts  snapshots.ts
      projections.ts   # characters, progress_tracks, clocks, entities, champion_locks
      ai.ts            # chronicles, chronicle_jobs, champion_sheets, ai_calls, ai_turn_renders
      intents.ts  content-packs.ts
    repositories/
      events.ts      # appendEvents (transaction), readSince(seq), lastSeq
      campaigns.ts  characters.ts  players.ts  chronicles.ts  aiCalls.ts
    migrate.ts       # runMigrations(db) — appelee au demarrage du conteneur
    rebuild.ts       # db:rebuild — tronque les projections, rejoue le journal
    check.ts         # db:check — les 12 oracles d'integrite (03-donnees.md §7.3)
    seed/demo.ts     # seed de demo M0 : 1 campagne, 3 persos, 248 evenements
                     #   (`--minimal` s'arrete a la fin de la 1re scene, ~40 evenements)
  tests/
    migrations.test.ts    # migre a blanc sur base memoire, puis verifie le schema
    events-repo.test.ts   # append-only, seq monotone, transaction atomique
```

`events` est la table sacree : PK `id` (ULID), index unique `(campaign_id, seq)`, insertion
uniquement, aucun `UPDATE`/`DELETE` (triggers SQLite `RAISE(ABORT)`), plus un trigger
`events_seq_dense` qui refuse tout `seq` non alloue par `campaigns.seq`.
**DDL complet, catalogue des 71 types d'evenements, migrations et exploitation :
`docs/design/03-donnees.md`, qui fait autorite sur la base.**

### 2.7 `packages/ai`

Arborescence faisant autorite : `02-mj-ia.md` §10 ; celle-ci en est le reflet.
**Aucun fichier de ce paquet ne nomme un fournisseur en dehors de `narrator/adapters/`**, et
aucun ne lit `process.env`. Ces deux frontieres rendent l'eval executable hors serveur et le
conteur remplacable sans toucher a la couche de jeu.

```
packages/ai/
  src/
    index.ts              # seule surface publique
    narrator/
      port.ts             # re-export du port (02-mj-ia.md §0.1) + NarratorError
      select.ts           # selectNarrator(config): NarratorPort — AUCUN acces a process.env
      adapters/{stub,anthropic,openai-compatible,ollama}.ts
      # LE SEUL dossier du paquet qui connaisse un fournisseur : identifiant de modele,
      # code d'arret, mise en cache, format d'appel d'outils, classe d'exception de SDK.
      # Il n'existe AUCUN client de fournisseur ailleurs (pas de `src/client.ts`).
    prompts/
      conteur.system.ts   # CONTEUR_SYSTEM_PROMPT + CONTEUR_PROMPT_VERSION
      conteur.campaign.ts # buildCampaignBlock()
      chronicle.system.ts  forge.system.ts
    context/
      builder.ts          # construction de la NarrateRequest (02-mj-ia.md §4.1)
      budget.ts           # estimateur local + echelle de troncature T1->T8
      scene-render.ts     # rendu DETERMINISTE du bloc <scene> depuis SceneState (§4.5)
    tools/
      index.ts            # TOOL_REGISTRY
      definitions.ts      # TOOL_DEFINITIONS : les 12 outils, ORDRE FIGE, + TOOLS_VERSION
      handlers.ts         # execution des lectures, validation des propositions
      # lecture     : get_state, get_lore, get_chronicle, check_name_allowed, roll_oracle
      # proposition : propose_npc_introduce, propose_clock_create, propose_clock_advance,
      #               propose_thread_open, propose_lore_fact, propose_scene_transition,
      #               propose_vow_hook
      # Il n'existe AUCUN outil de prix, et il n'existe plus de `price_choice` :
      # le moteur tire le d12 de « payer le prix », applique l'entree tiree et la
      # transmet au conteur comme un FAIT IMPOSE (02-mj-ia.md §3.4, 03-donnees.md §3.4).
      # `propose_scene_transition` ne porte QU'UN LIEU : pas de `time_shift`.
    outputs/
      narration.ts  forge.ts  chronicle.ts   # safeParse + repli
      scene.ts            # F1->F8 puis mergeSceneBlock S1->S10 (PURE, 02 §2.3 / §4.7.3)
      refusal.ts          # proveRefusal R1->R7 (PURE, 02 §4.8.2)
    narration/
      run.ts              # appel streame + boucle d'outils bornee AU-DESSUS du port
      postfilter.ts       # importe ../assertions
    assertions/*.ts       # SOURCE UNIQUE — partagees avec @for/ai-eval ET le post-filtre
    chronicle/{build,validate}.ts     # C1->C9 (PURES)
    forge/{build,validate}.ts         # V1->V12 (PURES)
  tests/
    tool-surface.test.ts  prompt-size.test.ts  tools.snapshot.json
    narrator-port.contract.test.ts  narrator-errors.test.ts  no-env.test.ts
    spec-neutrality.test.ts  degradation.test.ts
    context-budget.test.ts  outputs.test.ts  scene-merge.test.ts  refusal-proof.test.ts
```

**Il n'y a pas de dossier `eval/` ici.** Corpus, runners N0/N1/N2 et graders vivent dans
`@for/ai-eval` (§1.2) ; les assertions restent ici parce qu'elles servent aussi de post-filtre
d'execution. Reintroduire un `eval/` recreerait le cycle que `dependency-cruiser` interdit.

`@for/ai` ne connait ni SQLite ni Fastify : il recoit un `NarrationBrief` deja hydrate.
C'est ce qui permet aux runners de `@for/ai-eval` de tourner sur fixtures, sans base et sans cle.

**Verrouillage de distribution.** `context/builder.ts` injecte toujours `reservedChampions` et
`allowedNpcs`. L'assertion `no_reserved_champion` echoue si une sortie mentionne un champion
reserve. Le serveur refait la verification a la reception (defense en profondeur) :
`packages/server/src/ai/lockout.ts`.

### 2.8 `packages/server`

```
packages/server/
  src/
    main.ts               # POINT D'ENTREE PROCESSUS : charge env, ouvre db, migre, build, listen
    app.ts                # buildApp(deps): FastifyInstance — testable, ne listen pas
    env.ts                # zEnv.parse(process.env) — echec = crash au demarrage
    deps.ts               # AppDeps (injection : db, rng, clock, ids, ai, content)
    logger.ts             # pino + redaction + serializers
    errors.ts             # AppError, errorHandler, mapping code -> statut HTTP
    auth/
      discord.ts  session.ts  guards.ts
    http/
      health.ts  auth.routes.ts  campaigns.routes.ts  characters.routes.ts  content.routes.ts
    ws/
      hub.ts              # TableHub : abonnements, diffusion, resume par seq
      connection.ts       # cycle de vie d'une socket, heartbeat, backpressure
      handlers.ts         # routage des messages c2s
    game/
      campaign-service.ts    # LE point d'orchestration (voir signature ci-dessous)
      intent-pipeline.ts  # validation -> autorisation -> decide -> persist -> diffuse -> narre
      write-queue.ts      # une file par campagne ; code de refus `move_in_progress`
      revert.ts           # revertTurn(campaignId, correlationId, reason) — LE seul chemin
                          #   d'annulation (03-donnees.md §3.7), partage par la correction
                          #   d'administration et par le droit de refus du conteur
      turn-proof.ts       # buildTurnProof(events, viewerId): TurnProofDto — PURE. Projette
                          #   le groupe correlation_id du tour. Ne lit pas la base, n'appelle
                          #   ni decide() ni rollChallenge() : aucun de n'est retire pour
                          #   afficher une preuve (02-mj-ia.md §4.8.6)
      snapshots.ts        # politique de snapshot (tous les 200 evenements)
      chronicle.ts        # declenchement de la compaction
    ai/                   # tout ce qui, dans la couche IA, touche persistance, verrous, diffusion
      narrator.ts         # construit NarratorConfig depuis env.ts puis appelle selectNarrator()
                          #   — LE SEUL endroit du serveur qui lise la config du conteur
      scene-state.ts      # fusion de l'etat de scene ; emet scene.facts_updated si delta (02 §4.7)
      refusal.ts          # applique un refus prouve : revertTurn + quota (02 §4.8)
      broadcast.ts        # NarrationBroadcast : fragments, buffer, rattrapage (02 §6)
      lockout.ts          # revalidation des champions reserves (defense en profondeur)
      chronicle-worker.ts  forge-worker.ts
      calls.ts            # journalisation ai_calls + compteur de cout + coupe-circuit
  tests/
    http/*.test.ts  ws/*.test.ts  game/*.test.ts  ai/*.test.ts
    proposal-surface.test.ts     # invariant 1 : les TROIS listes closes (03-donnees.md §0.5)
```

```ts
// src/game/campaign-service.ts
export interface SubmitIntentInput {
  readonly campaignId: CampaignId;
  readonly playerId: PlayerId;
  readonly intentId: string;       // idempotence, fourni par le client
  readonly intent: Intent;
}
export interface SubmitIntentResult {
  readonly accepted: boolean;
  readonly events: readonly PersistedEvent[];   // avec seq
  readonly brief?: NarrationBrief;
}
export interface CampaignService {
  submitIntent(input: SubmitIntentInput): Promise<Result<SubmitIntentResult, AppError>>;
  /** Projection par spectateur : les lignes `visibility: 'gm'` sont retirees. */
  getSnapshot(campaignId: CampaignId, viewerId: PlayerId): Promise<{ state: TableStateDto; lastSeq: number }>;
  readEventsSince(campaignId: CampaignId, seq: number): Promise<readonly PersistedEvent[]>;
  /** Preuve d'un tour (« Pourquoi ? ») : lit les evenements du groupe `correlationId` et
   *  leur applique `buildTurnProof`. Lecture pure, aucune ecriture, aucun de retire.
   *  Rend `null` si le groupe n'existe pas dans cette campagne. */
  getTurnProof(campaignId: CampaignId, correlationId: string, viewerId: PlayerId): Promise<{ proof: TurnProofDto; truncated: boolean } | null>;
}

// src/ai/narrator.ts — le serveur ne connait que le port (02-mj-ia.md §0.1).
// `NARRATOR_PROVIDER=stub` permet a @for/sim et a la CI de tourner sans reseau.
import type { NarratorPort, NarratorConfig } from '@for/contracts';
import { selectNarrator } from '@for/ai';

export function buildNarrator(env: Env): NarratorPort {
  return selectNarrator({
    provider: env.NARRATOR_PROVIDER,
    baseUrl: env.NARRATOR_BASE_URL ?? null,
    apiKey: env.NARRATOR_API_KEY ?? null,
    model: env.NARRATOR_MODEL ?? null,
    modelStructured: env.NARRATOR_MODEL_STRUCTURED ?? null,
    tools: env.NARRATOR_TOOLS,
    timeoutMs: env.NARRATOR_TIMEOUT_MS,
    contextWindowTokens: env.NARRATOR_CONTEXT_WINDOW ?? null,
  } satisfies NarratorConfig);
}
```

### 2.9 `packages/client`

```
packages/client/
  index.html  vite.config.ts
  src/
    main.tsx            # POINT D'ENTREE : createRoot + providers
    App.tsx             # routes
    env.ts              # import.meta.env valide par zod
    api/http.ts  api/queries.ts       # TanStack Query
    ws/socket.ts        # connexion, reconnexion exponentielle, reprise via deliverySeq
    ws/store.ts         # miroir de ce que le serveur a dit, jamais une autorite
    ws/journal.ts       # un evenement recu -> une ligne de fil, sans aucun chiffre
    routes/{Login,CampaignList,TableRoom,CharacterPicker}.tsx
    features/table/{Log,Sheet,Gauges,MoveBar,Clocks,Vows}/
    features/table/Proof/   # « Pourquoi ? » : replie par defaut, rend un s2c.turn_proof,
                            #   et marque un tour annule au lieu de le retirer (02 §4.8.6)
    components/ui/*     # primitives sans logique metier
    styles/
```

Pas de dossier `tests/` ni de dossier `e2e/` dans ce paquet : l'unitaire est colocalise en
`*.test.ts` / `*.test.tsx` a cote de ce qu'il teste (§3.5). Les parcours Playwright arrivent
apres M0, et leur emplacement sera decide a ce moment-la.

Etat client : **TanStack Query** pour le distant HTTP, **Zustand** pour l'etat de session WS.
Aucun `useState` ne detient d'etat de jeu autoritaire.

**Le store WS n'applique pas `reduce()`.** Il tient un miroir de ce que le serveur a envoye :
un evenement recu devient une ligne de fil, un `s2c.snapshot` ecrase tout. Faire tourner le
reducteur du moteur dans le client rendrait au client une autorite que l'invariant 3 de
`ARCHITECTURE.md` lui refuse ; `tooling/eslint-config/react.js` l'interdit a l'import.

**La reprise se fait sur `deliverySeq`, jamais sur `seq`** (ADR 0010 decision 1). Depuis
l'ADR 0008 la diffusion est adressee : un trou de `seq` est legitime chez un joueur qui n'etait
pas destinataire, et le surveiller ferait redemander sans fin des evenements auxquels il n'a
pas droit. `c2s.resume` porte `sinceDeliverySeq`, `c2s.hello` porte `lastDeliverySeq`.

### 2.10 `packages/sim` — voir §7.4.

---

## 3. Conventions

### 3.1 Nommage

| Element | Regle | Exemple |
|---|---|---|
| Fichier de source | `kebab-case.ts` | `face-danger.ts`, `campaign-service.ts` |
| Composant React | `PascalCase.tsx`, un composant exporte par defaut par fichier | `MoveBar.tsx` |
| Hook React | `use-*.ts`, export nomme `useX` | `use-table-socket.ts` |
| Type / interface | `PascalCase`, **sans** prefixe `I` | `CampaignState` |
| Schema Zod | prefixe `z` + `PascalCase` | `zCampaignState` |
| Type deduit d'un schema | suffixe `Dto` si distinct du type moteur | `TableStateDto` |
| Constante module | `SCREAMING_SNAKE_CASE` | `TICKS_PER_MILESTONE` |
| Fonction | `camelCase`, verbe en tete | `rollChallenge`, `appendEvents` |
| Type d'evenement | `domain.past_tense` en anglais ; **catalogue ferme** : `03-donnees.md` §3.4 | `roll.action_resolved`, `character.gauge_changed` |
| Type d'intention | `domain.imperative` en anglais | `move.strike`, `campaign.join` |
| Message WS | `c2s.*` / `s2c.*` | `c2s.intent`, `s2c.event` |
| Table SQL / colonne | `snake_case` pluriel pour les tables | `campaign_members`, `created_at` |
| Id de contenu | slug latin minuscule sans accent | `ashe`, `pay-the-price` |
| Branche git | `m<jalon>/<scope>-<sujet>` | `m0/engine-challenge-roll` |
| Commit | Conventional Commits, scope = package | `feat(engine): add presage detection` |

**Regle de langue, sans exception** (arbitrage : `docs/ARCHITECTURE.md` §4) : les **valeurs**
d'enumeration de mecanique sont en **francais** — attributs `vif|coeur|fer|ombre|esprit`,
jauges `vigueur|ame|vivres`, issues `franche|partielle|echec`, rangs
`genant|dangereux|redoutable|extreme|epique`, `presage`. Elles apparaissent telles quelles dans
les colonnes SQL, les payloads d'evenements, les schemas Zod et les JSON de contenu.
Tout le reste — noms de tables, de colonnes, de champs, de fonctions, de types, de fichiers,
d'identifiants de mouvement (`face-danger`, `probe-a-soul`) — est en **anglais**.

### 3.2 Style TypeScript

- `strict` + toutes les options listees en §4. Pas de `any` (`@typescript-eslint/no-explicit-any`
  en `error`) ; `unknown` + narrowing.
- Pas de `enum` TypeScript : unions de litteraux + objet `as const`.
- `readonly` par defaut sur toutes les proprietes des types de domaine ;
  `readonly T[]` pour les tableaux d'etat.
- Exports **nommes** partout, sauf composants React (`export default`).
- Un seul barrel par package : `src/index.ts`. Les imports inter-packages passent par le nom du
  package (`@for/engine`), jamais par un chemin profond, hormis les sous-entrees declarees
  (`@for/content/ui`).
- Imports relatifs a l'interieur d'un package, avec extension `.js` (ESM NodeNext).
- Fonctions pures par defaut ; les effets vivent dans `@for/db`, `@for/server`, `@for/ai`.

### 3.3 Gestion des erreurs

Trois familles, jamais melangees :

1. **`RuleViolation` (moteur).** Une intention invalide n'est pas une exception :
   `decide()` retourne `err({ code, details })`. `code` appartient a une union
   fermee (`'move_in_progress' | 'gauge_out_of_range' | 'unknown_move' | 'character_dead' | ...`).
   **Il n'y a pas de verrou de tour** : la table est libre, les ecritures sont serialisees par
   campagne (`write-queue.ts`). `move_in_progress` ne se declenche que si l'acteur a un jet en
   attente de decision (fenetre de brulure du souffle).
   Aucun texte humain dans le moteur.
2. **`AppError` (serveur).** Classe unique, `packages/server/src/errors.ts` :

```ts
export class AppError extends Error {
  constructor(readonly code: AppErrorCode,
              readonly httpStatus: number,
              readonly userMessage: string,     // francais, montrable au joueur
              readonly details?: unknown,       // jamais serialise vers le client en prod
              options?: { cause?: unknown }) { super(code, options); }
}
```
   `AppErrorCode` est une union fermee declaree dans `@for/contracts/errors.ts`, partagee avec le
   client, qui peut donc reagir par code. Charge utile renvoyee : `{ code, message, requestId }` ;
   `details` reste dans le log.
3. **Inattendu.** Tout le reste. Le `errorHandler` Fastify le log en `error` avec la stack,
   repond `500 / internal_error` avec un message francais generique et le `requestId`.

Regles : jamais de `catch` silencieux ; jamais de `throw` d'une chaine ; `cause` toujours
propage ; les erreurs IA (timeout, refus, sortie invalide) sont des `AppError` de code
`ai_unavailable` / `ai_invalid_output` et **n'empechent jamais** l'evenement de jeu d'etre
persiste — la narration est degradee, pas la partie (consequence de l'invariant 1).

Cote client, aucune erreur n'est affichee brute : mapping `AppErrorCode -> texte francais` dans
`packages/client/src/api/error-messages.ts`, avec repli generique.

### 3.4 Logging

`pino` partout cote serveur. JSON en production, `pino-pretty` en developpement.

- Niveaux : `fatal` (arret), `error` (bug ou dependance morte), `warn` (degradation attendue :
  repli IA, reconnexion), `info` (cycle de vie, intention acceptee, evenement persiste),
  `debug` (detail de pipeline), `trace` (trames WS).
- Champs obligatoires par contexte, via loggers enfants :
  `requestId`, `playerId`, `campaignId`, `intentId`, `eventSeq`, `moveId`, `durationMs`.
- Un appel IA log toujours : `model`, `promptTokens`, `outputTokens`, `latencyMs`, `attempt`,
  `outcome` (`ok|invalid_output|timeout|refused`). Ces memes champs sont persistes dans `ai_calls`.
- Redaction : `req.headers.authorization`, `req.headers.cookie`, `*.accessToken`,
  `*.refreshToken`, `NARRATOR_API_KEY`, `DISCORD_CLIENT_SECRET`.
- **Jamais** de texte de narration complet en `info` (volume) : `debug` seulement, tronque a 500
  caracteres ; le texte integral vit en base.
- `@for/engine`, `@for/contracts` et `@for/content` **ne loggent pas** (pas de `console.*`,
  regle ESLint `no-console` en `error` sur ces packages).

### 3.5 Organisation des tests (regle transverse)

- **Unitaire** : `*.test.ts` **colocalise** a cote du fichier teste, dans `src/`.
- **Integration / contrat** : `packages/<pkg>/tests/**.test.ts`.
- **Dores (golden)** : `packages/<pkg>/tests/golden/*.golden.json`, compares par le runner de
  `@for/testkit`. Regeneres par `GOLDEN_UPDATE=1 pnpm test:golden`. `.gitattributes` marque
  `*.golden.json` en `-diff` pour ne pas polluer les revues ; toute modification d'un fichier
  dore est justifiee dans le message de commit.
- **Fixtures** : `packages/testkit/src/fixtures/`, jamais dupliquees dans un package consommateur.
- Un test ne cree jamais de fichier hors `os.tmpdir()`, n'ouvre jamais le reseau, n'appelle aucun
  fournisseur de modele (interdit par `packages/ai/tests/setup.ts`, qui stub `fetch` et fait
  echouer tout appel sortant ; en CI, `NARRATOR_PROVIDER=stub`).

---

## 4. Configuration TypeScript, ESLint, Prettier

### 4.1 `tooling/tsconfig/base.json`

```jsonc
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "moduleDetection": "force",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true
  }
}
```

Surcharges :

| Fichier | `extends` base + |
|---|---|
| `library.json` | `{ "outDir": "dist", "rootDir": "src" }` — pour `engine`, `contracts`, `content`, `testkit` |
| `node.json` | `library.json` + `"types": ["node"]`, `"lib": ["ES2023"]` — pour `db`, `ai`, `server`, `sim` |
| `react.json` | `"lib": ["ES2023","DOM","DOM.Iterable"]`, `"jsx": "react-jsx"`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"noEmit": true`, `"types": ["vite/client"]` |
| `test.json` | `"types": ["vitest/globals","node"]`, `"noUnusedLocals": false` |

- `@for/engine` : `library.json` **sans** `"types"` (aucun typage Node accessible — la purete
  devient une erreur de compilation, pas seulement de lint).
- `tsconfig.json` racine : solution-style, `"files": []` + `"references"` vers chaque package.
  `pnpm typecheck` = `tsc -b --pretty false`, puis `tsc -p tsconfig.tools.json --noEmit`,
  puis `turbo run typecheck:tests` : le graphe de projets, l'outillage, et les tests.
- Chaque package a un `tsconfig.json` (build) et un `tsconfig.test.json` (tests inclus).

### 4.2 ESLint (flat config, ESLint 9)

`tooling/eslint-config/index.js` compose : `@eslint/js` recommended, `typescript-eslint`
`strictTypeChecked` + `stylisticTypeChecked`, `eslint-plugin-import-x`,
`eslint-plugin-unicorn` (selectif), `eslint-plugin-vitest`, `eslint-config-prettier` en dernier.

Regles non negociables :

```
@typescript-eslint/no-explicit-any               error
@typescript-eslint/no-floating-promises          error
@typescript-eslint/no-misused-promises           error
@typescript-eslint/consistent-type-imports       error  (fixStyle: separate-type-imports)
@typescript-eslint/switch-exhaustiveness-check   error
@typescript-eslint/no-unnecessary-condition      error
@typescript-eslint/explicit-module-boundary-types error (packages engine, contracts)
import-x/no-default-export                       error (sauf *.tsx, *.config.*)
no-console                                       error (engine, contracts, content, client)
no-restricted-syntax                             error : NewExpression[callee.name='Date'],
                                                 MemberExpression[object.name='Math'][property.name='random']
                                                 -> dans engine ET server/src/game (RNG et horloge injectes)
```

`import-x/no-cycle` **ne figure pas** dans cette liste : mesuree, elle ne rapporte aucun cycle
sur du TypeScript et a ete retiree de la configuration (ADR 0002 §1). L'invariant « aucun cycle »
tient par `dependency-cruiser`, regle `pas-de-cycle` (§1.2 regle 7).

`tooling/eslint-config/engine-purity.js`, applique a `packages/engine/**` :
`no-restricted-imports` (tous les `node:*`, tout paquet npm), `no-restricted-globals`
(`process`, `window`, `document`, `fetch`, `globalThis`, `performance`, `crypto`, `setTimeout`).

`eslint.config.js` racine : config de base partout, `react` sur `packages/client/**`,
`engine-purity` sur `packages/engine/**`, et sur `packages/client/**` la regle « pas de mutation
de jeu cote client » (`no-restricted-imports` sur `decide`, `reduce`, `reduceAll`,
`rollChallenge`, `rollProgress` importes de `@for/engine`).

### 4.3 Prettier

`tooling/prettier-config/index.json` :

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always",
  "endOfLine": "lf",
  "plugins": ["prettier-plugin-organize-imports"]
}
```

Prettier ne gere **pas** la qualite (`eslint-config-prettier` desactive tout conflit).
CI lance `prettier --check .`. Pas de hook de pre-commit obligatoire (les agents travaillent en
lots) ; `lint-staged` + `simple-git-hooks` ne sont **pas livres en M0** (§2.2), et le jour ou ils
le seront, ce sera derriere une commande `hooks:install` optionnelle.

---

## 5. Protocole WebSocket

Endpoint unique : `GET /ws` (upgrade). Authentification par **cookie de session** valide pendant
le handshake ; pas de jeton dans l'URL. Une connexion peut suivre **une seule** table, choisie a
l'ouverture via `?campaignId=`. Refus = fermeture avec code applicatif (§5.5).

Transport : JSON UTF-8. Trame max **64 Kio** entrant, **256 Kio** sortant. Heartbeat : `ping`
serveur toutes les 25 s, fermeture si pas de `pong` en 60 s.

### 5.1 Enveloppe

```ts
// c2s
{ v: 1, t: "c2s.intent", id: "<uuid v7 client>", p: { ... } }
// s2c
{ v: 1, t: "s2c.event", id: "<uuid v7 serveur>", ts: 1758… , seq: 412, p: { ... } }
```

- `v` = `PROTOCOL_VERSION`. Mismatch -> fermeture `4001 protocol_version`.
- `id` c2s = cle d'**idempotence** : rejouer le meme `id` renvoie le meme resultat sans
  reexecuter `decide()` (table `intents` avec contrainte d'unicite).
- `seq` n'existe que sur `s2c.event` : numero de sequence **monotone par table**, issu du
  journal. C'est la seule horloge logique du systeme.

### 5.2 Messages client -> serveur (INTENTIONS UNIQUEMENT)

| `t` | Charge utile `p` | Effet |
|---|---|---|
| `c2s.hello` | `{ clientVersion: string, lastSeq: number \| null }` | Ouvre la session ; declenche `s2c.welcome` puis un rattrapage ou un snapshot |
| `c2s.intent` | `{ intent: Intent }` | **Le seul message mutant.** Voir §5.3 |
| `c2s.speak` | `{ channel: 'rp' \| 'ooc', text: string (1..2000) }` | Parole ; devient un `Intent` `speech.say` cote serveur |
| `c2s.typing` | `{ typing: boolean }` | Ephemere, non journalise |
| `c2s.resume` | `{ sinceSeq: number }` | Redemande les evenements manquants |
| `c2s.pong` | `{}` | Reponse au heartbeat |
| `c2s.resume_narration` | `{ narrationId: string, lastChunk: number }` | Redemande les fragments manquants du flux de narration en cours (apres reconnexion). Ne declenche **jamais** une seconde generation. |
| `c2s.why` | `{ correlationId: string }` | Demande la **preuve** d'un tour : le detail mecanique replie derriere la commande « Pourquoi ? » (`02-mj-ia.md` §4.8.6). Message de **lecture** : ne transporte aucun resultat, ne mute rien, ne relance aucune generation. Reponse : `s2c.turn_proof` |

Ces huit messages sont les seuls. `c2s.resume`, `c2s.resume_narration` et `c2s.why` sont des
**demandes de lecture** : elles ne mutent rien, d'ou leur compatibilite avec l'invariant 3.
`c2s.intent` reste le seul message mutant.

**Aucun** message client ne porte de jauge, de resultat de de, de `GameEvent`, de `CampaignState`
ni d'identifiant de PNJ a faire apparaitre. `zC2SMessage` est verifie par test (§0, invariant 3).
Toute proposition de nouveau message c2s qui transporte un resultat est refusee en revue.

### 5.3 `Intent` — union discriminee (`@for/contracts/intents`)

| `intent.type` | Charge | Notes |
|---|---|---|
| `campaign.join` | `{ characterId }` | rattachement d'un joueur a son champion |
| `campaign.leave` | `{}` | |
| `character.create_draft` | `{ championSlug, spread, background }` | declenche la forge IA si la fiche n'est pas ecrite a la main. **Passe par le meme journal que la partie** : c'est `character.created` qui pose le verrou de distribution |
| `move.face_danger` | `{ attribute, description, bonus? }` | affronter le danger |
| `move.secure_advantage` | `{ attribute, description, bonus? }` | assurer un avantage |
| `move.gather_information` | `{ description, bonus? }` | attribut force a `esprit` par le moteur |
| `move.probe_a_soul` | `{ targetNpcId \| targetDescription, bonus? }` | sonder une ame |
| `move.strike` | `{ targetId, attribute: 'fer' \| 'vif', bonus? }` | frapper |
| `move.endure_harm` | `{ amount? }` | encaisser |
| `move.endure_cold` | `{ }` | endurer le froid |
| `move.swear_a_vow` | `{ text, rank }` | jurer un serment |
| `move.reach_a_milestone` | `{ trackId }` | atteindre un jalon : marque des crans |
| `move.fulfill_your_vow` | `{ trackId }` | jet de progression de resolution |
| `move.forsake_your_vow` | `{ trackId, reason }` | renier un serment |
| `momentum.burn` | `{ rollId }` | bruler le souffle sur un jet dont la fenetre est ouverte (`roll.action_resolved.burnWindow`) |
| `momentum.keep` | `{ rollId }` | ne PAS bruler : les des restent tels quels, et les effets de l'issue initiale s'appliquent. Le `rollId` est celui de la fenetre visee, pour qu'un clic perime soit refuse au lieu d'atterrir sur une autre fenetre |
| `oracle.ask` | `{ question, likelihood }` | oracle oui/non pondere (d100, seuils du contenu) |
| `oracle.draw` | `{ oracleId: OracleId }` | table evocatrice |
| `speech.say` | `{ channel, text }` | genere par `c2s.speak` |
| `play_session.begin` / `play_session.end` | `{}` | bornes de seance (utilisees par la chronique) |

Il n'existe **aucune** intention `gauge.set`, `clock.advance`, `price.apply` ni `narration.*` :
ces effets ne sont produits que par le moteur, en consequence d'un mouvement resolu. Toute
proposition d'intention qui transporterait un resultat est refusee en revue.

Le client **propose** ; le serveur peut refuser (`s2c.rejected`). Le client n'affiche jamais un
resultat avant d'avoir recu le `s2c.event` correspondant (pas d'optimistic update sur le jeu ;
autorise uniquement pour `speech.say`, marque `pending`).

### 5.4 Messages serveur -> client

| `t` | Charge utile `p` |
|---|---|
| `s2c.welcome` | `{ protocolVersion, playerId, campaignId, you: { characterId \| null }, contentVersion, lastSeq }` |
| `s2c.snapshot` | `{ state: TableStateDto, lastSeq }` — projection par spectateur ; envoyee si `lastSeq` client trop ancien ou absent |
| `s2c.event` | `{ event: GameEvent }` + `seq` dans l'enveloppe. **Unique vecteur de mutation d'etat.** |
| `s2c.events_batch` | `{ events: Array<{ seq, event }> }` — rattrapage apres `c2s.resume` |
| `s2c.narration_started` | `{ narrationId, eventSeq, actorCharacterId, chunk: 0 }` |
| `s2c.narration_delta` | `{ narrationId, chunk, text }` — fragments coalesces par fenetres de 50 ms |
| `s2c.narration_snapshot` | `{ narrationId, chunk, text, status }` — buffer complet : arrivant en cours de generation, rattrapage apres coupure |
| `s2c.narration_done` | `{ narrationId, eventSeq, text, model, source: 'ai' \| 'engine' }` |
| `s2c.narration_error` | `{ narrationId, code: 'rate_limited' \| 'refused' \| 'engine_fallback' \| 'aborted' \| 'action_impossible' }` — `action_impossible` est le **droit de refus du conteur** (`02-mj-ia.md` §4.8) : il est emis **apres** `s2c.narration_done`, parce que la prose est valide et doit s'afficher ; le `s2c.event` du `system.reverted` qui suit **marque** les lignes du tour comme annulees et **ne les retire pas** (`02-mj-ia.md` §4.8.6) |
| `s2c.turn_proof` | `{ correlationId, proof: TurnProofDto, truncated: boolean }` — reponse a `c2s.why`. **Projection du journal** sur le groupe `correlation_id` du tour, construite a la demande par une fonction pure (§2.8), jamais fabriquee pour l'affichage. Par spectateur, comme `TableStateDto` : les lignes `visibility: 'gm'` en sont retirees. **Borne : 32 effets, 120 caracteres par libelle, 8 Kio de JSON serialise** ; au-dela, `truncated: true` et le client renvoie vers `GET /api/campaigns/:id/log` |
| `s2c.rejected` | `{ intentId, code: RuleViolationCode \| AppErrorCode, message }` |
| `s2c.error` | `{ code, message, requestId, intentId? }` |
| `s2c.presence` | `{ members: Array<{ playerId, characterId \| null, online, typing }> }` |
| `s2c.ping` | `{}` |
| `s2c.resync_required` | `{ reason }` — le client doit refaire `c2s.hello` |

**La preuve d'un tour (`TurnProofDto`).** **Derivee, jamais stockee** : le serveur lit les
evenements du groupe `correlationId` et les projette. Le client sait quoi demander sans rien
inventer, parce que `correlationId` est un champ de l'**enveloppe d'evenement**
(`EventEnvelopeSchema`, `03-donnees.md` §3.1) dont chaque variante de `GameEvent` herite : il
voyage donc dans la charge utile `p.event` de `s2c.event`. Ce n'est **pas** un champ de
l'enveloppe WebSocket de §5.1, qui reste `{ v, t, id, ts, seq?, p }` et ne bouge pas. Deux
enveloppes a distinguer, comme `seq` et `chunk`.

```ts
// packages/contracts/src/dto/turn-proof.ts — PROJECTION du journal, pas un miroir du moteur.
export const zTurnProof = z.object({
  correlationId: z.string().uuid(),
  firstSeq: z.number().int().positive(),
  lastSeq: z.number().int().positive(),
  status: z.enum(['applied', 'reverted']),
  revertedBy: z.object({ seq: z.number().int().positive(), reason: z.string().max(120) }).nullable(),
  move: z.object({ eventSeq: z.number().int(), moveId: z.string(), attribute: z.string().nullable(),
                   bonus: z.number().int().nullable(), label: z.string().max(120) }).nullable(),
  roll: z.object({ eventSeq: z.number().int(), rngStream: z.string(), rngDrawIndex: z.number().int(),
                   action: z.number().int(), challenge: z.tuple([z.number().int(), z.number().int()]),
                   total: z.number().int(), outcome: z.string() }).nullable(),
  revision: z.object({ eventSeq: z.number().int(), label: z.string().max(120) }).nullable(), // brulure du souffle
  effects: z.array(z.object({ eventSeq: z.number().int(), type: z.string(), label: z.string().max(120) })).max(32),
  price: z.object({ eventSeq: z.number().int(), entryId: z.string(), text: z.string().max(400),
                    value: z.number().int(), effectIndex: z.number().int().nullable() }).nullable(),
  presage: z.object({ eventSeq: z.number().int(), entryId: z.string(), text: z.string().max(400) }).nullable(),
  narration: z.object({ eventSeq: z.number().int(), source: z.enum(['ai', 'engine']) }).nullable(),
}).strict();
export type TurnProofDto = z.output<typeof zTurnProof>;
```

**Chaque entree porte son `eventSeq`** : c'est ce qui rend la preuve verifiable, puisqu'on
remonte du libelle a la ligne de journal qui l'etablit. Une entree sans `eventSeq` serait une
donnee fabriquee pour l'affichage — precisement ce qu'on interdit. La preuve ne contient **rien**
du modele : ni raisonnement, ni appel d'outil, ni proposition refusee (`02-mj-ia.md` §6.5).

**Vocabulaire des compteurs.** Origines differentes, jamais a confondre.
- `seq` (enveloppe) : **numero de journal**, present sur `s2c.event` uniquement.
- `chunk` (charge utile de narration) : **numero de fragment** d'un flux de narration.

**Ordre et livraison.** Les `s2c.event` d'une table arrivent dans l'ordre strict des `seq`, sans
trou. Le client qui detecte un trou envoie `c2s.resume { sinceSeq }`. La narration est
**asynchrone et hors bande** : un `s2c.event` n'attend jamais l'IA. Consequence directe de
l'invariant 1 — la partie avance meme si le modele est indisponible.

### 5.5 Codes de fermeture

`4001` protocol_version · `4002` unauthenticated · `4003` forbidden_campaign ·
`4004` campaign_not_found · `4008` rate_limited · `4009` payload_too_large ·
`4010` server_shutdown · `4011` campaign_rebuilding (reconstruction de projections en cours).

### 5.6 Limitation de debit

Par connexion :

| Message | Limite |
|---|---|
| `c2s.intent` | 5 / 10 s (rafale 10) |
| `c2s.speak` | 20 / 60 s |
| `c2s.resume` | 2 / 10 s |
| `c2s.why` | **10 / 10 s** — deplier « Pourquoi ? » sur plusieurs scenes d'affilee est un usage normal ; boucler dessus n'en est pas un |
| `c2s.typing` | echantillonne a 1/s cote client, ignore au-dela cote serveur |

Depassement : `s2c.error { code: 'rate_limited' }`, puis fermeture `4008` au troisieme.

---

## 6. Surface HTTP (M0)

| Methode | Route | Role |
|---|---|---|
| `GET` | `/healthz` | liveness : `{ status, version, uptimeMs }`, sans base |
| `GET` | `/readyz` | readiness : ping SQLite + migrations a jour |
| `GET` | `/api/auth/discord/start` | redirection OAuth (state + PKCE en cookie `HttpOnly`) |
| `GET` | `/api/auth/discord/callback` | echange du code, creation d'utilisateur, cookie de session |
| `POST` | `/api/auth/logout` | invalide la session |
| `GET` | `/api/me` | `{ player, characters, campaigns }` |
| `GET` | `/api/campaigns` · `POST /api/campaigns` | liste / creation de campagne |
| `GET` | `/api/campaigns/:id` | metadonnees + `lastSeq` |
| `GET` | `/api/campaigns/:id/log?sinceSeq=` | journal pagine (rendu du carnet de campagne) |
| `GET` | `/api/content/manifest` | `{ contentVersion, counts, etag }` |
| `GET` | `/api/content/:kind/:id` | fiche de contenu (cache `immutable` clefe sur `contentVersion`) |
| `GET` | `/api/admin/health` | **admin uniquement** : `quick_check`, taille du WAL, age de la derniere sauvegarde, espace disque, hash de contenu (03-donnees.md §6.7) |

`/healthz` et `/readyz` ne font **jamais** de controle profond : un WAL volumineux ou une
sauvegarde vieillissante ne doivent pas sortir le conteneur de la rotation.

Cookie de session : `fr_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, duree 30 jours,
rotation a chaque connexion. CSRF : les mutations exigent l'en-tete `X-Requested-With: for-app`
plus `SameSite=Lax` (pas de formulaire cross-site dans le produit). CORS desactive en production
(front et API servis par la meme origine via Caddy) ; en developpement, origine unique
`http://localhost:5173`.

---

## 7. Strategie de test

Runner unique : **Vitest** (`vitest.workspace.ts` a la racine, un projet par package).
Aucune suite ne depend de l'ordre d'execution ni d'un etat global partage.

### 7.1 Par package

| Package | Ce qu'on teste | Ce qu'on refuse |
|---|---|---|
| `engine` | 1) purete (§1.3) ; 2) chaque mouvement avec un `Rng` **scripte** (tableau de valeurs), tous les branchements de resultat ; 3) regles de souffle : annulation par souffle negatif, brulure, plafond a 10, bornes -6/+10 ; 4) progression : 12/8/4/2/1 crans, remplissage de cases, jet de progression ; 5) `reduce` : idempotence de rejeu, immutabilite, exhaustivite du `switch` sur `GameEvent` ; 6) corpus dores (§7.3). **Couverture exigee : 95 % lignes / 90 % branches, bloquant.** | tout mock ; toute dependance ; tout test lent |
| `contracts` | parse/refuse sur cas limites ; invariant 3 (aucun `c2s.*` porteur d'etat) ; exhaustivite des unions (chaque `GameEvent.type` du moteur a un schema) ; compatibilite ascendante : un evenement dore de version anterieure doit toujours parser | |
| `content` | tout JSON valide contre son schema ; unicite des ids ; references croisees resolues (region -> champion, oracle -> table) ; index genere a jour ; les 20 fiches manuelles couvrent les champs obligatoires | |
| `testkit` | ses propres helpers (le RNG scripte epuise -> erreur explicite ; le runner dore detecte une derive) | |
| `db` | migration a blanc puis assertions de schema ; migration depuis `prev-release.sqlite` ; append-only (l'`UPDATE` d'un evenement doit lever) ; densite de `seq` ; atomicite d'`appendEvents` ; seed de demo **deterministe octet pour octet** ; les 12 oracles de `db:check`, dont la reconstruction idempotente. Base sur fichier temporaire, pas `:memory:` (WAL) | |
| `ai` | surface d'outils (invariant 1) ; budget de contexte (invariant 2) ; parseurs de sortie sur corpus de sorties modele **enregistrees** ; verrouillage de distribution. **Zero appel reseau** : `setup.ts` fait echouer tout `fetch` | tout test qui appelle l'API |
| `server` | routes via `app.inject()` ; garde d'auth ; pipeline d'intention de bout en bout avec l'adaptateur `stub` et RNG seede ; WS : handshake, ordre des `seq`, resume apres coupure, idempotence d'un `intentId` rejoue, limitation de debit | serveur reellement en ecoute |
| `client` | composants purs (Vitest + Testing Library) ; le store WS applique correctement les evenements ; ecrasement par `s2c.snapshot`. E2E Playwright : non bloquant en M0 | |
| `ai-eval` | chemin **N0** uniquement en CI bloquante : instantane de requete octet a octet, assertions rejouees sur sorties enregistrees, faits dores de chronique. **Zero appel API, zero cle** | N1 / N2 sur chaque PR (cout, non-determinisme) |
| `sim` | voir §7.4 ; les scenarios eux-memes sont la suite de tests | |

### 7.2 Fixtures (`@for/testkit`)

```
packages/testkit/src/
  rng/scripted.ts        # scriptedRng([6,3,9]) — epuise => throw ScriptedRngExhausted
  rng/seeded.ts          # re-export de createSeededRng + SEEDS constantes nommees
  clock/fixed.ts         # fixedClock(ISO) ; ids/counter.ts : counterIds('ev') -> ev-1, ev-2…
  fixtures/characters.ts # aCharacter({ ... }) — constructeurs a valeurs par defaut completes
  fixtures/table.ts      # aTableState({ characters, clocks, vows })
  fixtures/events.ts     # anEvent(...)
  fixtures/campaigns.ts  # LONG_CAMPAIGN (≈2000 evenements, pour l'invariant 2)
  golden/runner.ts       # expectGolden(name, value) — compare ou reecrit si GOLDEN_UPDATE=1
  assertions.ts          # expectValidState, expectNoReservedChampion, expectSeqContiguous
```

Regle : **tout test qui a besoin d'un etat de table passe par un constructeur de `testkit`.**
Aucun objet d'etat litteral dans un fichier de test — sinon un champ ajoute au moteur oblige a
toucher cinquante fichiers.

### 7.3 Corpus dores (« golden »)

Trois corpus obligatoires en M0 :

1. `engine/tests/golden/challenge-matrix.golden.json` — **pas** un produit cartesien complet :
   uniquement les combinaisons qui portent une decision, soit environ 300 lignes — bornes du
   souffle (-6, -1, 0, +1, +2, +9, +10), egalite `|souffle| == de d'action`, franchissement du
   plafond a 10, des de defi egaux, et les trois issues autour de chaque seuil. Oracle de
   reference des regles : qui modifie le calcul obtient une diff lisible. Un corpus genere
   « large » produirait une diff illisible, qui ne serait plus relue.
2. `engine/tests/golden/replay-*.golden.json` — pour chaque scenario du simulateur, l'etat final
   serialise. Verifie invariants 1 et 4.
3. `ai/eval/golden/context-*.golden.txt` — le prompt assemble pour des entrees figees. Un
   changement de prompt devient visible en revue.

Serialisation deterministe imposee : `packages/testkit/src/golden/stable-stringify.ts`
(cles triees, nombres normalises, 2 espaces, `\n` final).

### 7.4 Le simulateur de table headless (`@for/sim`)

**Objet.** Jouer des parties completes — sans navigateur, sans WebSocket reel, sans appel IA —
contre **le vrai service applicatif** (`CampaignService` de `@for/server`), pour repondre en
quelques secondes : « est-ce que ma modification a casse une partie ? »

```
packages/sim/
  src/
    cli.ts                    # POINT D'ENTREE : pnpm sim run|list|record|replay
    harness.ts                # createSimHarness(options): SimHarness
    scripted-narrator.ts      # implemente NarratorPort sans IA (texte deterministe)
    scenario.ts               # types + chargeur
    checks/
      invariants.ts           # etat valide apres CHAQUE evenement
      replay-equivalence.ts   # reduceAll(journal) === snapshot
      lockout.ts              # aucun champion reserve dans la sortie
      determinism.ts          # meme graine => meme journal
    report.ts                 # sortie humaine + JSON pour la CI
  scenarios/
    00-smoke-join-and-roll.scenario.json
    01-full-session.scenario.json
    02-vow-to-fulfilment.scenario.json
    03-death-spiral.scenario.json
    04-momentum-edge-cases.scenario.json
    05-reconnect-and-resume.scenario.json
    06-two-players-interleaved.scenario.json
  tests/scenarios.test.ts     # execute tous les scenarios ; c'est la suite bloquante
```

**Ce que le harnais fait exactement**

1. Cree une base SQLite dans un dossier temporaire et applique **les vraies migrations**.
2. Construit l'application avec `buildApp()` et des dependances injectees :
   `createSeededRng(scenario.seed)`, `fixedClock(scenario.startedAt)`, `counterIds()`,
   `ScriptedNarrator` (implementation du port), contenu reel. Fastify n'ecoute pas ; le WS est
   court-circuite : le harnais parle au `TableHub` en memoire via une paire de sockets factices,
   ce qui **teste le vrai routage de messages** (`c2s.*` -> pipeline -> `s2c.*`).
3. Cree les joueurs et leurs champions selon le scenario (auth stubee au niveau de la garde, pas
   du pipeline de jeu).
4. Deroule les `Intent` du scenario, joueur par joueur, en respectant les attentes declarees
   (`waitFor: "s2c.event"`). **Pas de verrou de tour** (§3.3) : l'ordre est celui du scenario, la
   serialisation celle de la file d'ecriture par campagne.
5. Apres **chaque** evenement : `checkInvariants(state)` ; toute violation arrete le scenario avec
   le `seq` fautif et le dernier intent.
6. A la fin : rejoue tout le journal depuis l'etat initial, egalite stricte exigee avec le
   snapshot (invariant 4) ; compare l'etat final et la trace du RNG au fichier dore ; verifie
   qu'aucun champion reserve n'apparait, la contiguite des `seq` et la couverture (chaque
   mouvement du registre exerce par au moins un scenario — sinon echec `move_not_covered`).
7. Ecrit un rapport : `sim-report.json` (CI) + tableau lisible (`--format=pretty`).

**Modes.**
- `pnpm sim run [--scenario=03] [--seed=…] [--format=pretty|json]`
- `pnpm sim record --scenario=03` : regenere le dore de ce scenario.
- `pnpm sim replay --db=<fichier>` : rejoue le journal d'une base reelle (outil de debug
  production ; consequence directe de l'invariant 4).
- `pnpm sim fuzz --iterations=500 --seed=…` : genere des intentions aleatoires **valides
  syntaxiquement** et verifie qu'aucune ne produit d'exception non geree ni d'etat invalide.
  Il ne couvre **pas** les trames malformees : ce cas est traite par un fuzz separe au niveau
  de `zC2SEnvelope.safeParse` (`packages/contracts/tests/envelope-fuzz.test.ts`), sinon un
  plantage de parsing passe entre les mailles.
  Un rejet propre (`s2c.rejected`) est un succes ; un `500` ou un etat invalide est un echec.
  La graine d'un echec est imprimee pour reproduction exacte.

**Contraintes.** Le simulateur ne doit jamais importer `@for/ai` autrement que pour ses types.
Duree cible : la suite complete des scenarios sous **20 secondes** en CI. Si elle depasse
60 secondes, la CI echoue (garde `--bail-on-slow`).

---

## 8. Chaine d'integration continue

`.github/workflows/ci.yml`, declenche sur `pull_request` et `push` sur `main`.
Runner `ubuntu-latest`, Node 24, `pnpm/action-setup`, cache pnpm + cache Turborepo.

| # | Job | Commande | Bloque le merge |
|---|---|---|---|
| 1 | `install` | `pnpm install --frozen-lockfile` | **oui** (lockfile desynchronise = rouge) |
| 2 | `format` | `pnpm format:check` | **oui** |
| 3 | `lint` | `pnpm lint` | **oui** |
| 4 | `typecheck` | `pnpm typecheck` | **oui** |
| 5 | `deps` | `pnpm depcruise` + `pnpm check:workspace` + `bash scripts/check-ci-jobs.sh` (graphe, cycles, purete du moteur, scripts obligatoires, coherence de la chaine) | **oui** |
| 6 | `test-unit` | `pnpm test:coverage` (seul chemin qui evalue le seuil global, ADR 0002 §3) ; seuils : `engine` 95 %/90 %, `contracts` 90 %, `db` 80 %, global 70 % | **oui** |

> **Ou vivent ces seuils.** Le seuil global vit dans le `vitest.config.ts` **racine** et les
> seuils par paquet dans le `vitest.config.ts` de chaque paquet concerne (`coverage.thresholds`),
> ecrits **une fois** par la tache qui cree le squelette du monorepo. Ils ne peuvent **pas** vivre
> dans `vitest.workspace.ts` : `defineWorkspace()` n'offre aucun emplacement pour une option de
> racine (ADR 0002 §2). La CI ne fait que lancer `vitest` : un seuil qui n'existe que dans un
> tableau de documentation n'est pas un seuil.
| 7 | `test-golden` | `pnpm test:golden` ; echoue aussi si `GOLDEN_UPDATE` est present dans l'environnement | **oui** |
| 8 | `migrations` | `pnpm db:check-schema` (aucune migration en attente, dump == `schema.expected.sql`) + `pnpm db:migrate` + `pnpm db:seed` sur base jetable | **oui** |
| 9 | `content` | `pnpm content:check` (chargeur 4 passes, code 1 en cas d'erreur) + `pnpm content:index && git diff --exit-code` | **oui** |
| 10 | `ai-eval-offline` | `pnpm eval:offline` — niveau **N0**, zero appel API, zero cle (02-mj-ia.md §8.5) | **oui** |
| 11 | `sim` | `pnpm sim run --format=json` (tous les scenarios). **`pnpm sim fuzz` n'est PAS dans la porte de PR en M0** : la trame malformee — le seul cas dangereux — est deja couverte par `packages/contracts/tests/envelope-fuzz.test.ts` (job 6), et fuzzer des intentions valides contre un moteur sans feature de jeu achete peu pour un risque d'instabilite reel sur une porte visee a 8 minutes. Le mode tourne a la demande ; bloquant en M1 (M0-28) | **oui** |
| 12 | `build` | `pnpm build` | **oui** |
| — | `docker` | `docker build -f infra/Dockerfile .` | **non bloquant sur PR**, bloquant en post-merge sur `main` |
| — | `e2e` | Playwright | **hors M0** (voir ci-dessous) |
| — | `ai-eval-live` | workflow separe `ai-eval.yml` | non (voir ci-dessous) |

Les jobs 2, 3, 4 et 12 (`build`) tournent en parallele apres 1 ; le job 5 (`deps`) apres 12 ;
les jobs 6 a 11 apres 5. **ADR 0003** a deplace cette arete : `deps` execute sur un arbre sans
`dist/` rapportait « dependance orpheline » la ou une frontiere de paquet etait franchie.
Concurrence : `group: ci-${{ github.ref }}`, `cancel-in-progress: true`.
Protection de branche sur `main` : PR obligatoire, 1 revue, checks 1-12 verts, historique lineaire
(squash merge uniquement), pas de push direct.

**Budget de temps.** La porte de PR vise **moins de 8 minutes**. `docker build` (module natif
`better-sqlite3`) passe en post-merge pour tenir ce budget : une porte lente est une porte que
les agents contournent. Si le build alpine devient instable, le repli est `node:24-bookworm-slim`
— decide d'avance, pas a chaud.

**Playwright est hors M0.** Son cout d'installation en CI n'est pas justifie tant qu'aucune
feature de jeu n'est a piloter. Les tests de bout en bout de M0 sont ceux de `@for/sim`, qui
couvrent le vrai pipeline sans navigateur. Playwright revient en M1, non bloquant d'abord.

`.github/workflows/ai-eval.yml` : nocturne (`cron`) + manuel + sur PR portant le label
`run-ai-eval`. Consomme `NARRATOR_API_KEY` (secret de depot), lance `pnpm eval:live` puis
`pnpm eval:judge`, publie le rapport en commentaire de PR et en artefact. **Pas** bloquant (cout
et non-determinisme), mais une regression de score ouvre une issue automatiquement. Les graders
`schema` et `lockout`, deterministes, sont reproduits en test unitaire sur sorties enregistrees
dans le job 6 (bloquant).

**Definition de « rouge »** : `pnpm verify` (§2.2) est la meilleure approximation locale de la
porte, pas son equivalent. Elle ne couvre pas le job 8 (`migrations`), ni `check-ci-jobs.sh`
(job 5), ni le seuil global de couverture (job 6), ni la regeneration de l'index de contenu
(job 9) ; les jobs 11 (`sim`) et 12 (`build`) exigent en outre un environnement complet.

---

## 9. Chaine de deploiement

Cible : **un VPS**, Docker Compose, Caddy en terminaison TLS, SQLite sur volume hote.

### 9.1 Image

`infra/Dockerfile`, multi-stage, **une seule image** qui sert l'API et les fichiers statiques du
client :

1. `base` : `node:24-alpine`, `corepack enable`.
2. `deps` : `pnpm install --frozen-lockfile` (cache de couche sur les manifests seuls).
3. `build` : `pnpm turbo run build` -> `packages/server/dist`, `packages/client/dist`.
4. `runtime` : `pnpm deploy --filter @for/server --prod`, copie de `client/dist` dans
   `/app/public`, utilisateur non root `app`, `HEALTHCHECK` sur `/healthz`,
   `ENTRYPOINT ["node", "dist/main.js"]`.

`better-sqlite3` est natif : la compilation se fait dans l'etape `build` avec `python3`,
`make`, `g++` (paquets `alpine` retires de l'image finale).

Les migrations s'appliquent **au demarrage du processus**, dans `main.ts`, avant `listen()`,
sous verrou (`BEGIN IMMEDIATE`). Une migration echouee empeche le demarrage : le conteneur
redemarre, l'ancien reste en place tant que le healthcheck n'est pas vert.

### 9.2 Composition

`infra/docker-compose.yml` : services `app` (image GHCR, `restart: unless-stopped`, volume
`/srv/feeders/data:/app/data`, **`deploy.replicas: 1` obligatoire**) et `caddy` (volumes
`caddy_data`, `caddy_config`, `Caddyfile`).

> **SQLite WAL suppose un ecrivain unique.** Il n'existe aucune montee en charge horizontale :
> deux instances de `app` sur le meme fichier corrompraient la serialisation par campagne et
> feraient perdre les buffers de narration en memoire. Repete dans `docs/runbook/deploy.md` ;
> le compose ne declare qu'un replica. Passer a plusieurs instances exige de changer de base —
> decision d'architecture, pas de deploiement.

`Caddyfile` : TLS automatique, reverse proxy vers `app:8787`, `header` HSTS, compression,
et `@ws` pour l'upgrade WebSocket (pas de buffering, `flush_interval -1`).

### 9.3 Workflow

`.github/workflows/deploy.yml`, sur `push` vers `main` **apres** succes de `ci.yml`
(`workflow_run`), plus declenchement manuel :

1. build multi-stage et push vers `ghcr.io/<org>/feeders-of-runeterra:sha-<sha>` + `:latest` ;
2. sauvegarde pre-deploiement via SSH : `infra/scripts/backup.sh` (`VACUUM INTO` horodate,
   7 jours de retention) ;
3. SSH (cle de deploiement dediee, secret `DEPLOY_SSH_KEY`) :
   `docker compose pull && docker compose up -d --wait` ;
4. verification : `curl -fsS https://<host>/readyz` avec 10 tentatives ;
5. en cas d'echec : `infra/scripts/deploy.sh rollback` repointe sur le tag precedent,
   restaure la sauvegarde **seulement** si une migration a ete appliquee, et echoue le workflow.

Environnement GitHub `production` avec approbation manuelle requise, secrets :
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `NARRATOR_API_KEY`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET`, `SESSION_SECRET`.

### 9.4 Variables d'environnement (`.env.example`, schema `zEnv`)

```
NODE_ENV=production
PORT=8787
PUBLIC_URL=https://feeders.example.com
DATABASE_PATH=/app/data/app.db
SESSION_SECRET=            # 32+ octets
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://feeders.example.com/api/auth/discord/callback
NARRATOR_PROVIDER=anthropic   # stub | anthropic | openai-compatible | ollama
NARRATOR_BASE_URL=            # obligatoire pour openai-compatible et ollama
NARRATOR_API_KEY=             # peut etre vide pour ollama et stub
NARRATOR_MODEL=               # vide => defaut de l'adaptateur
NARRATOR_MODEL_STRUCTURED=    # vide => defaut de l'adaptateur
#NARRATOR_TOOLS=probe         # on | off | probe        — facultative, defaut `probe`
#NARRATOR_TIMEOUT_MS=60000    # millisecondes           — facultative, defaut 60000
#NARRATOR_CONTEXT_WINDOW=     # tokens                  — facultative, defaut de l'adaptateur
LOG_LEVEL=info
```

> L'exemple ci-dessus est un **deploiement**, pas le gabarit du depot : `.env.example` porte
> `NARRATOR_PROVIDER=stub`, la CI et le simulateur tournant sans reseau. Le defaut recommande
> pour une vraie table sort de la mesure de M0-31 (`docs/runbook/conteur-fournisseurs.md`) ; le
> produit doit rester jouable sur un fournisseur gratuit ou un modele local — decision du tech
> lead, pas commodite.

**Les trois variables d'appoint sont validees** : elles appartiennent a la configuration
officielle du port, au meme titre que les cinq de base. Motif retenu par le tech lead : le
support des outils depend du **modele** et non de la passerelle, et un modele local qui charge a
froid depasse 60 s sans etre en panne. Facultatives et propres a un adaptateur, elles sont lues
**sans condition** par `buildNarrator` (§2.8) : `zEnv` leur donne donc une valeur par defaut
plutot que `undefined`.

| Variable | Defaut `zEnv` | Defaut par adaptateur | Ce qu'elle gouverne |
|---|---|---|---|
| `NARRATOR_TOOLS` (`on` \| `off` \| `probe`) | `'probe'` | `anthropic` ⇒ `on` (natif, aucune sonde) ; `openai-compatible` ⇒ `probe` (sonde unique au demarrage) ; `ollama` ⇒ `off` ; `stub` ⇒ ignoree | `capabilities.tools`, donc le mode sans outils (`02-mj-ia.md` §0.2) |
| `NARRATOR_TIMEOUT_MS` | `60000` | le meme pour les quatre ; a monter pour `ollama` (chargement a froid) | le delai d'un appel avant `timeout` |
| `NARRATOR_CONTEXT_WINDOW` | `null` | `anthropic` 1 000 000 ; `openai-compatible` 32 000 ; `ollama` 8 192 ; `stub` sans objet | `capabilities.contextWindowTokens`, donc le budget `min(14 000, fenetre × 0,6)` |

Les **memes valeurs** sont ecrites dans `.env.example` et dans `02-mj-ia.md` §0.6 — qui fait
autorite sur le port. Trois endroits, un seul contenu : si l'un des trois change, les deux
autres changent dans la meme PR.

`env.ts` parse au demarrage ; toute variable manquante ou invalide arrete le processus avec un
message explicite. Aucune variable n'est lue ailleurs que dans `env.ts`.

**Resolution du modele, ordre unique** : `campaigns.settings_json.models.<usage>` (par campagne)
> `NARRATOR_MODEL` / `NARRATOR_MODEL_STRUCTURED` (par deploiement) > le defaut de l'adaptateur
selectionne. `<usage>` vaut `narration` (pour `narrer()`) ou `structured` (pour `structurer()` :
forge, chronique, juge). Il n'existe **aucune** table de modeles partagee dans le code : un
identifiant de modele est une donnee d'adaptateur, jamais une constante du projet.

**`NARRATOR_PROVIDER=stub` est le seul interrupteur de mode degrade volontaire** : il selectionne
une implementation du port qui rend les gabarits de repli du moteur sans aucune sortie reseau.
C'est ce qui permet a `@for/sim` et a `pnpm eval:offline` de tourner sans cle. L'ancienne
variable `AI_ENABLED` n'existe plus.

### 9.5 Sauvegarde et restauration

`infra/scripts/backup.sh` : `VACUUM INTO` (**jamais** `cp` sur un fichier WAL vivant),
verification `integrity_check` + `foreign_key_check` de la copie, compression `zstd`,
chiffrement `age`, retention **14 quotidiennes + 8 hebdomadaires**, copie hors site `restic`.
Script complet et procedure de restauration pas a pas : `03-donnees.md` §6.3 a §6.6.
Cron hote toutes les 6 h + appel pre-deploiement. `infra/scripts/restore.sh` documente dans
`docs/runbook/backup-restore.md` ; la restauration est **testee** une fois en M0 (case de sortie).

**Litestream n'est pas livre en M0** : pas de vrais joueurs, donc pas de minutes de partie a
perdre. `litestream.yml` et le service compose sont ecrits dans le runbook et actives au premier
joueur reel — une ligne a decommenter, pas un chantier.

---

## 10. Definition de fini pour M0

M0 est termine quand, sur un poste neuf :

1. `pnpm install && pnpm verify` passe en moins de 3 minutes ;
2. `pnpm db:migrate && pnpm db:seed && pnpm dev` ouvre une page « table » qui se connecte au WS,
   affiche `s2c.welcome`, le snapshot du seed et la presence, sans aucune feature de jeu ;
3. la connexion Discord fonctionne de bout en bout en local ;
4. `pnpm sim run` execute les 7 scenarios, tous verts, en moins de 20 s ;
5. `pnpm eval:offline` (N0) produit un rapport sur fixtures **sans cle d'API** ;
5bis. `pnpm db:check` passe les 12 oracles d'integrite sur la base semee ;
6. la CI est verte sur une PR de demonstration et un `push` sur `main` deploie sur le VPS ;
7. une modification volontaire d'une constante de regle (par exemple `TICKS_PER_MILESTONE.dangereux`)
   fait echouer, **en local et en moins de 30 secondes**, au moins : un test unitaire du moteur,
   un corpus dore et un scenario du simulateur. C'est le critere qui justifie tout ce document.

---

## 11. Ce qui est traite ailleurs

| Sujet | Ou |
|---|---|
| Decisions transverses, arbitrages entre documents, vocabulaire | **`docs/ARCHITECTURE.md`** — document de reference, a lire en premier |
| Socle technique et son raisonnement | `docs/adr/0001-socle-technique.md` |
| Schema SQLite, catalogue des evenements, migrations, format du contenu, sauvegarde et restauration | `docs/design/03-donnees.md` |
| Prompts, surface d'outils, construction du contexte, chronique, forge, harnais d'eval | `docs/design/02-mj-ia.md` |
| Ecrans et ergonomie de la table | **non specifie**, hors M0 — a ecrire en M1 (`docs/design/04-ux-table.md`), en respectant le protocole WS de §5 |
