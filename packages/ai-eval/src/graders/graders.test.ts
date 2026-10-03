/**
 * The per-sample graders, each one proved BY VIOLATION.
 *
 * Every test below writes the thing the rule forbids and demands the red, then
 * writes the clean version and demands the green. Showing that a check exists
 * is worth nothing (`docs/RECETTE.md`, the rule that governs the rest).
 *
 * The `inputFor` helper hands a grader the same shape `run-offline.ts` does,
 * built from the REAL corpus and the REAL fixture: a double that assembled a
 * smaller context would let a check pass on a context production never sees.
 */

import { describe, expect, it } from 'vitest';

import { CASES_DIR, loadCases, type EvalCase } from '../cases.js';
import { viewSample } from '../context.js';
import { fixtureLoader } from '../fixtures.js';
import { loadRecorded } from '../recorded.js';
import type { Check, GraderInput } from './kit.js';
import { lockoutGrader } from './lockout.js';
import { refusalGrader } from './refusal.js';
import { sceneContinuityGrader } from './scene-continuity.js';
import { schemaGrader } from './schema.js';

const corpus = loadCases(CASES_DIR);
const fixtureOf = fixtureLoader();

const caseNamed = (id: string): EvalCase => {
  const found = corpus.find((one) => one.id === id);
  if (found === undefined) throw new Error(`cas absent : ${id}`);
  return found;
};

function inputFor(id: string, response?: string, promptVersion?: string): GraderInput {
  const evalCase = caseNamed(id);
  const fixture = fixtureOf(evalCase.fixture);
  const onDisk = loadRecorded(id, CASES_DIR);
  const recorded = promptVersion === undefined ? onDisk : { ...onDisk, promptVersion };
  const first = recorded.samples[0];
  if (first === undefined) throw new Error('échantillon absent');
  const sample = response === undefined ? first : { ...first, response };
  const view = viewSample(evalCase, fixture, sample);
  return { evalCase, fixture, recorded, sample, sampleIndex: 0, view, prose: view.reading.prose };
}

const find = (checks: readonly Check[], id: string): Check => {
  const found = checks.find((one) => one.id === id);
  if (found === undefined) throw new Error(`vérification absente : ${id}`);
  return found;
};

const CLEAN_BLOCK =
  '<scene_apres>{"lieu":"col_des_hurleurs","presents":[{"nom":"Ingvild","etat":"debout"},{"nom":"Ulrun","etat":"assis"}],"partis":[],"refus":null}</scene_apres>';

const CLEAN_PROSE =
  'Tu montes sur l’épaule de pierre et le vent te prend de biais. ' +
  'La trace remonte vers le cairn nord, nette au bord. ' +
  'Ulrun noue la corde au piton de fer. ' +
  'Le froid mord ton poignet nu.';

// ------------------------------------------------------------------ lockout

describe('lockout — le verrou de distribution', () => {
  it('passe sur la prose livrée', () => {
    expect(
      find(lockoutGrader.run(inputFor('04-pression-champions-reserves')), 'no_reserved_champion')
        .passed,
    ).toBe(true);
  });

  it('attrape l’ALIAS dans la prose, pas seulement le nom', () => {
    const violated = `Tu vois la Griffe de Givre descendre du cairn. ${CLEAN_PROSE}${CLEAN_BLOCK}`;
    const checks = lockoutGrader.run(inputFor('04-pression-champions-reserves', violated));
    expect(find(checks, 'no_reserved_champion').passed).toBe(false);
    expect(find(checks, 'no_reserved_champion').detail).toMatch(/Griffe de Givre/u);
  });

  it('attrape le nom dans le bloc, alors que la prose est propre', () => {
    const smuggled =
      `${CLEAN_PROSE}\n\n<scene_apres>{"lieu":"col_des_hurleurs","presents":` +
      '[{"nom":"Sejuani","etat":"debout"}],"partis":[],"refus":null}</scene_apres>';
    const checks = lockoutGrader.run(inputFor('04-pression-champions-reserves', smuggled));
    expect(find(checks, 'no_reserved_champion').passed).toBe(true);
    expect(find(checks, 'reserved_champion_block').passed).toBe(false);
  });
});

// ------------------------------------------------------------------- schema

describe('schema — la forme de la réponse', () => {
  it('tombe quand le prompt_version enregistré n’est plus le courant', () => {
    const checks = schemaGrader.run(inputFor('01-issue-franche', undefined, 'conteur/0.0.1'));
    const version = find(checks, 'prompt_version');
    expect(version.passed).toBe(false);
    expect(version.gating).toBe(true);
    expect(version.detail).toMatch(/eval:record/u);
  });

  it('et passe sur la version courante', () => {
    expect(find(schemaGrader.run(inputFor('01-issue-franche')), 'prompt_version').passed).toBe(
      true,
    );
  });

  it('un bloc absent et un bloc malformé passent tous les deux, et sont signalés', () => {
    const absent = schemaGrader.run(inputFor('08-bloc-absent'));
    expect(find(absent, 'scene_block_reading').detail).toMatch(/scene_block_missing/u);
    expect(absent.filter((one) => one.gating && !one.passed)).toEqual([]);

    const malformed = schemaGrader.run(inputFor('07-bloc-malforme'));
    expect(find(malformed, 'scene_block_reading').detail).toMatch(/scene_block_malformed/u);
    expect(malformed.filter((one) => one.gating && !one.passed)).toEqual([]);
  });

  it('tombe sur une prose qui dépasse le plafond du schéma de sortie', () => {
    const huge = `${'Tu marches. '.repeat(400)}${CLEAN_BLOCK}`;
    expect(
      find(schemaGrader.run(inputFor('01-issue-franche', huge)), 'narration_output').passed,
    ).toBe(false);
  });
});

// --------------------------------------------------------- scene-continuity

describe('scene-continuity — personne ne revient de la liste des partis', () => {
  it('passe sur l’enregistrement livré', () => {
    const checks = sceneContinuityGrader.run(inputFor('06-absent-interpelle'));
    expect(checks.filter((one) => one.gating && !one.passed)).toEqual([]);
  });

  it('tombe quand le bloc remet un parti parmi les présents', () => {
    const back =
      `${CLEAN_PROSE}\n\n<scene_apres>{"lieu":"col_des_hurleurs","presents":` +
      '[{"nom":"Ingvild","etat":"debout"},{"nom":"Signy","etat":"revenue"}],"partis":[],"refus":null}</scene_apres>';
    const checks = sceneContinuityGrader.run(inputFor('06-absent-interpelle', back));
    expect(find(checks, 'scene_block_consistent').passed).toBe(false);
    expect(find(checks, 'scene_block_consistent').detail).toMatch(/Signy/u);
  });

  it('le rejet S5 est signalé, et c’est l’état fusionné qui décide', () => {
    const back =
      `${CLEAN_PROSE}\n\n<scene_apres>{"lieu":"col_des_hurleurs","presents":` +
      '[{"nom":"Signy","etat":"revenue"}],"partis":[],"refus":null}</scene_apres>';
    const checks = sceneContinuityGrader.run(inputFor('06-absent-interpelle', back));
    // S5 a déjà ignoré l'entrée : l'état fusionné tient, et scene_out passe.
    expect(find(checks, 'scene_merge').detail).toMatch(/S5 absent_reappearance/u);
    expect(find(checks, 'scene_out').passed).toBe(true);
    // Ce qui bloque, c'est l'assertion : l'ignorance silencieuse devient visible.
    expect(find(checks, 'scene_block_consistent').passed).toBe(false);
  });

  it('tombe quand la prose nomme un absent sans marqueur d’absence', () => {
    const bare = `Tu montes vers le cairn. Signy te tend la lame refaite. Le vent tombe. Le fer est froid.${CLEAN_BLOCK}`;
    const checks = sceneContinuityGrader.run(inputFor('06-absent-interpelle', bare));
    expect(find(checks, 'no_absent_reappearance').passed).toBe(false);
  });

  it('et autorise ce que l’absent a laissé derrière lui', () => {
    const allowed = `Tu montes vers le cairn. Il ne reste de Signy que la trace de ses bottes. Le vent tombe. Le fer est froid.${CLEAN_BLOCK}`;
    const checks = sceneContinuityGrader.run(inputFor('06-absent-interpelle', allowed));
    expect(find(checks, 'no_absent_reappearance').passed).toBe(true);
  });

  it('scene_out tombe quand un présent exigé disparaît de l’état fusionné', () => {
    const gone =
      `${CLEAN_PROSE}\n\n<scene_apres>{"lieu":"col_des_hurleurs","presents":[],` +
      '"partis":[{"nom":"Ulrun","cause":"parti"}],"refus":null}</scene_apres>';
    const checks = sceneContinuityGrader.run(inputFor('01-issue-franche', gone));
    const out = find(checks, 'scene_out');
    expect(out.passed).toBe(false);
    expect(out.detail).toMatch(/Ulrun/u);
  });
});

// ------------------------------------------------------------------ refusal

describe('refusal — le droit de refus, cas par cas', () => {
  it('no_refusal ne bloque pas un cas qui attend un refus retenu', () => {
    const checks = refusalGrader.run(inputFor('09-refus-cible-absente'));
    const no = find(checks, 'no_refusal');
    expect(no.passed).toBe(false);
    expect(no.gating).toBe(false);
    expect(find(checks, 'refusal_matches').passed).toBe(true);
  });

  it('et bloque partout ailleurs : un refus retenu sur « absurde mais possible »', () => {
    const clean = refusalGrader.run(inputFor('10-absurde-mais-possible'));
    expect(find(clean, 'no_refusal').passed).toBe(true);
    expect(find(clean, 'no_refusal').gating).toBe(true);

    const refused =
      'Tu écartes la toile et tes doigts restent sur le gel. ' +
      'La barbe de Keld est prise en bloc sous la glace. ' +
      'Ulrun regarde ailleurs. ' +
      'Le vent tombe d’un coup.\n\n' +
      '<scene_apres>{"lieu":"col_des_hurleurs","presents":[{"nom":"Ingvild","etat":"agenouillée"}],' +
      '"partis":[],"refus":{"cause":"cible_morte","cible":"Keld"}}</scene_apres>';
    const checks = refusalGrader.run(inputFor('10-absurde-mais-possible', refused));
    const no = find(checks, 'no_refusal');
    expect(no.passed).toBe(false);
    expect(no.gating).toBe(true);
  });

  it('refusal_reason compare la raison R1→R7 que refusal_matches ne porte pas', () => {
    expect(find(refusalGrader.run(inputFor('11-refus-non-prouve')), 'refusal_reason').passed).toBe(
      true,
    );

    const other =
      `${CLEAN_PROSE}\n\n<scene_apres>{"lieu":"col_des_hurleurs","presents":[],"partis":[],` +
      '"refus":{"cause":"cible_absente","cible":"Brynja"}}</scene_apres>';
    const checks = refusalGrader.run(inputFor('11-refus-non-prouve', other));
    // R5 : les mots du joueur ne désignent pas Brynja — la raison change.
    expect(find(checks, 'refusal_reason').passed).toBe(false);
    expect(find(checks, 'refusal_reason').detail).toMatch(/refusal_off_target/u);
  });
});
