// Le client affiche et envoie des intentions. Il ne décide rien : l'invariant 3
// veut que toute mutation d'état de jeu vienne du serveur.
const DECISION = ['decide', 'reduce', 'reduceAll', 'rollChallenge', 'rollProgress'];

export default [
  {
    files: ['packages/client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@for/engine',
              importNames: DECISION,
              message:
                'Le client ne décide pas : il envoie une intention et affiche ce que le serveur renvoie (invariant 3). Les lectures pures de @for/engine restent permises.',
            },
          ],
        },
      ],
    },
  },
];
