#!/usr/bin/env bash
#
# LE CANARI DE LA RÈGLE — le critère qui justifie tout le reste du jalon.
#
# Modifier UNE constante de règle du moteur doit faire rougir, en moins de
# trente secondes et en local, trois suites qui ne se parlent pas :
#
#   1. un test unitaire du moteur        (la constante, lue à sa source) ;
#   2. un corpus doré                    (une partie entière, rejouée) ;
#   3. un scénario du simulateur         (le vrai serveur, le vrai hub).
#
# Si une seule d'entre elles reste verte, le socle ne prouve rien : il existe
# alors un chemin par lequel une règle peut changer sans que personne ne le
# voie. ARCHITECTURE.md §7 point 8.
#
# CE QUE LE SCRIPT REND : 0 quand le canari a bien détecté — c'est-à-dire
# quand les TROIS suites sont rouges. Une suite restée verte est un échec du
# canari, donc un échec du socle, et le script sort en 1 en la nommant.
#
# POURQUOI IL FAUT RECONSTRUIRE LE MOTEUR. Le simulateur lit `@for/engine` par
# son `dist/`. Sans `tsc -b --force` après la modification, il rejouerait
# l'ancienne constante et resterait vert — le garde-fou semblerait inerte alors
# qu'il mord. CLAUDE.md, « Mesurer sans se faire mentir ».
#
# POURQUOI LA RESTAURATION SE FAIT PAR COPIE DE FICHIER. `git checkout` a déjà
# effacé une correction non commitée dans ce dépôt (docs/RECETTE.md §6). La
# sauvegarde est une copie, la restauration aussi, et elle passe par un `trap`
# pour survivre à un Ctrl-C.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# La constante, et la seule. `TICKS_PER_MILESTONE.dangereux` vaut 8 crans ;
# le canari la met à 7.
readonly FILE="packages/engine/src/types/progress.ts"
readonly BEFORE="  dangereux: 8,"
readonly AFTER="  dangereux: 7,"

# Le critère d'acceptation, en toutes lettres.
readonly BUDGET_S=30

BACKUP="$(mktemp -t canari-progress-XXXXXX.ts)"
readonly BACKUP
cp "$FILE" "$BACKUP"

# LA SOURCE ET LE `dist/`, LES DEUX. Restaurer la seule source laissait le
# `dist/` du moteur sur la constante violée : arbre propre, `git status` vide,
# source juste — et `pnpm sim run` ROUGE, parce que le simulateur lit le
# `dist/`. Mesuré en recette de M0-30 :
#   bash scripts/canary-regle.sh                             -> 0
#   grep dangereux packages/engine/src/types/progress.ts     ->   dangereux: 8,
#   grep dangereux packages/engine/dist/types/progress.js    ->   dangereux: 7,
#   pnpm sim run                                             -> ROUGE
# Un outil de recette qui laisse le dépôt cassé derrière lui est un outil qu'on
# finit par ne plus lancer. La reconstruction est DANS le `trap`, donc elle a
# lieu aussi sur Ctrl-C et sur une sortie en erreur.
restore() {
  cp "$BACKUP" "$FILE"
  rm -f "$BACKUP"
  pnpm exec tsc -b packages/engine --force >/dev/null 2>&1 || true
}
trap restore EXIT INT TERM

if ! grep -qF "$BEFORE" "$FILE"; then
  echo "canari : « $BEFORE » est introuvable dans $FILE." >&2
  echo "La constante a changé de valeur ou de forme : corrige le canari, ne le contourne pas." >&2
  exit 1
fi

echo "canari de règle — $FILE"
echo "  $BEFORE  ->  $AFTER"
echo

# ---------------------------------------------------------------- la violation

# `perl -i -pe` plutôt que `sed -i` : la forme de `sed -i` diffère entre GNU et
# BSD, et ce script tourne aussi sur un poste de développement.
perl -0777 -i -pe "s/\Q$BEFORE\E/$AFTER/" "$FILE"

STARTED_AT=$SECONDS

# Le `dist/` du moteur, reconstruit. Sans lui, le simulateur reste vert.
pnpm exec tsc -b packages/engine --force >/dev/null 2>&1 || true

names=()
codes=()

run() {
  local name="$1"
  shift
  "$@" >/dev/null 2>&1
  local code=$?
  names+=("$name")
  codes+=("$code")
}

# `TURBO_FORCE` : sans lui, turbo peut rejouer le journal d'un AUTRE worktree et
# rendre un vert qui n'a pas été produit ici. docs/RECETTE.md §1.
export TURBO_FORCE=true

run "test unitaire du moteur (progress-track.test.ts, index.test.ts)" \
  pnpm --filter @for/engine exec vitest run src/progress-track.test.ts src/index.test.ts
run "corpus doré (pnpm test:golden)" pnpm test:golden
run "scénario du simulateur (pnpm sim run)" pnpm sim run

ELAPSED=$((SECONDS - STARTED_AT))

# ------------------------------------------------------------------ le verdict

echo "les trois suites, et ce que le canari en a obtenu"
echo
failed=0
for index in "${!names[@]}"; do
  code="${codes[$index]}"
  if [ "$code" -ne 0 ]; then
    printf '  ROUGE  (code %s)  %s\n' "$code" "${names[$index]}"
  else
    printf '  VERT   (code 0)  %s  <- le canari n’a PAS détecté\n' "${names[$index]}"
    failed=1
  fi
done

echo
printf 'durée : %s s (budget : %s s)\n' "$ELAPSED" "$BUDGET_S"

if [ "$ELAPSED" -gt "$BUDGET_S" ]; then
  echo "canari : les trois suites ont rougi, mais au-delà du budget de ${BUDGET_S} s." >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo
  echo "CANARI EN ÉCHEC : une règle du moteur peut changer sans que le socle le voie." >&2
  exit 1
fi

echo
echo "CANARI OK : les trois suites ont rougi, la constante est restaurée."
