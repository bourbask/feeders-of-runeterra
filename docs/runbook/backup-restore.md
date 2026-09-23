# Runbook — sauvegarde et restauration

Pour quelqu'un qui administre le VPS. Autorité : `docs/design/03-donnees.md` §6 et
`docs/design/01-architecture.md` §9.5. En cas de divergence, c'est la spécification qui gagne.

---

## 0. La règle numéro un

> **Ne copiez jamais `app.db` seul avec `cp`, `rsync` ou `scp` pendant que le service tourne.**

En mode WAL, les écritures récentes sont dans `app.db-wal`, pas dans `app.db`. Une copie brute
du seul `.db` donne une base **silencieusement amputée** des dernières minutes de jeu — et elle
s'ouvrira sans erreur, ce qui est pire qu'un échec franc. Copier les trois fichiers ensemble,
non atomiquement, peut aussi donner un WAL incohérent avec sa base.

La bonne méthode, sans arrêter le service :

```bash
sqlite3 /srv/feeders/data/app.db \
  "VACUUM INTO '/srv/feeders/backups/app-$(date -u +%Y%m%dT%H%M%SZ).db'"
```

`VACUUM INTO` prend un instantané transactionnellement cohérent, intègre le WAL, compacte, et
écrit **un seul fichier** directement restaurable. Les lecteurs et les écrivains continuent
pendant l'opération.

C'est exactement ce que fait `infra/scripts/backup.sh`, en y ajoutant la vérification.

---

## 1. Où vivent les fichiers

```
/srv/feeders/
├── data/
│   ├── app.db            ← la base
│   ├── app.db-wal        ← journal d'écriture (WAL)
│   └── app.db-shm        ← index mémoire partagée
├── backups/              ← app-YYYYMMDDTHHMMSSZ.db.zst
├── bin/{backup,restore,deploy}.sh   ← copiés depuis infra/scripts/, mode 0750, root
└── incident-<horodatage>/           ← créé par restore.sh, jamais effacé automatiquement
```

`/srv/feeders/data` est monté dans le conteneur à `/app/data`, et
`DATABASE_PATH=/app/data/app.db`.

---

## 2. Sauvegarder

```bash
sudo /srv/feeders/bin/backup.sh
```

Ce que le script fait, dans l'ordre, et pourquoi chaque étape est là :

| Étape                 | Ce qu'elle attrape                                                            |
| --------------------- | ----------------------------------------------------------------------------- |
| `VACUUM INTO`         | base source illisible, disque plein                                             |
| `PRAGMA integrity_check` sur **la copie** | rien qu'on sache provoquer — défense en profondeur (voir ci-dessous) |
| `PRAGMA foreign_key_check` sur la copie   | incohérence relationnelle invisible à `integrity_check`     |
| `count(*) FROM events` | un `VACUUM INTO` sur le mauvais fichier : schéma en place, journal vide        |
| `zstd -19 --rm`       | —                                                                               |
| rétention             | —                                                                               |

**Une sauvegarde non vérifiée n'est pas une sauvegarde.** Les deux `PRAGMA` portent sur la
copie, jamais sur l'original : c'est la copie qu'on restaurera, et une base source saine ne
garantit rien sur ce qui a été écrit à côté.

### Ce que `integrity_check` sur la copie ne peut pas attraper

Il faut être honnête sur celui-là, parce qu'une version antérieure de ce tableau lui attribuait
« page corrompue recopiée à l'identique » : **c'est faux**. `VACUUM INTO` ne recopie pas des
pages, il reconstruit une base neuve en relisant les données par le moteur SQLite. Une page
abîmée de la source fait échouer le `VACUUM INTO` lui-même (ligne du dessus), elle ne ressort
jamais à l'identique dans la copie. Le contrôle est donc **infalsifiable depuis l'extérieur** :
aucune base d'entrée ne le fait échouer.

Il reste, et la spécification l'exige (`03-donnees.md` §6). C'est de la défense en profondeur
contre ce qu'on ne prévoit pas — un bogue de SQLite, un disque qui ment, un `VACUUM INTO`
interrompu — et il coûte une seconde. Mais **il ne compte pas comme un filet prouvé**, puisqu'on
ne sait pas écrire l'entrée qui le déclenche. Les filets prouvés de `backup.sh` sont les trois
autres.

En cas d'échec, le fichier partiel est **détruit** (`trap … EXIT`). Une sauvegarde tronquée qui
traîne dans le dossier est une sauvegarde que quelqu'un restaurera un jour de panique.

Codes de sortie : `0` écrite et vérifiée · `1` échec · `2` mauvais usage.

### Réglages

| Variable                | Défaut                     |
| ----------------------- | -------------------------- |
| `FEEDERS_DB`            | `/srv/feeders/data/app.db` |
| `FEEDERS_BACKUP_DIR`    | `/srv/feeders/backups`     |
| `FEEDERS_KEEP_DAILY`    | `14`                       |
| `FEEDERS_KEEP_WEEKLY`   | `8`                        |

Rétention : **14 quotidiennes + 8 hebdomadaires**. Écrite à la main dans le script plutôt qu'en
`find -mtime`, parce que le `find … ! -name "*$(date -d 'last sunday')*"` de la spécification ne
préserve qu'**un** dimanche, pas huit — et l'écart ne se voit pas avant le deuxième mois
d'exploitation.

### Avant M0-11 : un contrôle qui se saute tout seul

La table `events` n'existe pas tant que le schéma n'a pas été migré (M0-11). Le contrôle
« au moins un événement » est donc conditionné à l'existence de la table, et le script écrit
`pas de table « events » … contrôle sauté` quand elle manque. Sans cette condition, la
sauvegarde pré-déploiement du tout premier déploiement échouerait, et avec elle le déploiement.

**À revoir après M0-11** : une fois le schéma en place, une base sans aucun événement est
anormale, et le contrôle devient inconditionnel.

### Planification

`/etc/cron.d/feeders` :

```cron
# Toutes les 6 h. Le workflow de déploiement l'appelle en plus, en SSH, juste avant chaque
# bascule (03-donnees.md §6.6).
0 */6 * * * root /srv/feeders/bin/backup.sh >> /var/log/feeders-backup.log 2>&1
```

Six heures de sauvegarde, c'est six heures de partie acceptées comme perte maximale. C'est un
choix, pas un oubli : voir Litestream, plus bas.

---

## 3. Restaurer

**Perte totale ou corruption.**

```bash
cd /srv/feeders

# 1. Arrêter les écrivains. On ne restaure JAMAIS sous un service actif.
docker compose stop app

# 2. Restaurer (le script met l'état actuel de côté tout seul). Il décrit ce
#    qu'il va remplacer et attend que vous tapiez « oui ».
sudo ./bin/restore.sh --archive backups/app-20260921T060000Z.db.zst

# 3. Rouvrir.
docker compose up -d

# 4. Contrôles applicatifs : trous de séquence, jauges hors bornes, FK logiques.
docker compose exec app pnpm db:check
```

`restore.sh` refuse quatre choses, et ce sont les erreurs qu'on commet sous stress :

1. **restaurer pendant que `app` tourne** — on écraserait un WAL vivant et on obtiendrait une
   base incohérente, silencieusement. Le script interroge `docker compose ps` et s'arrête ;
2. **écraser l'état actuel sans le mettre de côté** — l'état corrompu est la seule pièce à
   conviction pour comprendre l'incident, et parfois la seule copie des dernières minutes de
   jeu. Il part dans `<--incident-dir>/incident-<horodatage>/`, avec le WAL et le SHM ;
3. **toucher à l'état existant avant d'avoir un remplaçant vérifié** — l'archive est dépliée
   dans un fichier temporaire *à côté* de la cible, et c'est **ce temporaire** qui passe
   `integrity_check` et `foreign_key_check`. L'ancienne base ne bouge qu'ensuite, et la bascule
   finale est un `mv` sur le même système de fichiers, donc atomique. Une archive illisible, de
   mauvaise extension, ou compressée avec un outil absent, laisse donc `data/app.db` **intact** ;
4. **agir sans confirmation** — sans `--yes`, le script décrit ce qu'il va détruire et attend
   qu'on tape `oui`. Sans terminal et sans `--yes`, il refuse plutôt que d'attendre pour rien.

### L'ordre des étapes, et pourquoi il compte

```
valider l'archive (extension, zstd/age, clé)   ← aucun effet de bord
  → vérifier qu'aucun service n'écrit
  → déplier dans <cible>.restore-<pid>
  → integrity_check + foreign_key_check sur CE fichier
  → demander confirmation
  → déplacer l'état existant dans incident-<horodatage>/
  → mv <cible>.restore-<pid> → <cible>
```

Tout ce qui peut échouer sans dépendre de l'état échoue **avant** la première modification du
disque. C'est le contraire d'une préférence de style : la version précédente de ce script
déplaçait la base vivante en deuxième étape, et une archive au mauvais nom suffisait à vider
`data/` sans rien restaurer.

`chown 10001:10001` + `chmod 600` sont posés à la fin — 10001 est l'UID de l'utilisateur `app`
de l'image, et l'hôte ne connaît pas les noms d'utilisateur du conteneur.

Formats acceptés : `.db`, `.db.zst`, et `.db.zst.age` (chemin post-M0, voir §5).

### Où part l'état mis de côté

`--incident-dir` (défaut : `$FEEDERS_COMPOSE_DIR`, donc `/srv/feeders`). L'emplacement est
**explicite** et ne se déduit pas de `--db` : le déduire donnerait, pour un
`--db /tmp/restored.db`, un `/incident-<horodatage>` à la racine du système de fichiers.

### Récupérer une seule campagne

Erreur limitée à une partie : on ne veut pas tout revenir en arrière.

```bash
sudo ./bin/restore.sh --archive backups/app-20260921T060000Z.db.zst \
  --db /tmp/restored.db --incident-dir /tmp --no-service-check --yes
pnpm db:export-campaign --db /tmp/restored.db --campaign 01J... --out /tmp/camp.jsonl
pnpm db:import-campaign --db /srv/feeders/data/app.db --in /tmp/camp.jsonl --as-new
```

`--incident-dir /tmp` parce qu'on restaure **hors** de `/srv/feeders` : sans lui, un
`/tmp/restored.db` laissé d'un passage précédent partirait dans `/srv/feeders/incident-*`, à
côté des vraies pièces à conviction. Cette recette se relance autant de fois qu'on veut : c'est
le deuxième passage qui compte, celui où `/tmp/restored.db` existe déjà.

L'export est un JSONL du journal (`events` dans l'ordre de `seq`) plus les lignes de zone A
nécessaires. Puisque tout est rejouable (invariant 4), importer un journal **suffit** à
reconstituer une campagne : c'est le format d'archive du projet, et il est lisible à l'œil nu.

### Dernier recours : base corrompue sans sauvegarde utilisable

```bash
sqlite3 app.db ".recover" | sqlite3 app-recovered.db
sqlite3 app-recovered.db "PRAGMA integrity_check;"
```

`.recover` récupère plus de données que `.dump` sur une base endommagée. Le résultat perd les
triggers et certains index : réappliquer `pnpm db:migrate` derrière, puis `pnpm db:check`.

---

## 4. L'exercice, et pourquoi il n'est pas facultatif

- **Trimestriel, noté dans l'agenda de l'équipe** : restaurer la dernière sauvegarde sur une
  machine jetable, lancer le serveur, ouvrir la campagne de démo. *Une procédure de restauration
  jamais exécutée est une procédure qui ne marche pas.*
- **Avant chaque déploiement** : le workflow appelle `backup.sh` en SSH et échoue le déploiement
  si la sauvegarde échoue.
- **Une fois en M0** : la restauration est testée pour de bon (case de sortie de M0-30).

Exercice à blanc, sans VPS, sur n'importe quel poste :

```bash
tmp="$(mktemp -d)"
sqlite3 "$tmp/app.db" "CREATE TABLE events (id INTEGER PRIMARY KEY, seq INTEGER NOT NULL);
                       INSERT INTO events (seq) VALUES (1), (2), (3);"
FEEDERS_DB="$tmp/app.db" FEEDERS_BACKUP_DIR="$tmp/backups" infra/scripts/backup.sh
infra/scripts/restore.sh --archive "$tmp"/backups/app-*.db.zst \
  --db "$tmp/restored.db" --incident-dir "$tmp" --no-service-check --yes
```

Et la contre-épreuve, qui est la partie qu'on saute toujours — une archive qui n'en est pas une
ne doit **rien** casser :

```bash
: > "$tmp/pas-une-archive.tar.gz"
infra/scripts/restore.sh --archive "$tmp/pas-une-archive.tar.gz" \
  --db "$tmp/app.db" --incident-dir "$tmp" --no-service-check --yes
# sortie 1, et "$tmp/app.db" est toujours là, avec ses trois événements :
sqlite3 "$tmp/app.db" 'SELECT count(*) FROM events;'   # 3
```

---

## 5. Ce qui s'active au premier joueur réel

Trois lignes à décommenter, aucun chantier. Tant qu'il n'y a **aucun joueur**, il n'y a aucune
identité Discord à protéger ni aucune minute de partie à perdre, et une clé `age` à gérer est un
coût d'exploitation sans contrepartie.

### Chiffrement et copie hors site

Dans `infra/scripts/backup.sh`, décommenter :

```bash
age -r "$(cat /srv/feeders/backup.pub)" -o "$OUT.zst.age" "$OUT.zst" && rm -f "$OUT.zst"
restic -r "$RESTIC_REPO" backup "$OUT.zst.age" --tag feeders-db
```

Et remplacer `app-*.db.zst` par `app-*.db.zst.age` dans la boucle de rétention.

La clé privée `age` n'est **pas** sur le VPS. Elle est dans le gestionnaire de mots de passe de
l'équipe. Une sauvegarde chiffrée avec une clé qui ne survit pas à la compromission du serveur
est la seule qui vaille quelque chose.

### Litestream

Les sauvegardes toutes les 6 h acceptent une perte de 6 h de partie. Litestream réplique le WAL
en continu vers un stockage objet et ramène la perte à quelques secondes, pour un conteneur de
plus et **zéro changement applicatif**.

Dans `infra/docker-compose.yml` :

```yaml
litestream:
  image: litestream/litestream:0.3
  command: replicate -config /etc/litestream.yml
  volumes:
    - ${FEEDERS_DATA_DIR:-/srv/feeders/data}:/app/data
    - ./litestream.yml:/etc/litestream.yml:ro
  restart: unless-stopped
```

`infra/litestream.yml` :

```yaml
dbs:
  - path: /app/data/app.db
    replicas:
      - type: s3
        bucket: feeders-backups
        path: app.db
        retention: 720h
        snapshot-interval: 6h
```

Restauration depuis Litestream, à la place de l'étape 2 du §3 :

```bash
litestream restore -config /etc/litestream.yml -o /srv/feeders/data/app.db /app/data/app.db
```

Et penser à `docker compose stop app litestream` — pas seulement `app`.

Les deux mécanismes sont **complémentaires** : Litestream couvre la panne matérielle,
`VACUUM INTO` chiffré couvre l'erreur humaine et la compromission. Ni l'un ni l'autre ne
remplace l'autre.

---

## 6. Purge RGPD

`pnpm db:purge-player <playerId> --confirm` est la **seule** opération autorisée à supprimer des
lignes d'`events`, et la seule à avoir le droit de faire `DROP TRIGGER events_no_delete` …
`CREATE TRIGGER` dans une transaction.

En pratique elle **anonymise** plutôt qu'elle ne supprime : `players` passe en `deleted_at` avec
identité remplacée par `joueur-anonyme-<n>`, les `narration.player_message` du joueur voient
leur texte remplacé par `[message supprimé]` via un événement `system.correction`, et le reste
du journal — les jets, les jauges, les serments — est conservé, parce qu'il constitue l'histoire
partagée des autres joueurs.

Le script produit un rapport et **exige une sauvegarde de moins d'une heure**.

---

## 7. Surveillance

Un contrôle de santé simple vaut mieux qu'un tableau de bord jamais regardé.
`GET /api/admin/health` (admin uniquement) renvoie, et lui seul :

```
PRAGMA quick_check = ok
taille de app.db-wal < 64 Mo        (sinon : checkpoint bloqué par un lecteur long)
âge de la dernière sauvegarde < 8 h
espace libre sur /srv > 20 %
contenu chargé : hash == hash attendu du manifeste
```

`/healthz` et `/readyz` ne font **jamais** de contrôle profond. Sans quoi une sauvegarde en
retard suffirait à sortir le conteneur de la rotation, donc à couper le service : le
diagnostic déclencherait la panne qu'il est censé prévenir.
