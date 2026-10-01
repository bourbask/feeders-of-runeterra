# ADR 0011 — Le budget d'un tour, tenu par ce qui est gratuit

Statut : **acté** · Date : 25 septembre 2026 · Décideurs : le porteur du projet (la contrainte), le tech lead (les chiffres)
Concerne M0-22, qui fige le total, et M0-18 dont les deux blocs fixes sont mesurés ici.

## La contrainte, dans les mots du décideur

> *« je compte pas payer pour des tokens pour ce jeu. Ça sera forcément via des tokens gratuits.
> […] un système qui réduit au maximum la réflexion et la complexité nécessaire pour le LLM. »*

Ça déplace le problème. Le coût n'est plus la variable : c'est le **plafond quotidien** des offres
gratuites, et le bloc fixe est multiplié par chaque tour.

## Ce qui était annoncé, ce qui est mesuré

Les deux plafonds du §4.3 étaient marqués « figé, mesuré en CI ». **Rien ne les mesurait** — c'est
M0-18 qui l'a découvert en écrivant le test, et qui a livré les deux références commitées.

| Bloc | Plafond §4.3 | Mesuré | Écart |
|---|---:|---:|---:|
| table d'outils | 900 | **2 112** | +1 212 |
| prompt conteur | 2 400 | **4 279** | +1 879 |
| `<fait>` · `<intention>` · `<scene>` | 1 900 | 1 900 | — |
| **fixe, à chaque tour** | 5 200 | **8 291** | **+3 091** |

## Ce que ça donne en tours par jour

| Offre gratuite | Plafond | à 14 000/tour | à 7 000/tour |
|---|---|---:|---:|
| Groq, 131 K de fenêtre | 200 K tokens/jour | **14** | 28 |
| OpenRouter, jusqu'à 1 M | 50 requêtes/jour | 50 | 50 |

Une séance fait **60 tours**. Le premier ne tient pas une soirée.

## Décision

| | Avant | Après |
|---|---:|---:|
| table d'outils | 2 112 | **0** — un mode *prose seule* |
| prompt conteur | 4 279 | **2 400**, sa cible annoncée |
| fixe par tour | 8 291 | **4 100** |
| cible par tour | 14 000 | **7 000** |

**Le mode prose seule n'est pas qu'une économie.** L'appel d'outils est ce que les petits modèles
ratent le plus souvent — M0-18 a dû déclarer `tools: false` par défaut faute de sonde. Le moteur
décide déjà tout ; le conteur habille un fait acquis. Lui retirer les outils, c'est retirer la
seule décision qu'on lui laissait encore, et c'est exactement ce que le décideur demande.

Conséquence mécanique : `min(14 000, fenêtre × 0,6)` devient `min(7 000, fenêtre × 0,6)`. Un modèle
local à 8 192 donne 4 915, et les quatre blocs intouchables tiennent désormais dedans — ce qui
était faux avec 8 291 de fixe.

## Ce qui ne change pas

L'échelle de troncature T1→T8, les quatre blocs intouchables, et la règle que le compteur du
fournisseur n'est jamais appelé par tour. Seuls les plafonds bougent.

## Ce qu'on saura bientôt, et par qui

**M0-32** est la sonde de fumée : *un fournisseur gratuit tient-il le prompt contraint ?* Elle ne
dépend que de M0-18. Si la réponse est non, c'est ce budget qu'il faudra revoir — pas la suite.
