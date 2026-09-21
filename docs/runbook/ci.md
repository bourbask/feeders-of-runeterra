# Runbook — la chaîne d'intégration continue

Autorité sur le contenu de la chaîne : `docs/design/01-architecture.md` §8.
Ce document dit comment on l'exploite : ce qu'il faut régler sur GitHub, ce que
« rouge » veut dire, et ce qu'on refuse de faire quand ça bloque.

---

## 1. Les deux chaînes

| Fichier                         | Déclencheur                                             | Bloque une fusion       |
| ------------------------------- | ------------------------------------------------------- | ----------------------- |
| `.github/workflows/ci.yml`      | `pull_request`, `push` sur `main`                       | **oui**, travaux 1 à 12 |
| `.github/workflows/ai-eval.yml` | manuel, étiquette `run-ai-eval`, nocturne (coupé en M0) | non                     |

`ai-eval.yml` n'est pas bloquant **parce qu'il n'est pas dans la liste des
vérifications exigées**, pas parce qu'il serait indulgent. Il sort en échec tant que
`eval:live` et `eval:judge` n'existent pas : c'est voulu, et c'est pourquoi son
déclencheur `schedule` est commenté jusqu'en M1. Un nocturne rouge toutes les nuits
est un nocturne que plus personne ne regarde.

## 2. Protection de branche à appliquer sur `main`

À régler dans _Settings → Branches → Branch protection rules_, motif `main` :

- **Require a pull request before merging**, 1 approbation, et
  **Require review from Code Owners** (le fichier `.github/CODEOWNERS` fait le reste).
- **Require status checks to pass before merging**, avec _Require branches to be up to
  date_. Les douze vérifications exigées, sous leurs identifiants de travail :

  ```
  install  format  lint  typecheck  deps  build
  test-unit  test-golden  migrations  content  ai-eval-offline  sim
  ```

  `ai-eval-live` n'y figure pas.

- **Require linear history** — fusion par _squash_ uniquement. Les trois autres modes
  de fusion sont désactivés dans _Settings → General → Pull Requests_.
- **Do not allow bypassing the above settings**, y compris pour les administrateurs.
  Une porte qu'on peut contourner n'est pas une porte.
- Pas de poussée directe, pas de suppression de branche, pas de réécriture d'historique.

`develop` porte les mêmes vérifications exigées, sans l'approbation obligatoire :
c'est la branche d'intégration des tâches du jalon.

> **Attention.** Un travail renommé disparaît silencieusement de cette liste : GitHub
> n'exige plus qu'une vérification qui n'existe pas, et la porte s'ouvre sans rien
> dire. C'est exactement ce que `scripts/check-ci-jobs.sh` attrape côté dépôt — mais
> la liste ci-dessus, elle, est côté GitHub et doit être remise à jour à la main.

## 3. Budget de temps : 8 minutes

La porte de PR vise **moins de huit minutes**. Ce n'est pas du confort : au-delà, les
agents développeurs contournent la porte, et une porte contournée ne protège rien.

Ce qui tient le budget :

- Le **chemin critique** est `install → build → deps → {test-unit, …}`, soit quatre
  travaux en série. Tout le reste est parallèle.
- Le **cache Turborepo** est indexé sur le SHA du commit. Le travail `build` le
  remplit ; `deps` relance `pnpm build`, obtient un succès de cache et récupère les
  `dist/` sans rien reconstruire.
- Le **cache du magasin pnpm** est géré par `actions/setup-node` (`cache: pnpm`).
- `docker build` est en **post-merge**, pas dans la porte (§8) : le module natif
  `better-sqlite3` coûte trop cher pour le budget.
- `pnpm sim fuzz` n'est **pas** dans la porte en M0 (§8).

Mesurer le budget après coup :

```
gh run list --workflow=ci.yml --limit 10
gh run view <id> --json jobs \
  --jq '[.jobs[] | {name, s: .startedAt, c: .completedAt}]'
```

Si le budget déborde, l'ordre des remèdes est : cache distant Turborepo, puis
regroupement de travaux courts, puis — en dernier — sortie d'un travail de la porte,
ce qui exige un ADR.

## 4. Ce que « rouge » veut dire

Un agent développeur lance `pnpm verify` en local. Si elle passe, les travaux 2 à 10
passent : `verify` enchaîne `format:check`, `lint`, `typecheck`, `depcruise`,
`check:workspace`, `content:check`, `test`, `test:golden` et `eval:offline`. Seuls les
travaux 11 (`sim`) et 12 (`build`) exigent un environnement complet.

Trois nuances, à connaître avant de conclure que « la CI ment » :

1. **`pnpm verify` n'inclut pas `pnpm test:coverage`.** Le travail 6 appelle
   `test:coverage`, et pas `test` : `turbo run test` lance les configurations de
   paquet, qui ignorent le seuil global de 70 %. C'est la seule commande qui
   l'évalue (ADR 0002 §3). Une couverture qui tombe sous le seuil passe donc en
   local et échoue en CI. Lance `pnpm test:coverage` avant de pousser.
2. **`pnpm verify` n'inclut pas `bash scripts/check-ci-jobs.sh`**, lancé par le
   travail 5. À replier dans `verify` en M0-30.
3. **Cinq étapes tolèrent l'échec** aujourd'hui, parce que leur cible n'est pas
   livrée. Elles portent `continue-on-error: true # TODO M0-30: retirer`. Le travail
   apparaît vert alors qu'une étape est rouge — et GitHub rapporte même l'étape
   tolérée comme « success ». Chacune est donc suivie d'une étape qui pose une
   **annotation d'avertissement** nommant la tâche qui la livrera : c'est ce qui
   reste visible sans déplier le journal.

## 5. Les tolérances, et quand elles tombent

| Étape tolérée                           | Commande                                   | Livrée par   |
| --------------------------------------- | ------------------------------------------ | ------------ |
| 7 · Comparer aux corpus dorés           | `pnpm test:golden`                         | M0-10        |
| 8 · Schéma, migration à blanc, amorçage | `db:check-schema`, `db:migrate`, `db:seed` | M0-11, M0-26 |
| 9 · Chargeur de contenu et index        | `content:check`, `content:index`           | M0-14        |
| 10 · Éval N0                            | `pnpm eval:offline`                        | M0-27        |
| 11 · Tous les scénarios                 | `pnpm sim run --format=json`               | M0-28        |

M0-30 retire les cinq lignes. L'invariant qui l'empêche d'en oublier une :
`scripts/check-ci-jobs.sh` exige autant de marqueurs `TODO M0-30` que de
`continue-on-error: true`, et le travail 5 le lance à chaque PR.

La tolérance est posée **sur l'étape**, pas sur le travail. Une tolérance au niveau du
travail neutraliserait aussi les gardes qui, eux, sont bloquants dès aujourd'hui — le
refus de `GOLDEN_UPDATE` dans le travail 7 en est un.

Contrepartie mesurée sur la première série : GitHub rapporte une étape tolérée comme
`success`, et l'échec ne se lit que dans le journal (`Process completed with exit
code 1`). Chaque étape tolérée est donc suivie d'une étape conditionnée à
`steps.<id>.outcome == 'failure'` qui émet une annotation `::warning::`. Retirer la
tolérance en M0-30, c'est retirer les deux.

## 6. Secrets et variables

- `NARRATOR_API_KEY` : **secret** de dépôt, consommé par `ai-eval.yml` seulement.
  Aucun fichier de `.github/` ne contient de valeur en clair ; la vérification tient
  en une ligne :

  ```
  grep -rIn 'NARRATOR_API_KEY: [^$]' .github/     # ne doit rien renvoyer
  ```

- `NARRATOR_PROVIDER`, `NARRATOR_BASE_URL`, `NARRATOR_MODEL` : **variables** de dépôt
  (non secrètes). Elles sont déclarées dans `.github/actionlint.yaml` : toute autre
  `vars.X` fait échouer `actionlint`. Ajouter une variable côté GitHub sans l'ajouter
  là est une erreur de lint, pas une surprise à l'exécution.

## 7. Vérifier la chaîne sans attendre GitHub

```
actionlint                        # les workflows (shellcheck compris sur les run:)
bash scripts/check-ci-jobs.sh     # travaux, commandes pnpm, tolérances marquées
pnpm test:coverage                # le seuil global, que `pnpm test` n'évalue pas
```

`actionlint` n'est pas une dépendance du dépôt : binaire unique, à récupérer depuis la
page des versions de `rhysd/actionlint`, ou `docker run --rm -v "$PWD":/repo -w /repo
rhysd/actionlint:latest -color`.
