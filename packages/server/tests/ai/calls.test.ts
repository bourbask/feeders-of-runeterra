/**
 * `ai_calls`, le coupe-circuit et la politique de relance.
 *
 * ── UN CRITÈRE FAUX PAR CONSTRUCTION, SIGNALÉ ICI AUSSI ────────────────────
 * La fiche demande que « `error_code` pris dans `NarratorErrorCode` […] un
 * code hors énumération : l'insertion échoue sur la contrainte `CHECK` ». Il
 * n'y a AUCUN `CHECK` sur `ai_calls.error_code` — `schema.expected.sql` le
 * déclare `error_code text`, nu, et seule `finish_reason` porte l'énumération.
 * Le test « la contrainte annoncée sur `error_code` n'existe pas » le lit dans
 * le schéma attendu, pour que l'écart soit une mesure et pas une affirmation.
 * Ce que le dépôt a à la place est dans `src/ai/calls.ts`, et il est mesuré
 * dans les deux sens.
 */

import { NARRATE_FINISHES, NARRATOR_ERROR_CODES } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import {
  AiCallVocabularyViolation,
  BACKOFF_CEILING_MS,
  BREAKER_FAILURES_MAX,
  BREAKER_OPEN_MS,
  NarratorBreaker,
  ZERO_USAGE,
  backoffMs,
  narratorErrorCodeOf,
  narratorPlan,
  recordAiCall,
  tokenSpendSince,
} from '../../src/ai/calls.js';
import { CAMPAIGN_ID, anAiTable } from './support.test.js';

import type { NarratorErrorCode } from '@for/contracts';
import type { AiCallRecord } from '../../src/ai/calls.js';

const EPOCH = 1_700_000_000_000;

const aRecord = (over: Partial<AiCallRecord> = {}): AiCallRecord => ({
  id: `call-${String(Math.random()).slice(2)}`,
  campaignId: CAMPAIGN_ID,
  purpose: 'narration',
  provider: 'stub',
  model: 'stub:narration',
  promptVersion: 'conteur/2.1.0',
  systemHash: 'abc',
  status: 'ok',
  usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 900, cacheWriteTokens: 40 },
  latencyMs: 120,
  trimLevel: 0,
  finishReason: 'complete',
  createdAt: EPOCH,
  ...over,
});

describe('la ligne ai_calls', () => {
  it('porte le fournisseur, le modèle, les QUATRE compteurs et le motif de fin', () => {
    const table = anAiTable();
    try {
      recordAiCall(table.connection, aRecord({ id: 'call-1' }));
      const row = table.connection
        .prepare(`SELECT * FROM ai_calls WHERE id = ?`)
        .get('call-1') as Record<string, unknown>;

      // LES QUATRE, un par un et en toutes lettres : un test qui n'en lirait
      // que deux laisserait le cache invisible (§7.3).
      expect(row['provider']).toBe('stub');
      expect(row['model']).toBe('stub:narration');
      expect(row['input_tokens']).toBe(1200);
      expect(row['output_tokens']).toBe(300);
      expect(row['cache_read_tokens']).toBe(900);
      expect(row['cache_write_tokens']).toBe(40);
      expect(row['finish_reason']).toBe('complete');
      expect(row['error_code']).toBeNull();
    } finally {
      table.close();
    }
  });

  it('un `finish_reason` hors énumération est refusé par la contrainte CHECK de SQLite', () => {
    const table = anAiTable();
    try {
      // LA SONDE : l'adaptateur simulé rend un mot d'aucune énumération.
      expect(() => {
        recordAiCall(
          table.connection,
          aRecord({ id: 'call-2', finishReason: 'stop_sequence' as never }),
        );
      }).toThrow(/CHECK constraint failed/u);

      // ET DANS L'AUTRE SENS : les cinq mots du port passent.
      for (const finish of NARRATE_FINISHES) {
        expect(() => {
          recordAiCall(table.connection, aRecord({ id: `ok-${finish}`, finishReason: finish }));
        }).not.toThrow();
      }
    } finally {
      table.close();
    }
  });

  it('un `error_code` hors énumération est refusé avant l’insertion', () => {
    const table = anAiTable();
    try {
      expect(() => {
        recordAiCall(
          table.connection,
          aRecord({ id: 'call-3', status: 'error', errorCode: 'HTTP_429' as never }),
        );
      }).toThrow(AiCallVocabularyViolation);
      // Rien n'a été écrit : le refus précède l'insertion.
      expect(
        table.connection.prepare(`SELECT COUNT(*) AS n FROM ai_calls WHERE id = ?`).get('call-3'),
      ).toEqual({ n: 0 });

      // ET LES QUATORZE CODES DU PORT PASSENT.
      for (const code of NARRATOR_ERROR_CODES) {
        expect(() => {
          recordAiCall(
            table.connection,
            aRecord({ id: `err-${code}`, status: 'error', errorCode: code }),
          );
        }).not.toThrow();
      }
    } finally {
      table.close();
    }
  });

  it('la contrainte annoncée sur `error_code` n’existe pas — signalé, pas contourné', () => {
    // LE CRITÈRE EST FAUX PAR CONSTRUCTION pour cette colonne, et c'est la
    // BASE MIGRÉE qui le dit — pas un document, pas une affirmation. Le jour
    // où une migration ajoute la contrainte, CE test tombe, et c'est
    // exactement ce qu'on veut : le signalement a une date de péremption.
    const table = anAiTable();
    try {
      const row = table.connection
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ai_calls'`)
        .get() as { sql: string };
      expect(row.sql).toContain('ai_calls_finish_reason_enum');
      expect(row.sql).not.toContain('ai_calls_error_code_enum');
      // La colonne est déclarée NUE : le mot `error_code` n'apparaît qu'une
      // fois dans tout le DDL de la table, donc nulle part dans un `CHECK`.
      expect(row.sql.split('error_code')).toHaveLength(2);
    } finally {
      table.close();
    }
  });

  it('le compteur de coût lit la base, et ne compte pas le cache lu comme facturé', () => {
    const table = anAiTable();
    try {
      recordAiCall(table.connection, aRecord({ id: 'c1', createdAt: EPOCH }));
      recordAiCall(table.connection, aRecord({ id: 'c2', createdAt: EPOCH + 1000 }));
      // Hors fenêtre : ne doit rien ajouter.
      recordAiCall(table.connection, aRecord({ id: 'c0', createdAt: EPOCH - 10_000 }));

      const spend = tokenSpendSince(table.connection, CAMPAIGN_ID, EPOCH);
      expect(spend.inputTokens).toBe(2400);
      expect(spend.outputTokens).toBe(600);
      expect(spend.cacheReadTokens).toBe(1800);
      expect(spend.cacheWriteTokens).toBe(80);
      // DEUX ORIGINES : la somme facturée est input + output + écriture de
      // cache, et le cache LU en est absent — sinon un cache qui marche
      // ressemblerait à un dépassement.
      expect(spend.billedTokens).toBe(2400 + 600 + 80);
    } finally {
      table.close();
    }
  });

  it('`ZERO_USAGE` porte bien quatre zéros', () => {
    expect(ZERO_USAGE).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });
});

describe('la politique de relance, écrite contre le port', () => {
  const plan = (code: NarratorErrorCode, attempt = 1, retryAfterMs: number | null = null) =>
    narratorPlan({ code, retryAfterMs, attempt, jitter: 0.5 });

  it('`quota_exhausted` n’est JAMAIS relancé', () => {
    expect(plan('quota_exhausted')).toEqual({ kind: 'give_up' });
    expect(plan('quota_exhausted', 0)).toEqual({ kind: 'give_up' });
  });

  it('`bad_request` n’est JAMAIS relancé', () => {
    expect(plan('bad_request')).toEqual({ kind: 'give_up' });
  });

  it('`rate_limited` respecte `retryAfterMs` quand le fournisseur en donne un', () => {
    // LE CHIFFRE VIENT DU FOURNISSEUR, pas du backoff : 3 000 n'est aucune
    // valeur que `backoffMs` puisse produire au premier essai (500 ± 20 %).
    expect(plan('rate_limited', 1, 3000)).toEqual({ kind: 'retry', waitMs: 3000 });
    // Sans en-tête, c'est le backoff — et jamais 3 000.
    expect(plan('rate_limited', 1)).toEqual({ kind: 'retry', waitMs: 500 });
  });

  it('`timeout` a UNE relance, `rate_limited` en a deux', () => {
    expect(plan('timeout', 1).kind).toBe('give_up');
    expect(plan('rate_limited', 1).kind).toBe('retry');
    expect(plan('rate_limited', 2).kind).toBe('give_up');
  });

  it('`context_too_large` redescend d’un cran, il ne renvoie pas la même requête', () => {
    expect(plan('context_too_large', 1)).toEqual({ kind: 'retrim' });
    expect(plan('context_too_large', 2)).toEqual({ kind: 'give_up' });
  });

  it('la politique se décide sur le code du port, pas sur un statut HTTP', () => {
    // LES QUATORZE, parcourus : aucun ne tombe dans un cas non prévu, et les
    // seuls relancés sont les trois que le port déclare relançables.
    const retried = NARRATOR_ERROR_CODES.filter((code) => plan(code, 1).kind === 'retry');
    expect([...retried]).toEqual(['rate_limited', 'unavailable']);
    // `timeout` est relançable mais avec un plafond de un : à l'essai ZÉRO il
    // l'est aussi, et c'est ce qui le distingue d'un `give_up` sec.
    expect(plan('timeout', 0).kind).toBe('retry');
  });

  it('le backoff double, jitte de ±20 %, et plafonne à 4 s', () => {
    expect(backoffMs(1, 0.5)).toBe(500);
    expect(backoffMs(2, 0.5)).toBe(1000);
    expect(backoffMs(3, 0.5)).toBe(2000);
    expect(backoffMs(9, 0.5)).toBe(BACKOFF_CEILING_MS);
    // Le jitter mord, dans les deux sens, et il est INJECTÉ : la valeur est
    // une valeur, pas une humeur.
    expect(backoffMs(1, 0)).toBe(400);
    expect(backoffMs(1, 0.999)).toBe(600);
  });

  it('`narratorErrorCodeOf` ne rend que des mots du port', () => {
    expect(narratorErrorCodeOf({ code: 'rate_limited' })).toBe('rate_limited');
    expect(narratorErrorCodeOf({ code: 'HTTP_500' })).toBe('internal');
    expect(narratorErrorCodeOf(new Error('rien'))).toBe('internal');
    expect(narratorErrorCodeOf(null)).toBe('internal');
  });
});

describe('le coupe-circuit', () => {
  it('un `quota_exhausted` arme le mode dégradé IMMÉDIATEMENT', () => {
    const breaker = new NarratorBreaker();
    expect(breaker.isOpen(CAMPAIGN_ID, EPOCH)).toBe(false);
    expect(breaker.recordFailure(CAMPAIGN_ID, 'quota_exhausted', EPOCH)).toBe(true);
    expect(breaker.isOpen(CAMPAIGN_ID, EPOCH)).toBe(true);
    // Un seul échec a suffi : le compteur n'a pas eu besoin d'atteindre cinq.
    expect(breaker.state(CAMPAIGN_ID).consecutiveFailures).toBe(1);
  });

  it('cinq échecs consécutifs arment, quatre ne suffisent pas', () => {
    const breaker = new NarratorBreaker();
    for (let index = 1; index < BREAKER_FAILURES_MAX; index += 1) {
      expect(breaker.recordFailure(CAMPAIGN_ID, 'unavailable', EPOCH)).toBe(false);
    }
    expect(breaker.isOpen(CAMPAIGN_ID, EPOCH)).toBe(false);
    expect(breaker.recordFailure(CAMPAIGN_ID, 'unavailable', EPOCH)).toBe(true);
    expect(breaker.isOpen(CAMPAIGN_ID, EPOCH)).toBe(true);
  });

  it('la fenêtre se referme après soixante secondes, et un succès la ferme tout de suite', () => {
    const breaker = new NarratorBreaker();
    breaker.recordFailure(CAMPAIGN_ID, 'quota_exhausted', EPOCH);
    expect(breaker.isOpen(CAMPAIGN_ID, EPOCH + BREAKER_OPEN_MS - 1)).toBe(true);
    expect(breaker.isOpen(CAMPAIGN_ID, EPOCH + BREAKER_OPEN_MS)).toBe(false);

    breaker.recordFailure(CAMPAIGN_ID, 'quota_exhausted', EPOCH);
    breaker.recordSuccess(CAMPAIGN_ID);
    expect(breaker.isOpen(CAMPAIGN_ID, EPOCH)).toBe(false);
    expect(breaker.state(CAMPAIGN_ID).consecutiveFailures).toBe(0);
  });

  it('DEUX CAMPAGNES : celle qui échoue n’éteint pas celle qui va bien', () => {
    const breaker = new NarratorBreaker();
    breaker.recordFailure('campagne-a', 'quota_exhausted', EPOCH);
    expect(breaker.isOpen('campagne-a', EPOCH)).toBe(true);
    expect(breaker.isOpen('campagne-b', EPOCH)).toBe(false);
  });
});
