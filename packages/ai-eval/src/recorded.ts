/**
 * The second of the two N0 checks: THE RECORDED OUTPUTS (section 8.5, point 2).
 *
 * ── ZERO NETWORK CALLS, AND THE TYPE SAYS SO ────────────────────────────────
 * Nothing in this file, and nothing `run-offline.ts` reaches through it, can
 * speak to a provider: a recording is a string on disk. `record.ts` is the one
 * file of this package that holds a port, and it is never imported by the
 * offline runner. Held by `run-offline.test.ts` « le runner hors ligne
 * n'importe jamais le port du conteur », which reads the module graph rather
 * than trusting this paragraph.
 *
 * ── WHAT GATES, AND WHAT MERELY DESCRIBES ───────────────────────────────────
 * `prompt_version` GATES: section 8.5, « N0 échoue si `prompt_version`
 * enregistré ≠ `prompt_version` courant » — it is what makes it impossible to
 * change a prompt without passing once through a recording. `provider` and
 * `model` are DESCRIPTIVE, « jamais une porte », so that a sample recorded on
 * a free local model is as usable as one from a paid API.
 *
 * `tools_version` is recorded and NOT gated, and the reason is reported rather
 * than hidden: since ADR 0011 the request carries `tools: []`, so bumping
 * `TOOLS_VERSION` moves no byte of any request and no byte of any output.
 * Gating on it would force a re-recording — a network cost — for a change that
 * cannot have affected what was recorded. Section 8.5 names `prompt_version`
 * alone, and this harness does the same.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EvalCaseError } from './cases.js';

/** Section 8.5: two samples per case, captured by `eval:record`. */
export const SAMPLES_PER_CASE = 2;

export interface RecordedSample {
  /** The model's whole answer: prose, then `<scene_apres>` when it wrote one. */
  readonly response: string;
  /** Tool names actually called. Empty in prose-only mode (ADR 0011). */
  readonly toolCalls: readonly string[];
}

export interface RecordedCase {
  readonly caseId: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly toolsVersion: string;
  readonly recordedAt: string;
  readonly samples: readonly RecordedSample[];
}

const record = (value: unknown, where: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EvalCaseError(`${where} : un objet est attendu`);
  }
  return value as Record<string, unknown>;
};

const text = (holder: Record<string, unknown>, key: string, where: string): string => {
  const value = holder[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new EvalCaseError(`${where} : le champ « ${key} » doit être une chaîne non vide`);
  }
  return value;
};

export function parseRecorded(raw: unknown, where: string): RecordedCase {
  const root = record(raw, where);
  const samples = root['samples'];
  if (!Array.isArray(samples) || samples.length !== SAMPLES_PER_CASE) {
    throw new EvalCaseError(
      `${where} : ${String(SAMPLES_PER_CASE)} échantillons attendus, ${String(Array.isArray(samples) ? samples.length : 0)} trouvé(s)`,
    );
  }
  return {
    caseId: text(root, 'case_id', where),
    provider: text(root, 'provider', where),
    model: text(root, 'model', where),
    promptVersion: text(root, 'prompt_version', where),
    toolsVersion: text(root, 'tools_version', where),
    recordedAt: text(root, 'recorded_at', where),
    samples: samples.map((entry, index) => {
      const at = `${where}.samples[${String(index)}]`;
      const item = record(entry, at);
      const calls = item['tool_calls'];
      if (!Array.isArray(calls)) throw new EvalCaseError(`${at}.tool_calls : tableau attendu`);
      return {
        response: text(item, 'response', at),
        toolCalls: calls.map((name, position) => {
          if (typeof name !== 'string' || name.length === 0) {
            throw new EvalCaseError(`${at}.tool_calls[${String(position)}] : chaîne attendue`);
          }
          return name;
        }),
      };
    }),
  };
}

/** Read `<dir>/<id>.recorded.json`. A missing file is a failure, never a skip. */
export function loadRecorded(caseId: string, dir: string): RecordedCase {
  const path = join(dir, `${caseId}.recorded.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new EvalCaseError(
      `${caseId}.recorded.json : illisible (${cause instanceof Error ? cause.message : 'inconnu'})`,
    );
  }
  const recorded = parseRecorded(parsed, `${caseId}.recorded.json`);
  if (recorded.caseId !== caseId) {
    throw new EvalCaseError(
      `${caseId}.recorded.json : case_id « ${recorded.caseId} » ne nomme pas son fichier`,
    );
  }
  return recorded;
}
