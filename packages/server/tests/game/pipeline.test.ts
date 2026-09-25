/**
 * The one write path, measured end to end — and every measurement here is a
 * pair: the thing works, and it stops working when the thing it depends on is
 * removed.
 */

import { canonicalJson, readSince } from '@for/db';
import { assertNotAiAuthored, reduce } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { createCampaignService } from '../../src/game/campaign-service.js';
import { runIntent, toAppendable } from '../../src/game/intent-pipeline.js';
import { loadReplay } from '../../src/game/snapshots.js';
import {
  CAMPAIGN_ID,
  CHARACTER_ID,
  PLAYER_ID,
  aTable,
  journal,
  spyNarrator,
  uuidAt,
} from './support.test.js';

import type { GameEvent, Intent, PlayerId, RollId } from '@for/engine';

/** A clean success: score 7 against 1 and 2. No price, no presage, no window. */
function aCleanSuccess(): readonly number[] {
  return [6, 1, 2];
}

const FACE_DANGER: Intent = {
  type: 'move.face_danger',
  attribute: 'vif',
  description: 'Traverser la crevasse avant la nuit.',
};

describe('le chemin d’une intention', () => {
  it('persiste, projette et produit un brief, de bout en bout', async () => {
    const table = aTable({ momentum: 2 });
    try {
      table.rng.script('action', aCleanSuccess());
      const outcome = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });

      expect(outcome.kind).toBe('accepted');
      if (outcome.kind !== 'accepted') return;

      // LES ÉVÉNEMENTS. Le tour complet, dans l'ordre, avec des `seq` denses.
      expect(outcome.events.map((event) => event.type)).toEqual([
        'move.declared',
        'roll.action_resolved',
        'character.momentum_changed',
        'move.resolved',
      ]);
      expect(outcome.events.map((event) => event.seq)).toEqual([7, 8, 9, 10]);

      // LES PROJECTIONS. Le souffle de la réussite franche est en base, pas
      // seulement dans l'état rejoué : la ligne lue ici vient de `characters`.
      const row = table.connection
        .prepare(`SELECT momentum FROM characters WHERE id = ?`)
        .get(CHARACTER_ID) as { momentum: number };
      expect(row.momentum).toBe(3);

      // LE BRIEF, et son groupe : celui que le journal porte, pas celui que le
      // moteur avait inventé.
      expect(outcome.brief?.outcome).toBe('franche');
      expect(outcome.brief?.correlationId).toBe(uuidAt(1));
      expect(outcome.events.every((event) => event.correlationId === uuidAt(1))).toBe(true);

      // LA NARRATION, écrite après le commit.
      const narration = journal(table.connection).filter((row2) =>
        row2.type.startsWith('narration.'),
      );
      expect(narration.map((row2) => row2.type)).toEqual(['narration.gm_message']);
    } finally {
      table.close();
    }
  });

  it('ne relance pas les dés quand la même intention revient', async () => {
    const table = aTable({ momentum: 2 });
    try {
      table.rng.script('action', aCleanSuccess());
      const first = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      const before = journal(table.connection).length;

      // RIEN N'EST REMIS DANS LE SCRIPT. Un second tirage lèverait
      // `ScriptExhausted` : « aucun événement de plus » serait aussi vrai d'une
      // implémentation qui relance les dés et jette le résultat.
      expect(table.rng.left('action')).toBe(0);
      const second = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });

      expect(second.kind).toBe('accepted');
      if (first.kind !== 'accepted' || second.kind !== 'accepted') return;
      expect(second.replayed).toBe(true);
      expect(canonicalJson(second.events)).toBe(canonicalJson(first.events));
      expect(journal(table.connection).length).toBe(before);
    } finally {
      table.close();
    }
  });

  it('n’appelle le conteur qu’une fois la transaction commitée', async () => {
    const table = aTable({ momentum: 2 });
    try {
      // L'ESPION EST SUR LA BASE, pas sur un drapeau : au moment où le conteur
      // parle, les entrées du tour doivent DÉJÀ être lisibles par une autre
      // lecture. Un appel sous verrou d'écriture ne les verrait pas.
      let seenAtNarrationTime = -1;
      const spy = spyNarrator(table.deps.narrator, () => {
        seenAtNarrationTime = readSince(table.connection, CAMPAIGN_ID, 0).length;
      });

      table.rng.script('action', aCleanSuccess());
      await runIntent(
        { ...table.deps, narrator: spy },
        {
          campaignId: CAMPAIGN_ID,
          playerId: PLAYER_ID,
          intentId: uuidAt(1),
          intent: FACE_DANGER,
        },
      );

      // 6 d'amorçage + 4 du tour, visibles avant que le conteur ne parle.
      expect(seenAtNarrationTime).toBe(10);
    } finally {
      table.close();
    }
  });

  it('sérialise deux soumissions d’une même table, et n’en bloque pas deux autres', async () => {
    const table = aTable({ momentum: 2 });
    try {
      const service = createCampaignService({ deps: table.deps });
      table.rng.script('action', [...aCleanSuccess(), ...aCleanSuccess()]);

      const both = await Promise.all([
        service.submitIntent({
          campaignId: CAMPAIGN_ID,
          playerId: PLAYER_ID,
          intentId: uuidAt(1),
          intent: FACE_DANGER,
        }),
        service.submitIntent({
          campaignId: CAMPAIGN_ID,
          playerId: PLAYER_ID,
          intentId: uuidAt(2),
          intent: FACE_DANGER,
        }),
      ]);

      expect(both.every((result) => result.ok)).toBe(true);
      const seqs = journal(table.connection).map((row) => row.seq);
      // DENSE ET ORDONNÉ : 1..n sans trou, ce qui est faux dès que deux tours
      // décident contre le même état.
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, index) => index + 1));
    } finally {
      table.close();
    }
  });

  it('laisse passer deux campagnes en parallèle', async () => {
    const first = aTable();
    const second = aTable();
    try {
      const { createWriteQueue } = await import('../../src/game/write-queue.js');
      const queue = createWriteQueue();
      let released = (): void => undefined;
      const blocked = new Promise<void>((resolve) => {
        released = resolve;
      });

      const slow = queue.run('table-a', async () => {
        await blocked;
        return 'a';
      });
      // La seconde table répond alors que la première tient encore sa file.
      await expect(queue.run('table-b', () => Promise.resolve('b'))).resolves.toBe('b');
      released();
      await expect(slow).resolves.toBe('a');
    } finally {
      first.close();
      second.close();
    }
  });

  it('refuse une intention mal formée par un Result en erreur, jamais par une exception', async () => {
    const table = aTable();
    try {
      const service = createCampaignService({ deps: table.deps });
      const result = await service.submitIntent({
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        // Un type qui n'est dans aucune des vingt et une variantes de `zIntent`.
        intent: { type: 'move.invented' } as unknown as Intent,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('validation_failed');
      expect(result.error.httpStatus).toBe(400);
    } finally {
      table.close();
    }
  });

  it('rend un refus de RÈGLE comme une valeur, avec un code de l’union fermée', async () => {
    const table = aTable();
    try {
      const service = createCampaignService({ deps: table.deps });
      const result = await service.submitIntent({
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: { type: 'momentum.burn', rollId: CHARACTER_ID as unknown as RollId },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.accepted).toBe(false);
      expect(result.value.rejection?.code).toBe('no_burn_window');
      expect(result.value.events).toHaveLength(0);
    } finally {
      table.close();
    }
  });

  it('refuse une campagne dont le joueur n’est pas membre', async () => {
    const table = aTable();
    try {
      const service = createCampaignService({ deps: table.deps });
      const result = await service.submitIntent({
        campaignId: CAMPAIGN_ID,
        playerId: '0000000000000000000000INTR' as PlayerId,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('forbidden_campaign');
    } finally {
      table.close();
    }
  });
});

describe('l’invariant 1, tenu par du code et plus par de la discipline', () => {
  /** A gauge change signed by the model: the entry invariant 1 exists to refuse. */
  function aForgedGaugeChange(): GameEvent {
    return {
      id: '0000000000000000000000FRGD',
      campaignId: CAMPAIGN_ID,
      seq: 9,
      playSessionId: null,
      payloadVersion: 1,
      actorKind: 'gm_ai',
      actorPlayerId: null,
      subjectCharacterId: CHARACTER_ID,
      correlationId: uuidAt(9),
      causationId: null,
      rngStream: null,
      rngDrawIndex: null,
      createdAt: 0,
      scope: 'table',
      recipients: null,
      type: 'character.gauge_changed',
      payload: {
        characterId: CHARACTER_ID,
        gauge: 'vigueur',
        delta: -3,
        from: 5,
        to: 2,
        clamped: false,
        cause: 'gm:invented',
      },
    } as GameEvent;
  }

  it('refuse une entrée de jauge signée par l’IA sur le chemin d’écriture', () => {
    expect(() => toAppendable(aForgedGaugeChange(), uuidAt(9))).toThrowError(
      /cannot carry actorKind "gm_ai"/,
    );
  });

  it('et c’est bien ce garde-fou qui mord, pas le réducteur', () => {
    const table = aTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      // LE RÉDUCTEUR L'APPLIQUE SANS BRONCHER — mesuré, pas supposé. C'est
      // exactement pourquoi le garde-fou doit vivre en amont, sur le chemin
      // d'écriture, et pourquoi « `assertNotAiAuthored` existe » ne valait rien
      // tant que personne ne l'appelait.
      const applied = reduce(state, aForgedGaugeChange());
      expect(applied.characters[CHARACTER_ID]?.gauges.vigueur).toBe(2);
      expect(() => {
        assertNotAiAuthored(aForgedGaugeChange());
      }).toThrow();
    } finally {
      table.close();
    }
  });

  it('laisse passer une narration signée par l’IA : elle n’a aucun effet de jeu', () => {
    const narration = {
      ...aForgedGaugeChange(),
      type: 'narration.gm_message',
      payload: {
        text: 'Le vent tombe.',
        aiCallId: '0000000000000000000000AICL',
        model: 'stub',
        promptVersion: 'conteur/0',
        source: 'ai',
        citedEventSeqs: [],
      },
    } as unknown as GameEvent;
    expect(() => toAppendable(narration, uuidAt(9))).not.toThrow();
  });
});
