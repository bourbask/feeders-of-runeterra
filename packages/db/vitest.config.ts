import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@for/db',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // `src/cli/**` are command entry points: they run as `pnpm db:migrate`
      // and friends, measured by their exit code, not by a unit test. Counting
      // them would turn the 80 % floor into a number about CLI plumbing.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/cli/**'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
