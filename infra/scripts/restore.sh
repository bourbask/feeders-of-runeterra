#!/usr/bin/env bash
#
# Restauration de la base SQLite (03-donnees.md §6.5).
#
# Procédure pas à pas, y compris ce qu'il ne faut PAS faire :
# docs/runbook/backup-restore.md. Ce script en exécute le chemin nominal et
# refuse de dévier.
#
# Deux refus tenus par le code, parce que ce sont les deux erreurs que l'on
# commet sous stress :
#   1. restaurer pendant que le service écrit — on écrase un WAL vivant et on
#      obtient une base incohérente, silencieusement ;
#   2. écraser l'état actuel sans le mettre de côté — l'état corrompu est la
#      seule pièce à conviction pour comprendre l'incident, et parfois la
#      seule copie des dernières minutes de jeu.
#
# Prérequis : bash 4+, sqlite3, zstd.

set -euo pipefail

ARCHIVE=""
DB="${FEEDERS_DB:-/srv/feeders/data/app.db}"
COMPOSE_DIR="${FEEDERS_COMPOSE_DIR:-/srv/feeders}"
ASSUME_YES=0
SKIP_SERVICE_CHECK=0

usage() {
  cat <<'USAGE'
Usage : restore.sh --archive CHEMIN [--db CHEMIN] [--yes] [--no-service-check]

  --archive            sauvegarde à restaurer (.db, .db.zst, ou .db.zst.age)
  --db                 base cible          (défaut : $FEEDERS_DB, sinon /srv/feeders/data/app.db)
  --yes                ne pas demander confirmation (usage automatisé)
  --no-service-check   ne pas vérifier qu'aucun service n'écrit
                       (à n'utiliser que sur une machine jetable)

Sorties : 0 base restaurée et vérifiée · 1 échec · 2 mauvais usage
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --archive) ARCHIVE="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --no-service-check) SKIP_SERVICE_CHECK=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "restore : argument inconnu « $1 »" >&2; usage >&2; exit 2 ;;
  esac
done

echec() {
  echo "restore : ÉCHEC — $1" >&2
  exit 1
}

[ -n "$ARCHIVE" ] || { usage >&2; exit 2; }
[ -f "$ARCHIVE" ] || echec "l'archive « $ARCHIVE » n'existe pas"

command -v sqlite3 >/dev/null 2>&1 || echec "« sqlite3 » est introuvable sur cet hôte"

# ── 1. Aucun écrivain ────────────────────────────────────────────────────────
if [ "$SKIP_SERVICE_CHECK" -eq 0 ]; then
  if command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_DIR/docker-compose.yml" ]; then
    actifs="$(docker compose -f "$COMPOSE_DIR/docker-compose.yml" ps --status running --services 2>/dev/null || true)"
    if printf '%s\n' "$actifs" | grep -qx app; then
      echec "le service « app » tourne encore. Arrêtez-le d'abord :
    cd $COMPOSE_DIR && docker compose stop app
  On ne restaure JAMAIS sous un service actif."
    fi
  fi
fi

# ── 2. Mettre l'état actuel de côté — WAL et SHM compris ────────────────────
if [ -f "$DB" ]; then
  incident="$(dirname "$DB")/../incident-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$incident"
  for fichier in "$DB" "$DB-wal" "$DB-shm"; do
    # `[ -e ] && mv` échouerait la boucle sous `set -e` dès que le WAL est
    # absent — ce qui est le cas normal après un arrêt propre.
    if [ -e "$fichier" ]; then
      mv "$fichier" "$incident/"
    fi
  done
  echo "restore : état précédent mis de côté dans $incident"
fi

# ── 3. Déplier l'archive ─────────────────────────────────────────────────────
mkdir -p "$(dirname "$DB")"

case "$ARCHIVE" in
  *.db.zst.age)
    # Chemin post-M0 : le chiffrement s'active au premier joueur réel.
    command -v age >/dev/null 2>&1 || echec "« age » est introuvable et l'archive est chiffrée"
    command -v zstd >/dev/null 2>&1 || echec "« zstd » est introuvable"
    cle="${FEEDERS_AGE_KEY:-$HOME/.age/feeders.key}"
    [ -f "$cle" ] || echec "clé de déchiffrement introuvable : $cle"
    age -d -i "$cle" "$ARCHIVE" | zstd -d -o "$DB" || echec "déchiffrement ou décompression"
    ;;
  *.db.zst)
    command -v zstd >/dev/null 2>&1 || echec "« zstd » est introuvable"
    zstd -d -q -o "$DB" "$ARCHIVE" || echec "décompression zstd"
    ;;
  *.db)
    cp "$ARCHIVE" "$DB"
    ;;
  *)
    echec "extension inconnue : attendu .db, .db.zst ou .db.zst.age"
    ;;
esac

# ── 4. Vérifier AVANT de rouvrir le service ──────────────────────────────────
integrite="$(sqlite3 "$DB" 'PRAGMA integrity_check;')" ||
  echec "la base restaurée est illisible par sqlite3 — l'archive n'en était pas une"
[ "$integrite" = "ok" ] || echec "integrity_check sur la base restaurée : $integrite"

fk="$(sqlite3 "$DB" 'PRAGMA foreign_key_check;')" ||
  echec "foreign_key_check n'a pas pu s'exécuter sur la base restaurée"
[ -z "$fk" ] || echec "foreign_key_check sur la base restaurée : $fk"

if [ "$(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'events';")" -eq 1 ]; then
  echo "restore : $(sqlite3 "$DB" 'SELECT count(*) FROM events;') événement(s) dans le journal"
  sqlite3 "$DB" 'SELECT id, name, seq FROM campaigns ORDER BY updated_at DESC LIMIT 5;' || true
fi

# ── 5. Droits ────────────────────────────────────────────────────────────────
# 10001:10001 est l'utilisateur `app` de l'image (infra/Dockerfile). L'hôte ne
# connaît pas ce nom : c'est l'UID qui fait foi.
if [ "$(id -u)" -eq 0 ]; then
  chown 10001:10001 "$DB"
  chmod 600 "$DB"
else
  echo "restore : note — pas root, droits inchangés. Sur le VPS : chown 10001:10001 $DB && chmod 600 $DB"
fi

if [ "$ASSUME_YES" -eq 0 ]; then
  echo
  echo "restore : base restaurée et vérifiée. Il reste à :"
  echo "  1. cd $COMPOSE_DIR && docker compose up -d"
  echo "  2. docker compose exec app pnpm db:check   # les douze oracles d'intégrité"
fi

echo "restore : OK $DB"
