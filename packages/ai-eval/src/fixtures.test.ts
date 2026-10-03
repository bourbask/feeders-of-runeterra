import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EvalCaseError } from './cases.js';
import {
  CHRONICLE_DIR,
  FIXTURES_DIR,
  fixtureLoader,
  loadChronicle,
  loadFixture,
} from './fixtures.js';

const made: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'for-m027-fixtures-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const copiedChronicle = (): string => {
  const dir = scratch();
  cpSync(CHRONICLE_DIR, dir, { recursive: true });
  return dir;
};

describe('la fixture de campagne', () => {
  it('se lit et porte ses six acteurs', () => {
    const fixture = loadFixture('avarosa');
    expect(fixture.actors.map((one) => one.name).sort()).toEqual(
      ['Brynja', 'Ingvild', 'Keld', 'Signy', 'Torvald', 'Ulrun'].sort(),
    );
    expect(fixture.actors.find((one) => one.name === 'Keld')?.isDead).toBe(true);
  });

  it('refuse un champion réservé sans alias — ce serait un verrou à une porte', () => {
    const dir = scratch();
    const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, 'avarosa.json'), 'utf8')) as {
      campaign: { reserved_champions: { aliases: string[] }[] };
    };
    const first = raw.campaign.reserved_champions[0];
    if (first === undefined) throw new Error('fixture sans réservé');
    first.aliases = [];
    writeFileSync(join(dir, 'avarosa.json'), JSON.stringify(raw), 'utf8');
    expect(() => loadFixture('avarosa', dir, CHRONICLE_DIR)).toThrow(/alias/u);
  });

  it('mémoïse : douze cas partagent une fixture, et les octets doivent être les mêmes', () => {
    const loader = fixtureLoader();
    expect(loader('avarosa')).toBe(loader('avarosa'));
  });
});

describe('la chronique partagée', () => {
  it('passe le schéma de production ChronicleDoc', () => {
    expect(loadChronicle('avarosa').doc.facts.length).toBeGreaterThan(0);
  });

  it('refuse un document que ChronicleDoc rejette', () => {
    const dir = copiedChronicle();
    writeFileSync(
      join(dir, 'avarosa.json'),
      JSON.stringify({ doc: { premise: 'x' }, known_event_seq_max: 1, target_event_seq: 1 }),
      'utf8',
    );
    expect(() => loadChronicle('avarosa', dir)).toThrow(EvalCaseError);
  });

  it('refuse une liste de faits dorés vide — C6 n’aurait rien à tenir', () => {
    const dir = copiedChronicle();
    writeFileSync(join(dir, 'avarosa.golden.json'), JSON.stringify({ fact_ids: [] }), 'utf8');
    expect(() => loadChronicle('avarosa', dir)).toThrow(/fait doré/u);
  });

  it('les faits dorés vivent dans un AUTRE fichier que le document', () => {
    // C6 compare deux fichiers : une liste et son document. Même fichier, même opérande.
    const doc = readFileSync(join(CHRONICLE_DIR, 'avarosa.json'), 'utf8');
    expect(doc).not.toMatch(/golden_fact_ids|fact_ids/u);
    expect(readFileSync(join(CHRONICLE_DIR, 'avarosa.golden.json'), 'utf8')).toMatch(/fact_ids/u);
  });
});
