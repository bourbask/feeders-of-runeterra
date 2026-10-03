/**
 * LE REFUS D'UNE RÈGLE ATTEINT LE JOUEUR — issue #66.
 *
 * `CampaignService.submitIntent` a TROIS réponses, pas deux :
 *
 *   1. `err(AppError)`        — le serveur n'a pas pu servir la demande ;
 *   2. `ok({ accepted: false, rejection })` — les règles ont dit non, et ce
 *      non fait partie de la fiction ;
 *   3. `ok({ accepted: true })`.
 *
 * `ws/handlers.ts::submit` ne répondait que sur la première. Un joueur dont le
 * mouvement était refusé par une règle ne recevait RIEN : son intention
 * disparaissait. Deux scénarios du simulateur le reproduisaient — `03` étape 4
 * (`target_not_present`) et `06` étape 2 (`move_in_progress`) —, et
 * `zRejectionCode`, qui existe précisément pour porter l'une OU l'autre
 * famille, n'était atteint par aucun chemin.
 *
 * LES DEUX CODES VIENNENT DE L'ISSUE, écrits en toutes lettres, et ils sont
 * confrontés à l'UNION FERMÉE `RULE_VIOLATION_CODES` du moteur : deux
 * origines. Un code inventé ici ne serait pas dans l'union ; une union rognée
 * ne contiendrait plus ces deux-là.
 *
 * LES DEUX FAMILLES NE SONT PAS FUSIONNÉES, et c'est la seconde direction de
 * la mesure : une erreur technique garde son propre code, qui appartient à
 * `APP_ERROR_CODES` et non à l'union des règles.
 */

import { APP_ERROR_CODES, zRejectionCode } from '@for/contracts';
import { RULE_VIOLATION_CODES } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { ALICE, Table, c2s } from './support/harness.test.js';

/** Les deux codes que l'issue #66 nomme, scénario par scénario. */
const SCENARIO_03_STEP_4 = 'target_not_present';
const SCENARIO_06_STEP_2 = 'move_in_progress';

/** Une intention que `zIntent` accepte : la forme n'est pas le sujet ici. */
const AN_INTENT = { type: 'play_session.begin' } as const;

describe('un refus de règle est une réponse, jamais un silence (#66)', () => {
  it('un refus de règle devient `s2c.rejected`, avec le code de la règle', async () => {
    const table = new Table();
    table.service.rejectWith = { code: SCENARIO_03_STEP_4, details: {} };

    const alice = await table.join(ALICE);
    alice.socket.clear();
    const intentId = table.nextFrameId();
    await alice.connection.receive(c2s('c2s.intent', { intent: AN_INTENT }, intentId));

    const rejected = alice.socket.of('s2c.rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.p['code']).toBe(SCENARIO_03_STEP_4);
    // Et il nomme la trame qu'il refuse : sans ça le client ne sait pas quel
    // geste est tombé.
    expect(rejected[0]?.p['intentId']).toBe(intentId);
  });

  it('le second scénario du simulateur aussi : `move_in_progress`', async () => {
    const table = new Table();
    table.service.rejectWith = { code: SCENARIO_06_STEP_2, details: { rollId: 'x' } };

    const alice = await table.join(ALICE);
    alice.socket.clear();
    await alice.connection.receive(c2s('c2s.intent', { intent: AN_INTENT }, table.nextFrameId()));

    expect(alice.socket.of('s2c.rejected')[0]?.p['code']).toBe(SCENARIO_06_STEP_2);
  });

  it("les deux codes appartiennent à l'union fermée du moteur, et au vocabulaire du refus", () => {
    // DEUX OPÉRANDES, DEUX ORIGINES : l'issue d'un côté, le moteur de l'autre.
    expect(RULE_VIOLATION_CODES).toContain(SCENARIO_03_STEP_4);
    expect(RULE_VIOLATION_CODES).toContain(SCENARIO_06_STEP_2);
    expect(zRejectionCode.safeParse(SCENARIO_03_STEP_4).success).toBe(true);
    expect(zRejectionCode.safeParse(SCENARIO_06_STEP_2).success).toBe(true);
  });

  it("un refus de règle n'écrit aucun `s2c.event` : rien ne s'est passé", async () => {
    const table = new Table();
    table.service.rejectWith = { code: SCENARIO_03_STEP_4, details: {} };

    const alice = await table.join(ALICE);
    alice.socket.clear();
    await alice.connection.receive(c2s('c2s.intent', { intent: AN_INTENT }, table.nextFrameId()));

    expect(alice.socket.of('s2c.event')).toHaveLength(0);
    expect(alice.socket.of('s2c.error')).toHaveLength(0);
  });

  it('et une erreur technique garde son propre code : les deux familles ne sont pas fusionnées', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    // `campaign.leave` est ce que le faux service refuse par une `AppError`.
    await alice.connection.receive(
      c2s('c2s.intent', { intent: { type: 'campaign.leave' } }, table.nextFrameId()),
    );

    const code = alice.socket.of('s2c.rejected')[0]?.p['code'];
    expect(APP_ERROR_CODES).toContain(code);
    expect(RULE_VIOLATION_CODES).not.toContain(code);
  });

  it('la parole passe par le même chemin : un refus de règle sur `c2s.speak` se voit aussi', async () => {
    const table = new Table();
    table.service.rejectWith = { code: SCENARIO_06_STEP_2, details: {} };

    const alice = await table.join(ALICE);
    alice.socket.clear();
    await alice.connection.receive(
      c2s('c2s.speak', { channel: 'ic', text: 'Je parle.' }, table.nextFrameId()),
    );

    expect(alice.socket.of('s2c.rejected')[0]?.p['code']).toBe(SCENARIO_06_STEP_2);
  });
});
