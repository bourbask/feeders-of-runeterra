/**
 * The journal repository: allocation, atomicity, idempotence, and the read
 * that ADR 0008 turned into part of invariant 4.
 *
 * Each guard-rail here is measured IN BOTH DIRECTIONS where it claims to
 * forbid something: the same journal read with the filter and without it, the
 * same intent replayed with the idempotency key and with a fresh one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SqliteConnection } from '../src/client.js';
import { addMember, campaignSeq, listMemberPlayerIds } from '../src/repositories/campaigns.js';
import type { AppendableEvent } from '../src/repositories/events.js';
import {
  UnaddressableEventError,
  UnknownCampaignError,
  appendEvents,
  lastSeq,
  readForPlayerAfterDelivery,
  readSince,
  readSinceForPlayer,
} from '../src/repositories/events.js';
import type { IntentDecision } from '../src/repositories/intents.js';
import {
  IntentIdentityConflictError,
  getIntentStatus,
  settleIntentOnce,
} from '../src/repositories/intents.js';
import type { TempDb } from '../src/testing.js';
import { allocateSeq, appendEvent, migratedTempDb, seedCampaign } from '../src/testing.js';

const NOW = 1_700_000_000_000;

let open: TempDb | undefined;
afterEach(() => {
  open?.close();
  open = undefined;
});

/** A migrated file with one player and one campaign, closed after the test. */
function seeded(extraPlayers: readonly string[] = []): SqliteConnection {
  const db = migratedTempDb();
  open = db;
  seedCampaign(db.connection, { playerId: 'p1', campaignId: 'c1' });
  for (const id of extraPlayers) {
    db.connection
      .prepare(
        `INSERT INTO players (id, discord_user_id, discord_username, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, `discord-${id}`, id, NOW, NOW);
  }
  return db.connection;
}

/** A `table` event — the default: everyone at the table receives it. */
function tableEvent(id: string, type = 'narration.gm_message'): AppendableEvent {
  return { id, type, payload: { n: id }, actorKind: 'engine', scope: 'table', createdAt: NOW };
}

function narrowEvent(
  id: string,
  scope: 'subset' | 'private',
  recipients: readonly string[],
): AppendableEvent {
  return {
    id,
    type: 'narration.gm_message',
    payload: { n: id },
    actorKind: 'gm_ai',
    scope,
    recipients,
    createdAt: NOW,
  };
}

function eventCount(connection: SqliteConnection): number {
  return (connection.prepare(`SELECT count(*) AS n FROM events`).get() as { n: number }).n;
}

function maxEventSeq(connection: SqliteConnection): number | null {
  return (connection.prepare(`SELECT MAX(seq) AS m FROM events`).get() as { m: number | null }).m;
}

// ───────────────────────────── allocation ─────────────────────────────

describe('allocation de séquence', () => {
  it('rend des seq denses de 1 à N sur 100 lots, et campaigns.seq vaut le maximum', () => {
    const connection = seeded();
    let minted = 0;
    for (let batch = 0; batch < 100; batch += 1) {
      const size = (batch % 3) + 1; // 1, 2 ou 3 : les lots ne sont pas tous unitaires.
      const events = Array.from({ length: size }, () => tableEvent(`e${String(++minted)}`));
      appendEvents(connection, { campaignId: 'c1', events, now: NOW });
    }

    const all = readSince(connection, 'c1', 0);
    expect(all).toHaveLength(minted);
    expect(all.map((e) => e.seq)).toEqual(Array.from({ length: minted }, (_, i) => i + 1));
    expect(campaignSeq(connection, 'c1')).toBe(minted);
    expect(maxEventSeq(connection)).toBe(minted);
    expect(lastSeq(connection, 'c1')).toBe(minted);
  });

  it('un lot vide n’alloue rien : le compteur ne bouge pas', () => {
    const connection = seeded();
    appendEvents(connection, { campaignId: 'c1', events: [tableEvent('e1')], now: NOW });
    const before = campaignSeq(connection, 'c1');
    const result = appendEvents(connection, { campaignId: 'c1', events: [], now: NOW });
    expect(result).toEqual({ firstSeq: null, lastSeq: null, events: [] });
    expect(campaignSeq(connection, 'c1')).toBe(before);
  });

  it('refuse une campagne inconnue au lieu d’écrire un événement orphelin', () => {
    const connection = seeded();
    expect(() =>
      appendEvents(connection, { campaignId: 'nope', events: [tableEvent('e1')], now: NOW }),
    ).toThrow(UnknownCampaignError);
    expect(eventCount(connection)).toBe(0);
    expect(() => lastSeq(connection, 'nope')).toThrow(UnknownCampaignError);
  });
});

/**
 * GARDE-FOU `events_seq_dense`, dans les deux sens.
 *
 * Rouge AVEC : une insertion qui court-circuite l'allocateur est refusée.
 * Vert SANS : le même seq, celui que l'allocateur vient de rendre, passe.
 * Sans les deux mesures, « le trigger protège la densité » n'est qu'une
 * affirmation — et la §3.2 en donne un contre-exemple, ci-dessous.
 */
describe('le lot partiel ne laisse pas de trou', () => {
  it('la troisième insertion échoue : aucune ligne écrite, aucun seq consommé', () => {
    const connection = seeded();
    appendEvents(connection, { campaignId: 'c1', events: [tableEvent('e0')], now: NOW });
    const seqBefore = campaignSeq(connection, 'c1');
    expect(seqBefore).toBe(1);

    const batch: AppendableEvent[] = [
      tableEvent('a'),
      tableEvent('b'),
      // `table` AVEC destinataires : le CHECK `events_recipients_match_scope`
      // abat la troisième ligne, après que les deux premières ont alloué.
      { ...tableEvent('c'), recipients: ['p1'] },
    ];

    expect(() => appendEvents(connection, { campaignId: 'c1', events: batch, now: NOW })).toThrow(
      /events_recipients_match_scope/u,
    );

    expect(eventCount(connection)).toBe(1);
    expect(maxEventSeq(connection)).toBe(1);
    // Le point qui compte : le compteur est revenu en arrière avec le lot.
    // S'il valait 3 ici, les seq 2 et 3 seraient perdus pour toujours — le
    // journal est en ajout seul et le trigger refuserait de les combler.
    expect(campaignSeq(connection, 'c1')).toBe(seqBefore);
  });

  it('le lot suivant reprend au seq attendu, sans trou', () => {
    const connection = seeded();
    appendEvents(connection, { campaignId: 'c1', events: [tableEvent('e0')], now: NOW });
    expect(() =>
      appendEvents(connection, {
        campaignId: 'c1',
        events: [tableEvent('a'), { ...tableEvent('b'), recipients: ['p1'] }],
        now: NOW,
      }),
    ).toThrow();
    const after = appendEvents(connection, {
      campaignId: 'c1',
      events: [tableEvent('a2'), tableEvent('b2')],
      now: NOW,
    });
    expect(after.firstSeq).toBe(2);
    expect(after.lastSeq).toBe(3);
    expect(readSince(connection, 'c1', 0).map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

/**
 * CE QUE LA §3.2 PRESCRIT NE PEUT PAS TOURNER, et ce test est la preuve.
 *
 * Il ne teste pas le dépôt : il fige la mesure qui a imposé l'allocation
 * unitaire, pour que personne ne « répare » `appendEvents` en revenant au
 * `seq = seq + n` imprimé dans la spec. Signalé, pas contourné : la
 * correction de la §3.2 demande un ADR.
 */
describe('§3.2 — l’allocation par lot est fausse par construction', () => {
  it('UPDATE seq = seq + 3 puis INSERT 1,2,3 : le trigger abat la première ligne', () => {
    const connection = seeded();
    const high = connection
      .prepare(`UPDATE campaigns SET seq = seq + 3 WHERE id = ? RETURNING seq`)
      .get('c1') as { seq: number };
    expect(high.seq).toBe(3);

    expect(() => {
      connection
        .prepare(
          `INSERT INTO events
             (id, campaign_id, seq, type, payload_json, actor_kind, scope, created_at)
           VALUES ('x', 'c1', 1, 'narration.gm_message', '{}', 'engine', 'table', ?)`,
        )
        .run(NOW);
    }).toThrow(/events\.seq must be allocated via campaigns\.seq/u);
  });
});

// ──────────────────── ADR 0008 : rejouer par joueur ────────────────────

/**
 * Deux joueurs, un journal, deux fils différents.
 *
 * | seq | portée  | destinataires | p1 | p2 |
 * |-----|---------|---------------|----|----|
 * | 1   | table   | —             | ✓  | ✓  |
 * | 2   | private | p1            | ✓  |    |
 * | 3   | subset  | p1, p2        | ✓  | ✓  |
 * | 4   | private | p2            |    | ✓  |
 * | 5   | table   | —             | ✓  | ✓  |
 */
function twoPlayerJournal(): SqliteConnection {
  const connection = seeded(['p2']);
  addMember(connection, { id: 'm1', campaignId: 'c1', playerId: 'p1', joinedAt: NOW });
  addMember(connection, { id: 'm2', campaignId: 'c1', playerId: 'p2', joinedAt: NOW });
  appendEvents(connection, {
    campaignId: 'c1',
    events: [
      tableEvent('e1'),
      narrowEvent('e2', 'private', ['p1']),
      narrowEvent('e3', 'subset', ['p1', 'p2']),
      narrowEvent('e4', 'private', ['p2']),
      tableEvent('e5'),
    ],
    now: NOW,
  });
  return connection;
}

describe('invariant 4, durci par l’ADR 0008 : chacun retrouve son fil', () => {
  it('p1 rejoue exactement ce qu’il a vu, ni plus ni moins', () => {
    const connection = twoPlayerJournal();
    const fil = readSinceForPlayer(connection, 'c1', 'p1', 0);
    expect(fil.map((e) => e.seq)).toEqual([1, 2, 3, 5]);
    expect(fil.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e5']);
    expect(fil.some((e) => e.id === 'e4')).toBe(false);
  });

  it('p2 rejoue exactement ce qu’il a vu, ni plus ni moins', () => {
    const connection = twoPlayerJournal();
    const fil = readSinceForPlayer(connection, 'c1', 'p2', 0);
    expect(fil.map((e) => e.seq)).toEqual([1, 3, 4, 5]);
    expect(fil.some((e) => e.id === 'e2')).toBe(false);
  });

  /**
   * ROUGE AVEC / VERT SANS, sur le filtre lui-même. Sans le prédicat de
   * portée, la lecture rend les cinq événements aux deux joueurs : c'est
   * précisément ce que `readSince` fait, et c'est ce qui rend la mesure
   * probante plutôt que décorative.
   */
  it('la lecture NON filtrée rend les cinq à tout le monde — le filtre est ce qui mord', () => {
    const connection = twoPlayerJournal();
    expect(readSince(connection, 'c1', 0)).toHaveLength(5);
    expect(readSinceForPlayer(connection, 'c1', 'p1', 0)).toHaveLength(4);
    expect(readSinceForPlayer(connection, 'c1', 'p2', 0)).toHaveLength(4);
  });

  it('un joueur qui n’est destinataire de rien ne voit que la table', () => {
    const connection = twoPlayerJournal();
    expect(readSinceForPlayer(connection, 'c1', 'p9', 0).map((e) => e.seq)).toEqual([1, 5]);
  });

  /**
   * Le bug silencieux que `json_each` ferme : une comparaison par sous-chaîne
   * (`LIKE '%p1%'`) aurait livré à `p1` un événement adressé à `p10`. C'est
   * une fuite de confidentialité, pas une imprécision.
   */
  it('« p10 » dans la liste ne livre pas à « p1 »', () => {
    const connection = seeded(['p10']);
    appendEvents(connection, {
      campaignId: 'c1',
      events: [narrowEvent('e1', 'private', ['p10'])],
      now: NOW,
    });
    expect(readSinceForPlayer(connection, 'c1', 'p10', 0)).toHaveLength(1);
    expect(readSinceForPlayer(connection, 'c1', 'p1', 0)).toHaveLength(0);
  });

  /**
   * L'AUTRE BOUT DE LA PORTÉE : une liste de destinataires VIDE.
   *
   * ROUGE AVEC le garde-fou : `appendEvents` refuse, rien n'est écrit, aucun
   * seq n'est consommé. VERT SANS le garde-fou — c'est-à-dire par le chemin
   * SQL direct, celui que le CHECK DDL laisse passer : la ligne s'écrit, la
   * lecture globale en rend une, et la lecture filtrée n'en rend AUCUNE, pour
   * personne. C'est cette asymétrie qui montre que le garde-fou mord : sans
   * lui, le journal contient une entrée qu'aucun rejeu ne peut restituer.
   */
  it('un subset sans destinataire est refusé, et rien n’est écrit', () => {
    const connection = seeded(['p2']);
    expect(() =>
      appendEvents(connection, {
        campaignId: 'c1',
        events: [tableEvent('avant'), narrowEvent('vide', 'subset', [])],
        now: NOW,
      }),
    ).toThrow(UnaddressableEventError);
    expect(eventCount(connection)).toBe(0);
    expect(campaignSeq(connection, 'c1')).toBe(0);

    // Le même refus pour `private`.
    expect(() =>
      appendEvents(connection, {
        campaignId: 'c1',
        events: [narrowEvent('vide2', 'private', [])],
        now: NOW,
      }),
    ).toThrow(UnaddressableEventError);

    // VERT SANS : la même ligne, écrite hors du dépôt, passe le CHECK DDL et
    // n'atteint personne.
    const seq = allocateSeq(connection, 'c1');
    appendEvent(connection, {
      id: 'vide3',
      campaignId: 'c1',
      seq,
      type: 'narration.gm_message',
      scope: 'subset',
      recipientsJson: '[]',
    });
    expect(readSince(connection, 'c1', 0)).toHaveLength(1);
    expect(readSinceForPlayer(connection, 'c1', 'p1', 0)).toHaveLength(0);
    expect(readSinceForPlayer(connection, 'c1', 'p2', 0)).toHaveLength(0);
  });

  /** VERT SANS, côté nominal : un destinataire suffit à rendre la ligne lisible. */
  it('un subset à un seul destinataire, lui, est accepté et livré', () => {
    const connection = seeded(['p2']);
    appendEvents(connection, {
      campaignId: 'c1',
      events: [narrowEvent('plein', 'subset', ['p2'])],
      now: NOW,
    });
    expect(readSinceForPlayer(connection, 'c1', 'p2', 0).map((e) => e.id)).toEqual(['plein']);
    expect(readSinceForPlayer(connection, 'c1', 'p1', 0)).toHaveLength(0);
  });

  it('la reprise par seq global rend la suite du fil du joueur', () => {
    const connection = twoPlayerJournal();
    expect(readSinceForPlayer(connection, 'c1', 'p1', 3).map((e) => e.seq)).toEqual([5]);
    expect(readSinceForPlayer(connection, 'c1', 'p1', 0, 2).map((e) => e.seq)).toEqual([1, 2]);
  });
});

/**
 * ADR 0010 : `deliverySeq` est dense par (campagne, joueur) et vit dans le
 * PROTOCOLE. Il est donc calculé à la lecture, et la colonne n'existe pas.
 */
describe('ADR 0010 : le numéro de livraison est calculé, jamais stocké', () => {
  it('events ne porte aucune colonne delivery_seq', () => {
    const connection = seeded();
    const columns = (
      connection.prepare(`PRAGMA table_info(events)`).all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns).not.toContain('delivery_seq');
  });

  it('chaque joueur a une numérotation dense 1..N, distincte du seq global', () => {
    const connection = twoPlayerJournal();
    const p1 = readForPlayerAfterDelivery(connection, 'c1', 'p1', 0);
    const p2 = readForPlayerAfterDelivery(connection, 'c1', 'p2', 0);

    expect(p1.map((e) => e.deliverySeq)).toEqual([1, 2, 3, 4]);
    expect(p2.map((e) => e.deliverySeq)).toEqual([1, 2, 3, 4]);
    // Même rang de livraison, événement différent : c'est exactement la
    // contradiction que l'ADR 0010 tranche.
    expect(p1[3]!.seq).toBe(5);
    expect(p2[2]!.seq).toBe(4);
    expect(p1.map((e) => e.seq)).not.toEqual(p2.map((e) => e.seq));
  });

  it('reprendre au curseur du joueur rend la suite, pas le reste du journal', () => {
    const connection = twoPlayerJournal();
    const suite = readForPlayerAfterDelivery(connection, 'c1', 'p2', 2);
    expect(suite.map((e) => e.seq)).toEqual([4, 5]);
    expect(suite.map((e) => e.deliverySeq)).toEqual([3, 4]);
    expect(readForPlayerAfterDelivery(connection, 'c1', 'p2', 0, 1).map((e) => e.seq)).toEqual([1]);
  });
});

// ───────────────────────── idempotence d’intention ─────────────────────

describe('idempotence par identifiant d’intention', () => {
  const intent = {
    id: 'ci-0001',
    campaignId: 'c1',
    playerId: 'p1',
    type: 'move.strike',
    payload: { move: 'strike' },
    receivedAt: NOW,
  };

  it('rejouer la même intention ne produit aucun événement et rend le même résultat', () => {
    const connection = seeded();
    const decide = vi.fn<() => IntentDecision>(() => ({
      kind: 'apply',
      events: [
        tableEvent('e1', 'roll.made'),
        // Une portée étroite et une charge imbriquée dans le même lot : sans
        // elles, l'égalité complète ci-dessous ne traverserait ni `scope`, ni
        // `recipients`, ni l'aller-retour JSON.
        {
          ...narrowEvent('e2', 'private', ['p1']),
          type: 'move.resolved',
          payload: { degats: { valeur: 3, source: 'griffe' }, mots: ['froid', 'nuit'] },
        },
      ],
    }));

    const first = settleIntentOnce(connection, intent, decide);
    const second = settleIntentOnce(connection, intent, decide);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    // Le moteur n'a été consulté qu'une fois : les dés n'ont pas reroulé.
    expect(decide).toHaveBeenCalledTimes(1);
    expect(eventCount(connection)).toBe(2);
    // « Le résultat renvoyé est identique », au sens plein : le rejeu relit et
    // reparse les colonnes JSON là où le premier appel rendait l'objet en
    // mémoire. Une projection sur [seq, id, type] laisserait justement
    // `payload`, `scope` et `recipients` hors de la mesure.
    expect(second.events).toEqual(first.events);
    expect(second.status).toBe('applied');
  });

  /** VERT SANS : c'est bien l'identifiant qui bloque, pas le contenu. */
  it('une intention au contenu identique mais d’identifiant neuf produit, elle', () => {
    const connection = seeded();
    const decide = (): IntentDecision => ({ kind: 'apply', events: [tableEvent('x1')] });
    settleIntentOnce(connection, intent, decide);
    settleIntentOnce(connection, { ...intent, id: 'ci-0002' }, (): IntentDecision => ({
      kind: 'apply',
      events: [tableEvent('x2')],
    }));
    expect(eventCount(connection)).toBe(2);
    expect(readSince(connection, 'c1', 0).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('un refus est mémorisé et rejoué à l’identique, sans événement', () => {
    const connection = seeded();
    const decide = vi.fn<() => IntentDecision>(() => ({
      kind: 'reject',
      code: 'gauge_locked',
      detail: 'vigueur à 0',
    }));
    const first = settleIntentOnce(connection, intent, decide);
    const second = settleIntentOnce(connection, intent, decide);

    expect(first.status).toBe('rejected');
    expect(second.replayed).toBe(true);
    expect(second.rejection).toEqual({ code: 'gauge_locked', detail: 'vigueur à 0' });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(eventCount(connection)).toBe(0);
    expect(getIntentStatus(connection, intent.id)).toBe('rejected');
    expect(getIntentStatus(connection, 'jamais-vue')).toBeUndefined();
  });

  /**
   * INVARIANT 4, CÔTÉ REJEU : le fil rendu est celui du joueur qui demande.
   *
   * `intents.id` est une PRIMARY KEY sur toute la table et c'est le CLIENT qui
   * la forge. Mesuré avant correction : le même identifiant rejoué depuis une
   * autre campagne et un autre joueur rendait `replayed: true` et l'événement
   * `private` de la première campagne, destinataires compris. Il n'y a rien
   * au-dessus de cette lecture pour rattraper la fuite.
   *
   * ROUGE AVEC : le rejeu croisé est refusé et ne rend aucun événement.
   * VERT SANS : le même identifiant, même campagne, même joueur, rejoue.
   */
  it('le même identifiant depuis une autre table est refusé, pas rejoué', () => {
    const connection = seeded(['p2']);
    connection
      .prepare(
        `INSERT INTO campaigns
           (id, slug, name, owner_player_id, content_pack_version, content_pack_hash,
            rules_version, reducer_version, rng_seed, seq, created_at, updated_at)
         VALUES ('c2', 'slug-c2', 'Autre table', 'p2', '1.0.0', 'sha256-x', 1, 1, 'seed', 0, ?, ?)`,
      )
      .run(NOW, NOW);

    const confidentiel = settleIntentOnce(connection, intent, () => ({
      kind: 'apply',
      events: [narrowEvent('secret', 'private', ['p1'])],
    }));
    expect(confidentiel.events).toHaveLength(1);

    let capture: unknown;
    expect(() => {
      capture = settleIntentOnce(
        connection,
        { ...intent, campaignId: 'c2', playerId: 'p2' },
        () => ({ kind: 'apply', events: [] }),
      );
    }).toThrow(IntentIdentityConflictError);
    expect(capture).toBeUndefined();
    // La table d'en face n'a rien reçu, et rien ne s'est écrit chez elle.
    expect(readSinceForPlayer(connection, 'c2', 'p2', 0)).toHaveLength(0);
    expect(getIntentStatus(connection, intent.id)).toBe('applied');
    expect(eventCount(connection)).toBe(1);

    // VERT SANS le croisement : le même identifiant, du même joueur et de la
    // même table, rejoue comme avant.
    const rejeu = settleIntentOnce(connection, intent, () => ({ kind: 'apply', events: [] }));
    expect(rejeu.replayed).toBe(true);
    expect(rejeu.events).toEqual(confidentiel.events);
  });

  /** Le joueur seul suffit à faire diverger : même table, autre demandeur. */
  it('le même identifiant depuis un autre joueur de la même table est refusé', () => {
    const connection = seeded(['p2']);
    settleIntentOnce(connection, intent, () => ({
      kind: 'apply',
      events: [narrowEvent('secret', 'private', ['p1'])],
    }));
    expect(() =>
      settleIntentOnce(connection, { ...intent, playerId: 'p2' }, () => ({
        kind: 'apply',
        events: [],
      })),
    ).toThrow(IntentIdentityConflictError);
  });

  it('une intention qui échoue en écriture ne laisse ni ligne ni seq consommé', () => {
    const connection = seeded();
    expect(() =>
      settleIntentOnce(connection, intent, () => ({
        kind: 'apply',
        events: [tableEvent('ok'), { ...tableEvent('ko'), recipients: ['p1'] }],
      })),
    ).toThrow(/events_recipients_match_scope/u);

    expect(eventCount(connection)).toBe(0);
    expect(campaignSeq(connection, 'c1')).toBe(0);
    // L'intention non plus : le rejeu doit pouvoir la retenter.
    expect(getIntentStatus(connection, intent.id)).toBeUndefined();
  });
});

describe('la table, c’est les membres présents', () => {
  it('listMemberPlayerIds rend les membres non partis, triés', () => {
    const connection = twoPlayerJournal();
    expect(listMemberPlayerIds(connection, 'c1')).toEqual(['p1', 'p2']);
    connection.prepare(`UPDATE campaign_members SET left_at = ? WHERE player_id = 'p2'`).run(NOW);
    expect(listMemberPlayerIds(connection, 'c1')).toEqual(['p1']);
  });
});
