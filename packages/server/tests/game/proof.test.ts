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

import type { GameEvent, PlayerId, RollId } from '@for/engine';
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

  it('ne dit `truncated` à personne pour une entrée qu’il n’a pas le droit de voir', async () => {
    const table = aTable({ momentum: 2 });
    try {
      await aTurn(table);

      // UNE SEULE conséquence de plus, `private` et adressée à A. Le groupe
      // compte donc DEUX conséquences pour A et UNE pour B — très en deçà de
      // la borne de trente-deux, qui n'a rien à couper ici.
      appendEvents(table.connection, {
        campaignId: CAMPAIGN_ID,
        now: 0,
        events: [
          {
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
            scope: 'private' as const,
            recipients: [PLAYER_ID],
            createdAt: 0,
          },
        ],
      });

      const service = createCampaignService({ deps: table.deps });
      const mine = await service.getTurnProof(CAMPAIGN_ID, uuidAt(1), PLAYER_ID);
      const theirs = await service.getTurnProof(CAMPAIGN_ID, uuidAt(1), OTHER_PLAYER_ID);
      expect(mine).not.toBeNull();
      expect(theirs).not.toBeNull();
      if (mine === null || theirs === null) return;

      // Le destinataire voit ses deux conséquences, l'autre une seule : la
      // portée, appliquée comme `getSnapshot` l'applique.
      expect(mine.proof.effects).toHaveLength(2);
      expect(theirs.proof.effects).toHaveLength(1);

      // ET NI L'UN NI L'AUTRE N'EST `truncated`. Rien n'a été coupé par la
      // borne — c'est la seule chose que ce drapeau prétend dire. Répondre
      // `true` à B, c'était à la fois mentir et lui apprendre qu'il existe une
      // entrée qu'il n'a pas le droit de voir : le contraire du « ni plus ni
      // moins » de l'ADR 0008.
      expect([mine.truncated, theirs.truncated]).toEqual([false, false]);

      // Le compte lui-même est filtré : deux opérandes, deux origines, et la
      // même règle de visibilité des deux côtés.
      const group = readCorrelationGroup(table.connection, CAMPAIGN_ID, uuidAt(1));
      expect([
        proofEffectCandidates(group, PLAYER_ID).length,
        proofEffectCandidates(group, OTHER_PLAYER_ID).length,
      ]).toEqual([2, 1]);
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
      expect(proofEffectCandidates([], PLAYER_ID)).toHaveLength(0);
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

/**
 * LA PREUVE D'UN TOUR BRÛLÉ, que la couverture a désignée : la révision, le
 * prix et le présage n'étaient projetés par aucun test. Un tour en deux temps
 * est précisément le tour dont on demande « Pourquoi ? », puisque c'est le
 * seul où l'issue affichée n'est pas celle des dés.
 */
describe('« Pourquoi ? » sur un tour en deux temps', () => {
  /** Dé 1 + `vif` 1 = 2 contre 4 et 4 : échec, dés jumeaux donc présage. */
  const OPENS_A_WINDOW: readonly number[] = [1, 4, 4];

  async function aWindow(table: Table): Promise<RollId> {
    table.rng.script('action', [...OPENS_A_WINDOW]);
    // LE PRÉSAGE SE TIRE AU JET, pas à la fermeture : les dés jumeaux sont
    // déjà écrits quand la fenêtre s'ouvre.
    table.rng.script('presage', [1]);
    const outcome = await runIntent(table.deps, {
      campaignId: CAMPAIGN_ID,
      playerId: PLAYER_ID,
      intentId: uuidAt(1),
      intent: FACE_DANGER,
    });
    if (outcome.kind !== 'accepted' || outcome.pending === null) {
      throw new Error(`la fenêtre ne s'est pas ouverte : ${JSON.stringify(outcome)}`);
    }
    return outcome.pending.roll.rollId;
  }

  it('porte la révision, et garde le jet initial à côté', async () => {
    const table = aTable();
    try {
      const rollId = await aWindow(table);
      const closed = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: { type: 'momentum.burn', rollId },
      });
      expect(closed.kind).toBe('accepted');

      const service = createCampaignService({ deps: table.deps });
      const result = await service.getTurnProof(CAMPAIGN_ID, uuidAt(1), PLAYER_ID);
      expect(result).not.toBeNull();
      if (result === null) return;
      const { proof } = result;

      // LES DEUX JETS SONT LÀ, et ils ne disent pas la même chose : les dés
      // écrits (échec sur un score de 2) et la révision (réussite franche).
      expect(proof.roll).toMatchObject({ action: 1, challenge: [4, 4], outcome: 'echec' });
      expect(proof.revision).not.toBeNull();
      expect(proof.revision?.label).toContain('franche');
      // La révision cite le jet qu'elle révise, par son `seq`.
      expect(proof.revision?.label).toContain(String(proof.roll?.eventSeq));
      // La brûlure elle-même est une conséquence, avec sa ligne de journal.
      expect(proof.effects.map((effect) => effect.type)).toEqual([
        'character.momentum_burned',
        'character.momentum_changed',
      ]);
      expect(proof.effects.map((effect) => effect.label)).toEqual([
        'souffle brûlé : 9, retombe à 2',
        'souffle 2 → 3',
      ]);
      // Un présage tiré à la fermeture est dans le même groupe que les dés.
      expect(proof.presage?.text.length).toBeGreaterThan(0);
      // LE PRIX N'EST JAMAIS TIRÉ sur une issue qu'on révise.
      expect(proof.price).toBeNull();
      expect(result.truncated).toBe(false);
    } finally {
      table.close();
    }
  });

  it('porte le prix quand le joueur garde son souffle', async () => {
    const table = aTable();
    try {
      const rollId = await aWindow(table);
      table.rng.script('price', [1, 1]);
      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: { type: 'momentum.keep', rollId },
      });

      const service = createCampaignService({ deps: table.deps });
      const result = await service.getTurnProof(CAMPAIGN_ID, uuidAt(1), PLAYER_ID);
      expect(result).not.toBeNull();
      if (result === null) return;

      expect(result.proof.revision).toBeNull();
      expect(result.proof.price).not.toBeNull();
      expect(result.proof.price?.text.length).toBeGreaterThan(0);
      expect(result.proof.effects.map((effect) => effect.type)).toEqual([
        'character.gauge_changed',
      ]);
      expect(result.proof.effects[0]?.label).toBe('ame 5 → 4');
    } finally {
      table.close();
    }
  });

  it('coupe un libellé à cent vingt caractères, avec des points de suspension', async () => {
    const table = aTable({ momentum: 2 });
    try {
      // Cent cinquante caractères écrits par le joueur. La borne est CENT
      // VINGT, en toutes lettres : c'est un critère, pas une constante
      // recopiée du code.
      const long = 'a'.repeat(150);
      table.rng.script('action', [6, 1, 2]);
      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: { ...FACE_DANGER, description: long },
      });

      const service = createCampaignService({ deps: table.deps });
      const result = await service.getTurnProof(CAMPAIGN_ID, uuidAt(1), PLAYER_ID);
      expect(result?.proof.move?.label).toHaveLength(120);
      expect(result?.proof.move?.label.endsWith('…')).toBe(true);
    } finally {
      table.close();
    }
  });
});

/**
 * CHAQUE CONSÉQUENCE A SA LIGNE EN FRANÇAIS, et la couverture a désigné
 * celle-ci : sur les douze types que `effectLabel` sait nommer, deux seulement
 * étaient lus par un test — les dix autres pouvaient rendre n'importe quoi.
 * Or c'est la seule chose que le joueur lit quand il demande « Pourquoi ? ».
 *
 * LE GROUPE EST DONNÉ DANS UN ORDRE QUI N'EST PAS LE SIEN, et l'assertion est
 * le TABLEAU EXACT : la preuve rend les entrées dans l'ordre du journal, donc
 * un code qui trierait, dédoublonnerait ou regrouperait se trahirait ici.
 */
describe('les libellés d’une conséquence', () => {
  const GROUP = uuidAt(7);

  function entry(seq: number, type: string, payload: unknown): GameEvent {
    return {
      id: `EFFECT${String(seq).padStart(19, '0')}`,
      campaignId: CAMPAIGN_ID,
      seq,
      playSessionId: null,
      payloadVersion: 1,
      actorKind: 'engine',
      actorPlayerId: null,
      subjectCharacterId: CHARACTER_ID,
      correlationId: GROUP,
      causationId: null,
      rngStream: null,
      rngDrawIndex: null,
      createdAt: 0,
      scope: 'table',
      recipients: null,
      type,
      payload,
    } as unknown as GameEvent;
  }

  it('nomme les douze, dans l’ordre du journal et sans en inventer un treizième', () => {
    // Les `seq` montent, les types sont délibérément mêlés : ni alphabétique,
    // ni groupés par famille.
    const group: readonly GameEvent[] = [
      entry(1, 'clock.filled', { clockId: 'C', title: 'La nuit tombe' }),
      entry(2, 'track.created', { trackId: 'T', title: 'Retrouver la caravane' }),
      entry(3, 'character.condition_added', {
        characterId: CHARACTER_ID,
        conditionId: 'X',
        label: 'blessé',
      }),
      entry(4, 'clock.advanced', { clockId: 'C', from: 1, to: 2, segments: 4 }),
      entry(5, 'character.xp_earned', { characterId: CHARACTER_ID, amount: 2, reason: 'vow' }),
      entry(6, 'track.ticked', { trackId: 'T', from: 0, to: 3, delta: 3 }),
      entry(7, 'character.condition_removed', { characterId: CHARACTER_ID, conditionId: 'X' }),
      entry(8, 'track.resolved', { trackId: 'T', outcome: 'accomplie' }),
      entry(9, 'character.gauge_changed', {
        characterId: CHARACTER_ID,
        gauge: 'vigueur',
        from: 5,
        to: 3,
        delta: -2,
        clamped: false,
        cause: 'effect',
      }),
      // UN TYPE QUE `effectLabel` NE NOMME PAS : il retombe sur son propre
      // nom. Une entrée sans phrase reste une entrée avec un `seq`, et c'est
      // le `seq` qui la rend vérifiable.
      entry(10, 'character.bond_forged', { characterId: CHARACTER_ID, entityId: 'E' }),
    ];

    const proof = buildTurnProof(group, PLAYER_ID);
    expect(proof).not.toBeNull();
    if (proof === null) return;

    expect(proof.effects.map((effect) => effect.label)).toEqual([
      'horloge pleine',
      'piste ouverte : Retrouver la caravane',
      'marque : blessé',
      'horloge 1 → 2',
      'expérience +2',
      'crans 0 → 3',
      'marque levée : X',
      'piste accomplie',
      'vigueur 5 → 3',
      'character.bond_forged',
    ]);
    // Le `seq` de chaque ligne est celui de l'entrée qui l'établit.
    expect(proof.effects.map((effect) => effect.eventSeq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Aucune entrée de STRUCTURE ici, donc aucun champ de structure rempli.
    expect([proof.move, proof.roll, proof.price, proof.presage]).toEqual([null, null, null, null]);
  });

  it('coupe le texte d’un présage à quatre cents caractères', () => {
    // QUATRE CENTS, en toutes lettres : c'est la borne du contrat, pas une
    // constante recopiée du code.
    const long = 'ô'.repeat(600);
    const proof = buildTurnProof(
      [
        entry(1, 'roll.presage_drawn', {
          rollId: 'R' as RollId,
          tableId: 'presages-freljord',
          value: 12,
          entryId: 'p12',
          text: long,
          triggeredByRollSeq: 0,
        }),
      ],
      PLAYER_ID,
    );
    expect(proof?.presage?.text).toHaveLength(400);
    expect(proof?.presage?.text.endsWith('…')).toBe(true);
  });
});
