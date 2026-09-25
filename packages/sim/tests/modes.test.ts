/**
 * `replay` on a real database, and `fuzz` on real intents.
 *
 * Both are driven against a database THIS FILE produced with the harness,
 * because both are tools for reading a base somebody else wrote and there is
 * no other honest way to have one.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zIntent } from '@for/contracts';
import { createSeededRng } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { createSimHarness } from '../src/harness.js';
import { anIntent, fuzz, replayDatabase } from '../src/modes.js';
import { expandUlid, loadScenarios } from '../src/scenario.js';

import type { Scenario } from '../src/scenario.js';

function scenario(prefix: string): Scenario {
  const found = loadScenarios().find((entry) => entry.id.startsWith(prefix));
  if (found === undefined) throw new Error(`aucun scénario ${prefix}`);
  return found;
}

/** A played-out campaign, copied to a file of its own. */
async function aPlayedDatabase(prefix: string): Promise<{ file: string; clean: () => void }> {
  const harness = createSimHarness({
    scenario: scenario(prefix),
    tmpPrefix: `for-sim-replay-${prefix}-`,
  });
  await harness.run();
  const folder = mkdtempSync(join(tmpdir(), 'for-sim-copy-'));
  const file = join(folder, 'copy.db');
  // `VACUUM INTO` rather than a file copy: the WAL is not checkpointed, and a
  // plain copy would hand the reader a base missing its last turns.
  harness.connection.exec(`VACUUM INTO '${file}'`);
  harness.close();
  return {
    file,
    clean: (): void => {
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

describe('`replay --db`', () => {
  it('rejoue une base réelle et la déclare verte', async () => {
    const { file, clean } = await aPlayedDatabase('01');
    try {
      const outcome = replayDatabase(file, null);
      expect(outcome.ok).toBe(true);
      expect(outcome.text).toContain('entrées');
      expect(outcome.text).toContain('vert');
    } finally {
      clean();
    }
  });

  it('rougit quand une PROJECTION ne dit plus ce que le journal dit', async () => {
    const { file, clean } = await aPlayedDatabase('01');
    try {
      // The counter-probe of the one comparison worth having: the replay
      // against the rows the live write path put in `characters`. Moving the
      // projection alone must be caught.
      const { openSqlite } = await import('@for/db');
      const connection = openSqlite(file);
      connection.prepare(`UPDATE characters SET momentum = momentum + 1`).run();
      connection.close();

      const outcome = replayDatabase(file, null);
      expect(outcome.ok).toBe(false);
      expect(outcome.text).toContain('souffle projeté');
    } finally {
      clean();
    }
  });

  it('une campagne nommée qui n’existe pas est un échec, pas un silence', async () => {
    const { file, clean } = await aPlayedDatabase('00');
    try {
      const outcome = replayDatabase(file, expandUlid('CAMPZZ'));
      expect(outcome.ok).toBe(false);
      expect(outcome.text).toContain('aucune campagne');
    } finally {
      clean();
    }
  });

  it('un fichier illisible est un échec nommé', () => {
    const outcome = replayDatabase('/for-sim/does-not-exist.db', null);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('base illisible');
  });
});

describe('`fuzz`', () => {
  it('ne produit que des intentions que le protocole gelé accepte', () => {
    // If the generator emitted something `zIntent` refuses, every iteration
    // would come back `validation_failed` and the mode would measure its own
    // bug. Measured once for real: `GHOST` padded into a non-Crockford ULID,
    // 200 refusals on seed `m0`.
    const rng = createSeededRng('fuzz-shape');
    for (let index = 0; index < 200; index += 1) {
      const intent = anIntent((sides) => rng.roll(sides), expandUlid('CHRA'));
      const parsed = zIntent.safeParse(intent);
      if (!parsed.success) throw new Error(`intention refusée : ${JSON.stringify(intent)}`);
      expect(parsed.success).toBe(true);
    }
  });

  it('un refus propre est un succès, et la graine est dans le rapport', async () => {
    const outcome = await fuzz({ iterations: 40, seed: 'm0-test' });
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('m0-test');
    expect(outcome.text).toContain('refusées proprement');
  }, 30_000);

  it('deux passes de la même graine donnent le même compte', async () => {
    const first = await fuzz({ iterations: 25, seed: 'm0-repro' });
    const second = await fuzz({ iterations: 25, seed: 'm0-repro' });
    expect(first.text).toBe(second.text);
  }, 30_000);
});
