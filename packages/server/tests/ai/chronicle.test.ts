/**
 * LE TRAVAILLEUR DE CHRONIQUE : un bail qui expire, un anti-rebond, et une
 * reconstruction tous les huit.
 *
 * Le bail est ce qui empêche un travailleur tué de laisser une campagne sans
 * mémoire longue POUR TOUJOURS. Les deux moitiés se mesurent sur une horloge
 * simulée, et il faut les DEUX : qu'un bail expiré soit repris, et qu'un bail
 * vivant ne le soit pas.
 */

import { describe, expect, it } from 'vitest';

import {
  CHRONICLE_DEBOUNCE_MS,
  CHRONICLE_LEASE_MS,
  CHRONICLE_REBUILD_EVERY,
  acquireChronicleLease,
  chronicleKindFor,
  chronicleLeaseHolder,
  compactChronicle,
  debounced,
  releaseChronicleLease,
} from '../../src/ai/chronicle-worker.js';
import { CAMPAIGN_ID, anAiTable, scriptedNarrator } from './support.test.js';

import type { ChronicleDoc } from '@for/contracts';
import type { Table } from '../game/support.test.js';

const EPOCH = 1_700_000_000_000;

const lease = (table: Table, workerId: string, now: number) =>
  acquireChronicleLease(table.connection, {
    campaignId: CAMPAIGN_ID,
    workerId,
    sourceEventSeq: 12,
    now,
  });

describe('le bail de régénération', () => {
  it('deux travailleurs ne régénèrent jamais la même campagne en même temps', () => {
    const table = anAiTable();
    try {
      // Le premier prend le bail.
      expect(lease(table, 'worker-a', EPOCH)?.workerId).toBe('worker-a');
      // Le second, DANS la fenêtre, est refusé — et le bail ne change pas de
      // main : c'est ce que lit la seconde assertion, sur la base.
      expect(lease(table, 'worker-b', EPOCH + 1000)).toBeNull();
      expect(chronicleLeaseHolder(table.connection, CAMPAIGN_ID)?.workerId).toBe('worker-a');
      expect(chronicleLeaseHolder(table.connection, CAMPAIGN_ID)?.attempt).toBe(1);
    } finally {
      table.close();
    }
  });

  it('un bail expiré est repris par un autre travailleur', () => {
    const table = anAiTable();
    try {
      expect(lease(table, 'worker-a', EPOCH)?.leaseExpiresAt).toBe(EPOCH + CHRONICLE_LEASE_MS);

      // UNE MILLISECONDE AVANT : toujours refusé.
      expect(lease(table, 'worker-b', EPOCH + CHRONICLE_LEASE_MS - 1)).toBeNull();

      // À L'ÉCHÉANCE : repris, et la tentative est incrémentée — c'est ce qui
      // rend un travailleur tué visible dans la table plutôt que muet.
      const taken = lease(table, 'worker-b', EPOCH + CHRONICLE_LEASE_MS);
      expect(taken?.workerId).toBe('worker-b');
      expect(taken?.attempt).toBe(2);
      expect(chronicleLeaseHolder(table.connection, CAMPAIGN_ID)?.workerId).toBe('worker-b');
    } finally {
      table.close();
    }
  });

  it('un travailleur qui finit rend le bail sans attendre son échéance', () => {
    const table = anAiTable();
    try {
      lease(table, 'worker-a', EPOCH);
      releaseChronicleLease(table.connection, CAMPAIGN_ID, 'worker-a');
      // Immédiatement disponible, sans avoir attendu dix minutes.
      expect(lease(table, 'worker-b', EPOCH + 1)?.workerId).toBe('worker-b');
    } finally {
      table.close();
    }
  });

  it('et un autre travailleur ne peut pas rendre un bail qui n’est pas le sien', () => {
    const table = anAiTable();
    try {
      lease(table, 'worker-a', EPOCH);
      releaseChronicleLease(table.connection, CAMPAIGN_ID, 'worker-b');
      // Le bail tient toujours : le `WHERE worker_id = ?` a mordu.
      expect(lease(table, 'worker-b', EPOCH + 1000)).toBeNull();
    } finally {
      table.close();
    }
  });
});

describe('les deux règles de cadence', () => {
  it('la huitième régénération est une reconstruction, les sept autres non', () => {
    // LES HUIT, une par une, en toutes lettres : un test qui vérifierait
    // « 8 % 8 === 0 » comparerait le chiffre à lui-même.
    expect(chronicleKindFor(1)).toBe('incremental');
    expect(chronicleKindFor(2)).toBe('incremental');
    expect(chronicleKindFor(3)).toBe('incremental');
    expect(chronicleKindFor(4)).toBe('incremental');
    expect(chronicleKindFor(5)).toBe('incremental');
    expect(chronicleKindFor(6)).toBe('incremental');
    expect(chronicleKindFor(7)).toBe('incremental');
    expect(chronicleKindFor(8)).toBe('rebuild');
    expect(chronicleKindFor(16)).toBe('rebuild');
    expect(CHRONICLE_REBUILD_EVERY).toBe(8);
  });

  it('l’anti-rebond bloque une minute, et pas une de plus', () => {
    expect(debounced(null, EPOCH)).toBe(false);
    expect(debounced(EPOCH, EPOCH + CHRONICLE_DEBOUNCE_MS - 1)).toBe(true);
    expect(debounced(EPOCH, EPOCH + CHRONICLE_DEBOUNCE_MS)).toBe(false);
  });
});

describe('une compaction', () => {
  const material = 'Rien de neuf sous le ciel du Freljord.';

  const emptyDoc: ChronicleDoc = {
    premise: 'Une bande traverse le Freljord.',
    arcs: [],
    characters: [],
    npcs: [],
    places: [],
    facts: [],
    open_threads: [],
    recent_digest: [],
  };

  it('écrit une version, et la ligne `ai_calls` qui va avec', async () => {
    const table = anAiTable();
    try {
      const narrator = scriptedNarrator({ answers: [], structured: [emptyDoc] });
      const outcome = await compactChronicle(
        { connection: table.connection, narrator, ids: table.ids, workerId: 'worker-a' },
        {
          campaignId: CAMPAIGN_ID,
          material,
          knownEventSeqs: new Set([1, 2, 3]),
          targetEventSeq: 3,
          reservedChampions: [],
          scene: null,
          now: EPOCH,
        },
      );
      expect(outcome).toEqual({ kind: 'written', version: 1, tokenCount: expect.any(Number) });

      const row = table.connection
        .prepare(`SELECT version, kind, source_event_seq FROM chronicles WHERE campaign_id = ?`)
        .get(CAMPAIGN_ID);
      expect(row).toEqual({ version: 1, kind: 'incremental', source_event_seq: 3 });

      const call = table.connection
        .prepare(`SELECT purpose, status FROM ai_calls ORDER BY rowid DESC LIMIT 1`)
        .get();
      expect(call).toEqual({ purpose: 'chronicle', status: 'ok' });

      // LE BAIL EST RENDU : un travailleur suivant peut reprendre tout de suite.
      expect(lease(table, 'worker-b', EPOCH + 1)?.workerId).toBe('worker-b');
    } finally {
      table.close();
    }
  });

  it('un bail pris ailleurs fait passer son tour, sans rien écrire', async () => {
    const table = anAiTable();
    try {
      lease(table, 'worker-a', EPOCH);
      const narrator = scriptedNarrator({ answers: [], structured: [emptyDoc] });
      const outcome = await compactChronicle(
        { connection: table.connection, narrator, ids: table.ids, workerId: 'worker-b' },
        {
          campaignId: CAMPAIGN_ID,
          material,
          knownEventSeqs: new Set([1]),
          targetEventSeq: 1,
          reservedChampions: [],
          scene: null,
          now: EPOCH + 1000,
        },
      );
      expect(outcome).toEqual({ kind: 'skipped', why: 'leased' });
      // RIEN N'A ÉTÉ DEMANDÉ AU PORT : passer son tour ne coûte pas un appel.
      expect(narrator.structureRequests).toHaveLength(0);
    } finally {
      table.close();
    }
  });

  it('une compaction trop récente fait passer son tour, elle aussi', async () => {
    const table = anAiTable();
    try {
      const narrator = scriptedNarrator({ answers: [], structured: [emptyDoc, emptyDoc] });
      const deps = {
        connection: table.connection,
        narrator,
        ids: table.ids,
        workerId: 'worker-a',
      };
      const input = {
        campaignId: CAMPAIGN_ID,
        material,
        knownEventSeqs: new Set([1]),
        targetEventSeq: 1,
        reservedChampions: [],
        scene: null,
        now: EPOCH,
      };
      expect((await compactChronicle(deps, input)).kind).toBe('written');
      expect(await compactChronicle(deps, { ...input, now: EPOCH + 1000 })).toEqual({
        kind: 'skipped',
        why: 'debounced',
      });
      // Une minute plus tard, elle repart.
      expect(
        (await compactChronicle(deps, { ...input, now: EPOCH + CHRONICLE_DEBOUNCE_MS })).kind,
      ).toBe('written');
      expect(narrator.structureRequests).toHaveLength(2);
    } finally {
      table.close();
    }
  });

  it('une panne du port laisse la version précédente en service', async () => {
    const table = anAiTable();
    try {
      const narrator = scriptedNarrator({
        answers: [],
        structured: [{ throws: Object.assign(new Error('coupé'), { code: 'unavailable' }) }],
      });
      const outcome = await compactChronicle(
        { connection: table.connection, narrator, ids: table.ids, workerId: 'worker-a' },
        {
          campaignId: CAMPAIGN_ID,
          material,
          knownEventSeqs: new Set([1]),
          targetEventSeq: 1,
          reservedChampions: [],
          scene: null,
          now: EPOCH,
        },
      );
      expect(outcome.kind).toBe('failed');
      expect(
        table.connection
          .prepare(`SELECT COUNT(*) AS n FROM chronicles WHERE campaign_id = ?`)
          .get(CAMPAIGN_ID),
      ).toEqual({ n: 0 });
      // LA LIGNE D'AUDIT PORTE LE CODE DU PORT, pas un message de fournisseur.
      const call = table.connection
        .prepare(`SELECT status, error_code FROM ai_calls ORDER BY rowid DESC LIMIT 1`)
        .get();
      expect(call).toEqual({ status: 'error', error_code: 'unavailable' });
      // ET LE BAIL EST RENDU malgré la panne : le `finally` a couru.
      expect(lease(table, 'worker-b', EPOCH + 1)?.workerId).toBe('worker-b');
    } finally {
      table.close();
    }
  });
});
