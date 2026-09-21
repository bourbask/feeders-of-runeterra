#!/usr/bin/env bash
#
# Cohérence de la chaîne d'intégration continue.
#
# Quatre choses qu'aucun linter de YAML ne vérifie, et dont la porte de merge dépend :
#
#   1. les douze travaux de docs/design/01-architecture.md §8 sont tous là, sous les
#      identifiants attendus — un travail renommé disparaît de la protection de branche
#      sans rien casser de visible ;
#   2. toute invocation `pnpm …` citée dans un `run:` est soit un script du package.json
#      racine appelé sans argument, soit une forme explicitement listée plus bas. Un
#      argument non listé est refusé : la règle « le script existe » ne sait rien dire
#      de `pnpm db:generate --check`, dont le script existe et dont le drapeau n'existe
#      pas. C'est la liste blanche des formes qui l'attrape, pas l'existence du script ;
#   3. chaque `continue-on-error: true` de ci.yml porte son marqueur `TODO M0-30` et
#      réciproquement — un marqueur orphelin est une tolérance qu'on croit avoir retirée ;
#   4. tout `runs-on:` désigne un runner de la liste blanche. `actionlint` ne sait pas
#      refuser `runs-on: self-hosted` — mesuré : il sort en 0 avec ou sans
#      `.github/actionlint.yaml`. Le refus est donc ici, ou nulle part.
#
# La portée n'est pas codée en dur : tous les workflows et toutes les actions composites
# du dépôt sont parcourus, et un ensemble vide est une erreur. Un garde-fou dont la
# portée est figée devient muet le jour où un fichier est déposé à côté.
#
# Sort en 0 si tout tient, en 1 sinon, en listant chaque manquement.

set -euo pipefail

racine="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$racine"

ci='.github/workflows/ci.yml'
ai_eval='.github/workflows/ai-eval.yml'

erreurs=0
signaler() {
  printf 'check-ci-jobs: %s\n' "$1" >&2
  erreurs=$((erreurs + 1))
}

# ── 0. La portée, découverte et jamais vide ────────────────────────────────────
lister_workflows() {
  local fichier
  for fichier in .github/workflows/*.yml .github/workflows/*.yaml; do
    [[ -f $fichier ]] && printf '%s\n' "$fichier"
  done
  return 0
}

lister_surveilles() {
  lister_workflows
  if [[ -d .github/actions ]]; then
    find .github/actions -type f \( -name 'action.yml' -o -name 'action.yaml' \)
  fi
}

mapfile -t workflows < <(lister_workflows | sort -u)
mapfile -t surveilles < <(lister_surveilles | sort -u)

if [[ ${#workflows[@]} -eq 0 ]]; then
  signaler "aucun workflow sous .github/workflows/ — un glob qui ne trouve rien est un garde-fou muet, pas une chaîne sans reproche"
  printf 'check-ci-jobs: %d manquement(s).\n' "$erreurs" >&2
  exit 1
fi

for fichier in "$ci" "$ai_eval"; do
  [[ -f $fichier ]] || {
    signaler "le workflow « $fichier » est absent"
    printf 'check-ci-jobs: %d manquement(s).\n' "$erreurs" >&2
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

# ── 2. Toute invocation pnpm est un script racine nu, ou une forme listée ──────
# La règle « le premier jeton après pnpm est un script du package.json racine » ne
# peut structurellement rien dire des arguments : `pnpm db:generate --check` la
# satisfait, et `--check` n'existe pas dans drizzle-kit. Toute invocation qui porte
# un argument doit donc figurer ici, en toutes lettres.
invocations_listees=(
  'install --frozen-lockfile' # sous-commande de pnpm, pas un script du dépôt
  'sim run --format=json'     # sous-commandes de `sim`, documentées en §2.2
)

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

# Découpe le shell extrait en commandes élémentaires, garde celles qui appellent
# pnpm, et rend l'invocation entière — arguments compris, espaces normalisés.
extraire_invocations_pnpm() {
  extraire_run "$1" |
    sed -E 's/[;&|]+/\n/g' |
    grep -E '(^|[[:space:]])pnpm([[:space:]]|$)' |
    sed -E 's/^.*(^|[[:space:]])pnpm([[:space:]]+|$)//' |
    sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' |
    sort -u
}

for fichier in "${surveilles[@]}"; do
  while IFS= read -r invocation; do
    premier="${invocation%% *}"

    if [[ -z $premier ]]; then
      signaler "$fichier : « pnpm » sans commande — forme non vérifiable"
      continue
    fi

    # Un drapeau juste après `pnpm` (`pnpm --filter …`, `pnpm -r …`) sortirait du
    # champ de cette vérification sans le dire. On refuse la forme plutôt que de
    # la laisser passer en silence.
    if [[ $premier == -* ]]; then
      signaler "$fichier : « pnpm $invocation » — forme non vérifiable, écris le script racine en premier"
      continue
    fi

    listee=0
    for forme in "${invocations_listees[@]}"; do
      [[ $invocation == "$forme" ]] && listee=1
    done
    if [[ $listee -eq 1 ]]; then
      continue
    fi

    if [[ $invocation != "$premier" ]]; then
      signaler "$fichier : « pnpm $invocation » porte un argument non listé — que le script « $premier » existe ne dit rien de ses drapeaux ; ajoute la forme entière à invocations_listees ou retire l'argument"
      continue
    fi

    if ! printf '%s\n' "$scripts_racine" | grep -qx -- "$premier"; then
      signaler "$fichier : « pnpm $premier » n'est pas un script du package.json racine (liste contractuelle, §2.2)"
    fi
  done < <(extraire_invocations_pnpm "$fichier")
done

# ── 3. Tolérances et marqueurs vont par paires ─────────────────────────────────
tolerances="$(grep -c 'continue-on-error: true' "$ci" || true)"
marqueurs="$(grep -c 'TODO M0-30' "$ci" || true)"

if [[ $tolerances -ne $marqueurs ]]; then
  signaler "$ci : $tolerances tolérance(s) « continue-on-error: true » pour $marqueurs marqueur(s) « TODO M0-30 » — un marqueur orphelin est une tolérance qu'on croit avoir retirée"
fi

# ── 4. Les runners, liste blanche ──────────────────────────────────────────────
# `actionlint` ne refuse pas `runs-on: self-hosted` : mesuré, il sort en 0 avec ou
# sans `.github/actionlint.yaml`. Sa clé `self-hosted-runner.labels` ne fait que
# déclarer des étiquettes personnalisées valides — elle n'interdit rien, et elle a
# donc été retirée de la configuration. L'interdiction vit ici.
runners_autorises=(ubuntu-latest)

extraire_runners() {
  awk '
    match($0, /^[[:space:]]*runs-on:[[:space:]]*/) {
      valeur = substr($0, RSTART + RLENGTH)
      sub(/[[:space:]]*#.*$/, "", valeur)
      gsub(/[][,"'"'"']/, " ", valeur)
      n = split(valeur, morceaux, /[[:space:]]+/)
      vus = 0
      for (i = 1; i <= n; i++) {
        if (morceaux[i] != "") { print morceaux[i]; vus++ }
      }
      if (vus == 0) print "(forme non vérifiable)"
    }
  ' "$1"
}

runners_vus=0
for fichier in "${workflows[@]}"; do
  while IFS= read -r runner; do
    [[ -n $runner ]] || continue
    runners_vus=$((runners_vus + 1))
    autorise=0
    for connu in "${runners_autorises[@]}"; do
      [[ $runner == "$connu" ]] && autorise=1
    done
    if [[ $autorise -eq 0 ]]; then
      signaler "$fichier : « runs-on: $runner » — runner hors liste blanche (${runners_autorises[*]}). Un runner auto-hébergé exécute le code de n'importe quelle pull request sur une machine à nous ; actionlint ne le refuse pas, ce script si"
    fi
  done < <(extraire_runners "$fichier")
done

if [[ $runners_vus -eq 0 ]]; then
  signaler "aucun « runs-on: » trouvé dans les workflows — la liste blanche des runners ne refuserait plus rien"
fi

if [[ $erreurs -gt 0 ]]; then
  printf 'check-ci-jobs: %d manquement(s).\n' "$erreurs" >&2
  exit 1
fi

printf 'check-ci-jobs: %d travaux, %d fichier(s) surveillé(s), commandes pnpm vérifiées, %d tolérance(s) marquée(s), %d runner(s) dans la liste blanche.\n' \
  "${#travaux_attendus[@]}" "${#surveilles[@]}" "$tolerances" "$runners_vus"
