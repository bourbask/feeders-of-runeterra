#!/usr/bin/env bash
#
# Sauvegarde vérifiée de la base SQLite (03-donnees.md §6.2 et §6.3).
#
# LA RÈGLE NUMÉRO UN : on ne copie JAMAIS `app.db` avec cp/rsync/scp pendant
# que le service tourne. En mode WAL, les écritures récentes sont dans
# `app.db-wal` ; une copie brute du seul `.db` donne une base silencieusement
# amputée des dernières minutes de jeu, et elle s'ouvrira sans erreur — ce qui
# est pire qu'un échec. `VACUUM INTO` prend un instantané transactionnellement
# cohérent, intègre le WAL, et écrit un seul fichier directement restaurable,
# sans interrompre les lecteurs ni les écrivains.
#
# Une sauvegarde non vérifiée n'est pas une sauvegarde : ce script refuse de
# sortir en 0 s'il n'a pas pu relire ce qu'il vient d'écrire.
#
# Périmètre M0 : VACUUM INTO, integrity_check, foreign_key_check, zstd,
# rétention locale. Le chiffrement `age` et la copie hors site `restic` sont
# écrits plus bas, commentés, et s'activent au premier joueur réel — voir
# docs/runbook/backup-restore.md. Il n'y a aucune identité Discord à protéger
# tant qu'il n'y a aucun joueur, et une clé `age` à gérer dès maintenant est un
# coût d'exploitation sans contrepartie.
#
# Prérequis : bash 4+, sqlite3, zstd, GNU coreutils (`date -d`).

set -euo pipefail

DB="${FEEDERS_DB:-/srv/feeders/data/app.db}"
DIR="${FEEDERS_BACKUP_DIR:-/srv/feeders/backups}"
KEEP_DAILY="${FEEDERS_KEEP_DAILY:-14}"
KEEP_WEEKLY="${FEEDERS_KEEP_WEEKLY:-8}"

usage() {
  cat <<'USAGE'
Usage : backup.sh [--db CHEMIN] [--dir CHEMIN] [--keep-daily N] [--keep-weekly N]

  --db           base source          (défaut : $FEEDERS_DB, sinon /srv/feeders/data/app.db)
  --dir          dossier de sortie    (défaut : $FEEDERS_BACKUP_DIR, sinon /srv/feeders/backups)
  --keep-daily   quotidiennes gardées (défaut : 14)
  --keep-weekly  hebdomadaires gardées (défaut : 8)

Sorties : 0 sauvegarde écrite et vérifiée · 1 échec (la sauvegarde est détruite)
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --keep-daily) KEEP_DAILY="$2"; shift 2 ;;
    --keep-weekly) KEEP_WEEKLY="$2"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "backup : argument inconnu « $1 »" >&2; usage >&2; exit 2 ;;
  esac
done

echec() {
  echo "backup : ÉCHEC — $1" >&2
  exit 1
}

for outil in sqlite3 zstd; do
  command -v "$outil" >/dev/null 2>&1 || echec "« $outil » est introuvable sur cet hôte"
done

[ -f "$DB" ] || echec "la base « $DB » n'existe pas"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DIR/app-$STAMP.db"

mkdir -p "$DIR"

# Le fichier partiel ne doit jamais survivre à un échec : une sauvegarde
# tronquée qui traîne dans le dossier est une sauvegarde que quelqu'un
# restaurera un jour de panique.
nettoyer() {
  rm -f "$OUT" "$OUT.zst"
}
trap nettoyer EXIT

# ── 1. Instantané cohérent ───────────────────────────────────────────────────
# N'interrompt pas le service. Échoue si la base source est illisible : c'est
# le premier des trois filets.
sqlite3 "$DB" "VACUUM INTO '$OUT'" || echec "VACUUM INTO a échoué (base illisible ou disque plein)"

# ── 2. Vérification de la copie, pas de l'original ───────────────────────────
integrite="$(sqlite3 "$OUT" 'PRAGMA integrity_check;')" || echec "la copie est illisible par sqlite3"
[ "$integrite" = "ok" ] || echec "integrity_check : $integrite"

fk="$(sqlite3 "$OUT" 'PRAGMA foreign_key_check;')" || echec "foreign_key_check n'a pas pu s'exécuter"
[ -z "$fk" ] || echec "foreign_key_check a rapporté des violations : $fk"

# Une base au schéma en place mais sans le moindre événement est le signe d'un
# `VACUUM INTO` sur le mauvais fichier. Le contrôle ne s'applique que si la
# table existe : avant M0-11 il n'y a pas encore de schéma, et refuser de
# sauvegarder pour cette raison bloquerait le tout premier déploiement.
a_table_events="$(sqlite3 "$OUT" "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'events';")"
if [ "$a_table_events" -eq 1 ]; then
  nb_events="$(sqlite3 "$OUT" 'SELECT count(*) FROM events;')"
  [ "$nb_events" -gt 0 ] || echec "la copie ne contient aucun événement — mauvais fichier source ?"
else
  echo "backup : note — pas de table « events » (schéma pas encore migré, M0-11) ; contrôle sauté."
fi

# ── 3. Compression ───────────────────────────────────────────────────────────
zstd -19 -q --rm "$OUT" || echec "compression zstd"

# À décommenter au premier joueur réel, pas avant (voir l'entête) :
#
#   # Chiffrement : la base contiendra des identités Discord.
#   age -r "$(cat /srv/feeders/backup.pub)" -o "$OUT.zst.age" "$OUT.zst" && rm -f "$OUT.zst"
#   # Copie hors site : une sauvegarde qui ne survit pas à la perte du VPS n'en est pas une.
#   restic -r "$RESTIC_REPO" backup "$OUT.zst.age" --tag feeders-db
#
# La clé privée `age` ne vit PAS sur le VPS : elle est dans le gestionnaire de
# mots de passe de l'équipe. Une sauvegarde chiffrée avec une clé qui ne
# survit pas à la compromission du serveur est la seule qui vaille.

# La sauvegarde est complète : le filet de nettoyage n'a plus lieu d'être.
trap - EXIT

# ── 4. Rétention : 14 quotidiennes + 8 hebdomadaires ─────────────────────────
# Écrit à la main plutôt qu'en `find -mtime` : un `! -name "*$(date -d 'last
# sunday')*"` ne préserve qu'UN dimanche, pas huit, et l'écart ne se voit pas
# avant le deuxième mois d'exploitation.
maintenant="$(date -u +%s)"
limite_hebdo=$((KEEP_WEEKLY * 7))
supprimees=0

for archive in "$DIR"/app-*.db.zst; do
  [ -e "$archive" ] || continue

  base="$(basename "$archive")"
  horodatage="${base#app-}"
  horodatage="${horodatage%%.db.zst}"

  # app-YYYYMMDDTHHMMSSZ.db.zst — tout autre nom n'est pas à nous : on n'y touche pas.
  if ! [[ "$horodatage" =~ ^([0-9]{4})([0-9]{2})([0-9]{2})T[0-9]{6}Z$ ]]; then
    continue
  fi
  annee="${BASH_REMATCH[1]}"
  mois="${BASH_REMATCH[2]}"
  jour="${BASH_REMATCH[3]}"

  epoch_archive="$(date -u -d "$annee-$mois-$jour" +%s)"
  age_jours=$(((maintenant - epoch_archive) / 86400))

  if [ "$age_jours" -lt "$KEEP_DAILY" ]; then
    continue
  fi

  jour_semaine="$(date -u -d "$annee-$mois-$jour" +%u)" # 7 = dimanche
  if [ "$jour_semaine" = "7" ] && [ "$age_jours" -lt "$limite_hebdo" ]; then
    continue
  fi

  rm -f "$archive"
  supprimees=$((supprimees + 1))
done

taille="$(du -h "$OUT.zst" | cut -f1)"
echo "backup : OK $OUT.zst ($taille) — $supprimees archive(s) expirée(s) supprimée(s)"
