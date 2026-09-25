/**
 * The two modes that do not run a scenario: `replay` and `fuzz`.
 *
 * ── `replay --db=<fichier>` IS A PRODUCTION TOOL ────────────────────────
 * §7.4 calls it "outil de debug production, consequence directe de
 * l'invariant 4". It opens a REAL database read-only, replays every
 * campaign's journal from the empty state, and answers three questions:
 * is every intermediate state valid, does the replay agree with the
 * PROJECTIONS the live path wrote, and is every player's thread dense.
 *
 * THE SECOND QUESTION IS THE ONE WORTH HAVING. Comparing the replay to
 * `loadReplay` would compare a reduction with itself. It is compared to the
 * `characters` TABLE instead — rows the live write path put there, turn after
 * turn — so a projection that drifted from the journal is a red exit code and
 * not a mystery three weeks later.
 *
 * ── `fuzz` SENDS VALID FRAMES, NEVER MALFORMED ONES ─────────────────────
 * The split is deliberate and it is written in the task sheet:
 * `packages/contracts/tests/envelope-fuzz.test.ts` owns the malformed frame,
 * this owns the syntactically valid but absurd intent. A clean `s2c.rejected`
 * is a SUCCESS — the rules said no, which is the system working. A throw, an
 * invalid state or a broken journal is a failure, and the seed is printed so
 * it can be reproduced exactly.
 */

import { openSqlite, readSince, readSinceForPlayer } from '@for/db';
import { createInitialCampaignState, createSeededRng, reduceAll } from '@for/engine';
import { readJournalSince } from '@for/server';

import { stateIssues } from './checks/invariants.js';
import { createSimHarness } from './harness.js';
import { expandUlid, loadScenarios } from './scenario.js';

import type { SqliteConnection } from '@for/db';
import type {
  AttributeId,
  CampaignId,
  EntityId,
  Intent,
  PlayerId,
  ProgressRank,
  RollId,
  TrackId,
} from '@for/engine';

export interface ModeOutcome {
  readonly ok: boolean;
  readonly text: string;
}

// ----------------------------------------------------------------- replay

interface CampaignRow {
  readonly id: string;
  readonly owner_player_id: string;
  readonly rng_seed: string;
}

interface CharacterRow {
  readonly id: string;
  readonly momentum: number;
  readonly vigueur: number;
  readonly ame: number;
  readonly vivres: number;
}

export function replayDatabase(file: string, onlyCampaign: string | null): ModeOutcome {
  let connection: SqliteConnection;
  try {
    connection = openSqlite(file);
  } catch (error) {
    return { ok: false, text: `base illisible (${file}) : ${String(error)}\n` };
  }

  const lines: string[] = [];
  let ok = true;
  try {
    const campaigns = connection
      .prepare(`SELECT id, owner_player_id, rng_seed FROM campaigns ORDER BY id`)
      .all() as CampaignRow[];
    const wanted =
      onlyCampaign === null ? campaigns : campaigns.filter((row) => row.id === onlyCampaign);

    if (wanted.length === 0) {
      return { ok: false, text: `aucune campagne à rejouer dans ${file}\n` };
    }

    for (const campaign of wanted) {
      const journal = readJournalSince(connection, campaign.id, 0);
      const state = reduceAll(
        createInitialCampaignState({
          campaignId: campaign.id as CampaignId,
          ownerPlayerId: campaign.owner_player_id as PlayerId,
          seed: campaign.rng_seed,
        }),
        journal,
      );

      const issues = [...stateIssues(state)];

      // The replay against the PROJECTIONS the live path wrote. Two origins.
      const rows = connection
        .prepare(
          `SELECT id, momentum, vigueur, ame, vivres FROM characters
            WHERE campaign_id = ? ORDER BY id`,
        )
        .all(campaign.id) as CharacterRow[];
      for (const row of rows) {
        const replayed = state.characters[row.id as keyof typeof state.characters];
        if (replayed === undefined) {
          issues.push(`le personnage ${row.id} est projeté mais absent du rejeu`);
          continue;
        }
        if (replayed.momentum !== row.momentum) {
          issues.push(
            `${row.id} : souffle projeté ${String(row.momentum)}, rejoué ${String(replayed.momentum)}`,
          );
        }
        for (const gauge of ['vigueur', 'ame', 'vivres'] as const) {
          if (replayed.gauges[gauge] !== row[gauge]) {
            issues.push(
              `${row.id}.${gauge} : projeté ${String(row[gauge])}, rejoué ${String(replayed.gauges[gauge])}`,
            );
          }
        }
      }

      // Every player's thread, dense by construction of the query; what is
      // checked is that it is a SUBSET of the journal in the same order.
      const members = connection
        .prepare(`SELECT player_id FROM campaign_members WHERE campaign_id = ? ORDER BY player_id`)
        .all(campaign.id) as { player_id: string }[];
      const all = readSince(connection, campaign.id, 0);
      for (const member of members) {
        const thread = readSinceForPlayer(connection, campaign.id, member.player_id, 0);
        let at = 0;
        for (const event of thread) {
          while (at < all.length && all[at]?.seq !== event.seq) at += 1;
          if (at >= all.length) {
            issues.push(
              `le fil de ${member.player_id} sort de l'ordre du journal au seq ${String(event.seq)}`,
            );
            break;
          }
          at += 1;
        }
      }

      ok = ok && issues.length === 0;
      lines.push(
        `${campaign.id}  ${String(journal.length).padStart(6)} entrées  ${issues.length === 0 ? 'vert' : 'ROUGE'}`,
      );
      for (const issue of issues) lines.push(`    ${issue}`);
    }
  } finally {
    connection.close();
  }

  return { ok, text: `${lines.join('\n')}\n` };
}

// ------------------------------------------------------------------- fuzz

const ATTRIBUTES: readonly AttributeId[] = ['vif', 'coeur', 'fer', 'ombre', 'esprit'];
const RANKS: readonly ProgressRank[] = ['genant', 'dangereux', 'redoutable', 'extreme', 'epique'];

/**
 * An intent that `zIntent` accepts and that the rules may well refuse.
 *
 * It names identifiers that do not exist on purpose — an unknown track, an
 * absent target: the point is to reach the RULE refusals, which must be
 * values and never exceptions (01-architecture.md §3.3).
 */
export function anIntent(roll: (sides: number) => number, characterId: string): Intent {
  const pick = <T>(list: readonly T[]): T => list[roll(list.length) - 1] as T;
  // `GHST`, not `GHOST`: `O` is not in Crockford base32, so `zTrackId` refuses
  // the padded identifier and every generated intent comes back
  // `validation_failed` — which is the generator being broken, not the server.
  // Measured on the first run: 200 iterations, 200 refusals, seed `m0`.
  const ghost = expandUlid(`GHST${String(roll(9))}`);
  const kinds = [
    (): Intent => ({ type: 'move.face_danger', attribute: pick(ATTRIBUTES), description: 'fuzz' }),
    (): Intent => ({
      type: 'move.secure_advantage',
      attribute: pick(ATTRIBUTES),
      description: 'fuzz',
    }),
    (): Intent => ({ type: 'move.gather_information', description: 'fuzz' }),
    (): Intent => ({
      type: 'move.probe_a_soul',
      target: { kind: 'entity', entityId: ghost as EntityId },
    }),
    (): Intent => ({
      type: 'move.strike',
      targetId: ghost,
      attribute: roll(2) === 1 ? 'fer' : 'vif',
    }),
    (): Intent => ({ type: 'move.endure_harm', amount: roll(4) }),
    (): Intent => ({ type: 'move.endure_cold' }),
    (): Intent => ({ type: 'move.swear_a_vow', text: 'fuzz', rank: pick(RANKS) }),
    (): Intent => ({ type: 'move.reach_a_milestone', trackId: ghost as TrackId }),
    (): Intent => ({ type: 'move.fulfill_your_vow', trackId: ghost as TrackId }),
    (): Intent => ({ type: 'move.forsake_your_vow', trackId: ghost as TrackId, reason: 'fuzz' }),
    (): Intent => ({ type: 'momentum.burn', rollId: ghost as RollId }),
    (): Intent => ({ type: 'momentum.keep', rollId: ghost as RollId }),
    (): Intent => ({ type: 'oracle.ask', question: 'fuzz ?', likelihood: 'incertain' }),
    (): Intent => ({ type: 'speech.say', channel: 'ic', text: 'fuzz' }),
    (): Intent => ({ type: 'campaign.join', characterId: characterId as never }),
  ];
  return pick(kinds)();
}

export interface FuzzOptions {
  readonly iterations: number;
  readonly seed: string;
}

export async function fuzz(options: FuzzOptions): Promise<ModeOutcome> {
  const base = loadScenarios().find((scenario) => scenario.id.startsWith('00-'));
  if (base === undefined) return { ok: false, text: 'fuzz : aucun scénario de base\n' };

  // The scenario is used for its TABLE, never for its steps: the intents come
  // from the generator below.
  const harness = createSimHarness({
    scenario: { ...base, steps: [] },
    seed: options.seed,
    tmpPrefix: `for-sim-fuzz-${options.seed}-`,
  });

  const rng = createSeededRng(options.seed);
  const player = base.players[0];
  const lines: string[] = [];
  let rejected = 0;
  let accepted = 0;

  try {
    await harness.run();
    const identity = harness.players.get(player?.symbol ?? '');
    if (identity === undefined) return { ok: false, text: 'fuzz : aucun joueur\n' };

    for (let index = 0; index < options.iterations; index += 1) {
      const intent = anIntent((sides) => rng.roll(sides), identity.characterId);
      const result = await harness.service.submitIntent({
        campaignId: harness.campaignId,
        playerId: identity.playerId,
        intentId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
        intent,
      });
      if (!result.ok) {
        lines.push(
          `graine ${options.seed}, itération ${String(index)} : erreur serveur ` +
            `« ${result.error.code} » sur ${intent.type}`,
        );
        return { ok: false, text: `${lines.join('\n')}\n` };
      }
      if (result.value.accepted) accepted += 1;
      else rejected += 1;

      const issues = stateIssues(harness.state());
      if (issues.length > 0) {
        lines.push(
          `graine ${options.seed}, itération ${String(index)} : état invalide après ${intent.type}`,
          ...issues.map((issue) => `    ${issue}`),
        );
        return { ok: false, text: `${lines.join('\n')}\n` };
      }
    }
  } catch (error) {
    return {
      ok: false,
      text: `graine ${options.seed} : exception non gérée — ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    };
  } finally {
    harness.close();
  }

  return {
    ok: true,
    text:
      `fuzz : ${String(options.iterations)} intentions, ${String(accepted)} acceptées, ` +
      `${String(rejected)} refusées proprement (graine ${options.seed})\n`,
  };
}
