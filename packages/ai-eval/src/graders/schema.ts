/**
 * `schema` — the shape of the answer: the recording's own metadata, the
 * narration output schema, and the ten form checks.
 *
 * ── THE ONE CHECK THAT IS NOT AN ASSERTION ──────────────────────────────────
 * `prompt_version`. Section 8.5: « N0 échoue si `prompt_version` enregistré ≠
 * `prompt_version` courant » — this is what makes it impossible to change a
 * prompt without passing once through a recording, and therefore once through
 * a real provider. The current version is IMPORTED from `@for/ai`; comparing
 * the recording to a literal written here would be comparing a number to
 * itself one file later (ADR 0007).
 *
 * ── A MISSING BLOCK IS NOT A FAILURE, AND M0-32 MEASURED WHY ────────────────
 * Section 2.3: an absent, truncated or malformed `<scene_apres>` keeps the
 * previous scene state to the byte and lets the turn finish. M0-32 then
 * measured that on twenty-four samples from two free local models, NOT ONE
 * wrote the block at all. So the ordinary case in production will be the
 * absent block, and this grader REPORTS the reading's tags without failing on
 * them. Held by `schema.test.ts` « un bloc absent et un bloc malformé passent
 * tous les deux, et sont signalés ».
 */

import { CONTEUR_PROMPT_VERSION } from '@for/ai';
import { zNarrationOutput } from '@for/contracts';

import { runFamily, type Check, type Grader, type GraderInput } from './kit.js';

/** Section 8.4's main table and register table, the form half. */
export const SCHEMA_IDS: readonly string[] = [
  'sentence_count',
  'max_chars',
  'no_digits',
  'second_person_singular',
  'no_terminal_prompt',
  'language_fr',
  'no_ooc_lexicon',
  'tool_calls',
  'sentence_length_cap',
  'max_one_dialogue_line',
];

function versionCheck(input: GraderInput): Check {
  const same = input.recorded.promptVersion === CONTEUR_PROMPT_VERSION;
  return {
    id: 'prompt_version',
    passed: same,
    detail: same
      ? input.recorded.promptVersion
      : `enregistré ${input.recorded.promptVersion}, courant ${CONTEUR_PROMPT_VERSION} — relancer eval:record`,
    gating: true,
  };
}

/**
 * The prose and the block, through the production output schema.
 *
 * `zNarrationOutput` is `.strict()` and caps the prose at
 * `NARRATION_PROSE_MAX`. Running it here means a recorded sample that the
 * server could not have emitted is a failure of the corpus, not a surprise in
 * production.
 */
function outputCheck(input: GraderInput): Check {
  const parsed = zNarrationOutput.safeParse({
    prose: input.prose,
    sceneBlock: input.view.reading.block,
  });
  return {
    id: 'narration_output',
    passed: parsed.success,
    detail: parsed.success
      ? `prose de ${String(input.prose.length)} caractères`
      : parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join(' ; '),
    gating: true,
  };
}

function blockReadingCheck(input: GraderInput): Check {
  const { tags, rejectedBy } = input.view.reading;
  return {
    id: 'scene_block_reading',
    passed: true,
    detail:
      tags.length === 0
        ? 'bloc exploitable'
        : `${tags.join(', ')}${rejectedBy === null ? '' : ` (règle ${rejectedBy})`} — état de scène inchangé`,
    gating: false,
  };
}

export const schemaGrader: Grader = {
  name: 'schema',
  ids: SCHEMA_IDS,
  run: (input) => [
    versionCheck(input),
    outputCheck(input),
    blockReadingCheck(input),
    ...runFamily(SCHEMA_IDS, input),
  ],
};
