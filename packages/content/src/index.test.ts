import { describe, expect, it } from 'vitest';

import { NOM } from './index.js';

describe('@for/content', () => {
  it("s'annonce sous son nom", () => {
    expect(NOM).toBe('@for/content');
  });
});
