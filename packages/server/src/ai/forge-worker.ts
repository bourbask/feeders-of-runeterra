/**
 * The sheet forge, persisted (02-mj-ia.md section 9, 03-donnees.md section 1.5).
 *
 * The prompt, the validation V1→V12 and the repairs are `@for/ai`'s, pure.
 * What is here is the call, the two retries, and the row — plus the ONE
 * decision the spec leaves to the server: which `status` the sheet gets.
 *
 * ── THE FORGE HAS NO PRIVILEGE ───────────────────────────────────────────
 * `validateForge` revalidates the completed sheet against `ChampionSchema`
 * itself (V12) before this file sees it, and the shape the model is asked for
 * is `ChampionSchema` minus the six fields the SERVER owns. Nothing forged
 * enters play without passing the same gate a handwritten sheet passes.
 *
 * ── PLAYABLE AT ONCE, SHAREABLE ONLY AFTER REVIEW ────────────────────────
 * 03-donnees.md section 1.5, arbitrated: a sheet is `active` and carries the
 * campaign that asked for it, so the player can create their character now —
 * waiting for a human would make the product unusable. `campaign_id IS NULL`,
 * the global cache, is reachable only through `approved`, which is a human
 * act. Held by `tests/ai/forge.test.ts`, « une fiche forgée est jouable dans
 * SA campagne, et n'est pas dans le cache global ».
 *
 * ── AND A FAILED FORGE IS A `draft`, NOT A HOLE ──────────────────────────
 * Section 9.5: after two retries the output is kept as `draft` — not
 * playable, kept for analysis, with `raw_output_json` and `repairs_json`
 * beside it. That is what makes the quality of the forge measurable over
 * time instead of anecdotal.
 *
 * ── NO EVENT IS WRITTEN HERE ─────────────────────────────────────────────
 * A forged sheet is content, not a fact of play. What puts it into a campaign
 * is `character.created`, on the ordinary intent path, which is also what
 * sets the distribution lock (ARCHITECTURE.md section 4.4). This file writes
 * one row in `champion_sheets` and nothing else — no journal entry, so no
 * circuit of invariant 1 is involved at all.
 */

import { createHash } from 'node:crypto';

import {
  FORGE_PROMPT_VERSION,
  FORGE_RETRIES_MAX,
  FORGE_SYSTEM_PROMPT,
  buildForgeCorrections,
  buildForgeRequest,
  validateForge,
} from '@for/ai';

import { narratorErrorCodeOf, recordAiCall } from './calls.js';

import type { ForgeFinding, ForgeValidationInput } from '@for/ai';
import type { NarratorPort } from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type { IdFactory } from '@for/engine';

export const FORGE_MAX_OUTPUT_TOKENS = 2000;

export type ChampionSheetStatus = 'draft' | 'active' | 'approved' | 'rejected' | 'superseded';

export interface ForgeWorkerDeps {
  readonly connection: SqliteConnection;
  readonly narrator: NarratorPort;
  readonly ids: IdFactory;
}

export interface ForgeInput {
  readonly campaignId: string;
  readonly requestedId: string;
  readonly canonicalRegionId: string;
  /** The champion asked for, its region, and what the lore says. */
  readonly brief: string;
  readonly allowedAssetIds: readonly string[];
  readonly defaultAssetIds: readonly string[];
  readonly championNames: readonly string[];
  readonly handwrittenSheetExists: boolean;
  readonly forgedByPlayerId: string | null;
  readonly now: number;
}

export type ForgeOutcome =
  | {
      readonly kind: 'forged';
      readonly sheetId: string;
      readonly status: ChampionSheetStatus;
      readonly findings: readonly ForgeFinding[];
      readonly attempts: number;
    }
  | { readonly kind: 'failed'; readonly detail: string };

/** sha256 of the canonical JSON, as `champion_sheets.content_hash` wants. */
export function sheetHash(sheet: unknown): string {
  return createHash('sha256').update(stableJson(sheet)).digest('hex');
}

/** Keys sorted, so two writings of one sheet hash the same. */
function stableJson(value: unknown): string {
  // The compiler knows `JSON.stringify` of a non-object never answers
  // `undefined` here, so the `?? 'null'` it used to carry was a branch nothing
  // could take — and an unreachable branch is a branch no test can redden.
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

const INSERT_SHEET = `INSERT INTO champion_sheets
    (id, champion_id, campaign_id, schema_version, prompt_version, sheet_json,
     raw_output_json, repairs_json, content_hash, status, forged_by_player_id,
     model, ai_call_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Forge one champion sheet.
 *
 * `FORGE_RETRIES_MAX` is `@for/ai`'s constant, not a second copy: section 9.5
 * says two, and a number retyped here is a number that drifts.
 */
export async function forgeChampionSheet(
  deps: ForgeWorkerDeps,
  input: ForgeInput,
): Promise<ForgeOutcome> {
  let corrections: string | undefined;
  let lastRaw: unknown = null;
  let lastFindings: readonly ForgeFinding[] = [];
  let lastCallId = '';
  let lastModel: string = deps.narrator.providerId;

  for (let attempt = 0; attempt <= FORGE_RETRIES_MAX; attempt += 1) {
    const requestId = deps.ids.next();
    lastCallId = requestId;
    const request = buildForgeRequest({
      requestId,
      systemPrompt: FORGE_SYSTEM_PROMPT,
      brief: input.brief,
      allowedAssetIds: input.allowedAssetIds,
      ...(corrections === undefined ? {} : { corrections }),
      maxOutputTokens: FORGE_MAX_OUTPUT_TOKENS,
    });

    try {
      const answer = await deps.narrator.structurer(request);
      lastRaw = answer.value;
      lastModel = answer.providerModel;
      recordAiCall(deps.connection, {
        id: requestId,
        campaignId: input.campaignId,
        purpose: 'forge',
        provider: deps.narrator.providerId,
        model: answer.providerModel,
        promptVersion: FORGE_PROMPT_VERSION,
        systemHash: '',
        status: 'ok',
        usage: answer.usage,
        latencyMs: answer.latencyMs,
        trimLevel: 0,
        finishReason: 'complete',
        createdAt: input.now,
      });
    } catch (error) {
      recordAiCall(deps.connection, {
        id: requestId,
        campaignId: input.campaignId,
        purpose: 'forge',
        provider: deps.narrator.providerId,
        model: deps.narrator.providerId,
        promptVersion: FORGE_PROMPT_VERSION,
        systemHash: '',
        status: 'error',
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        latencyMs: 0,
        trimLevel: 0,
        errorCode: narratorErrorCodeOf(error),
        createdAt: input.now,
      });
      return { kind: 'failed', detail: error instanceof Error ? error.message : String(error) };
    }

    const validation: ReturnType<typeof validateForge> = validateForge({
      raw: lastRaw,
      requestedId: input.requestedId,
      canonicalRegionId: input.canonicalRegionId,
      championNames: input.championNames,
      knownAssetIds: input.allowedAssetIds,
      defaultAssetIds: input.defaultAssetIds,
      handwrittenSheetExists: input.handwrittenSheetExists,
    } satisfies ForgeValidationInput);
    lastFindings = validation.findings;

    if (validation.sheet !== null) {
      return {
        kind: 'forged',
        sheetId: write(
          deps,
          input,
          validation.sheet,
          lastRaw,
          lastFindings,
          lastCallId,
          lastModel,
          'active',
        ),
        status: 'active',
        findings: lastFindings,
        attempts: attempt + 1,
      };
    }
    if (validation.action === 'reject') break;
    corrections = buildForgeCorrections(
      validation.findings.map((finding) => ({ check: finding.check, detail: finding.detail })),
    );
  }

  // Section 9.5: kept as a `draft`, for analysis. Not playable.
  return {
    kind: 'forged',
    sheetId: write(deps, input, lastRaw, lastRaw, lastFindings, lastCallId, lastModel, 'draft'),
    status: 'draft',
    findings: lastFindings,
    attempts: FORGE_RETRIES_MAX + 1,
  };
}

function write(
  deps: ForgeWorkerDeps,
  input: ForgeInput,
  sheet: unknown,
  raw: unknown,
  findings: readonly ForgeFinding[],
  aiCallId: string,
  model: string,
  status: ChampionSheetStatus,
): string {
  const id = deps.ids.next();
  deps.connection.prepare(INSERT_SHEET).run(
    id,
    input.requestedId,
    // PLAYABLE HERE, NOT EVERYWHERE: the global cache is `campaign_id IS
    // NULL`, and only an `approved` review puts a sheet there.
    input.campaignId,
    1,
    FORGE_PROMPT_VERSION,
    JSON.stringify(sheet ?? {}),
    JSON.stringify(raw ?? null),
    JSON.stringify(findings),
    sheetHash(sheet ?? {}),
    status,
    input.forgedByPlayerId,
    model,
    aiCallId,
    input.now,
  );
  return id;
}
