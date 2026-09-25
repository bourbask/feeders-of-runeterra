/**
 * Reading a forge answer (02-mj-ia.md section 9.5).
 *
 * The seam between what a provider returned — pure JSON when it can do
 * structured output, JSON wrapped in prose when it cannot (section 0.2) — and
 * the twelve rules no provider enforces (V1 → V12).
 *
 * PURE AND NON-THROWING, unlike `narrator/structured.ts`'s
 * `extractAndValidate`, which raises a `NarratorError` because it sits on the
 * adapter side. Here a malformed answer is a `retry` finding — held by
 * tests/outputs.test.ts « readForgeAnswer extrait le JSON d'une réponse
 * bavarde, et ne lève jamais », which feeds it prose, broken braces and
 * balanced-but-invalid JSON. Spending the two retries and writing
 * `status: 'draft'` is `@for/server`'s, not this file's.
 */

import {
  validateForge,
  type ForgeValidation,
  type ForgeValidationInput,
} from '../forge/validate.js';
import { firstBalancedObject } from '../narrator/structured.js';

export function readForgeAnswer(
  text: string,
  input: Omit<ForgeValidationInput, 'raw'>,
): ForgeValidation {
  const raw = firstBalancedObject(text);
  if (raw === null) {
    return {
      action: 'retry',
      findings: [{ check: 'V12', action: 'retry', detail: 'aucun objet JSON dans la réponse' }],
      sheet: null,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      action: 'retry',
      findings: [{ check: 'V12', action: 'retry', detail: 'JSON invalide' }],
      sheet: null,
    };
  }
  return validateForge({ ...input, raw: parsed });
}
