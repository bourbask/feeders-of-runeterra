/**
 * L'ANNULATION : on revient exactement, sauf sur ce qui ne doit jamais revenir.
 *
 * `03-donnees.md` §3.7 promet deux choses en même temps, et c'est leur
 * combinaison qui se mesure ici :
 *
 *   - jauges, souffle, conditions, crans, segments ET FENÊTRE DE BRÛLURE
 *     reviennent à l'état d'avant la déclaration, « parce qu'ils sont tous
 *     dérivés du journal et de rien d'autre » ;
 *   - le journal a GRANDI d'une ligne, et l'index de tirage du flux `action`
 *     n'a pas reculé — sans quoi le droit de refus deviendrait une machine à
 *     relancer jusqu'au bon résultat.
 */

import { canonicalJson } from '@for/db';
import { describe, expect, it } from 'vitest';

import { openBurnWindows, runIntent } from '../../src/game/intent-pipeline.js';
import { readJournalSince } from '../../src/game/journal.js';
import { revertTurn } from '../../src/game/revert.js';
import { loadReplay, writeSnapshot } from '../../src/game/snapshots.js';
import { CAMPAIGN_ID, CHARACTER_ID, PLAYER_ID, aTable, journal, uuidAt } from './support.test.js';

import type { SqliteConnection } from '@for/db';
import type { CampaignState } from '@for/engine';

/**
 * Le hash de l'ÉTAT DE JEU, `seq` et `rng` exclus — et l'exclusion est le
 * sujet, pas une commodité.
 *
 * Le critère demande que jauges, souffle, conditions, crans et segments
 * reviennent ; il demande dans la même phrase que l'index de tirage NE recule
 * pas et que le journal ait grandi. Un hash qui porterait sur `seq` et sur
 * `rng.draws` ne pourrait donc jamais être égal, et le critère serait faux par
 * construction. Ces deux champs sont la comptabilité du journal, pas l'état du
 * monde : ils sont mesurés séparément, juste en dessous.
 */
const NOT_THE_WORLD: readonly string[] = ['seq', 'rng'];

function worldHash(state: CampaignState): string {
  return canonicalJson(
    Object.fromEntries(Object.entries(state).filter(([key]) => !NOT_THE_WORLD.includes(key))),
  );
}

const FACE_DANGER = {
  type: 'move.face_danger',
  attribute: 'vif',
  description: 'Traverser la crevasse.',
} as const;

describe('revertTurn', () => {
  it('ramène le monde à l’état d’avant la déclaration', async () => {
    const table = aTable({ momentum: 2 });
    try {
      const before = loadReplay(table.connection, CAMPAIGN_ID).state;
      const worldBefore = worldHash(before);
      const drawsBefore = before.rng.draws.action ?? 0;
      const eventsBefore = journal(table.connection).length;

      table.rng.script('action', [6, 1, 2]);
      const turn = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      expect(turn.kind).toBe('accepted');

      const moved = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect(worldHash(moved)).not.toBe(worldBefore);
      expect(moved.characters[CHARACTER_ID]?.momentum).toBe(3);

      const reverted = revertTurn(table.connection, {
        campaignId: CAMPAIGN_ID,
        correlationId: uuidAt(1),
        reason: 'gm_refusal:cible_absente',
        byPlayerId: null,
        ids: table.ids,
        now: table.clock.now(),
      });
      expect(reverted).not.toBeNull();

      const after = loadReplay(table.connection, CAMPAIGN_ID).state;

      // LE MONDE EST REVENU, à l'octet.
      expect(worldHash(after)).toBe(worldBefore);

      // LE JOURNAL A GRANDI : une ligne `system.reverted`, et les entrées
      // annulées sont TOUJOURS LÀ. Le tour reste affichable, barré.
      const types = journal(table.connection).map((row) => row.type);
      expect(types).toContain('system.reverted');
      expect(types).toContain('roll.action_resolved');
      expect(journal(table.connection).length).toBeGreaterThan(eventsBefore);

      // L'INDEX DE TIRAGE N'A PAS RECULÉ : deux opérandes, deux origines —
      // l'index d'avant le tour, et celui d'après l'annulation.
      expect(after.rng.draws.action ?? 0).toBeGreaterThan(drawsBefore);
    } finally {
      table.close();
    }
  });

  it('annule le GROUPE, jamais une ligne : le jet et sa jauge partent ensemble', async () => {
    const table = aTable({ momentum: 2 });
    try {
      table.rng.script('action', [6, 1, 2]);
      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });

      const group = readJournalSince(table.connection, CAMPAIGN_ID, 0).filter(
        (event) => event.correlationId === uuidAt(1),
      );
      const reverted = revertTurn(table.connection, {
        campaignId: CAMPAIGN_ID,
        correlationId: uuidAt(1),
        reason: 'admin:correction',
        byPlayerId: PLAYER_ID,
        ids: table.ids,
        now: table.clock.now(),
      });

      // TOUTES les entrées du tour, y compris la narration : il n'existe aucun
      // paramètre par lequel un appelant pourrait n'en nommer qu'une.
      expect(reverted?.targetSeqs).toEqual(group.map((event) => event.seq));
      expect(reverted?.targetSeqs).toEqual(
        expect.arrayContaining([
          group.find((event) => event.type === 'roll.action_resolved')?.seq ?? -1,
          group.find((event) => event.type === 'character.momentum_changed')?.seq ?? -1,
        ]),
      );
    } finally {
      table.close();
    }
  });

  it('fait revenir la fenêtre de brûlure avec le reste', async () => {
    const table = aTable();
    try {
      table.rng.script('action', [1, 3, 4]);
      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      const open = openBurnWindows(
        table.deps,
        CAMPAIGN_ID,
        readJournalSince(table.connection, CAMPAIGN_ID, 0),
      );
      expect(open).toHaveLength(1);

      revertTurn(table.connection, {
        campaignId: CAMPAIGN_ID,
        correlationId: uuidAt(1),
        reason: 'gm_refusal:cible_morte',
        byPlayerId: null,
        ids: table.ids,
        now: table.clock.now(),
      });

      // AUCUNE LISTE DE CHAMPS À RESTAURER À LA MAIN : la fenêtre était dérivée
      // du journal, et l'entrée qui la portait est sautée au rejeu.
      expect(
        openBurnWindows(
          table.deps,
          CAMPAIGN_ID,
          readJournalSince(table.connection, CAMPAIGN_ID, 0),
        ),
      ).toEqual([]);
    } finally {
      table.close();
    }
  });

  it('supprime les instantanés pris après les entrées annulées', async () => {
    const table = aTable({ momentum: 2 });
    try {
      table.rng.script('action', [6, 1, 2]);
      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });

      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      writeSnapshot(table.connection, {
        campaignId: CAMPAIGN_ID,
        state,
        due: { kind: 'milestone', seq: state.seq },
        id: table.ids.next(),
        now: table.clock.now(),
      });
      expect(snapshotCount(table.connection)).toBe(1);

      const reverted = revertTurn(table.connection, {
        campaignId: CAMPAIGN_ID,
        correlationId: uuidAt(1),
        reason: 'admin:correction',
        byPlayerId: PLAYER_ID,
        ids: table.ids,
        now: table.clock.now(),
      });

      // Un instantané pris APRÈS les entrées annulées porte un état qui les
      // contient, et aucun rejeu ne le corrigerait : il part.
      expect(reverted?.snapshotsDropped).toBe(1);
      expect(snapshotCount(table.connection)).toBe(0);
    } finally {
      table.close();
    }
  });

  it('refuse d’annuler deux fois, et ignore un groupe inconnu', async () => {
    const table = aTable({ momentum: 2 });
    try {
      table.rng.script('action', [6, 1, 2]);
      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      const input = {
        campaignId: CAMPAIGN_ID,
        correlationId: uuidAt(1),
        reason: 'admin:correction',
        byPlayerId: PLAYER_ID,
        ids: table.ids,
        now: table.clock.now(),
      };
      expect(revertTurn(table.connection, input)).not.toBeNull();
      expect(revertTurn(table.connection, input)).toBeNull();
      expect(revertTurn(table.connection, { ...input, correlationId: uuidAt(99) })).toBeNull();
    } finally {
      table.close();
    }
  });
});

function snapshotCount(connection: SqliteConnection): number {
  const row = connection
    .prepare(`SELECT COUNT(*) AS n FROM snapshots WHERE campaign_id = ?`)
    .get(CAMPAIGN_ID) as { n: number };
  return row.n;
}
