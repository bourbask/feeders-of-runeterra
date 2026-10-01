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
      // LES `.tsx` SONT DEDANS, ET CE N'ÉTAIT PAS LE CAS. Mesuré avant
      // correction : `pnpm test:coverage` sortait en 0 à 96,62 % et
      // `grep -cE "\.tsx +\|"` sur son rapport affichait 0 — aucun composant
      // du premier paquet en `.tsx` n'entrait dans le seuil global. Les DEUX
      // listes bougent : `**/*.test.ts` ne couvre pas `**/*.test.tsx`, et un
      // `include` élargi sans son `exclude` aurait compté les tests eux-mêmes
      // dans le seuil, ce qui le fait monter en ne mesurant rien.
      include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'packages/*/src/index.ts'],
      thresholds: { lines: 70, branches: 70, functions: 70, statements: 70 },
    },
  },
});
