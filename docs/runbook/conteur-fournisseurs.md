# Runbook — mesurer un fournisseur du conteur, et choisir

Ce que la sonde répond, comment on la lance, ce qu'elle a répondu, et la recommandation qui en
découle. Autorité sur la couche : `docs/design/02-mj-ia.md`. Autorité sur le budget : ADR 0011.

---

## 0. Ce qu'elle répond, et en quoi elle diffère de la sonde de fumée

| | Sonde de **fumée** (M0-32) | Sonde de **fournisseurs** (M0-31, ici) |
| --- | --- | --- |
| La question | ce fournisseur tient-il le prompt contraint ? | **lequel on prend ?** |
| Ce qui note | 7 règles écrites à la main dans `smoke/assertions.ts` | les **16 assertions dures** de production, **importées** de `@for/ai/src/assertions` |
| La requête | la plus petite qui porte encore la contrainte, assemblée dans la sonde | **celle de la production**, `buildNarrateRequest` de `@for/ai` : chronique, état, fenêtre roulante, échelle de troncature |
| Le corpus | 3 cas | 6 cas — les trois issues, un présage, une pression sur les réservés, un prix imposé |
| La sortie | un verdict lisible | une **matrice de capacités**, un taux par `(fournisseur, assertion)`, et une **recommandation** |
| Quand | vague 7, avant que rien ne soit écrit dessus | vague 8, pour trancher |

Les deux ne se remplacent pas. La fumée dit *est-ce que ça tient debout*, et elle le dit une vague
plus tôt ; celle-ci dit *lequel on prend*, et elle a besoin du corpus pour le dire.

Elle **ne bloque rien** : `grep -c "eval:probe" .github/workflows/ci.yml` affiche `0`, et un
fournisseur qui échoue sur quinze règles sur seize sort quand même en **0**.

---

## 1. La lancer

```bash
pnpm eval:probe --provider=stub                      # sans clé, sans réseau — exerce le harnais

NARRATOR_BASE_URL=http://127.0.0.1:11434 \
NARRATOR_MODEL=<modèle> \
  pnpm eval:probe --provider=ollama                  # un modèle local

NARRATOR_BASE_URL=<url> NARRATOR_API_KEY=<clé> NARRATOR_MODEL=<modèle> \
  pnpm eval:probe --provider=openai-compatible       # une passerelle gratuite

# comparer deux mesures : la seconde fusionne la première, sur le MÊME corpus
pnpm eval:probe --provider=ollama --merge=probe-report.json --out=probe-report-2.json
```

| Option | Ce qu'elle fait |
| --- | --- |
| `--provider=<id>` | **répétable** : plusieurs fournisseurs dans une seule exécution, sur le même corpus |
| `--model=<id>`, `--base-url=<url>` | surchargent l'environnement, dans l'ordre des `--provider` |
| `--merge=<fichier>` | fusionne un rapport antérieur ; **refuse** si le prompt ou le corpus diffèrent |
| `--out=<fichier>` | où écrire `probe-report.json` (défaut : à la racine, ignoré par git) |
| `--no-tool-probe` | n'ouvre pas la seconde socket de la sonde de capacités |

**Il n'y a volontairement pas de `--api-key`.** Une clé passée en argument entre dans
l'historique du shell, dans `ps` et dans tout journal de CI qui répète sa commande. Elle vient de
l'environnement ou elle ne vient pas. Ce dépôt est public.

| Code de sortie | Ce que ça veut dire |
| --- | --- |
| `0` | la sonde a tourné et produit un rapport, **favorable ou non** |
| `1` | elle n'a **pas pu** tourner : fournisseur inconnu, variable manquante, corpus sous le plancher de six, prémisse non déclarée, identifiant de règle absent de `@for/ai`, rapport à fusionner illisible ou mesuré ailleurs |

---

## 2. Le banc — 1er octobre 2026

| | |
| --- | --- |
| Prompt | `conteur/2.1.0`, empreinte `3b7037abc4d0`, **2 394 tokens estimés** |
| Mode | **prose seule** — `tools: []`, `toolPolicy: 'none'` (ADR 0011) |
| Corpus | 6 cas × 2 échantillons = **12 appels par fournisseur** |
| Notation | les **16 assertions dures** de `@for/ai`, importées, aucune copie |
| Machine | Intel Core Ultra 7 265H, 16 cœurs, **CPU seul, pas de GPU**, 62 Gio |
| Serveur local | conteneur `ollama/ollama:latest`, volume partagé avec la mesure de M0-32 |

**Le prompt n'est plus celui de la sonde de fumée.** M0-32 a mesuré `conteur/2.0.0` à
**4 279** tokens ; M0-22 a depuis appliqué la coupe de l'ADR 0011 et `conteur/2.1.0` pèse
**2 394**, sous sa cible annoncée de 2 400. Les deux verdicts ne portent donc pas sur le même
texte, et c'est la première chose à savoir avant de les comparer.


### 2.1 Face au verdict de fumée de M0-32

`docs/runbook/conteur-fumee.md` a rendu son verdict le 25 septembre, sur `conteur/2.0.0`, trois
cas, sept règles écrites à la main. Le voici confronté à celui-ci — **deux verdicts qui divergent
sur le même modèle sont une information, pas une contradiction à masquer.**

| Ce que disait la fumée | Ce que dit la mesure complète | Verdict |
| --- | --- | --- |
| « aucun des deux modèles locaux n'écrit le bloc `<scene_apres>` — zéro fois sur vingt-quatre » | zéro fois sur **quatre-vingt-quatre**, sur un prompt deux fois plus court, avec un second modèle et un second adaptateur | **confirmé, et renforcé** |
| « le reste du prompt tient à peu près chez `qwen2.5:3b` : langue, deuxième personne, pas de chiffre » | `no_digits` 100 %, `no_terminal_prompt` 100 %, `no_time_skip` 100 %, `no_atmosphere_ending` 100 % | **confirmé** |
| `qwen2.5:3b` « passe 3 puis 5 assertions sur 7 » | sur les **seize dures**, il en tient douze à 100 % et tombe sur `sentence_count`, `no_rules_lexicon` et `price_respected` | **complété** : les règles que la fumée n'avait pas |
| « `mistral:7b` nomme un champion verrouillé, deux fois sur six — la seule violation d'invariant observée » | `llama3.2:3b` nomme **« L'Archère de Givre »** une fois sur douze | **confirmé sur un autre modèle** : la serrure de distribution est ce que les petits modèles cassent |
| estimateur à **−4,3 %** sur `qwen` (prompt système seul) | **−8,3 %** sur la requête de production entière, et **−9,3 %** sur `llama3.2` | **corrigé** : l'écart est pire que la fumée ne le voyait, parce que la fumée ne mesurait qu'un bloc |
| `qwen2.5:3b` ≈ **160 tours/heure** une fois chaud | ≈ **400 tours/heure**, sur un prompt passé de 4 279 à 2 394 tokens | **corrigé à la hausse** |
| « `mistral:7b-instruct` ne raconte pas : il recopie le prompt », ≈ 8 tours/heure | **non re-mesuré** : à huit tours par heure, le corpus complet demanderait une heure et demie pour confirmer un modèle déjà hors jeu. La fumée suffit à l'écarter | **repris tel quel** |

Le point où les deux se rejoignent sans réserve est celui qui décide : **le bloc de scène ne sort
jamais.**

---

## 3. La matrice de capacités

Mesurée, jamais lue dans une documentation. La colonne « sonde d'outils » est un **appel réel**
avec un outil et `toolPolicy: 'auto'`, sur un port forcé à `NARRATOR_TOOLS=on` — la mesure porte
sur le modèle, pas sur l'interrupteur de l'adaptateur.

| Fournisseur · modèle | `tools` annoncé | `structuredOutput` | `promptCache` | fenêtre | sonde d'outils |
| --- | --- | --- | --- | ---: | --- |
| `ollama` · `qwen2.5:3b-instruct` | non | oui | non | 8 192 | **appel observé** (`check_name_allowed`) |
| `ollama` · `llama3.2:3b-instruct-q4_K_M` | non | oui | non | 8 192 | **appel observé** |
| `openai-compatible` · `qwen2.5:3b-instruct` | non | oui | non | 32 000 | **appel observé** |

Deux choses à lire ici, et elles ne vont pas dans le même sens.

**`tools: non` n'est pas une mesure, c'est un réglage.** Les trois adaptateurs posent
`tools: config.tools === 'on'`, et la configuration de mesure est `off` — le mode prose seule de
l'ADR 0011. La colonne dit donc ce que l'adaptateur **transmettra**, pas ce que le modèle **sait
faire**.

**Ce que le modèle sait faire, lui, est mesuré : les deux modèles locaux de 3 milliards de
paramètres appellent l'outil qu'on leur tend, du premier coup, tous les trois essais.** C'est à
mettre en face du § 5 : les mêmes modèles n'écrivent **jamais** le bloc `<scene_apres>`. Ils ne
savent pas produire du balisage de fin de réponse ; ils savent appeler une fonction.

### 3.1 Ce qui est « sans objet » pour un fournisseur dont `capabilities.tools` est faux

Un fournisseur à `tools: false` est **mesuré quand même** — c'est le cas des trois lignes
ci-dessus — et voici ce qui, pour lui, n'a pas d'objet :

| Assertion | Pourquoi elle est sans objet | Est-elle dure ? |
| --- | --- | --- |
| `tool_calls` | la requête ne porte aucun outil, donc aucun appel n'est possible | **non** — elle ne fait pas partie des seize du § 8.6, et la sonde ne la lance pas |

Et c'est tout : **aucune des seize assertions dures ne dépend de la capacité `tools`.** Le mode
prose seule de l'ADR 0011 est précisément celui où une capacité absente ne retire rien à la
notation. Ce n'est pas un échec du fournisseur, c'est une dégradation connue (§ 0.2).

**La fenêtre de `openai-compatible` est une valeur par défaut prudente, pas une mesure** :
`OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS = 32 000`, écrit en dur faute d'un fournisseur qui dise la
sienne. Elle sert au budget (`min(7 000, fenêtre × 0,6)`), donc elle décide de l'échelle de
troncature — contre un serveur dont le créneau réel était 4 096 (§ 8.3). Un fournisseur dont la
fenêtre est plus étroite que 32 000 ne le dira pas et le budget ne le saura pas.


---

## 4. Les taux par (fournisseur, assertion)

Taux = **passées / applicables**. Une règle qui n'avait rien à dire s'écrit « sans objet », jamais
« 100 % » — voir § 5. Exécution du 1er octobre, machine au repos, les trois fournisseurs dans le
**même processus** et sur le **même corpus**.

| Assertion dure | `ollama` qwen2.5:3b | `ollama` llama3.2:3b | `openai-compatible` qwen2.5:3b |
| --- | ---: | ---: | ---: |
| `sentence_count` | **33 %** | 92 % | 58 % |
| `no_digits` | 100 % | 100 % | 100 % |
| `no_rules_lexicon` | **42 %** | 83 % | **67 %** |
| `no_outcome_decision` | 92 % | 100 % | 92 % |
| `no_reserved_champion` | **100 %** | **92 %** | **100 %** |
| `no_pc_agency` | 100 % | 92 % | 92 % |
| `no_terminal_prompt` | 100 % | 100 % | 100 % |
| `price_respected` | 50 % (1/2) | 100 % (2/2) | 50 % (1/2) |
| `no_time_skip` | 100 % | 100 % | 100 % |
| `banned_style_lexicon` | 100 % | 83 % | 100 % |
| `no_named_emotion` | 100 % | 100 % | 100 % |
| `sentence_length_cap` | 100 % | 100 % | 100 % |
| `max_one_dialogue_line` | 100 % | 100 % | 100 % |
| `no_atmosphere_ending` | 100 % | 100 % | 100 % |
| `no_absent_reappearance` | 100 % | 100 % | 100 % |
| `scene_block_consistent` | **sans objet** | **sans objet** | **sans objet** |

Les extraits fautifs, tels que la sonde les cite :

| Règle | Ce qui tombe |
| --- | --- |
| `no_rules_lexicon` | « élan », « vivres » — le modèle recopie le vocabulaire de l'`<etat>` qu'on lui donne à lire |
| `no_outcome_decision` | « tu perds », « tu parviens à » |
| `no_reserved_champion` | **« L'Archère de Givre »**, alias d'`ashe`, écrit par `llama3.2:3b` sur un cas où le joueur l'avait nommé dans son intention |
| `price_respected` | « aucun mot-clé de l'entrée : froid, morsure, gel » |
| `no_pc_agency` | « tu veux », « Tu penses » |
| `banned_style_lexicon` | « comme si », « étrange » |

### 4.1 Un seul passage ne classe pas deux fournisseurs

**C'est la mesure la plus importante de ce rapport, et elle porte sur la mesure elle-même.** Le
même modèle, le même adaptateur, le même corpus, relancé :

| Règle | `ollama` qwen, passage 1 | passage 2 |
| --- | ---: | ---: |
| `sentence_count` | 67 % | 33 % |
| `no_rules_lexicon` | 58 % | 42 % |
| `no_digits` | 92 % | 100 % |
| `banned_style_lexicon` | 92 % | 100 % |

| Règle | `openai-compatible` qwen, passage 1 | passage 2 | passage 3 |
| --- | ---: | ---: | ---: |
| `sentence_count` | 33 % | 42 % | 58 % |
| `no_rules_lexicon` | 100 % | 83 % | 67 % |
| `price_respected` | 100 % | 50 % | 50 % |

C'est le risque 3 d'`ARCHITECTURE.md`, « aucun déterminisme d'échantillonnage », mesuré sur le
corpus complet. **Un écart de dix ou vingt points entre deux fournisseurs, sur douze échantillons,
ne veut rien dire.** Ce qui veut quelque chose, c'est ce qui se répète à tous les passages — et la
section 5 en est l'exemple.

Conséquence opératoire : **ne pas trancher un fournisseur sur une exécution.** La sonde accepte
`--merge` précisément pour qu'on en empile plusieurs.


---

## 5. Ce que les seize règles ne voient pas

Les seize règles notent la **prose**. Trois faits leur échappent, et la sonde les compte à part
parce qu'ils ne sont pas des assertions et ne doivent pas être comptés comme telles.

| Fournisseur | bloc `<scene_apres>` | prose vide | prose tronquée (notre borne) | réponse coupée (le fournisseur) | appels répondus |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ollama` · qwen2.5:3b | **0/12** | 0/12 | 0/12 | 0/12 | 12/12 |
| `ollama` · llama3.2:3b | **0/12** | 0/12 | 0/12 | 0/12 | 12/12 |
| `openai-compatible` · qwen2.5:3b | **0/12** | 0/12 | 0/12 | 0/12 | 12/12 |

### 5.1 Le résultat qui décide de tout

> **Aucun des trois fournisseurs mesurés n'écrit le bloc `<scene_apres>`. Zéro fois sur
> QUATRE-VINGT-QUATRE échantillons**, sept exécutions, deux modèles, deux adaptateurs.

Et ce n'est pas la faute du budget de sortie : `réponse coupée par le fournisseur` vaut **0/12**
partout. Les modèles ont fini leur réponse ; ils ont simplement fini sans le bloc.

M0-32 avait mesuré la même chose, vingt-quatre fois, sur `conteur/2.0.0`. **Le prompt a changé
depuis — 4 279 tokens sont devenus 2 394 — et le résultat n'a pas bougé d'un échantillon.** On ne
peut donc plus l'imputer à la longueur du prompt : c'est la capacité à produire une sortie
structurée en fin de réponse qui manque.

**Ce que ça coûte, concrètement.** `scene_block_consistent` est une assertion **dure**, consommée
par le post-filtre de production (§ 8.6). Elle n'a jamais rien à noter : son taux est « sans
objet », pas 100 %. Et la fusion de scène du § 4.7, la règle S5 qui empêche un mort de revenir,
n'a **rien à fusionner**. Toute la machinerie de cohérence de scène est, avec ces modèles,
un mécanisme qui ne s'exécute jamais.

**Et la sortie de secours est mesurée, elle aussi** : ces mêmes modèles appellent un **outil** du
premier coup (§ 3). Voir la recommandation, § 9.3.


---

## 6. L'entrée par tour, et l'estimateur

| Fournisseur | estimé (`chars/3,6`) | compté par le fournisseur | écart | caractères par token **réel** | échelle de troncature | latence médiane |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `ollama` · qwen2.5:3b | 3 755 | **4 096** | **−8,3 %** | 3,30 | T0 | **9 s** |
| `ollama` · llama3.2:3b | 3 755 | **4 140** | **−9,3 %** | 3,27 | T0 | 30 s |
| `openai-compatible` · qwen2.5:3b | 3 755 | *non compté* | — | — | T0 | **148 s** |

### 6.1 L'estimateur reste hors tolérance, et de combien

Le § 4.3 tolère **8 %** de dérive et fait échouer un test nocturne au-delà. Sur la requête de
production complète, l'estimateur sous-estime de **8,3 %** et **9,3 %** : hors tolérance, des deux
côtés, mais **moins gravement que sur `mistral:7b`**, où M0-32 mesurait −16,1 %.

**Recalibrage proposé, et c'est une mesure, pas une opinion.** `CHARS_PER_TOKEN = 3.6` dans
`packages/ai/src/prompts/estimate.ts`. Mesuré ici sur la requête de production entière, 24
échantillons comptés par le fournisseur :

| Modèle | caractères par token réel |
| --- | ---: |
| `qwen2.5:3b-instruct` | **3,30** |
| `llama3.2:3b-instruct` | **3,27** |

**`CHARS_PER_TOKEN = 3,3` ramènerait l'écart sous 1 % sur les deux modèles mesurés**, au prix d'un
budget plus prudent de 9 % — ce qui est le bon sens : *« a budget is never optimistic »*, dit déjà
l'en-tête de l'estimateur. Le changement appartient à `@for/ai` et touche la taille de tous les
contextes du dépôt ; il est **proposé, pas appliqué ici**, et il demande un arbitrage parce qu'il
déplace l'échelle de troncature de chaque campagne.

**Prudence sur la portée.** Trois tokeniseurs, deux familles (`qwen2`, `llama`), un seul texte
français. Un modèle hébergé peut avoir un tokeniseur très différent ; l'ADR 0011 raisonne sur
toutes les offres gratuites, et ces deux-là n'en sont pas.

### 6.2 La coupe de l'ADR 0011 a tenu, et ça se voit ici

La requête complète pèse **3 755 tokens estimés** contre un budget de `min(7 000, 8 192 × 0,6) =`
**4 915** sur une fenêtre locale : **l'échelle de troncature reste à T0 sur les six cas**, rien
n'est coupé, et il reste 1 160 tokens de marge. Avec les 4 279 tokens de `conteur/2.0.0`, le même
contexte aurait débordé. La décision de l'ADR 0011 est, de ce côté-là, vérifiée.

### 6.3 Ce que coûte une séance de soixante tours

| Fournisseur | latence médiane | tours par heure | une séance de 60 tours |
| --- | ---: | ---: | --- |
| `ollama` · qwen2.5:3b | 9 s | ≈ 400 | **9 minutes de calcul** — jouable |
| `ollama` · llama3.2:3b | 30 s | ≈ 120 | 30 minutes — jouable, à la limite |
| `openai-compatible` → même serveur, même modèle | 148 s | ≈ 24 | 2 h 28 — **injouable** |

**Un modèle local n'a pas de plafond par jour : son plafond est la vitesse.** Et la dernière ligne
n'est pas une mesure de modèle, c'est une mesure d'**adaptateur** : même serveur, même modèle,
mêmes octets, seize fois plus lent. Voir § 8.3.


---

## 7. Ce qui n'a PAS été mesuré, et ce qu'il faut pour le mesurer

**Aucune offre gratuite *hébergée* n'a été mesurée : il n'y a pas de clé dans cet
environnement.** `env | grep -cE 'NARRATOR_API_KEY|OPENROUTER|GROQ_API|GOOGLE_API|ANTHROPIC_API'`
affiche **0**. Le réseau sort — `https://openrouter.ai/api/v1/models` répond `200`,
`https://api.groq.com/openai/v1/models` répond `401`,
`https://generativelanguage.googleapis.com/v1beta/models` répond `403` — mais il n'y a rien à
présenter. **Rien n'a été simulé à la place, et aucune ligne de ce rapport ne porte un chiffre qui
n'a pas été mesuré.**

Ce que la fiche demande et qui manque donc encore :

| Demandé par la fiche | État | Ce qu'il faut pour l'obtenir |
| --- | --- | --- |
| deux passerelles `openai-compatible` **distinctes** | **non mesuré** | une clé par passerelle dans l'environnement, puis `pnpm eval:probe --provider=openai-compatible --merge=<rapport précédent>` |
| un modèle `ollama` local | **mesuré**, deux fois plutôt qu'une | — |
| l'adaptateur `anthropic` en **référence haute** | **non mesuré** | `NARRATOR_API_KEY` + `NARRATOR_MODEL`, puis `pnpm eval:probe --provider=anthropic --merge=…` |
| le plafond en **tours par jour** d'une offre gratuite | **non mesuré** | relancer jusqu'au refus (`rate_limited` / `quota_exhausted`) : le nombre d'appels passés **est** le nombre de tours par jour |

L'adaptateur `openai-compatible` **a** été exercé — contre le point `/v1` du serveur `ollama`
local, avec le même modèle que la ligne `ollama`. Ce n'est **pas** une passerelle gratuite
hébergée et ce rapport ne le présente jamais comme telle : c'est l'adaptateur qui est mesuré, pas
une offre. La clé donnée est un remplissage littéral sans secret, parce que `ollama` n'authentifie
rien ; elle n'existe que pour franchir le contrôle de variables de la sonde.

**Ce que l'exercice de l'adaptateur a quand même trouvé** — un défaut, voir § 8.2.


---

## 8. Le défaut signalé : `NARRATOR_TIMEOUT_MS`

Il y en a deux. Les deux appartiennent à `@for/ai` ; aucun n'est corrigé ici, et les deux sont
signalés plutôt que contournés.

### 8.1 `NARRATOR_TIMEOUT_MS` n'a aucun effet en production

M0-32 avait signalé que les adaptateurs ne posent pas de `dispatcher`. La lecture va plus loin :
**en production, l'appel au conteur n'a aucun délai, d'aucune sorte.**

| Ce qui a été lu | La commande | Ce qu'elle affiche |
| --- | --- | --- |
| personne ne **lit** `config.timeoutMs` | `grep -rn "timeoutMs" packages/ai/src packages/server/src \| grep -v '\.test\.'` | une seule ligne, `server/src/env.ts:190`, qui l'**écrit** |
| aucun adaptateur ne pose de délai de transport | `grep -rn "dispatcher\|headersTimeout\|bodyTimeout\|undici" packages/ai/src \| wc -l` | `0` |
| le chemin de production ne passe pas de signal | `packages/server/src/ai/turn.ts:201-210` | `buildNarrateRequest({…})` sans `abortSignal` |
| le constructeur n'en invente pas | `packages/ai/src/context/builder.ts:192` | `...(input.abortSignal === undefined ? {} : { abortSignal })` |

Donc : la variable est lue, validée, posée sur `NarratorConfig` — et **lue par personne**. Le seul
code du dépôt qui la transforme en `AbortSignal` est le harnais d'éval (`smoke/run-smoke.ts`, et
cette sonde-ci). Un conteur qui ne répond jamais bloque son travailleur sans limite.

**Et même avec un signal, le plafond réel est ailleurs.** Reproduit indépendamment ici, avec un
serveur qui retient ses en-têtes 310 s et un `AbortSignal` réglé à **900 s** :

```
ECHEC apres 301 s : fetch failed | cause = UND_ERR_HEADERS_TIMEOUT
```

`fetch` de Node porte un `headersTimeout` d'undici de **300 s**, qu'aucun `AbortSignal` ne déplace.
Un serveur local lent — qui n'envoie ses en-têtes qu'après avoir évalué le prompt — est donc
déclaré `unavailable` à 300 s quoi qu'on règle. C'est la mesure de M0-32 § 3, refaite et confirmée.

L'en-tête de `packages/ai/src/narrator/adapters/ollama.ts` promet toujours
« a cold start goes past sixty seconds WITHOUT BEING A FAILURE. Hence `NARRATOR_TIMEOUT_MS` ».
**Aucun test ne tient cette promesse, et le code ne la tient pas non plus.** Correctif à arbitrer
par le lead : un `dispatcher` dont `headersTimeout` et `bodyTimeout` valent `config.timeoutMs`,
passé aux trois adaptateurs réseau, plus un `AbortSignal` construit depuis `config.timeoutMs` dans
`server/src/ai/turn.ts`.

### 8.2 `openai-compatible` ne compte jamais les tokens d'entrée, en flux

Mesuré en lançant la sonde : la ligne `entrée` de l'adaptateur `openai-compatible` affiche
**« non compté »**, là où `ollama` rend 4 096.

La cause, vérifiée au `curl` sur le même serveur et le même modèle :

```bash
# sans stream_options : la dernière trame ne porte pas d'usage
… "choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

# avec stream_options.include_usage
… "usage":{"prompt_tokens":33,"prompt_tokens_details":{"cached_tokens":32},"completion_tokens":11}
```

Le format OpenAI **n'émet `usage` en streaming que si le client demande
`stream_options: { include_usage: true }`**, et `packages/ai/src/narrator/adapters/openai-compatible.ts`
ne l'envoie pas (`narrer()`, le corps de la requête). Le lecteur d'usage de l'adaptateur existe et
est correct — il n'est simplement jamais alimenté.

**Conséquence, et elle porte sur l'ADR 0011 :** la tolérance de 8 % du § 4.3, qui compare
l'estimateur local au compteur du fournisseur, n'a **rien contre quoi comparer** sur l'adaptateur
que toutes les passerelles gratuites utilisent. Et le décompte « combien de tours par jour » d'une
offre gratuite, qui est la question du porteur, se mesure avec ce compteur-là. Le correctif est
d'une ligne et appartient à `@for/ai`.

### 8.3 `openai-compatible` ne dit pas quelle fenêtre il lui faut — et il est seize fois plus lent

Mesuré dans la même exécution, machine au repos, **même serveur, même modèle, mêmes octets de
requête** :

| | latence médiane | créneau servi (`n_ctx_slot`, journal du serveur) |
| --- | ---: | ---: |
| adaptateur `ollama` | **9 s** | **8 192** |
| adaptateur `openai-compatible` → `/v1` du même serveur | **148 s** | **4 096** |

La cause de la colonne de droite est lisible dans le code : `adapters/ollama.ts` envoie
`options: { num_predict, num_ctx: window }` ; `adapters/openai-compatible.ts` envoie `max_tokens`
et **rien sur la fenêtre**. Le serveur retombe donc sur sa valeur par défaut. `docker logs`
le confirme, 29 créneaux à 8 192 et 30 à 4 096 selon le chemin emprunté.

**Ce que ça n'explique pas, et qu'il faut dire.** La réponse n'a été coupée par le fournisseur
**0 fois sur 12** (§ 5) et le prompt n'a jamais été tronqué (`truncated = 0` au journal) : le
créneau plus étroit n'a rien amputé sur ce corpus. La latence, elle, reste inexpliquée à ce
stade ; la seule piste mesurée est `prompt_tokens_details.cached_tokens` = **3** sur `/v1`, c'est
à dire un préfixe recalculé à chaque appel. **Cause non établie, mesure publiée.**

Ce qui compte pour la décision : **c'est l'adaptateur par lequel passent toutes les passerelles
gratuites**, et c'est le seul des trois à ne transmettre ni fenêtre, ni demande de compteur
(§ 8.2). Les deux correctifs appartiennent à `@for/ai`.



---

## 9. La recommandation

Elle est écrite pour quelqu'un qui doit décider. Les chiffres sont au § 4 et au § 6.

### 9.1 Le défaut du dépôt reste `stub` — et ce n'est pas un aveu d'échec

`NARRATOR_PROVIDER=stub` est le défaut d'un **dépôt**, pas d'une table. Il ouvre zéro socket,
n'a besoin d'aucune clé, d'aucun conteneur et d'aucun modèle de 2 Gio ; c'est lui qui fait que
`pnpm verify`, la CI, le simulateur et l'éval hors ligne tournent sur un poste neuf. Le basculer
sur `ollama` ferait dépendre les portes du dépôt d'un serveur qui tourne. **Rien dans cette mesure
ne justifie de changer ça.**

### 9.2 Pour une vraie table : `ollama` + `qwen2.5:3b-instruct`, et pourquoi

| Pourquoi lui | La mesure |
| --- | --- |
| il répond | **12/12** appels, zéro échec, sur les trois exécutions |
| il est jouable | **9 s** par tour, ≈ 400 tours/heure : une séance de soixante tours coûte **9 minutes** de calcul |
| il ne coûte rien et n'a **pas de plafond par jour** | c'est exactement la contrainte de l'ADR 0011 et la phrase du porteur |
| il n'a **jamais** nommé un champion réservé | 24 échantillons, deux exécutions, `no_reserved_champion` à 100 % — la règle que le § 8.6 journalise toujours en alerte |
| sa fenêtre est connue et transmise | l'adaptateur `ollama` envoie `num_ctx` ; le budget du § 4.3 porte sur une fenêtre réelle (§ 8.3) |

**Les assertions qui tombent le plus souvent, par candidat** — la liste que la fiche demande :

| Candidat | Dans l'ordre de ce qui tombe |
| --- | --- |
| `ollama` · `qwen2.5:3b-instruct` | `no_rules_lexicon` (42 %), `sentence_count` (33 %), `price_respected` (50 %, 1 cas sur 2), `no_outcome_decision` (92 %) |
| `ollama` · `llama3.2:3b-instruct` | `banned_style_lexicon` (83 %), `no_rules_lexicon` (83 %), **`no_reserved_champion` (92 %)**, `no_pc_agency` (92 %), `sentence_count` (92 %) |
| `openai-compatible` · `qwen2.5:3b-instruct` | `sentence_count` (58 %), `no_rules_lexicon` (67 %), `price_respected` (50 %), `no_outcome_decision` (92 %), `no_pc_agency` (92 %) |

Les deux premières de chaque ligne se relancent : le post-filtre renvoie un bloc `<corrections>`
citant la règle et l'extrait, et la relance corrige « dans la quasi totalité des cas » (§ 8.4).
La troisième de `llama3.2` ne se relance pas de la même façon : elle se journalise en alerte,
**toujours**, même rattrapée.

**Contre `llama3.2:3b-instruct`, qui tient mieux la forme** — `sentence_count` 92 % contre 33 %,
`no_rules_lexicon` 83 % contre 42 % — **mais qui a écrit « L'Archère de Givre »**, alias d'un
champion réservé, sur le cas où le joueur l'avait nommé dans son intention. Un `sentence_count`
raté est une relance avec `<corrections>` ; un champion réservé nommé est la serrure de
distribution qui s'ouvre. Ce n'est pas le même prix, et il est trois fois plus lent.

**Si la décision privilégie la forme sur la serrure**, `llama3.2:3b` est le meilleur candidat et
`no_reserved_champion` est tenu en second rideau par le post-filtre de production, qui relance une
fois avant de replier (§ 8.6). C'est un arbitrage, et il est écrit ici pour qu'il soit pris, pas
deviné.

### 9.3 Le repli : la narration du moteur, pas un second fournisseur

**Aucun second fournisseur n'est recommandé, parce qu'aucun second fournisseur n'a été mesuré.**
Désigner une passerelle gratuite en repli reviendrait à écrire une croyance dans un fichier de
configuration, ce que cette tâche existe pour ne pas faire. Le repli est donc celui que le socle
porte déjà : `fallbackNarration` du moteur, par le chemin
`narration.gm_failed { errorKind: 'rejected_by_postfilter' }` du § 7.5. Il ne dépend de personne,
il est déterministe, et la partie avance sans lui.

Le jour où une clé existe : `pnpm eval:probe --provider=openai-compatible --merge=<ce rapport>`,
et la ligne s'ajoute au même tableau, sur le même corpus.

### 9.4 Ce que la mesure demande d'arbitrer, et qui ne m'appartient pas

| | Ce qui est mesuré | L'arbitrage |
| --- | --- | --- |
| `<scene_apres>` | **0 bloc sur 84 échantillons** ; les mêmes modèles **appellent un outil** du premier coup | faire du bloc de scène **un outil** plutôt qu'un balisage. L'ADR 0011 a retiré une table de **2 112** tokens ; un outil unique en pèse quelques dizaines. Ce n'est pas rouvrir l'invariant 1 : `propose_*` reste validé par le serveur, et S5 ignore déjà ce qu'il refuse |
| l'estimateur | 3,30 et 3,27 caractères par token réel contre **3,6** annoncés | passer `CHARS_PER_TOKEN` à **3,3** (§ 6.1) — plus prudent, et dans le sens du budget |
| `NARRATOR_TIMEOUT_MS` | **lu par personne** en production (§ 8.1) | un `dispatcher` dans les trois adaptateurs, et un `AbortSignal` dans `turn.ts` |
| `openai-compatible` | aucun compteur d'entrée, aucune fenêtre transmise (§ 8.2, § 8.3) | deux corrections d'une ligne chacune, dans `@for/ai` |

### 9.5 Ce que ce rapport **ne** dit pas

- Il ne dit pas qu'une offre gratuite **hébergée** tient la table : aucune n'a été mesurée (§ 7).
- Il ne classe pas deux modèles sur douze échantillons : la variance entre deux passages du même
  modèle dépasse l'écart entre deux modèles (§ 4.1).
- Il ne dit rien de la **qualité** de la prose. Les seize règles disent ce qu'elle ne doit pas
  être ; elles ne disent pas qu'elle est bonne. C'est le juge N2, et c'est le jalon M1.


---

## 10. Deux critères de la fiche, et ce qu'ils valent vraiment

Signalés plutôt que maquillés.

**« Un identifiant absent de `Object.keys(ASSERTIONS)` fait sortir la sonde en 1 ».** Le contrôle
existe, il est câblé dans `main` avant le premier appel, et **il ne peut pas échouer avec la table
de production** : `HARD_ASSERTIONS` et `ASSERTIONS` sont construits depuis le même tableau de
`@for/ai`, l'inclusion est donc vraie par construction. Ce qui lui donne des dents n'est pas le
contrôle, c'est la paire que voici :

| Ce qui garde quoi | Comment on le vérifie |
| --- | --- |
| aucune règle n'est **déclarée** dans `probe/` | `grep -rnE "^\s*(export )?(const\|function) [A-Za-z_]*[Aa]ssert" packages/ai-eval/probe \| wc -l` affiche `0` — et `1` dès qu'on y pose une déclaration |
| aucune règle **étrangère** ne peut être notée | `ProbeCliDeps.rules` : `run-probe.test.ts` « un identifiant absent de @for/ai fait sortir en 1 » passe une règle inventée à `main` et exige le **1** |

**« `n = 2` échantillons par cas ».** Deux échantillons suffisent à voir un défaut systématique —
le bloc de scène absent 12 fois sur 12 — et **ne suffisent pas à classer deux fournisseurs**
(§ 4.1, mesuré). La fiche n'a pas tort, elle dimensionne pour la première question ; ce rapport
écrit ce que le chiffre ne permet pas de conclure.
