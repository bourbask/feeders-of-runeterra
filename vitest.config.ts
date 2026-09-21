import { defineConfig } from 'vitest/config';

// Les options de racine — la couverture en particulier — vivent ici ; la liste des
// projets vit dans vitest.workspace.ts. Vitest ne lit les seuils de couverture qu'au
// niveau racine : ceux des vitest.config.ts de paquet ne s'appliquent qu'aux passes
// lancées depuis le paquet.
//
// Le périmètre mesuré est restreint au code des paquets. Sans cette restriction, le
// rapport racine ratisse l'outillage, les scripts et les artefacts HTML de couverture,
// et un seuil global devient ingérable.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'packages/*/src/index.ts'],
      thresholds: { lines: 70, branches: 70, functions: 70, statements: 70 },
    },
  },
});
