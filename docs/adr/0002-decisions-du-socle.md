# ADR 0002 — Décisions prises pendant la construction du socle

Statut : **acté** · Date : 21 septembre 2026 · Décideur : tech lead

Six points sur lesquels la réalité de M0-01 s'écarte de ce que `01-architecture.md`
prévoyait. Chacun est consigné ici plutôt que par une correction silencieuse de la
spécification — c'est la règle 5 du découpage.

---

## 1. Les cycles sont l'affaire de `dependency-cruiser`, pas d'ESLint

`01-architecture.md` §4.2 range `import-x/no-cycle` parmi les règles non négociables.
**Elle est retirée de la configuration.**

Mesuré : la règle ne rapporte aucun cycle sur du TypeScript, quelle que soit la
résolution. Le même cycle écrit en `.mjs` sort bien deux erreurs. Quatre formes d'import
ont été essayées (`./b.js`, `./b`, `./b.ts`, à deux puis trois fichiers) ; `--print-config`
confirme que la règle était bien active et le résolveur bien appliqué.

L'invariant « aucun cycle » tient : `dependency-cruiser` l'attrape, règle `pas-de-cycle`,
vérifiée en la violant. Ce qui ne tenait pas, c'est ce que la configuration ESLint
**prétendait** garantir. Une règle déclarée et morte est pire qu'une règle absente : elle
annonce aux tâches suivantes une protection qui n'existe pas.

Le résolveur TypeScript reste, car `import-x/no-extraneous-dependencies` en dépend — c'est
lui qui tient la pureté du moteur. Son glob de projets est passé en chemin absolu : relatif,
il s'évaluait à vide sous `turbo run lint`, qui lance `eslint` depuis chaque paquet.

## 2. Les seuils de couverture ne peuvent pas vivre dans `vitest.workspace.ts`

La fiche M0-01 demande le seuil global de 70 % « dans `vitest.workspace.ts` ». C'est
impossible : `defineWorkspace()` prend un tableau de configurations de projet et n'offre
aucun emplacement pour une option de racine, et Vitest n'évalue les seuils qu'au niveau
racine.

Le seuil global vit donc dans **`vitest.config.ts`** à la racine, avec
`include: ['packages/*/src/**/*.ts']` — sans cette restriction, le rapport racine ratisse
l'outillage, les scripts et les artefacts HTML de couverture, et le seuil devient ingérable.
Les seuils par paquet restent dans les `vitest.config.ts` de paquet, où ils ne s'appliquent
qu'aux passes lancées depuis le paquet.

## 3. Une commande contractuelle de plus : `pnpm test:coverage`

Conséquence directe du point 2, et **prérequis du job 6 de la CI** (M0-03).

`pnpm test` vaut `turbo run test`, qui lance `vitest run` dans chaque paquet : ce chemin
n'évalue jamais le seuil global. Aucune commande de la liste §2.2 ne l'évaluait, ce qui
rendait le job 6 infaisable tel qu'écrit. `pnpm test:coverage` (`vitest run --coverage` à la
racine) est le seul chemin qui l'évalue, et `scripts/check-workspace.ts` la traite désormais
comme contractuelle.

**Pour M0-03 :** le job de couverture doit appeler `pnpm test:coverage`, pas `pnpm test`.

## 4. pnpm 12, et non pnpm 10

`01-architecture.md` §1.1 mentionne pnpm 10. La machine de développement tourne en 12.4.2 ;
la version est épinglée par `packageManager`.

Le changement qui compte est que **pnpm 12 nomme `allowBuilds`** l'autorisation des scripts
d'installation, une table paquet → booléen dans `pnpm-workspace.yaml`. L'ancien
`onlyBuiltDependencies` est **ignoré en silence** et l'installation échoue sur
`ERR_PNPM_IGNORED_BUILDS` sans expliquer pourquoi. Le piège est documenté dans `CLAUDE.md` :
`better-sqlite3` retombera dedans en M0-11.

## 5. Le `tsconfig` racine référence bien les dix paquets

Un premier jet en excluait le client, au motif qu'un projet référencé ne peut pas désactiver
l'émission. **C'est faux depuis TypeScript 5.9** : la dixième référence fonctionne, `tsc -b`
typecheque le client, et `pnpm typecheck` s'en trouve simplifié. Consigné parce que la
justification erronée avait été écrite dans un message de commit.

## 6. Deux fichiers hors des « Fichiers touchés » de M0-01, actés

- `scripts/pas-encore.mjs` — dix-neuf commandes de la liste contractuelle n'ont pas encore
  de cible. Plutôt que d'échouer sans explication, elles annoncent la tâche qui les
  remplira.
- `tools/probe/narrator-probe.mjs` — reformaté par la première passe de Prettier. C'est du
  code : Prettier le possède, et `format:check` le tiendra.

Et la règle qui en découle, posée par `.prettierignore` : **Prettier possède le code, pas la
prose normative.** Une passe de `prettier --write .` avait réécrit les sept documents de
conception, et soudé un élément de liste numérotée au paragraphe précédent dans un passage
qui fait autorité. `docs/` est désormais hors de sa portée.

---

## Reste ouvert, pour le lead

**La contradiction sur `@for/testkit`.** §1.1 l'autorise en dépendance d'exécution de
`@for/ai-eval` ; §1.2 règle 6 ne l'autorise que pour `@for/sim`. La spécification se
contredit, aucune règle `dependency-cruiser` ne couvre cette arête, et le choix n'appartient
pas à un agent. À trancher avant que `@for/ai-eval` ait du contenu.

**Le diagnostic de `dependency-cruiser` avant le premier build.** Une violation d'arête par
import de spécificateur nu est rapportée comme « dépendance orpheline » tant que les `dist/`
n'existent pas, parce que les paquets de l'espace de travail se résolvent à travers eux. Le
garde-fou tient — l'exécution échoue —, c'est le message qui trompe. §8 lance le job `deps`
avant le job `build` : à faire savoir à M0-03, soit en ordonnant les jobs, soit en assumant
le message.
