/**
 * The storyteller port, re-exported (02-mj-ia.md section 0.1).
 *
 * The TYPES live in `@for/contracts` and the ADAPTERS live here
 * (ARCHITECTURE.md section 4.3). This file is the seam: everything inside
 * `@for/ai` imports the port from here, so the day the port moves, one file
 * changes instead of twenty.
 *
 * `NarratorError` is re-exported as a VALUE because adapters throw it and
 * tests catch it; the rest is type-only.
 */

export {
  NARRATE_FINISHES,
  NARRATOR_ERROR_CODES,
  NARRATOR_PROVIDER_IDS,
  NARRATOR_PURPOSES,
  NARRATOR_RETRYABLE_ERROR_CODES,
  NARRATOR_TOOLS_MODES,
  NarratorError,
  isRetryableNarratorErrorCode,
} from '@for/contracts';

export type {
  JsonSchemaObject,
  NarrateEvent,
  NarrateFinish,
  NarrateRequest,
  NarrateResult,
  NarratorBlock,
  NarratorCacheHint,
  NarratorCapabilities,
  NarratorConfig,
  NarratorEffort,
  NarratorErrorCode,
  NarratorErrorInit,
  NarratorMessage,
  NarratorPort,
  NarratorProviderId,
  NarratorPurpose,
  NarratorStructuredPurpose,
  NarratorTextBlock,
  NarratorToolPolicy,
  NarratorToolResultBlock,
  NarratorToolSpec,
  NarratorToolUseBlock,
  NarratorToolsMode,
  NarratorUsage,
  StructureRequest,
  StructureResult,
} from '@for/contracts';
