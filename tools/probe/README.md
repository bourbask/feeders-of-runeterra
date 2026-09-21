# Sonde jetable — un modèle gratuit tient-il le prompt contraint ?

Elle répond à une seule question, avant que la vague 7 ne livre la vraie sonde
(`pnpm eval:smoke`, tâche M0-32) : **est-ce qu'un fournisseur donné produit une
narration conforme, oui ou non.**

Aucune dépendance, aucun lien avec le monorepo. Elle sera supprimée quand M0-32
sera livrée.

```bash
export NARRATOR_BASE_URL=https://openrouter.ai/api/v1
export NARRATOR_API_KEY=sk-...
node tools/probe/narrator-probe.mjs --model <identifiant du modèle> [--n 5]
```

Le prompt utilisé est celui du prototype joué, extrait tel quel. Quand M0-18
livrera le prompt de production, pointe la sonde dessus avec `--prompt <fichier>`.

Sept assertions, les mêmes que celles retenues pour M0-32 : longueur, deuxième
personne du singulier, aucune décision d'issue, aucun champion verrouillé,
aucune question finale, bloc de faits présent, bloc de faits bien formé.
