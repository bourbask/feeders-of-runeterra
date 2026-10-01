#!/usr/bin/env bash
#
# LA SONDE DE FUMÉE DE M0 — « sur un poste neuf, tout s'enchaîne ».
#
# Elle enchaîne, dans cet ordre et sans intervention : installation,
# construction, migrations, amorçage, démarrage du serveur, connexion WebSocket
# AUTHENTIFIÉE, réception de `s2c.welcome` + `s2c.snapshot` + `s2c.presence`,
# la reprise du journal, UN TOUR VIVANT — `c2s.intent` soumis, premier
# `s2c.event` du tour reçu —, l'aller-retour `c2s.why` → `s2c.turn_proof` sur
# CE tour, puis arrêt propre. Elle sort en 0 quand tout cela a eu lieu.
#
# ── POURQUOI ELLE SOUMET UNE INTENTION ───────────────────────────────────
# Sans ça elle prouvait que le serveur DÉMARRE, pas que la table TOURNE : la
# preuve portait sur des entrées amorcées, redemandées par `c2s.resume`, là où
# le critère P22 écrit « après réception du premier `s2c.event` d'un tour ».
# Aucune autre suite du dépôt ne joue un tour vivant sur une socket — le
# simulateur ne branche pas `narrateTurn`. C'est la question du jalon.
#
# ── CE QU'ELLE NE TOUCHE PAS ─────────────────────────────────────────────
# Sa base vit dans un dossier temporaire, jamais `./data/app.db` : une sonde
# qui efface la base de travail de quelqu'un est une sonde qu'on ne relance
# pas. Le dossier est supprimé à la sortie, quel que soit le chemin pris.
#
# ── POURQUOI LE CONTEUR EST `stub` ───────────────────────────────────────
# Aucune clé, aucun réseau, aucune facture : le `stub` est le seul
# interrupteur de mode dégradé du produit (ARCHITECTURE.md §4.5), et ce que
# cette sonde mesure est le socle, pas la prose.
#
# ── CE QU'ELLE NE PEUT PAS FAIRE ─────────────────────────────────────────
# La connexion Discord de bout en bout. Elle exige un vrai client OAuth et un
# navigateur ; c'est une étape MANUELLE, décrite dans
# `docs/runbook/verification-m0.md`, et elle n'est pas cochée ici.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

readonly CAMPAIGN_SLUG="pacte-griffe-de-givre"
readonly PORT="${SMOKE_PORT:-8799}"

WORK="$(mktemp -d -t smoke-m0-XXXXXX)"
readonly WORK
SERVER_PID=""
LOG="$WORK/server.log"

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    # SIGTERM, et le serveur ferme sa base : `main.ts` installe l'arrêt propre.
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

step() {
  printf '\n== %s\n' "$1"
}

die() {
  printf 'sonde de fumée : %s\n' "$1" >&2
  if [ -s "$LOG" ]; then
    printf -- '--- journal du serveur ---\n' >&2
    tail -n 30 "$LOG" >&2
  fi
  exit 1
}

# L'environnement du serveur, et le seul. Les secrets sont des valeurs de
# sonde : le dépôt est public, et rien ici n'ouvre quoi que ce soit.
export NODE_ENV=development
export PORT
export LOG_LEVEL=warn
export DATABASE_PATH="$WORK/smoke.db"
export SESSION_SECRET="sonde-de-fumee-m0-secret-de-trente-deux-octets"
export DISCORD_CLIENT_ID="sonde"
export DISCORD_CLIENT_SECRET="sonde"
export DISCORD_REDIRECT_URI="http://localhost:${PORT}/api/auth/discord/callback"
export PUBLIC_URL="http://localhost:5173"
export NARRATOR_PROVIDER=stub

step "installation"
pnpm install --frozen-lockfile >/dev/null 2>&1 || die "pnpm install a échoué."
echo "  pnpm install --frozen-lockfile : 0"

step "construction"
pnpm build >/dev/null 2>&1 || die "pnpm build a échoué."
[ -f packages/server/dist/main.js ] || die "packages/server/dist/main.js est absent après la construction."
echo "  pnpm build : 0"

step "migrations et amorçage"
pnpm db:migrate >/dev/null 2>&1 || die "pnpm db:migrate a échoué."
echo "  pnpm db:migrate : 0"
pnpm db:seed >/dev/null 2>&1 || die "pnpm db:seed a échoué."
echo "  pnpm db:seed : 0"
# LA SORTIE DE LA COMMANDE, PAS UNE PHRASE ÉCRITE ICI : « 12 oracles » annoncé
# par la sonde serait un chiffre qui ne vient de nulle part. `db:check` nomme
# lui-même les contrôles qu'il a passés depuis M0-30.
DB_CHECK="$(pnpm db:check 2>&1)" || die "pnpm db:check a échoué (les 12 oracles)."
printf '  %s\n' "$(printf '%s' "$DB_CHECK" | tail -n 1)"

step "démarrage"
node packages/server/dist/main.js >"$LOG" 2>&1 &
SERVER_PID=$!

ready=0
for _ in $(seq 1 100); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    die "le serveur s'est arrêté au démarrage."
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/readyz" || true)"
  if [ "$code" = "200" ]; then
    ready=1
    break
  fi
  sleep 0.2
done
[ "$ready" = "1" ] || die "le serveur n'a jamais répondu 200 sur /readyz."
echo "  /readyz : 200 (pid $SERVER_PID, port $PORT)"

step "la table, par la socket"
SMOKE_PORT="$PORT" SMOKE_CAMPAIGN_SLUG="$CAMPAIGN_SLUG" \
  pnpm exec tsx scripts/smoke-client.ts || die "la conversation WebSocket a échoué."

step "arrêt"
kill -TERM "$SERVER_PID"
stopped=0
for _ in $(seq 1 50); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    stopped=1
    break
  fi
  sleep 0.1
done
SERVER_PID=""
[ "$stopped" = "1" ] || die "le serveur n'a pas répondu à SIGTERM."
echo "  SIGTERM : arrêt propre"

printf '\nSONDE DE FUMÉE M0 : VERTE\n'
printf 'Reste à faire à la main : la connexion Discord de bout en bout '
printf '(docs/runbook/verification-m0.md).\n'
