import { ASSERTIONS, HARD_ASSERTIONS } from '@for/ai';
import { describe, expect, it } from 'vitest';

import { loadProbeCases } from './cases.js';
import {
  PREMISES,
  contextFor,
  gradeSample,
  missingPremises,
  readAnswer,
  type Reading,
} from './grading.js';
import { buildTurn, requestText } from './run-probe.js';

const cases = loadProbeCases();

/**
 * Somebody the ENGINE has in the scene and the brief's list does not carry.
 * NOT `Ulrun`: the system prompt names him in its worked example, so a probe
 * built on `Ulrun` would be red on the prompt rather than on the perception
 * channel — `packages/ai/tests/fixtures.ts` measured that and says so.
 */
const HORS_BRIEF = 'Yrsa';
const withPrice = cases.find((probeCase) => probeCase.priceKeywords !== null)!;
const withoutPrice = cases.find((probeCase) => probeCase.priceKeywords === null)!;

const GOOD_PROSE =
  'Tu poses la main à plat sur la glace et le froid mord jusqu’à l’os. La corde file entre tes doigts. Ulrun se lève sans un mot.';

const stateOf = (grades: readonly { id: string; state: string }[], id: string): string =>
  grades.find((grade) => grade.id === id)?.state ?? 'absent';

describe('la notation de la sonde', () => {
  it('note avec les seize assertions dures de @for/ai, et avec aucune autre', () => {
    // Sixteen is the sheet's number, written in full letters here and compared
    // to what `@for/ai` builds — two paths, never one (ADR 0007).
    expect(HARD_ASSERTIONS.length).toBe(16);
    const grades = gradeSample(withPrice, readAnswer(GOOD_PROSE, withPrice));
    expect(grades.map((grade) => grade.id)).toEqual(HARD_ASSERTIONS.map((rule) => rule.id));
    for (const grade of grades) expect(Object.keys(ASSERTIONS)).toContain(grade.id);
  });

  it('un bloc absent rend scene_block_consistent sans objet, pas réussie', () => {
    const reading = readAnswer(GOOD_PROSE, withPrice);
    expect(reading.sceneBlock).toBeNull();
    expect(stateOf(gradeSample(withPrice, reading), 'scene_block_consistent')).toBe(
      'not_applicable',
    );
  });

  it('et un bloc présent la rend applicable — réussie ici, tombée si un parti revient', () => {
    const block = [
      GOOD_PROSE,
      '<scene_apres>',
      '{"lieu":"col_des_hurleurs","presents":[{"nom":"Ulrun","etat":"debout"}],"partis":[],"refus":null}',
      '</scene_apres>',
    ].join('\n');
    const ok = readAnswer(block, withPrice);
    expect(ok.sceneBlock).not.toBeNull();
    expect(stateOf(gradeSample(withPrice, ok), 'scene_block_consistent')).toBe('passed');

    const walkedBack = block.replace('"nom":"Ulrun"', '"nom":"Keld"');
    const bad = readAnswer(walkedBack, withPrice);
    expect(stateOf(gradeSample(withPrice, bad), 'scene_block_consistent')).toBe('failed');
  });

  it('price_respected est sans objet sur un tour sans prix, et notée sur un tour qui en porte un', () => {
    expect(withoutPrice.priceKeywords).toBeNull();
    expect(
      stateOf(gradeSample(withoutPrice, readAnswer(GOOD_PROSE, withoutPrice)), 'price_respected'),
    ).toBe('not_applicable');
    // The same prose, on the priced case: « froid » and « mord » are the
    // entry's own keywords, so the rule has something to say and says yes.
    expect(
      stateOf(gradeSample(withPrice, readAnswer(GOOD_PROSE, withPrice)), 'price_respected'),
    ).toBe('passed');
  });

  it('une prose qui esquive le prix tombe, et ce n’est pas « sans objet »', () => {
    const dodged =
      'Tu montes la paroi sans trembler. Mais tu en ressors indemne, et rien ne te touche. Ulrun te regarde passer.';
    expect(stateOf(gradeSample(withPrice, readAnswer(dodged, withPrice)), 'price_respected')).toBe(
      'failed',
    );
  });

  it('un champion réservé nommé dans la prose tombe, sous son nom comme sous son alias', () => {
    const named = `${GOOD_PROSE} Ashe attend plus bas.`;
    expect(
      stateOf(gradeSample(withPrice, readAnswer(named, withPrice)), 'no_reserved_champion'),
    ).toBe('failed');
    const aliased = `${GOOD_PROSE} L’Archère de Givre attend plus bas.`;
    expect(
      stateOf(gradeSample(withPrice, readAnswer(aliased, withPrice)), 'no_reserved_champion'),
    ).toBe('failed');
  });

  it('un absent nommé sans marqueur d’absence tombe', () => {
    const resurrected = `${GOOD_PROSE} Keld tend la corde.`;
    expect(
      stateOf(gradeSample(withPrice, readAnswer(resurrected, withPrice)), 'no_absent_reappearance'),
    ).toBe('failed');
  });

  /**
   * ADR 0008 DECISION 3, AT THE PROBE'S LEVEL — and the two operands do NOT
   * trace to the same definition.
   *
   * `issue-franche` holds somebody in the SERVER-SIDE scene whom the brief's
   * perceptible list does not carry: the M1 case where the party has split.
   * The grading context must know that name — `turn.ts` builds it from
   * `sceneBefore(state)` — and the REQUEST must not contain it anywhere, not
   * in `<scene>`, not in the campaign block, not in `<etat>`. Comparing
   * `ctx.sceneEntityNames` to `probeCase.scene.presentNames` alone would be
   * one definition compared to itself (mode 5 of docs/RECETTE.md); the second
   * half is what makes it mean something.
   */
  it('la scène serveur porte quelqu’un que le brief ne porte pas, et la requête ne le voit jamais', () => {
    const split = cases.find((probeCase) => probeCase.id === 'issue-franche')!;
    const briefNames = split.brief.perceivableFacts.map((fact) => fact.name);
    expect(briefNames).not.toContain(HORS_BRIEF);
    expect(split.scene.presentNames).toContain(HORS_BRIEF);

    const ctx = contextFor(split, { prose: '', sceneBlock: null, proseTruncated: false });
    expect(ctx.sceneEntityNames).toContain(HORS_BRIEF);
    expect(requestText(buildTurn(split, 0, 8192).request)).not.toContain(HORS_BRIEF);
  });

  it('le contexte de notation vient de la scène serveur, pas de la liste du brief', () => {
    const ctx = contextFor(withPrice, { prose: '', sceneBlock: null, proseTruncated: false });
    expect(ctx.absentNames).toEqual(withPrice.scene.absentNames);
    expect(ctx.sceneEntityNames).toEqual(withPrice.scene.presentNames);
    expect(ctx.reservedChampions).toEqual(withPrice.reservedChampions);
    expect(ctx.priceKeywords).toEqual(withPrice.priceKeywords);
  });

  it('une table de prémisses vidée nomme les seize', () => {
    expect(missingPremises(HARD_ASSERTIONS, PREMISES)).toEqual([]);
    expect(missingPremises(HARD_ASSERTIONS, {})).toEqual(HARD_ASSERTIONS.map((rule) => rule.id));
  });

  it('une règle qui tombe n’est jamais rétrogradée en « sans objet »', () => {
    const reading: Reading = readAnswer(`${GOOD_PROSE} Ashe attend.`, withPrice);
    // Premise table that claims the rule never applies: a FAILURE still wins.
    const grades = gradeSample(withPrice, reading, HARD_ASSERTIONS, {
      ...PREMISES,
      no_reserved_champion: () => false,
    });
    expect(stateOf(grades, 'no_reserved_champion')).toBe('failed');
  });
});
