/**
 * The barrel is the package's only public surface. A loader that compiles but
 * whose `loadContent` never comes out of `@for/content` is a loader the server
 * cannot call — and `packages/server` is two waves away from finding out.
 *
 * ── WHY THE LIST IS COMPARED IN BOTH DIRECTIONS (ADR 0007) ───────────────
 * An earlier version of this test only checked that 19 names were PRESENT. It
 * would never have noticed a 20th appearing — and seven had, unlisted and
 * unexplained. A mirror checked from one side is half a mirror, so the whole
 * barrel is enumerated below, literally, and compared member by member.
 * Adding an export without deciding it belongs in the public surface turns
 * this test red.
 */
import { describe, expect, it } from 'vitest';

import * as content from './index.js';

/**
 * Every name `@for/content` exports, written out.
 *
 * Grouped by why each one is public. Nothing here is derived from the module:
 * a list read off the thing it is meant to check proves nothing.
 */
const PUBLIC_SURFACE = [
  // What the server and the simulator call.
  'loadContent',
  'readContentFiles',
  'validateContent',
  'validateLabels',
  'createRegistry',
  'staticContent',
  'staticBundle',
  // The two errors a caller has to be able to catch by class.
  'ContentError',
  'UnknownContentIdError',
  'JsonSyntaxError',
  // The bundle identity, used by the generator and by the API layer.
  'canonicalJson',
  'canonicalBundleJson',
  'contentHash',
  'contentVersion',
  // The generated artefact, re-exported so a caller can say WHICH bundle.
  'GENERATED_FROM',
  'GENERATED_HASH',
  'GENERATED_FILES',
  // The file plan, public so a test or a tool can enumerate it rather than
  // hard-code it — that is how `content-validity.test.ts` drives `it.each`.
  'REQUIRED_FILES',
  'REQUIRED_DIRECTORIES',
  'KNOWN_DIRECTORIES',
  'UNVALIDATED_PATHS',
  'LABELLED_ENUMS',
  // The source-mapped JSON reader, public because the generator reports
  // positions with it.
  'parseJsonSource',
  'formatPath',
  'lineOf',
  // The report builder: `no-console` is an error over `packages/content/**`,
  // so the package BUILDS the report and `scripts/content-check.ts` prints it.
  'formatReport',
  // Reference resolution, public for the tests that prove pass 3 by breaking
  // it, and for `registry.ts`'s « did you mean » on an unknown id.
  'collectRefs',
  'suggest',
  'levenshtein',
].sort();

describe('@for/content — la surface publique', () => {
  it('exporte exactement la liste énumérée, ni plus ni moins', () => {
    expect(Object.keys(content).sort()).toStrictEqual(PUBLIC_SURFACE);
  });

  it.each(PUBLIC_SURFACE)('exporte %s', (name) => {
    expect(content).toHaveProperty(name);
  });

  it('n’expose PAS les libellés : ils sont la sous-entrée « @for/content/ui »', () => {
    expect(content).not.toHaveProperty('attributeLabels');
    expect(PUBLIC_SURFACE).not.toContain('attributeLabels');
  });
});
