/**
 * `CampaignService` — the interface M0-20 declared, implemented.
 *
 * It is thin on purpose. The write path is `intent-pipeline.ts`, the
 * serialisation is `write-queue.ts`, the proof is `turn-proof.ts`, the way
 * back is `revert.ts`. What this file adds is the ORDER those are used in, and
 * the translation of their answers into the two vocabularies the interface
 * speaks.
 *
 * ── A RULE REFUSAL IS NOT A SERVER ERROR, AND THE TWO ARE NEVER FUSED ────
 * The acceptance criterion reads "une intention invalide renvoie un `Result`
 * en erreur […] et la reponse porte un code de l'union fermee". There are TWO
 * closed unions, and 01-architecture.md section 3.3 — plus the header of
 * `@for/contracts/errors.ts`, in capitals — says they must never be mixed:
 *
 *   - a STRUCTURALLY invalid intent, an unknown campaign, a player who is not
 *     a member, a campaign being rebuilt: `err(AppError)`, with a code from
 *     `APP_ERROR_CODES`. The request could not be served;
 *   - an intent the RULES refuse — not enough momentum, a roll already
 *     awaiting a burn decision: `ok({ accepted: false, rejection })`, with a
 *     code from `RULE_VIOLATION_CODES`. The request was served; the world said
 *     no, and that answer is part of the fiction.
 *
 * `SubmitIntentResult.accepted` is the field that exists for the second case,
 * and `zRejectionCode = zRuleViolationCode | zAppErrorCode` is `s2c.rejected`
 * carrying either. Folding a rule code into `AppError` would have required
 * adding it to `APP_ERROR_CODES`, and that file says in so many words that no
 * error code is a rule outcome. Reported as a reading of the criterion rather
 * than applied in silence.
 *
 * ── EVERY WRITE GOES THROUGH THE QUEUE, THE READS DO NOT ─────────────────
 * `submitIntent` is serialised per campaign because it decides against a state
 * it then writes. `getSnapshot`, `readEventsSince` and `getTurnProof` read a
 * committed journal and never need to wait for one.
 */

import { campaignSeq, listMemberPlayerIds, readSince } from '@for/db';
import { err, ok } from '@for/engine';

import { AppError } from '../errors.js';
import { runIntent } from './intent-pipeline.js';
import { readCorrelationGroup, readJournalSince } from './journal.js';
import { loadState } from './snapshots.js';
import { toTableState } from './table-state.js';
import { buildTurnProof, proofEffectCandidates } from './turn-proof.js';
import { createWriteQueue } from './write-queue.js';

import type { CampaignId, GameEvent, PlayerId, Result } from '@for/engine';
import type { GameDeps } from './intent-pipeline.js';
import type {
  CampaignService,
  SubmitIntentInput,
  SubmitIntentResult,
  TurnProofResult,
} from './types.js';
import type { WriteQueue } from './write-queue.js';

/** 404 — no such campaign, or none this session may name. */
function campaignNotFound(campaignId: string): AppError {
  return new AppError('campaign_not_found', 404, "Cette table n'existe pas.", { campaignId });
}

/** 403 — a campaign the player is not a member of. */
function forbiddenCampaign(campaignId: string, playerId: string): AppError {
  return new AppError('forbidden_campaign', 403, "Tu n'es pas à cette table.", {
    campaignId,
    playerId,
  });
}

/** 409 — the projections of that ONE campaign are being rebuilt. */
function campaignRebuilding(campaignId: string): AppError {
  return new AppError(
    'campaign_rebuilding',
    409,
    'La table se reconstruit. Reviens dans un instant.',
    { campaignId },
  );
}

function validationFailed(detail: string): AppError {
  return new AppError('validation_failed', 400, 'Cette intention est mal formée.', { detail });
}

export interface CampaignServiceOptions {
  readonly deps: GameDeps;
  /** Shared across campaigns; one chain per campaign inside. */
  readonly queue?: WriteQueue;
}

export function createCampaignService(options: CampaignServiceOptions): CampaignService {
  const { deps } = options;
  const queue = options.queue ?? createWriteQueue();

  return {
    async submitIntent(input: SubmitIntentInput): Promise<Result<SubmitIntentResult, AppError>> {
      return queue.run(input.campaignId, async () => {
        const outcome = await runIntent(deps, {
          campaignId: input.campaignId,
          playerId: input.playerId,
          intentId: input.intentId,
          intent: input.intent,
        });

        switch (outcome.kind) {
          case 'campaign_not_found':
            return err(campaignNotFound(input.campaignId));
          case 'forbidden_campaign':
            return err(forbiddenCampaign(input.campaignId, input.playerId));
          case 'campaign_rebuilding':
            return err(campaignRebuilding(input.campaignId));
          case 'validation_failed':
            return err(validationFailed(outcome.detail));
          case 'rejected':
            return ok({ accepted: false, events: [], rejection: outcome.violation });
          case 'accepted':
            return ok({
              accepted: true,
              events: outcome.events,
              ...(outcome.brief === undefined ? {} : { brief: outcome.brief }),
              pending: outcome.pending,
            });
        }
      });
    },

    /**
     * WHAT `viewerId` DOES HERE, AND WHAT IT DOES NOT. It AUTHORISES: a player
     * who is not at this table is refused rather than served another table's
     * state, and that is the one thing the parameter is load-bearing for
     * today. It does NOT filter: the two subtractions `TableStateDto`
     * performs — no `visibility: 'gm'` row, no `rng` — are the same for every
     * player in M0, and `table-state.ts` says so rather than taking an
     * argument it would drop. ADR 0008's per-player answer arrives with M1's
     * split party.
     */
    // `async` so a refusal comes back as a REJECTED promise and not as a
    // synchronous throw: the method's type is `Promise`, and a caller that
    // wrote `.catch()` would otherwise miss it entirely.
    // eslint-disable-next-line @typescript-eslint/require-await -- see above
    async getSnapshot(campaignId: CampaignId, viewerId: PlayerId) {
      const head = campaignSeq(deps.connection, campaignId);
      if (head === undefined) throw campaignNotFound(campaignId);
      if (!listMemberPlayerIds(deps.connection, campaignId).includes(viewerId)) {
        throw forbiddenCampaign(campaignId, viewerId);
      }
      const state = loadState(deps.connection, campaignId, head, (afterSeq) =>
        readJournalSince(deps.connection, campaignId, afterSeq),
      );
      return { state: toTableState(state), lastSeq: state.seq };
    },

    readEventsSince(campaignId: CampaignId, seq: number) {
      return Promise.resolve(readSince(deps.connection, campaignId, seq));
    },

    /**
     * « Pourquoi ? » — a PURE READ. No die, no write, and a group that belongs
     * to another campaign is `null` rather than served: the query is keyed on
     * (campaign, correlation), so another table's turn cannot come back even
     * if a client knows its identifier.
     */
    getTurnProof(campaignId: CampaignId, correlationId: string, viewerId: PlayerId) {
      const group = readCorrelationGroup(deps.connection, campaignId, correlationId);
      if (group.length === 0) return Promise.resolve(null);
      const proof = buildTurnProof(group, viewerId);
      if (proof === null) return Promise.resolve(null);
      return Promise.resolve({
        proof,
        truncated: wasTruncated(group, viewerId, proof.effects.length),
      });
    },
  };
}

/**
 * Did the bound of the DTO drop something?
 *
 * TWO OPERANDS, TWO ORIGINS: the consequences the GROUP holds FOR THIS VIEWER,
 * counted by `turn-proof.ts`, against the entries the PROOF carries. The
 * proof's own list measured against itself would have answered `false` for
 * ever — and the group counted without the viewer answered `true` for a turn
 * nothing had been cut from, which told the viewer that an entry they may not
 * see exists (ADR 0008).
 */
function wasTruncated(group: readonly GameEvent[], viewerId: PlayerId, carried: number): boolean {
  return proofEffectCandidates(group, viewerId).length > carried;
}

export type { TurnProofResult };
