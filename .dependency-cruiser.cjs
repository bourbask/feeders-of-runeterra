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
      from: { path: '^packages/engine/src' },
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
      from: { path: '^packages/contracts/src' },
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
      to: { path: '^packages/(db|ai|ai-eval|server|content)/' },
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
    exclude: { path: '(coverage|\\.test\\.ts$)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
