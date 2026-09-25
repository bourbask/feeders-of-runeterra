/**
 * The verdict, for a human, in fewer than twenty lines (M0-32).
 *
 * WHAT THE ORDER IS FOR. The sheet fixes it: provider, exact model name,
 * number of calls, `n / <loaded>` checks passed, then the fallen ones with an
 * excerpt. A tester reads stdout and knows what to do without opening a JSON.
 *
 * `<loaded>` IS READ FROM THE SUMMARY, never written here. A constant in the
 * report would go on printing `/ 7` after somebody deleted a check — the
 * report would then be the last thing still claiming seven.
 * `report.test.ts` « le total vient du sommaire, pas du rapport » passes a
 * summary whose total is six and expects `/ 6`.
 *
 * NO DURATION, NO TIMESTAMP. Two runs of the deterministic stub must give the
 * same verdict character for character; a millisecond count would make that
 * criterion unmeetable and nothing else would notice.
 */

export interface SmokeFallenCheck {
  readonly id: string;
  readonly failedSamples: number;
  /** Excerpt of the first offending output. One line, already truncated. */
  readonly detail: string;
}

export interface SmokeSummary {
  readonly promptVersion: string;
  readonly promptFingerprint: string;
  readonly promptEstimatedTokens: number;
  readonly providerId: string;
  /** Raw provider identifier, as it came back from the call. */
  readonly model: string;
  readonly caseCount: number;
  readonly samplesPerCase: number;
  readonly callCount: number;
  /** How many checks were actually loaded. */
  readonly checkTotal: number;
  readonly fallen: readonly SmokeFallenCheck[];
  readonly estimatedInputTokens: number;
  /** Null when the provider reports no input count. */
  readonly measuredInputTokens: number | null;
}

/** Narrow no-break space every three digits, as French writes them. */
export function frNumber(value: number): string {
  return String(Math.round(value)).replaceAll(/\B(?=(\d{3})+(?!\d))/gu, ' ');
}

const label = (name: string): string => name.padEnd(12, ' ');

export function formatReport(summary: SmokeSummary): string {
  const passed = summary.checkTotal - summary.fallen.length;
  const lines: string[] = [
    `sonde de fumée — ${summary.promptVersion}`,
    `${label('fournisseur')}: ${summary.providerId}`,
    `${label('modèle')}: ${summary.model.length === 0 ? '(non renvoyé par le fournisseur)' : summary.model}`,
    `${label('appels')}: ${frNumber(summary.callCount)} (${frNumber(summary.caseCount)} cas × ${frNumber(summary.samplesPerCase)} échantillons)`,
    `${label('assertions')}: ${frNumber(passed)} / ${frNumber(summary.checkTotal)}`,
  ];
  if (summary.fallen.length === 0) {
    lines.push(`${label('tombées')}: aucune`);
  } else {
    lines.push('tombées :');
    for (const check of summary.fallen) {
      lines.push(
        `  - ${check.id} (${frNumber(check.failedSamples)}/${frNumber(summary.callCount)}) — ${check.detail}`,
      );
    }
  }
  lines.push(
    `${label('prompt')}: empreinte ${summary.promptFingerprint} · ${frNumber(summary.promptEstimatedTokens)} t estimés`,
    `${label('entrée')}: ${
      summary.measuredInputTokens === null
        ? 'non comptée par le fournisseur'
        : `${frNumber(summary.measuredInputTokens)} t mesurés (médiane)`
    } · ${frNumber(summary.estimatedInputTokens)} t estimés (médiane)`,
    `${label('verdict')}: ${verdict(summary)}`,
  );
  return lines.join('\n');
}

function verdict(summary: SmokeSummary): string {
  if (summary.providerId === 'stub') {
    return 'le stub n\u2019est pas un modèle : ce verdict exerce le harnais, il ne mesure rien.';
  }
  if (summary.fallen.length === 0) return 'le prompt contraint tient sur ce fournisseur.';
  return `le prompt contraint ne tient pas : ${frNumber(summary.fallen.length)} règle(s) sur ${frNumber(summary.checkTotal)}.`;
}
