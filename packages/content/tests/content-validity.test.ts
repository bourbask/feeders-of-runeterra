/**
 * The four passes, proven by BREAKING them.
 *
 * Every guard-rail below is exercised in both directions: red with the fault,
 * green without it, on the SAME bundle. A test that only shows the happy path
 * proves that the loader runs, never that it refuses anything — and this
 * package's whole job is refusing.
 *
 * Two faults get their own section because they are the ones that sank two
 * earlier tasks: a MISSING file quietly accepted, and a count compared against
 * an EMPTY set.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { MoveContent } from '@for/contracts';

import { staticBundle } from '../src/index.js';
import { JsonSyntaxError, parseJsonSource } from '../src/json-source.js';
import { loadContent, readContentFiles } from '../src/load.js';
import { canonicalJson } from '../src/manifest.js';
import { createRegistry, UnknownContentIdError } from '../src/registry.js';
import type { ContentIssue } from '../src/validate.js';
import {
  ContentError,
  REQUIRED_DIRECTORIES,
  REQUIRED_FILES,
  UNVALIDATED_PATHS,
  validateContent,
} from '../src/validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FIXTURES = join(REPO, 'content-fixtures');
const BROKEN = join(REPO, 'content-fixtures-broken');
const SRC = join(HERE, '..', 'src');

/** A fresh, mutable copy of the fixture bundle. */
const files = (): Map<string, string> => new Map(readContentFiles(FIXTURES));

const edit = (
  map: Map<string, string>,
  file: string,
  mutate: (document: Record<string, unknown>) => void,
): Map<string, string> => {
  const document = JSON.parse(map.get(file) ?? '{}') as Record<string, unknown>;
  mutate(document);
  map.set(file, JSON.stringify(document, null, 2));
  return map;
};

const refused = (map: ReadonlyMap<string, string>): readonly ContentIssue[] => {
  try {
    validateContent(map, { root: 'content-fixtures' });
  } catch (error) {
    if (error instanceof ContentError) return error.issues;
    throw error;
  }
  throw new Error('le contenu a été accepté alors que le test l’avait cassé');
};

const messages = (issues: readonly ContentIssue[]): string => JSON.stringify(issues);

describe('le bundle de référence', () => {
  it('charge en quatre passes, et le vert n’est pas vide', () => {
    const bundle = loadContent(FIXTURES);
    expect(bundle.moves.size).toBe(3);
    expect(bundle.champions.size).toBe(2);
    expect(bundle.championIndex.size).toBe(3);
    expect(bundle.regions.size).toBe(2);
    expect(bundle.oracles.size).toBe(1);
    expect(bundle.assets.size).toBe(2);
    expect(bundle.conditions.size).toBe(2);
    expect(bundle.truths).toHaveLength(1);
    expect(bundle.yesNo.id).toBe('yes-no');
    expect(bundle.priceTable.entries).toHaveLength(12);
    expect(bundle.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('dit tout haut ce qu’aucun schéma ne valide, et rien de plus', () => {
    expect(loadContent(FIXTURES).unvalidated).toStrictEqual([...UNVALIDATED_PATHS]);
  });

  it('donne le même hash à deux mises en forme du même contenu', () => {
    const reformatted = files();
    for (const [file, raw] of reformatted) {
      reformatted.set(file, JSON.stringify(JSON.parse(raw)));
    }
    const first = validateContent(files(), { hash: 'a' }).version;
    expect(first).toBe(validateContent(reformatted, { hash: 'a' }).version);
    // The digest is over canonical JSON, so whitespace is not content.
    const canonicalOf = (map: ReadonlyMap<string, string>): string =>
      [...map.keys()]
        .sort()
        .map((file) => canonicalJson(JSON.parse(map.get(file) ?? 'null')))
        .join('');
    expect(canonicalOf(reformatted)).toBe(canonicalOf(files()));
  });
});

describe('le fichier absent — le défaut qui a recalé deux tâches', () => {
  it('refuse une racine qui n’existe pas, au lieu de rendre un bundle vide', () => {
    const absent = (): unknown => loadContent(join(REPO, 'content-fixtures-qui-n-existe-pas'));
    expect(absent).toThrow(ContentError);
    const report = ((): string => {
      try {
        absent();
      } catch (error) {
        return (error as ContentError).format();
      }
      return '';
    })();
    expect(report).toContain('racine de contenu introuvable');
  });

  it('refuse une racine qui est un fichier', () => {
    expect(() => loadContent(join(FIXTURES, 'manifest.json'))).toThrow(ContentError);
  });

  it('refuse une racine vide plutôt que de charger zéro entité', () => {
    expect(() => validateContent(new Map())).toThrow(ContentError);
    const issues = refused(new Map());
    expect(messages(issues)).toContain('fichier obligatoire absent');
  });

  it.each(REQUIRED_FILES)('rougit sans %s, et reverdit avec', (required) => {
    const without = files();
    without.delete(required);
    const issues = refused(without);
    expect(issues.some((issue) => issue.file === required)).toBe(true);
    expect(() => validateContent(files())).not.toThrow();
  });

  it.each(REQUIRED_DIRECTORIES)('rougit quand %s/ est vide, et reverdit avec', (directory) => {
    const without = files();
    for (const file of [...without.keys()]) {
      if (file.startsWith(`${directory}/`)) without.delete(file);
    }
    expect(messages(refused(without))).toContain(`${directory}/`);
    expect(() => validateContent(files())).not.toThrow();
  });

  it('refuse un fichier qu’aucun schéma ne valide', () => {
    const extra = files();
    extra.set('moves/notes.txt', 'ceci n’est pas du contenu');
    expect(messages(refused(extra))).toContain('fichier inattendu');
  });

  it('refuse un répertoire inconnu sous la racine', () => {
    const extra = files();
    extra.set('brouillons/idee.json', '{}');
    expect(messages(refused(extra))).toContain('répertoire inconnu');
  });
});

describe('le manifeste qui annonce plus qu’il n’y en a', () => {
  it('rougit quand expectedCounts dépasse le chargé, et reverdit quand il colle', () => {
    const inflated = edit(files(), 'manifest.json', (document) => {
      (document['expectedCounts'] as Record<string, number>)['champions'] = 3;
    });
    expect(messages(refused(inflated))).toContain('le manifeste annonce 3 champions, 2 chargé(s)');
    expect(() => validateContent(files())).not.toThrow();
  });

  it('rougit AUSSI quand expectedCounts est en dessous : un écart, pas un seuil', () => {
    const deflated = edit(files(), 'manifest.json', (document) => {
      (document['expectedCounts'] as Record<string, number>)['moves'] = 2;
    });
    expect(messages(refused(deflated))).toContain('le manifeste annonce 2 moves, 3 chargé(s)');
  });

  /**
   * `champions-index.json` was counted by NOTHING. Measured on the previous
   * version: cutting the directory to the 2 entries that have a sheet left
   * `content:check` at 0 and printed « 2 entrées d'annuaire » without
   * blinking — on the file that carries the casting lock.
   */
  it('rougit quand l’annuaire est tronqué, et reverdit quand il est entier', () => {
    const truncated = edit(files(), 'champions-index.json', (document) => {
      document['champions'] = (document['champions'] as Record<string, unknown>[]).filter(
        (entry) => entry['id'] !== 'sejuani',
      );
    });
    expect(messages(refused(truncated))).toContain(
      'le manifeste annonce 3 championIndex, 2 chargé(s)',
    );
    expect(() => validateContent(files())).not.toThrow();
  });

  it('rougit AUSSI quand l’annuaire en compte plus que le manifeste', () => {
    const inflated = edit(files(), 'manifest.json', (document) => {
      (document['expectedCounts'] as Record<string, number>)['championIndex'] = 2;
    });
    expect(messages(refused(inflated))).toContain(
      'le manifeste annonce 2 championIndex, 3 chargé(s)',
    );
  });

  it('rougit quand une fiche manque alors que le manifeste la compte', () => {
    const missing = files();
    missing.delete('champions/ashe.json');
    expect(messages(refused(missing))).toContain('le manifeste annonce 2 champions, 1 chargé(s)');
  });
});

describe('passe 1 — syntaxe', () => {
  it('nomme le fichier, la ligne et la colonne', () => {
    const broken = files();
    broken.set('manifest.json', '{\n  "schemaVersion": 1,\n  "version": 0.1.0"\n}\n');
    const issues = refused(broken);
    const syntax = issues.find((issue) => issue.file === 'manifest.json');
    expect(syntax?.message).toContain('JSON invalide');
    expect(syntax?.line).toBe(3);
    expect(syntax?.column).toBeGreaterThan(1);
  });

  it('parse exactement comme JSON.parse sur tout le bundle', () => {
    for (const raw of files().values()) {
      expect(parseJsonSource(raw).value).toStrictEqual(JSON.parse(raw));
    }
  });

  /**
   * The loader owns its JSON reader (section 1.2), so two readers can
   * disagree — and they did. `Number('01')` is 1 and `Number('1.')` is 1,
   * while `JSON.parse` refuses both. Measured on the previous version: a
   * manifest carrying `"rulesVersion": 01` left `content:check` at 0, and
   * `content:index` then died on a raw stack. This compares the two readers
   * token by token instead of trusting either.
   */
  it.each(['01', '1.', '.5', '-', '+1', '1e', '0x10', '1.2.3', '00', '-.5', '1e+'])(
    'refuse le nombre « %s », exactement comme JSON.parse',
    (token) => {
      const document = `{ "schemaVersion": 1, "n": ${token} }`;
      expect(() => {
        JSON.parse(document);
      }).toThrow();
      expect(() => parseJsonSource(document)).toThrow(JsonSyntaxError);
    },
  );

  it.each(['0', '-0', '1', '-1', '1.5', '1e3', '1E+3', '1e-3', '0.5', '12345'])(
    'accepte le nombre « %s », et rend la même valeur que JSON.parse',
    (token) => {
      const document = `{ "schemaVersion": 1, "n": ${token} }`;
      expect(parseJsonSource(document).value).toStrictEqual(JSON.parse(document));
    },
  );

  it('rougit sur un « 01 » dans le manifeste, et reverdit sans', () => {
    const broken = files();
    const raw = broken.get('manifest.json') ?? '';
    broken.set('manifest.json', raw.replace('"rulesVersion": 1', '"rulesVersion": 01'));
    expect(messages(refused(broken))).toContain('nombre malformé');
    expect(() => validateContent(files())).not.toThrow();
  });

  /**
   * `fallbacks/narration.json` has no schema, and the previous version
   * skipped it in pass 1 too: `{ ceci n est pas du JSON` left
   * `content:check` at 0 while the summary announced the file as present.
   */
  it('rougit sur un fichier NON VALIDÉ dont la syntaxe est cassée', () => {
    const broken = files();
    broken.set('fallbacks/narration.json', '{ ceci n’est pas du JSON');
    const issue = refused(broken).find((candidate) => candidate.file === UNVALIDATED_PATHS[0]);
    expect(issue?.message).toContain('JSON invalide');
    expect(issue?.pass).toBe(1);
    // Green without: its SHAPE is still nobody's business.
    const reshaped = files();
    reshaped.set('fallbacks/narration.json', '{"nimporte":"quoi"}');
    expect(() => validateContent(reshaped)).not.toThrow();
  });
});

describe('passe 2 — Zod, toutes les erreurs d’un coup', () => {
  it('rapporte les deux fichiers cassés, pas le premier seulement', () => {
    const broken = edit(files(), 'champions/ashe.json', (document) => {
      document['attributes'] = { vif: 3, coeur: 3, fer: 2, ombre: 1, esprit: 1 };
    });
    edit(broken, 'champions/braum.json', (document) => {
      document['aliases'] = [];
    });
    const touched = new Set(refused(broken).map((issue) => issue.file));
    expect([...touched].sort()).toStrictEqual(['champions/ashe.json', 'champions/braum.json']);
  });

  it('pointe la ligne du champ fautif', () => {
    const broken = files();
    const raw = broken.get('champions/braum.json') ?? '';
    broken.set(
      'champions/braum.json',
      raw.replace('"startingMomentum": 2', '"startingMomentum": 99'),
    );
    const issue = refused(broken).find((candidate) => candidate.path === 'startingMomentum');
    expect(issue?.line).toBe(raw.slice(0, raw.indexOf('"startingMomentum"')).split('\n').length);
  });
});

describe('passe 3 — références', () => {
  it('refuse une référence morte et suggère la bonne', () => {
    const broken = edit(files(), 'champions/braum.json', (document) => {
      document['startingAssets'] = ['bouclier-de-porte-basse'];
    });
    expect(messages(refused(broken))).toContain('(suggestion : \\"bouclier-de-porte\\")');
  });

  it('résout aussi les références nues de l’union d’effets du moteur', () => {
    // `conditionId` inside `zEngineEffect` carries no `ref:` marker: it is the
    // engine mirror, owned by `contracts`. Resolved here by field name.
    const broken = files();
    const raw = broken.get('moves/endure-cold.json') ?? '';
    broken.set('moves/endure-cold.json', raw.replace('"transi"', '"transis"'));
    const issue = refused(broken).find((candidate) => candidate.message.includes('transis'));
    expect(issue?.message).toBe('condition "transis" introuvable (suggestion : "transi")');
    expect(issue?.path).toBe('outcomes.echec.effects[1].conditionId');
  });

  it('résout `tableId` d’un effet oracle', () => {
    const broken = files();
    const raw = broken.get('moves/secure-advantage.json') ?? '';
    broken.set('moves/secure-advantage.json', raw.replace('"complication"', '"complications"'));
    expect(messages(refused(broken))).toContain('table \\"complications\\" introuvable');
  });

  /**
   * The `choice` effect is RECURSIVE (ADR 0006), so its options point back at
   * the same `z.lazy`. A guard keyed on the getter alone stopped the walk
   * there and reported nothing underneath — measured: exit 0 on a dead
   * `conditionId` AND a dead `tableId` nested in a `choice`.
   */
  const withChoice = (conditionId: string, tableId: string): Map<string, string> =>
    edit(files(), 'moves/endure-cold.json', (document) => {
      const outcomes = document['outcomes'] as Record<string, Record<string, unknown>>;
      const echec = outcomes['echec'];
      if (echec === undefined) throw new Error('la fixture n’a plus d’issue « echec »');
      echec['effects'] = [
        {
          op: 'choice',
          label: 'Céder du terrain, ou tenir et payer.',
          options: [
            { id: 'ceder', label: 'Céder', effects: [{ op: 'condition_add', conditionId }] },
            {
              id: 'tenir',
              label: 'Tenir',
              effects: [
                {
                  op: 'choice',
                  label: 'Et comment ?',
                  options: [
                    { id: 'vite', label: 'Vite', effects: [{ op: 'oracle', tableId }] },
                    { id: 'lentement', label: 'Lentement', effects: [] },
                  ],
                },
              ],
            },
          ],
        },
      ];
    });

  it('refuse une référence morte imbriquée dans un effet `choice`', () => {
    const issues = refused(withChoice('transis', 'complication'));
    const dead = issues.find((issue) => issue.message.includes('transis'));
    expect(dead?.message).toBe('condition "transis" introuvable (suggestion : "transi")');
    expect(dead?.path).toBe('outcomes.echec.effects[0].options[0].effects[0].conditionId');
  });

  it('refuse une `tableId` morte DEUX `choice` plus bas', () => {
    const issues = refused(withChoice('transi', 'complications'));
    const dead = issues.find((issue) => issue.message.includes('complications'));
    expect(dead?.message).toBe('table "complications" introuvable (suggestion : "complication")');
    expect(dead?.path).toBe(
      'outcomes.echec.effects[0].options[1].effects[0].options[0].effects[0].tableId',
    );
  });

  it('accepte le MÊME `choice` quand les deux références existent', () => {
    // Green without, red with, on the same bundle: the two above would pass
    // just as well if the walk had simply stopped short of the `choice`.
    expect(() => validateContent(withChoice('transi', 'complication'))).not.toThrow();
  });

  it('vérifie les références d’un fichier qui a DÉJÀ échoué en passe 2', () => {
    const broken = edit(files(), 'champions/ashe.json', (document) => {
      document['attributes'] = { vif: 3, coeur: 3, fer: 2, ombre: 1, esprit: 1 };
      document['startingAssets'] = ['arc-du-givre'];
    });
    const issues = refused(broken);
    expect(issues.map((issue) => issue.pass).sort()).toStrictEqual([2, 3]);
  });

  it('accepte un champion cité qui n’a pas de fiche mais une entrée d’annuaire', () => {
    const cited = edit(files(), 'champions/braum.json', (document) => {
      document['relations'] = [
        { championId: 'sejuani', kind: 'rival', text: 'Ils ne parlent plus.' },
      ];
    });
    expect(() => validateContent(cited)).not.toThrow();
  });
});

describe('passe 4 — invariants globaux', () => {
  it('refuse un id différent du nom de fichier', () => {
    const renamed = edit(files(), 'moves/endure-cold.json', (document) => {
      document['id'] = 'endure-the-cold';
    });
    expect(messages(refused(renamed))).toContain('diffère du nom de fichier');
  });

  it('refuse une référence circulaire entre régions', () => {
    const cycle = edit(files(), 'regions/freljord.json', (document) => {
      document['parentId'] = 'avarosa-reach';
    });
    expect(messages(refused(cycle))).toContain('référence circulaire entre régions');
    expect(() => validateContent(files())).not.toThrow();
  });

  it('refuse une région qui est sa propre mère', () => {
    const self = edit(files(), 'regions/avarosa-reach.json', (document) => {
      document['parentId'] = 'avarosa-reach';
    });
    expect(messages(refused(self))).toContain('référence circulaire entre régions');
  });

  it('refuse un mouvement qui n’est pas dans MOVE_IDS du moteur', () => {
    const invented = files();
    invented.set(
      'moves/skip-winter.json',
      (invented.get('moves/endure-cold.json') ?? '').replace('"endure-cold"', '"skip-winter"'),
    );
    edit(invented, 'manifest.json', (document) => {
      (document['expectedCounts'] as Record<string, number>)['moves'] = 4;
    });
    expect(messages(refused(invented))).toContain("n'est pas un mouvement du moteur");
  });

  it('refuse un id partagé par deux types de contenu', () => {
    const clash = edit(files(), 'conditions.json', (document) => {
      const conditions = document['conditions'] as Record<string, unknown>[];
      // Added, not renamed: renaming would break the references first and pass
      // 4 would never run — which is itself the ordering this loader promises.
      conditions.push({ ...conditions[0], id: 'freljord' });
    });
    expect(messages(refused(clash))).toContain('partagé par deux types de contenu');
  });

  it('refuse une fiche sans entrée d’annuaire', () => {
    const orphan = edit(files(), 'champions-index.json', (document) => {
      document['champions'] = (document['champions'] as Record<string, unknown>[]).filter(
        (entry) => entry['id'] !== 'ashe',
      );
    });
    expect(messages(refused(orphan))).toContain('aucune entrée « ashe »');
  });

  it('refuse un alias retiré d’un seul des deux côtés', () => {
    const drifted = edit(files(), 'champions-index.json', (document) => {
      document['champions'] = (document['champions'] as Record<string, unknown>[]).map((entry) =>
        entry['id'] === 'braum' ? { ...entry, aliases: ['Le Cœur du Freljord'] } : entry,
      );
    });
    expect(messages(refused(drifted))).toContain('alias différents de champions-index.json');
    expect(() => validateContent(files())).not.toThrow();
  });

  it('refuse un nom affiché qui diverge de la fiche', () => {
    const renamed = edit(files(), 'champions-index.json', (document) => {
      document['champions'] = (document['champions'] as Record<string, unknown>[]).map((entry) =>
        entry['id'] === 'ashe' ? { ...entry, displayName: 'Quelqu un d autre' } : entry,
      );
    });
    expect(messages(refused(renamed))).toContain(
      'nom « Ashe » ≠ displayName « Quelqu un d autre »',
    );
    expect(() => validateContent(files())).not.toThrow();
  });

  it('refuse une région canonique qui diverge de la fiche', () => {
    const drifted = edit(files(), 'champions-index.json', (document) => {
      document['champions'] = (document['champions'] as Record<string, unknown>[]).map((entry) =>
        entry['id'] === 'ashe' ? { ...entry, canonicalRegionId: 'avarosa-reach' } : entry,
      );
    });
    expect(messages(refused(drifted))).toContain('≠ canonicalRegionId');
  });
});

describe('content-fixtures-broken — le rapport de la section 4.8', () => {
  it('sort trois erreurs, dont une avec suggestion', () => {
    const issues = refused(new Map(readContentFiles(BROKEN)));
    expect(issues).toHaveLength(3);
    const report = new ContentError(issues, 'content-fixtures-broken').format();
    expect(report.split('\n').filter((line) => /^\s*→/.test(line))).toHaveLength(3);
    expect(report).toContain('(suggestion :');
    expect(report).toContain('✖ Contenu invalide — le serveur ne démarrera pas (3 erreurs)');
  });
});

describe('le bundle est gelé pour de vrai, pas seulement dans les types', () => {
  /**
   * `staticContent()` memoises ONE bundle for the whole process. Measured on
   * the version this test was written against: the map accepted a `set` and a
   * document accepted a field assignment, so any caller could rewrite a rule
   * of the game for every campaign. `ReadonlyMap` is a type; these are writes.
   */
  it('refuse d’ajouter une règle inventée à chaud', () => {
    const bundle = loadContent(FIXTURES);
    const moves = bundle.moves as Map<string, MoveContent>;
    const copie = moves.get('endure-cold');
    if (copie === undefined) throw new Error('la fixture n’a plus « endure-cold »');
    expect(() => moves.set('invente-par-le-mj', copie)).toThrow(TypeError);
    expect(bundle.moves.size).toBe(3);
    expect(bundle.moves.has('invente-par-le-mj')).toBe(false);
  });

  it('refuse de retirer ou de vider une carte du bundle', () => {
    const bundle = loadContent(FIXTURES);
    const moves = bundle.moves as Map<string, MoveContent>;
    expect(() => moves.delete('endure-cold')).toThrow(TypeError);
    expect(() => {
      moves.clear();
    }).toThrow(TypeError);
    expect(bundle.moves.size).toBe(3);
  });

  it('refuse de réécrire un champ d’un document déjà chargé', () => {
    const bundle = loadContent(FIXTURES);
    const move = bundle.moves.get('endure-cold') as { name: string };
    expect(() => {
      move.name = 'Nom réécrit à chaud';
    }).toThrow(TypeError);
    expect(bundle.moves.get('endure-cold')?.name).toBe('Endurer le froid');
  });

  it('gèle en PROFONDEUR : un effet imbriqué ne se réécrit pas non plus', () => {
    const bundle = loadContent(FIXTURES);
    const effects = bundle.moves.get('endure-cold')?.outcomes.echec.effects as unknown[];
    expect(Object.isFrozen(effects)).toBe(true);
    expect(() => effects.push({ op: 'momentum_reset' })).toThrow(TypeError);
    const effect = effects[1] as { conditionId: string };
    expect(() => {
      effect.conditionId = 'autre-chose';
    }).toThrow(TypeError);
  });

  it('gèle aussi les documents uniques et les listes', () => {
    const bundle = loadContent(FIXTURES);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.priceTable.entries)).toBe(true);
    expect(Object.isFrozen(bundle.truths)).toBe(true);
    expect(Object.isFrozen(bundle.unvalidated)).toBe(true);
    expect(Object.isFrozen(bundle.yesNo)).toBe(true);
    expect(Object.isFrozen(bundle.presages)).toBe(true);
  });

  it('gèle le bundle STATIQUE, celui que staticContent() mémoïse', () => {
    const first = staticBundle();
    expect(() => (first.moves as Map<string, MoveContent>).set('x', {} as MoveContent)).toThrow(
      TypeError,
    );
    // Same object on the second call: a leak here would be a leak for everyone.
    expect(staticBundle()).toBe(first);
  });
});

describe('le registre ne rend jamais undefined', () => {
  it('nomme l’id inconnu et propose le plus proche', () => {
    const registry = createRegistry(loadContent(FIXTURES));
    expect(registry.getMove('endure-cold').name).toBe('Endurer le froid');
    expect(() => registry.getMove('endure-could')).toThrow(UnknownContentIdError);
    expect(() => registry.getMove('endure-could')).toThrow('suggestion');
    expect(registry.findMove('endure-could')).toBeUndefined();
  });
});

describe('aucun accès disque hors du chargeur', () => {
  it('ne trouve ni readFileSync ni fs. ailleurs que dans load.ts', () => {
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && entry.name !== 'load.ts') {
          if (/readFileSync|fs\./.test(readFileSync(full, 'utf8'))) offenders.push(full);
        }
      }
    };
    walk(SRC);
    expect(offenders).toStrictEqual([]);
  });

  /**
   * THE NET THAT WAS TRADED AWAY, REBUILT AS A TEST.
   *
   * `packages/content/tsconfig.json` had to move from `@for/tsconfig/library`
   * to `@for/tsconfig/node` so `load.ts` could compile. That gave the WHOLE
   * package `types: ["node"]`, including the `./ui` sub-entry that
   * 01-architecture.md section 2.5 designates as the only one the client may
   * import — so `import … from 'node:fs'` inside `ui.ts` is no longer a
   * compile error. Declared in the PR. The compile-time net is replaced by
   * this one, which walks the real import graph of `ui.ts` and is run by
   * `pnpm test`, which the CI runs.
   */
  it('l’entrée cliente « @for/content/ui » n’atteint aucun module Node', () => {
    const reachable = new Set<string>();
    const visit = (file: string): void => {
      if (reachable.has(file)) return;
      reachable.add(file);
      const source = readFileSync(file, 'utf8');
      const builtins = [...source.matchAll(/from\s+'(node:[^']+)'|require\('(node:[^']+)'\)/g)];
      expect(builtins.map((match) => match[1] ?? match[2])).toStrictEqual([]);
      for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
        const specifier = match[1] ?? '';
        visit(join(dirname(file), specifier.replace(/\.js$/, '.ts')));
      }
    };
    visit(join(SRC, 'ui.ts'));
    // Green without, red with: the walk must actually have walked, and must
    // never have reached the one module allowed to touch the disk.
    expect(reachable.size).toBeGreaterThan(1);
    expect([...reachable].some((file) => file.endsWith('load.ts'))).toBe(false);
  });
});
