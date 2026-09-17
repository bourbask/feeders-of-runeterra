# ADR 0001 — Socle technique

- **Statut** : accepte
- **Date** : 2026-09-17
- **Portee** : jalon M0 et cadre des jalons suivants
- **Remplace** : rien
- **Amende par** : aucun ADR a ce jour

---

## Contexte

« Feeders of Runeterra » est une table de jeu de role en ligne au Freljord, avec un maitre de
jeu joue par une IA. Quelques joueurs, une seule table active a la fois au depart, une campagne
qui doit durer des mois sans perdre le fil. Le vocal reste sur Discord.

Trois contraintes dominent le choix du socle :

1. **Une campagne longue est un probleme de memoire, pas de calcul.** Le risque produit n'est
   pas la charge, c'est la derive de continuite sur plusieurs mois.
2. **Le developpement sera fait par des agents.** Un agent doit savoir en quelques secondes
   s'il a casse quelque chose, sans lire le code des autres.
3. **Il n'y a pas d'equipe d'exploitation.** Tout ce qui demande de l'astreinte est un cout
   permanent qu'on ne paiera pas.

La stack a ete verrouillee par le commanditaire. Cet ADR l'acte et ecrit le raisonnement, pour
que la prochaine personne qui voudra en devier sache contre quoi elle argumente.

## Decision

### Monorepo TypeScript, pnpm workspaces, tsconfig strict, Turborepo

Un seul depot, dix paquets `@for/*` en six couches acycliques. Les frontieres de paquet ne sont
pas de l'esthetique : **chaque invariant du projet est porte par une frontiere verifiable en
CI** plutot que par de la discipline. `@for/engine` a zero dependance, donc il ne *peut pas*
appeler la base ; `@for/ai` ne connait pas SQLite, donc l'eval *peut* tourner hors base ;
`@for/contracts` importe le moteur en type-only, donc le typecheck casse des que les deux
derivent.

Turborepo plutot que `pnpm -r` seul : le cache et l'ordonnancement sont ce qui permet de tenir
une porte de PR sous 8 minutes. Une porte lente est une porte contournee.

### Front : Vite + React, SPA, pas de SSR

Le produit est une application derriere authentification. Il n'y a rien a referencer, rien a
rendre cote serveur, et un SSR ajouterait une seconde surface d'execution a securiser pour zero
benefice. La SPA est servie comme des fichiers statiques par le meme conteneur que l'API.

### Back : Fastify, WebSocket pour la table live

La table est un etat partage qui change par a-coups : c'est un cas de WebSocket, pas de
polling. Fastify pour son integration Zod (`fastify-type-provider-zod`), qui permet de declarer
les routes avec les **memes** schemas que le client.

Un seul message client mutant, `c2s.intent`. C'est ce qui rend l'invariant 3 testable : un test
de contrat echoue si un schema `c2s.*` reference un `GameEvent`, un `CampaignState` ou un champ
de jauge.

### Base : SQLite en mode WAL + Drizzle

Un fichier, zero ops, des sauvegardes qui tiennent en une ligne (`VACUUM INTO`). Pour quelques
joueurs sur une table, un Postgres serait un serveur de plus a maintenir pour aucune propriete
gagnee.

**Le prix est explicite et accepte** : SQLite n'a qu'un ecrivain, donc une seule instance de
l'application, donc **aucune montee en charge horizontale**. Ce n'est pas un detail
d'exploitation, c'est une decision d'architecture : le compose declare un seul replica, le
runbook le dit noir sur blanc, et passer a plusieurs instances exigera de changer de base.

Drizzle plutot qu'un ORM lourd : les migrations sont du SQL commite et relu, pas un artefact
opaque. `drizzle-kit push` est interdit hors bac a sable local.

**Le journal d'evenements est append-only, materialise par des triggers SQLite**, pas par une
convention. La zone des projections est jetable et se reconstruit (`db:rebuild`) — c'est le test
le plus fort de l'invariant 4, et l'effet de bord le plus rentable : **le schema d'etat de jeu
n'a aucun cout de migration.**

### Contenu de jeu en fichiers JSON versionnes, pas en base

Les champions, les oracles, les tables de prix et les regions sont du **code** : ils se relisent
en PR, ils ont un historique git, ils se deploient avec l'application, ils sont identiques sur
toutes les machines. Les mettre en base obligerait a ecrire un back-office, a gerer des
migrations de donnees et a repondre a « quelle version de la table des prix a produit ce jet ? »
sans pouvoir la retrouver.

Le chargeur valide tout au demarrage, collecte **toutes** les erreurs avant de lever, suggere
les corrections par distance d'edition, et sort en code 1. Un serveur a moitie fonctionnel
coute plus cher qu'un serveur qui refuse de demarrer.

### Auth : Discord OAuth

Les joueurs sont deja sur Discord pour le vocal. Un second compte serait une friction pure. Pas
de mot de passe, jamais. La base ne stocke que le SHA-256 du secret de session : une fuite de la
base ne donne aucune session.

### IA : un port, pas un fournisseur — et cote serveur uniquement

**Jamais depuis le navigateur** — ce serait exposer la cle et confier la narration a un client
non fiable.

Le serveur ne parle pas a une API de fournisseur : il parle a une **interface unique**,
`NarratorPort`, avec deux operations — `narrer()` en flux, `structurer()` qui rend du JSON
valide contre un schema — et des adaptateurs derriere : `anthropic`, `openai-compatible`
(OpenRouter, Groq, Together), `ollama` (modele local), plus un `stub` sans reseau pour la CI et
le simulateur. Tout ce qui est propre a un fournisseur — identifiants de modele, mise en cache
de prompt, codes d'arret, format d'appel d'outils — vit dans son adaptateur et nulle part
ailleurs.

**Pourquoi.** Le projet doit rester jouable sans budget : un fournisseur gratuit, ou un modele
qui tourne sur la machine de l'hote de la table, doit suffire. Le prix a payer est une matrice
de degradation explicite (`02-mj-ia.md` §0.2), parce que les capacites varient enormement d'un
fournisseur a l'autre. La regle qui la gouverne tient en une ligne : **on degrade la prose,
jamais l'equite** — le moteur a deja tranche quand le conteur prend la parole, donc ce qui
manque n'est jamais qu'un peu de texte.

Le modele est **hors du chemin de decision**. Il recoit un fait deja acquis a habiller. Ses
outils sont en lecture ou en proposition validee. Consequence testable : une panne du modele
degrade le texte, jamais la partie.

La memoire longue est une **chronique compactee** : un document unique versionne, append-only,
ou chaque fait porte le numero de l'evenement qui l'etablit, ou un fait deja ecrit ne peut plus
etre reformule, et qui est integralement reconstruite depuis le journal toutes les huit
regenerations. C'est la reponse directe a la derive de continuite sur plusieurs mois.

### Deploiement : Docker Compose + Caddy sur un VPS, GitHub Actions → SSH

Une image unique qui sert l'API et les fichiers statiques. Caddy pour le TLS automatique. Les
migrations s'appliquent au demarrage du processus, avant `listen()` : une migration qui echoue
empeche le demarrage et l'ancien conteneur reste en place.

Sauvegarde par `VACUUM INTO`, jamais `cp` — en mode WAL, copier le seul `.db` donne une base
**silencieusement** amputee des dernieres minutes de jeu, et elle s'ouvre sans erreur, ce qui
est pire. Copie verifiee (`integrity_check`, `foreign_key_check`), compressee, chiffree, avec
une cle privee qui ne vit pas sur le VPS.

## Consequences

**Positives**

- Un agent developpeur peut casser une regle et le voir en moins de 30 secondes : test
  unitaire, corpus dore, scenario du simulateur.
- Le simulateur headless joue des parties completes contre le **vrai** service applicatif, sans
  navigateur ni appel IA, en moins de 20 secondes.
- L'eval des sorties IA tourne sur chaque PR **sans cle d'API et sans depenser un centime**
  (niveau N0 : instantane de requete + assertions rejouees sur sorties enregistrees).
- Le journal append-only donne gratuitement le carnet de campagne, le debogage et l'annulation.
- L'exploitation tient dans un `docker compose up` et un cron de sauvegarde.

**Negatives, assumees**

- Aucune montee en charge horizontale possible sans changer de base.
- `better-sqlite3` est un module natif : le build casse au moindre changement de version de
  Node. Repli decide d'avance : `node:24-bookworm-slim`.
- Le couplage `@for/sim` → `@for/server` rend le simulateur sensible aux refactors du serveur.
- Les upcasters de payload ne sont jamais supprimes : le code de chargement ne fait que croitre.
  C'est le prix de l'invariant 4, et il est preferable a une reecriture du journal, qui serait
  une falsification d'archive.
- Le buffer de narration vit en memoire : un deploiement en cours de generation perd le texte en
  vol. Le fait moteur est deja persiste, donc le jeu reste coherent.

## Alternatives ecartees

| Alternative | Pourquoi non |
|---|---|
| Postgres | Un serveur de plus a exploiter pour quelques joueurs. Rien dans le produit n'en a besoin. A reconsiderer le jour ou l'ecrivain unique devient un probleme reel — pas avant |
| Next.js / SSR | Rien a referencer, tout est derriere authentification. Une seconde surface d'execution pour zero benefice |
| Etat final seul, sans journal d'evenements | Perd le carnet de campagne, l'annulation et le debogage, et rend le schema d'etat de jeu couteux a migrer |
| Contenu de jeu en base | Impose un back-office, des migrations de donnees, et rend irretrouvable la version de contenu qui a produit un jet |
| Outils IA capables de muter l'etat | Rend l'issue d'une action dependante d'un modele non deterministe, non rejouable et non testable. C'est exactement ce que l'invariant 1 interdit |
| Resume glissant du contexte (resume de resume) | Derive garantie sur une campagne de plusieurs mois : les faits se deforment, les noms glissent, les morts reviennent |
| Chronique hierarchique a trois couches | Meme defaut, en plus structure : elle empile des resumes sans provenance ni detection de reformulation |
| Generation de code depuis les schemas Zod | Une etape de build de plus a synchroniser. `satisfies z.ZodType<T>` donne la meme garantie a la compilation, sans artefact |
