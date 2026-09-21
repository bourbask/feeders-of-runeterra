// @for/engine est pur : aucune entrée-sortie, aucune horloge, aucun hasard ambiant.
// Son tsconfig lui retire déjà tout typage Node — ces règles attrapent le reste,
// et surtout donnent un message qui explique pourquoi.
const MOTIF =
  "@for/engine est pur : pas d'entrée-sortie, pas d'horloge, pas de hasard ambiant. " +
  'Ce dont tu as besoin arrive par un paramètre.';

export default [
  {
    // Le code du moteur seulement : ses tests et ses fichiers de configuration
    // ont le droit d'importer vitest.
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      // Le moteur déclare zéro dépendance : tout import de paquet y est donc
      // étranger par construction. C'est plus sûr qu'une liste de modules
      // interdits, qui laisserait entrer le prochain paquet qu'on oubliera d'y
      // inscrire — et ça ne gêne pas les imports relatifs, que la règle ignore.
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: false,
          optionalDependencies: false,
          peerDependencies: false,
          includeInternal: true,
          includeTypes: true,
        },
      ],
      // Les modules natifs, eux, ne sont pas des dépendances : il faut les nommer.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: MOTIF },
            // Sans préfixe, un module natif n'est pas non plus une dépendance : sans
            // ce groupe le lint échouait quand même, mais sur « préfère node:fs », et
            // le message qui explique POURQUOI le moteur les refuse disparaissait.
            {
              group: [
                'fs',
                'path',
                'crypto',
                'os',
                'http',
                'https',
                'child_process',
                'stream',
                'buffer',
                'util',
                'events',
                'url',
                'worker_threads',
              ],
              message: MOTIF,
            },
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
