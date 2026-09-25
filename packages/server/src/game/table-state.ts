/**
 * `project(CampaignState, viewerId)` — what ONE PLAYER is allowed to see.
 *
 * TWO SUBTRACTIONS, and both are the DTO's own rules rather than this file's
 * good intentions (`@for/contracts/dto/table-state.ts`):
 *
 *   1. NO `visibility: 'gm'` ROW EVER. `zVisibleTrack` and `zVisibleClock`
 *      type `visibility` as the literal `'public'`, so a storyteller's track
 *      that reached a player view fails `zTableState.parse` instead of
 *      reaching a screen. This file filters, and the parse below is what makes
 *      the filter provable rather than trusted.
 *   2. NO `rng`. The seed plus a stream index is the whole future of the dice:
 *      a browser holding it could compute the result of a move before
 *      declaring it — invariant 1 lost through a window instead of a door. The
 *      DTO simply has no field for it, so there is nothing to forget.
 *
 * `characters` is NOT filtered. Every player at the table sees everyone's
 * sheet; that is the point of a shared table. What a player must not see is
 * what the storyteller is hiding, and `visibility` is what marks it.
 *
 * ── WHY THIS FUNCTION DOES NOT TAKE A `viewerId` ─────────────────────────
 * Said out loud rather than left for a reader to notice: in M0 the two
 * subtractions are the same for EVERY viewer, so the projection has nothing
 * to branch on. `CampaignService.getSnapshot` does take one — ADR 0008 makes
 * "what happened" a question with one answer per player, and M1's split party
 * is what will make it matter — and it hands it to nothing today. A parameter
 * accepted and ignored here would have read as a filter that exists; it does
 * not, and saying so is the honest version.
 *
 * COLLECTIONS ARE SORTED BY IDENTIFIER. `CampaignState` keys them by
 * identifier and the DTO carries arrays; `Object.values` gives insertion
 * order, which is the order entries arrived in. Two clients resuming the same
 * campaign would then get the same facts in different orders, and any
 * comparison of two snapshots would report a difference that is not one.
 */

import { zTableState } from '@for/contracts';

import type { TableStateDto } from '@for/contracts';
import type { CampaignState } from '@for/engine';

function byId<T extends { readonly id: string }>(
  values: Readonly<Record<string, T>>,
): readonly T[] {
  return Object.values(values).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The state one player sees, PARSED before it leaves.
 *
 * The parse is not belt and braces: it is the enforcement. A `gm` track that
 * slipped through the filter below would be caught here, in the one place
 * between the projection and the socket.
 */
export function toTableState(state: CampaignState): TableStateDto {
  return zTableState.parse({
    campaignId: state.campaignId,
    seq: state.seq,
    status: state.status,
    contentPackHash: state.contentPackHash,
    settings: state.settings,
    truths: state.truths,
    characters: byId(state.characters),
    tracks: byId(state.tracks).filter((track) => track.visibility === 'public'),
    clocks: byId(state.clocks).filter((clock) => clock.visibility === 'public'),
    entities: byId(state.entities),
    championLocks: Object.values(state.championLocks).sort((a, b) =>
      a.championId.localeCompare(b.championId),
    ),
    scene: state.scene,
    party: state.party,
  });
}
