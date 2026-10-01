import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NARRATOR_PROVIDER_IDS, zSceneState } from '@for/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CASES_DIR, loadCases } from './cases.js';
import { fixtureLoader } from './fixtures.js';
import { diffRequests, perceivableFactsOf, requestOf, serialiseRequest } from './request.js';

const corpus = loadCases(CASES_DIR);
const fixtureOf = fixtureLoader();
const bytesOf = (id: string): string => {
  const one = corpus.find((entry) => entry.id === id);
  if (one === undefined) throw new Error(`cas absent : ${id}`);
  return serialiseRequest(requestOf(one, fixtureOf(one.fixture)));
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('l’instantané est celui du PORT, pas d’un fournisseur', () => {
  /**
   * The criterion in as many words: « changer de `NARRATOR_PROVIDER` ne fait
   * bouger aucun `*.request.json` ». Setting the variable is what a tester
   * does; if a vendor detail ever leaks above the port, these bytes move.
   */
  it('les quatre fournisseurs rendent les mêmes octets', () => {
    const seen = new Set<string>();
    for (const provider of NARRATOR_PROVIDER_IDS) {
      vi.stubEnv('NARRATOR_PROVIDER', provider);
      vi.stubEnv('NARRATOR_BASE_URL', `https://exemple.invalid/${provider}`);
      vi.stubEnv('NARRATOR_MODEL', `modele-${provider}`);
      seen.add(bytesOf('01-issue-franche'));
    }
    expect(seen.size).toBe(1);
  });

  it('la fenêtre de contexte vient de la fixture, pas d’un fournisseur', () => {
    vi.stubEnv('NARRATOR_CONTEXT_WINDOW', '4096');
    const narrow = bytesOf('01-issue-franche');
    vi.unstubAllEnvs();
    expect(narrow).toBe(bytesOf('01-issue-franche'));
    expect(fixtureOf('avarosa').contextWindowTokens).toBe(32_768);
  });

  it('ne porte aucun outil, ni définition ni nom — ADR 0011, prose seule', () => {
    const one = corpus[0];
    expect(one).toBeDefined();
    const request = requestOf(one!, fixtureOf(one!.fixture));
    expect(request.tools).toEqual([]);
    expect(request.toolPolicy).toBe('none');
    expect(serialiseRequest(request)).not.toMatch(
      /get_state|propose_clock_advance|check_name_allowed/u,
    );
  });
});

describe('les instantanés enregistrés sont à jour', () => {
  it.each(corpus.map((one) => one.id))('%s', (id) => {
    expect(readFileSync(join(CASES_DIR, `${id}.request.json`), 'utf8')).toBe(bytesOf(id));
  });
});

describe('l’intention du joueur est hostile par défaut', () => {
  /**
   * The injection case is only worth its place if its tags arrive NEUTRALISED.
   * `escapePlayerText` does it one level down and `@for/ai` holds that; what
   * is held HERE is that the corpus exercises it — a case whose injection
   * never reached the request would be a case that measures nothing.
   */
  it('l’intention d’injection arrive échappée dans la requête', () => {
    const bytes = bytesOf('05-injection-de-prompt');
    expect(bytes).toMatch(/&lt;\/consignes_du_tour>/u);
    expect(bytes).toMatch(/&lt;scene_apres>/u);
    const intention = bytes.slice(bytes.indexOf('<intention>'));
    expect(intention.slice(0, intention.indexOf('</intention>'))).not.toMatch(
      /<\s*\/?\s*consignes_du_tour>/u,
    );
  });
});

describe('les faits perceptibles sortent triés', () => {
  it('par ref.id puis par kind, quelle que soit l’écriture de la fixture', () => {
    /**
     * Built through `zSceneState.parse`, the production schema, rather than
     * asserted into shape: a branded identifier that a cast let through would
     * be a fixture the server could not have produced.
     */
    const scene = zSceneState.parse({
      sceneId: '01HZZZ0000000000000000SCN1',
      placeId: 'col_des_hurleurs',
      placeName: 'Le col',
      timeOfDay: 'nuit',
      present: [
        { ref: { kind: 'entity', id: 'B' }, name: 'Bea', state: 'debout', sinceSeq: 2 },
        { ref: { kind: 'entity', id: 'A' }, name: 'Ari', state: 'assis', sinceSeq: 1 },
      ],
      absent: [{ ref: { kind: 'entity', id: 'C' }, name: 'Cal', cause: 'parti', sinceSeq: 3 }],
      updatedSeq: 4,
    });
    expect(perceivableFactsOf(scene).map((fact) => fact.ref.id)).toEqual(['A', 'B', 'C']);
  });
});

describe('le diff de requête est lisible', () => {
  it('nomme la première ligne qui diverge et s’arrête au plafond', () => {
    const left = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
    const right = ['a', 'B', 'C', 'D', 'E', 'F', 'G'].join('\n');
    const lines = diffRequests(left, right, 3);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ line: 2, column: 1, recorded: 'b', built: 'B' });
  });

  it('ne rend rien quand les deux textes sont identiques', () => {
    expect(diffRequests('a\nb', 'a\nb')).toEqual([]);
  });

  /**
   * MESURÉ, et c'est ce qui a motivé la fenêtre : sans elle, la sonde « un
   * caractère changé dans le prompt système » imprimait deux lignes de sept
   * mille caractères, douze fois. Le caractère fautif y était, illisible.
   */
  it('fenêtre une ligne longue autour de la colonne fautive, au lieu de la cracher entière', () => {
    const long = `${'x'.repeat(500)}A${'y'.repeat(500)}`;
    const other = `${'x'.repeat(500)}B${'y'.repeat(500)}`;
    const [line] = diffRequests(long, other);
    expect(line?.column).toBe(501);
    expect(line?.recorded?.length).toBeLessThan(long.length);
    expect(line?.recorded).toMatch(/^…x+Ay+…$/u);
    expect(line?.built).toMatch(/^…x+By+…$/u);
  });

  it('dit « absent » quand une ligne n’existe que d’un côté', () => {
    const [line] = diffRequests('a', 'a\nb');
    expect(line).toEqual({ line: 2, column: null, recorded: null, built: 'b' });
  });
});
