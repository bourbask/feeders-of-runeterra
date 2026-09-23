# ADR 0005 — `tsc -b` construit `@for/engine`, et `tsup.config.ts` n'est pas livré

Statut : **acté** · Date : 21 septembre 2026 · Décideur : tech lead
Proposé par le développeur de M0-02, vérifié par son testeur, accepté tel quel.

`01-architecture.md` §2.2 range `tsup` parmi les constructeurs de bibliothèque, et la fiche
M0-02 liste `packages/engine/tsup.config.ts` dans ses livrables. Le fichier n'est pas livré.

**Motif.** M0-01 construit `@for/engine` avec `tsc -b` et l'a inscrit au `tsconfig` racine
comme projet composite référencé (ADR 0002 §5). `tsup` et `tsc -b` visent tous deux `dist/` :
les faire cohabiter, c'est deux écrivains sur le même répertoire, et `tsup` n'émet pas de
`.tsbuildinfo` composite — le graphe de références se casserait. `tsup` n'est d'ailleurs
installé nulle part dans l'espace de travail : le fichier serait **inerte**, et la leçon de
M0-01 interdit de livrer une configuration que rien n'exécute.

`__DEV__`, seule raison que §1.3 invoque pour `tsup`, ne sert qu'au `Object.freeze` de
`reduce()`, livré bien plus tard.

**Conséquence.** Si l'on veut `tsup` un jour, c'est une migration des dix paquets d'un seul
tenant, pas d'un paquet isolé : le graphe de références composite ne survit pas à un
traitement partiel.
