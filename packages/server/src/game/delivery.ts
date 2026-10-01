/**
 * `JournalDelivery` — what tells the hub, BY SEQUENCE, never by a result.
 *
 * ══ THE DEFECT THIS FILE CLOSES (issue #67) ═══════════════════════════════
 *
 * `ws/handlers.ts` used to broadcast `SubmitIntentResult.events`, that is,
 * what the intent RETURNS. The burn window's safety net
 * (`closeWindowAsKeep`, M0-34/M0-24) writes entries that are journalled and
 * ABSENT from that result, and `ai/turn.ts` writes three more families after
 * it. Every one of them was skipped — and skipped FOR EVER, because
 * `TableHub` advances `stream.lastSeq` past them while counting, so no
 * `c2s.resume` would ever ask for them again. Measured by the simulator:
 * three entries lost on scenario `06` alone.
 *
 * So the journal is the source. `deliver` reads `readSince(campaignId,
 * cursor)` and hands what it finds to `hub.broadcast`, in `seq` order, with
 * the hub applying the ADR 0008 scope filter as it always has.
 *
 * HELD BY `tests/ws/delivery-by-sequence.test.ts`: « livre une entrée écrite
 * HORS du résultat de l'intention — le filet de la brûlure » and « et le
 * curseur du joueur ne saute pas par-dessus elle ». Put
 * `hub.broadcast(campaignId, result.value.events)` back in `submit()` and both
 * go red.
 *
 * ══ WHY IT IS SYNCHRONOUS, AND WHY IT READS THE DATABASE ══════════════════
 *
 * `CampaignService.readEventsSince` is a `Promise`, and a delivery that
 * awaited would let two turns of the same campaign interleave their reads
 * between the await and the broadcast — the exact two-instants defect
 * `ws/handlers.ts` spends a header on. `readSince` is a synchronous
 * `better-sqlite3` statement, so this module reads it directly: one statement,
 * one instant, no window. It lives under `src/game/` and not under `src/ws/`
 * for that reason — the hub routes, it does not read.
 *
 * ══ TWO ENTRY POINTS, AND THEY DO NOT TAKE THE SAME NUMBER ════════════════
 *
 * `deliver(campaignId)` has no number to take, so it reads from this module's
 * own per-campaign cursor: everything journalled since it last spoke. That is
 * the websocket handler's call, right after a write commits.
 *
 * `deliverSince(campaignId, sinceSeq)` takes the caller's number and honours
 * it, because the caller — `ai/turn.ts` — read the journal HEAD before writing
 * anything, and what came before that head was the handler's to deliver. The
 * cursor is then raised, never lowered.
 *
 * Re-delivering is free and losing is not: `TableHub.appendVisible` ignores an
 * event whose `seq` a player's stream has already counted. HELD BY
 * `tests/ws/delivery-by-sequence.test.ts`, « deux livraisons de la même entrée
 * n'écrivent qu'une trame ».
 */

import { zCampaignId } from '@for/contracts';
import { readSince } from '@for/db';

import type { SqliteConnection } from '@for/db';
import type { TableHub } from '../ws/hub.js';
import type { EventDelivery } from './types.js';

export interface JournalDeliveryDeps {
  readonly connection: SqliteConnection;
  /**
   * A THUNK, AND THE REASON IS A REAL CYCLE RATHER THAN A STYLE.
   * `TableHub` is built from the `CampaignService`; the service's storyteller
   * (`ai/turn-runner.ts`) needs this delivery; this delivery needs the hub.
   * One of the three has to be named late, and this is the one where "late"
   * costs nothing: the thunk is called once per flush, long after
   * `gamePlugin` has finished composing. The alternative — a mutable
   * `bindHub()` — would be a hub this object could be used without.
   */
  readonly hub: () => TableHub;
}

/**
 * The production `EventDelivery`: a journal read, then one broadcast.
 *
 * `deliver` is the half `ws/handlers.ts` uses — it has no `sinceSeq` to offer
 * and must not invent one. `deliverSince` is the half `ai/turn.ts` uses, which
 * knows the head it saw before the narration wrote anything.
 */
export class JournalDelivery implements EventDelivery {
  private readonly deps: JournalDeliveryDeps;

  /** Highest `seq` handed to the hub, per campaign. */
  private readonly cursors = new Map<string, number>();

  constructor(deps: JournalDeliveryDeps) {
    this.deps = deps;
  }

  /** Everything journalled since this module last spoke for that campaign. */
  deliver(campaignId: string): void {
    this.flush(campaignId, this.cursors.get(campaignId) ?? 0);
  }

  deliverSince(campaignId: string, sinceSeq: number): void {
    this.flush(campaignId, sinceSeq);
  }

  private flush(campaignId: string, fromSeq: number): void {
    const fresh = readSince(this.deps.connection, campaignId, fromSeq);
    if (fresh.length === 0) return;
    // PARSED, NEVER CAST, like every other crossing into the hub's vocabulary
    // (`ws/index.ts`, « sont PARSÉS, jamais castés »). The brand is what says
    // this string came through a check, and a cast would hand it out for free.
    this.deps.hub().broadcast(zCampaignId.parse(campaignId), fresh);
    const head = fresh.at(-1)?.seq ?? fromSeq;
    this.cursors.set(campaignId, Math.max(head, this.cursors.get(campaignId) ?? 0));
  }
}

export function createJournalDelivery(deps: JournalDeliveryDeps): JournalDelivery {
  return new JournalDelivery(deps);
}
