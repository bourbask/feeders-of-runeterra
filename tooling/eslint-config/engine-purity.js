// @for/engine est pur : aucune entrée-sortie, aucune horloge, aucun hasard ambiant.
// Son tsconfig lui retire déjà tout typage Node — ces règles attrapent le reste,
// et surtout donnent un message qui explique pourquoi.
const MOTIF =
  "@for/engine est pur : pas d'entrée-sortie, pas d'horloge, pas de hasard ambiant. " +
  'Ce dont tu as besoin arrive par un paramètre.';

export default [
  {
    files: ['packages/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: MOTIF },
            {
              group: ['fs', 'path', 'crypto', 'os', 'http', 'https', 'child_process'],
              message: MOTIF,
            },
            { group: ['@for/db', '@for/server', '@for/ai', '@for/content'], message: MOTIF },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: MOTIF },
        { name: 'window', message: MOTIF },
        { name: 'document', message: MOTIF },
        { name: 'fetch', message: MOTIF },
        { name: 'globalThis', message: MOTIF },
        { name: 'performance', message: MOTIF },
        { name: 'crypto', message: MOTIF },
        { name: 'setTimeout', message: MOTIF },
        { name: 'setInterval', message: MOTIF },
      ],
    },
  },
];
