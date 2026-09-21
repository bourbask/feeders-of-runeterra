import { describe, expect, it } from 'vitest';

import { NOM } from './index.js';

describe('@for/contracts', () => {
  it("s'annonce sous son nom", () => {
    expect(NOM).toBe('@for/contracts');
  });
});
