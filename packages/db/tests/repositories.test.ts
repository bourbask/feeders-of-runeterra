/**
 * The five repositories that are not the journal: players, campaigns,
 * characters, chronicles, ai_calls.
 *
 * A SECOND TEST FILE where the task sheet prints one. `events-repo.test.ts`
 * carries the journal, the intent and the per-player replay; putting five more
 * tables in it would bury the three proofs that matter under CRUD. Declared as
 * a deviation from "Fichiers touchés" rather than slipped in.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { SqliteConnection } from '../src/client.js';
import { getAiCall, insertAiCall, listAiCalls } from '../src/repositories/aiCalls.js';
import { addMember, getCampaign, insertCampaign } from '../src/repositories/campaigns.js';
import {
  getCharacter,
  listCharacters,
  truncateForCampaign,
  upsertCharacter,
} from '../src/repositories/characters.js';
import { insertChronicle, latestChronicle } from '../src/repositories/chronicles.js';
import { appendEvents } from '../src/repositories/events.js';
import {
  getPlayer,
  getPlayerByDiscordUserId,
  touchLastSeen,
  upsertPlayer,
} from '../src/repositories/players.js';
import type { TempDb } from '../src/testing.js';
import { migratedTempDb } from '../src/testing.js';

const NOW = 1_700_000_000_000;

let open: TempDb | undefined;
afterEach(() => {
  open?.close();
  open = undefined;
});

function fresh(): SqliteConnection {
  const db = migratedTempDb();
  open = db;
  return db.connection;
}

function withCampaign(): SqliteConnection {
  const connection = fresh();
  upsertPlayer(connection, {
    id: 'p1',
    discordUserId: 'd1',
    discordUsername: 'kevin',
    createdAt: NOW,
  });
  insertCampaign(connection, {
    id: 'c1',
    slug: 'le-pacte-de-la-griffe',
    name: 'Le pacte de la griffe',
    ownerPlayerId: 'p1',
    contentPackVersion: '1.0.0',
    contentPackHash: 'sha256-x',
    rulesVersion: 1,
    reducerVersion: 1,
    rngSeed: 'deadbeef',
    createdAt: NOW,
  });
  return connection;
}

describe('players', () => {
  it('crée, relit par identifiant et par snowflake', () => {
    const connection = fresh();
    upsertPlayer(connection, {
      id: 'p1',
      discordUserId: 'd1',
      discordUsername: 'kevin',
      createdAt: NOW,
    });
    expect(getPlayer(connection, 'p1')?.discord_username).toBe('kevin');
    expect(getPlayerByDiscordUserId(connection, 'd1')?.id).toBe('p1');
    expect(getPlayer(connection, 'absent')).toBeUndefined();
    expect(getPlayerByDiscordUserId(connection, 'absent')).toBeUndefined();
  });

  /**
   * Le point qui compte : revenir par OAuth rafraîchit le pseudo et ne crée
   * PAS un second joueur. La cible du conflit est le snowflake, pas l'id.
   */
  it('le même snowflake avec un id neuf met à jour, il ne duplique pas', () => {
    const connection = fresh();
    upsertPlayer(connection, {
      id: 'p1',
      discordUserId: 'd1',
      discordUsername: 'kevin',
      createdAt: NOW,
    });
    upsertPlayer(connection, {
      id: 'p2',
      discordUserId: 'd1',
      discordUsername: 'kevin-renomme',
      createdAt: NOW + 1,
    });
    const count = connection.prepare(`SELECT count(*) AS n FROM players`).get() as { n: number };
    expect(count.n).toBe(1);
    expect(getPlayer(connection, 'p1')?.discord_username).toBe('kevin-renomme');
  });

  it('touchLastSeen écrit la date de dernière visite', () => {
    const connection = fresh();
    upsertPlayer(connection, {
      id: 'p1',
      discordUserId: 'd1',
      discordUsername: 'kevin',
      createdAt: NOW,
    });
    expect(getPlayer(connection, 'p1')?.last_seen_at).toBeNull();
    touchLastSeen(connection, 'p1', NOW + 9);
    expect(getPlayer(connection, 'p1')?.last_seen_at).toBe(NOW + 9);
  });
});

describe('campaigns', () => {
  it('naît avec un compteur de séquence à zéro', () => {
    const connection = withCampaign();
    const row = getCampaign(connection, 'c1');
    expect(row?.seq).toBe(0);
    expect(row?.status).toBe('draft');
    expect(getCampaign(connection, 'absente')).toBeUndefined();
  });

  it('un membre ajouté deux fois casse sur l’index unique', () => {
    const connection = withCampaign();
    addMember(connection, { id: 'm1', campaignId: 'c1', playerId: 'p1', joinedAt: NOW });
    expect(() => {
      addMember(connection, { id: 'm2', campaignId: 'c1', playerId: 'p1', joinedAt: NOW });
    }).toThrow(/UNIQUE constraint failed: campaign_members\.campaign_id/u);
  });
});

describe('characters — une projection, pas une source', () => {
  const base = {
    id: 'ch1',
    campaignId: 'c1',
    playerId: 'p1',
    championId: 'braum',
    displayName: 'Le gardien du pont',
    sheetSource: 'handwritten' as const,
    sheetRef: 'content:champions/braum@1.0.0',
    sheetSnapshot: { voice: 'chaleureuse' },
    attrVif: 1,
    attrCoeur: 3,
    attrFer: 2,
    attrOmbre: 1,
    attrEsprit: 2,
    createdSeq: 1,
    updatedSeq: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('écrit puis remplace la ligne entière', () => {
    const connection = withCampaign();
    upsertCharacter(connection, base);
    expect(getCharacter(connection, 'ch1')?.vigueur).toBe(5);

    upsertCharacter(connection, { ...base, vigueur: 2, updatedSeq: 12, updatedAt: NOW + 1 });
    const row = getCharacter(connection, 'ch1');
    expect(row?.vigueur).toBe(2);
    expect(row?.updated_seq).toBe(12);
    // `created_seq` n'est pas réécrit : la naissance est un fait du journal.
    expect(row?.created_seq).toBe(1);
    expect(listCharacters(connection, 'c1')).toHaveLength(1);
  });

  it('les bornes du DDL abattent une jauge hors plage', () => {
    const connection = withCampaign();
    expect(() => {
      upsertCharacter(connection, { ...base, vigueur: 9 });
    }).toThrow(/characters_vigueur_range/u);
    expect(getCharacter(connection, 'ch1')).toBeUndefined();
  });

  /**
   * La zone C est jetable : c'est ce qui rend `db:rebuild` possible, et donc
   * l'invariant 4 vérifiable. Le journal, lui, ne bouge pas.
   */
  it('truncateForCampaign vide la projection et laisse le journal intact', () => {
    const connection = withCampaign();
    appendEvents(connection, {
      campaignId: 'c1',
      events: [
        {
          id: 'e1',
          type: 'character.created',
          payload: {},
          actorKind: 'system',
          scope: 'table',
          createdAt: NOW,
        },
      ],
      now: NOW,
    });
    upsertCharacter(connection, base);
    expect(truncateForCampaign(connection, 'c1')).toBe(1);
    expect(listCharacters(connection, 'c1')).toHaveLength(0);
    const events = connection.prepare(`SELECT count(*) AS n FROM events`).get() as { n: number };
    expect(events.n).toBe(1);
  });
});

describe('chronicles — la mémoire longue', () => {
  const base = {
    campaignId: 'c1',
    sourceEventSeq: 40,
    doc: { chapters: [] },
    renderedMd: '# Le pacte',
    model: 'stub-1',
    promptVersion: 'chronicle/1.0.0',
    createdAt: NOW,
  };

  it('numérote les versions de 1 en 1 et rend la plus récente', () => {
    const connection = withCampaign();
    expect(insertChronicle(connection, { ...base, id: 'k1' })).toBe(1);
    expect(insertChronicle(connection, { ...base, id: 'k2', sourceEventSeq: 80 })).toBe(2);
    const live = latestChronicle(connection, 'c1');
    expect(live?.version).toBe(2);
    expect(live?.source_event_seq).toBe(80);
    expect(latestChronicle(connection, 'absente')).toBeUndefined();
  });

  it('deux versions identiques cassent sur l’index unique', () => {
    const connection = withCampaign();
    insertChronicle(connection, { ...base, id: 'k1' });
    expect(() => {
      connection
        .prepare(
          `INSERT INTO chronicles
             (id, campaign_id, version, kind, source_event_seq, doc_json, rendered_md,
              token_count, model, prompt_version, created_at)
           VALUES ('k2', 'c1', 1, 'incremental', 40, '{}', '#', 0, 'stub-1', 'v', ?)`,
        )
        .run(NOW);
    }).toThrow(/UNIQUE constraint failed: chronicles\.campaign_id/u);
  });
});

describe('ai_calls — un journal de coûts, jamais une entrée des règles', () => {
  const base = {
    id: 'a1',
    purpose: 'narration' as const,
    provider: 'stub' as const,
    model: 'stub-1',
    promptVersion: 'narration/1.0.0',
    systemHash: 'sha256-y',
    status: 'ok' as const,
    createdAt: NOW,
  };

  it('écrit et relit un appel, avec ou sans campagne', () => {
    const connection = withCampaign();
    insertAiCall(connection, { ...base, campaignId: 'c1', inputTokens: 900 });
    insertAiCall(connection, { ...base, id: 'a2' });
    expect(getAiCall(connection, 'a1')?.input_tokens).toBe(900);
    expect(getAiCall(connection, 'a2')?.campaign_id).toBeNull();
    expect(getAiCall(connection, 'absent')).toBeUndefined();
    expect(listAiCalls(connection, 'c1')).toHaveLength(1);
  });

  it('refuse un fournisseur hors de l’énumération du DDL', () => {
    const connection = withCampaign();
    expect(() => {
      insertAiCall(connection, {
        ...base,
        provider: 'gemini' as unknown as 'stub',
      });
    }).toThrow(/ai_calls_provider_enum/u);
  });
});
