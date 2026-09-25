/**
 * « POURQUOI ? » — la preuve est une PROJECTION du journal, pas une donnée
 * fabriquée (P22). Trois critères, tous tranchables, plus la pureté.
 */

import { zTurnProof } from '@for/contracts';
import { appendEvents, canonicalJson } from '@for/db';
import { describe, expect, it } from 'vitest';

import { createCampaignService } from '../../src/game/campaign-service.js';
import { runIntent } from '../../src/game/intent-pipeline.js';
import { readCorrelationGroup } from '../../src/game/journal.js';
import { revertTurn } from '../../src/game/revert.js';
import { buildTurnProof, proofEffectCandidates } from '../../src/game/turn-proof.js';
import {
  CAMPAIGN_ID,
  CHARACTER_ID,
  OTHER_PLAYER_ID,
  PLAYER_ID,
  aTable,
  uuidAt,
} from './support.test.js';

import type { GameEvent, PlayerId } from '@for/engine';
import type { Table } from './support.test.js';

const FACE_DANGER = {
  type: 'move.face_danger',
  attribute: 'vif',
  description: 'Traverser la crevasse avant la nuit.',
} as const;

async function aTurn(table: Table): Promise<void> {
  table.rng.script('action', [6, 1, 2]);
  const outcome = await runIntent(table.deps, {
    campaignId: CAMPAIGN_ID,
    playerId: PLAYER_ID,
    intentId: uuidAt(1),
    intent: FACE_DANGER,
  });
  if (outcome.kind !== 'accepted') throw new Error('le tour a été refusé');
}

describe('la preuve d’un tour', () => {
  it('porte le jet, ses effets et sa narration, chacun avec son eventSeq', async () => {
    const table = aTable({ momentum: 2 });
    try {
      await aTurn(table);
      const service = createCampaignService({ deps: table.deps });
      const result = await service.getTurnProof(CAMPAIGN_ID, uuidAt(1), PLAYER_ID);

      expect(result).not.toBeNull();
      if (result === null) return;
      const { proof } = result;

      expect(proof.status).toBe('applied');
      expect(proof.move?.moveId).toBe('face-danger');
      expect(proof.roll).toMatchObject({ action: 6, challenge: [1, 2], outcome: 'franche' });
      expect(proof.effects.map((effect) => effect.type)).toEqual(['character.momentum_changed']);
      expect(proof.narration?.source).toBe('engine');
      expect(result.truncated).toBe(false);

      // CRITÈRE 2 : chaque entrée de la preuve porte un `eventSeq` du groupe.
      const group = new Set(
        readCorrelationGroup(table.connection, CAMPAIGN_ID, uuidAt(1)).map((event) => event.seq),
      );
      const seqs = [
        proof.move?.eventSeq,
        proof.roll?.eventSeq,
        proof.revision?.eventSeq,
        proof.price?.eventSeq,
        proof.presage?.eventSeq,
        proof.narration?.eventSeq,
        ...proof.effects.map((effect) => effect.eventSeq),
      ].filter((seq): seq is number => seq !== undefined);
      expect(seqs.length).toBeGreaterThan(0);
      for (const seq of seqs) expect(group.has(seq)).toBe(true);
    } finally {
      table.close();
    }
  });

  it('refuse un libellé sans eventSeq : la forme est le garde-fou', async () => {
    const table = aTable({ momentum: 2 });
    try {
      await aTurn(table);
      const group = readCorrelationGroup(table.connection, CAMPAIGN_ID, uuidAt(1));
      const proof = buildTurnProof(group, PLAYER_ID);
      expect(proof).not.toBeNull();
      if (proof === null) return;

      // LA VIOLATION : un effet sans `eventSeq`, exactement ce que le testeur
      // doit pouvoir ajouter pour voir le test tomber. `zTurnProof` le refuse
      // au lieu de le laisser passer jusqu'à un écran.
      const forged = {
        ...proof,
        effects: [{ type: 'character.gauge_changed', label: 'une jauge a bougé' }],
      };
      expect(() => zTurnProof.parse(forged)).toThrow();

      // Et la preuve honnête, elle, passe.
      expect(() => zTurnProof.parse(proof)).not.toThrow();
    } finally {
      table.close();
    }
  });

  it('reste une preuve quand le tour est annulé', async () => {
    const table = aTable({ momentum: 2 });
    try {
      await aTurn(table);
      revertTurn(table.connection, {
        campaignId: CAMPAIGN_ID,
        correlationId: uuidAt(1),
        reason: 'gm_refusal:cible_absente',
        byPlayerId: null,
        ids: table.ids,
        now: table.clock.now(),
      });

      const service = createCampaignService({ deps: table.deps });
      const result = await service.getTurnProof(CAMPAIGN_ID, uuidAt(1), PLAYER_ID);
      expect(result).not.toBeNull();
      if (result === null) return;

      expect(result.proof.status).toBe('reverted');
      expect(result.proof.revertedBy?.reason).toBe('gm_refusal:cible_absente');
      // ANNULER N'EFFACE PAS : le jet et les effets du tour annulé sont
      // toujours là, c'est tout l'intérêt.
      expect(result.proof.roll).not.toBeNull();
      expect(result.proof.effects.length).toBeGreaterThan(0);
    } finally {
      table.close();
    }
  });

  it('est pure : deux appels, le même octet, et aucune connexion', async () => {
    const table = aTable({ momentum: 2 });
    try {
      await aTurn(table);
      const group = readCorrelationGroup(table.connection, CAMPAIGN_ID, uuidAt(1));

      const first = buildTurnProof(group, PLAYER_ID);
      // La base est FERMÉE entre les deux appels : une fonction qui la lirait
      // lèverait au lieu de rendre la même preuve.
      table.connection.close();
      const second = buildTurnProof(group, PLAYER_ID);

      expect(canonicalJson(second)).toBe(canonicalJson(first));
    } finally {
      // `close()` est idempotent côté better-sqlite3 ; le répertoire, lui,
      // doit partir.
      try {
        table.close();
      } catch {
        // déjà fermée
      }
    }
  });

  it('applique la règle de visibilité de l’ADR 0008, spectateur par spectateur', async () => {
    const table = aTable({ momentum: 2 });
    try {
      await aTurn(table);
      const group = readCorrelationGroup(table.connection, CAMPAIGN_ID, uuidAt(1));
      const mine = group[group.length - 1];
      expect(mine).toBeDefined();
      if (mine === undefined) return;

      // Une entrée adressée à UN SEUL joueur, ajoutée au groupe.
      const secret = {
        ...mine,
        seq: mine.seq + 1,
        scope: 'private',
        recipients: [PLAYER_ID],
        type: 'character.condition_added',
        payload: {
          characterId: CHARACTER_ID,
          conditionId: 'blesse',
          label: 'Blessé',
          source: 'gm',
        },
      } as unknown as GameEvent;

      const mineProof = buildTurnProof([...group, secret], PLAYER_ID);
      const theirsProof = buildTurnProof([...group, secret], OTHER_PLAYER_ID);

      expect(mineProof?.effects.map((effect) => effect.type)).toContain(
        'character.condition_added',
      );
      expect(theirsProof?.effects.map((effect) => effect.type)).not.toContain(
        'character.condition_added',
      );
      // Et la borne de séquence suit : rejouer du point de vue d'un joueur
      // redonne EXACTEMENT ce qu'il a vu, ni plus ni moins.
      expect(mineProof?.lastSeq).toBe(secret.seq);
      expect(theirsProof?.lastSeq).toBe(mine.seq);
    } finally {
      table.close();
    }
  });

  it('annonce `truncated` quand le groupe dépasse la borne de 32 effets', async () => {
    const table = aTable({ momentum: 2 });
    try {
      await aTurn(table);

      // QUARANTE conséquences de plus, écrites dans le MÊME groupe, par le
      // vrai chemin d'écriture du journal.
      appendEvents(table.connection, {
        campaignId: CAMPAIGN_ID,
        now: 0,
        events: Array.from({ length: 40 }, () => ({
          id: table.ids.next(),
          type: 'character.momentum_changed',
          payload: {
            characterId: CHARACTER_ID,
            delta: 0,
            from: 3,
            to: 3,
            clamped: false,
            cause: 'effect:momentum',
          },
          payloadVersion: 1,
          actorKind: 'engine' as const,
          subjectCharacterId: CHARACTER_ID,
          correlationId: uuidAt(1),
          scope: 'table' as const,
          recipients: null,
          createdAt: 0,
        })),
      });

      const service = createCampaignService({ deps: table.deps });
      const result = await service.getTurnProof(CAMPAIGN_ID, uuidAt(1), PLAYER_ID);
      expect(result).not.toBeNull();
      if (result === null) return;

      // La borne est trente-deux, écrite en toutes lettres : c'est un critère
      // d'acceptation, pas une constante à recopier du code.
      expect(result.proof.effects).toHaveLength(32);
      expect(result.truncated).toBe(true);
      // Et le contraire tient aussi : un tour ordinaire ne dit pas `truncated`.
      expect(proofEffectCandidates([])).toHaveLength(0);
    } finally {
      table.close();
    }
  });

  it('ne sert pas le tour d’une autre table', async () => {
    const first = aTable({ momentum: 2 });
    const second = aTable({ momentum: 2 });
    try {
      await aTurn(first);
      const service = createCampaignService({ deps: second.deps });
      // Le groupe existe — dans l'autre campagne. La requête est clavetée sur
      // (campagne, groupe), donc il ne traverse pas.
      expect(await service.getTurnProof(CAMPAIGN_ID, uuidAt(1), PLAYER_ID)).toBeNull();
    } finally {
      first.close();
      second.close();
    }
  });

  it('rend null quand le spectateur n’a rien vu du tour', async () => {
    const table = aTable({ momentum: 2 });
    try {
      await aTurn(table);
      const group = readCorrelationGroup(table.connection, CAMPAIGN_ID, uuidAt(1)).map((event) => ({
        ...event,
        scope: 'private' as const,
        recipients: [PLAYER_ID],
      }));
      expect(buildTurnProof(group, '0000000000000000000000NOBD' as PlayerId)).toBeNull();
    } finally {
      table.close();
    }
  });
});
