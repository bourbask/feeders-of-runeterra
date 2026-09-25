/**
 * INTERFACES ONLY. Nothing in this file has an implementation, and nothing in
 * it may grow one: M0-24 implements `CampaignService`, M0-25 consumes it, and
 * both happen in the same wave. The contract has to exist before either.
 *
 * WHY `getTurnProof` IS ALREADY HERE (P22). The « Pourquoi ? » command is a
 * PROJECTION of the journal, computed on demand over one `correlation_id`
 * group. M0-25 routes `c2s.why` to it in the very wave M0-24 writes it, so it
 * cannot be added to the interface later without one of the two waiting for
 * the other. It is declared now, deliberately, and it is declared READ-ONLY:
 * it returns `null` for a group that does not belong to the campaign rather
 * than serving another table's turn.
 *
 * THE FOUR INVARIANTS, AS TYPES:
 *
 *   - `submitIntent` takes an `Intent`, never a `GameEvent` and never a gauge.
 *     The client sends intentions; the engine decides (invariants 1 and 3);
 *   - everything returned is either already in the journal or derived from it
 *     (invariants 2 and 4). There is no method here that computes a state the
 *     journal could not reproduce;
 *   - `getSnapshot` and `getTurnProof` both take a `viewerId`, because since
 *     ADR 0008 "what happened" has no single answer: replaying from one
 *     player's point of view must give exactly what that player saw.
 *
 * `NarratorPort` is re-exported rather than redeclared. Its canonical home is
 * `@for/contracts`; a second declaration would be a mirror nobody guards, and
 * ADR 0007 is the whole story of what an unguarded mirror is worth.
 */

import type { TableStateDto, TurnProofDto } from '@for/contracts';
import type { JournalEvent } from '@for/db';
import type {
  BurnWindow,
  CampaignId,
  Intent,
  NarrationBrief,
  PlayerId,
  Result,
  RuleViolation,
} from '@for/engine';
import type { AppError } from '../errors.js';

export type { NarratorPort } from '@for/contracts';

/**
 * An event as it comes back out of the journal, with its `seq`.
 *
 * 01-architecture.md section 2.8 calls this type `PersistedEvent`. No package
 * declares that name: `@for/db` delivered it as `JournalEvent` in M0-15, and
 * it is the same thing — the row plus its parsed payload, mirroring
 * `EventEnvelopeDto` field for field. The alias keeps the spec's word
 * readable here and points at the one real type instead of minting a second.
 * Reported as a naming divergence rather than fixed in a spec.
 */
export type PersistedEvent = JournalEvent;

export interface SubmitIntentInput {
  readonly campaignId: CampaignId;
  readonly playerId: PlayerId;
  /** Idempotence key, minted by the client. Replaying it must not reroll. */
  readonly intentId: string;
  readonly intent: Intent;
}

export interface SubmitIntentResult {
  readonly accepted: boolean;
  /** Already journalled, already `seq`-allocated. */
  readonly events: readonly PersistedEvent[];
  /** The fact the storyteller will dress, OUT of band and OUT of transaction. */
  readonly brief?: NarrationBrief;
  /**
   * WHY THE RULES SAID NO, present exactly when `accepted` is `false`.
   *
   * ADDED BY M0-24, and additively: a `RuleViolation` is NOT an `AppError`.
   * 01-architecture.md section 3.3 keeps the two families apart and
   * `@for/contracts/errors.ts` says in capitals that no error code is a rule
   * outcome, so "tu n'as pas assez de souffle" cannot travel as a server
   * error. `accepted: false` is the field that was already here for this case;
   * this is the code that goes with it, and `s2c.rejected` carries either
   * family through `zRejectionCode`.
   */
  readonly rejection?: RuleViolation;
  /**
   * THE TURN IS NOT OVER when this is non-null: the dice are written and
   * visible, and the player may still burn their momentum (M0-34,
   * 03-donnees.md section 3.4). The storyteller has NOT been called, and the
   * caller must not treat the turn as finished.
   *
   * Added by M0-24 for the same reason as `rejection`: the two-step burn
   * landed in the engine after this interface was written.
   */
  readonly pending?: BurnWindow | null;
}

/** What `getTurnProof` answers: the projection, and whether it was cut to fit. */
export interface TurnProofResult {
  readonly proof: TurnProofDto;
  /** `true` when the 8 KiB / 32 effects bound of the DTO dropped something. */
  readonly truncated: boolean;
}

export interface CampaignService {
  /**
   * THE ONLY WRITE PATH for game state. Returns a `Result`: a rule refusal is
   * a value with a code from the closed union, never an exception.
   */
  submitIntent(input: SubmitIntentInput): Promise<Result<SubmitIntentResult, AppError>>;

  /** Projection for one viewer: `visibility: 'gm'` lines are removed. */
  getSnapshot(
    campaignId: CampaignId,
    viewerId: PlayerId,
  ): Promise<{ state: TableStateDto; lastSeq: number }>;

  readEventsSince(campaignId: CampaignId, seq: number): Promise<readonly PersistedEvent[]>;

  /**
   * « Pourquoi ? » — reads the events of the `correlationId` group and
   * projects them. Pure read: no die is rolled, nothing is written, and a
   * group belonging to another campaign is `null`, never served.
   */
  getTurnProof(
    campaignId: CampaignId,
    correlationId: string,
    viewerId: PlayerId,
  ): Promise<TurnProofResult | null>;
}
