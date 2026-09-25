/**
 * `revertTurn` — THE ONE WAY BACK, and there is no second.
 *
 * Three callers, one mechanism (03-donnees.md section 3.7): the owner's
 * « annuler le dernier jet », an administrator's correction, and the
 * storyteller's proven right of refusal (M0-29, which calls this and does not
 * write its own). A second cancellation path would be a second write path, and
 * ARCHITECTURE.md section 6 says a pull request that opens one is refused.
 *
 * ── IT TAKES A GROUP, NEVER A LIST OF SEQUENCES ──────────────────────────
 * The signature is the guard. Section 3.7: "le bouton « annuler le dernier
 * jet » emet un `system.reverted` sur le groupe `correlation_id` COMPLET
 * (l'intention et toute sa cascade), jamais sur une seule ligne : annuler un
 * `roll.action_resolved` sans annuler le `character.gauge_changed` qu'il a
 * cause produirait un etat incoherent." There is no parameter here through
 * which a caller could name one line of a turn.
 *
 * ── NOTHING IS DELETED, AND NOTHING IS GIVEN BACK ────────────────────────
 *   - the journal is append-only: cancelling ADDS `system.reverted`, and the
 *     entries it names stay exactly where they are. The replay skips them;
 *     the client strikes them through and keeps the « Pourquoi ? » command
 *     (section 3.7, points 3 and 5);
 *   - THE DRAW INDEX IS NEVER REWOUND. `reduceAll` advances the stream of a
 *     skipped entry on purpose (section 3.6), so replaying the same intent
 *     after a cancellation does not give back the same dice. Without that,
 *     the right of refusal would be a machine for re-rolling until the result
 *     is good. This file does nothing to make it true — it is true because
 *     nothing here touches `rng`, and the test measures the index rather than
 *     trusting the sentence;
 *   - the burn window comes back with everything else (section 3.7, point 1),
 *     and again by doing nothing: `burn-window.ts` derives it from the
 *     journal, and a skipped entry is a entry the derivation no longer sees.
 *
 * ── SNAPSHOTS ARE THE ONE THING THAT MUST BE DROPPED ─────────────────────
 * A snapshot taken after the cancelled entries holds a state that includes
 * them, and no replay would ever correct it — the replay starts FROM the
 * snapshot. Section 3.5 spells the rule out: `DELETE FROM snapshots WHERE
 * campaign_id = ? AND seq >= min(targetSeqs)`.
 */

import { appendEvents, writeProjectionsFrom } from '@for/db';

import { readCorrelationGroup } from './journal.js';
import { dropSnapshotsFrom, loadReplay } from './snapshots.js';

import type { SqliteConnection } from '@for/db';
import type { GameEvent, IdFactory, PlayerId } from '@for/engine';

export interface RevertInput {
  readonly campaignId: string;
  readonly correlationId: string;
  /**
   * Machine-short, exactly like every other `cause` in the journal:
   * `gm_refusal:<cause>` for the storyteller, `admin:<who>` for a human. The
   * client renders it; nothing here reads it.
   */
  readonly reason: string;
  /** The human who asked, or `null` when the storyteller's refusal did. */
  readonly byPlayerId: PlayerId | null;
  readonly ids: IdFactory;
  readonly now: number;
}

export interface RevertResult {
  /** The entries the cancellation names, ascending. */
  readonly targetSeqs: readonly number[];
  /** `seq` of the `system.reverted` entry itself. */
  readonly seq: number;
  /** Snapshots dropped because they were taken after the cancelled entries. */
  readonly snapshotsDropped: number;
}

/**
 * `null` when the group does not exist in this campaign, or when it has
 * already been cancelled.
 *
 * Cancelling twice is refused rather than repeated: the second entry would
 * name the same sequences and change nothing, while suggesting in the journal
 * that something happened twice.
 */
export function revertTurn(connection: SqliteConnection, input: RevertInput): RevertResult | null {
  const run = connection.transaction((): RevertResult | null => {
    const group = readCorrelationGroup(connection, input.campaignId, input.correlationId);
    if (group.length === 0) return null;
    if (group.some((event) => event.type === 'system.reverted')) return null;

    const targetSeqs = group.map((event) => event.seq);
    const floor = Math.min(...targetSeqs);

    const event = {
      id: input.ids.next(),
      type: 'system.reverted' satisfies GameEvent['type'],
      payload: { targetSeqs, reason: input.reason, byPlayerId: input.byPlayerId },
      payloadVersion: 1,
      actorKind: 'system' as const,
      actorPlayerId: input.byPlayerId,
      subjectCharacterId: null,
      // THE CANCELLATION BELONGS TO THE TURN IT CANCELS. `buildTurnProof` then
      // reads one group and knows the turn was reverted without a second
      // query — which is what lets it stay a pure function of its argument.
      correlationId: input.correlationId,
      causationId: null,
      rngStream: null,
      rngDrawIndex: null,
      // ADR 0008: a cancellation is addressed like the turn it cancels, and a
      // turn that reached the table is cancelled in front of the table.
      scope: 'table' as const,
      recipients: null,
      createdAt: input.now,
    };

    const appended = appendEvents(connection, {
      campaignId: input.campaignId,
      events: [event],
      now: input.now,
    });
    const written = appended.events[0];
    if (written === undefined) return null;

    const snapshotsDropped = dropSnapshotsFrom(connection, input.campaignId, floor);
    // Zone C, rewritten from the journal with the cancelled entries skipped —
    // through `@for/db`'s own writer, the one control 9 compares against.
    writeProjectionsFrom(connection, input.campaignId, loadReplay(connection, input.campaignId));

    return { targetSeqs, seq: written.seq, snapshotsDropped };
  });

  const result = run.immediate();
  return result;
}
