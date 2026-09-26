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

// Les fichiers d'appoint des tests — mise en place vitest, fabriques partagées —
// vivent dans `tests/` sans porter `.test.ts`. Le tsconfig de build n'émet que
// `src/`, donc le service de projet ne les voit pas et le lint échouait sur une
// erreur d'analyse, pas sur une règle. Ils se rattachent au tsconfig de test du
// paquet, exactement comme les tests eux-mêmes.
const appointDeTest = [
  {
    files: ['packages/*/tests/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: process.cwd(),
      },
    },
  },
];

// @for/scenario est pur, comme le moteur : pas d'entree-sortie, pas d'horloge, pas
// de hasard ambiant. Son tsconfig lui retire deja tout typage Node — un
// `import { x } from 'node:fs'` est une TS2307 — mais l'import a effet de bord nu,
// `import 'node:fs';`, compile sans broncher. C'est cette regle-la qui l'attrape.
const pureteDuScenario = [
  {
    files: ['packages/scenario/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'crypto', 'os', 'http', 'https', 'child_process'],
              message:
                '@for/scenario est pur : ni reseau, ni disque, ni base. Le registre de contenu, ' +
                'le port de decision et la graine arrivent par un parametre.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: '@for/scenario est pur.' },
        { name: 'fetch', message: '@for/scenario est pur.' },
        { name: 'crypto', message: '@for/scenario est pur.' },
        { name: 'setTimeout', message: '@for/scenario est pur.' },
      ],
    },
  },
];

export default [
  ...base,
  ...enginePurity,
  ...pureteDuScenario,
  ...react,
  ...outillage,
  ...appointDeTest,
];
