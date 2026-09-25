/**
 * The injected sources: identifiers, randomness, clock.
 *
 * The expected ULID is written out BY HAND, not produced by the function under
 * test: `01HF7YAT00` is 1 700 000 000 000 in Crockford base32, computed away
 * from this code, and the sixteen trailing symbols are what sixteen zero bytes
 * must encode to. A test that compared `createUlidFactory` to its own
 * arithmetic would pass whatever the arithmetic did.
 *
 * `ULID_PATTERN` comes from `@for/contracts`, which is where the database and
 * the protocol get theirs: the shape is checked against the project's own
 * definition, not against a regular expression retyped here.
 *
 * (Not in M0-20's « Fichiers touchés » — see the header of `env.test.ts`.)
 */

import { ULID_PATTERN } from '@for/contracts';
import { createCampaignRng } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { campaignRng, createUlidFactory, systemClock } from './deps.js';

import type { TimeSource } from './deps.js';

const BOOT_MS = 1_700_000_000_000;
const frozen: TimeSource = { now: () => BOOT_MS };

describe('createUlidFactory', () => {
  it('encode l’horloge et le hasard comme un ULID', () => {
    const ids = createUlidFactory(frozen, () => new Uint8Array(16));

    expect(ids.next()).toBe('01HF7YAT000000000000000000');
  });

  it('masque chaque octet sur cinq bits', () => {
    // 0..15 map to the first sixteen symbols; 255 & 31 = 31, the last one.
    const counting = createUlidFactory(frozen, () => Uint8Array.from({ length: 16 }, (_, i) => i));
    const saturated = createUlidFactory(frozen, () => new Uint8Array(16).fill(255));

    expect(counting.next()).toBe('01HF7YAT000123456789ABCDEF');
    expect(saturated.next()).toBe('01HF7YAT00ZZZZZZZZZZZZZZZZ');
  });

  it('produit des identifiants qui satisfont ULID_PATTERN et ne se répètent pas', () => {
    const ids = createUlidFactory(systemClock);
    const drawn = new Set<string>();

    for (let i = 0; i < 500; i += 1) {
      const id = ids.next();
      expect(id).toMatch(ULID_PATTERN);
      drawn.add(id);
    }

    expect(drawn.size).toBe(500);
  });

  it('suit l’horloge qu’on lui donne, jamais celle du système', () => {
    let ms = BOOT_MS;
    const ids = createUlidFactory({ now: () => ms }, () => new Uint8Array(16));

    const first = ids.next();
    ms += 1;
    const second = ids.next();

    expect(first).toBe('01HF7YAT000000000000000000');
    expect(second).toBe('01HF7YAT010000000000000000');
  });
});

describe('campaignRng', () => {
  it('délègue au dérivateur du moteur, sans rien ajouter', () => {
    const injected = campaignRng.forCampaign('graine', 7, 'action');
    const direct = createCampaignRng('graine', 7, 'action');

    expect([injected.roll(6), injected.roll(10), injected.roll(100)]).toEqual([
      direct.roll(6),
      direct.roll(10),
      direct.roll(100),
    ]);
    // And it is not the trivial equality of two constant generators: the same
    // derivation on another seq gives another series.
    expect(campaignRng.forCampaign('graine', 8, 'action').roll(100)).not.toBe(
      createCampaignRng('graine', 7, 'action').roll(100),
    );
  });
});

describe('systemClock', () => {
  it('rend des millisecondes d’époque plausibles', () => {
    // 2020-01-01, a date this project is certainly after.
    expect(systemClock.now()).toBeGreaterThan(1_577_836_800_000);
  });
});
