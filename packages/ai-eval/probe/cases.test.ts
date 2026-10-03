import { staticBundle, staticContent } from '@for/content';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PROBE_CASES_DIR,
  ProbeCaseError,
  loadProbeCases,
  resolvePriceEntry,
  resolveReserved,
} from './cases.js';

const scratch: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'for-m031-cases-'));
  scratch.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const firstFixture = (): { name: string; body: Record<string, unknown> } => {
  const name = readdirSync(PROBE_CASES_DIR)
    .filter((entry) => entry.endsWith('.case.json'))
    .sort()[0]!;
  return { name, body: JSON.parse(readFileSync(join(PROBE_CASES_DIR, name), 'utf8')) };
};

describe('le corpus de la sonde', () => {
  it('charge les six cas de la fiche, et chacun porte un brief conforme au contrat', () => {
    const cases = loadProbeCases();
    // The sheet's floor, spelled out: « 6 cas au minimum » (ADR 0007).
    expect(cases.length).toBeGreaterThanOrEqual(6);
    for (const probeCase of cases) {
      expect(probeCase.brief.actorCharacterId).toBeTruthy();
      expect(probeCase.brief.perceivableFacts.length).toBeGreaterThan(0);
    }
  });

  it('couvre les trois issues, le présage, les réservés et le prix imposé', () => {
    const tags = loadProbeCases().flatMap((probeCase) => probeCase.tags);
    for (const needed of [
      'outcome:franche',
      'outcome:partielle',
      'outcome:echec',
      'presage',
      'reserved',
      'price',
    ]) {
      expect(tags).toContain(needed);
    }
  });

  /**
   * THE EXACT ARRAY, SPELLED OUT, and six entries in an order the file system
   * refuses to produce. Comparing the reversed reading to the forward one
   * would compare the function to itself; comparing both to this literal is
   * what makes removing `names.sort()` turn red (mode 7 of docs/RECETTE.md).
   */
  const EXPECTED_ORDER = [
    'issue-franche',
    'issue-partielle',
    'issue-echec',
    'presage',
    'champions-reserves',
    'prix-impose',
  ];

  it('trie par nom de fichier, même quand le répertoire les rend à l’envers', () => {
    const reversed = loadProbeCases(PROBE_CASES_DIR, (dir) => [...readdirSync(dir)].reverse());
    const forward = loadProbeCases();
    expect(forward.map((probeCase) => probeCase.id)).toEqual(EXPECTED_ORDER);
    expect(reversed.map((probeCase) => probeCase.id)).toEqual(EXPECTED_ORDER);
  });

  it('rend un tableau vide sur un répertoire vide — c’est run-probe qui refuse', () => {
    expect(loadProbeCases(temp())).toEqual([]);
  });

  it('un brief hors contrat tombe à la lecture', () => {
    const dir = temp();
    const { body } = firstFixture();
    const brief = body['brief'] as Record<string, unknown>;
    writeFileSync(
      join(dir, '01-casse.case.json'),
      JSON.stringify({ ...body, brief: { ...brief, actorCharacterId: 'pas-un-ulid' } }),
      'utf8',
    );
    expect(() => loadProbeCases(dir)).toThrow(ProbeCaseError);
  });

  it('le prix vient du bundle, pas du fichier de cas', () => {
    const withPrice = loadProbeCases().find((probeCase) => probeCase.priceKeywords !== null);
    expect(withPrice).toBeDefined();
    const entryId = withPrice?.brief.imposedPrice?.entryId ?? '';
    const entry = staticBundle().priceTable.entries.find((row) => row.id === entryId);
    expect(entry).toBeDefined();
    // Two paths to the same words: the case file names an IDENTIFIER, the
    // bundle answers with the text and the keywords.
    expect(withPrice?.brief.imposedPrice?.text).toBe(entry?.text);
    expect(withPrice?.priceKeywords).toEqual([...(entry?.keywords ?? [])]);
    // And the fixture does NOT carry them: emptying the bundle entry would
    // change the probe, which is the whole point.
    const raw = readFileSync(join(PROBE_CASES_DIR, '06-prix-impose.case.json'), 'utf8');
    expect(raw).not.toContain(entry?.text ?? '@@');
  });

  it('une entrée de prix inconnue du bundle est nommée, pas devinée', () => {
    expect(() => resolvePriceEntry('entree-qui-n-existe-pas')).toThrow(ProbeCaseError);
  });

  it('les alias viennent de l’index des champions', () => {
    const resolved = resolveReserved(['ashe']);
    const entry = staticContent()
      .listChampionIndex()
      .find((row) => row.id === 'ashe');
    expect(entry).toBeDefined();
    expect(resolved[0]?.displayName).toBe(entry?.displayName);
    expect(resolved[0]?.aliases).toEqual(entry?.aliases);
    expect(resolved[0]?.aliases.length).toBeGreaterThan(1);
  });

  it('un champion absent de l’index garde son identifiant pour seul nom', () => {
    expect(resolveReserved(['pas-un-champion'])).toEqual([
      { displayName: 'pas-un-champion', aliases: [] },
    ]);
  });

  it.each([
    ['la racine n’est pas un objet', () => [[], null] as const],
    [
      'un champ texte manquant',
      (body: Record<string, unknown>) => [{ ...body, id: '' }, null] as const,
    ],
    [
      'un champ texte du mauvais type',
      (body: Record<string, unknown>) => [{ ...body, title: 7 }, null] as const,
    ],
    [
      'une couture de chronique du mauvais type',
      (body: Record<string, unknown>) => {
        const context = body['context'] as Record<string, unknown>;
        const chronicle = context['chronicle'] as Record<string, unknown>;
        return [
          { ...body, context: { ...context, chronicle: { ...chronicle, premise: 3 } } },
          null,
        ] as const;
      },
    ],
    [
      'un tableau qui n’en est pas un',
      (body: Record<string, unknown>) => [{ ...body, tags: 'nope' }, null] as const,
    ],
    [
      'un élément de tableau du mauvais type',
      (body: Record<string, unknown>) => [{ ...body, mentions_any: [1] }, null] as const,
    ],
    [
      'un identifiant de prix du mauvais type',
      (body: Record<string, unknown>) => [{ ...body, imposed_price_entry_id: 7 }, null] as const,
    ],
    [
      'une règle maison du mauvais type',
      (body: Record<string, unknown>) => {
        const campaign = body['campaign'] as Record<string, unknown>;
        return [{ ...body, campaign: { ...campaign, house_rules: 7 } }, null] as const;
      },
    ],
  ])('refuse une fixture où %s', (_label, mutate) => {
    const dir = temp();
    const { body } = firstFixture();
    const [mutated] = mutate(body);
    writeFileSync(join(dir, '01-casse.case.json'), JSON.stringify(mutated), 'utf8');
    expect(() => loadProbeCases(dir)).toThrow(ProbeCaseError);
  });

  it('un JSON illisible est nommé avec son fichier', () => {
    const dir = temp();
    writeFileSync(join(dir, '01-casse.case.json'), '{ ceci n’est pas du JSON', 'utf8');
    expect(() => loadProbeCases(dir)).toThrow(/01-casse\.case\.json/u);
  });

  it('un répertoire introuvable est une erreur nommée, pas une pile', () => {
    expect(() => loadProbeCases(join(temp(), 'nulle-part'))).toThrow(ProbeCaseError);
  });
});
