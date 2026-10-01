/**
 * The N0 report: one page a human reads, and one JSON a job keeps.
 *
 * ── WHAT A READER MUST BE ABLE TO DO WITH IT ────────────────────────────────
 * Answer « ai-je cassé le conteur ? » without opening a transcript. So every
 * failure carries the case, the sample, the rule and the offending excerpt —
 * which is what `AssertionResult.detail` is for — and the per-assertion rates
 * sit at the bottom, because a partial regression is visible there even when
 * the global verdict holds (section 8.5).
 *
 * ── THE RATES ARE PRINTED FOR EVERY IDENTIFIER, PASSED OR NOT ───────────────
 * An assertion that never runs is an assertion that guards nothing, and a
 * table that only listed failures would hide it. A line at `0/0` is a defect,
 * and the reader sees it.
 */

import type { ChronicleVerdict } from './chronicle.js';
import type { Check } from './graders/kit.js';
import type { BlindnessVerdict } from './graders/refusal-blindness.js';
import type { RequestDiffLine } from './request.js';

export interface SampleReport {
  readonly index: number;
  readonly checks: readonly Check[];
}

export interface CaseReport {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  /** False ⇒ the built request no longer matches `<id>.request.json`. */
  readonly requestMatches: boolean;
  readonly requestDiff: readonly RequestDiffLine[];
  readonly samples: readonly SampleReport[];
}

export interface RateRow {
  readonly id: string;
  readonly gating: boolean;
  readonly passed: number;
  readonly total: number;
}

export interface OfflineReport {
  readonly ok: boolean;
  readonly promptVersion: string;
  readonly caseCount: number;
  readonly sampleCount: number;
  readonly cases: readonly CaseReport[];
  readonly chronicle: ChronicleVerdict;
  readonly blindness: BlindnessVerdict;
  readonly rates: readonly RateRow[];
  /** One line per blocking failure, in reading order. */
  readonly failures: readonly string[];
  /** `<identifiant> (<nombre>)` for every non-blocking failure. */
  readonly advisories: readonly string[];
  readonly durationMs: number;
}

/** Per-identifier pass rates, over every sample of every case. */
export function ratesOf(cases: readonly CaseReport[]): readonly RateRow[] {
  const tally = new Map<string, { gating: boolean; passed: number; total: number }>();
  for (const one of cases) {
    for (const sample of one.samples) {
      for (const check of sample.checks) {
        const row = tally.get(check.id) ?? { gating: false, passed: 0, total: 0 };
        /**
         * `gating` is an OR across the corpus, not the first row's flag: a
         * check can gate on eleven cases and not on the twelfth — `no_refusal`
         * does exactly that — and printing it « souple » because the first
         * case it met was the exception would be the table lying.
         */
        tally.set(check.id, {
          gating: row.gating || check.gating,
          passed: row.passed + (check.passed ? 1 : 0),
          total: row.total + 1,
        });
      }
    }
  }
  return [...tally.entries()]
    .map(([id, row]) => ({ id, gating: row.gating, passed: row.passed, total: row.total }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * The checks that failed WITHOUT blocking, counted per identifier.
 *
 * They exist because a report that only printed the gate would hide the thing
 * section 5 bis of `docs/RECETTE.md` asks about: what did I not look at? A
 * soft heuristic drifting from two failures to twelve is a signal, and it is
 * invisible if nothing prints it.
 */
export function advisoriesOf(cases: readonly CaseReport[]): readonly string[] {
  const tally = new Map<string, number>();
  for (const one of cases) {
    for (const sample of one.samples) {
      for (const check of sample.checks) {
        if (check.passed || check.gating) continue;
        tally.set(check.id, (tally.get(check.id) ?? 0) + 1);
      }
    }
  }
  return [...tally.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([id, count]) => `${id} (${String(count)})`);
}

/** Every blocking failure, as the line the report prints and the exit code counts. */
export function failuresOf(
  cases: readonly CaseReport[],
  chronicle: ChronicleVerdict,
  blindness: BlindnessVerdict,
): readonly string[] {
  const out: string[] = [];
  for (const one of cases) {
    if (!one.requestMatches) {
      const lines = one.requestDiff
        .map(
          (line) =>
            `      ligne ${String(line.line)}${line.column === null ? '' : `, colonne ${String(line.column)}`}` +
            `\n        enregistré : ${line.recorded ?? '(absent)'}` +
            `\n        construit  : ${line.built ?? '(absent)'}`,
        )
        .join('\n');
      out.push(`${one.id} · instantané de requête\n${lines}`);
    }
    for (const sample of one.samples) {
      for (const check of sample.checks) {
        if (check.passed || !check.gating) continue;
        out.push(`${one.id} · échantillon ${String(sample.index)} · ${check.id} — ${check.detail}`);
      }
    }
  }
  for (const violation of chronicle.violations) {
    out.push(`chronique · ${violation.check} — ${violation.detail}`);
  }
  if (!blindness.ok) out.push(`refusal_is_outcome_blind — ${blindness.detail}`);
  return out;
}

const bar = (row: RateRow): string => {
  const mark = row.passed === row.total ? '·' : '!';
  const kind = row.gating ? 'dure ' : 'souple';
  return `  ${mark} ${row.id.padEnd(26)} ${kind}  ${String(row.passed)}/${String(row.total)}`;
};

export function formatReport(report: OfflineReport): string {
  const lines: string[] = [
    '',
    `Éval hors ligne (N0) — ${report.promptVersion}`,
    `${String(report.caseCount)} cas, ${String(report.sampleCount)} échantillons, aucun appel réseau, ${String(report.durationMs)} ms`,
    '',
  ];

  lines.push(
    `Chronique : ${report.chronicle.ok ? 'les neuf contrôles passent' : 'violations'} — ${String(report.chronicle.tokenCount)} tokens estimés`,
  );
  lines.push(`Aveuglement du refus : ${report.blindness.detail}`);
  lines.push('');

  lines.push('Taux par assertion');
  for (const row of report.rates) lines.push(bar(row));
  lines.push('');

  if (report.advisories.length > 0) {
    lines.push(`Signalé sans bloquer : ${report.advisories.join(', ')}`);
    lines.push('');
  }

  if (report.failures.length === 0) {
    lines.push('Aucun défaut bloquant.');
  } else {
    lines.push(`${String(report.failures.length)} défaut(s) bloquant(s) :`);
    for (const failure of report.failures) lines.push(`  ${failure}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** The shape written to `eval-report.json`, in snake_case like every fixture. */
export function reportJson(report: OfflineReport): unknown {
  return {
    ok: report.ok,
    prompt_version: report.promptVersion,
    case_count: report.caseCount,
    sample_count: report.sampleCount,
    duration_ms: report.durationMs,
    chronicle: {
      ok: report.chronicle.ok,
      token_count: report.chronicle.tokenCount,
      violations: report.chronicle.violations,
    },
    refusal_blindness: {
      ok: report.blindness.ok,
      straight: report.blindness.straight,
      inverted: report.blindness.inverted,
      diverged: report.blindness.diverged,
      detail: report.blindness.detail,
    },
    rates: report.rates,
    advisories: report.advisories,
    cases: report.cases.map((one) => ({
      id: one.id,
      title: one.title,
      tags: one.tags,
      request_matches: one.requestMatches,
      request_diff: one.requestDiff,
      samples: one.samples.map((sample) => ({ index: sample.index, checks: sample.checks })),
    })),
    failures: report.failures,
  };
}
