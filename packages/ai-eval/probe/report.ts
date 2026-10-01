/**
 * `probe-report.json` and the table a human reads (M0-31).
 *
 * ── ONE LINE IS `(fournisseur, assertion, taux)` ────────────────────────────
 * That is the sheet's shape, literally. Everything else on the page — the
 * capability matrix, the tool probe, the token drift — is there because the
 * sheet asks for it and because a rate with no idea of what was sent is a
 * number nobody can act on.
 *
 * ── THE DENOMINATOR IS THE APPLICABLE SAMPLES, NOT THE SAMPLES ──────────────
 * `grading.ts` explains why at length. Here it has one visible consequence:
 * a rule that was never applicable prints `—` and NOT `100 %`. A hundred per
 * cent on zero samples is the most expensive lie this report could tell, and
 * it is exactly the lie a local model that never writes `<scene_apres>` would
 * get away with. Held by `report.test.ts` « une règle jamais applicable
 * s'écrit « sans objet », pas 100 % ».
 *
 * ── NO TIMESTAMP, NO DURATION ───────────────────────────────────────────────
 * Same reason as the smoke report: two runs against the deterministic stub
 * must give the same bytes. The date of a measurement belongs to
 * `docs/runbook/conteur-fournisseurs.md`, which a human signs.
 *
 * ── THE TOTALS ARE READ FROM THE DATA, NEVER WRITTEN HERE ───────────────────
 * The number of rules, of cases and of samples all come off the summary. A
 * constant in the formatter would go on printing `/ 16` after somebody
 * removed a rule, and the report would be the last thing still claiming
 * sixteen. Held by `report.test.ts` « lit le nombre de règles dans le
 * sommaire, il ne l'écrit pas ».
 */

import type { NarratorCapabilities } from '@for/contracts';
import type { ToolProbeOutcome } from './tool-probe.js';

/** One rule, folded over every sample of one provider. */
export interface RuleRate {
  readonly id: string;
  readonly applicable: number;
  readonly passed: number;
  readonly failed: number;
  readonly notApplicable: number;
  /** Null when nothing was applicable: « sans objet », never a percentage. */
  readonly rate: number | null;
  /** The first offending excerpt, so a failure reads without the transcript. */
  readonly firstFailure: string;
}

/** A call that never produced an answer. Counted, named, and not scored. */
export interface ProbeCallFailure {
  readonly caseId: string;
  readonly sample: number;
  readonly code: string;
  readonly message: string;
}

/**
 * Facts about the ENVELOPE of the answer, not about its content.
 *
 * They are NOT assertions and are not counted among the sixteen. They are
 * here because the sixteen cannot see them: a model that returns an empty
 * string passes ten rules by writing nothing, and `<scene_apres>` is the one
 * structured output the whole prompt asks for.
 */
export interface ReadingFacts {
  readonly samples: number;
  readonly sceneBlockPresent: number;
  readonly proseEmpty: number;
  readonly proseTruncated: number;
  /**
   * Answers the PROVIDER cut short — `finish: 'truncated'`.
   *
   * Not the same thing as `proseTruncated`, which is our own safety bound on
   * `NARRATION_PROSE_MAX`. This one says the model never got to finish, and it
   * is the difference between « this model writes one sentence » and « this
   * adapter left it room for one sentence ». Measured on the
   * `openai-compatible` path, where no context-window hint is transmitted.
   */
  readonly finishTruncated: number;
}

/** Local estimator against the provider's own count (section 4.3, risk 6). */
export interface TokenMeasure {
  /** Median of `estimateTokens` over the built requests. */
  readonly estimatedInput: number;
  /** Median of what the provider counted; null when it counts nothing. */
  readonly measuredInput: number | null;
  /** `(estimated − measured) / measured`, in per cent. Null without a count. */
  readonly driftPct: number | null;
  /** Median characters per real token, over the samples that were counted. */
  readonly charsPerToken: number | null;
  /** How far the truncation ladder went, highest over the corpus. */
  readonly worstTrimLevel: number;
  readonly overflowCases: readonly string[];
}

export interface ProviderReport {
  readonly providerId: string;
  /** `provider · model`, the label every table row is keyed by. */
  readonly label: string;
  readonly model: string;
  readonly capabilities: NarratorCapabilities;
  readonly toolProbe: ToolProbeOutcome;
  readonly calls: number;
  readonly answered: number;
  readonly failures: readonly ProbeCallFailure[];
  readonly readingFacts: ReadingFacts;
  readonly tokens: TokenMeasure;
  readonly medianLatencyMs: number | null;
  readonly rates: readonly RuleRate[];
}

export interface ProbeReport {
  readonly promptVersion: string;
  readonly promptFingerprint: string;
  readonly promptEstimatedTokens: number;
  readonly caseIds: readonly string[];
  readonly samplesPerCase: number;
  /** The rule identifiers, IMPORTED from `@for/ai`, in declaration order. */
  readonly hardRuleIds: readonly string[];
  readonly providers: readonly ProviderReport[];
}

// ------------------------------------------------------------------ folding

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/** Narrow no-break space every three digits, as French writes them. */
export function frNumber(value: number): string {
  return String(Math.round(value)).replaceAll(/\B(?=(\d{3})+(?!\d))/gu, ' ');
}

export const frPercent = (rate: number | null): string =>
  rate === null ? 'sans objet' : `${(rate * 100).toFixed(0)}\u202f%`;

// ------------------------------------------------------------- the rendering

const pad = (value: string, width: number): string =>
  value.length >= width ? value : value + ' '.repeat(width - value.length);

const padLeft = (value: string, width: number): string =>
  value.length >= width ? value : ' '.repeat(width - value.length) + value;

function capabilityTable(report: ProbeReport): readonly string[] {
  const head = ['fournisseur', 'tools', 'struct.', 'cache', 'fenêtre', 'sonde outils'];
  const widths = [34, 6, 7, 6, 8, 44];
  const rows = report.providers.map((provider) => [
    provider.label,
    provider.capabilities.tools ? 'oui' : 'non',
    provider.capabilities.structuredOutput ? 'oui' : 'non',
    provider.capabilities.promptCache ? 'oui' : 'non',
    frNumber(provider.capabilities.contextWindowTokens),
    provider.toolProbe.ran
      ? provider.toolProbe.toolCallSeen
        ? `appel observé — ${provider.toolProbe.detail}`
        : `aucun appel — ${provider.toolProbe.detail}`
      : `non lancée — ${provider.toolProbe.detail}`,
  ]);
  return [
    'matrice de capacités',
    ...[head, ...rows].map((cells) =>
      cells
        .map((cell, index) => pad(cell, widths[index] ?? 10))
        .join(' ')
        .trimEnd(),
    ),
  ];
}

function rateTable(report: ProbeReport): readonly string[] {
  const lines = ['', 'taux par (fournisseur, assertion)'];
  lines.push(
    [pad('fournisseur', 34), pad('assertion', 24), padLeft('taux', 9), 'passées/applicables']
      .join(' ')
      .trimEnd(),
  );
  for (const provider of report.providers) {
    for (const rule of provider.rates) {
      lines.push(
        [
          pad(provider.label, 34),
          pad(rule.id, 24),
          padLeft(frPercent(rule.rate), 9),
          `${frNumber(rule.passed)}/${frNumber(rule.applicable)}`,
          rule.firstFailure.length === 0 ? '' : `— ${rule.firstFailure}`,
        ]
          .join(' ')
          .trimEnd(),
      );
    }
  }
  return lines;
}

function envelopeTable(report: ProbeReport): readonly string[] {
  const lines = ['', 'faits de lecture — ce que les seize règles ne voient pas'];
  for (const provider of report.providers) {
    const facts = provider.readingFacts;
    lines.push(
      `  ${provider.label} : bloc <scene_apres> ${frNumber(facts.sceneBlockPresent)}/${frNumber(facts.samples)}` +
        ` · prose vide ${frNumber(facts.proseEmpty)}/${frNumber(facts.samples)}` +
        ` · prose tronquée ${frNumber(facts.proseTruncated)}/${frNumber(facts.samples)}` +
        ` · réponse coupée par le fournisseur ${frNumber(facts.finishTruncated)}/${frNumber(facts.samples)}` +
        ` · appels répondus ${frNumber(provider.answered)}/${frNumber(provider.calls)}`,
    );
    for (const failure of provider.failures) {
      lines.push(
        `      échec ${failure.caseId}#${frNumber(failure.sample)} : ${failure.code} — ${failure.message}`,
      );
    }
  }
  return lines;
}

function tokenTable(report: ProbeReport): readonly string[] {
  const lines = ['', 'entrée par tour — estimateur local contre compteur du fournisseur'];
  for (const provider of report.providers) {
    const tokens = provider.tokens;
    lines.push(
      `  ${provider.label} : estimé ${frNumber(tokens.estimatedInput)}` +
        ` · mesuré ${tokens.measuredInput === null ? 'non compté' : frNumber(tokens.measuredInput)}` +
        ` · écart ${tokens.driftPct === null ? '—' : `${tokens.driftPct.toFixed(1)}\u202f%`}` +
        ` · caractères par token réel ${tokens.charsPerToken === null ? '—' : tokens.charsPerToken.toFixed(2)}` +
        ` · échelle T${frNumber(tokens.worstTrimLevel)}` +
        (tokens.overflowCases.length === 0
          ? ''
          : ` · DÉBORDEMENT : ${tokens.overflowCases.join(', ')}`) +
        ` · latence médiane ${provider.medianLatencyMs === null ? '—' : `${frNumber(provider.medianLatencyMs / 1000)} s`}`,
    );
  }
  return lines;
}

export function formatProbeReport(report: ProbeReport): string {
  const head = [
    `sonde de fournisseurs — ${report.promptVersion} (empreinte ${report.promptFingerprint}, ${frNumber(report.promptEstimatedTokens)} t estimés)`,
    `corpus : ${frNumber(report.caseIds.length)} cas × ${frNumber(report.samplesPerCase)} échantillons · ${frNumber(report.hardRuleIds.length)} assertions dures importées de @for/ai`,
    `cas : ${report.caseIds.join(', ')}`,
    '',
  ];
  return [
    ...head,
    ...capabilityTable(report),
    ...rateTable(report),
    ...envelopeTable(report),
    ...tokenTable(report),
  ].join('\n');
}
