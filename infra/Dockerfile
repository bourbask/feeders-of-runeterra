# syntax=docker/dockerfile:1
#
# Feeders of Runeterra — une seule image qui sert l'API et les fichiers statiques
# du client (01-architecture.md §9.1).
#
# Quatre étapes, et l'ordre compte :
#   base    — le runtime Node nu, partagé par tout le reste
#   deps    — la chaîne de compilation native + le contenu du verrou, et RIEN
#             d'autre : c'est la couche que l'on veut garder en cache
#   build   — les sources, l'installation hors ligne, `turbo run build`
#   runtime — le strict nécessaire pour exécuter, sans compilateur C++
#
# Pourquoi `deps` ne voit que le verrou : `pnpm fetch` peuple le magasin à
# partir de `pnpm-lock.yaml` seul. Toucher une source ne réinvalide donc pas le
# téléchargement des dépendances. Copier les onze `package.json` un par un
# donnerait le même effet au prix d'une ligne par paquet, à tenir à jour à la
# main — et une ligne oubliée se traduit par une installation silencieusement
# incomplète.
#
# Repli assumé d'avance : si la compilation native sur Alpine (musl) devient
# instable — `better-sqlite3` arrive en M0-11 —, le repli est
# `node:24-bookworm-slim`. Il se fait en changeant les deux `FROM` ci-dessous et
# en remplaçant `apk add --no-cache python3 make g++` par
# `apt-get update && apt-get install -y --no-install-recommends python3 make g++`.
# La décision est prise ici, à froid, et non un soir de déploiement rouge.

ARG NODE_IMAGE=node:24-alpine

# ---------------------------------------------------------------------------
# base
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base

ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:${PATH}"
ENV CI=true

WORKDIR /app

RUN corepack enable

# ---------------------------------------------------------------------------
# deps — le magasin pnpm, depuis le verrou seul
# ---------------------------------------------------------------------------
FROM base AS deps

# La chaîne de compilation native ne vit QUE dans les étapes intermédiaires.
# `better-sqlite3` (M0-11) en a besoin ; l'image finale, non.
# hadolint ignore=DL3018
RUN apk add --no-cache python3 make g++

# `package.json` pour que corepack lise `packageManager`, le verrou et le
# manifeste d'espace de travail pour que `pnpm fetch` sache quoi tirer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm fetch

# ---------------------------------------------------------------------------
# build — sources, installation hors ligne, construction
# ---------------------------------------------------------------------------
FROM deps AS build

COPY . .

# Trois commandes, une seule couche — hadolint DL3059, et de toute façon les
# trois dépendent de la même copie des sources : les séparer ne gagnerait aucun
# cache.
#
# `--offline` : tout doit déjà être dans le magasin peuplé par `pnpm fetch`.
# Si quelque chose manque, on veut un échec bruyant ici et pas un appel réseau
# silencieux qui rendrait la construction non reproductible.
#
# Le repliage du serveur est fait ICI, dans `build`, et non dans `runtime` :
# `pnpm deploy` a besoin de l'espace de travail complet, que l'étape finale
# n'a précisément plus. `--legacy` est requis depuis pnpm 10 tant que
# `inject-workspace-packages` n'est pas activé.
RUN pnpm install --frozen-lockfile --offline \
    && pnpm turbo run build \
    && pnpm deploy --filter=@for/server --prod --legacy /prod/server

# ---------------------------------------------------------------------------
# runtime — sans compilateur, sans sources, sans root
# ---------------------------------------------------------------------------
# NOTE (M0, vague 2) : cette étape ne peut pas encore réussir. `@for/server`
# n'a pas de `dist/main.js` (M0-20) et `@for/client` ne produit pas de `dist/`
# tant que M0-19 n'a pas branché `vite build` sur son script `build`. La
# construction complète de l'image est un critère de M0-30 ; la construction
# jusqu'à `--target build` est celui de M0-04.
FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=8787
ENV DATABASE_PATH=/app/data/app.db

# UID/GID 10001 en dur, et pas l'utilisateur `node` (1000) de l'image amont :
# le volume hôte `/srv/feeders/data` est chown 10001:10001 par le runbook de
# restauration (03-donnees.md §6.5). Un identifiant numérique stable est ce qui
# rend ce chown vérifiable depuis l'hôte, où les noms d'utilisateur du
# conteneur n'existent pas.
RUN addgroup -g 10001 -S app \
    && adduser -u 10001 -S -G app -h /app app \
    && mkdir -p /app/data /app/public \
    && chown -R app:app /app

# `pnpm deploy --prod` a replié le serveur et ses seules dépendances
# d'exécution dans /prod/server : ni sources, ni devDependencies, ni les neuf
# autres paquets de l'espace de travail.
COPY --from=build --chown=app:app /prod/server /app
COPY --from=build --chown=app:app /app/packages/client/dist /app/public

# Numérique, et pas `app` : l'hôte ne connaît pas les noms d'utilisateur du
# conteneur, et c'est l'UID qui doit correspondre au `chown 10001:10001` du
# volume de données. hadolint DL3066 dit la même chose.
USER 10001:10001

EXPOSE 8787

VOLUME ["/app/data"]

# Liveness, et liveness seulement : `/healthz` ne touche pas la base
# (03-donnees.md §6.7). Un WAL volumineux ou une sauvegarde en retard ne
# doivent pas sortir le conteneur de la rotation. `fetch` est global depuis
# Node 18 : pas besoin de faire entrer `curl` dans l'image finale.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["node", "dist/main.js"]
