/**
 * Two renderings of one verdict: a table a human reads, and a file the CI
 * reads.
 *
 * ── THE JSON IS THE CONTRACT, THE TABLE IS THE COURTESY ─────────────────
 * `pnpm sim run --format=json` is what job 11 of the CI runs, so the JSON
 * carries the exit-code-bearing facts: `ok`, the failures, the coverage, and
 * every scenario's hash. The pretty table drops nothing a failing run needs —
 * every failure line is printed, never "3 erreurs" with the list left in the
 * file.
 *
 * NO COLOUR, NO SPINNER, NO WIDTH DETECTION. The output is read as often from
 * a CI log as from a terminal, and an escape sequence in a log is noise. The
 * one formatting choice is padding, so the columns line up in a monospace
 * font.
 */

import type { SimRunReport } from './run.js';

const MS_PER_SECOND = 1000;

function seconds(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(2)} s`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** The machine's copy. Stable key order, one trailing newline. */
export function renderJson(report: SimRunReport): string {
  return `${JSON.stringify(
    {
      ok: report.ok,
      durationMs: report.durationMs,
      failures: report.failures,
      coverage: report.coverage,
      scenarios: report.scenarios.map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        ok: scenario.ok,
        durationMs: scenario.durationMs,
        eventCount: scenario.eventCount,
        journalHash: scenario.journalHash,
        failures: scenario.failures,
        steps: scenario.steps,
      })),
    },
    null,
    2,
  )}\n`;
}

/** The human's copy. */
export function renderPretty(report: SimRunReport): string {
  const lines: string[] = [];
  const width = Math.max(12, ...report.scenarios.map((scenario) => scenario.id.length));

  lines.push(`${'scénario'.padEnd(width)}  état    entrées  durée     hash`);
  lines.push('-'.repeat(width + 40));
  for (const scenario of report.scenarios) {
    lines.push(
      `${pad(scenario.id, width)}  ${scenario.ok ? 'vert  ' : 'ROUGE '}  ` +
        `${String(scenario.eventCount).padStart(7)}  ${seconds(scenario.durationMs).padStart(8)}  ` +
        scenario.journalHash.slice(0, 12),
    );
  }

  lines.push('');
  lines.push(
    `mouvements couverts : ${String(report.coverage.played.length)} / ${String(report.coverage.expected.length)}` +
      (report.coverage.missing.length > 0
        ? ` — manquants : ${report.coverage.missing.join(', ')}`
        : ''),
  );

  const failing = report.scenarios.filter((scenario) => !scenario.ok);
  if (failing.length > 0 || report.failures.length > 0) {
    lines.push('');
    lines.push('ce qui ne va pas');
    for (const scenario of failing) {
      for (const failure of scenario.failures) lines.push(`  ${scenario.id} · ${failure}`);
    }
    for (const failure of report.failures) lines.push(`  <run> · ${failure}`);
  }

  lines.push('');
  lines.push(`${report.ok ? 'VERT' : 'ROUGE'} en ${seconds(report.durationMs)}`);
  return `${lines.join('\n')}\n`;
}

/** The list `pnpm sim list` prints: one scenario per line. */
export function renderList(
  scenarios: readonly {
    readonly id: string;
    readonly title: string;
    readonly steps: readonly unknown[];
  }[],
): string {
  const width = Math.max(12, ...scenarios.map((scenario) => scenario.id.length));
  return `${scenarios
    .map(
      (scenario) =>
        `${pad(scenario.id, width)}  ${String(scenario.steps.length).padStart(3)} étapes  ${scenario.title}`,
    )
    .join('\n')}\n`;
}
