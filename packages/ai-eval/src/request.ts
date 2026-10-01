/**
 * The first of the two N0 checks: THE SNAPSHOT OF THE BUILT REQUEST
 * (02-mj-ia.md section 8.5, point 1).
 *
 * ── WHAT IS COMPARED, AND WHY IT IS THE PORT'S REQUEST ──────────────────────
 * `NarrateRequest` — the type of the PORT. Not an HTTP body, not a provider
 * payload, nothing an adapter touches. That is the whole of the acceptance
 * criterion « sans rien qui dépende d'un fournisseur » : if swapping
 * `NARRATOR_PROVIDER` moved one of these files, a vendor detail would have
 * leaked above the port, and this snapshot is where it shows. Held by
 * `request.test.ts` « les quatre fournisseurs rendent les mêmes octets ».
 *
 * ── AND IT IS THE CACHE PREFIX IT PROTECTS ──────────────────────────────────
 * Section 4.2: most stable first, most volatile last. A reordering of the
 * messages, a changed template, a different serialisation — all of them move
 * the cacheable prefix of every campaign at once, and all of them show up as a
 * diff here before they show up on a bill.
 *
 * ── NOTHING VOLATILE IS NEUTRALISED, BECAUSE NOTHING VOLATILE ENTERS ────────
 * Section 8.5 allows « champs volatils neutralisés ». This harness has none to
 * neutralise: `requestId` is the case identifier, the abort signal is not
 * passed, and `buildNarrateRequest` reads no clock and no randomness. Saying
 * it here rather than writing a scrubber that would hide a real difference.
 */

import {
  buildCampaignBlock,
  buildNarrateRequest,
  CONTEUR_SYSTEM_PROMPT,
  renderChronicleParts,
} from '@for/ai';
import {
  zNarrationBrief,
  type NarrateRequest,
  type NarrationBriefDto,
  type SceneStateDto,
} from '@for/contracts';
import { stableStringify } from '@for/testkit';

import { EvalCaseError, type EvalCase } from './cases.js';
import type { EvalFixture } from './fixtures.js';

/**
 * The facts the audience perceives, derived from the scene the engine holds.
 *
 * Sorted by `ref.id` then `kind`, which is the order `@for/engine` produces
 * and the order `buildSceneBlock` preserves. Sorting here rather than trusting
 * the fixture's writing order is what keeps the rendered block byte-stable
 * when somebody reorders a JSON array.
 */
export function perceivableFactsOf(scene: SceneStateDto): NarrationBriefDto['perceivableFacts'] {
  const facts = [
    ...scene.present.map((entry) => ({
      kind: 'present' as const,
      ref: entry.ref,
      name: entry.name,
      detail: entry.state,
      sinceSeq: entry.sinceSeq,
    })),
    ...scene.absent.map((entry) => ({
      kind: 'absent' as const,
      ref: entry.ref,
      name: entry.name,
      detail: entry.cause,
      sinceSeq: entry.sinceSeq,
    })),
  ];
  return facts.sort((left, right) =>
    left.ref.id === right.ref.id
      ? left.kind.localeCompare(right.kind)
      : left.ref.id.localeCompare(right.ref.id),
  );
}

/**
 * Build the brief, and VALIDATE IT with the production schema.
 *
 * `zNarrationBrief.parse` is not decoration: it is the only thing that stops a
 * corpus from drifting into shapes the server could never produce — a move
 * identifier the engine does not have, an outcome outside the three, an
 * audience whose `recipients` disagrees with its `scope`. A fixture the server
 * would reject is a fixture that proves nothing about the server.
 */
export function briefOf(evalCase: EvalCase, outcomeOverride?: string): NarrationBriefDto {
  const { turn } = evalCase;
  const fact = turn.fact;
  const parsed = zNarrationBrief.safeParse({
    correlationId: turn.correlationId,
    sceneId: turn.sceneIn.sceneId,
    audience: { scope: 'table', recipients: null },
    perceivableFacts: perceivableFactsOf(turn.sceneIn),
    actorCharacterId: turn.actorCharacterId,
    moveId: fact.moveId,
    outcome: outcomeOverride ?? fact.outcome,
    isPresage: fact.isPresage,
    roll:
      fact.roll === null
        ? null
        : {
            rollId: fact.roll.rollId,
            attribute: fact.attribute,
            attributeValue: fact.roll.attributeValue,
            actionDie: fact.roll.actionDie,
            adds: fact.roll.adds,
            rawTotal: fact.roll.rawTotal,
            total: fact.roll.total,
            cappedAtTen: fact.roll.cappedAtTen,
            challengeDice: fact.roll.challengeDice,
            momentumNegated: fact.roll.momentumNegated,
            burned: fact.roll.burned,
          },
    /** See `EvalFact.effectSentences`: the rendered block reads the vocabulary. */
    appliedEffects: [],
    imposedPrice:
      fact.price === null
        ? null
        : {
            rollId: fact.price.rollId,
            tableId: fact.price.tableId,
            value: fact.price.value,
            entryId: fact.price.entryId,
            text: fact.price.text,
            severity: fact.price.severity,
            effectIndex: fact.price.effectIndex,
          },
    presage: fact.presage,
    playerInput: turn.intent,
    eventSeqs: fact.eventSeqs,
    fallbackTemplateId: fact.fallbackTemplateId,
  });
  if (!parsed.success) {
    throw new EvalCaseError(
      `${evalCase.id} : le brief ne passe pas zNarrationBrief — ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join(' ; ')}`,
    );
  }
  return parsed.data;
}

/** Assemble the request for one case, through the production builder. */
export function requestOf(evalCase: EvalCase, fixture: EvalFixture): NarrateRequest {
  const brief = briefOf(evalCase);
  const { request } = buildNarrateRequest({
    requestId: evalCase.id,
    brief,
    systemPrompt: CONTEUR_SYSTEM_PROMPT,
    campaignBlock: buildCampaignBlock(fixture.campaign),
    actorLabel: evalCase.turn.actorLabel,
    vocabulary: {
      moveLabel: evalCase.turn.fact.moveLabel,
      attributeLabel: evalCase.turn.fact.attributeLabel,
      outcomeLabel: evalCase.turn.fact.outcomeLabel,
      effectSentences: evalCase.turn.fact.effectSentences,
    },
    trimmable: {
      lore: fixture.lore,
      etat: fixture.etat,
      turns: fixture.turns,
      chronicle: renderChronicleParts(fixture.chronicle.doc, evalCase.turn.sceneIn),
    },
    contextWindowTokens: fixture.contextWindowTokens,
  });
  return request;
}

/** The bytes a `*.request.json` holds. Key order is normalised, so a reorder is not a diff. */
export const serialiseRequest = (request: NarrateRequest): string => stableStringify(request);

export interface RequestDiffLine {
  readonly line: number;
  /** 1-based column of the first differing character; `null` when a line is absent. */
  readonly column: number | null;
  /** The line, or a window around the difference when the line is long. */
  readonly recorded: string | null;
  readonly built: string | null;
}

/**
 * How much of a long line the diff shows on each side of the difference.
 *
 * MEASURED, NOT CHOSEN: the first version of this function printed whole
 * lines, and the probe « un caractère changé dans le prompt système » produced
 * two seven-thousand-character lines per case, twelve times over. The one
 * changed character was in there, and no reader would have found it — which is
 * exactly what the criterion « avec un diff de requête lisible » rules out.
 * The defect was in this harness, not in the prompt, and it is fixed here
 * rather than worked around in the report.
 */
export const DIFF_WINDOW = 60;

/** Cut a long line down to a window centred on `column`, marking the cuts. */
function window(line: string, column: number): string {
  if (line.length <= DIFF_WINDOW * 2) return line;
  const from = Math.max(0, column - DIFF_WINDOW);
  const to = Math.min(line.length, column + DIFF_WINDOW);
  return `${from > 0 ? '…' : ''}${line.slice(from, to)}${to < line.length ? '…' : ''}`;
}

/** The first column at which two strings differ, or their common length. */
function firstDifference(left: string, right: string): number {
  const shortest = Math.min(left.length, right.length);
  for (let at = 0; at < shortest; at += 1) {
    if (left[at] !== right[at]) return at;
  }
  return shortest;
}

/**
 * The first lines where the two serialisations part company.
 *
 * Line-based, capped, and WINDOWED: a system prompt is two thousand tokens on
 * a single JSON line, so the column of the first differing character is what
 * makes the difference findable.
 */
export function diffRequests(recorded: string, built: string, max = 5): readonly RequestDiffLine[] {
  const left = recorded.split('\n');
  const right = built.split('\n');
  const out: RequestDiffLine[] = [];
  for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
    if (left[at] === right[at]) continue;
    const before = left[at];
    const after = right[at];
    if (before === undefined || after === undefined) {
      out.push({ line: at + 1, column: null, recorded: before ?? null, built: after ?? null });
    } else {
      const column = firstDifference(before, after);
      out.push({
        line: at + 1,
        column: column + 1,
        recorded: window(before, column),
        built: window(after, column),
      });
    }
    if (out.length >= max) break;
  }
  return out;
}
