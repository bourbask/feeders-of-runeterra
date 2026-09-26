/**
 * THE BLOCKING SUITE. §7.4: "les scenarios eux-memes sont la suite de tests".
 *
 * Every assertion here is a pair: the thing holds, AND it stops holding when
 * what it depends on is removed. A suite that only ran seven green scenarios
 * would be a suite that proves the scenarios run, which is not the question
 * this tool exists to answer.
 */

import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MOVE_REGISTRY } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { checkReplayEquivalence } from '../src/checks/replay-equivalence.js';
import { createSimHarness, symbolsOf } from '../src/harness.js';
import { GOLDEN_DIR, runAll, runScenario } from '../src/run.js';
import { expandUlid, loadScenarios } from '../src/scenario.js';
import { createScriptedNarrator } from '../src/scripted-narrator.js';

import type { PlayerId } from '@for/engine';
import type { Scenario } from '../src/scenario.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** The acceptance criterion's own budget, written out. */
const RUN_BUDGET_MS = 20_000;

function sources(dir: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...sources(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

describe('les sept scénarios', () => {
  it(
    'sont sept, verts, et sous le budget du critère',
    async () => {
      const started = Date.now();
      const report = await runAll();
      const elapsed = Date.now() - started;

      // The number is the one 01-architecture.md §7.4 writes out, not
      // `report.scenarios.length` — which would be true of any number.
      expect(report.scenarios).toHaveLength(7);
      expect(report.failures).toEqual([]);
      for (const scenario of report.scenarios) {
        // The identifier travels in the value, not in a second argument: the
        // lint refuses `expect(value, message)` and a failure that names no
        // scenario costs the reader the whole benefit.
        expect({ id: scenario.id, failures: scenario.failures }).toEqual({
          id: scenario.id,
          failures: [],
        });
      }
      expect(report.ok).toBe(true);
      expect(elapsed).toBeLessThan(RUN_BUDGET_MS);
    },
    RUN_BUDGET_MS * 2,
  );

  it('exercent les onze mouvements, nommés par la spécification', async () => {
    const report = await runAll();

    // THE ELEVEN, WRITTEN OUT. `01-architecture.md` §2.3 and
    // `content/moves/` name them; comparing `report.coverage.expected` to
    // `Object.keys(MOVE_REGISTRY)` would have been the registry compared to
    // itself, since that is where the check reads it from. Two origins: the
    // specification's list here, the engine's record there.
    expect(report.coverage.expected).toEqual([
      'endure-cold',
      'endure-harm',
      'face-danger',
      'forsake-your-vow',
      'fulfill-your-vow',
      'gather-information',
      'probe-a-soul',
      'reach-a-milestone',
      'secure-advantage',
      'strike',
      'swear-a-vow',
    ]);
    expect(Object.keys(MOVE_REGISTRY)).toHaveLength(11);

    // And the third origin: what the seven journals actually declared.
    expect(report.coverage.missing).toEqual([]);
    expect(report.coverage.code).toBeNull();
  });

  it('retirer un mouvement d’un scénario fait tomber la couverture', async () => {
    // THE COUNTER-PROBE OF `move_not_covered`, and it is done WITHOUT touching
    // a file: the scenario that plays `strike` is run alone, and the coverage
    // of that one run is missing everything the other six carried.
    const report = await runAll({ selector: '03' });
    expect(report.coverage.code).toBe('move_not_covered');
    expect(report.coverage.missing).toContain('face-danger');
    expect(report.coverage.played).toContain('strike');
  });
});

describe('le narrateur est scripté, jamais appelé', () => {
  it('aucun fichier de `src/` n’importe `@for/ai` autrement qu’en type', () => {
    // The acceptance criterion, replayed on every run rather than measured
    // once in a shell.
    const offending = sources(SRC).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text
        .split('\n')
        .some((line) => line.includes("from '@for/ai'") && !line.includes('import type'));
    });
    expect(offending).toEqual([]);
  });

  it('`@for/ai` n’est pas une dépendance déclarée du paquet', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@for/ai');
  });

  it('le conteur scripté ne décide rien : aucun appel d’outil, `structurer` refuse', async () => {
    const port = createScriptedNarrator();
    const events = [];
    for await (const event of port.narrer({
      purpose: 'narration',
      requestId: 'r-1',
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: '{"moveId":"strike"}' }] }],
      tools: [],
      toolPolicy: 'none',
      maxOutputTokens: 16,
      effort: 'low',
    })) {
      events.push(event);
    }
    expect(events.some((event) => event.type === 'tool_call')).toBe(false);
    const end = events.at(-1);
    expect(end?.type).toBe('end');
    expect(end?.type === 'end' ? end.result.toolCalls : null).toEqual([]);

    expect(() =>
      port.structurer({
        purpose: 'forge',
        requestId: 'r-2',
        system: [],
        messages: [],
        schema: { parse: (value: unknown) => value } as never,
        schemaName: 'forge',
        maxOutputTokens: 16,
        effort: 'low',
      }),
    ).toThrow();
  });
});

describe('la rejouabilité n’est pas la répétition', () => {
  it('deux exécutions de la même graine donnent le même hash de journal', async () => {
    const scenario = loadScenarios().find((entry) => entry.id.startsWith('01'));
    expect(scenario).toBeDefined();
    if (scenario === undefined) return;
    const first = await runScenario(scenario);
    const second = await runScenario(scenario);
    expect(first.journalHash).toBe(second.journalHash);
    expect(first.journalHash).not.toBe('');
  });

  it('une autre graine donne un autre journal — la direction basse', async () => {
    const scenario = loadScenarios().find((entry) => entry.id.startsWith('01'));
    expect(scenario).toBeDefined();
    if (scenario === undefined) return;
    // Without this half, "same seed, same hash" is also true of a harness
    // that ignores the seed entirely.
    const first = await runScenario(scenario, { seed: 'graine-a' });
    const second = await runScenario(scenario, { seed: 'graine-b' });
    expect(first.journalHash).not.toBe(second.journalHash);
  });
});

describe('la diffusion se fait par séquence, jamais par le résultat', () => {
  it('sans le drain, le fil d’un joueur perd des entrées', async () => {
    const scenario = loadScenarios().find((entry) => entry.id.startsWith('06'));
    expect(scenario).toBeDefined();
    if (scenario === undefined) return;

    const harness = createSimHarness({
      scenario,
      tmpPrefix: 'for-sim-nodrain-',
      withoutSequenceDrain: true,
    });
    try {
      await harness.run();
      const ownerId = expandUlid(scenario.players[0]?.symbol ?? '0') as PlayerId;
      const snapshot = await harness.service.getSnapshot(harness.campaignId, ownerId);
      const mismatches = checkReplayEquivalence({
        campaignId: harness.campaignId,
        ownerPlayerId: ownerId,
        seed: scenario.seed,
        journal: harness.journal(),
        snapshot: snapshot.state,
        tapes: harness.tapes,
        threadOf: harness.threadOf,
      });
      // RED WITH THE VIOLATION. The entries the burn safety net wrote are in
      // the journal and on nobody's socket.
      expect(mismatches.length).toBeGreaterThan(0);
      expect(mismatches.some((mismatch) => mismatch.issue.includes('jamais livrée'))).toBe(true);
    } finally {
      harness.close();
    }
  });

  it('avec le drain, le même scénario est vert — la direction basse', async () => {
    const scenario = loadScenarios().find((entry) => entry.id.startsWith('06'));
    expect(scenario).toBeDefined();
    if (scenario === undefined) return;
    const result = await runScenario(scenario);
    expect(result.failures).toEqual([]);
  });
});

// ---------------------------------------------------------- the golden corpus

/** The corpus of `id`, parsed. */
function corpusOf(id: string): {
  journal: { seq: number; type: string; payload: Record<string, unknown> }[];
  threads: Record<string, { deliverySeq: number; seq: number; type: string; payload: unknown }[]>;
} {
  const file = join(fileURLToPath(GOLDEN_DIR), `${id}.golden.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as ReturnType<typeof corpusOf>;
}

/**
 * A copy of `id`'s corpus in a scratch directory, with `edit` applied to the
 * parsed object. Returns the directory to hand to `runScenario`.
 */
function corpusCopy(id: string, edit: (corpus: ReturnType<typeof corpusOf>) => void): string {
  // The temporary directory is SHARED between agents on this machine: the
  // prefix names this suite so two runs never read each other's copy.
  const dir = mkdtempSync(join(tmpdir(), 'for-sim-corpus-probe-'));
  const source = join(fileURLToPath(GOLDEN_DIR), `${id}.golden.json`);
  const target = join(dir, `${id}.golden.json`);
  copyFileSync(source, target);
  const corpus = JSON.parse(readFileSync(target, 'utf8')) as ReturnType<typeof corpusOf>;
  edit(corpus);
  // `expectGolden` compares BYTES, so the copy has to be written the way the
  // corpus was written: two-space JSON with sorted keys. `JSON.parse` of a
  // corpus already yields sorted keys, and `JSON.stringify` preserves that
  // order, so re-serialising the untouched copy reproduces the file exactly —
  // which the « direction basse » of each test below checks, by running green
  // on a copy edited with a no-op.
  writeFileSync(target, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');
  return dir;
}

function firstScenarioWith(type: string): Scenario {
  const scenario = loadScenarios().find((entry) =>
    corpusOf(entry.id).journal.some((event) => event.type === type),
  );
  if (scenario === undefined) throw new Error(`aucun scénario ne produit « ${type} »`);
  return scenario;
}

describe('le corpus doré épingle la charge utile, pas seulement le type', () => {
  it('une charge utile qui change fait rougir le corpus doré, même quand l’état final ne bouge pas', async () => {
    const scenario = firstScenarioWith('roll.action_resolved');

    // THE VIOLATION: one number inside one entry, and NOTHING ELSE. `total`
    // of a resolved roll never reaches `state` — no gauge, no track, no
    // momentum reads it back — which is exactly the shape of defect that left
    // `pnpm sim run` green while `ACTION_SCORE_CAP` went from 10 to 8.
    let touched = 0;
    const dir = corpusCopy(scenario.id, (corpus) => {
      for (const event of corpus.journal) {
        if (event.type !== 'roll.action_resolved') continue;
        const total = event.payload['total'];
        if (typeof total !== 'number') continue;
        event.payload['total'] = total - 1;
        touched += 1;
        break;
      }
    });
    expect(touched).toBe(1);

    try {
      const red = await runScenario(scenario, { goldenDir: dir });
      expect(red.ok).toBe(false);
      expect(red.failures.join('\n')).toContain('"total"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // THE LOW DIRECTION: the same copy, untouched, is green. Without it the
    // test above would also pass on a corpus this suite simply cannot read.
    const clean = corpusCopy(scenario.id, () => undefined);
    try {
      const green = await runScenario(scenario, { goldenDir: clean });
      expect(green.failures).toEqual([]);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });

  it('le fil de chaque joueur porte sa charge utile, pas seulement son rang de livraison', async () => {
    // TWO PLAYERS, not one: a corpus that pinned the table's copy of a payload
    // once would pass a single-player check and still prove nothing about who
    // was told what. The scenario chosen has two threads, and the probe edits
    // ONE of them.
    const scenario = loadScenarios().find((entry) => entry.players.length >= 2);
    expect(scenario).toBeDefined();
    if (scenario === undefined) return;

    const symbols = [...Object.keys(corpusOf(scenario.id).threads)].sort();
    expect(symbols.length).toBeGreaterThanOrEqual(2);
    const victim = symbols[1] ?? '';

    let touched = 0;
    const dir = corpusCopy(scenario.id, (corpus) => {
      for (const entry of corpus.threads[victim] ?? []) {
        const payload = entry.payload as Record<string, unknown>;
        if (typeof payload['text'] !== 'string') continue;
        payload['text'] = `${payload['text']} (altéré)`;
        touched += 1;
        break;
      }
    });
    expect(touched).toBe(1);

    try {
      const red = await runScenario(scenario, { goldenDir: dir });
      expect(red.ok).toBe(false);
      expect(red.failures.join('\n')).toContain('(altéré)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('le corpus doré remplace les identifiants nommés par leur symbole et laisse les identifiants comptés tels quels', () => {
    const scenario = loadScenarios().find((entry) => entry.id.startsWith('01'));
    expect(scenario).toBeDefined();
    if (scenario === undefined) return;

    const table = symbolsOf(scenario);
    // WRITTEN OUT, not derived: these seven symbols are what
    // `01-full-session.scenario.json` declares — two players, their two
    // characters, one entity — plus the campaign and the scene the harness
    // derives from the file name. Comparing the table to `expandUlid` instead
    // would compare `padStart` with itself.
    expect([...table.values()].sort()).toEqual([
      'CAMP01',
      'CHRA',
      'CHRB',
      'ENTA',
      'PYRA',
      'PYRB',
      'SCN01',
    ]);

    const raw = readFileSync(join(fileURLToPath(GOLDEN_DIR), `${scenario.id}.golden.json`), 'utf8');
    // NAMED identifiers are gone from the corpus, every one of them.
    for (const id of table.keys()) expect(raw).not.toContain(`"${id}"`);
    for (const symbol of table.values()) expect(raw).toContain(`"${symbol}"`);
    // COUNTED identifiers are still there, whole: the corpus pins the order in
    // which the server allocated them. `correlationId` is a counted UUID.
    expect(/"[0-9A-HJKMNP-TV-Z]{26}"/.test(raw)).toBe(true);
  });
});
