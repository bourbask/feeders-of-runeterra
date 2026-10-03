# Feeders of Runeterra — Architecture

> **Document de reference. A lire en entier avant d'ecrire une ligne de code.** Il consolide les
> decisions et fixe le vocabulaire ; les trois specs de detail sont en §8. En cas de divergence
> avec une spec, **ce fichier tranche** ; la spec est corrigee dans la meme PR.

Statut : normatif, jalon M0. Toute deviation exige un ADR dans `docs/adr/` qui amende
explicitement ce fichier.

**Le produit.** Application web de jeu de role au Freljord (Runeterra). Les joueurs se connectent
par Discord, choisissent un champion, rejoignent une table et jouent ensemble. Le maitre de jeu
est une IA. Le vocal reste sur Discord : l'application ne gere **pas** l'audio.

**Langue.** Interface, contenu de jeu et documentation en **francais**. Code, identifiants, noms
de fichiers, commentaires, messages de log et commits en **anglais**. Une exception, codifiee en
§4 : les **valeurs** d'enumeration de mecanique restent en francais.

---

## 1. Les quatre invariants

Aucun n'est negociable, et chacun est porte par une frontiere verifiable en CI, pas par de la
discipline.

### Invariant 1 — Le moteur decide, l'IA raconte

Aucun outil expose au modele ne peut modifier une jauge, trancher une reussite ou un echec,
faire avancer une piste de progression, ni tuer un personnage. Les des sont tires par le moteur
**avant** l'appel au modele, et transmis comme un fait acquis a habiller. Les outils du modele
sont soit en **lecture**, soit en **proposition** validee par le serveur — et une proposition
acceptee est executee par le moteur, jamais par le modele.

*Garanti par* : `@for/engine` seule source de `GameEvent` ; `TOOL_DEFINITIONS` typee
`ReadOnlyTool | ProposalTool` ; **trois** listes closes de types d'evenements atteignables depuis
le modele, tenues separement :

1. par un circuit de **proposition** validee par le serveur — un outil `propose_*` ou le bloc
   `<scene_apres>`, qui n'est pas un outil mais emprunte le meme circuit — `entity.introduced`,
   `entity.updated`, `entity.status_changed`, `clock.created`, `clock.advanced`,
   `scene.started`, `scene.ended`, `scene.facts_updated` ;
2. par `roll_oracle`, seul outil de lecture qui ecrive — `roll.oracle_resolved`,
   `roll.yes_no_resolved` ;
3. par le **droit de refus** du conteur — `system.reverted`, et rien d'autre.

Plus : le validateur d'entree rejette tout evenement de jauge portant `actorKind: 'gm_ai'`.

Ces trois listes portent sur l'**etat de partie**. La famille `narration.*` en est exclue par
nature : c'est la trace de ce que le modele a dit et de ce que le serveur en a fait, sans valeur
de jeu et sans effet sur le reducteur (`03-donnees.md` §0.5).

Le troisieme circuit touche des jauges, d'ou sa justification ici :

- le modele ne transmet qu'une **cause** parmi quatre valeurs (`cible_absente`, `cible_morte`,
  `hors_de_portee`, `objet_inexistant`) et un nom de cible : aucune valeur, aucun `targetSeqs`,
  aucun `EngineEffect` ;
- le serveur **recalcule seul la preuve** depuis l'etat structure au moment du `move.declared`,
  jamais depuis l'issue du jet, et calcule seul les sequences a annuler depuis le
  `correlation_id` du tour ;
- une annulation ne produit aucune valeur nouvelle : elle rejoue le journal sans les lignes
  annulees ;
- si l'etat ne prouve pas la cause, le refus tombe sans effet ;
- le refus porte sur la **possibilite materielle** de l'action, jamais sur son issue — frontiere
  testee mecaniquement en rejouant le corpus avec les des inverses (`02-mj-ia.md` §4.8).

*Tests qui cassent le build* : `packages/ai/tests/tool-surface.test.ts`,
`packages/server/tests/proposal-surface.test.ts`,
`packages/engine/tests/ai-cannot-mutate.test.ts`.

### Invariant 2 — La memoire est dans la base, jamais dans la fenetre de contexte

Etat structure en SQLite, plus une **chronique** compactee regeneree periodiquement. Aucun
historique de conversation n'est conserve cote modele : le contexte est reconstruit a chaque
appel, borne, et il a exactement la meme taille au sixieme mois qu'a la deuxieme semaine.

**La fenetre roulante des douze derniers tours n'est pas une exception.** Elle porte la
narration verbatim du modele, mais elle est **reconstruite depuis la base** a chaque appel
(`ai_turn_renders` + `narration.gm_message`), bornee a douze tours, la premiere rognee par
l'echelle de troncature. Pas un historique accumule : une lecture de la base, comme le reste du
contexte.

*Garanti par* : plafonds durs du schema de chronique, echelle de troncature T1→T8, provenance
obligatoire par `event_seq` sur chaque fait, immuabilite textuelle des faits, reconstruction
integrale depuis le journal toutes les 8 regenerations.

*Test qui casse le build* : `packages/ai/tests/context-budget.test.ts` sur le corpus
« campagne longue » (≈ 2000 evenements), budget cible
**`min(14 000, capabilities.contextWindowTokens × 0,6)`** tokens d'entree par tour — 14 000 sur
une fenetre large, ≈ 4 900 sur un modele local a 8 192 (`02-mj-ia.md` §4.3).

### Invariant 3 — Le serveur est l'autorite

Le client n'envoie que des **intentions**. Aucune mutation d'etat de jeu ne vient du client.
Le seul message WebSocket mutant est `c2s.intent`.

*Garanti par* : aucun schema `c2s.*` ne reference `GameEvent`, `CampaignState` ni un champ de
jauge ; le client n'a pas le droit d'importer `decide`, `reduce`, `rollChallenge`,
`rollProgress` ; toute trame entrante passe par `zC2SEnvelope.safeParse` avant toute chose.

*Test qui casse le build* : `packages/contracts/tests/ws-protocol.test.ts`.

### Invariant 4 — Tout etat de partie est rejouable

On persiste un journal d'evenements **append-only**, pas seulement l'etat final. Les
projections et les instantanes sont des caches jetables. C'est ce qui donne le journal de
campagne, le debogage et l'annulation.

Depuis l'**ADR 0008**, chaque entree porte une **portee de visibilite** sur son enveloppe
(`scope: 'table' | 'subset' | 'private'`, plus `recipients` quand la portee n'est pas la table) :
rejouer le journal du point de vue d'un joueur doit redonner exactement ce qu'il a vu, ni plus
ni moins. C'est le serveur seul qui renseigne ces deux champs.

*Garanti par* : triggers SQLite `RAISE(ABORT)` sur `UPDATE`/`DELETE` de `events` ; trigger
`events_seq_dense` ; `decide()` tire les des, `reduce()` n'en tire jamais ; upcasters de
payload jamais supprimes.

*Tests qui cassent le build* : `pnpm db:check` controle 9 (dump → `db:rebuild` → dump →
comparaison octet a octet) et `packages/sim` `replay-equivalence`.

---

## 2. Vue d'ensemble

```
  Navigateur (SPA React)                    VPS — un conteneur, un process
  ┌────────────────────┐                    ┌──────────────────────────────────────────┐
  │ intentions         │  WS c2s.intent     │  Fastify                                 │
  │ rendu du journal   │ ─────────────────► │   ├─ auth Discord, sessions              │
  │ miroir d'etat      │ ◄───────────────── │   ├─ hub WebSocket                       │
  └────────────────────┘  WS s2c.event      │   └─ CampaignService                     │
                          WS s2c.narration_*│        │                                 │
                                            │        ▼                                 │
                                            │   @for/engine  decide() -> GameEvent[]   │
                                            │        │  (tire les des, tranche)        │
                                            │        ▼                                 │
                                            │   SQLite WAL : events (append-only)      │
                                            │        │  reduce() -> projections        │
                                            │        ▼                                 │
                                            │   diffusion  ──►  puis, HORS TRANSACTION │
                                            │   @for/ai : le conteur habille le fait   │
                                            └──────────────────────────────────────────┘
```

**L'ordre compte.** Le moteur tranche, le journal est ecrit et commite, l'evenement est diffuse.
La narration part **ensuite**, hors bande et hors transaction. Consequence des invariants 1 et
3 : modele indisponible, la partie avance quand meme, seul le texte est degrade. Aucun appel
reseau ne se produit jamais dans une transaction SQLite.

---

## 3. Stack

Verrouillee par le commanditaire ; raisonnement dans `docs/adr/0001-socle-technique.md`.

| Couche | Choix |
|---|---|
| Monorepo | pnpm 12 workspaces, Node 24, Turborepo, TypeScript strict, ESM partout |
| Front | Vite + React + TypeScript, SPA (pas de SSR), TanStack Query + Zustand |
| Back | Fastify + TypeScript, WebSocket pour la table live |
| Base | SQLite en mode WAL + Drizzle ORM, un fichier, zero ops. Colonnes JSON pour les blobs souples |
| Contenu de jeu | fichiers JSON versionnes dans `content/`, **jamais en base** |
| Auth | Discord OAuth 2 (PKCE), cookie de session `HttpOnly` |
| IA | Un **port**, pas un fournisseur : `NarratorPort` (`narrer()` en flux, `structurer()` en JSON valide), **cote serveur uniquement**. Trois adaptateurs — `anthropic`, `openai-compatible` (OpenRouter, Groq, Together), `ollama` (local) — plus un `stub` sans reseau. Choix par `NARRATOR_PROVIDER`. Details : `02-mj-ia.md` §0.1 a §0.6 |
| Deploiement | Docker Compose + Caddy sur un VPS, GitHub Actions → SSH |

---

## 4. Vocabulaire — decisions d'arbitrage

Les trois specs, ecrites en parallele, divergeaient. Ces arbitrages sont **deja appliques** dans
les trois fichiers ; les tableaux servent de memoire, pas de debat.

### 4.1 Nommage des entites

| Concept | Nom retenu | Rejete | Pourquoi |
|---|---|---|---|
| Entite de jeu persistante | `campaigns` / `campaign_id` / `CampaignState` | `tables` / `TableState` | « la table `tables` » est illisible en SQL ; « campagne » est le mot du cahier des charges |
| Ce que voit **un** joueur | `TableState` — **nom de DTO uniquement** | — | `TableState = project(CampaignState, viewerId)` : retire les lignes `visibility = 'gm'`. Vit dans `packages/contracts/src/dto/` |
| Identite Discord | `players` / `player_id` / `PlayerId` | `users` | `users` se confondrait avec l'administration |
| Session web (cookie) | `auth_sessions` | `sessions` | ambigu avec la seance de jeu |
| Seance de jeu (soiree) | `play_sessions` | — | |
| Participations / ACL | `campaign_members` | `members` | |
| Verrouillage de distribution | `campaign_champion_locks` | `reservations` | |
| Memoire longue | table `chronicles`, cle de modele `chronicle` | — | |
| Service d'orchestration | `CampaignService` | `TableService` | |
| Hub de sockets | `TableHub` | — | il regroupe les **joueurs connectes** ; « table » est ici le bon mot |

Le mot « table » survit exactement a deux endroits : l'interface francaise (« rejoindre la
table ») et le DTO `TableState`. Partout ailleurs, c'est `campaign`.

### 4.2 Valeurs de domaine : francais

Ce sont des **valeurs**, pas du code. Elles apparaissent telles quelles dans les colonnes SQL,
les payloads d'evenements, les schemas Zod et les JSON de contenu.

| Famille | Valeurs |
|---|---|
| Attributs | `vif`, `coeur`, `fer`, `ombre`, `esprit` |
| Jauges | `vigueur`, `ame`, `vivres` |
| Issues d'un jet | `franche`, `partielle`, `echec` |
| Retournement impose | `presage` (jamais `omen`, jamais `portent`) |
| Rangs | `genant`, `dangereux`, `redoutable`, `extreme`, `epique` |
| Vraisemblance d'oracle | `quasi-certain` (90), `probable` (75), `incertain` (50), `peu-probable` (25), `improbable` (10), sur d100 |

Tout le reste — noms de tables, de colonnes, de champs, de fonctions, de types, de fichiers, et
les identifiants de mouvement (`face-danger`, `probe-a-soul`, `swear-a-vow`) — est en anglais.

### 4.3 Contrats et frontieres

| Question | Decision |
|---|---|
| Ou vit le type canonique `GameEvent`, `CampaignState`, `EngineEffect` | Dans `@for/engine`. `@for/contracts` en est le **miroir Zod** (`satisfies z.ZodType<T>`), importe en `import type`. `GameEvent = z.infer<…>` creerait une dependance runtime `engine -> contracts` et tuerait la purete du moteur |
| Ou vivent **tous** les schemas Zod | Dans `@for/contracts`, contenu et E/S IA compris. `@for/content` et `@for/ai` les importent, ne les redeclarent jamais (sinon cycle) |
| Ou vivent les assertions de style de la narration | `packages/ai/src/assertions/` : test **et** post-filtre d'execution. Dans `@for/ai-eval`, elles creeraient un cycle `ai ↔ ai-eval` |
| Ou vivent persistance, jobs, verrous, diffusion IA | `@for/server`. `@for/ai` ne connait ni SQLite ni Fastify — c'est ce qui rend l'eval executable hors base |
| Ou vit le port du conteur | **Types** dans `@for/contracts` (`src/ai/narrator-port.ts`), **adaptateurs** dans `@for/ai` (`src/narrator/adapters/`), **config** dans `@for/server` (`src/env.ts`, seul endroit qui lit `process.env`). `@for/ai` ne lit jamais l'environnement ; un test de frontiere le verifie |
| Schema de fiche de champion | **Un seul** : `ChampionSchema`, en `camelCase`. La forge remplit `ForgeOutputSchema`, derive par `.omit()` ; elle n'a aucun privilege |
| Modele de chronique | **Un document unique versionne**, append-only, provenance par `event_seq`, faits textuellement immuables. Compaction hierarchique a trois couches abandonnee : des resumes de resumes, la derive meme que l'invariant 2 doit empecher |
| Protocole WebSocket | Un seul, celui de `01-architecture.md` §5 : enveloppe `{ v, t, id, ts, seq?, p }`, prefixes `c2s.` / `s2c.`, narration comprise |
| Gabarits de la narration de repli | Dans `content/fallbacks/narration.json`, passes en argument au moteur. **Aucune chaine francaise en dur dans `@for/engine`** |

### 4.4 Regles de jeu et de protocole

| Question | Decision |
|---|---|
| Ordre du tour | **Aucun.** La table est libre. Ecritures serialisees par campagne (une file par `campaign_id`). Code de refus : `move_in_progress`, jamais `not_your_turn` |
| Ce que borne le `single-flight` | La **narration**, pas le jeu : le moteur resout et diffuse pendant qu'un texte s'ecrit |
| Brulure du souffle | **Deux temps** — la regle veut qu'on voie les des avant de decider : `roll.action_resolved { burnWindow: true }` → intention `momentum.burn` → `character.momentum_burned` + `roll.action_revised` → **les effets de l'issue REVISEE** → `move.resolved`. Tant que la fenetre est ouverte, `decide()` n'emet **aucun** effet et **aucun** `move.resolved` : le tour reste ouvert. Trois fermetures, et trois seulement — `momentum.burn` (issue revisee), `momentum.keep` (issue initiale), ou le filet de securite, la premiere entree suivante du **meme personnage**, qui ferme comme `momentum.keep`. Le premier jet n'est jamais reecrit : on ajoute sa revision |
| Segments d'horloge | 4, 6, 8, 10 |
| Avance d'horloge proposee | 1 a 3 segments, bornee par l'issue (`franche` → 0, `partielle` → 1, `echec` → 2, +1 si presage) |
| Transition de scene proposee | **Un changement de LIEU, rien d'autre.** `propose_scene_transition` ne porte plus de `time_shift` : le temps ecoule et son cout eventuel decoulent du seul mouvement joue (ex. `endure-cold`), calcules par le moteur depuis sa table de mouvements. Aucune valeur de temps ne vient jamais du modele |
| Appels d'outils par tour | 3 au maximum, 3 iterations de boucle, puis `tool_choice: none` |
| Tables accessibles a `roll_oracle` | les oracles du contenu uniquement. « payer le prix » et « presages » sont **reserves au moteur** |
| Consequence de « payer le prix » | **Le moteur tire un d12 sur la table `pay-the-price`, applique l'entree tiree, ecrit `roll.price_paid`, puis la transmet au conteur comme un FAIT IMPOSE**, a integrer telle quelle dans la narration. Personne ne choisit, ni modele ni joueur : **ni outil de prix, ni `optionId`, ni `kind: 'price_choice'`, ni `playerChoices`** — ces quatre mecanismes sont supprimes de toutes les specs. La liste gelee de 12 outils (`02-mj-ia.md` §3.4) n'en contient aucun ; en ouvrir un exigerait un ADR plus une montee de `TOOLS_VERSION`. **Aucun `EngineEffect` ne transite jamais depuis le modele.** Plusieurs `suggestedEffects` sur l'entree tiree ⇒ c'est encore le moteur qui departage : **second tirage sur le flux RNG `price`**, index journalise dans `roll.price_paid.effectIndex`. Rejouable a l'identique (invariant 4), sans choix du modele ni du joueur |
| Portee du verrouillage de distribution | **Par campagne.** Un champion reserve est celui d'un autre joueur de la meme table. Pas de reservation inter-campagnes : cela fuiterait le roster des autres tables |
| Creation de personnage | **Meme** journal que la partie : c'est `character.created` qui pose le verrou |
| Deux compteurs a ne jamais confondre | `seq` = numero de journal (enveloppe, sur `s2c.event` seulement). `chunk` = numero de fragment d'un flux de narration (charge utile) |
| Faits de presence d'une scene | **Etat de scene structure** : evenement `scene.facts_updated` (source de verite, rejouable) **et** projection `scene_state` (cache de lecture). Ni projection seule — elle ne survivrait pas a un `db:rebuild` —, ni copie dans la chronique — deux memoires de la meme chose divergent. Injecte dans le prompt en **donnee d'autorite**, jamais en recit : le journal envoye en prose invitait le modele a le reinterpreter, et trois echanges suffisaient a faire reapparaitre quelqu'un qui etait parti (`02-mj-ia.md` §4.7) |
| Ce que le conteur rend apres sa prose | Un bloc balise `<scene_apres>` : etat de scene et refus eventuel. **Pas** un treizieme outil (`TOOLS_VERSION` ne bouge pas), **pas** une sortie structuree (elle casserait la diffusion en flux). Bloc absent ou malforme : rien ne casse, on garde les faits precedents |
| Droit de refus du conteur | **Sur la possibilite materielle seule.** Refus prouve ⇒ tour annule par `system.reverted` sur le groupe `correlation_id` complet ; refus non prouve ⇒ rejete sans effet. Une proposition absurde **mais possible** n'est jamais refusee : elle est jouee, sa consequence decoule des faits (`02-mj-ia.md` §4.8) |
| Trace d'un jet annule | **Toujours.** Journal append-only, les clients ont deja recu les `s2c.event` du jet, et sans trace l'abus du droit de refus serait invisible. L'index de tirage RNG n'est **jamais** libere : rejouer la meme intention ne redonne pas les memes des |
| Ce que le joueur voit d'un tour annule | **Affiche, marque ANNULE, preuve consultable** — il ne disparait jamais de l'ecran. Vecteur de marquage : le `s2c.event` du `system.reverted` ; le client barre les lignes visees par `targetSeqs` et affiche la cause (`gm_refusal:<cause>`). Effacer serait mentir sur ce qui s'est passe, et laisserait le joueur sans explication d'un aller-retour qu'il a vu (`02-mj-ia.md` §4.8.6) |
| Detail mecanique d'une scene | **Replie derriere la commande « Pourquoi ? », jamais affiche par defaut.** Mouvement joue, des, calcul, effets appliques, prix tire, presage : fiction propre, preuve consultable a tout moment. C'est une **projection du journal** (`TurnProofDto`), calculee a la demande sur le groupe `correlation_id` du tour, jamais fabriquee pour l'affichage ; elle voyage par `c2s.why` → `s2c.turn_proof`, bornee a 8 Kio (`01-architecture.md` §5.2 et §5.4) |
| Registre de la narration | Ancre nomme — la **saga islandaise** —, liste noire close, trois obligations, une **paire d'exemples bon/mauvais** dans le prompt systeme. Demander « un ton apre et concret » ne suffit pas : mesure par assertions, pas suppose (`02-mj-ia.md` §2.1, §8.4) |

### 4.5 Exploitation et outillage

| Question | Decision |
|---|---|
| Orchestrateur de taches | **Turborepo** (cache + ordonnancement) |
| `zod` dans le bundle client | Accepte. Sous-entree type-only seulement si le poids devient mesurablement genant |
| Seed de demo | **Un seul** : 248 evenements couvrant les 71 types. `--minimal` s'arrete a la fin de la premiere scene (≈ 40 evenements) pour demarrer en local. Deux seeds divergeraient en quinze jours |
| Cadence d'instantane | tous les 200 evenements, plus les jalons |
| Montee en charge | **Aucune.** SQLite WAL suppose un ecrivain unique ; le compose declare un seul replica, le runbook le dit noir sur blanc. Plusieurs instances exigeraient de changer de base |
| Litestream | **Pas en M0** (aucun joueur reel a proteger). Ecrit dans le runbook, active au premier joueur |
| Playwright E2E | **Pas en M0.** Le bout en bout de M0, c'est `@for/sim` : le vrai pipeline, sans navigateur. Playwright revient en M1 |
| `docker build` en CI | Non bloquant sur PR, bloquant en post-merge : la porte de PR vise moins de 8 minutes |
| Sondes de sante | `/healthz` liveness sans base, `/readyz` readiness, `/api/admin/health` pour le diagnostic profond. Un WAL volumineux ne doit jamais sortir le conteneur de la rotation |
| Nom du modele | Resolution unique : `campaigns.settings_json.models.<usage>` > `NARRATOR_MODEL` / `NARRATOR_MODEL_STRUCTURED` > defaut de l'adaptateur selectionne. `<usage>` vaut `narration` ou `structured`. **Aucune** table de modeles partagee : un identifiant de modele est une donnee d'adaptateur |
| Fournisseur du conteur | `NARRATOR_PROVIDER` ∈ `stub` \| `anthropic` \| `openai-compatible` \| `ollama`. **Seul** interrupteur de mode degrade : `AI_ENABLED` n'existe plus. **Le produit doit rester jouable sur un fournisseur gratuit ou un modele local** — raison d'etre du port, et ce qui a fait renverser le point P6 de la revue de socle (`M0-REVUE.md` §12) |
| Configuration du port | **Cinq variables de base** (`NARRATOR_PROVIDER`, `NARRATOR_BASE_URL`, `NARRATOR_API_KEY`, `NARRATOR_MODEL`, `NARRATOR_MODEL_STRUCTURED`) **et trois d'appoint validees** : `NARRATOR_TOOLS` (`on` \| `off` \| `probe`, defaut `probe`), `NARRATOR_TIMEOUT_MS` (defaut 60000), `NARRATOR_CONTEXT_WINDOW` (defaut de l'adaptateur). Les trois sont facultatives et propres a un adaptateur : le support des outils depend du **modele**, pas de la passerelle, et un modele local qui charge a froid depasse 60 s sans etre en panne. Tableau complet, defauts compris : `02-mj-ia.md` §0.6, repris a l'identique dans `01-architecture.md` §9.4 et `.env.example` |
| Capacite manquante chez un fournisseur | **On degrade la prose, jamais l'equite** (`02-mj-ia.md` §0.2). Pas d'outils ⇒ le conteur n'ajoute rien de durable ce tour-la ; pas de sortie structuree ⇒ prompt + extraction ; pas de cache ⇒ la facture monte. Aucun chemin de degradation ne rend une decision au modele |

---

## 5. Les paquets

Scope `@for/*`, tous prives, tous ESM. Six couches acycliques, verifiees par
`dependency-cruiser`.

| Couche | Paquet | Responsabilite | Deps runtime |
|---|---|---|---|
| 0 | `@for/engine` | Regles du jeu. **Feuille pure, zero dependance.** RNG et horloge injectes | **aucune** |
| 1 | `@for/contracts` | Tous les schemas Zod et les types de bord | `zod` |
| 2 | `@for/content` | Chargeur, registre typé, libelles. Les donnees sont dans `content/` a la racine | `@for/contracts` |
| 2 | `@for/testkit` | RNG scriptes, fixtures, runner de corpus dores, assertions de domaine | `@for/engine`, `@for/contracts` |
| 2 | `@for/db` | Drizzle, migrations, SQLite WAL, journal, projections | `drizzle-orm`, `better-sqlite3`, `@for/contracts` |
| 3 | `@for/scenario` | Construction guidee d'un scenario (ADR 0012) : les dix etapes, le port de decision, le melange sur le flux nomme `scenario`. **Pur** : ni reseau, ni disque, ni base | `@for/engine`, `@for/contracts`, `@for/content` |
| 3 | `@for/ai` | Port du conteur et ses adaptateurs, prompts, outils, contexte, assertions. **Sans persistance, sans jobs, sans lecture d'environnement** | `@anthropic-ai/sdk` (**optionnelle**, utilisee par le seul adaptateur `anthropic`), `@for/contracts`, `@for/content` |
| 4 | `@for/server` | Fastify, OAuth, hub WS, `CampaignService`, workers IA | tout ce qui precede |
| 4 | `@for/ai-eval` | Corpus, runners N0/N1/N2, graders, la **sonde de fumee** (`smoke/`, M0-32) et la **sonde de fournisseur** (`probe/`, M0-31) | `@for/ai`, `@for/contracts`, `@for/content`, `@for/testkit` |
| 5 | `@for/sim` | Simulateur de table headless, pilote le **vrai** service | `@for/server`, `@for/testkit`, `@for/db` |
| 5 | `@for/client` | SPA Vite + React | `react`, `@for/contracts`, `@for/engine` (affichage seul) |

**La purete de `@for/engine` est une erreur de compilation, pas une convention** : `tsconfig`
sans typage Node, `package.json` avec `"dependencies": {}`, lint interdisant `node:*`,
`Math.random`, `Date`, `process`, et un test gardien qui lit son propre `package.json` et scanne
son `dist/`.

Deux dependances a justifier :

- `@for/sim` → `@for/server`, **assume**. Un simulateur decouple ne prouverait rien sur
  l'orchestration reelle ; celui-ci pilote le vrai `CampaignService` via le vrai hub. Prix :
  sa sensibilite aux refactors du serveur. A rearbitrer seulement si la maintenance devient
  penible.
- `@for/ai-eval` → `@for/ai`, **jamais l'inverse** — d'ou les assertions dans `@for/ai`. Une
  exception, bornee et nommee : les **sept assertions ecrites a la main** de la sonde de fumee
  (`ai-eval/smoke/`, M0-32), qui doivent exister **avant** le corpus de production pour donner
  le signal precoce. Elles ne grandissent pas, personne ne les importe ; tout le reste de l'eval
  note avec les assertions de `@for/ai`.

---

## 6. Le chemin d'une intention (le seul)

Il n'existe **qu'un** chemin d'ecriture pour l'etat de partie. Toute PR qui en ouvre un second
doit etre refusee.

1. Le client envoie `c2s.intent { intent }`. L'`id` de l'enveloppe est la cle d'idempotence.
2. Le serveur valide l'enveloppe (Zod), insere dans `intents` (conflit sur `id` ⇒ renvoi du
   resultat deja calcule, sans relancer les des), puis autorise (ACL, statut du personnage).
3. `@for/engine.decide(state, intent, ctx)` : **tire les des, tranche l'issue**, produit des
   `GameEvent` et un `NarrationBrief`. Retourne un `Result`, jamais une exception.
4. Transaction courte : allocation de `seq` (`UPDATE campaigns SET seq = seq + n RETURNING`),
   insertion des `n` evenements, `reduce()` sur les projections, marquage de l'intention.
   **Aucun appel reseau ici.**
5. Diffusion des `s2c.event` a la table, dans l'ordre strict des `seq`, sans trou.
6. **Hors transaction**, hors bande : `narrer()` sur le port du conteur, avec le fait deja
   acquis. Texte diffuse en fragments, post-filtre, puis persiste en `narration.gm_message`.
7. Echec de l'etape 6 : `narration.gm_failed` et repli deterministe du moteur. L'etat de jeu
   est deja correct et durable. **Une panne de l'IA ne perd jamais une partie.**

Une proposition du modele (`propose_*`) ne devient un evenement qu'apres les etapes 2 a 4,
exactement comme une intention de joueur.

---

## 7. Ce qui doit exister a la fin de M0

M0 est un jalon de **fondations** : aucune feature de jeu. Il est termine quand, sur un poste
neuf :

1. `pnpm install && pnpm verify` passe en moins de 3 minutes ;
2. `pnpm db:reset && pnpm dev` ouvre une page « table » vide connectee au WebSocket, affichant
   `s2c.welcome`, le snapshot du seed et la presence — chaque scene portant une commande
   « Pourquoi ? » **repliee**, qui rend la preuve du tour sur demande (§4.4) ;
3. la connexion Discord fonctionne de bout en bout en local ;
4. `pnpm sim run` execute les 7 scenarios, verts, en moins de 20 s ;
5. `pnpm eval:offline` produit un rapport **sans cle d'API** ; `pnpm eval:smoke` rend un verdict
   lisible sur un fournisseur candidat, sans bloquer la CI : un verdict informe une decision, il
   ne ferme pas une porte ;
6. `pnpm db:check` passe les 12 oracles d'integrite (le controle 9, reconstruction idempotente,
   couvre `scene_state`, projection comme les autres) ;
7. la CI est verte sur une PR de demonstration et un `push` sur `main` deploie sur le VPS ;
8. **le critere qui justifie tout le reste** : modifier une constante de regle (par exemple le
   nombre de crans par jalon au rang *dangereux*) fait echouer, en local et en moins de
   30 secondes, au moins un test unitaire du moteur, un corpus dore et un scenario du
   simulateur.

---

## 8. Les trois specs de detail

| Fichier | Ce qu'il fait autorite |
|---|---|
| [`design/01-architecture.md`](design/01-architecture.md) | Structure du monorepo, arborescence fichier par fichier, signatures TypeScript du moteur, conventions, tsconfig / ESLint / Prettier, protocole WebSocket, surface HTTP, strategie de test, simulateur headless, CI, deploiement |
| [`design/02-mj-ia.md`](design/02-mj-ia.md) | Couche IA : **le port du conteur et ses trois adaptateurs**, prompts integraux, les 12 outils et leurs schemas, construction du contexte et cache, chronique et anti-derive, diffusion multi-joueurs, erreurs et replis, harnais d'eval, forge de fiches |
| [`design/03-donnees.md`](design/03-donnees.md) | DDL SQLite complet, catalogue des 71 types d'evenements, reducteur et rejeu, instantanes, RNG deterministe, migrations Drizzle, format du contenu versionne, seed de demo, `db:check`, sauvegarde et restauration |

Decisions de socle et leur raisonnement : [`adr/0001-socle-technique.md`](adr/0001-socle-technique.md).

---

## 9. Risques connus, assumes

Ils ne sont pas des taches : ce sont des choses a surveiller.

1. **Le miroir `engine ↔ contracts`** via `satisfies z.ZodType<T>` est strict. Avec Zod 4 et
   `exactOptionalPropertyTypes`, unions, tableaux `readonly` et proprietes optionnelles
   resistent. Prevoir une demi-journee de mise au point sur les premiers schemas.
2. **Le prompt du Conteur pese ≈ 2200 tokens** depuis `conteur/2.0.0`, franchement au-dessus du
   prefixe minimal exige par les fournisseurs qui cachent : le risque de chute silencieuse du
   cache a largement baisse. Mais son morceau le plus lourd — la **paire d'exemples bon/mauvais**
   — est le plus efficace, et le premier qu'une « simplification » bien intentionnee
   supprimerait. `prompt-size.test.ts` echoue sous 1900 tokens. Le seuil exact d'un fournisseur
   est un fait d'adaptateur (`02-mj-ia.md` §0.3) ; le risque, lui, est transverse.
3. **Aucun determinisme d'echantillonnage** chez les fournisseurs vises : evals en direct
   instables, notation par assertions et jamais par egalite de chaine. **Corollaire** : les
   capacites varient enormement d'un fournisseur a l'autre (appels d'outils, sortie structuree,
   cache, taille de fenetre). La spec repond par une matrice de degradation (`02-mj-ia.md` §0.2)
   et un test qui la couvre ; le risque residuel n'est pas technique mais editorial — **on ne
   saura qu'un fournisseur gratuit tient la table qu'apres l'avoir mesure**, objet de M0-31.
4. **La segmentation de phrases francaises** (« 3 a 5 phrases ») est la source la plus probable
   de faux echecs, donc de replis moteur injustifies visibles par les joueurs.
5. **La completude des alias de champions** est un chantier de contenu, pas de code. Un surnom
   manquant est un trou silencieux dans le verrouillage de distribution.
6. **La double ecriture** journal + projections dans la meme transaction. Une projection mutee
   hors du reducteur fait diverger la reconstruction **silencieusement**. Le controle 9 de
   `db:check` est seul a l'attraper : jamais desactive, meme temporairement.
7. **`better-sqlite3` est un module natif.** Le build alpine casse au moindre changement de
   version de Node. Repli decide d'avance : `node:24-bookworm-slim`.
8. **Le volume du journal** n'est pas borne. Les instantanes bornent le rejeu, pas la taille du
   fichier ni des sauvegardes. A mesurer sur la campagne de demo avant M2.
9. **Le buffer de narration vit en memoire du process.** Un deploiement en cours de generation
   perd le texte en vol ; le fait moteur est deja persiste, le jeu reste coherent. Acceptable en
   mono-process — et le mono-process est un invariant d'exploitation (§4.5).
10. **Partager les assertions entre eval et production** est un atout et un couplage : durcir
    une assertion pour la CI durcit immediatement le post-filtre en production.
