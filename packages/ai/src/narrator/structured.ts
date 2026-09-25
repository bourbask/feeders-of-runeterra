/**
 * Getting a validated value out of a model's answer (02-mj-ia.md section 0.2).
 *
 * `structurer()` NEVER returns an unvalidated value — its signature is the
 * guarantee, and this is the one place that can honour it. Two failures take
 * exactly the same road, deliberately: JSON that does not parse, and JSON that
 * parses but does not match the schema. Both end in `invalid_output`, and what
 * happens next is the caller's business by purpose (a forge sheet goes to
 * `draft`, a stale chronicle stays in service, a judge case goes unscored).
 *
 * "First BALANCED object" rather than a regular expression: a model that
 * explains itself before the JSON, or wraps it in a fence, is the ordinary
 * case on a poor provider, and a greedy or lazy pattern gets a nested object
 * wrong in both directions.
 */

import { NarratorError, type NarratorProviderId } from '@for/contracts';
import type { z } from 'zod';

/** The first balanced `{...}` of a string, ignoring braces inside strings. */
export function firstBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let at = start; at < text.length; at += 1) {
    const ch = text[at];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, at + 1);
    }
  }
  return null;
}

export function extractAndValidate<T>(
  schema: z.ZodType<T>,
  text: string,
  providerId: NarratorProviderId,
): T {
  const raw = firstBalancedObject(text);
  if (raw === null) {
    throw new NarratorError({
      code: 'invalid_output',
      providerId,
      message: 'no JSON object in the answer',
      providerDetail: text.slice(0, 2000),
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new NarratorError({
      code: 'invalid_output',
      providerId,
      message: 'the JSON object does not parse',
      providerDetail: raw.slice(0, 2000),
    });
  }
  const checked = schema.safeParse(parsed);
  if (!checked.success) {
    throw new NarratorError({
      code: 'invalid_output',
      providerId,
      message: 'the value does not match the schema',
      providerDetail: JSON.stringify(checked.error.issues).slice(0, 2000),
    });
  }
  return checked.data;
}
