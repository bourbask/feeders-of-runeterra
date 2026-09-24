import { describe, expect, it } from 'vitest';

import { zRuleViolationCode } from './core/enums.js';
import { APP_ERROR_CODES, zAppErrorCode, zAppErrorPayload } from './errors.js';

describe('AppErrorCode — l’union fermée du serveur', () => {
  it('ne porte aucun doublon', () => {
    expect(new Set(APP_ERROR_CODES).size).toBe(APP_ERROR_CODES.length);
  });

  it('refuse un code hors de la liste', () => {
    expect(zAppErrorCode.safeParse('internal_error').success).toBe(true);
    expect(zAppErrorCode.safeParse('boom').success).toBe(false);
  });

  it('ne recouvre jamais un code de violation de règle', () => {
    // Deux familles, jamais mélangées : une AppError dit que la requête n'a
    // pas pu être servie, jamais ce qui s'est passé dans la fiction.
    const violations = new Set<string>(zRuleViolationCode.options);
    for (const code of APP_ERROR_CODES) {
      expect(violations.has(code), `${code} appartient aux deux unions`).toBe(false);
    }
  });

  it('porte les trois codes que 01-architecture.md §3.3 nomme', () => {
    for (const code of ['ai_unavailable', 'ai_invalid_output', 'internal_error']) {
      expect(zAppErrorCode.safeParse(code).success).toBe(true);
    }
  });
});

describe('zAppErrorPayload — ce qui atteint le client', () => {
  const payload = {
    code: 'validation_failed',
    message: 'La requête est invalide.',
    requestId: 'req-1',
  };

  it('accepte code, message et requestId', () => {
    expect(zAppErrorPayload.safeParse(payload).success).toBe(true);
  });

  it('accepte un intentId en UUID', () => {
    const result = zAppErrorPayload.safeParse({
      ...payload,
      intentId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    });
    expect(result.success).toBe(true);
  });

  it('refuse un message vide', () => {
    expect(zAppErrorPayload.safeParse({ ...payload, message: '' }).success).toBe(false);
  });

  it('ne transporte pas les détails de diagnostic', () => {
    // `details` reste dans le log (01-architecture.md §3.3).
    const parsed = zAppErrorPayload.parse({ ...payload, details: { stack: 'secret' } });
    expect(Object.keys(parsed)).not.toContain('details');
  });
});
