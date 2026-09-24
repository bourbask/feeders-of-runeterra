/**
 * `@for/content` — the complete registry. Server and simulator only.
 *
 * The content is NOT read from disk at runtime: `generated/index.ts` carries
 * it as static data, and this module runs the same four passes over it before
 * anybody gets a `ContentBundle`. So a bundle that would have failed
 * `pnpm content:check` fails `buildServer()` too, with the same report.
 *
 * `staticContent()` is memoised and LAZY on purpose. Validating at import time
 * would turn a broken bundle into a module-load crash with no report attached
 * — the server could not print the four-pass errors it exists to print.
 */

export * from './json-source.js';
export * from './load.js';
export * from './manifest.js';
export * from './registry.js';
export * from './validate.js';

import { GENERATED_FILES, GENERATED_FROM, GENERATED_HASH } from './generated/index.js';
import type { ContentRegistry } from './registry.js';
import { createRegistry } from './registry.js';
import type { ContentBundle } from './validate.js';
import { validateContent } from './validate.js';

export { GENERATED_FILES, GENERATED_FROM, GENERATED_HASH };

let cached: ContentRegistry | undefined;

/**
 * The bundle compiled into the package, validated once.
 *
 * Throws `ContentError` — the caller prints `error.format()` and exits 1,
 * exactly like `pnpm content:check`.
 */
export function staticContent(): ContentRegistry {
  if (cached === undefined) {
    const files = new Map(Object.entries(GENERATED_FILES));
    cached = createRegistry(validateContent(files, { root: GENERATED_FROM, hash: GENERATED_HASH }));
  }
  return cached;
}

/** For tests that need a second, independent validation of the static bundle. */
export function staticBundle(): ContentBundle {
  return staticContent().bundle;
}
