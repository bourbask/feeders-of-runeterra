// Le graphe de dépendances de docs/design/01-architecture.md §1.2, rendu exécutable.
// Une frontière de paquet qui n'est pas vérifiée par une commande n'est pas une frontière.
module.exports = {
  forbidden: [
    {
      name: 'pas-de-cycle',
      severity: 'error',
      comment: 'Un cycle entre modules rend le graphe des paquets faux.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'engine-est-pur',
      severity: 'error',
      comment:
        '@for/engine est la couche 0 : aucune dépendance, aucun module de plateforme. ' +
        'Sa pureté est ce qui rend le moteur testable et rejouable.',
      // LES FICHIERS DE TEST SONT HORS DE CETTE RÈGLE, ET SEULEMENT DE
      // CELLE-CI. Depuis que `exclude` ne masque plus les tests (voir
      // `options.exclude`), `engine/src/**/*.test.ts` déclare ses arêtes :
      // `vitest` et `@for/testkit`, qui portent les RNG scriptés. Aucune ne
      // part dans le `dist/` — et la pureté qui compte est celle du `dist/`,
      // lue par `packages/engine/src/index.test.ts`, qui scanne le paquet
      // compilé et son propre `package.json`. Interdire ici ferait rougir une
      // dépendance de test que la fiche de M0-02 exige.
      from: { path: '^packages/engine/src', pathNot: '\\.test\\.tsx?$' },
      to: {
        pathNot: '^packages/engine/src',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'contracts-ne-depend-que-de-zod',
      severity: 'error',
      comment:
        '@for/contracts valide les bords du système. Il ne connaît que zod à l’exécution ; ' +
        'les types canoniques du moteur lui arrivent en `import type`, ce qui ne crée aucune ' +
        'arête d’exécution `contracts -> engine` et préserve la pureté du moteur. ' +
        'Conséquence à connaître AVANT d’écrire un schéma : les tuples `as const` du moteur ' +
        '(ATTRIBUTES, RNG_STREAMS, EFFECT_OPS…) sont des VALEURS et ne peuvent pas être ' +
        'importés ici. Ils sont recopiés dans src/core/enums.ts, gardés dans les deux sens.',
      // Même raison que pour `engine-est-pur` : depuis que `exclude` ne masque
      // plus les tests, `contracts/src/**/*.test.ts` déclare son import de
      // `vitest`. Ce que la règle garde, c'est ce que le paquet EXPORTE.
      from: { path: '^packages/contracts/src', pathNot: '\\.test\\.tsx?$' },
      // `node_modules/zod` sans ancre : pnpm résout zod sous
      // `node_modules/.pnpm/zod@<version>/node_modules/zod/`, et la version
      // ancrée de cette expression ne matchait donc AUCUNE arête réelle. La
      // règle refusait les 26 imports légitimes de zod le jour où le premier
      // schéma est arrivé — elle n'avait jamais été mesurée avant, faute de
      // paquet qui importe zod.
      to: {
        pathNot: '(^packages/contracts/src|node_modules/zod/)',
        dependencyTypesNot: ['type-only', 'core'],
      },
    },
    {
      name: 'ai-eval-ne-porte-pas-d-assertion',
      severity: 'error',
      comment:
        "Les assertions vivent dans @for/ai (partagées entre l'eval et le post-filtre de " +
        'production). @for/ai-eval les consomme, il ne les héberge pas.',
      from: { path: '^packages/ai-eval/src' },
      to: { path: '^packages/ai-eval/src/assertions' },
    },
    {
      name: 'content-ne-connait-pas-la-plateforme',
      severity: 'error',
      comment: "@for/content sert des données de jeu. Il ignore la base, l'IA et le serveur.",
      from: { path: '^packages/content/src' },
      to: { path: '^packages/(db|ai|server)/' },
    },
    {
      name: 'ai-ne-touche-jamais-la-base',
      severity: 'error',
      comment:
        "C'est cette arête qui rend l'eval IA exécutable hors base. @for/ai assemble du " +
        "contexte et parse des sorties ; il ne persiste rien et n'ordonnance rien.",
      from: { path: '^packages/ai/src' },
      to: { path: '^packages/(db|server)/' },
    },
    {
      name: 'client-ne-voit-que-les-contrats-et-le-moteur',
      severity: 'error',
      comment:
        "Le client affiche et envoie des intentions (invariant 3). La base, l'IA, le " +
        'serveur et le contenu ne franchissent pas le navigateur.',
      from: { path: '^packages/client/src' },
      // DEUX FORMES DANS LA MÊME EXPRESSION, et la seconde est la correction de
      // M0-30. `to.path` porte le chemin RÉSOLU ; or aucun des cinq paquets
      // interdits n'est une dépendance de `@for/client`, donc aucun ne se
      // résout, donc `to.path` valait le spécificateur brut `@for/server` et
      // cette règle ne pouvait pas matcher. Mesuré avant correction :
      // `import '@for/server'` en tête de `packages/client/src/routes/Login.tsx`
      // sortait bien en 1 — mais sous `pas-de-dependance-orpheline`, et
      // `grep -c "client-ne-voit-que"` sur la sortie affichait 0. La frontière
      // tenait ; la règle qui prétend la tenir, non. Elle mord désormais sous
      // SON nom, que le paquet soit résolu (`^packages/<nom>/`) ou pas
      // (`^@for/<nom>$`).
      to: {
        path: '(^packages/(db|ai|ai-eval|server|content)/|^@for/(db|ai|ai-eval|server|content)$)',
      },
    },
    {
      name: 'scenario-ne-touche-ni-la-base-ni-le-serveur',
      severity: 'error',
      comment:
        '@for/scenario assemble un scenario a partir du contenu : il ne persiste rien, ' +
        "n'ordonnance rien et n'ouvre aucune socket. C'est cette arete absente qui rend la " +
        'construction rejouable hors serveur, et testable sans base. S-04, ADR 0012.',
      from: { path: '^packages/scenario/src' },
      to: { path: '^packages/(db|server|ai|ai-eval|sim|client)/' },
    },
    {
      name: 'pas-de-dependance-orpheline',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Ne PAS exclure `dist` ici : les paquets de l'espace de travail se résolvent
    // à travers leur `dist/`, et les exclure faisait disparaître toutes les arêtes
    // entre paquets — les règles de frontière devenaient silencieusement inertes.
    // LES FICHIERS DE TEST NE SONT PLUS EXCLUS, et c'est la correction stricte
    // que M0-30 a mesurée. L'expression d'avant, `(coverage|\.test\.ts$)`,
    // ne voyait PAS les `.tsx` : `import '@for/db'` en tête de
    // `packages/client/src/features/table/Journal.test.tsx` sortait en 1, le
    // même import en tête de `packages/client/src/ws/journal.test.ts` sortait
    // en 0. Deux extensions, deux verdicts, pour une seule règle. Aligner dans
    // le sens LÂCHE aurait éteint la moitié qui mordait ; aligner dans le sens
    // strict fait sortir les deux en 1. Un import licite depuis un fichier de
    // test reste en 0 — c'est ce que la mesure du compte rendu montre.
    exclude: { path: '(coverage)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
