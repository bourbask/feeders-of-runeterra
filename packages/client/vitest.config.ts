import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: '@for/client',
    globals: true,
    // Les composants sont rendus, pas inspectes en chaine : un test qui lit du
    // JSX sans DOM ne prouve rien sur ce qu'un joueur voit.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      // `.tsx` COMPRIS. Le perimetre de la racine s'arrete a `*.ts` : un seuil
      // qui ne voit aucun composant d'un paquet de composants ne mesure rien.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/test/**'],
      thresholds: { lines: 70, branches: 70, functions: 70, statements: 70 },
    },
  },
});
