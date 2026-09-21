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
#   - `.deploy-state` est écrit en DEUX temps. Avant la bascule, une ligne
#     `pending=<nouvelle>` s'ajoute à l'état scellé ; après un `/readyz` vert,
#     l'état est refermé sur la nouvelle étiquette. Une interruption entre les
#     deux — session SSH coupée, terminal fermé — laisse donc une trace de ce
#     qui était en vol, et `rollback` sait quoi remplacer. Un retour arrière ne
#     dépend ni de la mémoire de celui qui déploie, ni d'un onglet GitHub ;
#   - `up -d --wait` attend le HEALTHCHECK de l'image : une migration échouée
#     au démarrage laisse l'ancien conteneur en place ;
#   - `/readyz` est vérifié APRÈS, de l'extérieur, parce que le healthcheck
#     interne ne dit rien de Caddy ni du certificat ;
#   - `FEEDERS_TAG` dans le `.env` du VPS ne reste JAMAIS sur une étiquette qui
#     n'a pas été tirée : un `pull` en échec restaure la valeur précédente.
#     Sinon un `docker compose up -d` lancé à la main derrière — le geste
#     naturel du runbook — tenterait de démarrer une image inexistante.
#
# Ce qu'il ne tient PAS : la restauration de sauvegarde. `01-architecture.md`
# §9.3 point 5 demande que le retour arrière « restaure la sauvegarde
# SEULEMENT si une migration a été appliquée ». Rien, aujourd'hui, ne permet de
# savoir qu'une migration a été appliquée : les migrations arrivent en M0-11 et
# M0-14. C'est un écart assumé et tracé — voir `docs/adr/0004-retour-arriere-et-donnees.md`,
# qui doit être tranché avant M0-14. En attendant, la restauration est
# `restore.sh`, à la main, avec quelqu'un qui a lu le runbook.
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
                       donnée) et bascule. Si une bascule a été interrompue
                       sans être scellée, revient sur la dernière étiquette
                       scellée plutôt que sur la précédente
  current              affiche l'étiquette déployée, la précédente, et le cas
                       échéant la bascule en vol jamais scellée

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

# Non vide quand une bascule a été entamée et jamais scellée : le processus a
# été interrompu entre `up -d --wait` et la fermeture de l'état.
etiquette_en_cours() {
  if [ -f "$ETAT" ]; then
    sed -n 's/^pending=//p' "$ETAT" | tail -n 1
  fi
  return 0
}

# État scellé : la bascule est terminée et vérifiée.
ecrire_etat() {
  printf 'current=%s\nprevious=%s\n' "$1" "$2" > "$ETAT"
}

# État en vol, écrit AVANT la bascule. `current`/`previous` restent ceux du
# dernier déploiement réussi — on ne les avance qu'une fois `/readyz` vert.
ecrire_etat_en_cours() {
  printf 'current=%s\nprevious=%s\npending=%s\n' "$1" "$2" "$3" > "$ETAT"
}

# L'étiquette est injectée par `FEEDERS_TAG` dans le compose ; on la persiste
# dans `.env` pour que `docker compose up` relancé à la main sur le VPS
# reparte sur la même image, et pas sur `latest`.
etiquette_env() {
  if [ -f "$COMPOSE_DIR/.env" ]; then
    sed -n 's/^FEEDERS_TAG=//p' "$COMPOSE_DIR/.env" | tail -n 1
  fi
  return 0
}

fixer_etiquette() {
  local tag="$1"
  local env_file="$COMPOSE_DIR/.env"
  touch "$env_file"
  if [ -z "$tag" ]; then
    # Pas d'étiquette antérieure à rétablir : on retire la ligne plutôt que de
    # laisser `FEEDERS_TAG=` vide, que compose interpréterait en image `:`.
    sed -i '/^FEEDERS_TAG=/d' "$env_file"
  elif grep -q '^FEEDERS_TAG=' "$env_file"; then
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

# Codes de retour :
#   0 la bascule a eu lieu
#   1 elle a échoué APRÈS avoir touché au conteneur : il faut revenir en arrière
#   2 elle a échoué AVANT d'y toucher (image intirable) : rien n'a bougé
basculer() {
  local tag="$1"
  local avant
  avant="$(etiquette_env)"

  # `pull` lit l'étiquette depuis `.env` : il faut l'y écrire d'abord. Mais si
  # le `pull` échoue, on la REMET comme elle était — laisser `.env` pointer sur
  # une image intirable est précisément ce qui piège l'opérateur au `docker
  # compose up -d` suivant.
  fixer_etiquette "$tag"
  if ! compose pull; then
    echo "deploy : impossible de tirer l'image étiquetée « $tag »" >&2
    fixer_etiquette "$avant"
    echo "deploy : FEEDERS_TAG remis sur « ${avant:-aucune} » dans $COMPOSE_DIR/.env" >&2
    # `return`, et non `echec` : sortir du script ici court-circuiterait la
    # logique de retour arrière de l'appelant, qui ne serait jamais atteinte.
    return 2
  fi

  # `--wait` s'appuie sur le HEALTHCHECK de l'image : sans lui, `up -d` rend
  # la main sur un conteneur qui n'a pas fini de migrer.
  if ! compose up -d --wait; then
    fixer_etiquette "$avant"
    return 1
  fi
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
    en_cours="$(etiquette_en_cours)"
    if [ -n "$en_cours" ]; then
      echo "pending=$en_cours"
      echo "deploy : ATTENTION — une bascule vers « $en_cours » a été entamée et jamais scellée." >&2
      echo "deploy : « $en_cours » tourne peut-être. Vérifiez avec « docker compose ps »," >&2
      echo "deploy : puis « deploy.sh rollback » pour revenir à « $(etiquette_courante) »." >&2
    fi
    ;;

  deploy)
    [ $# -eq 1 ] || { echo "deploy : il faut exactement une étiquette" >&2; usage >&2; exit 2; }
    nouvelle="$1"
    ancienne="$(etiquette_courante)"
    avant_ancienne="$(etiquette_precedente)"

    echo "deploy : $ancienne -> $nouvelle"

    # L'étiquette en vol est posée AVANT la bascule. Si le processus meurt
    # entre `up -d --wait` et le scellement, `.deploy-state` dira toujours
    # quelle étiquette était en train de remplacer laquelle.
    ecrire_etat_en_cours "$ancienne" "$avant_ancienne" "$nouvelle"

    bascule=0
    basculer "$nouvelle" || bascule=$?

    if [ "$bascule" -eq 2 ]; then
      # L'image n'a pas pu être tirée : le conteneur en place n'a pas bougé et
      # `FEEDERS_TAG` a déjà été remis. Rien n'est en vol, donc on rescelle
      # l'état tel qu'il était plutôt que d'y laisser un `pending` trompeur —
      # et surtout on ne « revient » pas en arrière sur ce qui n'a pas avancé.
      ecrire_etat "$ancienne" "$avant_ancienne"
      echec "« $nouvelle » est intirable ; « ${ancienne:-aucune} » reste en ligne, rien n'a bougé"
    fi

    if [ "$bascule" -ne 0 ] || ! verifier_readyz; then
      echo "deploy : bascule ou /readyz en échec." >&2
      if [ -n "$ancienne" ]; then
        echo "deploy : retour arrière automatique sur « $ancienne »." >&2
        if basculer "$ancienne"; then
          echo "deploy : retour arrière effectué." >&2
          # L'état retrouve sa forme scellée : rien n'est plus en vol.
          ecrire_etat "$ancienne" "$avant_ancienne"
        else
          echo "deploy : LE RETOUR ARRIÈRE A ÉCHOUÉ AUSSI — intervention humaine requise." >&2
          echo "deploy : $ETAT garde « pending=$nouvelle » : rien n'est certain en ligne." >&2
        fi
      else
        echo "deploy : aucune étiquette précédente connue, rien à quoi revenir." >&2
      fi
      # Les données ne sont PAS restaurées ici : voir l'entête et l'ADR 0004.
      exit 1
    fi

    ecrire_etat "$nouvelle" "$ancienne"
    echo "deploy : OK — $nouvelle est en ligne (précédente : ${ancienne:-aucune})"
    ;;

  rollback)
    courante="$(etiquette_courante)"
    en_cours="$(etiquette_en_cours)"

    if [ $# -ge 1 ] && [ -n "$1" ]; then
      cible="$1"
    elif [ -n "$en_cours" ]; then
      # Une bascule interrompue : la dernière étiquette SCELLÉE est celle qui
      # tournait avant, donc celle à laquelle revenir. Revenir sur `previous`
      # sauterait la version réellement remplacée.
      cible="$courante"
      echo "deploy : bascule vers « $en_cours » interrompue et jamais scellée." >&2
      echo "deploy : retour sur la dernière étiquette scellée, « $cible »." >&2
    else
      cible="$(etiquette_precedente)"
    fi
    [ -n "$cible" ] || echec "aucune étiquette précédente connue et aucune donnée en argument"

    echo "deploy : retour arrière $courante -> $cible"
    basculer "$cible" || echec "le retour arrière sur « $cible » a échoué"
    verifier_readyz || echec "« $cible » est en ligne mais /readyz reste rouge"

    if [ "$cible" = "$courante" ]; then
      # On a seulement défait une bascule en vol : `previous` ne bouge pas.
      ecrire_etat "$courante" "$(etiquette_precedente)"
    else
      ecrire_etat "$cible" "$courante"
    fi
    echo "deploy : OK — retour arrière sur $cible"
    ;;

  *)
    echo "deploy : commande inconnue « $commande »" >&2
    usage >&2
    exit 2
    ;;
esac
