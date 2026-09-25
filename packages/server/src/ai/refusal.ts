/**
 * The storyteller's right of refusal, applied (02-mj-ia.md section 4.8).
 *
 * ── ONE WAY BACK, AND IT IS `revertTurn` ─────────────────────────────────
 * A proven refusal cancels the turn through `game/revert.ts` — the mechanism
 * of 03-donnees.md section 3.7, used as is. There is no second cancellation
 * path here, and there cannot be: this file has no statement of its own
 * against `events`, `snapshots` or the projections, and the grep of the
 * acceptance criterion runs on every test run to say so
 * (`tests/ai/refusal.test.ts`, « aucun mécanisme d'effacement n'existe dans
 * ce fichier »). Two ways back would be two replays, and invariant 4 would be
 * a coin toss.
 *
 * ── THE GROUP, NEVER A LINE ──────────────────────────────────────────────
 * `revertTurn` takes a `correlationId`. It has no parameter through which a
 * caller could name one entry of a turn, and that signature is the guard:
 * cancelling a roll without the gauge it moved produces a state nothing can
 * explain.
 *
 * ── AN INJECTED VERDICT MAY ONLY NARROW ──────────────────────────────────
 * `RefusalDeps.prove` exists so a test can drive the path, and it is ANDed
 * with the real `proveRefusal`: a substitute can refuse a refusal the state
 * proves, and it can never uphold one the state does not. That asymmetry is
 * the criterion of the sheet, executed — `tests/ai/refusal.test.ts`, « un
 * prouveur qui rend `upheld` sur une cause que l'état ne prouve pas n'annule
 * rien, et journalise `refusal_unproven` ». The state, and only the state,
 * decides.
 *
 * ── THE DICE DO NOT COME BACK ────────────────────────────────────────────
 * The draw index of the `action` stream is never rewound — `reduceAll`
 * advances the stream of a skipped entry on purpose (03-donnees.md section
 * 3.6). Nothing here touches `rng`, which is how that stays true, and
 * `tests/ai/refusal.test.ts` measures the index rather than trusting this
 * paragraph: « le hash de l'état de JEU revient, l'index de tirage ne recule
 * pas ». Without it, the right of refusal would be a machine for re-rolling
 * until the result is good.
 *
 * ── A REFUSED TURN IS SHOWN AS REFUSED ───────────────────────────────────
 * Nothing is erased. The journal is append-only, the clients have already
 * received the `s2c.event` of the roll, and the abuse guard of section 4.8.5
 * cannot measure what nobody kept. `system.reverted` MARKS; the client strikes
 * the lines through and keeps « Pourquoi ? » on them.
 */

import { REFUSAL_QUOTA_UPHELD, REFUSAL_QUOTA_WINDOW_TURNS, proveRefusal } from '@for/ai';
import { appendEvents } from '@for/db';

import { toAppendable } from '../game/intent-pipeline.js';
import { readCorrelationGroup } from '../game/journal.js';
import { revertTurn } from '../game/revert.js';
import { REFUSAL_CIRCUIT, assertRefusalWritable, gateEvents } from './proposal-surface.js';
import { sceneMergeState } from './scene-state.js';

import type { RefusalProofInput, RefusalRejectionReason, RefusalVerdict } from '@for/ai';
import type { SceneBlockRefusal, SceneStateDto } from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type {
  CampaignState,
  CharacterId,
  EventId,
  GameEventOf,
  IdFactory,
  PlayerId,
  ProposalId,
} from '@for/engine';

/** `system.reverted.reason` for a refusal. The client renders it; nobody parses it. */
export const REFUSAL_REASON_PREFIX = 'gm_refusal:';

/**
 * What a warn line carries when the quota trips.
 *
 * WRITTEN OUT HERE because « une alerte journalisée » is not verifiable and a
 * log FIELD is. Section 4.8.5 names the event; `campaignId` is what makes it
 * actionable. Held by `tests/ai/refusal.test.ts`, « au quatrième refus retenu,
 * `refusal_quota` et une ligne `warn` portant `gm_refusal_rate_high` ».
 */
export const GM_REFUSAL_RATE_HIGH = 'gm_refusal_rate_high';

/** The narrow slice of the server logger this layer uses. */
export interface AiLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface RefusalDeps {
  readonly connection: SqliteConnection;
  readonly ids: IdFactory;
  readonly logger: AiLogger;
  /**
   * A verdict that may only NARROW the real one. See the header. Omitted in
   * production, where `proveRefusal` is the single answer.
   */
  readonly prove?: ((input: RefusalProofInput) => RefusalVerdict) | undefined;
}

export interface ApplyRefusalInput {
  readonly campaignId: string;
  /** The turn the refusal points at. The whole group, or nothing. */
  readonly correlationId: string;
  /** `null` when the block carried no refusal. Nothing happens, and that is R1. */
  readonly refusal: SceneBlockRefusal | null;
  /** How many refusals the block declared. R2 allows one. */
  readonly declaredCount: number;
  /** The committed state, for the actors and the places. */
  readonly state: CampaignState;
  /** The scene as it stood at `move.declared` — R4 reads THIS, never the outcome. */
  readonly sceneAtDeclaration: SceneStateDto;
  readonly actorCharacterId: CharacterId | null;
  /** The player's own words, escaped, for R5. */
  readonly intention: string;
  readonly moveId: string | null;
  /** Names of the acting character's sheet assets. */
  readonly actorAssets: readonly string[];
  /** The acting character's inventory, by name. Empty in M0 — see `assetNames`. */
  readonly actorInventory?: readonly string[];
  readonly aiCallId: string;
  readonly now: number;
}

export type RefusalOutcome =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'rejected';
      readonly reason: RefusalRejectionReason;
      readonly proposalId: string;
      /** `seq` of the `narration.proposal_rejected`. */
      readonly seq: number | null;
    }
  | {
      readonly kind: 'upheld';
      readonly proposalId: string;
      readonly cause: string;
      readonly targetSeqs: readonly number[];
      /** `seq` of the `system.reverted`. */
      readonly seq: number;
    };

// ------------------------------------------------------------------ the quota

/**
 * How many of the last `windowTurns` turns of this campaign were cancelled by
 * a proven refusal.
 *
 * COUNTED FROM THE JOURNAL, never from a tally this process keeps: a restart
 * must not hand the storyteller a fresh allowance, and section 4.8.5's number
 * is about the campaign, not about the uptime. A turn is a `correlation_id`
 * group; the `system.reverted` of a refusal joins the group it cancels
 * (`revert.ts`), so counting groups is counting turns.
 */
export function upheldRefusalsInWindow(
  connection: SqliteConnection,
  campaignId: string,
  windowTurns: number = REFUSAL_QUOTA_WINDOW_TURNS,
): number {
  const row = connection
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT correlation_id,
                MAX(CASE WHEN type = 'system.reverted'
                          AND json_extract(payload_json, '$.reason') LIKE 'gm_refusal:%'
                         THEN 1 ELSE 0 END) AS refused,
                MAX(seq) AS last_seq
           FROM events
          WHERE campaign_id = ? AND correlation_id IS NOT NULL
          GROUP BY correlation_id
          ORDER BY last_seq DESC
          LIMIT ?
       ) WHERE refused = 1`,
    )
    .get(campaignId, windowTurns) as { n: number };
  return row.n;
}

// --------------------------------------------------------------- the writing

type ProposalEvent = GameEventOf<'narration.gm_proposal'>;
type RejectedEvent = GameEventOf<'narration.proposal_rejected'>;
type AcceptedEvent = GameEventOf<'narration.proposal_accepted'>;

interface EnvelopeInput {
  readonly deps: RefusalDeps;
  readonly input: ApplyRefusalInput;
  readonly causationId: EventId | null;
  readonly offset: number;
}

function envelope(shared: EnvelopeInput) {
  return {
    id: shared.deps.ids.next() as EventId,
    campaignId: shared.input.state.campaignId,
    seq: shared.input.state.seq + shared.offset,
    playSessionId: null,
    payloadVersion: 1,
    // The model SAID it; `narration.*` is the trace of what it said
    // (03-donnees.md section 0.5), excluded from the closed lists by nature.
    actorKind: 'gm_ai' as const,
    actorPlayerId: null as PlayerId | null,
    subjectCharacterId: shared.input.actorCharacterId,
    correlationId: shared.input.correlationId,
    causationId: shared.causationId,
    rngStream: null,
    rngDrawIndex: null,
    createdAt: shared.input.now,
    scope: 'table' as const,
    recipients: null,
  };
}

/**
 * Apply a declared refusal, whatever the verdict.
 *
 * EVERY declared refusal leaves a trace, upheld or not: 03-donnees.md section
 * 0.5 says a proposal without one is a bug, and section 4.8.2 says a rejected
 * refusal is a metric rather than an incident — the rejection rate per
 * `reasonCode` is how the abuse of section 4.8.5 becomes visible.
 */
export function applyRefusal(deps: RefusalDeps, input: ApplyRefusalInput): RefusalOutcome {
  // R1: no refusal declared. Nothing to do, and the turn is ordinary.
  if (input.refusal === null) return { kind: 'none' };

  const proof: RefusalProofInput = {
    refusal: input.refusal,
    declaredCount: input.declaredCount,
    sceneBefore: input.sceneAtDeclaration,
    state: sceneMergeState(input.state),
    actorInventory: input.actorInventory ?? [],
    actorAssets: input.actorAssets,
    intention: input.intention,
    moveId: input.moveId,
    upheldRefusalsInWindow: upheldRefusalsInWindow(deps.connection, input.campaignId),
  };

  // THE AND IS THE GUARD. An injected verdict narrows; it never grants.
  const real = proveRefusal(proof);
  const supplied = deps.prove?.(proof) ?? real;
  const verdict: RefusalVerdict =
    real === 'upheld' && supplied === 'upheld' ? 'upheld' : firstNo(real, supplied);

  if (verdict !== 'upheld') {
    if (verdict.rejected === 'refusal_quota') {
      deps.logger.warn(
        {
          event: GM_REFUSAL_RATE_HIGH,
          campaignId: input.campaignId,
          upheldInWindow: proof.upheldRefusalsInWindow,
          windowTurns: REFUSAL_QUOTA_WINDOW_TURNS,
          quota: REFUSAL_QUOTA_UPHELD,
        },
        'quota de refus du conteur dépassé',
      );
    }
    const trace = writeTrace(deps, input, verdict.rejected, null);
    return {
      kind: 'rejected',
      reason: verdict.rejected,
      proposalId: trace.proposalId,
      seq: trace.seq,
    };
  }

  // The one type this circuit reaches, named before it is reached.
  assertRefusalWritable('system.reverted');

  // ── THE CANCELLATION RUNS BEFORE THE TRACE IS WRITTEN, AND THAT IS THE
  //    POINT. Section 4.8.3, point 4: "La prose du modèle est persistée
  //    normalement en `narration.gm_message`, HORS du groupe annulé. C'est
  //    elle qui explique au joueur, en fiction, pourquoi rien n'a eu lieu."
  //    `revertTurn` names every entry the group holds AT THIS INSTANT, so
  //    anything written afterwards keeps the same `correlation_id` — one turn,
  //    one group, « Pourquoi ? » still addressable — and stays OUT of
  //    `targetSeqs`. A trace written first would be struck through with the
  //    dice, and section 4.8.5 says in so many words: on ne peut pas mesurer
  //    ce qu'on efface.
  const reverted = revertTurn(deps.connection, {
    campaignId: input.campaignId,
    correlationId: input.correlationId,
    reason: `${REFUSAL_REASON_PREFIX}${input.refusal.cause}`,
    // The storyteller asked, and it is not a player. `revert.ts` writes
    // `actorKind: 'system'` for exactly that reason.
    byPlayerId: null,
    ids: deps.ids,
    now: input.now,
  });

  if (reverted === null) {
    // The group does not exist, or was cancelled already. Cancelling twice is
    // refused upstream rather than repeated, so this is a rejection like any
    // other and it is journalled like one.
    const trace = writeTrace(deps, input, 'refusal_unproven', null, [
      'groupe introuvable ou déjà annulé',
    ]);
    return {
      kind: 'rejected',
      reason: 'refusal_unproven',
      proposalId: trace.proposalId,
      seq: trace.seq,
    };
  }

  // THE GATE ON THE VALUE, not only on the string passed above. Everything
  // the cancellation ADDED to the group is read back and checked against
  // circuit 3's closed list: a `revertTurn` that one day wrote a second entry,
  // or a different type, is caught here rather than trusted.
  gateEvents(
    REFUSAL_CIRCUIT,
    readCorrelationGroup(deps.connection, input.campaignId, input.correlationId).filter(
      (event) => event.seq >= reverted.seq,
    ),
  );

  const trace = writeTrace(deps, input, null, reverted.seq);
  return {
    kind: 'upheld',
    proposalId: trace.proposalId,
    cause: input.refusal.cause,
    targetSeqs: reverted.targetSeqs,
    seq: reverted.seq,
  };
}

/**
 * The proposal and its answer, written as one pair.
 *
 * 03-donnees.md section 0.5: every proposal produces an accepted or a rejected
 * entry, in every case. "Une proposition sans trace est un bug." The two are
 * appended together so there is no window in which one exists without the
 * other.
 */
function writeTrace(
  deps: RefusalDeps,
  input: ApplyRefusalInput,
  rejection: RefusalRejectionReason | null,
  revertedSeq: number | null,
  validationErrors: readonly string[] = [],
): { readonly proposalId: string; readonly seq: number | null } {
  const proposalId = deps.ids.next();
  const refusal = input.refusal;
  const proposal: ProposalEvent = {
    ...envelope({ deps, input, causationId: null, offset: 1 }),
    type: 'narration.gm_proposal',
    payload: {
      proposalId: proposalId as ProposalId,
      kind: 'refusal',
      payload: refusal === null ? null : { cause: refusal.cause, cible: refusal.cible },
    },
  };

  const answer: RejectedEvent | AcceptedEvent =
    rejection === null
      ? {
          ...envelope({ deps, input, causationId: proposal.id, offset: 2 }),
          type: 'narration.proposal_accepted',
          payload: {
            proposalId: proposalId as ProposalId,
            resultingEventSeqs: revertedSeq === null ? [] : [revertedSeq],
          },
        }
      : {
          ...envelope({ deps, input, causationId: proposal.id, offset: 2 }),
          type: 'narration.proposal_rejected',
          payload: {
            proposalId: proposalId as ProposalId,
            reasonCode: rejection,
            validationErrors: [...validationErrors],
          },
        };

  const appended = appendEvents(deps.connection, {
    campaignId: input.campaignId,
    events: [
      toAppendable(proposal, input.correlationId),
      toAppendable(answer, input.correlationId),
    ],
    now: input.now,
  });
  return { proposalId, seq: appended.events[1]?.seq ?? null };
}

/** The first refusal of the two verdicts. One of them is not `upheld`. */
function firstNo(left: RefusalVerdict, right: RefusalVerdict): RefusalVerdict {
  if (left !== 'upheld') return left;
  if (right !== 'upheld') return right;
  return left;
}
