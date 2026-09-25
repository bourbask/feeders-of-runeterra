import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@for/ai',
    globals: true,
    // Any real egress fails the run. See `tests/setup.ts`.
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 70, branches: 70, functions: 70, statements: 70 },
    },
  },
});
