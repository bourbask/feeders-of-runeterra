/**
 * The context builder — one turn, assembled (02-mj-ia.md section 4.1, as
 * amended by ADR 0011).
 *
 * ── PROSE-ONLY MODE, AND WHAT IT IS FOR ─────────────────────────────────────
 * `tools: []`, `toolPolicy: 'none'`, on every turn. Not a degradation path: in
 * M0 it is the ONLY mode. The frozen table weighed 2 112 tokens — announced at
 * 900 — and tool calling is what small models miss most often. The engine
 * already decides everything; the storyteller dresses a settled fact. Removing
 * the tools removes the last decision it was being handed, which is exactly
 * what ADR 0011 asks for.
 *
 * `tests/context-budget.test.ts` holds it: the assembled request carries no
 * tool definition, and no tool NAME either, anywhere in its bytes.
 *
 * ── THE `<scene>` BLOCK COMES FROM THE BRIEF ────────────────────────────────
 * ADR 0008 decision 3, and it is MECHANICAL. This function has no `SceneState`
 * parameter and no `CampaignState` parameter, so the only presence facts it
 * can render are the ones the engine computed FOR THIS RECIPIENT. Filtering
 * the model's output instead would be too late — the information would already
 * be in its context window. Held by `tests/context-budget.test.ts`, « ce que
 * l'état porte et que la liste ne porte pas n'entre pas dans la requête », and
 * by `tests/scene-channel.test.ts` one level down.
 *
 * ── THE ORDER IS THE CACHE ──────────────────────────────────────────────────
 * Section 4.1 and 4.2: most stable first, most volatile last, four cache
 * hints and no more. The order below is not a style choice; changing it moves
 * the cacheable prefix of every campaign at once. Held by
 * tests/context-budget.test.ts « l'ordre des messages est celui du §4.1 ».
 *
 * ── THE FOUR UNTOUCHABLE BLOCKS ─────────────────────────────────────────────
 * `<fait>`, `<intention>`, `<scene>` and the system prompt are passed to
 * `applyTrimLadder` as `FixedContext`, which the ladder weighs and cannot
 * cut. Section 4.4 calls them intouchables par définition; here that is a
 * type — and a type is checked at compile time only, so it is doubled at run
 * time by tests/context-budget.test.ts « ne touche jamais <fait>,
 * <intention>, <scene> ni le prompt système ».
 */

import type {
  NarrateRequest,
  NarrationBriefDto,
  NarratorMessage,
  NarratorTextBlock,
} from '@for/contracts';

import { estimateTokens } from '../prompts/estimate.js';
import { buildSceneBlock } from '../prompts/scene.block.js';
import {
  SEGMENT_CEILINGS,
  TURN_OUTPUT_TOKENS,
  applyTrimLadder,
  renderChronicle,
  renderEtat,
  turnBudget,
  type FixedContext,
  type TrimOutcome,
  type TrimmableContext,
} from './budget.js';
import {
  buildConsignesBlock,
  buildFactBlock,
  buildIntentionBlock,
  type FactVocabulary,
} from './fact.js';

/** Section 4.1, message 2: a short anchor, never displayed. */
export const CHRONICLE_ANCHOR = 'Compris.';

export interface BuildContextInput {
  /** `requestId` = `narrationId`, the key of `ai_calls`. */
  readonly requestId: string;
  readonly brief: NarrationBriefDto;
  /** `system[0]`, frozen. */
  readonly systemPrompt: string;
  /** `system[1]`, per campaign. Truncated here to its ceiling. */
  readonly campaignBlock: string;
  /** The acting character's name, as the projection holds it. */
  readonly actorLabel: string;
  readonly vocabulary: FactVocabulary;
  /** Everything the ladder may cut. */
  readonly trimmable: TrimmableContext;
  /** `capabilities.contextWindowTokens` of the port in use. */
  readonly contextWindowTokens: number;
  readonly abortSignal?: AbortSignal | undefined;
}

export interface BuiltContext {
  readonly request: NarrateRequest;
  /** Goes to `ai_calls.trim_level`. */
  readonly trim: TrimOutcome;
}

/**
 * Cut a block to a token ceiling, on a line boundary.
 *
 * Section 4.3 marks `system[1]` « tronqué par le constructeur » — the only
 * block this function is allowed to shorten, and it is shortened BEFORE the
 * ladder runs, because it is not one of the ladder's rungs.
 */
export function capToTokens(text: string, ceiling: number): string {
  if (estimateTokens(text) <= ceiling) return text;
  const lines = text.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const candidate = [...kept, line].join('\n');
    if (estimateTokens(candidate) > ceiling) break;
    kept.push(line);
  }
  return kept.join('\n');
}

const textBlock = (text: string, cacheHint?: NarratorTextBlock['cacheHint']): NarratorTextBlock =>
  cacheHint === undefined ? { type: 'text', text } : { type: 'text', text, cacheHint };

/**
 * Assemble one narration request.
 *
 * Pure: no clock, no random, no environment, no network. The `requestId` and
 * the abort signal come in as parameters for that reason.
 */
export function buildNarrateRequest(input: BuildContextInput): BuiltContext {
  const campaignBlock = capToTokens(input.campaignBlock, SEGMENT_CEILINGS.campaignBlock);

  const scene = buildSceneBlock(input.brief);
  const fait = buildFactBlock(input.brief, input.vocabulary);
  const intention = buildIntentionBlock(input.brief, input.actorLabel);
  const consignes = buildConsignesBlock({
    actorLabel: input.actorLabel,
    absentNames: input.brief.perceivableFacts
      .filter((fact) => fact.kind === 'absent')
      .map((fact) => fact.name),
    hasImposedPrice: input.brief.imposedPrice !== null,
  });

  const fixed: FixedContext = {
    systemPrompt: input.systemPrompt,
    campaignBlock,
    scene,
    fait,
    intention: `${intention}\n${consignes}`,
  };

  const trim = applyTrimLadder(fixed, input.trimmable, turnBudget(input.contextWindowTokens));
  const kept = trim.context;

  const chronicle = renderChronicle(kept.chronicle);
  const etat = renderEtat(kept.etat);

  /**
   * Section 4.1: the rolling window alternates `user` (the frozen rendered
   * fact of a past turn) and `assistant` (the narration emitted, verbatim).
   * The rolling cache break sits on the LAST closed turn, which is why the
   * hint is attached there and nowhere else.
   */
  const window: NarratorMessage[] = kept.turns.map((turn, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: [textBlock(turn, index === kept.turns.length - 1 ? 'rolling' : undefined)],
  }));

  const messages: readonly NarratorMessage[] = [
    { role: 'user', content: [textBlock(`<chronique>\n${chronicle}\n</chronique>`, 'session')] },
    { role: 'assistant', content: [textBlock(CHRONICLE_ANCHOR)] },
    ...window,
    {
      role: 'user',
      content: [
        textBlock(
          [
            `<etat>\n${etat}\n</etat>`,
            scene,
            `<lore>\n${kept.lore.join('\n')}\n</lore>`,
            fait,
            intention,
            consignes,
          ].join('\n\n'),
        ),
      ],
    },
  ];

  const request: NarrateRequest = {
    purpose: 'narration',
    requestId: input.requestId,
    system: [textBlock(input.systemPrompt, 'stable'), textBlock(campaignBlock, 'session')],
    messages,
    /** ADR 0011, prose-only mode. Empty, and it is the point of this line. */
    tools: [],
    toolPolicy: 'none',
    maxOutputTokens: TURN_OUTPUT_TOKENS,
    effort: 'low',
    ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
  };

  return { request, trim };
}
