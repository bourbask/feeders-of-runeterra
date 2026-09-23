/**
 * The purity guard of `@for/engine`.
 *
 * Three nets cover the same invariant, and they do NOT have the same mesh:
 *
 * - `tsconfig` gives the package no ambient typing (`types: []`), so a NAMED
 *   import of a node builtin is a compilation error (TS2307);
 * - ESLint (`tooling/eslint-config/engine-purity.js`) catches what the
 *   compiler lets through, in particular the bare side-effect import
 *   `import 'node:fs';`, which compiles without complaint;
 * - this test reads the source text and the built bundle, which catches what
 *   both could miss: `Math.random()`, `new Date()`, `process.env`, a builtin
 *   reached through a dynamic import.
 *
 * It is a TEXT scan on purpose. The point is not elegance, it is that the
 * failure is visible when someone writes the forbidden thing, and that the
 * guard can be proven by violating it.
 *
 * This file lives in `tests/`, outside `src/`, precisely so that the patterns
 * it looks for can be written down here without matching themselves.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(PACKAGE_ROOT, 'src');
const BUNDLE = join(PACKAGE_ROOT, 'dist', 'index.js');

interface Forbidden {
  readonly label: string;
  readonly pattern: RegExp;
}

/**
 * Each entry names ONE way to reach outside the arguments. The messages are
 * the ones a future contributor will read, so they say what to do instead.
 */
const FORBIDDEN: readonly Forbidden[] = [
  {
    label: 'a node builtin (prefixed), including the bare side-effect import',
    pattern: /(?:^|[^\w$.])(?:import|require)\s*[(\s]\s*['"]node:/m,
  },
  {
    label: 'a node builtin (unprefixed)',
    pattern:
      /(?:from|import|require)\s*[(\s]?\s*['"](?:fs|path|crypto|os|http|https|child_process|stream|buffer|util|events|url|worker_threads)['"]/,
  },
  { label: 'ambient randomness', pattern: /\bMath\s*\.\s*random\b/ },
  { label: 'the ambient clock, via new Date()', pattern: /\bnew\s+Date\b/ },
  { label: 'the ambient clock, via Date.now()', pattern: /\bDate\s*\.\s*now\b/ },
  { label: 'the environment', pattern: /\bprocess\s*\.\s*env\b/ },
  { label: 'the global scope', pattern: /\bglobalThis\b/ },
  { label: 'the network', pattern: /\bfetch\s*\(/ },
  { label: 'a timer', pattern: /\b(?:setTimeout|setInterval|queueMicrotask)\s*\(/ },
  { label: 'the web crypto API', pattern: /\bcrypto\s*\.\s*(?:randomUUID|getRandomValues)\b/ },
  { label: 'a performance counter', pattern: /\bperformance\s*\.\s*now\b/ },
];

function collectSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

function offences(text: string): string[] {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

describe('@for/engine stays pure', () => {
  it('declares no runtime dependency and no side effect', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    expect(Object.keys(manifest['dependencies'] ?? {})).toEqual([]);
    expect(manifest['sideEffects']).toBe(false);
  });

  it('finds at least the modules it is supposed to scan', () => {
    // Without this, a bad glob would make every scan below pass on nothing.
    // That is exactly the "rule present and inert" failure this repo keeps
    // running into.
    expect(collectSourceFiles(SRC).length).toBeGreaterThanOrEqual(15);
  });

  it.each(collectSourceFiles(SRC).map((file) => [file.slice(SRC.length + 1), file]))(
    'src/%s reaches outside its arguments nowhere',
    (_relative, file) => {
      expect(offences(readFileSync(file, 'utf8'))).toEqual([]);
    },
  );

  it('the built bundle reaches outside its arguments nowhere', () => {
    // `dist/` is produced by `tsc -b`, which the package `test` script runs
    // first. If it is missing, that is a build problem and the test must say
    // so rather than quietly skip.
    expect(statSync(BUNDLE).isFile()).toBe(true);
    expect(offences(readFileSync(BUNDLE, 'utf8'))).toEqual([]);
  });

  it('holds no French string: no accented character anywhere in src', () => {
    // The mechanical enumeration values (vif, coeur, presage, echec...) are
    // accent-free by construction. Anything a human would read comes from the
    // content bundle, passed in as an argument.
    const accented = /[À-ÖØ-öø-ÿŒœ]/;
    const guilty = collectSourceFiles(SRC).filter((file) =>
      accented.test(readFileSync(file, 'utf8')),
    );
    expect(guilty).toEqual([]);
  });
});
