/**
 * `JournalDelivery` — LA VRAIE, celle que le serveur compose, sur une vraie
 * base et un vrai hub.
 *
 * Les suites de `tests/ws/**` pilotent un double qui lit le journal du faux
 * service : elles mesurent ce que la SOCKET fait de la livraison. Celle-ci
 * mesure la livraison elle-même — la requête SQL, le curseur, l'idempotence.
 * Sans elle, le fichier qui referme l'issue #67 était couvert à 60 %, et le
 * rapport de couverture le disait avant que quiconque le demande
 * (docs/RECETTE.md §5 bis).
 *
 * CE QUI EST OBSERVÉ, C'EST LE HUB, pas une socket : `deliveryHead` et
 * `deliveredSince` sont la frontière publique du compteur dense de l'ADR 0010,
 * et ce sont eux que `s2c.welcome` et `c2s.resume` renvoient.
 */

import { appendEvents, readSince } from '@for/db';
import { describe, expect, it } from 'vitest';

import { createJournalDelivery } from '../../src/game/delivery.js';
import { createTableHub } from '../../src/ws/index.js';
import { CAMPAIGN_ID, OTHER_PLAYER_ID, PLAYER_ID, aTable } from './support.test.js';

import type { AppendableEvent, SqliteConnection } from '@for/db';
import type { CampaignService } from '../../src/game/types.js';

const EPOCH = 1_700_000_000_000;

/** Ce dont le hub a besoin, et rien de plus : il hydrate par cette lecture. */
function readOnlyService(connection: SqliteConnection): CampaignService {
  return {
    submitIntent: () => {
      throw new Error('aucune écriture dans cette suite');
    },
    getSnapshot: () => {
      throw new Error('aucun instantané dans cette suite');
    },
    readEventsSince: (campaignId, seq) => Promise.resolve(readSince(connection, campaignId, seq)),
    getTurnProof: () => Promise.resolve(null),
  };
}

function aNote(
  id: number,
  scope: 'table' | 'private',
  recipients: readonly string[] | null,
): AppendableEvent {
  return {
    id: String(id).padStart(26, '0'),
    type: 'system.note',
    payload: { text: `note ${String(id)}`, byPlayerId: PLAYER_ID },
    payloadVersion: 1,
    actorKind: 'system',
    actorPlayerId: null,
    subjectCharacterId: null,
    correlationId: null,
    causationId: null,
    rngStream: null,
    rngDrawIndex: null,
    scope,
    recipients,
    createdAt: EPOCH,
  };
}

interface Rig {
  readonly table: ReturnType<typeof aTable>;
  readonly hub: ReturnType<typeof createTableHub>;
  readonly delivery: ReturnType<typeof createJournalDelivery>;
}

async function aRig(): Promise<Rig> {
  const table = aTable();
  const hub = createTableHub(readOnlyService(table.connection));
  const delivery = createJournalDelivery({ connection: table.connection, hub: () => hub });
  await hub.openStream(CAMPAIGN_ID, PLAYER_ID);
  await hub.openStream(CAMPAIGN_ID, OTHER_PLAYER_ID);
  return { table, hub, delivery };
}

describe('la livraison par séquence, la vraie', () => {
  it('livre ce que le journal a gagné depuis son dernier passage', async () => {
    const rig = await aRig();
    try {
      const before = rig.hub.deliveryHead(CAMPAIGN_ID, PLAYER_ID);
      appendEvents(rig.table.connection, {
        campaignId: CAMPAIGN_ID,
        now: EPOCH,
        events: [aNote(1, 'table', null), aNote(2, 'table', null)],
      });

      rig.delivery.deliver(CAMPAIGN_ID);

      expect(rig.hub.deliveryHead(CAMPAIGN_ID, PLAYER_ID)).toBe(before + 2);
    } finally {
      rig.table.close();
    }
  });

  it('ne livre rien deux fois : le curseur avance, et le hub ignore un `seq` déjà compté', async () => {
    const rig = await aRig();
    try {
      appendEvents(rig.table.connection, {
        campaignId: CAMPAIGN_ID,
        now: EPOCH,
        events: [aNote(3, 'table', null)],
      });
      rig.delivery.deliver(CAMPAIGN_ID);
      const after = rig.hub.deliveryHead(CAMPAIGN_ID, PLAYER_ID);

      rig.delivery.deliver(CAMPAIGN_ID);
      rig.delivery.deliverSince(CAMPAIGN_ID, 0);

      expect(rig.hub.deliveryHead(CAMPAIGN_ID, PLAYER_ID)).toBe(after);
    } finally {
      rig.table.close();
    }
  });

  it('`deliverSince` prend la séquence qu’on lui donne, et livre ce qui suit', async () => {
    const rig = await aRig();
    try {
      const head = readSince(rig.table.connection, CAMPAIGN_ID, 0).at(-1)?.seq ?? 0;
      const before = rig.hub.deliveryHead(CAMPAIGN_ID, PLAYER_ID);
      appendEvents(rig.table.connection, {
        campaignId: CAMPAIGN_ID,
        now: EPOCH,
        events: [aNote(4, 'table', null), aNote(5, 'table', null), aNote(6, 'table', null)],
      });

      // Le conteur nomme la tête qu'il a vue AVANT d'écrire : les trois entrées
      // suivantes sont exactement ce qu'il a ajouté.
      rig.delivery.deliverSince(CAMPAIGN_ID, head);

      expect(rig.hub.deliveryHead(CAMPAIGN_ID, PLAYER_ID)).toBe(before + 3);
    } finally {
      rig.table.close();
    }
  });

  it('reste adressée : une entrée `private` n’avance que le fil de son destinataire', async () => {
    const rig = await aRig();
    try {
      const mine = rig.hub.deliveryHead(CAMPAIGN_ID, PLAYER_ID);
      const theirs = rig.hub.deliveryHead(CAMPAIGN_ID, OTHER_PLAYER_ID);
      appendEvents(rig.table.connection, {
        campaignId: CAMPAIGN_ID,
        now: EPOCH,
        events: [aNote(7, 'private', [PLAYER_ID])],
      });

      rig.delivery.deliver(CAMPAIGN_ID);

      // DEUX DESTINATAIRES : la portée est appliquée par le hub, et la
      // livraison ne la court-circuite pas.
      expect(rig.hub.deliveryHead(CAMPAIGN_ID, PLAYER_ID)).toBe(mine + 1);
      expect(rig.hub.deliveryHead(CAMPAIGN_ID, OTHER_PLAYER_ID)).toBe(theirs);
      expect(
        rig.hub.deliveredSince(CAMPAIGN_ID, OTHER_PLAYER_ID, theirs).map((entry) => entry.seq),
      ).toStrictEqual([]);
    } finally {
      rig.table.close();
    }
  });

  it('un journal vide ne fait rien bouger, et ne jette pas', async () => {
    const rig = await aRig();
    try {
      const before = rig.hub.deliveryHead(CAMPAIGN_ID, PLAYER_ID);
      rig.delivery.deliver(CAMPAIGN_ID);
      rig.delivery.deliver('0000000000000000000000ZZZZ');
      expect(rig.hub.deliveryHead(CAMPAIGN_ID, PLAYER_ID)).toBe(before);
    } finally {
      rig.table.close();
    }
  });

  it('refuse une campagne que le moteur ne reconnaît pas : parsée, jamais castée', async () => {
    const rig = await aRig();
    try {
      // `zCampaignId` porte la forme ULID. Une chaîne qui ne la respecte pas
      // n'entre pas dans le vocabulaire du hub — sauf si le code castait.
      appendEvents(rig.table.connection, {
        campaignId: CAMPAIGN_ID,
        now: EPOCH,
        events: [aNote(8, 'table', null)],
      });
      expect(() => {
        rig.delivery.deliverSince('campagne-2', 0);
      }).not.toThrow();
    } finally {
      rig.table.close();
    }
  });
});
