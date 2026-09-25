/**
 * The distribution lock, checked on what each player was actually told.
 *
 * §7.4: "verifie qu'aucun champion reserve n'apparait". RESERVED FOR WHOM is
 * the part that makes the check mean something: ARCHITECTURE.md §4.4 scopes
 * the lock to the CAMPAIGN — "un champion reserve est celui d'un autre joueur
 * de la meme table" — so the forbidden list is built PER PLAYER, from the
 * champions the OTHER characters of this campaign hold. A single global list
 * would have forbidden a player their own champion, which is nonsense, and a
 * list built from the whole roster would have forbidden every name in
 * `content/champions/`, which would never pass.
 *
 * ── IT READS THE BYTES, NOT THE JOURNAL ─────────────────────────────────
 * The text checked is the one that left the server towards THAT player's
 * transport, in `s2c.event` frames carrying `narration.gm_message`. Reading
 * the journal instead would check what was written, not what was said to
 * whom — and per-recipient is the whole point since ADR 0008.
 *
 * ── THE LIST IS NEVER EMPTY, AND THAT IS ENFORCED ELSEWHERE ─────────────
 * `expectNoReservedChampion` THROWS on an empty reserved list, on purpose:
 * searching for nothing finds nothing. A scenario with a single player has no
 * other champion to reserve, so it is skipped EXPLICITLY below rather than
 * passing over an empty list — `tests/scenarios.test.ts`, « un scénario à un
 * seul joueur ne passe pas le verrou par une liste vide ».
 */

import { expectNoReservedChampion } from '@for/testkit';

import type { ContentRegistry } from '@for/content';
import type { CampaignState } from '@for/engine';
import type { PlayerTape } from '../harness.js';

export interface LockoutBreach {
  readonly playerSymbol: string;
  readonly issue: string;
}

/** Every spelling of every champion held by somebody other than `playerId`. */
export function reservedFor(
  state: CampaignState,
  content: ContentRegistry,
  playerId: string,
): readonly string[] {
  const names: string[] = [];
  for (const character of Object.values(state.characters)) {
    if (character.playerId === playerId) continue;
    if (state.championLocks[character.championId] === undefined) continue;
    const champion = content.findChampion(character.championId);
    if (champion === undefined) continue;
    names.push(champion.name, ...champion.aliases);
  }
  return names;
}

/** The narration lines this player's transport received. */
export function narrationSeenBy(tape: PlayerTape): readonly string[] {
  const lines: string[] = [];
  const push = (event: unknown): void => {
    if (typeof event !== 'object' || event === null) return;
    const row = event as { type?: unknown; payload?: unknown };
    if (row.type !== 'narration.gm_message') return;
    const payload = row.payload as { text?: unknown } | undefined;
    if (typeof payload?.text === 'string' && payload.text.length > 0) lines.push(payload.text);
  };
  for (const frame of tape.frames) {
    if (frame.type === 's2c.event') push(frame.payload['event']);
    if (frame.type === 's2c.events_batch') {
      for (const entry of (frame.payload['events'] ?? []) as { event?: unknown }[]) {
        push(entry.event);
      }
    }
  }
  return lines;
}

export function checkLockout(
  state: CampaignState,
  content: ContentRegistry,
  tapes: ReadonlyMap<string, PlayerTape>,
): readonly LockoutBreach[] {
  const breaches: LockoutBreach[] = [];
  for (const [symbol, tape] of tapes) {
    const reserved = reservedFor(state, content, tape.playerId);
    if (reserved.length === 0) continue;
    for (const line of narrationSeenBy(tape)) {
      try {
        expectNoReservedChampion(line, reserved);
      } catch (error) {
        breaches.push({
          playerSymbol: symbol,
          issue: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return breaches;
}
