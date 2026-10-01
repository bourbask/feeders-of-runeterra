import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { ASSERTIONS } from '@for/ai';
import { afterEach, describe, expect, it } from 'vitest';

import { CASES_DIR, CASES_MIN, loadCases } from './cases.js';
import { CHRONICLE_DIR } from './fixtures.js';
import { main, runOffline, type OfflineOptions } from './run-offline.js';

const made: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'for-m027-run-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A writable copy of the corpus, so a probe can violate a rule and restore by copy. */
function corpusCopy(): OfflineOptions & { readonly dir: string } {
  const dir = scratch();
  cpSync(CASES_DIR, dir, { recursive: true });
  return { dir, casesDir: dir, fixturesDir: join(dir, 'fixtures'), chronicleDir: CHRONICLE_DIR };
}

const silent = { out: (): void => undefined, err: (): void => undefined };

describe('la porte N0', () => {
  it('passe sur le corpus livré, sans clé et sans appel réseau', () => {
    const report = runOffline();
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.caseCount).toBeGreaterThanOrEqual(CASES_MIN);
    expect(report.sampleCount).toBe(report.caseCount * 2);
  });

  it('tient sous les cinq secondes du critère d’acceptation', () => {
    // Cinq secondes, écrites en toutes lettres : c'est le critère, pas une mesure relue.
    expect(runOffline().durationMs).toBeLessThan(5000);
  });

  it('exerce EXACTEMENT les identifiants de Object.keys(ASSERTIONS)', () => {
    const exercised = new Set(runOffline().rates.map((row) => row.id));
    for (const id of Object.keys(ASSERTIONS)) expect(exercised.has(id)).toBe(true);
    // Et aucune assertion n'est restée à zéro mesure : une règle jamais lancée ne garde rien.
    for (const row of runOffline().rates) expect(row.total).toBeGreaterThan(0);
  });

  it('refuse de tourner sous le plancher de cas de la fiche', () => {
    const few = loadCases(CASES_DIR).slice(0, CASES_MIN - 1);
    expect(() => runOffline({ cases: few })).toThrow(new RegExp(String(CASES_MIN), 'u'));
  });

  it('écrit un rapport lisible et un eval-report.json, et sort en zéro', () => {
    const out = join(scratch(), 'eval-report.json');
    const lines: string[] = [];
    const code = main([`--out=${out}`], { out: (line) => lines.push(line), err: () => undefined });
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/Taux par assertion/u);
    const written = JSON.parse(readFileSync(out, 'utf8')) as { ok: boolean; rates: unknown[] };
    expect(written.ok).toBe(true);
    expect(written.rates.length).toBeGreaterThan(0);
  });
});

describe('la porte N0, prouvée en la violant', () => {
  it('un caractère changé dans un instantané de requête sort en un, avec un diff lisible', () => {
    const copy = corpusCopy();
    const path = join(copy.dir, '01-issue-franche.request.json');
    const original = readFileSync(path, 'utf8');
    writeFileSync(path, original.replace('épaule de pierre', 'épaule de Pierre'), 'utf8');

    const lines: string[] = [];
    const code = main(
      [`--out=${join(copy.dir, 'rapport.json')}`],
      {
        out: (line) => lines.push(line),
        err: () => undefined,
      },
      copy,
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/instantané de requête/u);
    expect(lines.join('\n')).toMatch(/enregistré :/u);

    // Restauration par copie de fichier, jamais par git checkout (docs/RECETTE.md §6).
    writeFileSync(path, original, 'utf8');
    expect(main([`--out=${join(copy.dir, 'rapport.json')}`], silent, copy)).toBe(0);
  });

  it('un prompt_version enregistré remplacé sort en un', () => {
    const copy = corpusCopy();
    const path = join(copy.dir, '02-issue-partielle-presage-prix.recorded.json');
    const original = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      original.replace(/"prompt_version": "[^"]+"/u, '"prompt_version": "conteur/1.0.0"'),
      'utf8',
    );

    const report = runOffline(copy);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/prompt_version/u);

    writeFileSync(path, original, 'utf8');
    expect(runOffline(copy).ok).toBe(true);
  });

  it('un alias de champion réservé glissé dans un enregistrement sort en un', () => {
    const copy = corpusCopy();
    const path = join(copy.dir, '04-pression-champions-reserves.recorded.json');
    const original = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      original.replace('Rien ne bouge au cairn', 'La Griffe de Givre bouge au cairn'),
      'utf8',
    );
    const report = runOffline(copy);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/no_reserved_champion/u);

    writeFileSync(path, original, 'utf8');
    expect(runOffline(copy).ok).toBe(true);
  });

  it('un absent ajouté aux presents d’un enregistrement sort en un', () => {
    const copy = corpusCopy();
    const path = join(copy.dir, '06-absent-interpelle.recorded.json');
    const original = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      original.replaceAll(
        '{\\"nom\\": \\"Ulrun\\", \\"etat\\": \\"accroupi près de la corde\\"}',
        '{\\"nom\\": \\"Ulrun\\", \\"etat\\": \\"accroupi\\"}, {\\"nom\\": \\"Signy\\", \\"etat\\": \\"revenue\\"}',
      ),
      'utf8',
    );
    const report = runOffline(copy);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/scene_block_consistent/u);

    writeFileSync(path, original, 'utf8');
    expect(runOffline(copy).ok).toBe(true);
  });

  it('un refus retenu sur « absurde mais possible » sort en un', () => {
    const copy = corpusCopy();
    const path = join(copy.dir, '10-absurde-mais-possible.recorded.json');
    const original = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      original.replaceAll(
        '\\"refus\\": null',
        '\\"refus\\": {\\"cause\\": \\"cible_morte\\", \\"cible\\": \\"Keld\\"}',
      ),
      'utf8',
    );
    const report = runOffline(copy);
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/no_refusal/u);

    writeFileSync(path, original, 'utf8');
    expect(runOffline(copy).ok).toBe(true);
  });
});

describe('zéro appel réseau, lu sur le graphe d’imports', () => {
  it('le runner hors ligne n’atteint ni record.ts ni le port du conteur', () => {
    const seen = new Set<string>();
    const queue = [resolve(import.meta.dirname, 'run-offline.ts')];
    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from '(\.[^']+)'/gu)) {
        const target = resolve(dirname(file), (match[1] ?? '').replace(/\.js$/u, '.ts'));
        queue.push(target);
      }
    }
    expect([...seen].some((file) => file.endsWith('record.ts'))).toBe(false);
    for (const file of seen) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/\bselectNarrator\b|\.narrer\(/u);
    }
  });
});
