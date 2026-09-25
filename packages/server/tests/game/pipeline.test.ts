/**
 * The one write path, measured end to end — and every measurement here is a
 * pair: the thing works, and it stops working when the thing it depends on is
 * removed.
 */

import { addMember, canonicalJson, readSince, upsertPlayer, withRebuildLock } from '@for/db';
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

import type { CampaignId, GameEvent, Intent, PlayerId, RollId } from '@for/engine';

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

  it('sérialise deux écritures de la MÊME table, dans l’ordre où elles sont entrées', async () => {
    const { createWriteQueue } = await import('../../src/game/write-queue.js');
    const queue = createWriteQueue();
    const trace: string[] = [];

    /**
     * Un travail qui REND LA MAIN au milieu. C'est tout l'enjeu : aujourd'hui
     * `runIntent` est synchrone jusqu'à l'appel au conteur, donc la boucle
     * d'événements sérialise toute seule et la file peut être débranchée sans
     * qu'un seul test tombe. Elle se mesure donc ici, sur un travail qui
     * s'interrompt — ce que `runIntent` deviendra le jour où un `await` entre
     * dans la section critique.
     */
    const job = (name: string, ticks: number) => async (): Promise<string> => {
      trace.push(`${name}:début`);
      for (let index = 0; index < ticks; index += 1) await Promise.resolve();
      trace.push(`${name}:fin`);
      return name;
    };

    // « A » cède la main trois fois, « B » aucune : sans la file, B passe
    // entièrement pendant que A attend. L'ordre attendu n'est donc ni celui
    // des durées ni celui d'un tri.
    const first = queue.run('table-a', job('A', 3));
    const second = queue.run('table-a', job('B', 0));
    await expect(Promise.all([first, second])).resolves.toEqual(['A', 'B']);

    // LE TABLEAU EXACT : quatre étapes, aucun entrelacement.
    expect(trace).toEqual(['A:début', 'A:fin', 'B:début', 'B:fin']);
    expect(queue.size()).toBe(0);
  });

  it('ne laisse pas un travail en échec coincer la table', async () => {
    const { createWriteQueue } = await import('../../src/game/write-queue.js');
    const queue = createWriteQueue();
    const failed = queue.run('table-a', () => Promise.reject(new Error('boum')));
    await expect(failed).rejects.toThrow('boum');
    // La file continue : une intention refusée ne ferme pas la table.
    await expect(queue.run('table-a', () => Promise.resolve('après'))).resolves.toBe('après');
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

  /**
   * LES DEUX DERNIERS CODES DE L'UNION FERMÉE, que la couverture a désignés :
   * `campaign_not_found` et `campaign_rebuilding` n'étaient construits par
   * aucun test, alors que M0-25 les traduit en fermeture de socket. Un code
   * jamais produit est un code dont on ne sait pas s'il sort.
   */
  it('refuse une table qui n’existe pas, en 404 et sans exception', async () => {
    const table = aTable();
    try {
      const service = createCampaignService({ deps: table.deps });
      const result = await service.submitIntent({
        campaignId: '0000000000000000000000NOPE' as CampaignId,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect([result.error.code, result.error.httpStatus]).toEqual(['campaign_not_found', 404]);
    } finally {
      table.close();
    }
  });

  it('refuse en 409 pendant que CETTE table se reconstruit, et sert les autres', async () => {
    const table = aTable();
    try {
      // La file est court-circuitée pour que la garde soit franchie DANS le
      // verrou : `assertAcceptsIntents` est la première instruction de
      // `runIntent`, avant toute attente.
      const service = createCampaignService({
        deps: table.deps,
        queue: { run: (_campaignId, job) => job(), size: () => 0 },
      });
      const refused = withRebuildLock(CAMPAIGN_ID, () =>
        service.submitIntent({
          campaignId: CAMPAIGN_ID,
          playerId: PLAYER_ID,
          intentId: uuidAt(1),
          intent: FACE_DANGER,
        }),
      );
      const outcome = await refused;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect([outcome.error.code, outcome.error.httpStatus]).toEqual(['campaign_rebuilding', 409]);

      // UNE SEULE TABLE EST REFUSÉE : le verrou nomme la campagne. Hors
      // verrou, la même intention passe.
      table.rng.script('action', aCleanSuccess());
      const after = await service.submitIntent({
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: FACE_DANGER,
      });
      expect(after.ok).toBe(true);
    } finally {
      table.close();
    }
  });

  it('refuse en `character_not_in_campaign` un membre qui n’a pas de personnage', async () => {
    const table = aTable();
    try {
      // Membre de la table, mais aucune fiche à son nom : la forge est M0-29,
      // donc en M0 un personnage naît de l'amorce et non d'un joueur. Le trou
      // est signalé avec la tâche ; ce qui se mesure ici, c'est que le serveur
      // refuse par une VALEUR de l'union fermée au lieu de lever.
      const orphan = '0000000000000000000000PYRC' as PlayerId;
      upsertPlayer(table.connection, {
        id: orphan,
        discordUserId: 'discord-orphan',
        discordUsername: 'Sans fiche',
        createdAt: 0,
      });
      addMember(table.connection, {
        id: `${orphan}-member`,
        campaignId: CAMPAIGN_ID,
        playerId: orphan,
        joinedAt: 0,
      });

      const before = journal(table.connection).length;
      const outcome = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: orphan,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind !== 'rejected') return;
      expect(outcome.violation.code).toBe('character_not_in_campaign');
      // Et RIEN N'A ÉTÉ AJOUTÉ : le refus tombe avant les dés, dont le script
      // est resté vide — un tirage aurait levé `ScriptExhausted`.
      expect(journal(table.connection)).toHaveLength(before);
    } finally {
      table.close();
    }
  });

  /**
   * UNE PANNE DU CONTEUR NE PERD JAMAIS UNE PARTIE (`02-mj-ia.md` §0.2 : « on
   * dégrade la prose, jamais l'équité »). L'état était déjà juste et déjà
   * durable avant que le port ne soit appelé ; ce qui se mesure ici est que
   * l'incident est INSCRIT — `narration.gm_failed` — et que la phrase du
   * moteur part quand même, marquée `source: 'engine'`.
   */
  it('inscrit la panne du conteur et sert la phrase du moteur', async () => {
    const table = aTable({ momentum: 2 });
    try {
      table.rng.script('action', aCleanSuccess());
      const broken = {
        ...table.deps,
        narrator: {
          ...table.deps.narrator,
          narrer: () => {
            throw new Error('le fournisseur ne répond pas');
          },
        },
      };
      const outcome = await runIntent(broken, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      expect(outcome.kind).toBe('accepted');

      const types = journal(table.connection).map((row) => row.type);
      // LES DEUX ENTRÉES, DANS CET ORDRE : l'incident, puis la phrase.
      expect(types.slice(-2)).toEqual(['narration.gm_failed', 'narration.gm_message']);

      const written = readSince(table.connection, CAMPAIGN_ID, 0);
      const failed = written.find((event) => event.type === 'narration.gm_failed');
      const spoken = written.find((event) => event.type === 'narration.gm_message');
      expect(failed?.payload).toMatchObject({ errorKind: 'api_error' });
      // La phrase de repli est celle du moteur, et elle le dit.
      expect(spoken?.payload).toMatchObject({ source: 'engine' });
      // Le tour, lui, s'est résolu : la panne n'a rien coûté à la partie.
      expect(types).toContain('move.resolved');
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
