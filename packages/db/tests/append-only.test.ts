/**
 * The journal is append-only BY CONSTRAINT (section 1.3, section 5.2 rule 4).
 *
 * Three triggers carry it, and none of them survives the "temp table + copy +
 * rename" ritual drizzle-kit falls back on when SQLite cannot ALTER COLUMN —
 * which is exactly why this file exists and why the spec calls it a golden
 * test. It is also the one that proves invariant 4 has teeth: without
 * `events_seq_dense`, an event inserted outside the allocator leaves a silent
 * hole and the replay is quietly wrong.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { SqliteConnection } from '../src/client.js';
import type { TempDb } from '../src/testing.js';
import { allocateSeq, appendEvent, migratedTempDb, seedCampaign } from '../src/testing.js';

let open: TempDb | undefined;
afterEach(() => {
  open?.close();
  open = undefined;
});

/** A migrated file with one player and one campaign, closed after the test. */
function seeded(): SqliteConnection {
  const db = migratedTempDb();
  open = db;
  seedCampaign(db.connection, { playerId: 'p1', campaignId: 'c1' });
  return db.connection;
}

describe('les trois déclencheurs du journal', () => {
  it('existent après migration, nommés', () => {
    const connection = seeded();
    const names = (
      connection
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual(['events_no_delete', 'events_no_update', 'events_seq_dense']);
  });

  it('UPDATE events lève, et le message dit « append-only »', () => {
    const connection = seeded();
    appendEvent(connection, {
      id: 'e1',
      campaignId: 'c1',
      seq: allocateSeq(connection, 'c1'),
      type: 'campaign.created',
    });
    expect(() => connection.prepare(`UPDATE events SET type = 'x'`).run()).toThrow(/append-only/u);
  });

  it('DELETE FROM events lève, et le message dit « append-only »', () => {
    const connection = seeded();
    appendEvent(connection, {
      id: 'e1',
      campaignId: 'c1',
      seq: allocateSeq(connection, 'c1'),
      type: 'campaign.created',
    });
    expect(() => connection.prepare(`DELETE FROM events`).run()).toThrow(/append-only/u);
  });

  it('laisse passer un INSERT, lui — sinon le journal ne servirait à rien', () => {
    const connection = seeded();
    appendEvent(connection, {
      id: 'e1',
      campaignId: 'c1',
      seq: allocateSeq(connection, 'c1'),
      type: 'campaign.created',
    });
    const rows = connection.prepare('SELECT count(*) AS n FROM events').get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('events_seq_dense refuse un seq non alloué', () => {
    const connection = seeded();
    // `campaigns.seq` vaut 0 : aucun seq n'a été alloué.
    expect(() => {
      appendEvent(connection, {
        id: 'e1',
        campaignId: 'c1',
        seq: 7,
        type: 'campaign.created',
      });
    }).toThrow(/events\.seq must be allocated via campaigns\.seq/u);
  });

  it("events_seq_dense accepte le seq que l'allocateur vient de rendre", () => {
    const connection = seeded();
    const seq = allocateSeq(connection, 'c1');
    expect(seq).toBe(1);
    expect(() => {
      appendEvent(connection, { id: 'e1', campaignId: 'c1', seq, type: 'campaign.created' });
    }).not.toThrow();
  });
});

/**
 * ADR 0010 decision 5 in the DDL, plus the coherence CHECK this task added on
 * top of it (see `src/schema/events.ts` for why, and for what it does NOT
 * claim). Measured in both directions: the `table` scope refuses a recipient
 * list, the two narrow scopes refuse its absence, and the legal combinations
 * go through.
 */
describe('portée de visibilité et destinataires', () => {
  it('accepte « table » sans destinataires', () => {
    const connection = seeded();
    expect(() => {
      appendEvent(connection, {
        id: 'e1',
        campaignId: 'c1',
        seq: allocateSeq(connection, 'c1'),
        type: 'narration.gm_message',
        scope: 'table',
      });
    }).not.toThrow();
  });

  it('accepte « private » avec une liste de destinataires', () => {
    const connection = seeded();
    expect(() => {
      appendEvent(connection, {
        id: 'e1',
        campaignId: 'c1',
        seq: allocateSeq(connection, 'c1'),
        type: 'narration.gm_message',
        scope: 'private',
        recipientsJson: '["p1"]',
      });
    }).not.toThrow();
  });

  it('refuse une quatrième portée', () => {
    const connection = seeded();
    expect(() => {
      appendEvent(connection, {
        id: 'e1',
        campaignId: 'c1',
        seq: allocateSeq(connection, 'c1'),
        type: 'narration.gm_message',
        scope: 'whisper',
      });
    }).toThrow(/events_scope_enum/u);
  });

  it('refuse « subset » sans destinataires : ce tour ne serait pas rejouable par joueur', () => {
    const connection = seeded();
    expect(() => {
      appendEvent(connection, {
        id: 'e1',
        campaignId: 'c1',
        seq: allocateSeq(connection, 'c1'),
        type: 'narration.gm_message',
        scope: 'subset',
      });
    }).toThrow(/events_recipients_match_scope/u);
  });

  it('refuse « table » AVEC des destinataires', () => {
    const connection = seeded();
    expect(() => {
      appendEvent(connection, {
        id: 'e1',
        campaignId: 'c1',
        seq: allocateSeq(connection, 'c1'),
        type: 'narration.gm_message',
        scope: 'table',
        recipientsJson: '["p1"]',
      });
    }).toThrow(/events_recipients_match_scope/u);
  });
});
