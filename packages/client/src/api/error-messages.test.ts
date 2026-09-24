import { APP_ERROR_CODES, zRuleViolationCode } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import {
  APP_ERROR_MESSAGES,
  RULE_VIOLATION_MESSAGES,
  UNKNOWN_CODE_MESSAGE,
  appErrorMessage,
  rejectionMessage,
} from './error-messages.js';

// LA SOURCE DE LA BOUCLE EST CELLE DES CONTRATS, PAS CELLE D'ICI. Parcourir
// `Object.keys(APP_ERROR_MESSAGES)` serait une liste qui est sa propre source :
// la vider ne ferait rien echouer. Ces deux enumerations viennent de
// `@for/contracts`, donc un code ajoute en amont rend ce fichier rouge.
describe('les messages couvrent les deux vocabulaires fermes', () => {
  it.each([...zRuleViolationCode.options])('« %s » a une phrase de refus', (code) => {
    expect(RULE_VIOLATION_MESSAGES[code]).toBeTypeOf('string');
    expect(rejectionMessage(code)).not.toBe(UNKNOWN_CODE_MESSAGE);
  });

  it.each([...APP_ERROR_CODES])('« %s » a une phrase d’erreur', (code) => {
    expect(APP_ERROR_MESSAGES[code]).toBeTypeOf('string');
    expect(appErrorMessage(code)).not.toBe(UNKNOWN_CODE_MESSAGE);
  });

  it('les deux familles ne se recouvrent pas', () => {
    const chevauchement = zRuleViolationCode.options.filter((code) => code in APP_ERROR_MESSAGES);
    expect(chevauchement).toEqual([]);
  });

  it('un code inconnu ne fait pas tomber l’affichage', () => {
    expect(rejectionMessage('ce_code_n_existe_pas' as never)).toBe(UNKNOWN_CODE_MESSAGE);
  });
});
