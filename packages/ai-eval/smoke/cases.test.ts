import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCases, SMOKE_CASES_DIR, SmokeCaseError } from './cases.js';

const temporaires: string[] = [];

const repertoire = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'for-smoke-cases-'));
  temporaires.push(dir);
  return dir;
};

const VALIDE = {
  id: 'x',
  title: 'un cas',
  actor: 'Sejuani',
  imposed_price: false,
  fact: 'Issue : ÉCHEC.',
  intent: 'Sejuani : « Je traverse. »',
  scene_in: {
    place: 'col',
    time: 'nuit',
    present: [{ name: 'Sejuani', detail: 'debout' }],
    absent: [{ name: 'Keld', detail: 'mort' }],
  },
  locked_champions: [{ name: 'Ashe', aliases: ['la Reine des Neiges'] }],
};

const ecrire = (dir: string, nom: string, contenu: unknown): void => {
  writeFileSync(join(dir, nom), JSON.stringify(contenu), 'utf8');
};

afterEach(() => {
  for (const dir of temporaires.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadCases', () => {
  it('charge les trois cas livrés, identifiants en toutes lettres', () => {
    expect(loadCases().map((c) => c.id)).toEqual(['issue-franche', 'issue-echec', 'prix-impose']);
    expect(SMOKE_CASES_DIR.endsWith('cases')).toBe(true);
  });

  it('trie par nom de fichier, même quand le répertoire les rend à l’envers', () => {
    // Deux entrées, rendues dans l'ordre INVERSE du tri attendu, et le tableau
    // complet est comparé : avec une seule fixture l'ordre ne voudrait rien dire.
    //
    // L'ordre vient du LISTEUR INJECTÉ, pas de l'ordre d'écriture : sur ext4,
    // `readdirSync` rend déjà les noms triés, donc écrire `02-` avant `01-`
    // laisse ce test vert même sans `names.sort()`. Mesuré : sort commenté,
    // 87/87 verts. Avec le listeur, le même sort commenté le fait rougir.
    const dir = repertoire();
    ecrire(dir, '02-second.case.json', { ...VALIDE, id: 'second' });
    ecrire(dir, '01-premier.case.json', { ...VALIDE, id: 'premier' });
    const alEnvers = ['02-second.case.json', '01-premier.case.json'];
    expect(loadCases(dir, () => alEnvers).map((c) => c.id)).toEqual(['premier', 'second']);
  });

  it('le listeur par défaut est bien celui du système de fichiers', () => {
    // Sans ça, le paramètre injecté pourrait ne jamais être câblé sur
    // `readdirSync` et les trois cas livrés viendraient d'ailleurs.
    expect(loadCases(SMOKE_CASES_DIR).map((c) => c.id)).toEqual(
      loadCases(SMOKE_CASES_DIR, (d) => readdirSync(d)).map((c) => c.id),
    );
  });

  it('ignore ce qui ne porte pas le suffixe de cas', () => {
    const dir = repertoire();
    ecrire(dir, '01-premier.case.json', VALIDE);
    writeFileSync(join(dir, 'LISEZMOI.md'), 'pas un cas', 'utf8');
    expect(loadCases(dir)).toHaveLength(1);
  });

  it('rend un tableau vide sur un répertoire vide — c’est runSmoke qui refuse', () => {
    expect(loadCases(repertoire())).toEqual([]);
  });

  it('nomme le répertoire introuvable', () => {
    expect(() => loadCases(join(tmpdir(), 'for-smoke-absent-xyz'))).toThrow(SmokeCaseError);
  });

  it('nomme le champ manquant plutôt que de laisser passer un cas creux', () => {
    const dir = repertoire();
    // `JSON.stringify` laisse tomber la clé : le fichier écrit n'a pas de `fact`.
    ecrire(dir, '01-troue.case.json', { ...VALIDE, fact: undefined });
    expect(() => loadCases(dir)).toThrow(/« fact »/u);
  });

  it('refuse une liste de champions verrouillés vide', () => {
    // Une liste vide rendrait `no_locked_champion` verte par construction.
    const dir = repertoire();
    ecrire(dir, '01-sans-verrou.case.json', { ...VALIDE, locked_champions: [] });
    expect(() => loadCases(dir)).toThrow(/locked_champions/u);
  });

  it('refuse un cas dont un champ n’a pas le bon type, et dit lequel', () => {
    // Un cas par défaut, chacun dans son propre répertoire : l'ordre de lecture
    // n'entre pas en jeu et le message attendu est comparé en entier.
    const defauts: readonly [string, unknown, RegExp][] = [
      ['booleen', { ...VALIDE, imposed_price: 'oui' }, /« imposed_price » doit être un booléen/u],
      [
        'tableau',
        { ...VALIDE, locked_champions: 'Ashe' },
        /« locked_champions » doit être un tableau/u,
      ],
      [
        'alias',
        { ...VALIDE, locked_champions: [{ name: 'Ashe', aliases: [''] }] },
        /aliases\[0\] : chaîne non vide attendue/u,
      ],
      ['racine', ['pas un objet'], /un objet est attendu/u],
      [
        'scene',
        { ...VALIDE, scene_in: { ...VALIDE.scene_in, present: [{}] } },
        /« name » doit être une chaîne non vide/u,
      ],
    ];
    const messages = defauts.map(([nom, contenu]) => {
      const dir = repertoire();
      ecrire(dir, `01-${nom}.case.json`, contenu);
      try {
        loadCases(dir);
        return `${nom} : aucune erreur`;
      } catch (cause) {
        return `${nom} : ${cause instanceof Error ? cause.message : 'inconnu'}`;
      }
    });
    // Le message porte le nom du défaut en préfixe : un échec dit lequel des
    // cinq est tombé, sans argument de plus à `expect`.
    for (const [index, [, , attendu]] of defauts.entries()) {
      expect(messages[index]).toMatch(attendu);
    }
  });

  it('nomme le fichier illisible', () => {
    const dir = repertoire();
    writeFileSync(join(dir, '01-casse.case.json'), '{ pas du json', 'utf8');
    expect(() => loadCases(dir)).toThrow(/01-casse\.case\.json/u);
  });

  it('les trois cas couvrent une issue franche, un échec et un prix imposé', () => {
    const cas = loadCases();
    expect(cas.map((c) => c.imposedPrice)).toEqual([false, false, true]);
    expect(cas[0]?.fact).toContain('RÉUSSITE FRANCHE');
    expect(cas[1]?.fact).toContain('ÉCHEC');
    expect(cas[2]?.fact).toContain('Prix imposé');
  });

  it('chaque cas porte sa scène d’entrée et sa liste verrouillée', () => {
    for (const cas of loadCases()) {
      expect(cas.sceneIn.present.length).toBeGreaterThan(0);
      expect(cas.sceneIn.absent.length).toBeGreaterThan(0);
      expect(cas.lockedChampions.flatMap((c) => c.aliases).length).toBeGreaterThan(0);
    }
  });
});
