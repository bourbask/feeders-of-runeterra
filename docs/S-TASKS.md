# Chantier scénario — les tâches

Cinq tâches. Elles ne touchent **aucun fichier de M0** : contenu neuf, schémas neufs, un paquet
neuf. Le chantier peut donc tourner pendant que M0 se termine.

Lire avant : `docs/design/04-scenarios.md` (la recherche) et `docs/adr/0012-le-scenario-assemble-jamais-invente.md` (les décisions).

| Tâche | Dépend de | Taille |
|---|---|---|
| **S-01** · le vocabulaire des pièces | — | moyenne |
| **S-02** · le graphe se valide | S-01 | moyenne |
| **S-03** · la frise et les premières pièces | S-01 | grosse |
| **S-04** · l'outil de construction guidée | S-01 | grosse |
| **S-05** · le scénario devient de l'état de jeu | S-04 | moyenne |

---

### S-01 · Contrats : le vocabulaire des pièces de scénario
**Taille** : moyenne · **Dépend de** : rien · **Bloque** : S-02, S-03, S-04

**À quoi ça sert.** Six familles de contenu neuves, décrites par des schémas Zod comme les huit qui
existent déjà. Rien ici n'ajoute une primitive au moteur : une période filtre, un front devient une
horloge, un nœud devient une scène, une figure devient une entité, un ressort devient un serment.

**Livrables** — dans `packages/contracts/src/content/`, sur le modèle exact de `region.ts` :
- `period.ts` — `id`, `name`, `summary`, `before`/`after` (bornes de frise, ordonnables), `factionIds`
  présentes, `absentFactionIds` explicitement nommées, `tags`.
- `front.ts` — `id`, `name`, `stake` (ce qu'on perd), `segments` ∈ {4,6,8,10}, et
  **`portents` : exactement `segments` entrées**, chacune une phrase concrète. `periodId`, `regionIds`.
- `node.ts` — `id`, `name`, `kind` (`lieu` | `confrontation` | `rencontre` | `revelation`),
  `situation` (l'état, jamais un déroulé), `stakeQuestion`, `figureIds`, `regionId`, `periodId`,
  et **`leads` : au moins TROIS**, chacune `{ toNodeId, trigger }`.
- `figure.ts` — `id`, `name`, `wants`, `refuses`, `knows`, `disposition` (le tuple du moteur),
  `factionId`, `periodId`. **Aucun chiffre de jeu** : une figure devient une entité, et l'entité
  porte ses propres nombres.
- `hook.ts` — le ressort : `id`, `appliesTo` (un trait de fiche, une faction, une région ou un
  champion nommé), `pitch`, `vowRank`, `suggestedBondIds`.
- `encounter.ts` — `id`, `kind` (`marchand` | `allie` | `bete` | `trouvaille` | `obstacle`),
  `periodId`, `regionKinds`, `oracleRef`.
- Les six ajoutés au registre, au manifeste et à l'index généré.

**Critères d'acceptation**
- `pnpm content:check` sort en 0, et `pnpm content:index && git diff --exit-code` aussi.
- Les six schémas sont **stricts** : un champ en trop fait échouer le parse. Le testeur en ajoute un
  à chacun des six, six fois code non nul. *(Et il vérifie la strictness par un test d'exécution,
  pas par le JSON Schema : `z.toJSONSchema` écrit `additionalProperties: false` même sur un objet
  non strict — ADR 0007.)*
- **`portents` a exactement `segments` entrées** : le testeur en retire une, puis en ajoute une,
  deux fois code non nul. Les deux sens.
- **`leads` en porte au moins trois** : le testeur en retire une sur un nœud qui en a trois, code
  non nul, avec le nœud nommé dans le message.
- Les quatre tuples fermés neufs (`kind` de nœud, `kind` de rencontre, bornes de segments, rangs de
  serment) sont comparés **membre à membre** au moteur quand il en porte déjà un, per ADR 0007, dans
  `exhaustive-union.test.ts`. Aucune recopie non comparée.
- `disposition` **réutilise le tuple du moteur**, jamais une seconde liste : c'est déjà une
  divergence connue (cinq valeurs côté modèle, quatre côté moteur), n'en ouvre pas une deuxième.

**Fichiers touchés** : `packages/contracts/src/content/{period,front,node,figure,hook,encounter}.ts`,
`packages/contracts/src/content/index.ts`, `packages/contracts/tests/**`, `content/manifest.json`,
`packages/content/src/**` (registre et index).

---

### S-02 · Le graphe de scénario se valide, et il refuse les rails
**Taille** : moyenne · **Dépend de** : S-01

**À quoi ça sert.** Transformer la décision 4 de l'ADR 0012 en commande. Un graphe qui pourrait
coincer est un contenu qui ne part pas.

**Livrables**
- Une cinquième passe du chargeur, `packages/content/src/validate-graph.ts`, qui ne regarde que la
  cohérence **entre** pièces — les quatre autres passes valident les pièces une à une.
- Un rapport lisible : le nœud fautif nommé, la règle citée, et **ce qu'il faut ajouter**.

**Les quatre règles, et elles sont toutes mesurables**
1. **Trois pistes minimum** par nœud.
2. **Aucun nœud orphelin** : tout nœud est atteignable depuis au moins un autre, ou déclaré
   `entryPoint`. Un nœud injoignable est du travail perdu et un trou de scénario.
3. **Pas de saut de période** : une piste ne traverse pas les périodes.
4. **Un front ne promet pas plus qu'il ne compte** : autant de présages que de segments.

**Critères d'acceptation**
- `pnpm content:check` sort en 0 sur le contenu livré.
- Pour **chacune des quatre règles**, le testeur fabrique la violation dans `content/` et exige un
  code non nul **qui nomme la règle et la pièce**. Quatre violations, quatre messages distincts.
- **Et les quatre dans l'autre sens** : violation retirée, retour à 0.
- Un test vérifie que la passe de graphe tourne **après** les quatre passes de pièce : un nœud
  référençant une figure inexistante échoue sur la passe de référence, pas sur celle du graphe —
  sinon le message envoie le lecteur au mauvais endroit.
- **Un chiffre qui vient d'un critère s'écrit en toutes lettres** : le `3` de la première règle ne
  se lit pas depuis le schéma qu'il vérifie.

**Fichiers touchés** : `packages/content/src/validate-graph.ts`, `packages/content/src/validate.ts`
(branchement de la cinquième passe), `packages/content/tests/**`.

---

### S-03 · La frise du Freljord, et de quoi jouer
**Taille** : grosse · **Dépend de** : S-01

**À quoi ça sert.** Les pièces. Sans elles, l'outil assemble du vide.

> **La charpente est empruntée, les textes sont à nous.** On prend les époques, les factions, les
> lieux et les tensions. On **ne recopie aucun paragraphe** de Riot dans `content/`. Décision 7 de
> l'ADR 0012, et ce n'est pas négociable : le dépôt est public, et un corpus recopié apprendrait au
> conteur une voix qui n'est pas la nôtre.

**Livrables**
- `content/periods/*.json` — **six périodes**, de l'avant-Sœurs au Freljord moderne, chacune disant
  ce qui est vrai alors et **ce qui ne l'est pas encore**. C'est le champ qui empêche l'anachronisme.
- `content/fronts/*.json` — **six fronts minimum**, dont au moins **trois sur la période moderne**,
  et parmi ceux-là trois qui **se gênent** : les Avarosans, la Griffe d'Hiver et les Gardiens du Gel
  veulent le même territoire par trois moyens différents. C'est la situation la plus riche que la
  frise offre, et elle est gratuite.
- `content/nodes/*.json` — **vingt nœuds minimum** sur la période moderne, formant un graphe qui
  passe S-02. Les régions existent déjà (`rakelstake`, `avarosa-reach`, `howling-abyss`…) : les
  nœuds s'y accrochent plutôt que d'en inventer.
- `content/figures/*.json` — **douze figures**, chacune avec **ce qu'elle veut, ce qu'elle refuse,
  ce qu'elle sait**. Ni chiffres, ni statistiques.
- `content/hooks/*.json` — **dix ressorts**, dont au moins **trois accrochés aux fiches livrées**
  (Braum, Ashe, Sejuani) par leur serment ou leurs atouts.
- `content/encounters/*.json` — **quinze rencontres**, réparties sur les cinq genres.

**Critères d'acceptation**
- `pnpm content:check` sort en 0, graphe compris.
- Un test vérifie qu'**aucune période ne se contredit** : une faction déclarée absente d'une période
  n'apparaît dans aucune pièce de cette période. Le testeur en glisse une, code non nul.
- Un test vérifie que les trois fronts modernes **visent des enjeux différents** : trois `stake`
  distincts, comparés deux à deux.
- Un test vérifie qu'**aucun texte ne cite un champion réservé** en dehors de son propre fichier —
  même normalisation que l'assertion `no_reserved_champion` déjà livrée.
- **Le graphe moderne est traversable** : un test part de chaque `entryPoint` et vérifie qu'il
  atteint au moins **douze** nœuds distincts. Le testeur coupe une piste, le compte tombe.
- Français partout, et **aucun chiffre de règle dans les textes** : une figure ne dit pas « +2 ».

**Fichiers touchés** : `content/{periods,fronts,nodes,figures,hooks,encounters}/**`,
`content/manifest.json`, `packages/content/tests/**`.

---

### S-04 · L'outil de construction guidée
**Taille** : grosse · **Dépend de** : S-01

**À quoi ça sert.** Le cœur du chantier : la machine qui fait construire un scénario à un modèle
**sans jamais lui laisser inventer une pièce**.

**La forme, et elle découle directement de la mesure de M0-32.** Aucun modèle gratuit local n'écrit
de sortie structurée — 24 échantillons, zéro bloc. Donc **pas de gros document JSON demandé d'un
coup**. Une question fermée à la fois, avec une petite liste de candidats, et une réponse qui tient
en **un identifiant plus une phrase**. Ça, un modèle de 3 milliards de paramètres sait le faire.

**Livrables** — paquet neuf `@for/scenario`, pur, sans accès réseau ni disque :
- `src/steps.ts` — les dix étapes de la section 6 de `04-scenarios.md`, dans l'ordre, chacune :
  sa question en français, la fonction qui **calcule ses candidats** depuis le contenu et ce qui a
  déjà été choisi, et sa règle de validation.
- `src/build.ts` — la machine : état, étape courante, choix faits. **Pure** : elle reçoit un port de
  décision, elle n'appelle personne.
- `src/candidates.ts` — le filtrage et le **mélange sur un flux nommé** (`scenario`), amorcé par
  campagne. Décision 6 de l'ADR 0012.
- `src/validate.ts` — un identifiant hors liste est **refusé**, l'étape est **reposée**, et au bout
  de **trois** échecs l'étape tombe sur son candidat **par défaut** — jamais sur une erreur : une
  construction qui échoue à mi-parcours laisse une campagne inutilisable.
- Le port de décision, sur le modèle exact de `NarratorPort` (ADR 0002) : un adaptateur simulé pour
  les tests, et **aucun SDK**.

**Critères d'acceptation**
- `pnpm turbo run test --filter @for/scenario` sort en 0.
- **Un identifiant inventé est refusé** : le double rend `figure-qui-nexiste-pas`, l'étape est
  reposée. Le testeur retire la validation, un test nommé tombe.
- **Trois échecs mènent au défaut, jamais à une exception** : le double rend trois fois n'importe
  quoi, la construction **aboutit**.
- **Rejouable** : même graine, mêmes réponses, même scénario — comparé **octet à octet**. Le testeur
  change la graine, le scénario diffère.
- **Variable** : dix graines donnent au moins **huit** scénarios distincts sur le contenu de S-03.
  *(Ce chiffre est un critère : il s'écrit en toutes lettres dans le test.)*
- **Les candidats sont filtrés par la période** : un test choisit une période ancienne et vérifie
  qu'aucune figure moderne n'est proposée. Le testeur retire le filtre, le test tombe.
- **Le paquet est pur** : `grep -rn "node:fs\|fetch(" packages/scenario/src | wc -l` affiche `0`, et
  `depcruise` ne lui donne aucune arête vers `@for/db` ni `@for/server`.
- **L'étape B ne tourne pas sans personnages** : un test appelle l'étape des ressorts sans distribution
  et exige un refus explicite, pas un scénario bancal.

**Fichiers touchés** : `packages/scenario/**` (neuf), `pnpm-workspace.yaml`, `tsconfig` racine,
`.dependency-cruiser.cjs`.

---

### S-05 · Le scénario devient de l'état de jeu
**Taille** : moyenne · **Dépend de** : S-04

**À quoi ça sert.** Un scénario construit ne sert à rien tant qu'il n'est pas **des horloges, des
entités et un serment** dans une campagne réelle.

**Livrables**
- `packages/scenario/src/seed.ts` — la traduction, **pure** : un scénario en entrée, une liste
  d'**intentions** en sortie. Pas d'événements : le moteur décide, comme toujours.
- Le branchement serveur : la construction tourne **une fois**, à la création de campagne, et ses
  intentions passent par le chemin ordinaire de M0-24.

**Critères d'acceptation**
- Un front devient une **horloge** au bon nombre de segments, et ses présages sont **conservés** —
  un test vérifie que le présage du segment 3 est lisible après amorçage.
- Une figure devient une **entité** `npc` à la bonne disposition ; un nœud d'entrée devient la
  **scène** initiale ; le ressort devient un **serment** au rang annoncé.
- **Tout passe par des intentions** : `grep -rn "appendEvents\|emit(" packages/scenario/src | wc -l`
  affiche `0`. Le moteur décide, le scénario propose.
- **Rejouable de bout en bout** : même graine, deux amorçages, `db:check` à 0 et le même `sha256`.
- **Le contrôle 9 de M0-17 passe** sur une campagne amorcée par un scénario : les projections se
  reconstruisent octet à octet.
- Un test vérifie qu'une campagne amorcée par scénario **se joue** : une intention de mouvement
  ordinaire est acceptée juste après l'amorçage.

**Fichiers touchés** : `packages/scenario/src/seed.ts`, `packages/server/src/game/**` (branchement),
`packages/scenario/tests/**`.
