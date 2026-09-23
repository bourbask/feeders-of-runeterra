/**
 * `zRuleViolation` — an intent the rules refuse.
 *
 * A code and machine details, NO HUMAN TEXT: the engine does not speak French.
 * The client maps a code to a sentence (01-architecture.md section 3.3). The
 * details are scalars only, because they are serialised and logged.
 */

import { z } from 'zod';

import type { RuleViolation, ViolationDetails } from '@for/engine';

import { zRuleViolationCode } from './enums.js';

export const zViolationDetails = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
) satisfies z.ZodType<ViolationDetails>;

export const zRuleViolation = z.object({
  code: zRuleViolationCode,
  details: zViolationDetails,
}) satisfies z.ZodType<RuleViolation>;

export type RuleViolationDto = z.output<typeof zRuleViolation>;
