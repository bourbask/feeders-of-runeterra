/**
 * The barrel is the package's only public surface. A loader that compiles but
 * whose `loadContent` never comes out of `@for/content` is a loader the server
 * cannot call — and `packages/server` is two waves away from finding out.
 */
import { describe, expect, it } from 'vitest';

import * as content from './index.js';

describe('@for/content — la surface publique', () => {
  it.each([
    'loadContent',
    'readContentFiles',
    'validateContent',
    'validateLabels',
    'createRegistry',
    'staticContent',
    'staticBundle',
    'ContentError',
    'UnknownContentIdError',
    'canonicalJson',
    'contentHash',
    'contentVersion',
    'parseJsonSource',
    'REQUIRED_FILES',
    'REQUIRED_DIRECTORIES',
    'UNVALIDATED_PATHS',
    'GENERATED_FROM',
    'GENERATED_HASH',
    'GENERATED_FILES',
  ])('exporte %s', (name) => {
    expect(content).toHaveProperty(name);
  });

  it('n’expose PAS les libellés : ils sont la sous-entrée « @for/content/ui »', () => {
    expect(content).not.toHaveProperty('attributeLabels');
  });
});
