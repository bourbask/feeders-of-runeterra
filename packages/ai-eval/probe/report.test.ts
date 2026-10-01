import { describe, expect, it } from 'vitest';

import { formatProbeReport, frPercent, median, type ProbeReport, type RuleRate } from './report.js';

const rule = (over: Partial<RuleRate> & Pick<RuleRate, 'id'>): RuleRate => ({
  applicable: 12,
  passed: 12,
  failed: 0,
  notApplicable: 0,
  rate: 1,
  firstFailure: '',
  ...over,
});

const report = (over: Partial<ProbeReport> = {}): ProbeReport => ({
  promptVersion: 'conteur/9.9.9',
  promptFingerprint: 'abcdef012345',
  promptEstimatedTokens: 2394,
  caseIds: ['a', 'b'],
  samplesPerCase: 2,
  hardRuleIds: ['no_digits', 'scene_block_consistent'],
  providers: [
    {
      providerId: 'ollama',
      label: 'ollama · modele-x',
      model: 'modele-x',
      capabilities: {
        streaming: true,
        tools: false,
        structuredOutput: true,
        promptCache: false,
        contextWindowTokens: 8192,
        maxCacheBreakpoints: 0,
      },
      toolProbe: { ran: true, toolCallSeen: false, detail: 'aucun appel (fin « complete »)' },
      calls: 4,
      answered: 4,
      failures: [],
      readingFacts: {
        samples: 4,
        sceneBlockPresent: 0,
        proseEmpty: 0,
        proseTruncated: 0,
        finishTruncated: 2,
      },
      tokens: {
        estimatedInput: 3755,
        measuredInput: 4000,
        driftPct: -6.125,
        charsPerToken: 3.38,
        worstTrimLevel: 0,
        overflowCases: [],
      },
      medianLatencyMs: 21000,
      rates: [
        rule({ id: 'no_digits', passed: 9, failed: 3, rate: 0.75, firstFailure: 'chiffre : 3' }),
        rule({
          id: 'scene_block_consistent',
          applicable: 0,
          passed: 0,
          notApplicable: 12,
          rate: null,
        }),
      ],
    },
  ],
  ...over,
});

describe('le rapport de la sonde', () => {
  it('écrit une ligne par (fournisseur, assertion, taux)', () => {
    const lines = formatProbeReport(report()).split('\n');
    expect(lines.some((line) => /ollama · modele-x\s+no_digits\s+75\u202f%/u.test(line))).toBe(
      true,
    );
  });

  it('une règle jamais applicable s’écrit « sans objet », pas 100 %', () => {
    const text = formatProbeReport(report());
    const line = text.split('\n').find((entry) => entry.includes('scene_block_consistent'))!;
    expect(line).toContain('sans objet');
    expect(line).not.toContain('100');
    expect(frPercent(null)).toBe('sans objet');
  });

  it('lit le nombre de règles dans le sommaire, il ne l’écrit pas', () => {
    expect(formatProbeReport(report())).toContain('2 assertions dures');
    expect(formatProbeReport(report({ hardRuleIds: ['no_digits'] }))).toContain(
      '1 assertions dures',
    );
  });

  it('publie la matrice de capacités et le résultat de la sonde d’outils', () => {
    const text = formatProbeReport(report());
    expect(text).toContain('matrice de capacités');
    expect(text).toContain('8 192');
    expect(text).toContain('aucun appel');
  });

  it('dit ce que les seize règles ne voient pas : le bloc, la prose vide, les appels perdus', () => {
    const text = formatProbeReport(report());
    expect(text).toContain('bloc <scene_apres> 0/4');
    expect(text).toContain('appels répondus 4/4');
    // The provider cut the answer short: not our own prose bound, and the
    // difference is what tells « this model is terse » from « this adapter
    // left it no room ».
    expect(text).toContain('réponse coupée par le fournisseur 2/4');
  });

  it('dit l’appel d’outil observé, les appels perdus et le débordement de contexte', () => {
    const text = formatProbeReport(
      report({
        providers: [
          {
            ...report().providers[0]!,
            toolProbe: {
              ran: true,
              toolCallSeen: true,
              detail: 'appel observé : check_name_allowed',
            },
            calls: 4,
            answered: 3,
            failures: [{ caseId: 'a', sample: 2, code: 'timeout', message: 'coupé à 300 s' }],
            tokens: {
              estimatedInput: 5000,
              measuredInput: null,
              driftPct: null,
              charsPerToken: null,
              worstTrimLevel: 8,
              overflowCases: ['a', 'b'],
            },
            medianLatencyMs: null,
          },
        ],
      }),
    );
    expect(text).toContain('appel observé');
    expect(text).toContain('échec a#2 : timeout');
    expect(text).toContain('DÉBORDEMENT : a, b');
    expect(text).toContain('échelle T8');
  });

  it('ne porte ni horodatage ni durée : deux exécutions du stub rendent les mêmes octets', () => {
    expect(formatProbeReport(report())).toBe(formatProbeReport(report()));
    expect(formatProbeReport(report())).not.toMatch(/20\d\d-\d\d-\d\d/u);
  });

  it('la médiane d’un tableau vide est nulle, pas zéro', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});
