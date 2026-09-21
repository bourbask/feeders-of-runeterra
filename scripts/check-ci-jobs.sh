#!/usr/bin/env bash
#
# Cohérence de la chaîne d'intégration continue.
#
# Trois choses qu'aucun linter de YAML ne vérifie, et dont la porte de merge dépend :
#
#   1. les douze travaux de docs/design/01-architecture.md §8 sont tous là, sous les
#      identifiants attendus — un travail renommé disparaît de la protection de branche
#      sans rien casser de visible ;
#   2. toute commande `pnpm <x>` citée dans un `run:` existe dans les scripts du
#      package.json racine — c'est ce qui attrape un `pnpm db:generate --check` ou un
#      `pnpm ai:eval` qui n'existent pas, et qui n'échoueraient qu'en CI ;
#   3. chaque `continue-on-error: true` de ci.yml porte son marqueur `TODO M0-30` et
#      réciproquement — un marqueur orphelin est une tolérance qu'on croit avoir retirée.
#
# Sort en 0 si tout tient, en 1 sinon, en listant chaque manquement.

set -euo pipefail

racine="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$racine"

ci='.github/workflows/ci.yml'
workflows=('.github/workflows/ci.yml' '.github/workflows/ai-eval.yml')

erreurs=0
signaler() {
  printf 'check-ci-jobs: %s\n' "$1" >&2
  erreurs=$((erreurs + 1))
}

for fichier in "${workflows[@]}"; do
  [[ -f $fichier ]] || {
    signaler "le workflow « $fichier » est absent"
    exit 1
  }
done

# ── 1. Les douze travaux, sous leurs identifiants ──────────────────────────────
# L'ordre de ce tableau est celui du tableau §8. Les identifiants ne sont pas
# cosmétiques : ce sont les noms que la protection de branche exige sur `main`.
travaux_attendus=(
  install
  format
  lint
  typecheck
  deps
  test-unit
  test-golden
  migrations
  content
  ai-eval-offline
  sim
  build
)

travaux_presents="$(
  awk '
    /^jobs:[[:space:]]*$/ { dans_jobs = 1; next }
    dans_jobs && /^[^[:space:]#]/ { dans_jobs = 0 }
    dans_jobs && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {
      nom = $1
      sub(/:$/, "", nom)
      print nom
    }
  ' "$ci"
)"

for travail in "${travaux_attendus[@]}"; do
  if ! printf '%s\n' "$travaux_presents" | grep -qx -- "$travail"; then
    signaler "le travail « $travail » manque dans $ci (tableau §8 de 01-architecture.md)"
  fi
done

# ── 2. Toute commande pnpm citée existe à la racine ────────────────────────────
# `install` est une sous-commande de pnpm, pas un script du dépôt : c'est la seule
# exception, et elle est écrite ici plutôt que devinée.
builtins_pnpm=(install)

scripts_racine="$(
  node -e 'const p=require("./package.json");for(const s of Object.keys(p.scripts??{}))console.log(s)'
)"

# Extrait le texte de chaque `run:`, forme en ligne comme forme en bloc (`run: |`).
extraire_run() {
  awk '
    {
      ligne = $0
      if (dans_bloc) {
        if (ligne ~ /^[[:space:]]*$/) { print ""; next }
        match(ligne, /^[[:space:]]*/)
        if (RLENGTH > indentation) { print ligne; next }
        dans_bloc = 0
      }
      if (match(ligne, /^[[:space:]]*(- )?run:[[:space:]]*[|>][-+0-9]*[[:space:]]*$/)) {
        match(ligne, /^[[:space:]]*/)
        indentation = RLENGTH
        dans_bloc = 1
        next
      }
      if (match(ligne, /^[[:space:]]*(- )?run:[[:space:]]+/)) {
        print substr(ligne, RSTART + RLENGTH)
      }
    }
  ' "$1"
}

for fichier in "${workflows[@]}"; do
  while read -r jeton; do
    [[ -n $jeton ]] || continue

    # Un drapeau juste après `pnpm` (`pnpm --filter …`, `pnpm -r …`) sortirait du
    # champ de cette vérification sans le dire. On refuse la forme plutôt que de
    # la laisser passer en silence.
    if [[ $jeton == -* ]]; then
      signaler "$fichier : « pnpm $jeton » — forme non vérifiable, écris le script racine en premier"
      continue
    fi

    connu=0
    for builtin in "${builtins_pnpm[@]}"; do
      [[ $jeton == "$builtin" ]] && connu=1
    done
    if [[ $connu -eq 0 ]] && printf '%s\n' "$scripts_racine" | grep -qx -- "$jeton"; then
      connu=1
    fi

    if [[ $connu -eq 0 ]]; then
      signaler "$fichier : « pnpm $jeton » n'est pas un script du package.json racine (liste contractuelle, §2.2)"
    fi
  done < <(extraire_run "$fichier" | grep -oE '(^|[^[:alnum:]_-])pnpm[[:space:]]+[^[:space:]]+' | awk '{print $NF}' | sort -u)
done

# ── 3. Tolérances et marqueurs vont par paires ─────────────────────────────────
tolerances="$(grep -c 'continue-on-error: true' "$ci" || true)"
marqueurs="$(grep -c 'TODO M0-30' "$ci" || true)"

if [[ $tolerances -ne $marqueurs ]]; then
  signaler "$ci : $tolerances tolérance(s) « continue-on-error: true » pour $marqueurs marqueur(s) « TODO M0-30 » — un marqueur orphelin est une tolérance qu'on croit avoir retirée"
fi

if [[ $erreurs -gt 0 ]]; then
  printf 'check-ci-jobs: %d manquement(s).\n' "$erreurs" >&2
  exit 1
fi

printf 'check-ci-jobs: %d travaux, commandes pnpm vérifiées, %d tolérance(s) marquée(s).\n' \
  "${#travaux_attendus[@]}" "$tolerances"
