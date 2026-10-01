import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTEUR_PROMPT_VERSION } from '@for/ai';
import { afterEach, describe, expect, it } from 'vitest';

import { CASES_DIR, EvalCaseError, loadCases } from './cases.js';
import { loadRecorded, parseRecorded, SAMPLES_PER_CASE } from './recorded.js';

const made: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'for-m027-recorded-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const body = (over: Record<string, unknown> = {}): unknown => ({
  case_id: '01-issue-franche',
  provider: 'stub',
  model: 'un-modele',
  prompt_version: CONTEUR_PROMPT_VERSION,
  tools_version: 'tools/1.0.0',
  recorded_at: '2026-09-30T00:00:00.000Z',
  samples: [
    { response: 'Tu montes.', tool_calls: [] },
    { response: 'Tu montes encore.', tool_calls: [] },
  ],
  ...over,
});

describe('les sorties enregistrées', () => {
  it('exigent exactement deux échantillons — la section 8.5 fixe n égal à deux', () => {
    expect(SAMPLES_PER_CASE).toBe(2);
    expect(() =>
      parseRecorded(body({ samples: [{ response: 'x', tool_calls: [] }] }), 'x.json'),
    ).toThrow(/échantillons attendus/u);
  });

  it('refusent un case_id qui ne nomme pas son fichier', () => {
    const dir = scratch();
    writeFileSync(
      join(dir, '01-issue-franche.recorded.json'),
      JSON.stringify(body({ case_id: 'autre-cas' })),
      'utf8',
    );
    expect(() => loadRecorded('01-issue-franche', dir)).toThrow(/ne nomme pas son fichier/u);
  });

  it('refusent un fichier absent plutôt que de sauter le cas', () => {
    expect(() => loadRecorded('01-issue-franche', scratch())).toThrow(EvalCaseError);
  });

  it('du corpus livré portent la version de prompt courante', () => {
    for (const one of loadCases(CASES_DIR)) {
      expect(loadRecorded(one.id, CASES_DIR).promptVersion).toBe(CONTEUR_PROMPT_VERSION);
    }
  });

  it('et deux échantillons distincts par cas — un seul texte dupliqué ne mesure qu’une fois', () => {
    for (const one of loadCases(CASES_DIR)) {
      const [first, second] = loadRecorded(one.id, CASES_DIR).samples;
      expect(first?.response).not.toBe(second?.response);
    }
  });
});
