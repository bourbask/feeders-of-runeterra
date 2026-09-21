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
      from: { path: '^packages/contracts/src' },
      to: {
        pathNot: '^(packages/contracts/src|node_modules/zod)',
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
      name: 'pas-de-dependance-orpheline',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(dist|coverage|\\.test\\.ts$)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
