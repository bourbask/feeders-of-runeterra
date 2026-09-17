# 03 — Modèle de données et format du contenu

Statut : **prescriptif pour M0**. Ce document fait autorité sur le schéma SQLite, le
journal d'événements, les migrations, le format du contenu versionné, les fixtures et
l'exploitation du fichier de base.

Public visé : l'agent développeur qui implémente `packages/db`, `packages/content`,
`packages/contracts` et `apps/server` au jalon M0, puis celui qui prend une tâche au
jalon suivant et doit savoir en quelques secondes s'il a cassé quelque chose.

---

## 0. Principes

Rappel des quatre invariants, traduits en contraintes de données :

| Invariant | Conséquence sur les données |
|---|---|
| 1. Le moteur décide, l'IA raconte | Tout résultat de dé est un **fait persisté** (`roll.*`) écrit **avant** l'appel au modèle. Une sortie IA n'entre jamais en base autrement que comme `narration.*` (texte) ou `*.proposal` (proposition rejetable). |
| 2. La mémoire est dans la base | L'état structuré vit dans les projections, la mémoire narrative dans `chronicles` (compaction hiérarchique). La fenêtre de contexte est reconstruite à chaque appel, jamais accumulée. |
| 3. Le serveur est l'autorité | Le client écrit dans `intents` (intentions), jamais dans `events`. Aucune table d'état n'est exposée en écriture. |
| 4. Tout état de partie est rejouable | `events` est append-only (triggers `RAISE(ABORT)`), les projections et `snapshots` sont des **caches reconstructibles**. |

### 0.1 Conventions transverses

- **Identifiants** : `TEXT` contenant un **ULID** (26 caractères, Crockford base32).
  Triable chronologiquement, sûr en génération concurrente, lisible dans les logs.
  Jamais d'`INTEGER AUTOINCREMENT` sur les entités métier (fuite d'information et
  collisions au seed déterministe).
- **Horodatages** : `INTEGER NOT NULL` = **millisecondes epoch UTC**. Jamais de `TEXT`
  ISO en base (comparaisons et index moins bons), le formatage est un problème de vue.
- **Booléens** : `INTEGER NOT NULL CHECK (col IN (0,1))`.
- **Énumérations** : `TEXT` + `CHECK (col IN (...))`. Pas de table de référence : le
  jeu de valeurs vit dans les contrats Zod partagés, le `CHECK` est le filet de sécurité.
- **Colonnes JSON** : `TEXT` + `CHECK (json_valid(col))`, suffixées `_json`. Côté Drizzle :
  `text('x', { mode: 'json' }).$type<MonType>()`. Le type TS vient **toujours** d'un
  schéma Zod dans `packages/contracts` (`z.infer`), jamais d'une interface écrite à la main.
- **Nommage** : tables et colonnes en `snake_case` anglais, pluriel pour les tables.
  Les valeurs métier affichées à l'utilisateur sont en français ; les clés, jamais.
- **Suppression** : pas de `DELETE` sur les entités métier. `deleted_at`/`archived_at`.
  Les seules suppressions réelles sont la purge RGPD (§6.6) et le nettoyage des caches.
- **Clés étrangères** : `ON DELETE RESTRICT` par défaut. `CASCADE` uniquement sur les
  caches (`snapshots`, projections) et les sessions d'authentification.

### 0.2 PRAGMA d'ouverture (obligatoires, appliqués à chaque connexion)

```sql
PRAGMA journal_mode = WAL;        -- une fois, persistant dans le fichier
PRAGMA synchronous = NORMAL;      -- WAL + NORMAL = durable au crash process, suffisant ici
PRAGMA foreign_keys = ON;         -- NON persistant : à repasser sur CHAQUE connexion
PRAGMA busy_timeout = 5000;       -- 5 s d'attente sur verrou écrivain
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -32000;       -- 32 Mo de cache page
PRAGMA wal_autocheckpoint = 1000; -- ~4 Mo de WAL avant checkpoint
```

`foreign_keys` est la seule qui se rate silencieusement : le harnais de test contient
un cas doré qui vérifie qu'une FK invalide **lève** (`test/db/pragmas.test.ts`).

### 0.3 Écrivain unique

SQLite n'a qu'un écrivain. Toutes les écritures de partie passent par un **sérialiseur
par campagne** côté serveur (une file par `campaign_id`). Une transaction d'écriture
tient au plus quelques millisecondes : allocation de `seq`, insertion des événements,
mise à jour des projections. Aucun appel réseau (Claude, Discord) n'est fait à
l'intérieur d'une transaction — c'est une règle de revue.

### 0.4 Zones du schéma

| Zone | Tables | Source de vérité | Reconstructible ? |
|---|---|---|---|
| **A — Plateforme** | `players`, `auth_sessions`, `campaigns`, `campaign_members`, `play_sessions`, `content_packs`, `intents`, `ai_calls` | Les lignes elles-mêmes | Non — à sauvegarder |
| **B — Journal** | `events` | Append-only | Non — **c'est** la sauvegarde |
| **C — Caches** | `snapshots`, `characters`, `progress_tracks`, `clocks`, `entities`, `campaign_champion_locks` | `events` | **Oui**, `pnpm db:rebuild` |
| **D — Mémoire IA** | `chronicles`, `champion_sheets` | Produites par l'IA, validées serveur | Non (coût d'un ré-appel), mais non critiques |

La zone C est jetable : c'est le test le plus fort de l'invariant 4. La CI exécute
`pnpm db:rebuild --verify` sur la campagne de démo et compare octet à octet les
projections avant/après (§7.3).

Une duplication est **volontaire** : `campaign_members` (zone A, c'est le contrôle
d'accès, lu à chaque requête HTTP) et l'événement `party.member_joined` (zone B, c'est
l'histoire). L'ACL ne doit jamais dépendre d'un rejeu.

### 0.5 Réconciliation avec `01-architecture.md` et `02-mj-ia.md`

Les trois documents ont été écrits en parallèle et divergent sur quelques noms. Ce
tableau fait foi pour l'implémentation ; les points marqués **à trancher** doivent l'être
avant la première migration, parce qu'après, ce sont des renommages de colonnes.

| Concept | `01-architecture.md` | Ce document | Décision |
|---|---|---|---|
| L'entité de jeu persistante | `tables` / `table_id` / `TableState` | `campaigns` / `campaign_id` / `CampaignState` | **À trancher.** Recommandation : garder `campaigns` en base (c'est le mot du cahier des charges, et « la table `tables` » est illisible en SQL) et **`TableState` comme nom du DTO** envoyé au client, puisque « table » est le mot de l'interface. `TableState = project(CampaignState, viewerId)`. |
| Identité Discord | `users` | `players` | **À trancher.** Recommandation : `players` (mot du cahier des charges, et `users` se confondra avec l'admin). |
| Session web (cookie) | `sessions` | `auth_sessions` | `auth_sessions`. `sessions` seul est ambigu avec la séance de jeu. |
| Séance de jeu (soirée) | — | `play_sessions` | `play_sessions`. |
| Participations | `members` | `campaign_members` | Alignement sur le nom de l'entité retenue. |
| Verrouillage de distribution | `reservations` | `campaign_champion_locks` | Peu importe ; c'est la table qui répond à l'outil `check_name_allowed` de `02-mj-ia.md`. |
| Compaction de mémoire | `chronicle` (module, clé de modèle) | `chronicles` (table) | Table au pluriel, clé de modèle `chronicle`. Corrigé ci-dessous. |
| Cadence d'instantané | tous les 200 événements | 250 | **200**, aligné sur `01`. Corrigé ci-dessous. |
| Renvoi de fichier | `01` cite `docs/design/02-data-model.md` | ce fichier est `03-donnees.md` | Corriger le renvoi dans `01`. |

Rattachements à `02-mj-ia.md` (couche IA), sans ambiguïté :

| Outil du modèle | Ce qu'il lit en base | Écrit-il ? |
|---|---|---|
| `get_state` | `CampaignState` chargé (§3.5), projeté et filtré par visibilité | non |
| `get_lore` | `ContentBundle` (fichiers JSON, §4) + `entities` | non |
| `get_chronicle` | `chronicles` où `superseded_by IS NULL`, `scope` = la « section » demandée | non |
| `check_name_allowed` | `campaign_champion_locks` | non |
| `roll_oracle` | tire via le moteur, écrit **un** `roll.oracle_resolved` / `roll.yes_no_resolved` | oui, journal seul |
| `propose_npc_introduce` | — | via validation serveur → `entity.introduced` |
| `propose_clock_create` / `propose_clock_advance` | `clocks` | via validation serveur → `clock.created` / `clock.advanced` |
| `propose_thread_open` | — | via validation serveur → `entity.introduced` (`kind: 'thread'`) |
| `propose_lore_fact` | — | via validation serveur → `entity.updated` |

`chronicle_version`, renvoyé par `get_chronicle`, vaut
`SELECT count(*) FROM chronicles WHERE campaign_id = ?` : monotone, trivial à calculer,
suffisant pour que le modèle détecte qu'il lit une mémoire plus fraîche qu'à son appel
précédent.

Toute proposition `propose_*` produit, dans **tous** les cas, un
`narration.proposal_accepted` ou `narration.proposal_rejected` dans le journal. Une
proposition qui disparaît sans trace est un bug.

---

---

## 1. Schéma SQLite — DDL complet

Le DDL ci-dessous est la référence. Les fichiers Drizzle (`packages/db/src/schema/*.ts`)
doivent produire **exactement** ce SQL ; la CI le vérifie en comparant le dump
`sqlite3 db .schema` normalisé au fichier `packages/db/schema.expected.sql` (§5.4).

### 1.1 Plateforme et identité

```sql
-- ---------------------------------------------------------------- players
-- Identité Discord. Un joueur = un compte Discord. Pas de mot de passe, jamais.
CREATE TABLE players (
  id                  TEXT    PRIMARY KEY,               -- ULID
  discord_user_id     TEXT    NOT NULL,                  -- snowflake, immuable
  discord_username    TEXT    NOT NULL,                  -- "kevin", peut changer
  discord_global_name TEXT,                              -- nom d'affichage, peut être NULL
  discord_avatar_hash TEXT,                              -- pour construire l'URL du CDN
  discord_email       TEXT,                              -- scope 'email', NULL si non accordé
  locale              TEXT    NOT NULL DEFAULT 'fr',
  is_admin            INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  last_seen_at        INTEGER,
  deleted_at          INTEGER                             -- anonymisation RGPD
);
CREATE UNIQUE INDEX players_discord_user_id_uq ON players (discord_user_id);
CREATE INDEX players_last_seen_idx ON players (last_seen_at DESC);

-- ---------------------------------------------------- auth_sessions
-- Session web (cookie). Le cookie contient un secret aléatoire de 32 octets ;
-- la base ne stocke que son SHA-256. Une fuite de la base ne donne aucune session.
CREATE TABLE auth_sessions (
  id              TEXT    PRIMARY KEY,                    -- sha256(secret) en hex
  player_id       TEXT    NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  revoked_at      INTEGER,
  user_agent      TEXT,
  ip_hash         TEXT                                    -- sha256(ip + pepper), diagnostic
);
CREATE INDEX auth_sessions_player_idx  ON auth_sessions (player_id, expires_at DESC);
CREATE INDEX auth_sessions_expiry_idx  ON auth_sessions (expires_at);

-- --------------------------------------------------- oauth_states
-- Anti-CSRF du flux OAuth Discord. Lignes éphémères (TTL 10 min), purgées par tâche.
CREATE TABLE oauth_states (
  state         TEXT    PRIMARY KEY,                      -- aléatoire 32 octets, base64url
  code_verifier TEXT    NOT NULL,                         -- PKCE
  redirect_to   TEXT,                                     -- chemin interne validé côté serveur
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX oauth_states_expiry_idx ON oauth_states (expires_at);
```

### 1.2 Campagnes et participations

```sql
-- --------------------------------------------------------------- campaigns
CREATE TABLE campaigns (
  id                    TEXT    PRIMARY KEY,
  slug                  TEXT    NOT NULL,                 -- URL : /c/le-pacte-de-la-griffe
  name                  TEXT    NOT NULL,
  pitch                 TEXT    NOT NULL DEFAULT '',
  owner_player_id       TEXT    NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  status                TEXT    NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','active','paused','archived')),

  -- Reproductibilité : une campagne est figée sur une version de contenu et de règles.
  content_pack_version  TEXT    NOT NULL,                 -- semver, ex. '1.4.0'
  content_pack_hash     TEXT    NOT NULL,                 -- sha256 du bundle normalisé
  rules_version         INTEGER NOT NULL,                 -- version du moteur de règles
  reducer_version       INTEGER NOT NULL,                 -- version du réducteur d'événements

  -- RNG déterministe : seed maître de la campagne. Chaque tirage dérive
  -- une graine de (rng_seed, event_seq, stream) — cf. §3.6.
  rng_seed              TEXT    NOT NULL,                 -- 32 octets hex

  -- Compteur de séquence du journal. Seule colonne mutée à chaud en zone A.
  seq                   INTEGER NOT NULL DEFAULT 0,

  settings_json         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  truths_json           TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(truths_json)),

  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  archived_at           INTEGER
);
CREATE UNIQUE INDEX campaigns_slug_uq   ON campaigns (slug);
CREATE INDEX campaigns_owner_idx        ON campaigns (owner_player_id);
CREATE INDEX campaigns_status_idx       ON campaigns (status, updated_at DESC);
```

**Pourquoi `settings_json` et `truths_json` sont du JSON.** Ce sont des blobs
lus en entier, jamais filtrés en SQL, dont la forme bouge à chaque itération de design
(`CampaignSettings` : modèles IA par usage, lignes et voiles de sécurité, pondération
des oracles, difficulté, verbosité du MJ ; `CampaignTruths` : les vérités du Freljord
choisies à la création). Les normaliser coûterait cinq tables et zéro requête utile.
Ils sont validés par Zod à l'écriture **et** à la lecture (§4.7).

`seq` est volontairement sur `campaigns` et pas dérivé de `MAX(events.seq)` : l'allocation
se fait en un seul `UPDATE ... RETURNING` (§3.2), ce qui sérialise proprement sans
scan d'index et sans course entre deux écrivains.

```sql
-- -------------------------------------------------------- campaign_members
-- Participation à une table. C'est l'ACL : lue à chaque requête, jamais reconstruite.
CREATE TABLE campaign_members (
  id            TEXT    PRIMARY KEY,
  campaign_id   TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  player_id     TEXT    NOT NULL REFERENCES players(id)   ON DELETE RESTRICT,
  role          TEXT    NOT NULL DEFAULT 'player'
                  CHECK (role IN ('owner','player','spectator')),
  character_id  TEXT,                                     -- FK logique vers characters, cf. note
  invited_by    TEXT    REFERENCES players(id) ON DELETE SET NULL,
  joined_at     INTEGER NOT NULL,
  left_at       INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX campaign_members_uq        ON campaign_members (campaign_id, player_id);
CREATE INDEX campaign_members_player_idx       ON campaign_members (player_id, left_at);
CREATE INDEX campaign_members_campaign_idx     ON campaign_members (campaign_id, left_at);
```

`character_id` n'a **pas** de contrainte FK SQL : `characters` est un cache (zone C) que
`db:rebuild` tronque et reconstruit ; une FK dure empêcherait la reconstruction. L'intégrité
est vérifiée par le contrôle `pnpm db:check` (§7.3).

```sql
-- ---------------------------------------------------------- play_sessions
-- Une SÉANCE de jeu (soirée). À ne pas confondre avec auth_sessions.
CREATE TABLE play_sessions (
  id                  TEXT    PRIMARY KEY,
  campaign_id         TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  ordinal             INTEGER NOT NULL,                   -- 1, 2, 3... lisible
  title               TEXT,
  status              TEXT    NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','live','ended')),
  discord_channel_id  TEXT,                               -- le vocal reste sur Discord
  scheduled_for       INTEGER,
  started_at          INTEGER,
  ended_at            INTEGER,
  first_event_seq     INTEGER,                            -- borne du journal, NULL tant que vide
  last_event_seq      INTEGER,
  recap_chronicle_id  TEXT,                               -- FK logique vers chronicles
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE UNIQUE INDEX play_sessions_ordinal_uq ON play_sessions (campaign_id, ordinal);
CREATE INDEX play_sessions_campaign_idx      ON play_sessions (campaign_id, started_at DESC);
CREATE INDEX play_sessions_live_idx          ON play_sessions (status) WHERE status = 'live';
```

### 1.3 Le journal d'événements

```sql
-- ------------------------------------------------------------------ events
-- APPEND-ONLY. Source de vérité de tout état de partie (invariant 4).
CREATE TABLE events (
  id                  TEXT    PRIMARY KEY,                -- ULID
  campaign_id         TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  seq                 INTEGER NOT NULL,                   -- 1..N, dense, par campagne
  play_session_id     TEXT,                               -- FK logique (séance en cours)

  type                TEXT    NOT NULL,                   -- 'roll.action_resolved', cf. §3.4
  payload_version     INTEGER NOT NULL DEFAULT 1,         -- version du schéma de payload
  payload_json        TEXT    NOT NULL CHECK (json_valid(payload_json)),

  -- Qui a provoqué cet événement.
  actor_kind          TEXT    NOT NULL
                        CHECK (actor_kind IN ('player','engine','gm_ai','system')),
  actor_player_id     TEXT    REFERENCES players(id) ON DELETE SET NULL,
  subject_character_id TEXT,                              -- FK logique, sujet principal

  -- Traçabilité causale : indispensable au débogage et au journal de campagne.
  correlation_id      TEXT,                               -- id de l'intention à l'origine
  causation_id        TEXT,                               -- id de l'événement parent direct

  -- Déterminisme du RNG : tout événement issu d'un tirage porte sa dérivation.
  rng_stream          TEXT,                               -- 'action','challenge','oracle','price'
  rng_draw_index      INTEGER,                            -- n-ième tirage de ce flux

  created_at          INTEGER NOT NULL,

  CONSTRAINT events_seq_positive CHECK (seq > 0)
);
CREATE UNIQUE INDEX events_campaign_seq_uq  ON events (campaign_id, seq);
CREATE INDEX events_campaign_type_idx       ON events (campaign_id, type, seq);
CREATE INDEX events_session_idx             ON events (play_session_id, seq);
CREATE INDEX events_correlation_idx         ON events (correlation_id);
CREATE INDEX events_subject_idx             ON events (campaign_id, subject_character_id, seq);
CREATE INDEX events_created_idx             ON events (created_at);

-- Append-only, matérialisé. Ce n'est pas de la discipline, c'est une contrainte.
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only: use a compensating event'); END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only: use system.reverted or the purge script'); END;

-- Densité de la séquence : seq doit valoir exactement campaigns.seq au moment de l'insert.
CREATE TRIGGER events_seq_dense BEFORE INSERT ON events
WHEN NEW.seq <> (SELECT seq FROM campaigns WHERE id = NEW.campaign_id)
BEGIN SELECT RAISE(ABORT, 'events.seq must be allocated via campaigns.seq'); END;
```

Le trigger `events_seq_dense` est le garde-fou de l'invariant 4 : si un jour quelqu'un
insère un événement sans passer par l'allocateur, le rejeu produirait un trou silencieux.
Ici il échoue immédiatement, en test comme en production.

`payload_json` est du JSON **par construction** : c'est une union discriminée d'environ
soixante-dix formes différentes (§3.4). Une table par type serait ingérable ; des colonnes
communes seraient à 90 % nulles. Le typage réel est assuré par `packages/contracts`
(`GameEventSchema`, discriminé sur `type`), appliqué à l'écriture et à la lecture.

**Indexer un champ de payload, si un jour c'est nécessaire** : colonne générée, jamais de
`LIKE` sur le JSON.

```sql
-- Exemple (à n'ajouter que sur besoin mesuré) :
-- ALTER TABLE events ADD COLUMN track_id TEXT
--   GENERATED ALWAYS AS (payload_json ->> '$.trackId') VIRTUAL;
-- CREATE INDEX events_track_idx ON events (campaign_id, track_id, seq)
--   WHERE track_id IS NOT NULL;
```

### 1.4 Instantanés et projections (caches reconstructibles)

```sql
-- --------------------------------------------------------------- snapshots
-- État complet du moteur à la fin de l'événement `seq`. Cache pur.
CREATE TABLE snapshots (
  id              TEXT    PRIMARY KEY,
  campaign_id     TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,                       -- état APRÈS application de seq
  reducer_version INTEGER NOT NULL,
  state_json      TEXT    NOT NULL CHECK (json_valid(state_json)),
  state_hash      TEXT    NOT NULL,                       -- sha256 du JSON canonique
  size_bytes      INTEGER NOT NULL,
  kind            TEXT    NOT NULL DEFAULT 'rolling'
                    CHECK (kind IN ('rolling','milestone','session_end')),
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX snapshots_uq       ON snapshots (campaign_id, reducer_version, seq);
CREATE INDEX snapshots_lookup_idx      ON snapshots (campaign_id, reducer_version, seq DESC);

-- ------------------------------------------------------------- characters
-- PROJECTION. Reconstruite par le réducteur. Jamais mutée hors réducteur.
CREATE TABLE characters (
  id                TEXT    PRIMARY KEY,
  campaign_id       TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_id         TEXT    NOT NULL,                     -- FK logique (cache)
  champion_id       TEXT    NOT NULL,                     -- id de contenu, ex. 'braum'
  display_name      TEXT    NOT NULL,

  sheet_source      TEXT    NOT NULL CHECK (sheet_source IN ('handwritten','forged')),
  sheet_ref         TEXT    NOT NULL,                     -- 'content:champions/braum@1.4.0'
                                                          -- ou 'forged:<champion_sheets.id>'
  -- Fiche GELÉE à la création. Une mise à jour du contenu ne doit jamais
  -- modifier rétroactivement un personnage en cours de campagne.
  sheet_snapshot_json TEXT  NOT NULL CHECK (json_valid(sheet_snapshot_json)),

  -- Attributs : colonnes, pas JSON. Contraints, comparables, agrégeables.
  attr_vif          INTEGER NOT NULL CHECK (attr_vif   BETWEEN 1 AND 3),
  attr_coeur        INTEGER NOT NULL CHECK (attr_coeur BETWEEN 1 AND 3),
  attr_fer          INTEGER NOT NULL CHECK (attr_fer   BETWEEN 1 AND 3),
  attr_ombre        INTEGER NOT NULL CHECK (attr_ombre BETWEEN 1 AND 3),
  attr_esprit       INTEGER NOT NULL CHECK (attr_esprit BETWEEN 1 AND 3),

  -- Jauges 0-5.
  vigor             INTEGER NOT NULL DEFAULT 5 CHECK (vigor    BETWEEN 0 AND 5),
  soul              INTEGER NOT NULL DEFAULT 5 CHECK (soul     BETWEEN 0 AND 5),
  supplies          INTEGER NOT NULL DEFAULT 5 CHECK (supplies BETWEEN 0 AND 5),

  -- Souffle (momentum) -6..+10, départ +2.
  momentum          INTEGER NOT NULL DEFAULT 2  CHECK (momentum BETWEEN -6 AND 10),
  momentum_max      INTEGER NOT NULL DEFAULT 10 CHECK (momentum_max BETWEEN 0 AND 10),
  momentum_reset    INTEGER NOT NULL DEFAULT 2  CHECK (momentum_reset BETWEEN 0 AND 2),

  xp_earned         INTEGER NOT NULL DEFAULT 0 CHECK (xp_earned >= 0),
  xp_spent          INTEGER NOT NULL DEFAULT 0 CHECK (xp_spent >= 0),

  conditions_json   TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(conditions_json)),
  assets_json       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(assets_json)),
  bonds_json        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(bonds_json)),
  notes_json        TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(notes_json)),

  status            TEXT    NOT NULL DEFAULT 'active'
                      CHECK (status IN ('draft','active','retired','dead')),
  portrait_url      TEXT,

  created_seq       INTEGER NOT NULL,
  updated_seq       INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,

  CONSTRAINT characters_xp_coherent CHECK (xp_spent <= xp_earned),
  CONSTRAINT characters_momentum_reset_le_max CHECK (momentum_reset <= momentum_max)
);
-- Verrouillage de distribution : un champion ne peut être joué que par un seul PJ
-- vivant dans une campagne donnée.
CREATE UNIQUE INDEX characters_champion_uq ON characters (campaign_id, champion_id)
  WHERE status IN ('draft','active');
-- Un joueur n'a qu'un personnage actif par campagne.
CREATE UNIQUE INDEX characters_active_player_uq ON characters (campaign_id, player_id)
  WHERE status IN ('draft','active');
CREATE INDEX characters_campaign_idx ON characters (campaign_id, status);
```

**Pourquoi les attributs et les jauges sont des colonnes** et pas un blob JSON : ce sont
cinq et trois valeurs, bornées, stables depuis le prototypage, lues à chaque jet. Les
`CHECK` valent ici une seconde ligne de défense contre un bug de réducteur qui sortirait
une jauge de ses bornes — la transaction échoue, le bug est visible au lieu d'être écrit.
Inversement `conditions_json`, `assets_json` et `bonds_json` sont des listes de taille
variable, dont la forme évolue (un atout a des rangs, des options, du texte), qu'on ne
requête jamais en SQL.

```sql
-- --------------------------------------------------------- progress_tracks
-- PROJECTION. Serments, affrontements, périples : même mécanique de jauge.
CREATE TABLE progress_tracks (
  id             TEXT    PRIMARY KEY,
  campaign_id    TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind           TEXT    NOT NULL
                   CHECK (kind IN ('vow','combat','journey','scene_challenge','bond')),
  rank           TEXT    NOT NULL
                   CHECK (rank IN ('genant','dangereux','redoutable','extreme','epique')),
  title          TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  owner_character_id TEXT,                                -- NULL = jauge de groupe
  ticks          INTEGER NOT NULL DEFAULT 0 CHECK (ticks BETWEEN 0 AND 40),
  status         TEXT    NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','fulfilled','forsaken','failed','abandoned')),
  visibility     TEXT    NOT NULL DEFAULT 'public'
                   CHECK (visibility IN ('public','gm')),
  tags_json      TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  created_seq    INTEGER NOT NULL,
  updated_seq    INTEGER NOT NULL,
  resolved_seq   INTEGER
);
CREATE INDEX progress_tracks_campaign_idx ON progress_tracks (campaign_id, status, kind);
CREATE INDEX progress_tracks_owner_idx    ON progress_tracks (owner_character_id, status);

-- ------------------------------------------------------------------ clocks
-- PROJECTION. Horloges de menace (le danger qui monte hors-champ).
CREATE TABLE clocks (
  id           TEXT    PRIMARY KEY,
  campaign_id  TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  segments     INTEGER NOT NULL CHECK (segments IN (4,6,8,10,12)),
  filled       INTEGER NOT NULL DEFAULT 0 CHECK (filled >= 0),
  status       TEXT    NOT NULL DEFAULT 'ticking'
                 CHECK (status IN ('ticking','filled','resolved','cancelled')),
  visibility   TEXT    NOT NULL DEFAULT 'public'
                 CHECK (visibility IN ('public','gm')),
  consequence  TEXT    NOT NULL DEFAULT '',               -- ce qui se passe à saturation
  created_seq  INTEGER NOT NULL,
  updated_seq  INTEGER NOT NULL,
  CONSTRAINT clocks_filled_le_segments CHECK (filled <= segments)
);
CREATE INDEX clocks_campaign_idx ON clocks (campaign_id, status);

-- ---------------------------------------------------------------- entities
-- PROJECTION. Le "qui / quoi / où" de la campagne : la mémoire structurée que
-- l'outil get_lore interroge, par opposition à la chronique qui est du texte.
CREATE TABLE entities (
  id             TEXT    PRIMARY KEY,
  campaign_id    TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind           TEXT    NOT NULL
                   CHECK (kind IN ('npc','place','faction','item','beast','thread','omen')),
  slug           TEXT    NOT NULL,                        -- 'olaf-le-borgne'
  name           TEXT    NOT NULL,
  summary        TEXT    NOT NULL DEFAULT '',             -- 1-2 phrases, injecté au prompt
  details_json   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  champion_id    TEXT,                                    -- si ce PNJ est un champion
  region_id      TEXT,
  status         TEXT    NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','dormant','dead','destroyed','resolved')),
  disposition    TEXT    CHECK (disposition IN ('allie','neutre','hostile','inconnu')),
  first_seen_seq INTEGER NOT NULL,
  last_seen_seq  INTEGER NOT NULL
);
CREATE UNIQUE INDEX entities_slug_uq     ON entities (campaign_id, slug);
CREATE INDEX entities_kind_idx           ON entities (campaign_id, kind, status);
CREATE INDEX entities_recent_idx         ON entities (campaign_id, last_seen_seq DESC);

-- ------------------------------------------- campaign_champion_locks
-- PROJECTION. Verrouillage de distribution : le MJ IA ne doit JAMAIS faire
-- apparaître un champion réservé (c'est le PJ d'un autre joueur).
CREATE TABLE campaign_champion_locks (
  campaign_id  TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  champion_id  TEXT    NOT NULL,
  lock_kind    TEXT    NOT NULL
                 CHECK (lock_kind IN ('reserved_pc','allowed_npc','banned')),
  reason       TEXT    NOT NULL DEFAULT '',
  set_seq      INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, champion_id)
) WITHOUT ROWID;
CREATE INDEX champion_locks_kind_idx ON campaign_champion_locks (campaign_id, lock_kind);
```

`campaign_champion_locks` est une table minuscule mais c'est elle qui alimente à la fois
le prompt système (liste d'interdits), la validation des propositions IA (un
`entity.introduced` sur un champion `reserved_pc` est **rejeté** par le serveur) et
l'écran de choix de personnage. `WITHOUT ROWID` car la clé primaire composite est la
seule voie d'accès.

### 1.5 Mémoire IA

```sql
-- -------------------------------------------------------------- chronicles
-- Mémoire narrative compactée (invariant 2). Compaction HIÉRARCHIQUE :
--   layer 0 = résumé de scène    (~150 mots, couvre ~20-60 événements)
--   layer 1 = résumé de chapitre (~300 mots, couvre ~8-15 entrées de layer 0)
--   layer 2 = saga de campagne   (~600 mots, couvre tout le layer 1)
-- Le prompt reçoit : layer 2 (toujours) + les 3 derniers layer 1 + les 5 derniers
-- layer 0 + le tail brut d'événements depuis la dernière compaction.
CREATE TABLE chronicles (
  id              TEXT    PRIMARY KEY,
  campaign_id     TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  layer           INTEGER NOT NULL CHECK (layer IN (0,1,2)),
  scope           TEXT    NOT NULL DEFAULT 'campaign'
                    CHECK (scope IN ('campaign','session','character','thread')),
  scope_ref       TEXT,                                   -- id du personnage / du fil
  covers_from_seq INTEGER NOT NULL,
  covers_to_seq   INTEGER NOT NULL,
  title           TEXT    NOT NULL DEFAULT '',
  text_md         TEXT    NOT NULL,                       -- français, markdown léger
  facts_json      TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(facts_json)),
  tokens_estimate INTEGER NOT NULL DEFAULT 0,
  model           TEXT    NOT NULL,                       -- 'claude-opus-5'
  prompt_version  TEXT    NOT NULL,
  ai_call_id      TEXT,
  superseded_by   TEXT    REFERENCES chronicles(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  CONSTRAINT chronicles_range CHECK (covers_to_seq >= covers_from_seq)
);
CREATE INDEX chronicles_live_idx ON chronicles (campaign_id, layer, covers_to_seq DESC)
  WHERE superseded_by IS NULL;
CREATE INDEX chronicles_scope_idx ON chronicles (campaign_id, scope, scope_ref);
```

Une chronique n'est jamais mise à jour en place : une recompaction insère une nouvelle
ligne et pose `superseded_by` sur l'ancienne. On garde ainsi l'historique de ce que le
MJ « croyait savoir » à chaque instant — c'est ce qui permet de déboguer une dérive de
continuité trois mois plus tard.

`facts_json` contient les faits atomiques extraits par le modèle et **validés** contre
`entities` (un fait qui référence une entité inexistante est écarté au moment de la
compaction, pas au moment de la lecture).

```sql
-- --------------------------------------------------------- champion_sheets
-- Fiches FORGÉES par l'IA pour les ~150 champions non écrits à la main.
-- Validées par le serveur contre ChampionSchema (§4.2) avant insertion.
CREATE TABLE champion_sheets (
  id                TEXT    PRIMARY KEY,
  champion_id       TEXT    NOT NULL,                     -- slug canonique, ex. 'lissandra'
  campaign_id       TEXT    REFERENCES campaigns(id) ON DELETE SET NULL, -- NULL = cache global
  schema_version    INTEGER NOT NULL,
  sheet_json        TEXT    NOT NULL CHECK (json_valid(sheet_json)),
  content_hash      TEXT    NOT NULL,                     -- sha256 du JSON canonique
  status            TEXT    NOT NULL DEFAULT 'pending_review'
                      CHECK (status IN ('pending_review','approved','rejected','superseded')),
  forged_by_player_id TEXT  REFERENCES players(id) ON DELETE SET NULL,
  model             TEXT    NOT NULL,                     -- 'claude-opus-5'
  prompt_version    TEXT    NOT NULL,
  ai_call_id        TEXT,
  review_notes      TEXT,
  created_at        INTEGER NOT NULL,
  reviewed_at       INTEGER
);
CREATE UNIQUE INDEX champion_sheets_hash_uq ON champion_sheets (champion_id, content_hash);
CREATE INDEX champion_sheets_lookup_idx     ON champion_sheets (champion_id, status);

-- ----------------------------------------------------------------- ai_calls
-- Audit de TOUS les appels au modèle. Alimente le harnais d'éval (M0) et la
-- facture. Aucun appel IA ne part sans une ligne ici.
CREATE TABLE ai_calls (
  id                 TEXT    PRIMARY KEY,
  campaign_id        TEXT    REFERENCES campaigns(id) ON DELETE SET NULL,
  purpose            TEXT    NOT NULL
                       CHECK (purpose IN ('narration','forge','chronicle','oracle_flavor','eval')),
  model              TEXT    NOT NULL,
  prompt_version     TEXT    NOT NULL,
  system_hash        TEXT    NOT NULL,                    -- sha256 du prompt système rendu
  request_json       TEXT    CHECK (request_json IS NULL OR json_valid(request_json)),
  response_text      TEXT,
  tool_calls_json    TEXT    CHECK (tool_calls_json IS NULL OR json_valid(tool_calls_json)),
  stop_reason        TEXT,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms         INTEGER NOT NULL DEFAULT 0,
  status             TEXT    NOT NULL
                       CHECK (status IN ('ok','refused','invalid_output','error','timeout')),
  error_text         TEXT,
  resulting_event_seq INTEGER,
  eval_tags_json     TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(eval_tags_json)),
  created_at         INTEGER NOT NULL
);
CREATE INDEX ai_calls_campaign_idx ON ai_calls (campaign_id, created_at DESC);
CREATE INDEX ai_calls_purpose_idx  ON ai_calls (purpose, status, created_at DESC);
```

### 1.6 Intentions et idempotence

```sql
-- ----------------------------------------------------------------- intents
-- Invariant 3 : le client n'écrit QUE ça. Une intention est une demande, pas
-- une mutation. Le serveur la valide, la refuse ou la transforme en événements.
CREATE TABLE intents (
  id              TEXT    PRIMARY KEY,                    -- UUID généré par le CLIENT
  campaign_id     TEXT    NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  player_id       TEXT    NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  character_id    TEXT,
  type            TEXT    NOT NULL,                       -- 'move.strike', 'chat.say', ...
  payload_json    TEXT    NOT NULL CHECK (json_valid(payload_json)),
  status          TEXT    NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received','applied','rejected','superseded')),
  rejection_code  TEXT,                                   -- 'not_your_turn', 'gauge_locked', ...
  rejection_detail TEXT,
  first_event_seq INTEGER,
  last_event_seq  INTEGER,
  received_at     INTEGER NOT NULL,
  settled_at      INTEGER
);
CREATE INDEX intents_campaign_idx ON intents (campaign_id, received_at DESC);
CREATE INDEX intents_player_idx   ON intents (player_id, received_at DESC);
```

La clé primaire est l'UUID **client**. Une reconnexion WebSocket qui rejoue une intention
non acquittée retombe sur un `INSERT` en conflit : le serveur renvoie le résultat déjà
calculé au lieu de relancer les dés. C'est l'idempotence de bout en bout, et c'est la
seule protection sérieuse contre le double-jet sur réseau instable.

```sql
-- ----------------------------------------------------------- content_packs
-- Trace de chaque bundle de contenu chargé. Permet de répondre à
-- « avec quelle version de la table des prix ce jet a-t-il été fait ? ».
CREATE TABLE content_packs (
  hash          TEXT    PRIMARY KEY,                      -- sha256 du bundle normalisé
  version       TEXT    NOT NULL,                         -- semver de content/manifest.json
  file_count    INTEGER NOT NULL,
  manifest_json TEXT    NOT NULL CHECK (json_valid(manifest_json)),
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX content_packs_version_idx ON content_packs (version, first_seen_at DESC);

-- -------------------------------------------------------- schema_migrations
-- Géré par drizzle-kit (__drizzle_migrations). Rappelé ici pour mémoire : ne
-- jamais l'éditer à la main, cf. §5.
```

### 1.7 Récapitulatif des colonnes JSON

| Table.colonne | Contenu | Pourquoi JSON |
|---|---|---|
| `campaigns.settings_json` | `CampaignSettings` | Blob de config, lu en entier, forme instable |
| `campaigns.truths_json` | `CampaignTruth[]` | Liste courte, jamais filtrée en SQL |
| `events.payload_json` | union discriminée ~60 formes | Une table par type serait ingérable |
| `snapshots.state_json` | `CampaignState` | Sérialisation opaque d'un objet moteur |
| `characters.sheet_snapshot_json` | `Champion` gelé | Copie figée, lue en entier |
| `characters.conditions_json` / `assets_json` / `bonds_json` / `notes_json` | listes variables | Taille et forme variables, jamais requêtées |
| `progress_tracks.tags_json`, `clocks`… | listes de chaînes | Trivial |
| `entities.details_json` | fiche libre de PNJ/lieu | Forme ouverte par nature |
| `chronicles.facts_json` | faits extraits | Sortie IA structurée, forme évolutive |
| `champion_sheets.sheet_json` | `Champion` forgé | Même schéma que le contenu fichier |
| `ai_calls.request_json` / `tool_calls_json` | trace d'appel | Audit, jamais requêté en SQL |
| `intents.payload_json` | intention client | Union discriminée |
| `content_packs.manifest_json` | manifeste | Lu en entier |

**Ce qui n'est jamais du JSON** : attributs, jauges, souffle, crans de jauge de
progression, statuts, identifiants de liaison, horodatages. Tout ce qui est borné,
contraint ou requêté est une colonne.

---

## 2. Flux d'écriture : d'une intention à un événement

Il n'existe **qu'un seul** chemin d'écriture pour l'état de partie. Toute PR qui en
ouvre un second doit être refusée.

```
Client                Serveur (autorité)                          Base
  │
  │ intent {id:uuid, type, payload}        (WebSocket)
  ├──────────────────────────────►
  │                       1. INSERT intents (idempotent sur id)
  │                       2. Autorisation (campaign_members, tour, statut perso)
  │                       3. MOTEUR : applique les règles, TIRE LES DÉS
  │                          → produit une liste d'événements candidats
  │                       4. TRANSACTION :
  │                            UPDATE campaigns SET seq = seq + n RETURNING seq
  │                            INSERT INTO events (n lignes)
  │                            réducteur → UPDATE des projections
  │                            (snapshot si seuil atteint)
  │                            UPDATE intents SET status='applied'
  │                       5. Diffusion WebSocket des événements à la table
  │ ◄──────────────────────────────
  │                       6. HORS transaction : appel Claude (Sonnet 5) avec les
  │                          résultats de dés DÉJÀ ACQUIS comme faits à habiller
  │                       7. Sortie IA validée → INSERT events ('narration.gm_message')
  │ ◄──────────────────────────────
```

Points non négociables :

- L'étape 3 se produit **avant** l'étape 6. Le modèle reçoit `outcome: 'weak_hit'` comme
  un fait, pas comme une question.
- L'étape 6 est **hors** transaction. Aucun appel réseau sous verrou d'écriture SQLite.
- Si l'étape 6 échoue, l'état de jeu est déjà correct et durable ; on insère un
  `narration.gm_failed` et le client affiche un repli. **Une panne de l'IA ne perd
  jamais une partie.**
- Une proposition du modèle (créer un PNJ, ouvrir une horloge) ne devient un événement
  qu'après passage par les étapes 2-4, exactement comme une intention de joueur.

---

## 3. Le modèle d'événements

### 3.1 Forme générale

```ts
// packages/contracts/src/events.ts
export const EventEnvelopeSchema = z.object({
  id: UlidSchema,
  campaignId: UlidSchema,
  seq: z.number().int().positive(),
  playSessionId: UlidSchema.nullable(),
  type: z.string(),
  payloadVersion: z.number().int().positive().default(1),
  actorKind: z.enum(['player', 'engine', 'gm_ai', 'system']),
  actorPlayerId: UlidSchema.nullable(),
  subjectCharacterId: UlidSchema.nullable(),
  correlationId: z.string().uuid().nullable(),
  causationId: UlidSchema.nullable(),
  rngStream: z.string().nullable(),
  rngDrawIndex: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int(),
});

export const GameEventSchema = z.discriminatedUnion('type', [
  CampaignCreatedSchema, /* ... toutes les variantes de §3.4 ... */
]);
export type GameEvent = z.infer<typeof GameEventSchema>;
```

Chaque variante est `EventEnvelopeSchema.extend({ type: z.literal('x.y'), payload: … })`.
Le réducteur prend `GameEvent`, donc TypeScript force l'exhaustivité du `switch` : ajouter
un type d'événement sans l'implémenter dans le réducteur **ne compile pas**. C'est le
mécanisme central qui permet à un agent de savoir en quelques secondes s'il a cassé
quelque chose.

### 3.2 Allocation de la séquence

```sql
BEGIN IMMEDIATE;
  UPDATE campaigns SET seq = seq + :n, updated_at = :now
    WHERE id = :campaignId
    RETURNING seq;              -- renvoie la BORNE HAUTE : seqs = [seq-n+1 .. seq]
  -- INSERT INTO events (...) VALUES ... x n  -- dans l'ordre croissant de seq
  -- UPDATE des projections
COMMIT;
```

`BEGIN IMMEDIATE` prend le verrou écrivain d'emblée : pas de `SQLITE_BUSY` au milieu de
la transaction. Le trigger `events_seq_dense` vérifie la cohérence pour le dernier
événement du lot ; le réducteur vérifie la densité complète au rejeu.

### 3.3 Le réducteur

```ts
// packages/engine/src/reduce.ts
export const REDUCER_VERSION = 1;

/** Pur. Pas d'I/O, pas de Date.now(), pas de Math.random(), pas de throw sur
 *  un événement valide. Deux appels avec les mêmes entrées donnent le même octet. */
export function reduce(state: CampaignState, event: GameEvent): CampaignState;
```

Contraintes de revue sur `reduce` :

1. **Pureté totale.** Interdits : horloge système, aléa, accès réseau ou base. Tout ce
   qui varie est déjà dans le payload (y compris `createdAt` et les résultats de dés).
2. **Totalité.** `reduce` ne lève jamais sur un événement qui a passé `GameEventSchema`.
   Un événement incohérent avec l'état (ex. dégât sur un personnage mort) est appliqué
   avec saturation, et le cas est détecté en amont par le moteur, pas ici.
3. **Idempotence de rejeu.** `replay(events)` donne toujours le même `CampaignState`,
   quel que soit le point de départ (instantané ou zéro).
4. **Aucune information hors journal.** Si `reduce` a besoin du contenu (table des prix,
   fiche de champion), ce contenu est passé en argument figé (`ContentBundle` à la
   version épinglée par la campagne), jamais rechargé depuis le disque courant.

### 3.4 Catalogue exhaustif des types d'événements

Conventions de payload : `characterId`, `trackId`, etc. sont des ULID ; `cause` est une
chaîne courte machine (`'move:strike/weak'`, `'price:d12=7'`, `'gm:proposal'`) qui rend
le journal lisible et débogable.

#### `campaign.*` — cycle de vie

| Type | Acteur | Payload |
|---|---|---|
| `campaign.created` | system | `{ name, slug, pitch, ownerPlayerId, contentPackVersion, contentPackHash, rulesVersion, rngSeed }` |
| `campaign.truth_set` | player | `{ truthId, optionId, customText? }` |
| `campaign.settings_updated` | player | `{ patch: Partial<CampaignSettings>, before: Partial<CampaignSettings> }` |
| `campaign.status_changed` | player | `{ from, to, reason? }` |
| `campaign.content_pack_changed` | system | `{ fromVersion, fromHash, toVersion, toHash, note }` |

#### `party.*` — la table

| Type | Acteur | Payload |
|---|---|---|
| `party.member_joined` | system | `{ playerId, role, displayName }` |
| `party.member_left` | system | `{ playerId, reason: 'left'\|'kicked'\|'inactive' }` |
| `party.member_role_changed` | player | `{ playerId, from, to }` |
| `party.champion_locked` | system | `{ championId, lockKind, reason }` |
| `party.champion_unlocked` | system | `{ championId, reason }` |

#### `character.*` — fiches et jauges

| Type | Acteur | Payload |
|---|---|---|
| `character.created` | player | `{ characterId, playerId, championId, displayName, sheetSource, sheetRef, sheetSnapshot: Champion, attributes: {vif,coeur,fer,ombre,esprit}, gauges: {vigor,soul,supplies}, momentum }` |
| `character.renamed` | player | `{ characterId, from, to }` |
| `character.gauge_changed` | engine | `{ characterId, gauge: 'vigor'\|'soul'\|'supplies', delta, from, to, clamped: boolean, cause }` |
| `character.momentum_changed` | engine | `{ characterId, delta, from, to, clamped, cause }` |
| `character.momentum_burned` | engine | `{ characterId, spent, resetTo, appliedToRollSeq }` |
| `character.momentum_negated` | engine | `{ characterId, actionDie, momentumValue, rollSeq }` |
| `character.condition_added` | engine | `{ characterId, conditionId, label, source }` |
| `character.condition_removed` | engine | `{ characterId, conditionId, cause }` |
| `character.asset_added` | player | `{ characterId, assetId, options? }` |
| `character.asset_upgraded` | player | `{ characterId, assetId, abilityIndex, xpCost }` |
| `character.asset_removed` | engine | `{ characterId, assetId, cause }` |
| `character.xp_earned` | engine | `{ characterId, amount, reason, trackId? }` |
| `character.xp_spent` | player | `{ characterId, amount, target }` |
| `character.attributes_corrected` | system | `{ characterId, from, to, reason }` *(admin uniquement)* |
| `character.died` | engine | `{ characterId, cause, finalSceneId? }` |
| `character.retired` | player | `{ characterId, reason }` |
| `character.sheet_rebound` | system | `{ characterId, fromSheetRef, toSheetRef, reason }` |

**Aucun de ces événements n'est émissible par le modèle.** `actorKind` vaut `engine`,
`player` ou `system` ; le validateur d'entrée rejette tout événement de jauge portant
`actorKind: 'gm_ai'` (test doré `test/engine/ai-cannot-mutate.test.ts`).

#### `roll.*` — le moteur décide

C'est le cœur de l'invariant 1. Ces événements sont écrits **avant** tout appel IA.

| Type | Payload |
|---|---|
| `roll.action_resolved` | `{ rollId, characterId, moveId, attribute, attributeValue, actionDie, adds: {source,value}[], rawTotal, total, cappedAtTen: boolean, challengeDice: [number, number], outcome: 'strong'\|'weak'\|'miss', isPortent: boolean, momentumBefore, momentumNegated: boolean, burnedMomentum: null \| {spent, resetTo}, rngStream: 'action', rngDrawIndex }` |
| `roll.progress_resolved` | `{ rollId, trackId, ticks, filledBoxes, challengeDice: [number,number], outcome, isPortent }` |
| `roll.oracle_resolved` | `{ rollId, tableId, tableVersion, dieSize, value, entryId, text, tags: string[], question?: string }` |
| `roll.yes_no_resolved` | `{ rollId, question, likelihood: 'quasi-certain'\|'probable'\|'incertain'\|'peu-probable'\|'improbable', threshold, value, answer: 'oui'\|'non', isExtreme: boolean }` |
| `roll.price_paid` | `{ rollId, value, entryId, text, severity, targetCharacterId?, chosenByPlayer: boolean }` |
| `roll.portent_drawn` | `{ rollId, tableId, value, entryId, text, triggeredByRollSeq }` |
| `roll.raw` | `{ rollId, label, dice: {sides, value}[], reason }` |

`total` est la valeur **plafonnée à 10** ; `rawTotal` garde la valeur non plafonnée pour
la lisibilité du journal et les tests. `cappedAtTen` explicite le plafonnement au lieu de
le laisser déduire. Cette redondance est volontaire : un journal qui se lit sans
recalculer vaut cher au débogage.

#### `move.*` — les mouvements

| Type | Payload |
|---|---|
| `move.declared` | `{ moveId, characterId, narrativeInput, chosenAttribute?, declaredAdds? }` |
| `move.resolved` | `{ moveId, characterId, rollSeq, outcome, effectsApplied: EngineEffect[], playerChoices?: {optionId}[] }` |
| `move.aborted` | `{ moveId, characterId, reason }` |

`effectsApplied` est la liste **déjà exécutée** d'effets moteur (cf. `EffectSchema`, §4.3),
chaque effet ayant par ailleurs produit son propre `character.*` ou `track.*`. Ce champ
est une vue de synthèse pour l'UI et le prompt, pas une source de vérité.

Identifiants de mouvements V1 : `face-danger`, `secure-advantage`, `gather-information`,
`probe-a-soul`, `strike`, `endure-harm`, `endure-cold`, `swear-a-vow`, plus les
mouvements de résolution `fulfill-your-vow`, `reach-a-milestone`, `forsake-your-vow`.

#### `track.*` et `clock.*` — jauges de progression et horloges

| Type | Payload |
|---|---|
| `track.created` | `{ trackId, kind, rank, title, description, ownerCharacterId?, visibility, initialTicks }` |
| `track.ticked` | `{ trackId, ticks, from, to, cause, milestones: number }` |
| `track.rank_changed` | `{ trackId, from, to, reason }` |
| `track.resolved` | `{ trackId, outcome: 'fulfilled'\|'failed', rollSeq, xpAwarded }` |
| `track.forsaken` | `{ trackId, reason, xpLost }` |
| `track.abandoned` | `{ trackId, reason }` *(hors-jeu : nettoyage)* |
| `clock.created` | `{ clockId, title, description, segments, visibility, consequence }` |
| `clock.advanced` | `{ clockId, delta, from, to, cause }` |
| `clock.filled` | `{ clockId, consequence }` |
| `clock.resolved` | `{ clockId, resolution }` |
| `clock.cancelled` | `{ clockId, reason }` |

Rappel de règle encodée côté moteur : un jalon vaut 12 crans en *gênant*, 8 en
*dangereux*, 4 en *redoutable*, 2 en *extrême*, 1 en *épique* ; `ticks` est plafonné à 40
(10 cases pleines).

#### `scene.*` et `narration.*`

| Type | Acteur | Payload |
|---|---|---|
| `scene.started` | gm_ai/player | `{ sceneId, title, regionId?, entityIds: string[], presentCharacterIds: string[] }` |
| `scene.ended` | system | `{ sceneId, outcome? }` |
| `narration.player_message` | player | `{ text, kind: 'ic'\|'ooc', characterId? }` |
| `narration.gm_message` | gm_ai | `{ text, aiCallId, model, promptVersion, respondsToSeq?, citedEventSeqs: number[] }` |
| `narration.gm_failed` | system | `{ aiCallId?, errorKind, fallbackText }` |
| `narration.gm_proposal` | gm_ai | `{ proposalId, kind: 'entity'\|'clock'\|'track'\|'scene'\|'price_choice', payload: unknown }` |
| `narration.proposal_accepted` | system | `{ proposalId, resultingEventSeqs: number[] }` |
| `narration.proposal_rejected` | system | `{ proposalId, reasonCode, validationErrors: string[] }` |
| `narration.safety_flag` | player | `{ kind: 'pause'\|'rewind'\|'veil', note? }` |

`narration.proposal_rejected` est un événement de premier rang, pas un log : le taux de
rejet par `reasonCode` est une métrique de qualité du MJ IA suivie par le harnais d'éval.

#### `entity.*` — la mémoire structurée

| Type | Payload |
|---|---|
| `entity.introduced` | `{ entityId, kind, slug, name, summary, regionId?, championId?, disposition?, details }` |
| `entity.updated` | `{ entityId, patch, before }` |
| `entity.status_changed` | `{ entityId, from, to, cause }` |
| `entity.mentioned` | `{ entityId }` *(met à jour `last_seen_seq`, léger)* |

#### `session.*` et `chronicle.*`

| Type | Payload |
|---|---|
| `session.opened` | `{ playSessionId, ordinal, title?, presentPlayerIds }` |
| `session.closed` | `{ playSessionId, firstSeq, lastSeq, recapChronicleId? }` |
| `chronicle.compacted` | `{ chronicleId, layer, coversFromSeq, coversToSeq, supersededIds: string[], aiCallId, tokensEstimate }` |

#### `system.*` — administration et rejouabilité

| Type | Payload |
|---|---|
| `system.reverted` | `{ targetSeqs: number[], reason, byPlayerId }` — **annulation** (§3.7) |
| `system.correction` | `{ targetSeq, field, from, to, reason }` — correction manuelle tracée |
| `system.rules_version_migrated` | `{ from, to, note }` |
| `system.payload_upcast` | `{ fromVersion, toVersion, affectedTypes }` |
| `system.note` | `{ text, byPlayerId }` — marque-page libre dans le journal |

Total : **69 types**. Ajouter un type impose : la variante Zod, la branche du réducteur,
un cas doré dans `test/engine/golden/`, et une ligne dans ce tableau. La CI échoue si
`GameEventSchema` contient un `type` absent de ce fichier (`test/docs/event-catalog.test.ts`
lit le markdown et compare les deux listes).

### 3.5 Rejeu et instantanés

L'état moteur est un objet TypeScript unique :

```ts
export type CampaignState = {
  campaignId: string;
  seq: number;                       // dernier événement appliqué
  reducerVersion: number;
  contentPackHash: string;
  settings: CampaignSettings;
  truths: CampaignTruth[];
  characters: Record<string, CharacterState>;
  tracks: Record<string, TrackState>;
  clocks: Record<string, ClockState>;
  entities: Record<string, EntityState>;
  championLocks: Record<string, ChampionLock>;
  scene: SceneState | null;
  party: { memberPlayerIds: string[]; ownerPlayerId: string };
  rng: { seed: string; draws: Record<string, number> };  // index par flux
};
```

Algorithme de chargement :

```ts
async function loadState(db, campaignId, atSeq = 'head'): Promise<CampaignState> {
  const head = atSeq === 'head' ? await getCampaignSeq(db, campaignId) : atSeq;

  // 1. Meilleur instantané compatible.
  const snap = await db.get(`
    SELECT seq, state_json FROM snapshots
     WHERE campaign_id = ? AND reducer_version = ? AND seq <= ?
     ORDER BY seq DESC LIMIT 1`, campaignId, REDUCER_VERSION, head);

  let state = snap ? CampaignStateSchema.parse(JSON.parse(snap.state_json))
                   : initialState(campaignId);
  let from = snap ? snap.seq + 1 : 1;

  // 2. Pré-passe : événements annulés dans la queue à rejouer.
  const reverted = await collectRevertedSeqs(db, campaignId, from, head);

  // 3. Rejeu de la queue, par lots de 500 (curseur, pas de tout-en-mémoire).
  for await (const ev of streamEvents(db, campaignId, from, head)) {
    if (ev.seq !== from++) throw new JournalGapError(campaignId, ev.seq);  // densité
    if (reverted.has(ev.seq)) continue;
    state = reduce(state, GameEventSchema.parse(upcast(ev)));
  }
  return state;
}
```

**Politique d'instantanés.** Le but : ne jamais rejouer plus de ~500 événements.

| Déclencheur | `kind` | Rétention |
|---|---|---|
| Tous les 200 événements | `rolling` | les 3 plus récents |
| `session.closed` | `session_end` | permanent |
| `track.resolved` d'un serment de rang ≥ *redoutable* | `milestone` | permanent |
| Manuel (`pnpm db:snapshot <campaign>`) | `milestone` | permanent |

Un instantané pèse de 50 à 300 Ko en JSON. Une campagne de 10 000 événements sur six
mois occupe de l'ordre de 40 × 200 Ko ≈ 8 Mo d'instantanés : négligeable devant le
confort d'un chargement en dizaines de millisecondes.

Les instantanés sont écrits **hors du chemin critique** : la transaction d'écriture pose
un drapeau, une tâche de fond sérialise et insère. Un instantané manquant ne coûte qu'un
rejeu plus long, jamais une erreur.

**Invalidations** :

- Bump de `REDUCER_VERSION` → les instantanés d'anciennes versions ne sont plus
  sélectionnés (filtre `reducer_version = ?`) et sont purgés par
  `pnpm db:gc --snapshots`. Aucune migration de données n'est nécessaire.
- `system.reverted` → `DELETE FROM snapshots WHERE campaign_id = ? AND seq >= min(targetSeqs)`.
- `system.payload_upcast` → même chose, prudence maximale.

### 3.6 RNG déterministe

Le générateur est **sans état**, dérivé par hachage. Cela permet de rejouer un tirage
depuis n'importe quel point sans reconstruire une séquence.

```ts
// packages/engine/src/rng.ts
export function drawUint32(seed: string, seq: number, stream: string, index: number): number {
  const h = sha256(`${seed}|${seq}|${stream}|${index}`);     // hex
  return parseInt(h.slice(0, 8), 16);
}
export function rollDie(sides: number, ...args): number {
  // Rejet du biais modulo : on retire tant que la valeur tombe dans la zone tronquée.
  ...
}
```

Flux (`stream`) normalisés : `action`, `challenge-a`, `challenge-b`, `oracle`, `price`,
`portent`, `forge`. Chaque événement de tirage persiste `rng_stream` et `rng_draw_index`,
donc **tout jet de la campagne est reproductible à l'octet** à partir de
`campaigns.rng_seed`. C'est ce qui rend le corpus de cas dorés possible.

En test, le port `Rng` est substitué par `scriptedRng([3, 7, 9, ...])`, qui consomme une
liste de valeurs et **échoue si la liste est épuisée** — un test qui tire plus de dés que
prévu casse au lieu de dériver.

### 3.7 Annulation et correction

Le journal étant append-only, on n'annule jamais en supprimant.

1. **Annulation** : on ajoute `system.reverted { targetSeqs: [412, 413, 414], reason }`.
   Le chargement applique la pré-passe §3.5 et saute ces séquences. Les instantanés
   ≥ 412 sont supprimés, les projections sont reconstruites pour cette campagne.
2. **Correction** : `system.correction` pour un ajustement ponctuel tracé (typiquement
   une faute de saisie sur un nom).
3. **Événement compensatoire** : la voie **normale** en jeu. On n'annule pas un dégât,
   on applique un soin ; l'histoire garde la trace des deux.

L'annulation est réservée au propriétaire de la campagne et à un administrateur, limitée
aux 50 derniers événements, et produit elle-même une ligne de journal. Le bouton
« annuler le dernier jet » de l'UI émet un `system.reverted` sur le groupe
`correlation_id` complet (l'intention et toute sa cascade), jamais sur une seule ligne :
annuler un `roll.action_resolved` sans annuler le `character.gauge_changed` qu'il a causé
produirait un état incohérent.

### 3.8 Versionnement des payloads et upcasters

`events.payload_version` permet de faire évoluer la forme d'un payload sans jamais
réécrire le journal.

```ts
// packages/contracts/src/upcast.ts
type Upcaster = (payload: unknown) => unknown;
const UPCASTERS: Record<string, Record<number, Upcaster>> = {
  'roll.action_resolved': {
    1: (p: any) => ({ ...p, cappedAtTen: p.total >= 10, rawTotal: p.rawTotal ?? p.total }),
  },
};
export function upcast(row: EventRow): GameEvent { /* applique en chaîne jusqu'à la version courante */ }
```

Règles : un upcaster est **pur**, **testé** par un cas doré contenant le payload à
l'ancienne version, et n'est **jamais supprimé** — une campagne de 2026 doit encore se
charger en 2028. Le coût est une fonction de dix lignes par changement ; c'est le prix de
l'invariant 4.

---

## 4. Le contenu versionné dans le repo

### 4.1 Arborescence

Le contenu de jeu n'est **jamais** en base : c'est du code. Il est relu en PR, il a un
historique git, il se diffuse avec un déploiement, il est identique sur toutes les
machines.

```
content/
├── manifest.json                 # version semver + inventaire + hash attendus
├── moves/
│   ├── face-danger.json
│   ├── secure-advantage.json
│   ├── gather-information.json
│   ├── probe-a-soul.json
│   ├── strike.json
│   ├── endure-harm.json
│   ├── endure-cold.json
│   ├── swear-a-vow.json
│   ├── reach-a-milestone.json
│   ├── fulfill-your-vow.json
│   └── forsake-your-vow.json
├── champions/
│   ├── braum.json                # 20 fiches écrites à la main en V1
│   ├── ashe.json
│   └── …
├── regions/
│   ├── freljord.json             # racine
│   ├── avarosa-reach.json        # parentId: 'freljord'
│   ├── frostguard-citadel.json
│   └── …
├── oracles/
│   ├── yes-no.json               # oracle oui/non pondéré
│   ├── action-theme.json
│   ├── place-features.json
│   ├── npc-names-freljord.json
│   ├── npc-roles.json
│   ├── npc-goals.json
│   └── settlement-troubles.json
├── tables/
│   ├── pay-the-price.json        # d12
│   └── portents.json             # présages (dés de défi identiques)
├── assets/
│   ├── companion-poro.json
│   └── …
├── conditions.json               # liste plate des conditions/marques
└── truths/
    └── freljord-truths.json      # vérités de campagne proposées à la création
```

Règles d'arborescence, vérifiées par le chargeur :

- **Un fichier = une entité**, sauf `conditions.json` et `truths/*.json` qui sont des
  listes (petites, fortement couplées, jamais référencées individuellement en PR).
- Le champ `id` doit être **égal au nom de fichier sans extension**. Un renommage de
  fichier sans renommage d'id échoue au démarrage.
- Les identifiants sont des slugs `kebab-case` ASCII (`^[a-z0-9]+(-[a-z0-9]+)*$`). Le
  texte visible est en français et vit dans les champs `name`, `text`, `description`.
- Aucune référence circulaire : `regions.parentId` doit former une forêt.

### 4.2 Schémas Zod — primitives partagées

Tous les schémas vivent dans `packages/content/src/schemas/` et sont réexportés par
`packages/contracts`. Le front les utilise pour typer l'affichage, le serveur pour
valider, la CI pour vérifier.

```ts
// packages/content/src/schemas/common.ts
import { z } from 'zod';

export const SlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
  message: 'doit être un slug kebab-case ASCII (ex. "griffe-de-givre")',
});

export const FrTextSchema = z.string().trim().min(1, { message: 'texte français requis' });

export const AttributeKeySchema = z.enum(['vif', 'coeur', 'fer', 'ombre', 'esprit']);
export type AttributeKey = z.infer<typeof AttributeKeySchema>;

export const GaugeKeySchema = z.enum(['vigor', 'soul', 'supplies']);

export const RankSchema = z.enum(['genant', 'dangereux', 'redoutable', 'extreme', 'epique']);
export const RANK_TICKS: Record<z.infer<typeof RankSchema>, number> = {
  genant: 12, dangereux: 8, redoutable: 4, extreme: 2, epique: 1,
};

export const TagsSchema = z.array(SlugSchema).max(12).default([]);

/** Répartition légale des attributs : exactement 3/2/2/1/1. */
export const AttributeSpreadSchema = z
  .object({
    vif: z.number().int().min(1).max(3),
    coeur: z.number().int().min(1).max(3),
    fer: z.number().int().min(1).max(3),
    ombre: z.number().int().min(1).max(3),
    esprit: z.number().int().min(1).max(3),
  })
  .superRefine((v, ctx) => {
    const sorted = Object.values(v).sort((a, b) => b - a).join(',');
    if (sorted !== '3,2,2,1,1') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `répartition illégale [${sorted}] : attendu exactement 3,2,2,1,1`,
      });
    }
  });

/** Référence vers une autre entité de contenu. Résolue après chargement (§4.8). */
export const RefSchema = (kind: string) =>
  SlugSchema.describe(`ref:${kind}`);
```

### 4.3 Effets moteur (`EngineEffect`) — le contrat cœur

Le contenu ne contient **jamais de logique**. Il déclare des effets que le moteur sait
exécuter. C'est ce qui garantit qu'un fichier JSON ne peut pas contourner l'invariant 1.

```ts
// packages/content/src/schemas/effect.ts
export const EffectSchema: z.ZodType<EngineEffect> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('gauge'),    gauge: GaugeKeySchema,
                delta: z.number().int().min(-5).max(5),
                target: z.enum(['self', 'chosen-ally', 'all-allies']).default('self') }),
    z.object({ op: z.literal('momentum'), delta: z.number().int().min(-6).max(6) }),
    z.object({ op: z.literal('momentum_reset') }),
    z.object({ op: z.literal('condition_add'),    conditionId: RefSchema('condition') }),
    z.object({ op: z.literal('condition_remove'), conditionId: RefSchema('condition') }),
    z.object({ op: z.literal('track_tick'),
                trackKind: z.enum(['vow', 'combat', 'journey', 'scene_challenge', 'bond']),
                ticks: z.number().int().min(-40).max(40),
                useRank: z.boolean().default(false) }),   // true => ticks = RANK_TICKS[rank]
    z.object({ op: z.literal('track_create'),
                trackKind: z.enum(['vow', 'combat', 'journey', 'scene_challenge']),
                rankFrom: z.enum(['player', 'fixed']),
                rank: RankSchema.optional() }),
    z.object({ op: z.literal('clock_advance'), segments: z.number().int().min(1).max(4) }),
    z.object({ op: z.literal('xp'), amount: z.number().int().min(-10).max(10) }),
    z.object({ op: z.literal('pay_price'),
                mode: z.enum(['roll', 'gm_choice', 'player_choice']) }),
    z.object({ op: z.literal('oracle'), tableId: RefSchema('oracle') }),
    z.object({ op: z.literal('narrative'), prompt: FrTextSchema }),  // consigne au MJ, zéro mécanique
    z.object({ op: z.literal('choice'),
                label: FrTextSchema,
                pick: z.number().int().min(1).max(3).default(1),
                options: z.array(z.object({
                  id: SlugSchema, label: FrTextSchema,
                  effects: z.array(EffectSchema).max(6),
                })).min(2).max(6) }),
  ]),
);
```

Un `op` inconnu fait échouer le chargement. Ajouter un effet impose une branche dans
l'exécuteur du moteur — même mécanique d'exhaustivité TypeScript que pour le réducteur.

### 4.4 Mouvement (`content/moves/*.json`)

```ts
// packages/content/src/schemas/move.ts
export const MoveOutcomeSchema = z.object({
  text: FrTextSchema,                              // ce que le joueur lit
  gmGuidance: FrTextSchema.optional(),             // consigne injectée au prompt MJ
  effects: z.array(EffectSchema).max(8).default([]),
});

export const MoveSchema = z.object({
  schemaVersion: z.literal(1),
  id: SlugSchema,
  name: FrTextSchema,                              // « Affronter le danger »
  category: z.enum(['aventure', 'combat', 'relation', 'serment', 'survie', 'meta']),
  trigger: FrTextSchema,                           // « Quand tu agis malgré un péril… »
  rollKind: z.enum(['action', 'progress', 'none']),
  attributeOptions: z.array(AttributeKeySchema).max(5).default([]),
  allowsMomentumBurn: z.boolean().default(true),
  outcomes: z.object({
    strong: MoveOutcomeSchema,
    weak: MoveOutcomeSchema,
    miss: MoveOutcomeSchema,
  }),
  portent: z.object({ text: FrTextSchema, tableId: RefSchema('table').optional() }).optional(),
  tags: TagsSchema,
  notes: FrTextSchema.optional(),
}).superRefine((m, ctx) => {
  if (m.rollKind === 'action' && m.attributeOptions.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['attributeOptions'],
      message: 'un mouvement à jet d\'action doit proposer au moins un attribut' });
  }
  if (m.rollKind !== 'action' && m.attributeOptions.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['attributeOptions'],
      message: 'attributs interdits hors jet d\'action' });
  }
});
```

Exemple (`content/moves/endure-cold.json`) :

```json
{
  "schemaVersion": 1,
  "id": "endure-cold",
  "name": "Endurer le froid",
  "category": "survie",
  "trigger": "Quand tu traverses une étendue gelée sans abri ni feu…",
  "rollKind": "action",
  "attributeOptions": ["fer", "esprit"],
  "allowsMomentumBurn": true,
  "outcomes": {
    "strong": {
      "text": "Tu tiens bon. Le froid ne te prend rien.",
      "gmGuidance": "Décris un signe que le Freljord respecte cette endurance.",
      "effects": [{ "op": "momentum", "delta": 1 }]
    },
    "weak": {
      "text": "Tu passes, mais le gel prélève sa part.",
      "effects": [{ "op": "gauge", "gauge": "supplies", "delta": -1, "target": "self" }]
    },
    "miss": {
      "text": "Le froid entre en toi.",
      "effects": [
        { "op": "gauge", "gauge": "vigor", "delta": -1, "target": "self" },
        { "op": "pay_price", "mode": "roll" }
      ]
    }
  },
  "portent": { "text": "Le blizzard se lève : l'issue change de nature.", "tableId": "portents" },
  "tags": ["froid", "voyage"]
}
```

### 4.5 Champion (`content/champions/*.json`)

Le **même** schéma valide les 20 fiches écrites à la main et les fiches forgées par
l'IA. C'est délibéré : la forge n'a aucun privilège, et un test doré compare une fiche
forgée à une fiche manuscrite sur les mêmes invariants.

```ts
// packages/content/src/schemas/champion.ts
export const ChampionSchema = z.object({
  schemaVersion: z.literal(1),
  id: SlugSchema,                                  // 'braum'
  name: FrTextSchema,                              // « Braum »
  title: FrTextSchema,                             // « Le Cœur du Freljord »
  origin: z.object({
    regionId: RefSchema('region'),
    homeText: FrTextSchema,
  }),
  pitch: FrTextSchema.max(280),                    // une phrase, affichée au choix de perso
  description: FrTextSchema.max(2000),

  attributes: AttributeSpreadSchema,

  startingGauges: z.object({
    vigor: z.number().int().min(0).max(5).default(5),
    soul: z.number().int().min(0).max(5).default(5),
    supplies: z.number().int().min(0).max(5).default(5),
  }).default({ vigor: 5, soul: 5, supplies: 5 }),
  startingMomentum: z.number().int().min(-6).max(10).default(2),

  startingAssets: z.array(RefSchema('asset')).min(1).max(3),
  signatureAsset: z.object({
    id: SlugSchema,
    name: FrTextSchema,
    text: FrTextSchema,
    effects: z.array(EffectSchema).max(4).default([]),
  }),
  startingVow: z.object({
    title: FrTextSchema,
    rank: RankSchema,
    description: FrTextSchema,
  }),
  startingBonds: z.array(z.object({
    with: FrTextSchema,
    text: FrTextSchema,
  })).max(3).default([]),

  /** Consignes de voix pour le MJ IA. Non mécanique, purement narratif. */
  voice: z.object({
    register: FrTextSchema,                        // « chaleureux, bourru, protecteur »
    speechTics: z.array(FrTextSchema).max(6).default([]),
    forbidden: z.array(FrTextSchema).max(6).default([]),  // ce que ce champion NE dit jamais
    sampleLines: z.array(FrTextSchema).min(1).max(5),
  }),

  loreHooks: z.array(FrTextSchema).min(1).max(8),  // amorces d'intrigue
  relations: z.array(z.object({
    championId: RefSchema('champion'),
    kind: z.enum(['allie', 'rival', 'parent', 'ennemi', 'mentor', 'inconnu']),
    text: FrTextSchema,
  })).max(8).default([]),

  source: z.enum(['handwritten', 'forged']),
  portraitUrl: z.string().url().optional(),
  contentWarnings: z.array(SlugSchema).max(6).default([]),
  tags: TagsSchema,
}).superRefine((c, ctx) => {
  if (c.relations.some((r) => r.championId === c.id)) {
    ctx.addIssue({ code: 'custom', path: ['relations'],
      message: 'un champion ne peut pas être en relation avec lui-même' });
  }
});
```

**La forge IA utilise ce schéma comme contrat de sortie.** Le serveur :
1. appelle Opus 5 avec `ChampionSchema` converti en JSON Schema comme définition d'outil ;
2. valide la sortie avec `ChampionSchema.safeParse` ;
3. en cas d'échec, relance **une** fois avec les erreurs Zod en retour, puis abandonne ;
4. force `source: 'forged'` et `id` côté serveur (jamais depuis le modèle) ;
5. insère dans `champion_sheets` avec `status='pending_review'`.

Un modèle ne peut donc pas s'inventer un attribut à 5 ni un effet inconnu : la
répartition 3/2/2/1/1 et l'union `EffectSchema` le rendent impossible.

### 4.6 Tables d'oracle, table des prix, présages

```ts
// packages/content/src/schemas/oracle.ts
export const DieSizeSchema = z.union([
  z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12),
  z.literal(20), z.literal(100),
]);

export const OracleEntrySchema = z.object({
  id: SlugSchema,
  min: z.number().int().positive(),
  max: z.number().int().positive(),
  text: FrTextSchema,
  tags: TagsSchema,
  /** Enchaînement : tirer ensuite sur une autre table (ex. lieu -> nom). */
  chain: z.array(RefSchema('oracle')).max(3).default([]),
}).refine((e) => e.max >= e.min, { message: 'max doit être ≥ min' });

/** Couverture exacte et sans trou d'un dé : la garantie la plus utile du chargeur. */
const coversDie = (entries: { min: number; max: number }[], die: number, ctx: z.RefinementCtx) => {
  const sorted = [...entries].sort((a, b) => a.min - b.min);
  let cursor = 1;
  for (const e of sorted) {
    if (e.min !== cursor) {
      ctx.addIssue({ code: 'custom', path: ['entries'],
        message: e.min > cursor
          ? `trou dans la table : ${cursor}..${e.min - 1} non couvert`
          : `chevauchement à ${e.min} (déjà couvert jusqu'à ${cursor - 1})` });
      return;
    }
    cursor = e.max + 1;
  }
  if (cursor !== die + 1) {
    ctx.addIssue({ code: 'custom', path: ['entries'],
      message: `table incomplète : ${cursor}..${die} non couvert` });
  }
};

export const OracleTableSchema = z.object({
  schemaVersion: z.literal(1),
  id: SlugSchema,
  name: FrTextSchema,
  kind: z.literal('table'),
  die: DieSizeSchema,
  usage: FrTextSchema,                             // quand le MJ doit s'en servir
  entries: z.array(OracleEntrySchema).min(2),
  tags: TagsSchema,
}).superRefine((t, ctx) => coversDie(t.entries, t.die, ctx));

/** Oracle oui/non pondéré : seuils sur d100. */
export const YesNoOracleSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal('yes-no'),
  kind: z.literal('yes-no'),
  die: z.literal(100),
  /** Valeur ≤ seuil ⇒ « oui ». */
  likelihoods: z.object({
    'quasi-certain': z.literal(90),
    'probable': z.literal(75),
    'incertain': z.literal(50),
    'peu-probable': z.literal(25),
    'improbable': z.literal(10),
  }),
  /** Doubles (11, 22, …) ⇒ « oui, mais » / « non, et » : un retournement imposé. */
  extremeRule: FrTextSchema,
  extremeTableId: RefSchema('table'),
});

/** Table « payer le prix » — d12, thématisée Freljord. */
export const PriceTableSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal('pay-the-price'),
  kind: z.literal('price'),
  die: z.literal(12),
  entries: z.array(OracleEntrySchema.extend({
    severity: z.enum(['legere', 'serieuse', 'grave']),
    /** Suggestion NARRATIVE au MJ. Le moteur ne l'applique pas automatiquement :
     *  elle devient une proposition validée, jamais une mutation directe. */
    suggestedEffects: z.array(EffectSchema).max(3).default([]),
  })).length(12),
  tags: TagsSchema,
}).superRefine((t, ctx) => coversDie(t.entries, 12, ctx));

/** Table des présages (dés de défi identiques). */
export const PortentTableSchema = OracleTableSchema.extend({
  id: z.literal('portents'),
});
```

Le point important est `coversDie` : c'est un oracle de test au sens propre. Une table
d12 avec une entrée manquante ne se voit pas à la relecture, mais produirait en partie
un `undefined` qui remonterait jusque dans le prompt du MJ. Ici, le serveur ne démarre pas.

`suggestedEffects` de la table des prix est **explicitement une suggestion** : le d12 est
tiré par le moteur (fait acquis), mais la conséquence mécanique passe par le circuit de
proposition (§2) parce qu'elle dépend de la fiction. C'est la seule entorse apparente à
l'invariant 1, et elle est gérée par le circuit qui existe précisément pour ça.

### 4.7 Région, atout, condition, vérités, manifeste

```ts
// packages/content/src/schemas/region.ts
export const RegionSchema = z.object({
  schemaVersion: z.literal(1),
  id: SlugSchema,
  name: FrTextSchema,
  parentId: RefSchema('region').nullable(),
  kind: z.enum(['royaume', 'territoire', 'etablissement', 'site', 'etendue']),
  summary: FrTextSchema.max(400),
  description: FrTextSchema.max(3000),
  dangerRank: RankSchema,
  climate: FrTextSchema,
  factions: z.array(z.object({
    id: SlugSchema, name: FrTextSchema, stance: FrTextSchema,
  })).max(8).default([]),
  landmarks: z.array(FrTextSchema).max(12).default([]),
  hooks: z.array(FrTextSchema).min(1).max(10),
  oracleRefs: z.array(RefSchema('oracle')).max(8).default([]),
  neighborIds: z.array(RefSchema('region')).max(8).default([]),
  tags: TagsSchema,
});

// packages/content/src/schemas/asset.ts
export const AssetSchema = z.object({
  schemaVersion: z.literal(1),
  id: SlugSchema,
  name: FrTextSchema,
  category: z.enum(['compagnon', 'chemin', 'talent', 'rituel', 'equipement']),
  text: FrTextSchema,
  abilities: z.array(z.object({
    text: FrTextSchema,
    xpCost: z.number().int().min(0).max(3).default(1),
    effects: z.array(EffectSchema).max(4).default([]),
  })).min(1).max(3),
  track: z.object({ label: FrTextSchema, max: z.number().int().min(1).max(5) }).optional(),
  tags: TagsSchema,
});

// packages/content/src/schemas/condition.ts
export const ConditionSchema = z.object({
  id: SlugSchema,
  name: FrTextSchema,                              // « Transi », « Endeuillé », « Traqué »
  kind: z.enum(['physique', 'morale', 'lien', 'fardeau']),
  text: FrTextSchema,
  blocksMomentumReset: z.boolean().default(false), // certaines marques abaissent le reset
  momentumMaxPenalty: z.number().int().min(0).max(4).default(1),
  clearMoveHint: FrTextSchema,
});
export const ConditionsFileSchema = z.object({
  schemaVersion: z.literal(1),
  conditions: z.array(ConditionSchema).min(1),
});

// packages/content/src/schemas/truth.ts
export const TruthSchema = z.object({
  id: SlugSchema,
  question: FrTextSchema,                          // « Que reste-t-il d'Avarosa ? »
  options: z.array(z.object({
    id: SlugSchema, text: FrTextSchema,
    questHint: FrTextSchema,
    entitySeeds: z.array(z.object({
      kind: z.enum(['npc', 'place', 'faction']), name: FrTextSchema, summary: FrTextSchema,
    })).max(4).default([]),
  })).min(2).max(5),
});
export const TruthsFileSchema = z.object({
  schemaVersion: z.literal(1), truths: z.array(TruthSchema).min(1),
});

// packages/content/src/schemas/manifest.ts
export const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),    // semver du bundle
  rulesVersion: z.number().int().positive(),
  generatedAt: z.string().datetime().optional(),
  expectedCounts: z.object({
    moves: z.number().int().positive(),
    champions: z.number().int().positive(),
    regions: z.number().int().positive(),
    oracles: z.number().int().positive(),
    tables: z.number().int().positive(),
    assets: z.number().int().positive(),
  }),
});
```

`expectedCounts` attrape le bug bête mais réel : un fichier oublié dans un `.gitignore`,
un volume Docker mal monté, un `COPY` incomplet. Le serveur compte ce qu'il a chargé et
compare ; l'écart fait échouer le démarrage.

`CampaignSettings` (stocké dans `campaigns.settings_json`) relève du même traitement :

```ts
export const CampaignSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  models: z.object({
    narration: z.string().default('claude-sonnet-5'),
    forge: z.string().default('claude-opus-5'),
    chronicle: z.string().default('claude-opus-5'),
  }).default({}),
  gmVerbosity: z.enum(['sobre', 'standard', 'ample']).default('standard'),
  oracleBias: z.enum(['clement', 'neutre', 'impitoyable']).default('neutre'),
  safety: z.object({
    lines: z.array(FrTextSchema).max(20).default([]),   // interdits absolus
    veils: z.array(FrTextSchema).max(20).default([]),   // hors-champ
  }).default({}),
  allowForgedChampions: z.boolean().default(true),
  requireForgeReview: z.boolean().default(true),
}).strict();
```

`.strict()` est important : une clé inconnue dans `settings_json` signale une migration
ratée ou une écriture parasite, et doit lever.

### 4.8 Le chargeur : échec bruyant au démarrage

```ts
// packages/content/src/load.ts
export type ContentBundle = Readonly<{
  version: string;
  hash: string;                                    // sha256 du JSON canonique du bundle
  rulesVersion: number;
  moves: ReadonlyMap<string, Move>;
  champions: ReadonlyMap<string, Champion>;
  regions: ReadonlyMap<string, Region>;
  oracles: ReadonlyMap<string, OracleTable>;
  yesNo: YesNoOracle;
  priceTable: PriceTable;
  portents: PortentTable;
  assets: ReadonlyMap<string, Asset>;
  conditions: ReadonlyMap<string, Condition>;
  truths: readonly Truth[];
}>;

export function loadContent(root = 'content'): ContentBundle;
```

Quatre passes, dans cet ordre :

1. **Lecture et parse JSON.** Erreur de syntaxe → `ContentSyntaxError { file, line, column }`.
2. **Validation Zod par fichier.** Chaque `ZodIssue` est rendu en une ligne
   `content/champions/lissandra.json → attributes : répartition illégale [3,3,2,1,1] : attendu exactement 3,2,2,1,1`.
   **Toutes** les erreurs sont collectées avant de lever : on ne corrige pas un fichier à
   la fois.
3. **Résolution des références.** Chaque champ marqué `RefSchema(kind)` (repéré via
   `.describe('ref:kind')`) est vérifié contre l'index chargé. Une référence morte donne
   `content/moves/strike.json → outcomes.miss.effects[1].conditionId : condition "blesse" introuvable (suggestion : "blesse-gravement")`.
   La suggestion vient d'une distance de Levenshtein sur les ids du même type — deux
   heures de travail qui font gagner des heures à chaque contributeur.
4. **Invariants globaux.** Forêt des régions acyclique ; ids uniques inter-types ;
   `expectedCounts` du manifeste ; 20 champions `source: 'handwritten'` minimum ;
   les 11 mouvements V1 présents ; couverture de `pay-the-price` sur d12.

En cas d'échec :

```
✖ Contenu invalide — le serveur ne démarrera pas (3 erreurs)

  content/champions/sejuani.json
    → attributes : répartition illégale [3,3,2,1,1] : attendu exactement 3,2,2,1,1
    → startingAssets[0] : atout "sanglier-de-guerre" introuvable (suggestion : "sanglier-de-givre")

  content/tables/pay-the-price.json
    → entries : trou dans la table : 9..9 non couvert

Corrigez ces fichiers puis relancez. Détail : pnpm content:check --verbose
```

Le processus sort en **code 1**. C'est vrai au démarrage du serveur (`buildServer()`
appelle `loadContent()` avant d'ouvrir le port : pas de service à moitié fonctionnel) et
en CI via `pnpm content:check`, qui est une étape distincte et rapide du pipeline, placée
**avant** les tests pour que l'erreur soit lisible en tête de log.

Le bundle est **gelé** (`Object.freeze` récursif en développement) et son `hash` est
enregistré dans `content_packs`. Au chargement d'une campagne, si
`campaigns.content_pack_hash` diffère du bundle courant, le serveur journalise un
`campaign.content_pack_changed` et continue — mais les personnages gardent leur
`sheet_snapshot_json`, donc rien ne bouge sous les pieds des joueurs.

---

## 5. Migrations Drizzle

### 5.1 Disposition

```
packages/db/
├── drizzle.config.ts
├── schema.expected.sql            # dump normalisé, comparé en CI
├── src/
│   ├── client.ts                  # ouverture + PRAGMA + typage
│   ├── schema/
│   │   ├── index.ts
│   │   ├── players.ts
│   │   ├── campaigns.ts
│   │   ├── events.ts
│   │   ├── projections.ts
│   │   └── ai.ts
│   └── migrate.ts
└── migrations/
    ├── 0000_initial.sql
    ├── 0001_add_clock_visibility.sql
    └── meta/_journal.json
```

```ts
// packages/db/drizzle.config.ts
export default {
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
} satisfies Config;
```

### 5.2 Règles

1. **Les fichiers SQL générés sont commités.** `drizzle-kit push` est **interdit** hors
   du bac à sable local d'un développeur ; en CI et en production, seul
   `drizzle-kit migrate` (via `pnpm db:migrate`) s'exécute.
2. **Forward-only.** Aucun `down`. Annuler une migration, c'est en écrire une nouvelle.
   Sur une base unique de production, un rollback de schéma est plus risqué que la
   correction qu'il prétend annuler.
3. **Relire le SQL généré, toujours.** `drizzle-kit` ne connaît ni nos triggers ni nos
   index partiels. Une migration générée est un brouillon.
4. **`events` ne passe jamais par une reconstruction automatique.** SQLite ne sait pas
   `ALTER COLUMN` : drizzle-kit génère alors le rituel « table temporaire + copie +
   rename », qui **perd les triggers** `events_no_update`, `events_no_delete` et
   `events_seq_dense`. Toute migration touchant `events` est écrite à la main et
   recrée explicitement les triggers. Un test doré (`test/db/append-only.test.ts`)
   vérifie après migration qu'un `UPDATE events` lève bien.
5. **Les seules opérations sûres** sur une table vivante : `ADD COLUMN` (avec `DEFAULT`
   non nul ou `NULL`), `CREATE INDEX`, `CREATE TRIGGER`, `DROP INDEX`. Tout le reste
   suit le protocole étendre/contracter (§5.3).
6. **Une migration ne fait jamais d'appel réseau ni d'appel IA.** Une donnée manquante se
   remplit par une tâche applicative idempotente, pas par une migration.

### 5.3 Faire évoluer le schéma avec des campagnes en cours

C'est le cas qui compte. Trois situations, trois protocoles.

#### (a) Changement sur une table de **zone C** (projection)

**Il n'y a rien à migrer.** On modifie la définition, on incrémente `REDUCER_VERSION`, on
reconstruit :

```bash
pnpm db:migrate                    # ADD COLUMN / DROP TABLE + CREATE TABLE
pnpm db:rebuild --all              # tronque les projections, rejoue le journal
```

`db:rebuild` traite les campagnes une par une, dans une transaction par campagne, et
laisse le service en ligne : une campagne en cours de reconstruction refuse les
intentions pendant quelques secondes (statut `rebuilding` diffusé au WebSocket), les
autres continuent. C'est l'avantage concret de l'invariant 4 : **le schéma d'état de jeu
n'a pas de coût de migration.**

#### (b) Changement sur une table de **zone A** (plateforme)

Protocole étendre/contracter, sur trois déploiements :

| Phase | Migration | Code |
|---|---|---|
| **Étendre** | `ADD COLUMN new_col … NULL` + index | écrit dans l'ancienne **et** la nouvelle colonne ; lit l'ancienne |
| **Remplir** | aucune (tâche applicative `pnpm db:backfill <nom>`, idempotente, par lots de 500) | inchangé |
| **Contracter** | `DROP COLUMN old_col` après un déploiement complet vérifié | lit et écrit la nouvelle uniquement |

Entre les phases, on laisse passer au moins un déploiement **et** on vérifie
`SELECT count(*) FROM t WHERE new_col IS NULL`. Contracter le même jour qu'on étend est
la façon la plus courante de perdre des données.

#### (c) Changement du **format d'un payload d'événement** ou des **règles du jeu**

On ne réécrit **jamais** le journal.

- Format de payload : upcaster (§3.8) + bump de `payload_version` pour les **nouveaux**
  événements seulement.
- Règle de jeu (ex. le souffle plafonne à +9 au lieu de +10) : la campagne est épinglée
  sur `campaigns.rules_version`. Le moteur garde les variantes indexées par version ; une
  campagne existante ne change de règles que par un acte explicite du propriétaire, qui
  émet `system.rules_version_migrated` — donc l'histoire montre où le changement a pris
  effet, et un rejeu antérieur reste fidèle.
- Format de contenu (`schemaVersion` d'un fichier) : le chargeur accepte les versions
  N et N-1 et normalise vers N en mémoire. Les personnages existants sont protégés par
  `sheet_snapshot_json`.

**Ce qu'on ne fait pas** : un `UPDATE` de masse sur `events.payload_json`. C'est
impossible (triggers) et ce serait une falsification d'archive.

### 5.4 Garde-fous de migration en CI

| Contrôle | Commande | Ce qu'il attrape |
|---|---|---|
| Schéma généré == schéma déclaré | `pnpm db:check-schema` | quelqu'un a modifié un `.ts` sans générer la migration |
| Dump normalisé == `schema.expected.sql` | idem | une migration qui ne produit pas le DDL de ce document |
| Migration depuis zéro | `pnpm db:migrate` sur base vide | SQL invalide |
| Migration depuis la **release précédente** | applique les migrations sur `test/fixtures/db/prev-release.sqlite` (commité, ~200 Ko) | une migration qui casse sur des données réelles |
| Append-only préservé | `test/db/append-only.test.ts` | triggers perdus par une reconstruction de table |
| Intégrité post-migration | `pnpm db:check` (§7.3) | FK orphelines, jauges hors bornes, trous de séquence |

`test/fixtures/db/prev-release.sqlite` est régénéré à chaque release par le workflow de
déploiement (dump de la base de démo après migration) et commité. C'est le test de
migration le plus rentable du projet.

---

## 6. Exploiter le fichier SQLite : sauvegarde et restauration

Section écrite pour quelqu'un qui administre le VPS, pas pour le développeur.

### 6.1 Où vit la base

```
/srv/feeders/
├── data/
│   ├── app.db            ← la base
│   ├── app.db-wal        ← journal d'écriture (WAL)
│   └── app.db-shm        ← index mémoire partagée
├── content/              ← contenu versionné (image Docker, en lecture seule)
├── backups/
└── docker-compose.yml
```

`/srv/feeders/data` est monté en volume dans le conteneur `server` à `/app/data`.
`DATABASE_URL=file:/app/data/app.db`.

### 6.2 La règle numéro un

> **Ne copiez jamais `app.db` seul avec `cp`, `rsync` ou `scp` pendant que le service
> tourne.**

En mode WAL, les écritures récentes sont dans `app.db-wal`, pas dans `app.db`. Une copie
brute du seul `.db` donne une base **silencieusement amputée** des dernières minutes de
jeu — et elle s'ouvrira sans erreur, ce qui est pire. Les trois fichiers copiés ensemble,
non atomiquement, peuvent aussi donner un WAL incohérent avec sa base.

La bonne méthode tient en une ligne, sans arrêter le service :

```bash
sqlite3 /srv/feeders/data/app.db "VACUUM INTO '/srv/feeders/backups/app-$(date -u +%Y%m%dT%H%M%SZ).db'"
```

`VACUUM INTO` prend un instantané transactionnellement cohérent, intègre le WAL, compacte
et défragmente, et écrit **un seul fichier** directement restaurable. Les lecteurs et
écrivains continuent pendant l'opération.

Alternative équivalente si `sqlite3` n'est pas installé sur l'hôte :

```bash
docker compose exec -T server node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/app.db', { readonly: true });
  db.exec(\"VACUUM INTO '/app/data/../backups/app-$(date -u +%Y%m%dT%H%M%SZ).db'\");
"
```

### 6.3 Script de sauvegarde

`/srv/feeders/bin/backup.sh` (mode 0750, propriétaire `root`) :

```bash
#!/usr/bin/env bash
set -euo pipefail

DB=/srv/feeders/data/app.db
DIR=/srv/feeders/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DIR/app-$STAMP.db"

mkdir -p "$DIR"

# 1. Instantané cohérent (n'interrompt pas le service).
sqlite3 "$DB" "VACUUM INTO '$OUT'"

# 2. Vérification : une sauvegarde non vérifiée n'est pas une sauvegarde.
sqlite3 "$OUT" "PRAGMA integrity_check;"   | grep -qx ok || { echo "FAIL integrity"; exit 1; }
sqlite3 "$OUT" "PRAGMA foreign_key_check;" | grep -q .    && { echo "FAIL fk"; exit 1; }
test "$(sqlite3 "$OUT" 'SELECT count(*) FROM events;')" -gt 0

# 3. Compression + chiffrement (la base contient des identités Discord).
zstd -19 -q --rm "$OUT"
age -r "$(cat /srv/feeders/backup.pub)" -o "$OUT.zst.age" "$OUT.zst" && rm "$OUT.zst"

# 4. Copie hors-site.
restic -r "$RESTIC_REPO" backup "$OUT.zst.age" --tag feeders-db

# 5. Rétention locale : 14 quotidiennes, 8 hebdomadaires.
find "$DIR" -name 'app-*.db.zst.age' -mtime +14 \
     ! -name "*$(date -u -d 'last sunday' +%Y%m%d)*" -delete

echo "OK $OUT.zst.age ($(du -h "$OUT.zst.age" | cut -f1))"
```

Planification (`/etc/cron.d/feeders`) :

```
# Toutes les 6 h, et juste avant chaque déploiement (le workflow l'appelle en SSH).
0 */6 * * * root /srv/feeders/bin/backup.sh >> /var/log/feeders-backup.log 2>&1
```

La clé privée `age` n'est **pas** sur le VPS. Elle est dans le gestionnaire de mots de
passe de l'équipe. Une sauvegarde chiffrée avec une clé qui ne survit pas à la
compromission du serveur est la seule qui vaille quelque chose.

### 6.4 Réplication continue (recommandé dès qu'il y a de vrais joueurs)

Les sauvegardes toutes les 6 h acceptent une perte de 6 h de partie. Litestream réplique
le WAL en continu vers un stockage objet et ramène la perte à quelques secondes, pour un
conteneur de plus et zéro changement applicatif :

```yaml
# docker-compose.yml (extrait)
litestream:
  image: litestream/litestream:0.3
  command: replicate -config /etc/litestream.yml
  volumes:
    - ./data:/app/data
    - ./litestream.yml:/etc/litestream.yml:ro
  restart: unless-stopped
```

```yaml
# litestream.yml
dbs:
  - path: /app/data/app.db
    replicas:
      - type: s3
        bucket: feeders-backups
        path: app.db
        retention: 720h
        snapshot-interval: 6h
```

Les deux mécanismes sont complémentaires : Litestream couvre la panne matérielle,
`VACUUM INTO` chiffré couvre l'erreur humaine et la compromission.

### 6.5 Restauration

**Perte totale ou corruption.**

```bash
# 1. Arrêter les écrivains. Ne JAMAIS restaurer sous un service actif.
cd /srv/feeders && docker compose stop server litestream

# 2. Mettre de côté l'état actuel — y compris le WAL et le SHM.
mkdir -p /srv/feeders/incident-$(date -u +%F)
mv data/app.db data/app.db-wal data/app.db-shm /srv/feeders/incident-$(date -u +%F)/ 2>/dev/null || true

# 3a. Depuis une sauvegarde chiffrée :
age -d -i ~/.age/feeders.key /srv/feeders/backups/app-20260917T060000Z.db.zst.age \
  | zstd -d -o /srv/feeders/data/app.db

# 3b. Ou depuis Litestream (point de restauration le plus récent) :
litestream restore -config /etc/litestream.yml -o /srv/feeders/data/app.db /app/data/app.db

# 4. Vérifier AVANT de rouvrir le service.
sqlite3 data/app.db "PRAGMA integrity_check;"     # doit afficher : ok
sqlite3 data/app.db "PRAGMA foreign_key_check;"   # doit ne rien afficher
sqlite3 data/app.db "SELECT count(*) FROM events;"
sqlite3 data/app.db "SELECT id, name, seq FROM campaigns ORDER BY updated_at DESC LIMIT 5;"

# 5. Droits et redémarrage.
chown 10001:10001 data/app.db && chmod 600 data/app.db
docker compose up -d

# 6. Contrôles applicatifs (trous de séquence, jauges hors bornes, FK logiques).
docker compose exec server pnpm db:check
```

**Récupérer une seule campagne** (erreur limitée, on ne veut pas tout revenir en arrière) :

```bash
# Restaurer la sauvegarde dans un fichier de côté, puis exporter/importer la campagne.
pnpm db:export-campaign --db /tmp/restored.db --campaign 01J... --out /tmp/camp.jsonl
pnpm db:import-campaign --db /srv/feeders/data/app.db --in /tmp/camp.jsonl --as-new
```

L'export est un JSONL du journal (`events` dans l'ordre de `seq`) plus les lignes de
zone A nécessaires. Puisque tout est rejouable, importer un journal **suffit** à
reconstituer une campagne : c'est le format d'archive du projet, et il est lisible à
l'œil nu.

**Base corrompue sans sauvegarde utilisable** (dernier recours) :

```bash
sqlite3 app.db ".recover" | sqlite3 app-recovered.db
sqlite3 app-recovered.db "PRAGMA integrity_check;"
```

`.recover` récupère plus de données que `.dump` sur une base endommagée. Le résultat perd
les triggers et certains index : réappliquer `pnpm db:migrate` derrière, puis
`pnpm db:check`.

### 6.6 Exercice de restauration et purge

- **Exercice trimestriel, noté dans l'agenda de l'équipe** : restaurer la dernière
  sauvegarde sur une machine jetable, lancer le serveur, ouvrir la campagne de démo.
  Une procédure de restauration jamais exécutée est une procédure qui ne marche pas.
- **Avant chaque déploiement** : le workflow GitHub Actions appelle `backup.sh` en SSH
  et échoue le déploiement si la sauvegarde échoue.
- **Purge RGPD** (`pnpm db:purge-player <playerId> --confirm`) : c'est la **seule**
  opération autorisée à supprimer des lignes d'`events`. Elle, et elle seule, a le droit
  de faire `DROP TRIGGER events_no_delete` … `CREATE TRIGGER` dans une transaction. En
  pratique elle **anonymise** plutôt qu'elle ne supprime : `players` passe en
  `deleted_at` avec identité remplacée par `joueur-anonyme-<n>`, les
  `narration.player_message` du joueur voient leur texte remplacé par
  `[message supprimé]` via un événement `system.correction`, et le reste du journal —
  les jets, les jauges, les serments — est conservé parce qu'il constitue l'histoire
  partagée des autres joueurs. Le script produit un rapport et exige une sauvegarde de
  moins d'une heure.

### 6.7 Surveillance

Un contrôle de santé simple vaut mieux qu'un tableau de bord jamais regardé.
`GET /healthz` renvoie 200 si et seulement si :

```
PRAGMA quick_check = ok
taille de app.db-wal < 64 Mo        (sinon : checkpoint bloqué par un lecteur long)
âge de la dernière sauvegarde < 8 h
espace libre sur /srv > 20 %
contenu chargé : hash == hash attendu du manifeste
```

---

## 7. Fixtures et seed

### 7.1 La campagne de démonstration

Fichier : `packages/db/src/seed/demo.ts`. Elle existe pour **quatre** usages : lancer
l'appli en local en une commande, servir de base aux tests de bout en bout, servir de
fixture de migration (§5.4), et donner au harnais d'éval IA un état de jeu réaliste.

Contenu de `pnpm db:seed` :

| Élément | Détail |
|---|---|
| Joueurs | 4 : `demo-mj` (propriétaire), `demo-braum`, `demo-ashe`, `demo-sejuani`. Identifiants Discord factices `900000000000000001`+ |
| Campagne | « Le Pacte de la Griffe-de-Givre », slug `pacte-griffe-de-givre`, `status: 'active'`, 3 vérités choisies |
| Personnages | Braum (fer 3), Ashe (vif 3), Sejuani (cœur 3) — trois fiches **écrites à la main** |
| Verrous | 3 champions `reserved_pc`, 6 `allowed_npc` (Olaf, Lissandra, Volibear, Udyr, Trundle, Gragas), le reste implicite |
| Séances | 2 : une close (`ordinal: 1`, 180 événements) et une en cours (`ordinal: 2`, 64 événements) |
| Journal | **244 événements**, couvrant **au moins un exemplaire de chacun des 69 types** — c'est une assertion du seed, pas un vœu |
| Jets | au moins un de chaque : réussite franche, partielle, échec, présage, souffle brûlé, souffle négatif annulé, plafonnement à 10 |
| Serments | 1 accompli (*dangereux*), 1 en cours (*redoutable*, 17 crans), 1 abandonné |
| Horloges | 1 à 3/6 visible, 1 à 5/8 cachée du MJ |
| Entités | 11 (4 PNJ, 3 lieux, 2 factions, 2 fils) |
| Chroniques | 6 en couche 0, 2 en couche 1, 1 en couche 2 — textes **écrits à la main**, aucun appel IA |
| Instantanés | 2 (`rolling` à seq 180, `session_end` à seq 180) |
| Annulation | 1 `system.reverted` sur une cascade de 3 événements, pour que le chemin soit testé |

### 7.2 Déterminisme du seed

Le seed est **totalement déterministe** : mêmes ULID, mêmes horodatages, mêmes dés.

```ts
export const DEMO_SEED = {
  rngSeed: '00'.repeat(32),                  // graine maître de la campagne de démo
  epoch: Date.UTC(2026, 0, 15, 20, 0, 0),    // t0 fixe
  ulid: monotonicUlidFactory('01JQ0000000000000000000000'),
};
```

Conséquence : `pnpm db:seed` deux fois produit deux bases **identiques octet pour
octet** après `VACUUM`. La CI le vérifie (`test/db/seed-deterministic.test.ts` compare
les sha256). Sans ça, le corpus de cas dorés dériverait sans qu'on le voie.

Commandes :

```bash
pnpm db:reset      # supprime data/app.db*, migre, seed  ← la commande du quotidien
pnpm db:migrate    # applique les migrations en attente
pnpm db:seed       # seed sur une base déjà migrée (idempotent : no-op si déjà semée)
pnpm db:seed --force
pnpm db:rebuild    # reconstruit les projections depuis le journal
pnpm db:check      # contrôles d'intégrité (§7.3)
pnpm db:snapshot <campaignId>
pnpm db:export-campaign / db:import-campaign
```

`pnpm db:reset` doit refuser de s'exécuter si `NODE_ENV=production` ou si la base
contient une campagne dont le propriétaire n'est pas un joueur de démo. Cette garde a
coûté cinq lignes et évite l'accident qu'on ne raconte pas.

### 7.3 `pnpm db:check` — les oracles d'intégrité

Contrôles exécutés en CI après seed, après migration et après reconstruction. Chacun
renvoie zéro ligne en cas de succès ; toute ligne renvoyée fait échouer la commande.

| # | Contrôle | Requête / méthode |
|---|---|---|
| 1 | Intégrité SQLite | `PRAGMA integrity_check` |
| 2 | FK physiques | `PRAGMA foreign_key_check` |
| 3 | FK logiques | `characters.player_id`, `campaign_members.character_id`, `events.play_session_id`, `chronicles.ai_call_id` sans cible |
| 4 | Densité de séquence | `SELECT campaign_id FROM events GROUP BY campaign_id HAVING max(seq) <> count(*) OR min(seq) <> 1` |
| 5 | Compteur cohérent | `events.max(seq)` == `campaigns.seq` pour chaque campagne |
| 6 | Bornes des jauges | redondant avec les `CHECK`, vérifié quand même après reconstruction |
| 7 | Verrous de distribution | aucun `entity` de type `npc` dont le `champion_id` est `reserved_pc` |
| 8 | Instantanés | pour chaque instantané : rejeu depuis zéro jusqu'à `seq`, comparaison de `state_hash` |
| 9 | **Reconstruction idempotente** | dump des projections → `db:rebuild` → dump → comparaison octet à octet |
| 10 | Payloads | chaque `events.payload_json` repasse `GameEventSchema` après `upcast` |
| 11 | Chroniques | `covers_from_seq`/`covers_to_seq` contigus par couche, aucun trou, aucune ligne vivante chevauchante |
| 12 | Contenu | `campaigns.content_pack_hash` présent dans `content_packs` |

Le contrôle 9 est l'oracle central de l'invariant 4, et le contrôle 8 celui de la
politique d'instantanés. Un agent qui casse le réducteur les voit rougir en moins d'une
minute.

### 7.4 Fixtures pour le simulateur de table headless

`packages/engine/test/fixtures/` :

```
fixtures/
├── content/                      # bundle MINIMAL valide (2 champions, 3 mouvements,
│                                 # 1 table de prix, 2 oracles) — tests rapides et lisibles
├── scripts/                      # scénarios du simulateur, JSONL d'intentions
│   ├── first-session.jsonl
│   ├── all-outcomes.jsonl        # force chaque issue de jet
│   ├── momentum-edge-cases.jsonl # souffle négatif annulé, brûlé, plafonné
│   └── vow-fulfilled.jsonl
├── dice/                         # séquences de dés scriptées, une par scénario
│   └── all-outcomes.json         # { "action": [1,6,3,…], "challenge-a": […], … }
└── golden/                       # état attendu + journal attendu, un fichier par scénario
    ├── all-outcomes.state.json
    └── all-outcomes.events.jsonl
```

Le simulateur (`pnpm sim <scenario>`) tourne **sans navigateur et sans appel IA** : il
instancie le moteur, injecte le `Rng` scripté et un MJ factice qui renvoie des narrations
fixes, consomme le JSONL d'intentions et écrit l'état et le journal obtenus. Les fichiers
`golden/` sont régénérés par `pnpm sim --update-golden`, et toute différence non
intentionnelle apparaît en diff lisible dans la PR. C'est le dispositif qui répond
directement à l'objectif de M0 : savoir en quelques secondes si on a cassé quelque chose.

---

## 8. Points laissés ouverts

Ils n'empêchent pas M0 d'avancer, mais il faut les trancher avant M2.

1. **Nommage `campaigns`/`tables` et `players`/`users` (§0.5).** Le seul point qui doit
   être tranché **avant** `0000_initial.sql`. Après, c'est une migration de renommage sur
   quinze tables. Recommandation ci-dessus ; il faut une décision, pas un consensus.
2. **Taille du seed.** `01-architecture.md` annonce « ~40 événements », ce document en
   prescrit 244 avec couverture des 69 types. Les deux servent : 40 pour démarrer l'appli
   en local, 244 pour les tests. Proposition : un seul seed à 244, et un drapeau
   `--minimal` qui s'arrête à la fin de la première scène.
3. **Chiffrement au repos.** La base contient des identités Discord et des textes de
   joueurs. SQLCipher fermerait le sujet mais ajoute une dépendance native et complique
   les sauvegardes. Position retenue pour M0 : disque du VPS chiffré, sauvegardes
   chiffrées par `age`, base en clair. À revoir si la table dépasse le cercle privé.
4. **Recherche plein texte** dans le journal et les chroniques (« où a-t-on vu Olaf ? »).
   FTS5 est disponible dans SQLite, mais c'est une table à maintenir en cohérence avec une
   projection. Décidé hors M0 ; à traiter comme une projection de plus, reconstruite par
   `db:rebuild`.
5. **Plusieurs personnages par joueur** dans une même campagne (compagnon, remplaçant
   après une mort). L'index `characters_active_player_uq` l'interdit aujourd'hui. Le
   relâcher plus tard ne coûte qu'une migration d'index.
6. **Portée du cache des fiches forgées** : global (`campaign_id IS NULL`) ou par
   campagne. Le schéma supporte les deux ; la politique de revue (`requireForgeReview`)
   n'est pas encore décidée pour le cas global.
7. **Purge des `ai_calls`.** `request_json` est volumineux. Rétention proposée : payload
   complet 30 jours, puis métriques seules. À confirmer avec les besoins du harnais d'éval.
