/**
 * Gabarit de paquet. `pnpm tsx scripts/new-package.ts <nom> [--react|--node|--pur]`
 * Un paquet créé à la main oublie toujours un des cinq scripts obligatoires.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const [nom, ...drapeaux] = process.argv.slice(2);
if (!nom || !/^[a-z][a-z0-9-]*$/.test(nom)) {
  console.error(
    'Usage : pnpm tsx scripts/new-package.ts <nom-en-minuscules> [--react|--node|--pur]',
  );
  process.exit(1);
}

const base = join('packages', nom);
if (existsSync(base)) {
  console.error(`packages/${nom} existe déjà.`);
  process.exit(1);
}

const genre = drapeaux.includes('--react') ? 'react' : drapeaux.includes('--pur') ? 'pur' : 'node';
const tsconfigDe = { react: 'react.json', pur: 'library.json', node: 'node.json' }[genre];

mkdirSync(join(base, 'src'), { recursive: true });

const ecrire = (chemin: string, contenu: string): void => {
  writeFileSync(join(base, chemin), contenu);
};

ecrire(
  'package.json',
  `${JSON.stringify(
    {
      name: `@for/${nom}`,
      version: '0.0.0',
      private: true,
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      scripts: {
        build: 'tsc -b',
        typecheck: 'tsc -p tsconfig.json --noEmit',
        lint: 'eslint .',
        test: 'vitest run',
        'test:watch': 'vitest',
      },
      devDependencies: { '@for/tsconfig': 'workspace:*' },
    },
    null,
    2,
  )}\n`,
);

const compilerOptions =
  genre === 'react' ? { types: ['vite/client'] } : { outDir: 'dist', rootDir: 'src' };

ecrire(
  'tsconfig.json',
  `${JSON.stringify(
    {
      extends: `@for/tsconfig/${tsconfigDe}`,
      compilerOptions,
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'dist'],
    },
    null,
    2,
  )}\n`,
);
ecrire(
  'tsconfig.test.json',
  `${JSON.stringify({ extends: '@for/tsconfig/test.json', include: ['src/**/*'] }, null, 2)}\n`,
);
// Sans ce fichier, `vitest.workspace.ts` ne voit pas le paquet : ses tests
// disparaissent silencieusement de la passe racine.
ecrire(
  'vitest.config.ts',
  `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@for/${nom}',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 70, branches: 70, functions: 70, statements: 70 },
    },
  },
});
`,
);

ecrire('src/index.ts', `export const NOM = '@for/${nom}' as const;\n`);
ecrire(
  'src/index.test.ts',
  `import { describe, expect, it } from 'vitest';\nimport { NOM } from './index.js';\n\ndescribe('@for/${nom}', () => {\n  it("s'annonce sous son nom", () => {\n    expect(NOM).toBe('@for/${nom}');\n  });\n});\n`,
);

console.log(`packages/${nom} créé (${genre}). Ajoute-le aux références de tsconfig.json racine.`);
