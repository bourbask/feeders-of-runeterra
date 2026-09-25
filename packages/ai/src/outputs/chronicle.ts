/**
 * Reading a chronicle answer (02-mj-ia.md section 5.6).
 *
 * Same seam as the forge, and the same reason for not throwing: a chronicle
 * one session out of date is an inconvenience, and the game continues. NOT
 * THROWING is what this file guarantees, and it is held by
 * tests/outputs.test.ts « readChronicleAnswer ne lève jamais, même sur du
 * bruit ». Keeping the previous version in service and logging
 * `chronicle_regeneration_failed` are the caller's, in `@for/server`.
 */

import {
  validateChronicle,
  type ChronicleValidation,
  type ChronicleValidationInput,
} from '../chronicle/validate.js';
import { firstBalancedObject } from '../narrator/structured.js';

export function readChronicleAnswer(
  text: string,
  input: Omit<ChronicleValidationInput, 'doc'>,
): ChronicleValidation {
  const raw = firstBalancedObject(text);
  if (raw === null) {
    return {
      ok: false,
      violations: [{ check: 'C1', detail: 'aucun objet JSON dans la réponse', offenders: [] }],
      doc: null,
      tokenCount: 0,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      ok: false,
      violations: [{ check: 'C1', detail: 'JSON invalide', offenders: [] }],
      doc: null,
      tokenCount: 0,
    };
  }
  return validateChronicle({ ...input, doc: parsed });
}
