/**
 * Les six familles de pièces de scénario, vues du CHARGEUR (S-01, ADR 0012).
 *
 * Ce que `@for/contracts` prouve, c'est qu'un document isolé est bien formé.
 * Ce qui se prouve ici, et nulle part ailleurs, c'est que le chargeur les
 * connaît : qu'il les ramasse, qu'il résout leurs références, qu'il les compte
 * et qu'il les sert. Un schéma qu'aucune passe n'appelle est un schéma mort.
 *
 * Le bundle de référence est celui de `content-fixtures`, AUGMENTÉ EN MÉMOIRE :
 * aucun fichier de scénario n'est écrit sur le disque par S-01, parce que les
 * pièces sont la livraison de S-03. Les documents ci-dessous sont donc des
 * fixtures de test, pas du contenu de jeu.
 *
 * Toutes les violations sont mesurées DANS LES DEUX SENS sur le même bundle.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EncounterSchema,
  FigureSchema,
  FrontSchema,
  HookSchema,
  NodeSchema,
  PeriodSchema,
} from '@for/contracts';

import { readContentFiles } from '../src/load.js';
import { createRegistry, UnknownContentIdError } from '../src/registry.js';
import type { ContentIssue } from '../src/validate.js';
import { collectRefs, ContentError, KNOWN_DIRECTORIES, validateContent } from '../src/validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'content-fixtures');

// ─────────────────────────────────────────────────────────────────────────
// Les documents de scénario, cohérents avec content-fixtures :
// régions `avarosa-reach` et `freljord`, factions `avarosans` et
// `gardiens-du-givre` (déclarées dans freljord.json), oracle `complication`,
// champion `braum`.

const PERIOD = {
  schemaVersion: 1,
  id: 'freljord-moderne',
  name: 'Le Freljord moderne',
  summary: 'Trois prétendantes, un seul hiver, et du grain qui manque partout.',
  after: 300,
  before: null,
  factionIds: ['avarosans'],
  absentFactionIds: ['gardiens-du-givre'],
};

const FRONT = {
  schemaVersion: 1,
  id: 'la-famine-remonte-le-fleuve',
  name: 'La famine remonte le fleuve',
  stake: 'Les greniers de la Portée, et les clans qui en dépendent.',
  segments: 4,
  portents: [
    'Un convoi de grain n’arrive pas, et personne ne va voir pourquoi.',
    'Le conseil rationne, et deux clans refusent la mesure.',
    'Un hameau de l’est mange ses bêtes de trait.',
    'La Portée ouvre ses portes aux armes plutôt qu’aux affamés.',
  ],
  periodId: 'freljord-moderne',
  regionIds: ['avarosa-reach'],
};

const FIGURE = {
  schemaVersion: 1,
  id: 'la-gardienne-du-grain',
  name: 'La gardienne du grain',
  wants: 'Que le grenier tienne jusqu’au dégel, quel qu’en soit le prix.',
  refuses: 'Servir un clan avant un autre, même celui qui la nourrit.',
  knows: 'Le compte exact des sacs, et le jour où il a cessé d’être juste.',
  disposition: 'neutre',
  factionId: 'avarosans',
  periodId: 'freljord-moderne',
};

const lead = (toNodeId: string, trigger: string): Record<string, string> => ({
  toNodeId,
  trigger,
});

/** Quatre nœuds, chacun avec trois sorties distinctes. Le plus petit graphe légal. */
const NODE_IDS = [
  'le-grenier-vide',
  'le-convoi-retourne',
  'le-conseil-des-clans',
  'la-taverne-du-pont',
] as const;

const nodeDocument = (id: string, index: number): Record<string, unknown> => ({
  schemaVersion: 1,
  id,
  name: `Nœud ${String(index + 1)}`,
  kind: 'lieu',
  situation: 'Un endroit où quelque chose est déjà arrivé, et personne ne le dit.',
  stakeQuestion: 'Qui a vidé le grenier, et à qui l’a-t-il donné ?',
  figureIds: ['la-gardienne-du-grain'],
  regionId: 'avarosa-reach',
  periodId: 'freljord-moderne',
  entryPoint: index === 0,
  leads: NODE_IDS.filter((other) => other !== id).map((other) =>
    lead(other, `On part vers « ${other} ».`),
  ),
});

const HOOK = {
  schemaVersion: 1,
  id: 'on-vous-doit-un-hiver',
  name: 'On vous doit un hiver',
  appliesTo: { kind: 'champion', championId: 'braum' },
  pitch: 'Le hameau qui vous a nourris l’an dernier n’a rien reçu cette année.',
  vowRank: 'dangereux',
  suggestedBondIds: ['la-gardienne-du-grain'],
  periodId: 'freljord-moderne',
};

const ENCOUNTER = {
  schemaVersion: 1,
  id: 'le-colporteur-de-sel',
  name: 'Le colporteur de sel',
  kind: 'marchand',
  summary: 'Il vend du sel au prix du fer, et il a de bonnes raisons.',
  periodId: 'freljord-moderne',
  regionKinds: ['etablissement', 'site'],
  oracleRef: 'complication',
};

/** Le compte annoncé, famille par famille. Parcouru par `withScenario`. */
const SCENARIO_COUNTS: Readonly<Record<string, number>> = {
  periods: 1,
  fronts: 1,
  nodes: NODE_IDS.length,
  figures: 1,
  hooks: 1,
  encounters: 1,
};

const write = (map: Map<string, string>, file: string, document: unknown): void => {
  map.set(file, JSON.stringify(document, null, 2));
};

/** Le bundle des fixtures, plus les pièces de scénario et leurs comptes. */
const withScenario = (): Map<string, string> => {
  const map = new Map(readContentFiles(FIXTURES));
  write(map, 'periods/freljord-moderne.json', PERIOD);
  write(map, 'fronts/la-famine-remonte-le-fleuve.json', FRONT);
  write(map, 'figures/la-gardienne-du-grain.json', FIGURE);
  write(map, 'hooks/on-vous-doit-un-hiver.json', HOOK);
  write(map, 'encounters/le-colporteur-de-sel.json', ENCOUNTER);
  for (const [index, id] of NODE_IDS.entries()) {
    write(map, `nodes/${id}.json`, nodeDocument(id, index));
  }
  const manifest = JSON.parse(map.get('manifest.json') ?? '{}') as {
    expectedCounts: Record<string, number>;
  };
  manifest.expectedCounts = { ...manifest.expectedCounts, ...SCENARIO_COUNTS };
  write(map, 'manifest.json', manifest);
  return map;
};

const edit = (
  map: Map<string, string>,
  file: string,
  mutate: (document: Record<string, unknown>) => void,
): Map<string, string> => {
  const document = JSON.parse(map.get(file) ?? '{}') as Record<string, unknown>;
  mutate(document);
  write(map, file, document);
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

const report = (issues: readonly ContentIssue[]): string => JSON.stringify(issues);

/** Les messages seuls : `JSON.stringify` échappe les guillemets de la passe 3. */
const messages = (issues: readonly ContentIssue[]): string =>
  issues.map((issue) => issue.message).join('\n');

// ─────────────────────────────────────────────────────────────────────────

describe('le chargeur connaît les six familles', () => {
  it('les charge, et le vert n’est pas vide', () => {
    const bundle = validateContent(withScenario(), { root: 'content-fixtures' });
    expect(bundle.periods.size).toBe(1);
    expect(bundle.fronts.size).toBe(1);
    expect(bundle.nodes.size).toBe(4);
    expect(bundle.figures.size).toBe(1);
    expect(bundle.hooks.size).toBe(1);
    expect(bundle.encounters.size).toBe(1);
    expect(bundle.fronts.get('la-famine-remonte-le-fleuve')?.portents).toHaveLength(4);
  });

  it('un bundle SANS aucune pièce de scénario charge quand même', () => {
    // S-01 livre le vocabulaire, S-03 livre les pièces. Entre les deux,
    // `content/` n'a ni période ni front, et `pnpm content:check` doit sortir
    // en 0. Si cette ligne tombe, c'est que les six répertoires sont devenus
    // obligatoires et que le dépôt ne se charge plus jusqu'à S-03.
    const bundle = validateContent(new Map(readContentFiles(FIXTURES)), {
      root: 'content-fixtures',
    });
    expect(bundle.periods.size).toBe(0);
    expect(bundle.nodes.size).toBe(0);
  });

  it.each([
    ['periods', 'periods/freljord-moderne.json'],
    ['fronts', 'fronts/la-famine-remonte-le-fleuve.json'],
    ['nodes', 'nodes/le-grenier-vide.json'],
    ['figures', 'figures/la-gardienne-du-grain.json'],
    ['hooks', 'hooks/on-vous-doit-un-hiver.json'],
    ['encounters', 'encounters/le-colporteur-de-sel.json'],
  ])('%s/ est un répertoire connu, et un champ en trop y est refusé', (directory, file) => {
    expect(KNOWN_DIRECTORIES as readonly string[]).toContain(directory);
    const issues = refused(
      edit(withScenario(), file, (document) => {
        document['champInvente'] = 'ce que personne ne valide';
      }),
    );
    expect(issues.some((issue) => issue.file === file && issue.pass === 2)).toBe(true);
  });

  it('un répertoire de scénario mal orthographié reste inconnu', () => {
    // Le pendant de la ligne précédente : `KNOWN_DIRECTORIES` s'est allongé de
    // six entrées, et cette liste doit rester fermée.
    const map = withScenario();
    write(map, 'noeuds/le-grenier-vide.json', nodeDocument('le-grenier-vide', 0));
    expect(report(refused(map))).toContain('répertoire inconnu');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PASSE 3 — les références, vues par le VRAI marcheur
describe('les marqueurs `ref:` que la passe 3 cherche', () => {
  it.each([
    ['période', PeriodSchema, PERIOD as unknown, ['faction', 'faction']],
    ['front', FrontSchema, FRONT as unknown, ['period', 'region']],
    ['figure', FigureSchema, FIGURE as unknown, ['faction', 'period']],
    [
      'nœud',
      NodeSchema,
      nodeDocument('le-grenier-vide', 0) as unknown,
      ['figure', 'region', 'period', 'node', 'node', 'node'],
    ],
    ['ressort', HookSchema, HOOK as unknown, ['champion', 'figure', 'period']],
    ['rencontre', EncounterSchema, ENCOUNTER as unknown, ['period', 'oracle']],
  ])('%s : le marcheur trouve exactement les références attendues', (_name, schema, doc, kinds) => {
    // La liste attendue est écrite À LA MAIN, champ par champ ; l'autre membre
    // sort du marcheur de production. Deux chemins, pas un.
    expect(collectRefs(schema, doc).map((found) => found.kind)).toStrictEqual(kinds);
  });

  it.each([
    ['periods/freljord-moderne.json', 'factionIds', ['faction-qui-nexiste-pas'], 'faction'],
    ['fronts/la-famine-remonte-le-fleuve.json', 'periodId', 'periode-inventee', 'période'],
    ['nodes/le-grenier-vide.json', 'regionId', 'region-inventee', 'région'],
    ['figures/la-gardienne-du-grain.json', 'periodId', 'periode-inventee', 'période'],
    ['hooks/on-vous-doit-un-hiver.json', 'suggestedBondIds', ['figure-inventee'], 'figure'],
    ['encounters/le-colporteur-de-sel.json', 'oracleRef', 'oracle-invente', 'oracle'],
  ])('%s : une référence morte est refusée, et nommée', (file, field, value, label) => {
    const clean = validateContent(withScenario(), { root: 'content-fixtures' });
    expect(clean.periods.size).toBe(1);

    const issues = refused(
      edit(withScenario(), file, (document) => {
        document[field] = value;
      }),
    );
    const pass3 = issues.filter((issue) => issue.file === file && issue.pass === 3);
    expect(pass3).not.toStrictEqual([]);
    expect(report(pass3)).toContain(label);
  });

  it('une piste vers un nœud inexistant est refusée', () => {
    const issues = refused(
      edit(withScenario(), 'nodes/le-grenier-vide.json', (document) => {
        const leads = document['leads'] as Record<string, string>[];
        leads[0] = lead('le-noeud-qui-nexiste-pas', 'On y va quand même.');
      }),
    );
    expect(messages(issues)).toContain('nœud "le-noeud-qui-nexiste-pas" introuvable');
  });

  it('les factions se résolvent contre les régions, pas contre une liste figée', () => {
    // `gardiens-du-givre` n'est déclarée nulle part ailleurs que dans
    // `regions/freljord.json`. La retirer de là doit tuer la référence que la
    // période y fait — c'est ce qui prouve que l'index des factions est
    // RAMASSÉ et non recopié.
    const issues = refused(
      edit(withScenario(), 'regions/freljord.json', (document) => {
        document['factions'] = [];
      }),
    );
    expect(messages(issues)).toContain('faction "gardiens-du-givre" introuvable');
    expect(messages(issues)).toContain('faction "avarosans" introuvable');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PASSE 4 — ce que le manifeste annonce
describe('une famille livrée est une famille comptée', () => {
  it('les six familles sont comptées, et ce sont bien ces six-là', () => {
    // SCENARIO_COUNTS est la source de boucle des `it.each` ci-dessous : la
    // vider les rendrait vides sans rien faire tomber. Cette ligne est ce qui
    // tombe alors, et les six noms viennent de l'ADR 0012 décision 2.
    expect(Object.keys(SCENARIO_COUNTS)).toStrictEqual([
      'periods',
      'fronts',
      'nodes',
      'figures',
      'hooks',
      'encounters',
    ]);
  });

  it.each(Object.keys(SCENARIO_COUNTS))(
    '%s : retirer le compte du manifeste fait échouer la passe 4',
    (family) => {
      const issues = refused(
        edit(withScenario(), 'manifest.json', (document) => {
          const counts = document['expectedCounts'] as Record<string, number>;
          document['expectedCounts'] = Object.fromEntries(
            Object.entries(counts).filter(([key]) => key !== family),
          );
        }),
      );
      const named = issues.filter((issue) => issue.path === `expectedCounts.${family}`);
      expect(named).not.toStrictEqual([]);
      expect(report(named)).toContain('aucun compte annoncé');
    },
  );

  it.each(Object.keys(SCENARIO_COUNTS))('%s : un compte faux est refusé', (family) => {
    const issues = refused(
      edit(withScenario(), 'manifest.json', (document) => {
        const counts = document['expectedCounts'] as Record<string, number>;
        counts[family] = (counts[family] ?? 0) + 1;
      }),
    );
    expect(report(issues)).toContain(`expectedCounts.${family}`);
  });

  it('un compte de scénario absent sur un bundle sans scénario ne dit rien', () => {
    // L'autre sens de la règle : c'est la PRÉSENCE de documents qui exige le
    // compte, pas le schéma. Sinon la règle rendrait les six répertoires
    // obligatoires par la bande.
    const bundle = validateContent(new Map(readContentFiles(FIXTURES)), {
      root: 'content-fixtures',
    });
    expect(bundle.encounters.size).toBe(0);
  });

  it.each([
    ['periods/freljord-moderne.json', 'freljord-moderne'],
    ['nodes/le-grenier-vide.json', 'le-grenier-vide'],
    ['hooks/on-vous-doit-un-hiver.json', 'on-vous-doit-un-hiver'],
  ])('%s : un id qui diffère du nom de fichier est refusé', (file, expected) => {
    const issues = refused(
      edit(withScenario(), file, (document) => {
        document['id'] = 'renomme-a-moitie';
      }),
    );
    expect(report(issues)).toContain(expected);
  });
});

describe('deux familles ne partagent pas un identifiant', () => {
  it('une figure et une rencontre du même nom sont refusées', () => {
    const map = withScenario();
    write(map, 'encounters/la-gardienne-du-grain.json', {
      ...ENCOUNTER,
      id: 'la-gardienne-du-grain',
    });
    const manifest = JSON.parse(map.get('manifest.json') ?? '{}') as {
      expectedCounts: Record<string, number>;
    };
    manifest.expectedCounts['encounters'] = 2;
    write(map, 'manifest.json', manifest);
    expect(report(refused(map))).toContain('partagé par deux types de contenu');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LE REGISTRE
describe('le registre sert les six familles', () => {
  const registry = () =>
    createRegistry(validateContent(withScenario(), { root: 'content-fixtures' }));

  it('rend la pièce demandée, triée par identifiant', () => {
    expect(registry().getPeriod('freljord-moderne').name).toBe('Le Freljord moderne');
    expect(registry().getFront('la-famine-remonte-le-fleuve').segments).toBe(4);
    expect(registry().getFigure('la-gardienne-du-grain').disposition).toBe('neutre');
    expect(registry().getHook('on-vous-doit-un-hiver').vowRank).toBe('dangereux');
    expect(registry().getEncounter('le-colporteur-de-sel').kind).toBe('marchand');
    // Quatre entrées, dans un ordre d'insertion qui N'EST PAS l'ordre trié —
    // et le tableau attendu est écrit en toutes lettres, jamais re-trié ici.
    expect(
      registry()
        .listNodes()
        .map((node) => node.id),
    ).toStrictEqual([
      'la-taverne-du-pont',
      'le-conseil-des-clans',
      'le-convoi-retourne',
      'le-grenier-vide',
    ]);
  });

  it.each([
    ['getPeriod', 'période'],
    ['getFront', 'front'],
    ['getNode', 'nœud'],
    ['getFigure', 'figure'],
    ['getHook', 'ressort'],
    ['getEncounter', 'rencontre'],
  ])('%s sur un id inconnu jette en nommant la famille, en français', (method, label) => {
    const instance = registry() as unknown as Record<string, (id: string) => unknown>;
    let caught: unknown;
    try {
      instance[method]?.('ce-qui-nexiste-pas');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnknownContentIdError);
    expect((caught as UnknownContentIdError).message).toContain(label);
  });

  it.each([
    ['listPeriods', 1],
    ['listFronts', 1],
    ['listNodes', 4],
    ['listFigures', 1],
    ['listHooks', 1],
    ['listEncounters', 1],
  ])('%s rend ce que le bundle porte', (method, expected) => {
    const instance = registry() as unknown as Record<string, () => readonly unknown[]>;
    expect(instance[method]?.()).toHaveLength(expected);
  });

  it.each(['findPeriod', 'findFront', 'findNode', 'findFigure', 'findHook', 'findEncounter'])(
    '%s rend undefined plutôt que de jeter',
    (method) => {
      const instance = registry() as unknown as Record<string, (id: string) => unknown>;
      expect(instance[method]?.('ce-qui-nexiste-pas')).toBeUndefined();
    },
  );
});
