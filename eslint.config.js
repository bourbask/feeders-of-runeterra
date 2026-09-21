import base from '@for/eslint-config';
import enginePurity from '@for/eslint-config/engine-purity';
import react from '@for/eslint-config/react';

// Les scripts de la racine et les paquets d'outillage étaient hors de toute
// vérification : le script qui garde la cohérence de l'espace de travail
// n'était lui-même gardé par rien. Ces deux blocs les font entrer.
const outillage = [
  {
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.tools.json'],
        tsconfigRootDir: process.cwd(),
      },
    },
  },
  {
    files: ['tooling/**/*.js', 'scripts/**/*.mjs', 'tools/**/*.mjs', '*.js'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', fetch: 'readonly' },
    },
    rules: {
      // Une configuration s'exporte par défaut : c'est ce que les outils attendent.
      'import-x/no-default-export': 'off',
    },
  },
];

export default [...base, ...enginePurity, ...react, ...outillage];
