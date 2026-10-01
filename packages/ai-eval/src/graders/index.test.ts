import { ASSERTIONS } from '@for/ai';
import { describe, expect, it } from 'vitest';

import { CASES_DIR, loadCases } from '../cases.js';
import { viewSample } from '../context.js';
import { fixtureLoader } from '../fixtures.js';
import { loadRecorded } from '../recorded.js';
import { EXERCISED_IDS, GRADERS } from './index.js';
import { gates, runFamily, UnknownCheckError, type GraderInput } from './kit.js';

describe('les six familles partitionnent ASSERTIONS', () => {
  /**
   * The M0-27 criterion, run rather than quoted: « un test vérifie que
   * l'ensemble des identifiants exercés par eval:offline est EXACTEMENT
   * Object.keys(ASSERTIONS) importé de @for/ai ». `ASSERTIONS` is imported,
   * never copied — a local list compared to itself would prove nothing.
   */
  it('sans trou ni recouvrement', () => {
    const exercised = [...EXERCISED_IDS].sort();
    const declared = Object.keys(ASSERTIONS).sort();
    expect(exercised).toEqual(declared);
    expect(new Set(EXERCISED_IDS).size).toBe(EXERCISED_IDS.length);
  });

  it('et aucune famille n’est vide — une liste vide ne garderait rien', () => {
    for (const grader of GRADERS) expect(grader.ids.length).toBeGreaterThan(0);
  });

  it('refuse un identifiant que @for/ai n’exporte pas', () => {
    const corpus = loadCases(CASES_DIR);
    const evalCase = corpus[0];
    expect(evalCase).toBeDefined();
    const fixture = fixtureLoader()(evalCase!.fixture);
    const recorded = loadRecorded(evalCase!.id, CASES_DIR);
    const sample = recorded.samples[0];
    expect(sample).toBeDefined();
    const view = viewSample(evalCase!, fixture, sample!);
    const input: GraderInput = {
      evalCase: evalCase!,
      fixture,
      recorded,
      sample: sample!,
      sampleIndex: 0,
      view,
      prose: view.reading.prose,
    };
    expect(() => runFamily(['regle_inventee'], input)).toThrow(UnknownCheckError);
  });
});

describe('ce qui bloque', () => {
  it('est l’ensemble dur du §8.6, plus les deux vérifications de refus', () => {
    const gating = Object.values(ASSERTIONS)
      .filter((one) => gates(one))
      .map((one) => one.id)
      .sort();
    /**
     * Spelled out in full letters: the hard list of section 8.6 is a closed
     * list the specification names, and a test that read it back from
     * `assertion.hard` would be comparing a flag to itself (ADR 0007).
     */
    expect(gating).toEqual(
      [
        'banned_style_lexicon',
        'max_one_dialogue_line',
        'no_absent_reappearance',
        'no_atmosphere_ending',
        'no_digits',
        'no_named_emotion',
        'no_outcome_decision',
        'no_pc_agency',
        'no_refusal',
        'no_reserved_champion',
        'no_rules_lexicon',
        'no_terminal_prompt',
        'no_time_skip',
        'price_respected',
        'refusal_matches',
        'scene_block_consistent',
        'sentence_count',
        'sentence_length_cap',
      ].sort(),
    );
  });

  it('laisse souples les trois heuristiques de morphologie et l’axe du juge', () => {
    const soft = Object.values(ASSERTIONS)
      .filter((one) => !gates(one))
      .map((one) => one.id);
    expect(soft).toEqual(
      expect.arrayContaining([
        'adverb_budget',
        'no_triads',
        'no_anonymous_recurrent',
        'ends_concrete',
      ]),
    );
  });
});
