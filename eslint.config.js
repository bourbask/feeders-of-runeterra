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

export default [...base, ...enginePurity, ...react, ...outillage, ...appointDeTest];
