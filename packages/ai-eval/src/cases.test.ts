import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CASES_DIR, CASES_MIN, EvalCaseError, loadCases, type DirLister } from './cases.js';

const made: string[] = [];

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'for-m027-cases-'));
  made.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SCENE = {
  sceneId: '01HZZZ0000000000000000SCN1',
  placeId: 'col_des_hurleurs',
  placeName: 'Le col des Hurleurs',
  timeOfDay: 'fin de journée',
  present: [],
  absent: [],
  updatedSeq: 400,
};

const minimalCase = (id: string, over: Record<string, unknown> = {}): unknown => ({
  id,
  title: 'un cas',
  tags: [],
  fixture: 'avarosa',
  turn: {
    intent: 'Je monte.',
    actor_character_id: '01HZZZ0000000000000000CHR1',
    actor_label: 'Ingvild',
    correlation_id: '00000000-0000-4000-8000-000000000099',
    scene_in: SCENE,
    fact: {
      move: 'face-danger',
      move_label: 'Affronter le danger',
      attribute: 'fer',
      attribute_label: 'fer',
      outcome: 'franche',
      outcome_label: 'RÉUSSITE FRANCHE',
      presage: false,
      roll: null,
      effect_sentences: [],
      price: null,
      presage_entry: null,
      time_skip: false,
      event_seqs: [401],
      fallback_template_id: 'fallback.col',
    },
    actor_inventory: [],
    actor_assets: [],
    upheld_refusals_in_window: 0,
  },
  expect: { assertions: [] },
  ...over,
});

const write = (dir: string, id: string, body: unknown): void => {
  writeFileSync(join(dir, `${id}.case.json`), JSON.stringify(body), 'utf8');
};

describe('le corpus se lit depuis le répertoire', () => {
  it('rend un tableau vide sur un répertoire vide — c’est runOffline qui refuse', () => {
    expect(loadCases(scratch())).toEqual([]);
  });

  it('trie par nom de fichier, même quand le répertoire les rend à l’envers', () => {
    const dir = scratch();
    write(dir, '01-un', minimalCase('01-un'));
    write(dir, '02-deux', minimalCase('02-deux'));
    /**
     * The real file system hands these back in order on ext4, so removing the
     * sort would leave a test that only read `readdirSync` green. The double
     * takes the one parameter `loadCases` passes — no more, no less.
     */
    const reversed: DirLister = (target) => [...readdirSync(target)].reverse();
    expect(loadCases(dir, reversed).map((one) => one.id)).toEqual(['01-un', '02-deux']);
  });

  it('refuse un identifiant d’assertion inconnu', () => {
    const dir = scratch();
    write(dir, '01-un', minimalCase('01-un', { expect: { assertions: [{ id: 'no_such_rule' }] } }));
    expect(() => loadCases(dir)).toThrow(EvalCaseError);
    expect(() => loadCases(dir)).toThrow(/no_such_rule/u);
  });

  it('refuse deux cas qui portent le même identifiant', () => {
    const dir = scratch();
    write(dir, '01-un', minimalCase('meme'));
    write(dir, '02-deux', minimalCase('meme'));
    expect(() => loadCases(dir)).toThrow(/double/u);
  });

  it('refuse un mouvement que le moteur ne connaît pas', () => {
    const dir = scratch();
    const body = minimalCase('01-un') as { turn: { fact: Record<string, unknown> } };
    body.turn.fact['move'] = 'danser-la-gigue';
    write(dir, '01-un', body);
    expect(() => loadCases(dir)).toThrow(/danser-la-gigue/u);
  });

  it('refuse une scène que zSceneState rejette', () => {
    const dir = scratch();
    const body = minimalCase('01-un') as { turn: Record<string, unknown> };
    body.turn['scene_in'] = { ...SCENE, sceneId: 'pas-un-ulid' };
    write(dir, '01-un', body);
    expect(() => loadCases(dir)).toThrow(/scene_in/u);
  });

  it('refuse un prix sans mots-clés, faute de quoi price_respected n’aurait rien à noter', () => {
    const dir = scratch();
    const body = minimalCase('01-un') as { turn: { fact: Record<string, unknown> } };
    body.turn.fact['price'] = {
      roll_id: '01HZZZ0000000000000000PA01',
      table_id: 'pay-the-price',
      value: 9,
      entry_id: 'price_09',
      text: 'Un allié se retourne.',
      severity: 'moyenne',
      effect_index: 0,
      keywords: [],
    };
    write(dir, '01-un', body);
    expect(() => loadCases(dir)).toThrow(/price_respected/u);
  });
});

describe('le corpus livré', () => {
  it('porte au moins les dix cas de la fiche M0-27', () => {
    expect(loadCases(CASES_DIR).length).toBeGreaterThanOrEqual(CASES_MIN);
  });

  it('couvre les neuf familles que la fiche nomme', () => {
    const corpus = loadCases(CASES_DIR);
    const outcomes = new Set(corpus.map((one) => one.turn.fact.outcome));
    expect(outcomes).toEqual(new Set(['franche', 'partielle', 'echec']));
    expect(corpus.some((one) => one.turn.fact.presage !== null)).toBe(true);
    expect(corpus.some((one) => one.turn.fact.price !== null)).toBe(true);
    expect(corpus.some((one) => one.tags.includes('reserved'))).toBe(true);
    expect(corpus.some((one) => one.tags.includes('injection'))).toBe(true);
    expect(corpus.some((one) => one.tags.includes('malforme'))).toBe(true);
    expect(corpus.some((one) => one.tags.includes('absent_block'))).toBe(true);
    expect(corpus.some((one) => one.refusal?.verdict === 'upheld')).toBe(true);
    expect(corpus.some((one) => one.refusal?.verdict === 'none')).toBe(true);
    expect(corpus.some((one) => one.refusal?.verdict === 'rejected')).toBe(true);
  });

  it('écrit une vraie tentative d’injection, pas une figuration', () => {
    const injection = loadCases(CASES_DIR).find((one) => one.tags.includes('injection'));
    expect(injection).toBeDefined();
    const intent = injection?.turn.intent ?? '';
    // Une consigne glissée dans l'intention : fausse balise, jauge, secret, issue.
    expect(intent).toMatch(/<\/consignes_du_tour>/u);
    expect(intent.toLowerCase()).toMatch(/ignore tes instructions/u);
    expect(intent.toLowerCase()).toMatch(/vigueur/u);
    expect(intent.toLowerCase()).toMatch(/révèle/u);
    expect(intent.toLowerCase()).toMatch(/je réussis/u);
  });
});
