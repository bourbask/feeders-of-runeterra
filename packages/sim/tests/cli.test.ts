/**
 * The command line, and the five modes behind it.
 *
 * WHAT IS NOT TESTED HERE, AND WHY IT IS SAID: `record` is NOT driven end to
 * end. It rewrites the real corpora in `tests/golden/`, and a test that ran it
 * would rewrite them from whatever the code does at that moment — which is the
 * exact failure the golden runner exists to prevent, performed automatically
 * on every run. What IS tested is its refusal: `runAll({ record: true })`
 * without `GOLDEN_UPDATE=1` raises rather than rewriting nothing in silence.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { main, parseArgs, SIM_SLOW_LIMIT_MS } from '../src/cli.js';
import { runAll } from '../src/run.js';
import { loadScenarios } from '../src/scenario.js';

async function capture(argv: readonly string[]): Promise<{ code: number; out: string }> {
  let out = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  try {
    const code = await main(argv);
    return { code, out };
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseArgs', () => {
  it('lit le mode, les valeurs et les drapeaux', () => {
    const flags = parseArgs(['run', '--scenario=03', '--format=json', '--bail-on-slow']);
    expect(flags.mode).toBe('run');
    expect(flags.values.get('scenario')).toBe('03');
    expect(flags.values.get('format')).toBe('json');
    expect(flags.switches.has('bail-on-slow')).toBe(true);
    expect(flags.switches.has('format')).toBe(false);
  });

  it('ne prend que le PREMIER mot comme mode', () => {
    expect(parseArgs(['run', 'fuzz']).mode).toBe('run');
    expect(parseArgs([]).mode).toBe('');
  });

  it('accepte une valeur qui contient un signe égal', () => {
    expect(parseArgs(['replay', '--db=/tmp/a=b.db']).values.get('db')).toBe('/tmp/a=b.db');
  });
});

describe('les modes', () => {
  it('`list` nomme les sept scénarios et leur nombre d’étapes', async () => {
    const { code, out } = await capture(['list']);
    expect(code).toBe(0);
    for (const scenario of loadScenarios()) {
      expect(out).toContain(scenario.id);
      expect(out).toContain(scenario.title);
    }
    expect(out.trim().split('\n')).toHaveLength(7);
  });

  it('`run --format=json` sort en 0 et rend un rapport lisible par la CI', async () => {
    const { code, out } = await capture(['run', '--format=json']);
    expect(code).toBe(0);
    const report = JSON.parse(out) as {
      ok: boolean;
      scenarios: { id: string; ok: boolean; journalHash: string }[];
      coverage: { code: string | null };
    };
    expect(report.ok).toBe(true);
    expect(report.scenarios).toHaveLength(7);
    expect(report.coverage.code).toBeNull();
    for (const scenario of report.scenarios) expect(scenario.journalHash).toHaveLength(64);
  }, 30_000);

  it('`run --scenario=` sur un sélecteur qui ne matche rien ÉCHOUE, il ne passe pas', async () => {
    // Zero scenario run must never look like zero scenario failed.
    await expect(capture(['run', '--scenario=99'])).rejects.toThrow(/aucun scénario/u);
  });

  it('`run --format=pretty` imprime chaque échec, jamais un compte', async () => {
    const { out } = await capture(['run', '--scenario=03', '--format=pretty']);
    // `03` alone cannot cover the eleven moves, so the run is red and the
    // reason has to be readable without opening a file.
    expect(out).toContain('move_not_covered');
    expect(out).toContain('ROUGE');
  });

  it('`fuzz` passe par la ligne de commande et sort en 0', async () => {
    const { code, out } = await capture(['fuzz', '--iterations=8', '--seed=cli']);
    expect(code).toBe(0);
    expect(out).toContain('cli');
  }, 30_000);

  it('`replay` sur une base inexistante sort en 1 et le dit', async () => {
    const { code, out } = await capture(['replay', '--db=/for-sim/nulle-part.db']);
    expect(code).toBe(1);
    expect(out).toContain('base illisible');
  });

  it('`run --out=` écrit le rapport de la CI à l’endroit nommé', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'for-sim-out-'));
    const file = join(folder, 'sim-report.json');
    try {
      // ONE scenario, so the run is RED on coverage — and the report is
      // written anyway. That is the point: a CI that only kept the file on a
      // green run would lose it exactly when it is needed.
      const { code } = await capture(['run', '--scenario=00', `--out=${file}`]);
      expect(code).toBe(1);
      const written = JSON.parse(readFileSync(file, 'utf8')) as {
        scenarios: { id: string }[];
        coverage: { code: string | null };
      };
      expect(written.scenarios.map((scenario) => scenario.id)).toEqual(['00-smoke-join-and-roll']);
      expect(written.coverage.code).toBe('move_not_covered');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('un mode inconnu sort en 1 et rappelle l’usage', async () => {
    const { code, out } = await capture(['danser']);
    expect(code).toBe(1);
    expect(out).toContain('mode inconnu');
    expect(out).toContain('pnpm sim <mode>');
  });

  it('sans mode, sort en 1 ; `help`, en 0', async () => {
    expect((await capture([])).code).toBe(1);
    expect((await capture(['help'])).code).toBe(0);
  });

  it('`replay` sans `--db` sort en 1', async () => {
    const { code, out } = await capture(['replay']);
    expect(code).toBe(1);
    expect(out).toContain('--db');
  });

  it('la garde de lenteur est un nombre du critère, pas une lecture de la mesure', () => {
    // §7.4: "Si elle dépasse 60 secondes, la CI échoue". Written out.
    expect(SIM_SLOW_LIMIT_MS).toBe(60_000);
  });
});

describe('`record` ne réécrit rien par accident', () => {
  it('refuse de tourner sans GOLDEN_UPDATE=1', async () => {
    expect(process.env['GOLDEN_UPDATE']).toBeUndefined();
    await expect(runAll({ record: true })).rejects.toThrow(/GOLDEN_UPDATE/u);
  });
});
