/**
 * THE BLOCKING SUITE. §7.4: "les scenarios eux-memes sont la suite de tests".
 *
 * Every assertion here is a pair: the thing holds, AND it stops holding when
 * what it depends on is removed. A suite that only ran seven green scenarios
 * would be a suite that proves the scenarios run, which is not the question
 * this tool exists to answer.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MOVE_REGISTRY } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { checkReplayEquivalence } from '../src/checks/replay-equivalence.js';
import { createSimHarness } from '../src/harness.js';
import { runAll, runScenario } from '../src/run.js';
import { expandUlid, loadScenarios } from '../src/scenario.js';
import { createScriptedNarrator } from '../src/scripted-narrator.js';

import type { PlayerId } from '@for/engine';

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
