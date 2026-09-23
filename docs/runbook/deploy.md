# Runbook — déploiement

Ce document s'adresse à quelqu'un qui administre le VPS, pas au développeur qui code une
fonctionnalité. Il décrit ce qui existe, ce qui n'existe pas encore, et quoi faire quand ça
casse.

Autorité : `docs/design/01-architecture.md` §9. En cas de divergence, c'est la spécification
qui gagne et ce document qui est faux.

---

## 0. État au jalon M0

**Rien n'est déployé, et rien ne peut l'être encore.** Ni le VPS, ni le domaine, ni les secrets
n'existent. M0-04 livre les fichiers, les scripts et cette procédure ; le premier déploiement
réel est une case de M0-30.

Deux conséquences concrètes, à ne pas prendre pour des pannes :

- l'étape `runtime` de `infra/Dockerfile` **ne peut pas** encore réussir : elle copie
  `packages/server/dist/main.js` (M0-20) et `packages/client/dist/` (M0-19), qui n'existent pas.
  Ce qui est vérifiable aujourd'hui, c'est `docker build --target build`, et c'est ce que fait
  le critère d'acceptation de M0-04 ;
- le travail `deploy` de `.github/workflows/deploy.yml` restera en attente d'approbation tant
  que l'environnement GitHub `production` n'aura pas été créé. C'est le comportement voulu.

---

## 1. Pourquoi il n'y aura jamais deux instances

SQLite en mode WAL suppose **un écrivain unique**. Deux processus `app` sur le même fichier :

- corrompraient la sérialisation par campagne — deux requêtes concurrentes sur la même partie
  peuvent écrire deux événements au même `seq`, et le journal cesse d'être rejouable
  (invariant 4) ;
- perdraient les tampons de narration, qui vivent en mémoire de processus : un joueur verrait
  la moitié d'une scène selon l'instance qui a reçu sa trame.

`deploy.replicas: 1` dans `infra/docker-compose.yml` n'est donc **pas un réglage de capacité**.
C'est une contrainte d'intégrité, et elle est vérifiée mécaniquement :

```bash
test "$(docker compose -f infra/docker-compose.yml config | grep -c 'replicas: 1')" -eq 1
```

Monter en charge horizontalement exige de changer de base de données. C'est une décision
d'architecture, à prendre par le tech lead avec un ADR, pas un réglage de déploiement.

Le corollaire pratique : pendant une bascule, il y a une coupure. Elle dure le temps du
healthcheck du nouveau conteneur, quelques secondes. On ne cherche pas à la supprimer par un
déploiement bleu/vert, parce qu'un bleu/vert sur SQLite, c'est précisément deux écrivains.

---

## 2. L'image

`infra/Dockerfile`, quatre étapes, **une seule image** qui sert l'API et les fichiers statiques
du client.

| Étape     | Ce qu'elle fait                                                 | Pourquoi elle est séparée                                               |
| --------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `base`    | Node 24 Alpine, corepack                                          | socle commun, aucune couche inutile dans l'image finale                  |
| `deps`    | `python3 make g++`, puis `pnpm fetch` depuis le verrou **seul**   | toucher une source ne réinvalide pas le téléchargement des dépendances   |
| `build`   | `pnpm install --offline`, `turbo run build`, `pnpm deploy --prod` | l'endroit — et le seul — où un module natif est compilé                  |
| `runtime` | copie du repli `/prod/server` + `client/dist`, UID 10001          | ni compilateur C++, ni sources, ni devDependencies dans ce qui tourne    |

Trois points qui ont une raison précise :

- **`pnpm fetch` plutôt que onze `COPY packages/*/package.json`.** Docker ne sait pas copier un
  glob en préservant l'arborescence : il faudrait une ligne par paquet, à tenir à jour à la
  main, et une ligne oubliée donne une installation silencieusement incomplète. `pnpm fetch` ne
  lit que `pnpm-lock.yaml`.
- **`--offline` à l'installation.** Si quelque chose manque au magasin peuplé par `pnpm fetch`,
  on veut un échec bruyant, pas un appel réseau qui rendrait la construction non reproductible.
- **UID 10001, pas l'utilisateur `node` (1000) de l'image amont.** L'hôte ne connaît pas les
  noms d'utilisateur du conteneur : c'est l'UID qui doit correspondre au
  `chown 10001:10001 /srv/feeders/data` de la procédure de restauration.

### Repli vers Debian, décidé d'avance

Si la compilation native sur Alpine (musl) devient instable — `better-sqlite3` arrive en M0-11 —,
le repli est `node:24-bookworm-slim`. Deux changements, pas plus :

1. `ARG NODE_IMAGE=node:24-bookworm-slim` en tête de `infra/Dockerfile` ;
2. remplacer `apk add --no-cache python3 make g++` par
   `apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*`.

La décision est prise ici, à froid. On ne débat pas d'une distribution de base un soir de
déploiement rouge.

### Ce que le healthcheck dit, et ce qu'il ne dit pas

`HEALTHCHECK` interroge `/healthz`, qui est une sonde de **liveness** et ne touche pas la base
(`docs/design/03-donnees.md` §6.7). Un WAL volumineux ou une sauvegarde vieillissante ne doivent
pas sortir le conteneur de la rotation — sans quoi une sauvegarde en retard suffirait à couper
le service.

C'est ce healthcheck qu'attend `docker compose up -d --wait`. Les migrations s'appliquent au
démarrage du processus, avant `listen()` : une migration échouée empêche le healthcheck de
devenir vert, le conteneur redémarre, et **l'ancien reste en place**.

Les trois sondes, à ne jamais confondre :

| Route                | Rôle         | Utilisée par                                 |
| -------------------- | ------------ | -------------------------------------------- |
| `/healthz`           | liveness     | `HEALTHCHECK` de l'image                      |
| `/readyz`            | readiness    | `deploy.sh` et le workflow, depuis l'extérieur |
| `/api/admin/health`  | diagnostic   | un humain, après un incident                  |

---

## 3. La composition

`infra/docker-compose.yml` : deux services, `app` et `caddy`. Sur le VPS, il vit à
`/srv/feeders/docker-compose.yml`, avec `.env` à côté.

```
/srv/feeders/
├── docker-compose.yml
├── Caddyfile
├── .env                  ← secrets, mode 600, jamais versionné
├── .deploy-state         ← étiquette courante et précédente, écrit par deploy.sh
├── bin/{deploy,backup,restore}.sh   ← copiés depuis infra/scripts/, mode 0750
├── data/                 ← app.db, app.db-wal, app.db-shm (volume du conteneur)
└── backups/
```

`app` n'expose **aucun port** sur l'hôte : Caddy est la seule porte d'entrée et joint `app` par
le réseau interne de la composition.

Caddy fait la terminaison TLS (`infra/Caddyfile`), HSTS un an, compression, et traite
séparément l'upgrade WebSocket :

```
@ws {
    header Connection *Upgrade*
    header Upgrade websocket
}
reverse_proxy @ws app:8787 {
    flush_interval -1
}
```

`flush_interval -1` n'est pas cosmétique. Avec le tampon par défaut, les trames `s2c.*`
s'accumulent côté proxy et la narration arrive par paquets : le jeu devient saccadé **sans
qu'aucune erreur n'apparaisse nulle part**. C'est le genre de bug qu'on met une soirée à
attribuer au proxy.

`preload` est volontairement absent de l'en-tête HSTS : l'inscription à la liste de
préchargement des navigateurs est difficile à défaire, et on ne s'y engage pas avant d'avoir un
domaine définitif.

### Reproduire la production en local

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up app
```

En nommant `app`, on ne réveille pas Caddy — il n'y a ni domaine ni certificat en local. Ce
n'est **pas** la boucle de développement quotidienne : celle-là, c'est `pnpm dev`, sans
conteneur. On vient ici quand quelque chose marche en local et pas en ligne.

---

## 4. Le workflow

`.github/workflows/deploy.yml`, déclenché sur `workflow_run` de la CI (branche `main`) et à la
main.

1. **garde** : `github.event.workflow_run.conclusion == 'success'`. Un `workflow_run` se
   déclenche aussi quand la CI échoue ; sans cette garde, un `main` rouge partirait en
   production ;
2. **checkout du bon commit** : `workflow_run` place le contexte sur le commit par défaut, pas
   sur celui qui a déclenché la CI. Le `ref` est nommé explicitement ;
3. **image** : construite et poussée vers `ghcr.io/<dépôt>:sha-<7>` et `:latest` ;
4. **approbation manuelle** via l'environnement GitHub `production` ;
5. **sauvegarde pré-déploiement** en SSH. Si elle échoue, le déploiement échoue — c'est le seul
   moment où l'on est sûr de pouvoir revenir en arrière sans perte ;
6. **bascule** : `deploy.sh deploy <étiquette>` sur le VPS ;
7. **vérification `/readyz` depuis Internet**, 10 tentatives espacées de 6 s. Le healthcheck
   interne ne dit rien de Caddy, du certificat, ni du DNS ;
8. **retour arrière automatique** si la vérification échoue.

`concurrency: deploy-production` avec `cancel-in-progress: false` : un seul déploiement à la
fois, et surtout **pas** d'annulation en cours de route. Interrompre un `compose up` laisse le
VPS dans un état que personne n'a décrit.

### Secrets et variables à créer

Environnement GitHub `production` :

| Nom                        | Type     | Ce que c'est                                        |
| -------------------------- | -------- | --------------------------------------------------- |
| `DEPLOY_HOST`              | secret   | nom d'hôte du VPS                                    |
| `DEPLOY_USER`              | secret   | compte de déploiement, avec `sudo` sur les 3 scripts |
| `DEPLOY_SSH_KEY`           | secret   | clé privée **dédiée au déploiement**, sans phrase    |
| `DEPLOY_SSH_KNOWN_HOSTS`   | secret   | empreinte d'hôte (`ssh-keyscan <hôte>`)              |
| `NARRATOR_API_KEY`         | secret   | injectée dans `.env` du VPS, pas dans l'image        |
| `DISCORD_CLIENT_ID`        | secret   | idem                                                 |
| `DISCORD_CLIENT_SECRET`    | secret   | idem                                                 |
| `SESSION_SECRET`           | secret   | 32 octets minimum, idem                              |
| `PUBLIC_URL`               | variable | ex. `https://feeders.example.com`                    |

`PUBLIC_URL` est une **variable** et non un secret : elle apparaît dans l'URL d'environnement
affichée par GitHub, et `.github/actionlint.yaml` la déclare dans `config-variables` pour qu'une
coquille (`vars.PUBLIC_URLL`) soit une erreur de lint plutôt qu'une chaîne vide découverte dix
minutes plus tard dans un `curl`. C'est mesuré dans les deux sens : avec le fichier, actionlint
sort en 1 sur `vars.PUBLIC_URLL` ; sans lui, en 0.

`config-variables` y porte l'**union** des variables des deux tâches qui touchent des workflows :
`PUBLIC_URL` (M0-04) et les trois `NARRATOR_*` (M0-03). Ce n'est pas un doublon à départager à la
fusion : la liste est exhaustive par construction, donc ne garder que la moitié ferait sortir
actionlint en 1 sur les workflows de l'autre tâche.

Pas de `StrictHostKeyChecking=no` dans le workflow : accepter n'importe quel hôte revient à
déployer sur le premier serveur qui répond à ce nom.

---

## 5. Déployer, revenir en arrière, à la main

Les trois scripts sont conçus pour être exécutables **sans GitHub**, parce que c'est le cas qui
compte vraiment : un jour de panne, on ne veut pas dépendre d'une interface web.

```bash
ssh <utilisateur>@<hôte>
sudo /srv/feeders/bin/deploy.sh current              # quelle étiquette tourne, et laquelle avant
sudo /srv/feeders/bin/deploy.sh deploy sha-a1b2c3d   # bascule + /readyz + retour arrière auto
sudo /srv/feeders/bin/deploy.sh rollback             # revient à l'étiquette précédente connue
```

### `.deploy-state`, écrit en deux temps

`/srv/feeders/.deploy-state` n'est pas écrit d'un coup. Il l'est en deux temps, et c'est ce qui
permet de survivre à une interruption :

1. **avant la bascule**, une ligne `pending=<nouvelle étiquette>` s'ajoute à l'état scellé.
   `current` et `previous` ne bougent pas : ils désignent toujours le dernier déploiement
   réellement vérifié ;
2. **après un `/readyz` vert**, l'état est refermé : `current=<nouvelle>`, `previous=<ancienne>`,
   plus de `pending`.

Si le processus meurt entre les deux — session SSH coupée, terminal fermé, VPS redémarré —, le
fichier garde son `pending`. `deploy.sh current` le signale alors en toutes lettres, et
`deploy.sh rollback` revient sur la dernière étiquette **scellée**, c'est-à-dire celle que la
bascule interrompue était en train de remplacer. Sans ce `pending`, `rollback` repointerait sur
`previous` et **sauterait la version réellement remplacée**.

```
$ sudo /srv/feeders/bin/deploy.sh current
current=sha-a1b2c3d
previous=sha-9f8e7d6
pending=sha-4c5d6e7
deploy : ATTENTION — une bascule vers « sha-4c5d6e7 » a été entamée et jamais scellée.
```

Un retour arrière ne dépend donc ni de la mémoire de celui qui déploie, ni d'un onglet GitHub
encore ouvert.

`FEEDERS_TAG` dans `/srv/feeders/.env` suit la même discipline : si le `docker compose pull`
échoue, le script **remet la valeur précédente**. Sans cela, un `docker compose up -d` lancé à
la main derrière — le geste naturel du tableau §6 — tenterait de démarrer une image qui n'a
jamais pu être tirée.

### Ce que le retour arrière ne fait pas

`deploy.sh rollback` repointe l'**image**. Il ne restaure **pas** les données, et c'est
délibéré : restaurer « par précaution » effacerait les parties jouées depuis la dernière
sauvegarde. Si une migration a été appliquée et qu'il faut revenir en arrière sur le schéma,
c'est `restore.sh`, à la main, avec `docs/runbook/backup-restore.md` sous les yeux et quelqu'un
qui l'a lu.

**C'est un écart assumé avec `docs/design/01-architecture.md` §9.3 point 5**, qui demande une
restauration « seulement si une migration a été appliquée ». Rien, aujourd'hui, ne permet de
savoir qu'une migration a été appliquée : les migrations arrivent en M0-11 et M0-14. L'écart est
tracé dans `docs/adr/0004-retour-arriere-et-donnees.md`, à trancher avant M0-14. Tant que
l'ADR n'est pas tranché, c'est la spécification qui a raison et ce comportement qui est
provisoire.

---

## 6. Quand ça casse

| Symptôme                                        | Première chose à regarder                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `up -d --wait` expire                           | `docker compose logs app` — presque toujours une migration qui échoue avant `listen()`          |
| `/readyz` 503 mais le conteneur est vert        | la base : ping SQLite ou migrations en retard. `/healthz` ne teste ni l'un ni l'autre, exprès   |
| `/healthz` vert, rien ne répond depuis Internet | Caddy : certificat, DNS, ou `FEEDERS_DOMAIN` absent de `.env`                                   |
| WebSocket qui se connecte puis rame              | `flush_interval -1` perdu dans le `Caddyfile`                                                   |
| La bascule tourne en boucle                     | `docker compose ps` : `restart: unless-stopped` masque une erreur de démarrage. Lire les logs   |
| « permission denied » sur `/app/data`           | le volume hôte n'est pas `chown 10001:10001`                                                    |
| Certificat réémis à chaque déploiement          | le volume `caddy_data` a été recréé. Il contient les certificats ACME : il se sauvegarde        |

Éprouver l'émission de certificat sans consommer le quota Let's Encrypt : décommenter
`acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` dans le `Caddyfile`. Un
« rate limited » le jour J n'a pas de solution rapide.

---

## 7. Vérifier l'infrastructure sans VPS

Tout ce qui suit tourne sur un poste de développement, sans hôte distant, sans secret, sans
connexion sortante autre que le registre d'images. C'est la porte de M0-04, et elle doit rester
verte.

`hadolint`, `shellcheck` et `actionlint` ne sont pas des dépendances du dépôt : on les lance par
conteneur, ce qui évite d'imposer trois installations à qui touche `infra/` une fois par
trimestre. Les images sont épinglées par étiquette, pas par empreinte — c'est de l'outillage de
lint, pas de la production.

```bash
# 1. L'image se construit jusqu'à l'étape `build` (la suite est M0-30).
docker build -f infra/Dockerfile --target build -t for-m0:build .

# 2. Le Dockerfile est propre, et l'étape runtime n'est pas root.
docker run --rm -i hadolint/hadolint:latest-alpine hadolint - < infra/Dockerfile
grep -qE '^USER (app|[0-9]+)' infra/Dockerfile
grep -q 'HEALTHCHECK' infra/Dockerfile

# 3. La composition est valide, et n'a qu'UN réplica.
docker compose -f infra/docker-compose.yml config > /dev/null
test "$(docker compose -f infra/docker-compose.yml config | grep -c 'replicas: 1')" -eq 1

# 4. Les trois scripts passent shellcheck.
docker run --rm -v "$PWD:/mnt:ro" -w /mnt koalaman/shellcheck:stable infra/scripts/*.sh

# 5. Le workflow de déploiement passe actionlint.
docker run --rm -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:latest .github/workflows/deploy.yml

# 6. Le Caddyfile est valide et formaté. Pas dans les critères de M0-04, mais une
#    faute de frappe ici ne se découvre autrement qu'au premier déploiement.
docker run --rm -v "$PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e FEEDERS_DOMAIN=feeders.example.com -e FEEDERS_ACME_EMAIL=ops@example.com \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
docker run --rm -v "$PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine caddy fmt --diff /etc/caddy/Caddyfile

# 7. La sauvegarde et la restauration font l'aller-retour (voir backup-restore.md §4).
```

Ces commandes ne sont **pas** encore branchées sur la CI : les travaux de `.github/workflows/ci.yml`
appartiennent à M0-03, et `docker build` y est explicitement placé en post-merge pour tenir le
budget de 8 minutes de la porte de PR (`docs/design/01-architecture.md` §8). Tant que ce n'est
pas fait, cette liste se lance à la main quand on touche `infra/`.

---

## 8. Ce qui viendra plus tard

- **Litestream** — pas en M0 : pas de vrais joueurs, donc pas de minutes de partie à perdre. Le
  service compose et son `litestream.yml` sont écrits dans `docs/runbook/backup-restore.md`,
  prêts à être décommentés au premier joueur réel. C'est une ligne à activer, pas un chantier.
- **Chiffrement `age` et copie hors site `restic`** — même raisonnement, même document.
- **Construction complète de l'image** (`--target runtime`) — M0-30.
- **Premier déploiement réel** — M0-30, case 6 de la définition de fini.
