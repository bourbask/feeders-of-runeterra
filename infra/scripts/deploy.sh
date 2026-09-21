#!/usr/bin/env bash
#
# Mise en ligne et retour arrière (01-architecture.md §9.3).
#
# Ce script s'exécute SUR LE VPS, appelé en SSH par
# .github/workflows/deploy.yml — ou à la main un jour de panne, ce qui est le
# cas qui compte vraiment. Il ne contient donc aucun secret, aucune adresse,
# aucune clé : tout vient de l'environnement ou de `/srv/feeders/.env`.
#
# Ce qu'il tient :
#   - l'étiquette déployée est écrite sur disque AVANT le basculement, et la
#     précédente conservée. Un retour arrière ne dépend donc pas de la mémoire
#     de celui qui déploie, ni du contenu d'un onglet GitHub encore ouvert ;
#   - `up -d --wait` attend le HEALTHCHECK de l'image : une migration échouée
#     au démarrage laisse l'ancien conteneur en place ;
#   - `/readyz` est vérifié APRÈS, de l'extérieur, parce que le healthcheck
#     interne ne dit rien de Caddy ni du certificat.
#
# Ce qu'il ne tient PAS, volontairement : la restauration de sauvegarde. Un
# retour arrière d'image sans migration appliquée ne doit pas toucher les
# données ; restaurer « par précaution » perdrait les parties jouées depuis la
# sauvegarde. C'est `restore.sh`, à la main, avec quelqu'un qui a lu le
# runbook.
#
# Prérequis : bash 4+, docker (avec le greffon compose), curl.

set -euo pipefail

COMPOSE_DIR="${FEEDERS_COMPOSE_DIR:-/srv/feeders}"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
ETAT="$COMPOSE_DIR/.deploy-state"
READYZ_URL="${FEEDERS_READYZ_URL:-}"
TENTATIVES="${FEEDERS_READYZ_RETRIES:-10}"
DELAI="${FEEDERS_READYZ_DELAY:-6}"

usage() {
  cat <<'USAGE'
Usage : deploy.sh <commande> [étiquette]

  deploy <étiquette>   tire l'image, bascule, vérifie /readyz ; revient en
                       arrière tout seul si la vérification échoue
  rollback [étiquette] repointe sur l'étiquette précédente connue (ou celle
                       donnée) et bascule
  current              affiche l'étiquette déployée et la précédente

Environnement :
  FEEDERS_COMPOSE_DIR    défaut /srv/feeders
  FEEDERS_READYZ_URL     ex. https://feeders.example.com/readyz
                         (sinon lu depuis PUBLIC_URL de $FEEDERS_COMPOSE_DIR/.env)
  FEEDERS_READYZ_RETRIES défaut 10
  FEEDERS_READYZ_DELAY   défaut 6 (secondes entre deux tentatives)

Sorties : 0 succès · 1 échec · 2 mauvais usage
USAGE
}

echec() {
  echo "deploy : ÉCHEC — $1" >&2
  exit 1
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

# Ces deux-là rendent une chaîne vide plutôt qu'un code d'erreur quand le
# fichier d'état n'existe pas encore. Sinon, sous `set -e`, le tout premier
# déploiement — celui sans état antérieur — s'arrêterait avant de commencer.
etiquette_courante() {
  if [ -f "$ETAT" ]; then
    sed -n 's/^current=//p' "$ETAT" | tail -n 1
  fi
  return 0
}

etiquette_precedente() {
  if [ -f "$ETAT" ]; then
    sed -n 's/^previous=//p' "$ETAT" | tail -n 1
  fi
  return 0
}

ecrire_etat() {
  printf 'current=%s\nprevious=%s\n' "$1" "$2" > "$ETAT"
}

# L'étiquette est injectée par `FEEDERS_TAG` dans le compose ; on la persiste
# dans `.env` pour que `docker compose up` relancé à la main sur le VPS
# reparte sur la même image, et pas sur `latest`.
fixer_etiquette() {
  local tag="$1"
  local env_file="$COMPOSE_DIR/.env"
  touch "$env_file"
  if grep -q '^FEEDERS_TAG=' "$env_file"; then
    sed -i "s|^FEEDERS_TAG=.*|FEEDERS_TAG=$tag|" "$env_file"
  else
    printf 'FEEDERS_TAG=%s\n' "$tag" >> "$env_file"
  fi
}

url_readyz() {
  if [ -n "$READYZ_URL" ]; then
    printf '%s' "$READYZ_URL"
    return 0
  fi
  local base
  base="$(sed -n 's/^PUBLIC_URL=//p' "$COMPOSE_DIR/.env" 2>/dev/null | tail -n 1)"
  [ -n "$base" ] || return 1
  printf '%s/readyz' "${base%/}"
}

verifier_readyz() {
  local url
  if ! url="$(url_readyz)"; then
    echo "deploy : note — ni FEEDERS_READYZ_URL ni PUBLIC_URL ; vérification externe sautée." >&2
    return 0
  fi
  local i
  for ((i = 1; i <= TENTATIVES; i++)); do
    if curl -fsS --max-time 10 "$url" > /dev/null; then
      echo "deploy : /readyz vert à la tentative $i"
      return 0
    fi
    echo "deploy : /readyz pas encore prêt ($i/$TENTATIVES)"
    sleep "$DELAI"
  done
  return 1
}

basculer() {
  local tag="$1"
  fixer_etiquette "$tag"
  compose pull || echec "impossible de tirer l'image étiquetée « $tag »"
  # `--wait` s'appuie sur le HEALTHCHECK de l'image : sans lui, `up -d` rend
  # la main sur un conteneur qui n'a pas fini de migrer.
  compose up -d --wait || return 1
}

[ $# -ge 1 ] || { usage >&2; exit 2; }
commande="$1"
shift

[ -f "$COMPOSE_FILE" ] || echec "composition introuvable : $COMPOSE_FILE"
command -v docker >/dev/null 2>&1 || echec "« docker » est introuvable sur cet hôte"

case "$commande" in
  current)
    echo "current=$(etiquette_courante)"
    echo "previous=$(etiquette_precedente)"
    ;;

  deploy)
    [ $# -eq 1 ] || { echo "deploy : il faut exactement une étiquette" >&2; usage >&2; exit 2; }
    nouvelle="$1"
    ancienne="$(etiquette_courante)"

    echo "deploy : $ancienne -> $nouvelle"

    if ! basculer "$nouvelle" || ! verifier_readyz; then
      echo "deploy : bascule ou /readyz en échec." >&2
      if [ -n "$ancienne" ]; then
        echo "deploy : retour arrière automatique sur « $ancienne »." >&2
        if basculer "$ancienne"; then
          echo "deploy : retour arrière effectué." >&2
        else
          echo "deploy : LE RETOUR ARRIÈRE A ÉCHOUÉ AUSSI — intervention humaine requise." >&2
        fi
      else
        echo "deploy : aucune étiquette précédente connue, rien à quoi revenir." >&2
      fi
      # Les données ne sont PAS restaurées ici : voir l'entête.
      exit 1
    fi

    ecrire_etat "$nouvelle" "$ancienne"
    echo "deploy : OK — $nouvelle est en ligne (précédente : ${ancienne:-aucune})"
    ;;

  rollback)
    cible="${1:-$(etiquette_precedente)}"
    [ -n "$cible" ] || echec "aucune étiquette précédente connue et aucune donnée en argument"
    courante="$(etiquette_courante)"

    echo "deploy : retour arrière $courante -> $cible"
    basculer "$cible" || echec "le retour arrière sur « $cible » a échoué"
    verifier_readyz || echec "« $cible » est en ligne mais /readyz reste rouge"

    ecrire_etat "$cible" "$courante"
    echo "deploy : OK — retour arrière sur $cible"
    ;;

  *)
    echo "deploy : commande inconnue « $commande »" >&2
    usage >&2
    exit 2
    ;;
esac
