import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

/** Interdit l'horloge et le hasard ambiants : ils sont injectés (invariant 4, rejouabilité). */
export const noAmbientNondeterminism = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date']",
      message: "L'horloge est injectée : prends-la dans le contexte, pas dans new Date().",
    },
    {
      selector: "MemberExpression[object.name='Math'][property.name='random']",
      message: 'Le hasard est injecté : utilise le générateur du contexte, pas Math.random().',
    },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/*.golden.json'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: process.cwd() },
    },
    plugins: { 'import-x': importX, unicorn },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      'import-x/no-cycle': 'error',
      'import-x/no-default-export': 'error',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/no-array-push-push': 'error',
      'unicorn/prefer-string-slice': 'error',
    },
  },

  // Les points d'entrée de configuration et les composants React ont besoin de l'export par défaut.
  {
    files: ['**/*.tsx', '**/*.config.*', '**/eslint.config.js', '**/vitest.workspace.ts'],
    rules: { 'import-x/no-default-export': 'off' },
  },

  // Frontières publiques explicitement typées là où d'autres paquets s'appuient dessus.
  {
    files: ['packages/engine/**/*.ts', 'packages/contracts/**/*.ts'],
    rules: { '@typescript-eslint/explicit-module-boundary-types': 'error' },
  },

  // Rien n'écrit sur la sortie standard hors serveur et outillage.
  {
    files: [
      'packages/engine/**/*.ts',
      'packages/contracts/**/*.ts',
      'packages/content/**/*.ts',
      'packages/client/**/*.{ts,tsx}',
    ],
    rules: { 'no-console': 'error' },
  },

  {
    files: ['packages/engine/**/*.ts', 'packages/server/src/game/**/*.ts'],
    rules: noAmbientNondeterminism,
  },

  // Les tests sont hors du tsconfig de build (il n'émet que src/), donc le service
  // de projet ne les voit pas. On les rattache au tsconfig de test du paquet.
  // Le chemin est relatif : `eslint .` s'exécute depuis le répertoire du paquet.
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: process.cwd(),
      },
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/testkit/**/*.ts'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  // Les fichiers de configuration ne sont dans aucun programme TypeScript et
  // n'ont rien à gagner à un lint typé : on les vérifie sans types.
  {
    files: ['**/*.config.ts', '**/*.config.mts', '**/vitest.workspace.ts'],
    ...tseslint.configs.disableTypeChecked,
  },

  { files: ['**/*.js', '**/*.cjs', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },

  prettier,
);
