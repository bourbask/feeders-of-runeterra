import { describe, expect, it } from 'vitest';

import { CASES_DIR, loadCases } from './cases.js';
import { checkChronicle } from './chronicle.js';
import { fixtureLoader, type EvalFixture } from './fixtures.js';

const corpus = loadCases(CASES_DIR);
const fixture = fixtureLoader()('avarosa');
const sceneOf = (id: string): (typeof corpus)[number]['turn']['sceneIn'] => {
  const found = corpus.find((one) => one.id === id);
  if (found === undefined) throw new Error(`cas absent : ${id}`);
  return found.turn.sceneIn;
};

describe('la chronique au niveau N0', () => {
  it('passe les neuf contrôles sur la fixture livrée', () => {
    const verdict = checkChronicle(fixture, sceneOf('01-issue-franche'));
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('tient sous le budget de la section 5.2', () => {
    // 2 500 est le plafond de CHRONICLE_TOKEN_BUDGET, écrit en toutes lettres.
    expect(checkChronicle(fixture, null).tokenCount).toBeLessThanOrEqual(2500);
  });

  it('retirer un fait doré du document fait tomber C6', () => {
    const amputated: EvalFixture = {
      ...fixture,
      chronicle: {
        ...fixture.chronicle,
        doc: {
          ...fixture.chronicle.doc,
          facts: fixture.chronicle.doc.facts.filter((one) => one.fact_id !== 'fait_keld_mort'),
        },
      },
    };
    const verdict = checkChronicle(amputated, sceneOf('01-issue-franche'));
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((one) => one.check)).toContain('C6');
    expect(verdict.violations.find((one) => one.check === 'C6')?.detail).toMatch(/fait_keld_mort/u);
  });

  it('un champion réservé dans la chronique fait tomber C5', () => {
    const leaked: EvalFixture = {
      ...fixture,
      chronicle: {
        ...fixture.chronicle,
        doc: {
          ...fixture.chronicle.doc,
          premise: 'La Griffe de Givre marche avec la bande depuis le départ du camp.',
        },
      },
    };
    expect(checkChronicle(leaked, null).violations.map((one) => one.check)).toContain('C5');
  });

  it('C9 mord sur la scène qui tient Keld pour mort', () => {
    const contradicting: EvalFixture = {
      ...fixture,
      chronicle: {
        ...fixture.chronicle,
        doc: {
          ...fixture.chronicle.doc,
          npcs: fixture.chronicle.doc.npcs.map((npc) =>
            npc.name === 'Keld' ? { ...npc, status: 'vivant' as const } : npc,
          ),
        },
      },
    };
    // La scène de référence porte Keld en « mort » : la chronique la contredit.
    expect(
      checkChronicle(contradicting, sceneOf('01-issue-franche')).violations.map((one) => one.check),
    ).toContain('C9');
    // Et sans scène, C9 n'a rien à lire : la différence est la scène, pas le document.
    expect(checkChronicle(contradicting, null).violations.map((one) => one.check)).not.toContain(
      'C9',
    );
  });
});
