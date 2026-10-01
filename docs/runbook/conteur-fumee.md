# Runbook — la sonde de fumée du conteur

Ce que la sonde répond, comment on la lance, et ce qu'elle a répondu la première fois.
Autorité sur la couche : `docs/design/02-mj-ia.md`. Autorité sur le budget : ADR 0011.

---

## 0. Ce qu'elle répond, et ce qu'elle ne répond pas

| Elle répond | Elle ne répond pas |
| --- | --- |
| un fournisseur tient-il le prompt contraint, oui ou non | la prose est-elle bonne |
| sur quoi il tombe exactement | comment se comparent deux fournisseurs |
| combien de tokens d'entrée un tour coûte **vraiment**, mesurés par le fournisseur | quel fournisseur le dépôt doit choisir |

Elle **ne bloque rien** : `grep -c "eval:smoke" .github/workflows/ci.yml` affiche `0`, et une
règle tombée sort quand même en **0**. Un verdict informe une décision, il ne ferme pas une porte.

---

## 1. La lancer

```bash
pnpm eval:smoke --provider=stub                 # sans clé, sans réseau — exerce le harnais
NARRATOR_BASE_URL=http://127.0.0.1:11434 \
NARRATOR_MODEL=<modèle> \
  pnpm eval:smoke --provider=ollama             # un modèle local
NARRATOR_BASE_URL=<url> NARRATOR_API_KEY=<clé> NARRATOR_MODEL=<modèle> \
  pnpm eval:smoke --provider=openai-compatible  # une passerelle gratuite
```

| Code de sortie | Ce que ça veut dire |
| --- | --- |
| `0` | la sonde a tourné et rendu un verdict, favorable **ou non** |
| `1` | elle n'a **pas pu** tourner : fournisseur inconnu, variable manquante, aucun cas, compte de règles hors bornes, fournisseur injoignable |

Aucune clé ne vit dans le dépôt : tout passe par l'environnement, et `.env` est ignoré par git.

---

## 2. Le verdict de la première exécution réelle — 25 septembre 2026

Fournisseur mesuré : **`ollama` local**, image `ollama/ollama` 0.34.4, **CPU seul** (Intel Core
Ultra 7 265H, 16 cœurs, pas de GPU). Prompt `conteur/2.0.0`, empreinte `b59dadb40dff`, mode
**prose seule** (`tools: []`, ADR 0011), trois cas × deux échantillons.

| Modèle | Passées | Ce qui tombe, et sur combien d'échantillons |
| --- | --- | --- |
| `qwen2.5:3b-instruct`, 1re exécution | **3 / 7** | `scene_block_present` 6/6 · `scene_block_wellformed` 6/6 · `length_in_range` 2/6 · `second_person_singular` 1/6 |
| `qwen2.5:3b-instruct`, 2e exécution | **5 / 7** | `scene_block_present` 6/6 · `scene_block_wellformed` 6/6 |
| `mistral:7b-instruct` | **1 / 7** | `scene_block_wellformed` 6/6 · `length_in_range` 4/6 (jusqu'à **25 phrases**) · `second_person_singular` 4/6 · `scene_block_present` 4/6 · `no_outcome_decision` 3/6 (« dé ») · `no_locked_champion` 2/6 (**« Ashe »**) |

**Deux exécutions du même modèle ne donnent pas le même chiffre** — risque 3 d'`ARCHITECTURE.md`,
« aucun déterminisme d'échantillonnage ». Ce qui est stable, et c'est là qu'il faut regarder, est
ce qui tombe **6/6 dans les trois exécutions**.

### 2.1 La phrase qui en découle

> **Aucun des deux modèles locaux gratuits n'écrit le bloc `<scene_apres>`. Zéro fois sur
> dix-huit échantillons.** Le reste du prompt tient à peu près chez `qwen2.5:3b` : langue,
> deuxième personne, pas de chiffre. Ce qui ne tient jamais, c'est la seule partie du prompt qui
> demande une sortie **structurée**.

Reproduit indépendamment par la recette : six échantillons de plus sur `qwen2.5:3b-instruct`,
`scene_block_present` tombée **6/6**. Soit **vingt-quatre échantillons sans un seul bloc**.

C'est le même défaut qui a fait déclarer `tools: false` par défaut en M0-18. `<scene_apres>` est
du balisage et non un appel d'outil, et il tombe quand même : **la conclusion de M0-18 vaut aussi
pour le bloc de fin**.

**`mistral:7b-instruct` ne raconte pas : il recopie le prompt.** À l'appel à froid, sa sortie
commence par « Tu es le Conteur de "Feeders of Runeterra" … » et remplit les 800 tokens de
budget. Un modèle de 7 milliards de paramètres, servi 4 279 tokens de consignes, régurgite les
consignes. Il nomme aussi un champion verrouillé, deux fois sur six — la seule violation
d'invariant observée de toute la campagne de mesure.

### 2.2 Combien de tours, vraiment

| | `qwen2.5:3b` | `mistral:7b` |
| --- | ---: | ---: |
| entrée par tour, **comptée par le fournisseur** (médiane des six échantillons) | 5 054 | 5 767 |
| entrée par tour, estimateur local `chars / 3,6` (médiane) | 4 838 | 4 838 |
| écart estimateur / réel | −4,3 % | **−16,1 %** |
| premier tour, préfixe **froid** | 204 s | **921 s** |
| tours suivants, préfixe **en cache** | ≈ 22 s | ≈ 420 s |
| six tours, de bout en bout | **318 s** | ≈ 2 500 s |

**Un modèle local n'a pas de plafond par jour : son plafond est la vitesse.** Sur ce poste,
`qwen2.5:3b` donne ≈ **160 tours par heure** une fois chaud — une séance de soixante tours en
vingt-trois minutes de calcul, jouable. `mistral:7b` donne ≈ **8 tours par heure** : une séance
de soixante tours demanderait **sept heures**. Le sept milliards est hors jeu sans GPU, et le
trois milliards ne rend pas le bloc de fin.

### 2.3 Ce qui n'a PAS été mesuré, et ce qu'il faut pour le mesurer

**Aucune offre gratuite *hébergée* n'a été mesurée : il n'y a pas de clé dans cet
environnement.** Le réseau sort — `https://openrouter.ai/api/v1/models` répond `200`,
`https://api.groq.com/openai/v1/models` répond `401`, `generativelanguage.googleapis.com` répond
`403` — mais `NARRATOR_API_KEY` n'existe pas. Rien n'a été simulé à la place.

Pour obtenir la ligne « tant de tours par jour » d'une offre hébergée :

1. une clé d'un fournisseur gratuit **dans l'environnement**, jamais dans le dépôt ;
2. `NARRATOR_BASE_URL` et `NARRATOR_MODEL` correspondants ;
3. `pnpm eval:smoke --provider=openai-compatible` pour le verdict et la ligne `entrée` ;
4. puis la **relance jusqu'au refus** (`rate_limited` ou `quota_exhausted`) : c'est le seul moyen
   de mesurer le plafond réel plutôt que celui d'une page de documentation. Le nombre d'appels
   passés avant le refus **est** le nombre de tours par jour.

---

## 3. Le défaut trouvé en lançant la sonde

**Un modèle local lent échoue en `unavailable` au bout de cinq minutes, quel que soit
`NARRATOR_TIMEOUT_MS`.**

`fetch` de Node porte un délai d'en-têtes par défaut de **300 s** (undici, `headersTimeout`).
Un serveur Ollama en `stream: true` n'envoie ses en-têtes qu'**après** avoir évalué le prompt.
Sur `mistral:7b-instruct`, l'évaluation des **5 737 tokens du cas 1** — le plus court des trois,
pas la médiane, qui vaut 5 767 — a pris **520 s** : la requête est coupée
par le client, et `wrapUnknown` la classe `unavailable`. Un fournisseur qui marche, déclaré en
panne. C'est exactement ce qui est arrivé à la première tentative de mesure.

Mesuré séparément, avec un serveur qui retient ses en-têtes 310 s et un `AbortSignal` réglé à
**900 s** :

```
ECHEC apres 302 s : fetch failed | cause = UND_ERR_HEADERS_TIMEOUT
```

`NARRATOR_TIMEOUT_MS` ne corrige rien : il pilote l'`AbortSignal`, pas le `Dispatcher` d'undici.
L'en-tête de `packages/ai/src/narrator/adapters/ollama.ts` promet « a cold start goes past sixty
seconds WITHOUT BEING A FAILURE. Hence `NARRATOR_TIMEOUT_MS` » — **la promesse n'est tenue que
jusqu'à 300 s, et aucun test ne la garde**.

Correctif possible, à arbitrer par le lead : passer aux trois adaptateurs réseau un `dispatcher`
dont `headersTimeout` et `bodyTimeout` valent `config.timeoutMs`. Ce n'est pas la tâche M0-32 ;
c'est signalé, pas contourné.

---

## 4. Si le prompt ne tient pas, que couper

Poids **mesuré** de chaque section de `conteur/2.0.0`, section par section, avec l'estimateur
local (la commande est reproduite ci-dessous ; aucun script n'est livré pour ça).
Prompt entier : **4 279** tokens pour 15 404 caractères — c'est ce chiffre-là qui sert aux coupes.
La colonne ci-dessous, elle, somme à **4 285** : l'estimateur arrondit chaque section séparément,
et treize arrondis coûtent six tokens. Les deux sont justes, ils ne mesurent pas la même chose.

| Section | Tokens | Coupable en mode prose seule ? |
| --- | ---: | --- |
| `# Comment tu utilises les outils` | **281** | **oui, en premier** — aucun outil n'est envoyé (ADR 0011) : la section décrit une surface qui n'existe plus |
| `# Ce que tu n'écris jamais` | **342** | oui — `banned_style_lexicon` est une assertion **dure** de `@for/ai`, appliquée en post-filtre : la liste est déjà tenue ailleurs |
| `# Quand une action est impossible` | **375** | oui, avec réserve — le serveur reprouve seul toute cause de refus (R1→R7) ; ce qu'on perd, c'est le taux de refus **bien formés** |
| `# Continuité` | **187** | oui tant que `<chronique>` n'est pas dans le contexte |
| `# Ce que tu fais à chaque fois` | **179** | oui — obligations jugées par N2, jamais par une assertion |
| `# Deux réponses à la même situation` | **562** (dont **470** pour la paire MAUVAIS/BON) | **en dernier** — levier de registre le plus efficace mesuré, risque 2 d'`ARCHITECTURE.md` |
| `# Le registre` | 269 | non |
| `# Les faits de scène` | 275 | **non** — c'est la correction du § 4.7, celle qui empêche un mort de revenir |
| `# Ce que tu renvoies après ta narration` | 363 | **non** — et c'est précisément ce que les petits modèles ratent déjà |
| `# Forme de ta réponse` | 183 | non |
| `# Comment tu finis` | 193 | non |
| `# Règles absolues` | 920 | non — c'est l'invariant 1 écrit en français |
| `# Ce que tu es` | 107 | non |
| préambule, avant le premier `#` | 49 | non |

**Les quatre coupes sans regret** — outils, liste noire, continuité, obligations — valent
`281 + 342 + 187 + 179 =` **989 tokens**, et mènent le prompt à **3 290**.

**La cible de 2 400 de l'ADR 0011 n'est atteignable qu'en coupant AUSSI la paire d'exemples et
le droit de refus** : `4 279 − 989 − 562 − 375 =` **2 353**. C'est le seul découpage mesuré qui
passe sous la cible, et il supprime le levier de registre que la session sur `conteur/1.0.0`
avait justement fait ajouter. **C'est un arbitrage de lead, pas une simplification.**

Reproduire la mesure, **depuis la racine du dépôt** (la racine ne dépend pas de `@for/ai` : sans
le `--filter`, la commande sort en **1** sur `ERR_MODULE_NOT_FOUND`) :

```bash
pnpm turbo run build --filter @for/ai
pnpm --filter @for/ai-eval exec node --import tsx -e "import('@for/ai').then(m=>{const p=m.CONTEUR_SYSTEM_PROMPT;
for(const s of p.split(/^(?=# )/m)) console.log(String(m.estimateTokens(s)).padStart(5), s.split('\n')[0]);});"
```

---

## 5. Un chiffre de budget n'est pas un chiffre de fournisseur

L'ADR 0011 raisonne en tokens de l'estimateur local. La sonde mesure les deux :

| | `qwen2.5:3b` | `mistral:7b` |
| --- | ---: | ---: |
| entrée estimée (`chars / 3,6`), médiane | 4 838 | 4 838 |
| entrée **comptée par le fournisseur**, médiane | 5 054 | 5 767 |
| écart | −4,3 % | **−16,1 %** |

Les six échantillons de `mistral:7b-instruct`, re-mesurés le 25 septembre au soir, un par un :
`issue-franche` **5 737** ×2 · `issue-echec` **5 767** ×2 · `prix-impose` **5 786** ×2, médiane
**5 767**. Une première rédaction portait 5 737 ici et 5 767 au § 2.2 : c'était la valeur du
**cas 1** écrite à la place de la médiane. Un seul chiffre par mesure, et c'est la médiane.

**Comment ces six-là ont été comptés**, parce que la méthode change le crédit qu'on leur accorde :
la sonde elle-même ne peut pas les rendre sur ce poste — le défaut du § 3 la coupe à 300 s sur
`mistral`, `unavailable`, exit **1**. Ils ont donc été demandés à `curl` (qui n'a pas ce plafond)
sur le **corps que l'adaptateur construit**, `CONTEUR_SYSTEM_PROMPT` en `system` et
`buildUserMessage(cas)` en `user`, et lus dans le `prompt_eval_count` d'ollama — le champ même que
l'adaptateur recopie dans `usage.inputTokens`. Seul `num_predict` diffère, ramené de 800 à 1 :
il ne touche pas au compte d'**entrée**. Contrôle, à 800 pour de bon : `issue-echec`,
`prompt_eval_count` = **5 767**, identique, en 451 s.

Le § 4.3 de `02-mj-ia.md` tolère **8 %** de dérive et fait échouer un test nocturne au-delà. Sur
`mistral:7b`, l'estimateur est déjà hors tolérance **sur le seul prompt système**. Conséquence
directe pour l'ADR 0011 : une cible de 7 000 tokens par tour exprimée dans l'estimateur peut
valoir 8 100 chez un fournisseur réel. **Le budget se vérifie chez le fournisseur qu'on vise,
pas dans l'estimateur.**
