import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@for/scenario',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // Cent, et c'est tenable : le paquet est pur, sans E/S et sans horloge — il n'y a
      // aucune branche qu'un test ne puisse atteindre. Un seuil plus bas laisserait
      // entrer la ligne qu'on ne mesure pas.
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
