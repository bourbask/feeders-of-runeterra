# 01 — Architecture du monorepo « Feeders of Runeterra »

> Statut : **normatif sur la structure du monorepo**. Un agent developpeur qui cree un
> fichier ne doit avoir aucune decision de structure a reprendre ici.
> **Autorite superieure : `docs/ARCHITECTURE.md`.** En cas de divergence residuelle avec
> `02-mj-ia.md` ou `03-donnees.md`, la table d'arbitrage de `docs/ARCHITECTURE.md` tranche.
> Portee : jalon **M0** (fondations) et cadre des jalons suivants.
> Toute deviation exige un ADR dans `docs/adr/` qui amende explicitement ce fichier.

Langue : **interface et contenu en francais**, **code, identifiants, commentaires, messages de
log et noms de commits en anglais**. Les chaines destinees a l'humain joueur vivent dans
`@for/content` (libelles) ou dans les schemas d'erreur (`userMessage`), jamais en dur dans la logique.

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

Gestionnaire : **pnpm workspaces** (pnpm 10). Node **24 LTS** (`.nvmrc`, `engines` dans le
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
| `@for/ai` | `packages/ai` | Client Claude, assemblage de contexte, prompts, surface d'outils, parseurs de sortie, **assertions de style** (partagees eval / post-filtre), construction des requetes de forge et de chronique. **Pas de persistance, pas d'ordonnancement de job.** | `@anthropic-ai/sdk`, `@for/contracts`, `@for/content` |
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
              +-------+   @for/ai   +-------------+            (couche 3)
                      |      ^      |
                      +------+------+
                             |
                @for/server        @for/ai-eval                (couche 4)
                 ^        ^
                 |        |
            @for/sim   @for/client*                             (couche 5)
```

`@for/ai-eval` depend de `@for/ai` (jamais l'inverse) : les assertions de style vivent
dans `@for/ai/src/assertions/`, parce qu'elles servent **aussi** de post-filtre
d'execution. Un cycle `ai <-> ai-eval` est interdit par `dependency-cruiser`.

Regles d'arete, **verifiees en CI** par `dependency-cruiser` (`.dependency-cruiser.cjs`) :

1. `@for/engine` : `dependencies` **doit etre `{}`**. Interdiction d'importer quoi que ce soit
   hors de son propre `src/`. Interdiction des builtins Node (`node:*`, `fs`, `path`, `crypto`),
   de `Math.random`, `Date.now`, `new Date()`, `performance.now`, `process`, `globalThis`.
2. `@for/contracts` -> `@for/engine` : **type-only** (`import type`). Toute importation de valeur
   depuis `engine` dans `contracts` est une erreur de lint. Rationnel : garder `contracts`
   fidele aux types du moteur sans creer de dependance runtime inverse.
3. `@for/content` n'importe jamais `@for/db`, `@for/ai`, `@for/server`.
4. `@for/ai` n'importe **jamais** `@for/db` : tout etat lui est injecte par le serveur.
   C'est ce qui rend l'eval IA executable hors base.
5. `@for/client` n'importe **jamais** `@for/db`, `@for/ai`, `@for/server`, ni `@for/content`
   (entree principale). Il peut importer `@for/content/ui` (libelles) et `@for/engine`
   **pour affichage seulement** : calcul de cotes, formatage, previsualisation. Une regle ESLint
   interdit dans `packages/client` l'import des symboles `decide`, `reduce`, `reduceAll`,
   `rollChallenge`, `rollProgress`.
6. `@for/testkit` est une `devDependency` partout sauf dans `@for/sim`, ou elle est runtime.
7. Aucun cycle. `dependency-cruiser` echoue sur `no-circular`.

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
  tooling/tsconfig/                   # @for/tsconfig
  tooling/eslint-config/              # @for/eslint-config
  tooling/prettier-config/            # @for/prettier-config
  packages/{engine,contracts,content,testkit,db,ai,ai-eval,server,client,sim}/
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
  turbo.json                          # ou pnpm -r ; voir 2.2
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
| `lint` | `eslint .` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |

Scripts racine :

```
pnpm dev            # turbo run dev --parallel   (server tsx watch + client vite)
pnpm build
pnpm verify         # lint + format:check + typecheck + deps + test  <- porte de merge locale
pnpm test
pnpm test:golden    # corpus dores uniquement
pnpm golden:update  # regenere les corpus (GOLDEN_UPDATE=1)
pnpm sim            # @for/sim CLI
pnpm db:generate    # drizzle-kit generate
pnpm db:migrate
pnpm db:studio
pnpm db:seed
pnpm content:index  # scripts/generate-content-index.ts
pnpm ai:eval
```

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

Regle d'or : **`decide` tire les des, `reduce` n'en tire jamais.** `reduce` est totalement
deterministe et sans `Rng`. C'est ce qui rend le rejeu du journal exact (invariant 4).

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

**Tous** les schemas Zod du projet vivent dans `@for/contracts` — y compris les schemas de
contenu (§2.5) et les schemas d'E/S IA. `@for/content` et `@for/ai` les **importent**, ne les
redeclarent jamais : c'est ce qui evite un cycle `content -> contracts -> content`.

`zTableState` (dans `src/dto/`) est l'exception assumee : ce n'est pas un miroir du moteur mais
la **projection** envoyee a un joueur, amputee de tout ce qui porte `visibility: 'gm'`.

`satisfies z.ZodType<T>` fait echouer `typecheck` des que le moteur evolue sans le schema.
Il n'y a **aucune generation de code** : les types sont deduits (`z.output`) ou importes du
moteur. Interdiction d'ecrire a la main une interface qui duplique un `z.output`.

**Consommation.**
- Back : `fastify-type-provider-zod`. Chaque route declare `schema: { body, querystring, params, response }`
  avec des schemas de `@for/contracts/http`. Toute trame WS entrante passe par
  `zC2SEnvelope.safeParse` **avant** toute autre chose.
- Front : `@for/contracts` est importe directement (zod est dans le bundle client, assume).
  Les reponses HTTP sont parsees par le client HTTP genere dans
  `packages/client/src/api/http.ts`. Les trames WS entrantes sont parsees par
  `zS2CEnvelope.safeParse` dans `packages/client/src/ws/socket.ts`. Les formulaires utilisent
  les memes schemas (`@hookform/resolvers/zod`).
- Sortie IA : `zNarrationOutput`, `zForgedChampion` sont les **seuls** points d'entree du texte
  modele dans le systeme. Un `safeParse` en echec = retry borne puis repli deterministe.

### 2.5 `packages/content`

```
packages/content/
  data/
    champions/ashe.json ... (20 fiches ecrites a la main en V1)
    oracles/{action-theme,places,names,npc-roles,yes-no}.json
    tables/{pay-the-price,omens}.json
    regions/{avarosa,frostguard,winters-claw,ursine,...}.json
    moves/*.json                 # texte francais des mouvements
    labels/{attributes,gauges,outcomes,ui}.json
  src/
    index.ts                     # registre COMPLET — serveur / sim uniquement
    ui.ts                        # sous-entree "@for/content/ui" : libelles seuls, leger
    generated/index.ts           # GENERE — imports statiques de tous les JSON
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
      index.ts  users.ts  sessions.ts  tables.ts  members.ts  characters.ts
      events.ts  snapshots.ts  chronicle.ts  ai-calls.ts  reservations.ts
    repositories/
      events.ts      # appendEvents (transaction), readSince(seq), lastSeq
      tables.ts  characters.ts  users.ts  chronicle.ts  aiCalls.ts
    migrate.ts       # runMigrations(db) — appelee au demarrage du conteneur
    seed/demo.ts     # seed de demo M0 : 1 table, 3 persos, ~40 evenements
  tests/
    migrations.test.ts    # migre a blanc sur base memoire, puis verifie le schema
    events-repo.test.ts   # append-only, seq monotone, transaction atomique
```

`events` est la table sacree : `PRIMARY KEY (campaign_id, seq)`, insertion uniquement, aucun
`UPDATE`/`DELETE` (garanti par un trigger SQLite `BEFORE UPDATE/DELETE ... RAISE(ABORT)`).
Detail des colonnes : `docs/design/02-data-model.md`.

### 2.7 `packages/ai`

```
packages/ai/
  src/
    index.ts
    client.ts             # createClaudeClient(config) — cle API lue par le serveur, injectee ici
    models.ts             # MODELS = { narration: 'sonnet-5', forge: 'opus-5', chronicle: 'opus-5' }
    context/
      assemble.ts         # assembleNarrationContext(input): PromptPayload
      budget.ts           # bornes de tokens par section
    prompts/              # .md versionnes, charges par import ?raw
      gm-system.md  narration-user.md  forge-system.md  chronicle-system.md
    tools/
      index.ts            # TOOL_REGISTRY
      get-state.ts  get-lore.ts  roll-oracle.ts        # lecture
      propose-npc.ts  propose-clock.ts  propose-price.ts # PROPOSITION -> Intent
    outputs/
      narration.ts  forge.ts  chronicle.ts             # safeParse + repli
    eval/
      cases/*.json        # cas d'eval (entree figee + criteres)
      runner.ts  graders/{schema,lockout,fact-fidelity,style}.ts
      report.ts
  tests/
    tool-surface.test.ts  context-budget.test.ts  outputs.test.ts
```

`@for/ai` ne connait ni SQLite ni Fastify : il recoit un `NarrationRequest` deja hydrate.
C'est ce qui permet a `eval/runner.ts` de tourner sur fixtures.

**Verrouillage de distribution.** `assembleNarrationContext` injecte toujours
`reservedChampions` et `allowedNpcs`. Le grader `lockout` echoue si une sortie mentionne un
champion reserve. Le serveur refait la verification a la reception (defense en profondeur) :
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
      narrator.ts         # Narrator (interface) + ClaudeNarrator + StubNarrator
      snapshots.ts        # politique de snapshot (tous les 200 evenements)
      chronicle.ts        # declenchement de la compaction
  tests/
    http/*.test.ts  ws/*.test.ts  game/*.test.ts
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
  getSnapshot(campaignId: CampaignId): Promise<{ state: CampaignState; lastSeq: number }>;
  readEventsSince(campaignId: CampaignId, seq: number): Promise<readonly PersistedEvent[]>;
}

// src/game/narrator.ts — permet a @for/sim de tourner sans appel IA
export interface Narrator {
  narrate(brief: NarrationBrief, ctx: NarrationContext): AsyncIterable<NarrationChunk>;
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
    ws/socket.ts        # connexion, reconnexion exponentielle, resume via lastSeq
    ws/store.ts         # reduce local des s2c.event -> etat affiche (miroir, jamais autorite)
    routes/{Login,TableList,TableRoom,CharacterPicker}.tsx
    features/table/{Log,Sheet,Gauges,MoveBar,Clocks,Vows}/
    components/ui/*     # primitives sans logique metier
    styles/
  tests/  e2e/          # Playwright (hors CI bloquante en M0)
```

Etat client : **TanStack Query** pour le distant HTTP, **Zustand** pour l'etat de session WS.
Aucun `useState` ne detient d'etat de jeu autoritaire. Le store WS applique `reduce()` du moteur
sur les evenements recus **uniquement pour l'affichage** ; a chaque `s2c.snapshot` il est ecrase.

### 2.10 `packages/sim` — voir §7.4.

---

## 3. Conventions

### 3.1 Nommage

| Element | Regle | Exemple |
|---|---|---|
| Fichier de source | `kebab-case.ts` | `face-danger.ts`, `campaign-service.ts` |
| Composant React | `PascalCase.tsx`, un composant exporte par defaut par fichier | `MoveBar.tsx` |
| Hook React | `use-*.ts`, export nomme `useX` | `use-table-socket.ts` |
| Type / interface | `PascalCase`, **sans** prefixe `I` | `TableState` |
| Schema Zod | prefixe `z` + `PascalCase` | `zTableState` |
| Type deduit d'un schema | suffixe `Dto` si distinct du type moteur | `TableStateDto` |
| Constante module | `SCREAMING_SNAKE_CASE` | `TICKS_PER_MILESTONE` |
| Fonction | `camelCase`, verbe en tete | `rollChallenge`, `appendEvents` |
| Type d'evenement | `domain.past_tense` en anglais | `dice.challenge_rolled`, `gauge.changed` |
| Type d'intention | `domain.imperative` en anglais | `move.strike`, `table.join` |
| Message WS | `c2s.*` / `s2c.*` | `c2s.intent`, `s2c.event` |
| Table SQL / colonne | `snake_case` pluriel pour les tables | `campaign_events`, `created_at` |
| Id de contenu | slug latin minuscule sans accent | `ashe`, `pay-the-price` |
| Branche git | `m<jalon>/<scope>-<sujet>` | `m0/engine-challenge-roll` |
| Commit | Conventional Commits, scope = package | `feat(engine): add omen detection` |

Les identifiants de mecanique gardent leur nom **francais** cote donnees (`vif`, `coeur`, `fer`,
`ombre`, `esprit`, `vigueur`, `ame`, `vivres`, `souffle`, `franche`, `partielle`, `echec`,
`presage`) : ce sont des valeurs de domaine, pas du code. Les fonctions qui les manipulent sont
en anglais (`burnMomentum`, `gaugeDelta`).

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

1. **`RuleViolation` (moteur).** Une intention invalide au regard des regles n'est pas une
   exception : `decide()` retourne `err({ code, details })`. `code` appartient a une union
   fermee (`'move_in_progress' | 'gauge_out_of_range' | 'unknown_move' | 'character_dead' | ...`).
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
   `AppErrorCode` est une union fermee declaree dans `@for/contracts/errors.ts`, partagee avec
   le client qui peut donc reagir par code. La charge utile renvoyee est
   `{ code, message, requestId }` ; `details` reste dans le log.
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
  `*.refreshToken`, `ANTHROPIC_API_KEY`, `DISCORD_CLIENT_SECRET`.
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
  dore doit etre justifiee dans le message de commit.
- **Fixtures** : `packages/testkit/src/fixtures/`, jamais dupliquees dans un package consommateur.
- Un test ne cree jamais de fichier hors `os.tmpdir()`, n'ouvre jamais le reseau, n'appelle
  jamais l'API Claude (interdit par `packages/ai/tests/setup.ts` qui stub `fetch` et fait
  echouer tout appel sortant).

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
  `pnpm typecheck` = `tsc -b --pretty false`.
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
import-x/no-cycle                                error
import-x/no-default-export                       error (sauf *.tsx, *.config.*)
no-console                                       error (engine, contracts, content, client)
no-restricted-syntax                             error : NewExpression[callee.name='Date'],
                                                 MemberExpression[object.name='Math'][property.name='random']
                                                 -> dans engine ET server/src/game (RNG et horloge injectes)
```

`tooling/eslint-config/engine-purity.js`, applique a `packages/engine/**` :
`no-restricted-imports` (tous les `node:*`, tout paquet npm), `no-restricted-globals`
(`process`, `window`, `document`, `fetch`, `globalThis`, `performance`, `crypto`, `setTimeout`).

`eslint.config.js` racine : applique la config de base a tout, la config `react` a
`packages/client/**`, la config `engine-purity` a `packages/engine/**`, et la regle
« pas de mutation de jeu cote client » (`no-restricted-imports` sur les symboles `decide`,
`reduce`, `reduceAll`, `rollChallenge`, `rollProgress` importes de `@for/engine`) a
`packages/client/**`.

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
lots) ; `lint-staged` + `simple-git-hooks` sont fournis mais optionnels via `pnpm hooks:install`.

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
| `c2s.subscribe_narration` | `{ eventId: string }` | Redemande le flux de narration d'un evenement (apres reconnexion) |

Il n'existe **aucun** message client contenant une jauge, un resultat de de, un `GameEvent`, un
`CampaignState` ou un identifiant de PNJ a faire apparaitre. `zC2SMessage` est verifie par test
(§0, invariant 3). Toute proposition de nouveau message c2s qui transporte un resultat est
refusee en revue.

### 5.3 `Intent` — union discriminee (`@for/contracts/intents`)

| `intent.type` | Charge | Notes |
|---|---|---|
| `table.join` | `{ characterId }` | rattachement d'un joueur a son champion |
| `table.leave` | `{}` | |
| `character.create_draft` | `{ championSlug, spread, background }` | declenche la forge IA si la fiche n'est pas ecrite a la main |
| `move.face_danger` | `{ attribute, description, bonus? }` | affronter le danger |
| `move.secure_advantage` | `{ attribute, description, bonus? }` | assurer un avantage |
| `move.gather_information` | `{ description, bonus? }` | attribut force a `esprit` par le moteur |
| `move.probe_a_soul` | `{ targetNpcId \| targetDescription, bonus? }` | sonder une ame |
| `move.strike` | `{ targetId, attribute: 'fer' \| 'vif', bonus? }` | frapper |
| `move.endure_harm` | `{ amount? }` | encaisser |
| `move.endure_cold` | `{ }` | endurer le froid |
| `move.swear_a_vow` | `{ text, rank }` | jurer un serment |
| `progress.roll` | `{ trackId }` | jet de progression (serment / affrontement) |
| `momentum.burn` | `{ rollId }` | bruler le souffle sur un jet en attente |
| `oracle.ask` | `{ question, odds }` | oracle oui/non ponderes |
| `oracle.draw` | `{ campaignId: OracleTableId }` | table evocatrice |
| `speech.say` | `{ channel, text }` | genere par `c2s.speak` |
| `session.begin` / `session.end` | `{}` | bornes de seance (utilisees par la chronique) |

Le client **propose** ; le serveur peut refuser (`s2c.rejected`). Le client n'affiche jamais un
resultat avant d'avoir recu le `s2c.event` correspondant (pas d'optimistic update sur le jeu ;
autorise uniquement pour `speech.say`, marque `pending`).

### 5.4 Messages serveur -> client

| `t` | Charge utile `p` |
|---|---|
| `s2c.welcome` | `{ protocolVersion, playerId, campaignId, you: { characterId \| null }, contentVersion, lastSeq }` |
| `s2c.snapshot` | `{ state: CampaignStateDto, lastSeq }` — envoye si `lastSeq` client trop ancien ou absent |
| `s2c.event` | `{ event: GameEvent }` + `seq` dans l'enveloppe. **Unique vecteur de mutation d'etat.** |
| `s2c.events_batch` | `{ events: Array<{ seq, event }> }` — rattrapage apres `c2s.resume` |
| `s2c.narration_started` | `{ eventId, narrationId }` |
| `s2c.narration_delta` | `{ narrationId, text }` — flux token par token |
| `s2c.narration_done` | `{ narrationId, eventId, text, model, degraded: boolean }` |
| `s2c.rejected` | `{ intentId, code: RuleViolationCode \| AppErrorCode, message }` |
| `s2c.error` | `{ code, message, requestId, intentId? }` |
| `s2c.presence` | `{ members: Array<{ playerId, characterId \| null, online, typing }> }` |
| `s2c.ping` | `{}` |
| `s2c.resync_required` | `{ reason }` — le client doit refaire `c2s.hello` |

**Ordre et livraison.** Les `s2c.event` d'une table arrivent dans l'ordre strict des `seq`, sans
trou. Le client qui detecte un trou envoie `c2s.resume { sinceSeq }`. La narration est
**asynchrone et hors bande** : un `s2c.event` n'attend jamais l'IA. Consequence directe de
l'invariant 1 — la partie avance meme si le modele est indisponible.

### 5.5 Codes de fermeture

`4001` protocol_version · `4002` unauthenticated · `4003` forbidden_table ·
`4004` table_not_found · `4008` rate_limited · `4009` payload_too_large · `4010` server_shutdown.

### 5.6 Limitation de debit

Par connexion : 5 `c2s.intent` / 10 s (rafale 10), 20 `c2s.speak` / 60 s, 2 `c2s.resume` / 10 s,
`c2s.typing` echantillonne a 1/s cote client et ignore au-dela cote serveur. Depassement :
`s2c.error { code: 'rate_limited' }`, puis fermeture `4008` au troisieme depassement.

---

## 6. Surface HTTP (M0)

| Methode | Route | Role |
|---|---|---|
| `GET` | `/healthz` | liveness : `{ status, version, uptimeMs }`, sans base |
| `GET` | `/readyz` | readiness : ping SQLite + migrations a jour |
| `GET` | `/api/auth/discord/start` | redirection OAuth (state + PKCE en cookie `HttpOnly`) |
| `GET` | `/api/auth/discord/callback` | echange du code, creation d'utilisateur, cookie de session |
| `POST` | `/api/auth/logout` | invalide la session |
| `GET` | `/api/me` | `{ user, characters, tables }` |
| `GET` | `/api/campaigns` · `POST /api/campaigns` | liste / creation de table |
| `GET` | `/api/campaigns/:id` | metadonnees + `lastSeq` |
| `GET` | `/api/campaigns/:id/log?sinceSeq=` | journal pagine (rendu du carnet de campagne) |
| `GET` | `/api/content/manifest` | `{ contentVersion, counts, etag }` |
| `GET` | `/api/content/:kind/:id` | fiche de contenu (cache `immutable` clefe sur `contentVersion`) |

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
| `db` | migration a blanc puis assertions de schema ; append-only (l'`UPDATE` d'un evenement doit lever) ; monotonie de `seq` sous concurrence ; atomicite d'`appendEvents` ; seed de demo idempotent. Base sur fichier temporaire, pas `:memory:` (WAL) | |
| `ai` | surface d'outils (invariant 1) ; budget de contexte (invariant 2) ; parseurs de sortie sur corpus de sorties modele **enregistrees** ; verrouillage de distribution. **Zero appel reseau** : `setup.ts` fait echouer tout `fetch` | tout test qui appelle l'API |
| `server` | routes via `app.inject()` ; garde d'auth ; pipeline d'intention de bout en bout avec `StubNarrator` et RNG seede ; WS : handshake, ordre des `seq`, resume apres coupure, idempotence d'un `intentId` rejoue, limitation de debit | serveur reellement en ecoute |
| `client` | composants purs (Vitest + Testing Library) ; le store WS applique correctement les evenements ; ecrasement par `s2c.snapshot`. E2E Playwright : non bloquant en M0 | |
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

1. `engine/tests/golden/challenge-matrix.golden.json` — produit cartesien
   attribut (1..3) x bonus (-2..+4) x souffle (-6..+10) x paires de des de defi remarquables,
   avec pour chaque ligne le `ChallengeRoll` complet attendu. C'est l'oracle de reference des
   regles : si quelqu'un modifie le calcul, la diff est lisible ligne a ligne.
2. `engine/tests/golden/replay-*.golden.json` — pour chaque scenario du simulateur, l'etat final
   serialise. Verifie invariants 1 et 4.
3. `ai/eval/golden/context-*.golden.txt` — le prompt assemble pour des entrees figees. Un
   changement de prompt devient visible en revue.

Serialisation deterministe imposee : `packages/testkit/src/golden/stable-stringify.ts`
(cles triees, nombres normalises, 2 espaces, `\n` final).

### 7.4 Le simulateur de table headless (`@for/sim`)

**Objet.** Jouer des parties completes, sans navigateur, sans WebSocket reel et sans appel IA,
contre **le vrai service applicatif** (`CampaignService` de `@for/server`), pour repondre en
quelques secondes a la question : « est-ce que ma modification a casse une partie ? »

```
packages/sim/
  src/
    cli.ts                    # POINT D'ENTREE : pnpm sim run|list|record|replay
    harness.ts                # createSimHarness(options): SimHarness
    scripted-narrator.ts      # implemente Narrator sans IA (texte deterministe)
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
   `ScriptedNarrator`, contenu reel. Fastify n'ecoute pas ; le WS est court-circuite : le
   harnais parle au `TableHub` en memoire via une paire de sockets factices, ce qui **teste le
   vrai routage de messages** (`c2s.*` -> pipeline -> `s2c.*`).
3. Cree les joueurs et leurs champions selon le scenario (auth stubee au niveau de la garde,
   pas du pipeline de jeu).
4. Deroule la liste d'`Intent` du scenario, joueur par joueur, en respectant les tours et les
   attentes declarees (`waitFor: "s2c.event"`).
5. Apres **chaque** evenement : `checkInvariants(state)` ; toute violation arrete le scenario
   avec le `seq` fautif et le dernier intent.
6. A la fin : rejoue tout le journal depuis l'etat initial et exige l'egalite stricte avec le
   snapshot (invariant 4) ; compare l'etat final et la trace du RNG au fichier dore ; verifie
   qu'aucun champion reserve n'apparait ; verifie la contiguite des `seq` et la couverture
   (chaque mouvement du registre doit etre exerce par au moins un scenario — sinon echec
   `move_not_covered`).
7. Ecrit un rapport : `sim-report.json` (CI) + tableau lisible (`--format=pretty`).

**Modes.**
- `pnpm sim run [--scenario=03] [--seed=…] [--format=pretty|json]`
- `pnpm sim record --scenario=03` : regenere le dore de ce scenario.
- `pnpm sim replay --db=<fichier>` : rejoue le journal d'une base reelle (outil de debug
  production ; consequence directe de l'invariant 4).
- `pnpm sim fuzz --iterations=500 --seed=…` : genere des intentions aleatoires **valides
  syntaxiquement** et verifie qu'aucune ne produit d'exception non geree ni d'etat invalide.
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
| 2 | `format` | `pnpm prettier --check .` | **oui** |
| 3 | `lint` | `pnpm turbo run lint` | **oui** |
| 4 | `typecheck` | `pnpm tsc -b` | **oui** |
| 5 | `deps` | `pnpm depcruise` + `pnpm check:workspace` (graphe, cycles, purete du moteur, scripts obligatoires) | **oui** |
| 6 | `test:unit` | `pnpm turbo run test` avec couverture ; seuils : `engine` 95 %/90 %, `contracts` 90 %, `db` 80 %, global 70 % | **oui** |
| 7 | `test:golden` | `pnpm test:golden` ; echoue aussi si `GOLDEN_UPDATE` est present dans l'environnement | **oui** |
| 8 | `migrations` | `pnpm db:generate --check` (aucune migration en attente) + migration a blanc + `pnpm db:seed` sur base jetable | **oui** |
| 9 | `content` | `pnpm content:index && git diff --exit-code` + validation du contenu | **oui** |
| 10 | `sim` | `pnpm sim run --format=json` (tous les scenarios) + `pnpm sim fuzz --iterations=200 --seed=$GITHUB_SHA` | **oui** |
| 11 | `build` | `pnpm turbo run build` | **oui** |
| 12 | `docker` | `docker build -f infra/Dockerfile .` (sans push sur PR) | **oui** |
| 13 | `e2e` | Playwright | non (informatif en M0) |
| 14 | `ai-eval` | workflow separe | non (voir ci-dessous) |

Les jobs 2 a 5 tournent en parallele apres 1 ; 6 a 10 apres 5 ; 11 et 12 apres 6.
Concurrence : `group: ci-${{ github.ref }}`, `cancel-in-progress: true`.
Protection de branche sur `main` : PR obligatoire, 1 revue, checks 1-12 verts, historique lineaire
(squash merge uniquement), pas de push direct.

`.github/workflows/ai-eval.yml` : nocturne (`cron`) + manuel + sur PR portant le label
`run-ai-eval`. Consomme `ANTHROPIC_API_KEY` (secret de depot), lance `pnpm ai:eval`, publie le
rapport en commentaire de PR et en artefact. Il n'est **pas** bloquant (cout et non-determinisme)
mais une regression de score ouvre une issue automatiquement. Les graders `schema` et `lockout`
sont, eux, deterministes : ils sont reproduits en test unitaire sur sorties enregistrees dans le
job 6 (bloquant).

**Definition de « rouge »** : un agent developpeur lance `pnpm verify` en local ; s'il passe, les
jobs 2 a 9 passent. Les jobs 10 a 12 sont les seuls a exiger un environnement complet.

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
`/srv/for/data:/data`) et `caddy` (volumes `caddy_data`, `caddy_config`, `Caddyfile`).
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
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `ANTHROPIC_API_KEY`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET`, `SESSION_SECRET`.

### 9.4 Variables d'environnement (`.env.example`, schema `zEnv`)

```
NODE_ENV=production
PORT=8787
PUBLIC_URL=https://feeders.example.com
DATABASE_PATH=/data/for.sqlite
SESSION_SECRET=            # 32+ octets
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://feeders.example.com/api/auth/discord/callback
ANTHROPIC_API_KEY=
AI_MODEL_NARRATION=claude-sonnet-5
AI_MODEL_FORGE=claude-opus-5
AI_ENABLED=true            # false => StubNarrator (mode degrade volontaire)
LOG_LEVEL=info
```

`env.ts` parse au demarrage ; toute variable manquante ou invalide arrete le processus avec un
message explicite. Aucune variable n'est lue ailleurs que dans `env.ts`.

### 9.5 Sauvegarde et restauration

`infra/scripts/backup.sh` : `sqlite3 "$DATABASE_PATH" "VACUUM INTO '/backups/for-$(date -u +%FT%TZ).sqlite'"`,
compression, retention 7 jours + 4 hebdomadaires, copie hors site optionnelle (`restic`).
Cron hote quotidien + appel pre-deploiement. `infra/scripts/restore.sh` documente dans
`docs/runbook/backup-restore.md` ; la restauration est **testee** une fois en M0 (case de sortie).

---

## 10. Definition de fini pour M0

M0 est termine quand, sur un poste neuf :

1. `pnpm install && pnpm verify` passe en moins de 3 minutes ;
2. `pnpm db:migrate && pnpm db:seed && pnpm dev` ouvre une page « table » qui se connecte au WS,
   affiche `s2c.welcome`, le snapshot du seed et la presence, sans aucune feature de jeu ;
3. la connexion Discord fonctionne de bout en bout en local ;
4. `pnpm sim run` execute les 7 scenarios, tous verts, en moins de 20 s ;
5. `pnpm ai:eval --dry-run` produit un rapport sur fixtures sans appeler l'API ;
6. la CI est verte sur une PR de demonstration et un `push` sur `main` deploie sur le VPS ;
7. une modification volontaire d'une constante de regle (par exemple `TICKS_PER_MILESTONE.dangereux`)
   fait echouer, **en local et en moins de 30 secondes**, au moins : un test unitaire du moteur,
   un corpus dore et un scenario du simulateur. C'est le critere qui justifie tout ce document.

---

## 11. Points laisses ouverts

Ils sont traites dans les documents suivants, pas ici :

- Modele de donnees detaille, colonnes JSON, politique de snapshot -> `02-data-model.md`.
- Formules exactes des mouvements, tables d'oracle, table du prix -> `03-rules-engine.md`.
- Prompts, decoupage du contexte, schema de forge, compaction de chronique -> `04-ai-game-master.md`.
- Ecrans, ergonomie de la table, rendu du journal -> `05-ux-table.md`.
