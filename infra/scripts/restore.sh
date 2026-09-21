#!/usr/bin/env bash
#
# Restauration de la base SQLite (03-donnees.md §6.5).
#
# Procédure pas à pas, y compris ce qu'il ne faut PAS faire :
# docs/runbook/backup-restore.md. Ce script en exécute le chemin nominal et
# refuse de dévier.
#
# Quatre refus tenus par le code, parce que ce sont les erreurs que l'on commet
# sous stress :
#   1. restaurer pendant que le service écrit — on écrase un WAL vivant et on
#      obtient une base incohérente, silencieusement ;
#   2. écraser l'état actuel sans le mettre de côté — l'état corrompu est la
#      seule pièce à conviction pour comprendre l'incident, et parfois la
#      seule copie des dernières minutes de jeu ;
#   3. toucher à l'état existant avant d'avoir une base de remplacement
#      LISIBLE ET VÉRIFIÉE — c'est le défaut qui transformait une archive
#      illisible en perte sèche : l'ancienne base était déjà partie ;
#   4. lancer une opération irréversible sans confirmation — `--yes` la saute,
#      et c'est le seul moyen de la sauter.
#
# ORDRE DES ÉTAPES, et il est délibéré :
#   validation de l'archive et de l'outillage → aucun écrivain → dépliage dans
#   un fichier TEMPORAIRE à côté de la cible → vérification de ce temporaire →
#   confirmation → mise de côté de l'état existant → bascule du temporaire.
# Tout ce qui peut échouer sans dépendre de l'état échoue AVANT la première
# modification du disque.
#
# Prérequis : bash 4+, sqlite3, zstd.

set -euo pipefail

ARCHIVE=""
DB="${FEEDERS_DB:-/srv/feeders/data/app.db}"
COMPOSE_DIR="${FEEDERS_COMPOSE_DIR:-/srv/feeders}"
INCIDENT_DIR=""
ASSUME_YES=0
SKIP_SERVICE_CHECK=0

usage() {
  cat <<'USAGE'
Usage : restore.sh --archive CHEMIN [--db CHEMIN] [--incident-dir CHEMIN]
                   [--yes] [--no-service-check]

  --archive            sauvegarde à restaurer (.db, .db.zst, ou .db.zst.age)
  --db                 base cible          (défaut : $FEEDERS_DB, sinon /srv/feeders/data/app.db)
  --incident-dir       où mettre l'état actuel de côté, dans un sous-dossier
                       incident-<horodatage>/
                       (défaut : $FEEDERS_COMPOSE_DIR, sinon /srv/feeders)
  --yes                ne pas demander confirmation (usage automatisé)
  --no-service-check   ne pas vérifier qu'aucun service n'écrit
                       (à n'utiliser que sur une machine jetable)

Sans --yes, le script demande une confirmation explicite avant de déplacer la
base existante. Sans terminal et sans --yes, il refuse plutôt que d'attendre.

Sorties : 0 base restaurée et vérifiée · 1 échec · 2 mauvais usage
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --archive) ARCHIVE="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --incident-dir) INCIDENT_DIR="$2"; shift 2 ;;
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

: "${INCIDENT_DIR:=$COMPOSE_DIR}"

# ── 1. Tout ce qui peut être refusé sans toucher au disque ───────────────────
# Reconnaissance de l'extension, outillage, clé de déchiffrement. Ces trois
# refus étaient AVANT placés après la mise de côté de la base vivante : une
# archive à l'extension inconnue laissait `data/` vide et rien de restauré.
CLE=""
case "$ARCHIVE" in
  *.db.zst.age)
    # Chemin post-M0 : le chiffrement s'active au premier joueur réel.
    command -v age > /dev/null 2>&1 || echec "« age » est introuvable et l'archive est chiffrée"
    command -v zstd > /dev/null 2>&1 || echec "« zstd » est introuvable"
    CLE="${FEEDERS_AGE_KEY:-$HOME/.age/feeders.key}"
    [ -f "$CLE" ] || echec "clé de déchiffrement introuvable : $CLE"
    ;;
  *.db.zst)
    command -v zstd > /dev/null 2>&1 || echec "« zstd » est introuvable"
    ;;
  *.db) ;;
  *)
    echec "extension inconnue : attendu .db, .db.zst ou .db.zst.age"
    ;;
esac

# ── 2. Aucun écrivain ────────────────────────────────────────────────────────
if [ "$SKIP_SERVICE_CHECK" -eq 0 ]; then
  if command -v docker > /dev/null 2>&1 && [ -f "$COMPOSE_DIR/docker-compose.yml" ]; then
    actifs="$(docker compose -f "$COMPOSE_DIR/docker-compose.yml" ps --status running --services 2>/dev/null || true)"
    if printf '%s\n' "$actifs" | grep -qx app; then
      echec "le service « app » tourne encore. Arrêtez-le d'abord :
    cd $COMPOSE_DIR && docker compose stop app
  On ne restaure JAMAIS sous un service actif."
    fi
  fi
fi

# ── 3. Déplier l'archive DANS UN TEMPORAIRE, à côté de la cible ──────────────
# À côté, et non dans /tmp : la bascule finale doit être un `mv` sur le même
# système de fichiers, donc atomique. Un `mv` depuis /tmp serait une copie.
mkdir -p "$(dirname "$DB")"
TMP="$DB.restore-$$"
nettoyer() { rm -f "$TMP" "$TMP-wal" "$TMP-shm"; }
trap nettoyer EXIT

case "$ARCHIVE" in
  *.db.zst.age)
    age -d -i "$CLE" "$ARCHIVE" | zstd -d -o "$TMP" || echec "déchiffrement ou décompression"
    ;;
  *.db.zst)
    zstd -d -q -o "$TMP" "$ARCHIVE" || echec "décompression zstd"
    ;;
  *.db)
    cp "$ARCHIVE" "$TMP"
    ;;
esac

# ── 4. Vérifier le temporaire AVANT de toucher à l'état existant ─────────────
integrite="$(sqlite3 "$TMP" 'PRAGMA integrity_check;')" ||
  echec "l'archive dépliée est illisible par sqlite3 — ce n'en était pas une. $DB est intact."
[ "$integrite" = "ok" ] || echec "integrity_check sur l'archive dépliée : $integrite. $DB est intact."

fk="$(sqlite3 "$TMP" 'PRAGMA foreign_key_check;')" ||
  echec "foreign_key_check n'a pas pu s'exécuter sur l'archive dépliée. $DB est intact."
[ -z "$fk" ] || echec "foreign_key_check sur l'archive dépliée : $fk. $DB est intact."

# ── 5. Confirmer — l'annonce de `--yes` doit correspondre à un vrai refus ────
if [ "$ASSUME_YES" -eq 0 ]; then
  if [ ! -t 0 ]; then
    echec "confirmation impossible (pas de terminal) et --yes absent. Relancez avec --yes."
  fi
  echo
  echo "restore : l'archive est valide. Va être remplacée, de façon irréversible :"
  echo "    $DB"
  if [ -f "$DB" ]; then
    echo "  (l'état actuel part dans $INCIDENT_DIR/incident-<horodatage>/)"
  fi
  printf 'restore : confirmer ? tapez « oui » : '
  read -r reponse
  [ "$reponse" = "oui" ] || echec "annulé à la demande de l'opérateur. $DB est intact."
fi

# ── 6. Mettre l'état actuel de côté — WAL et SHM compris ────────────────────
# Le répertoire d'incident est ancré sur un emplacement EXPLICITE. Il l'était
# avant sur `$(dirname "$DB")/..`, ce qui donnait `/incident-*` à la racine du
# système de fichiers dès que `--db` pointait ailleurs que sur le VPS.
if [ -f "$DB" ]; then
  incident="$INCIDENT_DIR/incident-$(date -u +%Y%m%dT%H%M%SZ)"
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

# ── 7. Basculer ──────────────────────────────────────────────────────────────
mv "$TMP" "$DB"
trap - EXIT

if [ "$(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'events';")" -eq 1 ]; then
  echo "restore : $(sqlite3 "$DB" 'SELECT count(*) FROM events;') événement(s) dans le journal"
fi
if [ "$(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'campaigns';")" -eq 1 ]; then
  sqlite3 "$DB" 'SELECT id, name, seq FROM campaigns ORDER BY updated_at DESC LIMIT 5;' || true
fi

# ── 8. Droits ────────────────────────────────────────────────────────────────
# 10001:10001 est l'utilisateur `app` de l'image (infra/Dockerfile). L'hôte ne
# connaît pas ce nom : c'est l'UID qui fait foi.
if [ "$(id -u)" -eq 0 ]; then
  chown 10001:10001 "$DB"
  chmod 600 "$DB"
else
  echo "restore : note — pas root, droits inchangés. Sur le VPS : chown 10001:10001 $DB && chmod 600 $DB"
fi

echo
echo "restore : base restaurée et vérifiée. Il reste à :"
echo "  1. cd $COMPOSE_DIR && docker compose up -d"
echo "  2. docker compose exec app pnpm db:check   # les douze oracles d'intégrité"

echo "restore : OK $DB"
