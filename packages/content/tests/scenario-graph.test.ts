/**
 * LA CINQUIÈME PASSE — le graphe de scénario (S-02, ADR 0012 décision 4).
 *
 * Ce que les quatre premières passes prouvent, c'est qu'un fichier est bien
 * écrit. Ce qui se prouve ici, et nulle part ailleurs, c'est qu'un ENSEMBLE de
 * fichiers forme un scénario jouable : qu'on peut arriver partout, qu'aucune
 * piste ne traverse les périodes, et qu'aucun nœud ne nomme quelqu'un qui n'a
 * pas encore vécu.
 *
 * ── CE QUE CHAQUE ASSERTION MESURE ───────────────────────────────────────
 * Toute violation est mesurée DANS LES DEUX SENS sur le même bundle : le vert
 * de référence est recalculé à chaque fois par `accepte()`, et la violation
 * est fabriquée par copie. Et on n'assert pas le code de sortie : on assert
 * LE MESSAGE — la règle citée, la pièce nommée, ce qu'il faut ajouter. Un
 * refus anonyme sur un graphe de vingt nœuds est inutilisable.
 *
 * ── LE 3 DE LA PREMIÈRE RÈGLE ────────────────────────────────────────────
 * Il vient d'un critère d'acceptation, donc il s'écrit EN TOUTES LETTRES
 * ci-dessous et ne se lit jamais depuis `MIN_LEADS_PER_NODE` : un test qui
 * borne avec la constante qu'il vérifie compare un chiffre à lui-même
 * (ADR 0007, corollaire du 25 septembre).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { NodeContent } from '@for/contracts';
import { FigureSchema, HookSchema, NodeSchema } from '@for/contracts';

import { readContentFiles } from '../src/load.js';
import { GRAPH_RULES, validateScenarioGraph } from '../src/validate-graph.js';
import type { ContentIssue } from '../src/validate.js';
import { ContentError, validateContent } from '../src/validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'content-fixtures');

// ─────────────────────────────────────────────────────────────────────────
// Le graphe de référence : deux périodes, deux grappes, aucun îlot.
//
// `content-fixtures` fournit les régions `freljord` et `avarosa-reach`, les
// factions `avarosans` et `gardiens-du-givre` (déclarées dans freljord.json),
// l'oracle `complication` et le champion `braum`.

const MODERNE = 'freljord-moderne';
const ANCIEN = 'la-longue-nuit';

/** Cinq nœuds modernes. Le premier est le point d'entrée, et il porte QUATRE pistes. */
const NOEUDS_MODERNES = [
  'le-grenier-vide',
  'le-convoi-retourne',
  'le-conseil-des-clans',
  'la-taverne-du-pont',
  'le-gue-de-pierre',
] as const;

/** Quatre nœuds anciens, entièrement reliés entre eux. */
const NOEUDS_ANCIENS = [
  'la-porte-emmuree',
  'le-puits-de-glace',
  'la-salle-des-veilleurs',
  'le-chant-sous-la-glace',
] as const;

const FIGURE_MODERNE = 'la-gardienne-du-grain';
const FIGURE_ANCIENNE = 'la-veilleuse-emmuree';

const periode = (
  id: string,
  after: number | null,
  before: number | null,
  presentes: string[],
  absentes: string[],
): Record<string, unknown> => ({
  schemaVersion: 1,
  id,
  name: `Période ${id}`,
  summary: 'Une tranche de frise, et ce qui n’y existe pas encore.',
  after,
  before,
  factionIds: presentes,
  absentFactionIds: absentes,
});

const figure = (id: string, factionId: string, periodId: string): Record<string, unknown> => ({
  schemaVersion: 1,
  id,
  name: `Figure ${id}`,
  wants: 'Que l’hiver passe sans qu’on lui demande de choisir.',
  refuses: 'Livrer un nom, même le sien.',
  knows: 'Où la glace est mince, et depuis quand.',
  disposition: 'neutre',
  factionId,
  periodId,
});

const noeud = (
  id: string,
  grappe: readonly string[],
  periodId: string,
  regionId: string,
  options: { readonly entryPoint: boolean; readonly pistes: number },
): Record<string, unknown> => ({
  schemaVersion: 1,
  id,
  name: `Nœud ${id}`,
  kind: 'lieu',
  situation: 'Un endroit où quelque chose est déjà arrivé, et personne ne le dit.',
  stakeQuestion: 'Qui a vidé le grenier, et à qui l’a-t-il donné ?',
  figureIds: [],
  regionId,
  periodId,
  entryPoint: options.entryPoint,
  leads: grappe
    .filter((autre) => autre !== id)
    .slice(0, options.pistes)
    .map((autre) => ({ toNodeId: autre, trigger: `On part vers « ${autre} ».` })),
});

const DOCUMENTS: readonly (readonly [string, Record<string, unknown>])[] = [
  ['periods/freljord-moderne.json', periode(MODERNE, 300, null, ['avarosans'], [])],
  ['periods/la-longue-nuit.json', periode(ANCIEN, null, 300, ['gardiens-du-givre'], ['avarosans'])],
  ['figures/la-gardienne-du-grain.json', figure(FIGURE_MODERNE, 'avarosans', MODERNE)],
  ['figures/la-veilleuse-emmuree.json', figure(FIGURE_ANCIENNE, 'gardiens-du-givre', ANCIEN)],
  [
    'fronts/la-famine-remonte-le-fleuve.json',
    {
      schemaVersion: 1,
      id: 'la-famine-remonte-le-fleuve',
      name: 'La famine remonte le fleuve',
      stake: 'Les greniers de la Marche, et les clans qui en dépendent.',
      segments: 4,
      portents: [
        'Un convoi de grain n’arrive pas, et personne ne va voir pourquoi.',
        'Le conseil rationne, et deux clans refusent la mesure.',
        'Un hameau de l’est mange ses bêtes de trait.',
        'La Marche ouvre ses portes aux armes plutôt qu’aux affamés.',
      ],
      periodId: MODERNE,
      regionIds: ['avarosa-reach'],
    },
  ],
  [
    'hooks/on-vous-doit-un-hiver.json',
    {
      schemaVersion: 1,
      id: 'on-vous-doit-un-hiver',
      name: 'On vous doit un hiver',
      appliesTo: { kind: 'champion', championId: 'braum' },
      pitch: 'Le hameau qui vous a nourris l’an dernier n’a rien reçu cette année.',
      vowRank: 'dangereux',
      suggestedBondIds: [FIGURE_MODERNE],
      periodId: MODERNE,
    },
  ],
  [
    'encounters/le-colporteur-de-sel.json',
    {
      schemaVersion: 1,
      id: 'le-colporteur-de-sel',
      name: 'Le colporteur de sel',
      kind: 'marchand',
      summary: 'Il vend du sel au prix du fer, et il a de bonnes raisons.',
      periodId: MODERNE,
      regionKinds: ['etablissement'],
      oracleRef: 'complication',
    },
  ],
];

const ecrire = (carte: Map<string, string>, fichier: string, document: unknown): void => {
  carte.set(fichier, JSON.stringify(document, null, 2));
};

/** Le bundle des fixtures, augmenté du graphe. Aucun fichier n'est écrit sur le disque. */
const graphe = (): Map<string, string> => {
  const carte = new Map(readContentFiles(FIXTURES));
  for (const [fichier, document] of DOCUMENTS) ecrire(carte, fichier, document);
  for (const id of NOEUDS_MODERNES) {
    ecrire(
      carte,
      `nodes/${id}.json`,
      noeud(id, NOEUDS_MODERNES, MODERNE, 'avarosa-reach', {
        entryPoint: id === NOEUDS_MODERNES[0],
        pistes: id === NOEUDS_MODERNES[0] ? 4 : 3,
      }),
    );
  }
  for (const id of NOEUDS_ANCIENS) {
    ecrire(
      carte,
      `nodes/${id}.json`,
      noeud(id, NOEUDS_ANCIENS, ANCIEN, 'freljord', {
        entryPoint: id === NOEUDS_ANCIENS[0],
        pistes: 3,
      }),
    );
  }
  return compter(carte);
};

/** Recompte le manifeste depuis la carte : une famille chargée est une famille comptée. */
const compter = (carte: Map<string, string>): Map<string, string> => {
  const manifeste = JSON.parse(carte.get('manifest.json') ?? '{}') as {
    expectedCounts: Record<string, number>;
  };
  for (const famille of ['periods', 'fronts', 'nodes', 'figures', 'hooks', 'encounters']) {
    manifeste.expectedCounts[famille] = [...carte.keys()].filter((fichier) =>
      fichier.startsWith(`${famille}/`),
    ).length;
  }
  ecrire(carte, 'manifest.json', manifeste);
  return carte;
};

const modifier = (
  carte: Map<string, string>,
  fichier: string,
  muter: (document: Record<string, unknown>) => void,
): Map<string, string> => {
  const document = JSON.parse(carte.get(fichier) ?? '{}') as Record<string, unknown>;
  muter(document);
  ecrire(carte, fichier, document);
  return carte;
};

interface Piste {
  toNodeId: string;
  trigger: string;
}
const pistes = (document: Record<string, unknown>): Piste[] => document['leads'] as Piste[];

/** Le refus, et ses problèmes. Échoue bruyamment si le contenu a été accepté. */
const refuse = (carte: ReadonlyMap<string, string>): readonly ContentIssue[] => {
  try {
    validateContent(carte, { root: 'content-fixtures' });
  } catch (error) {
    if (error instanceof ContentError) return error.issues;
    throw error;
  }
  throw new Error('le graphe a été accepté alors que le test venait de le casser');
};

/** L'autre sens : le même bundle, sans la violation, charge. Rend le compte de nœuds. */
const accepte = (carte: ReadonlyMap<string, string>): number =>
  validateContent(carte, { root: 'content-fixtures' }).nodes.size;

/**
 * Les problèmes que TELLE règle a produits.
 *
 * Ancré sur le DÉBUT du message, pas sur `includes` : la règle « trois pistes
 * minimum » cite « pas de saut de période » dans son propre texte, et un
 * filtre non ancré comptait deux fois le même refus. Trouvé par la mesure à
 * deux nœuds, pas par la relecture.
 */
const parRegle = (problemes: readonly ContentIssue[], regle: string): readonly ContentIssue[] =>
  problemes.filter((probleme) => probleme.message.startsWith(`règle « ${regle} » — `));

const texte = (problemes: readonly ContentIssue[]): string =>
  problemes.map((probleme) => probleme.message).join('\n');

// ─────────────────────────────────────────────────────────────────────────

describe('le graphe de référence part', () => {
  it('neuf nœuds, deux périodes, et aucun refus', () => {
    expect(accepte(graphe())).toBe(NOEUDS_MODERNES.length + NOEUDS_ANCIENS.length);
  });

  it('les quatre règles de la passe de graphe, écrites en toutes lettres', () => {
    // Les noms viennent de la fiche S-02 et de la décision 4 de l'ADR 0012.
    // `GRAPH_RULES` est l'autre opérande, et il sort du module de production :
    // deux chemins, pas un.
    expect(Object.values(GRAPH_RULES)).toStrictEqual([
      'trois pistes minimum',
      'aucun nœud orphelin',
      'pas de saut de période',
      'pas de figure hors période',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('règle « pas de saut de période »', () => {
  it('une piste qui change de période est refusée, et les deux périodes sont nommées', () => {
    const problemes = refuse(
      modifier(graphe(), 'nodes/le-grenier-vide.json', (document) => {
        // `le-grenier-vide` porte QUATRE pistes : en détourner une laisse trois
        // sorties vivantes, donc cette mesure ne fait tomber QUE cette règle.
        pistes(document)[0] = { toNodeId: 'le-puits-de-glace', trigger: 'On descend.' };
      }),
    );
    const cites = parRegle(problemes, GRAPH_RULES.periodJump);
    expect(cites).toHaveLength(1);
    const message = cites[0]?.message ?? '';
    expect(message).toContain('le nœud « le-grenier-vide »');
    expect(message).toContain(`« ${MODERNE} »`);
    expect(message).toContain('« le-puits-de-glace »');
    expect(message).toContain(`« ${ANCIEN} »`);
    expect(message).toContain('Visez un nœud de');
    expect(cites[0]?.pass).toBe(5);
    expect(cites[0]?.file).toBe('nodes/le-grenier-vide.json');
    expect(cites[0]?.path).toBe('leads[0].toNodeId');
    // L'autre sens : la piste rendue à sa période, le graphe charge.
    expect(accepte(graphe())).toBe(NOEUDS_MODERNES.length + NOEUDS_ANCIENS.length);
  });

  it('deux nœuds fautifs donnent deux refus, dans l’ordre des identifiants', () => {
    // Sonde 7 : une fixture à un seul élément ne dit rien d'un ordre. Les deux
    // nœuds sont modifiés dans l'ordre INVERSE de leurs identifiants.
    const carte = graphe();
    modifier(carte, 'nodes/le-convoi-retourne.json', (document) => {
      pistes(document)[0] = { toNodeId: 'le-puits-de-glace', trigger: 'On descend.' };
    });
    modifier(carte, 'nodes/le-conseil-des-clans.json', (document) => {
      pistes(document)[0] = { toNodeId: 'la-porte-emmuree', trigger: 'On pousse la porte.' };
    });
    const cites = parRegle(refuse(carte), GRAPH_RULES.periodJump);
    expect(cites.map((probleme) => probleme.file)).toStrictEqual([
      'nodes/le-conseil-des-clans.json',
      'nodes/le-convoi-retourne.json',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('règle « trois pistes minimum »', () => {
  it('trois sorties vivantes passent, deux échouent', () => {
    // LE 3 EST ÉCRIT ICI, PAS LU. Il vient du critère d'acceptation de S-02 et
    // de la règle des trois indices inversée (04-scenarios.md section 3).
    const detourne = (combien: number): Map<string, string> =>
      modifier(graphe(), 'nodes/le-grenier-vide.json', (document) => {
        const liste = pistes(document);
        const ailleurs = ['le-puits-de-glace', 'la-porte-emmuree'];
        for (let index = 0; index < combien; index += 1) {
          liste[index] = { toNodeId: ailleurs[index] ?? '', trigger: 'On change d’époque.' };
        }
      });

    // Une seule piste détournée : quatre pistes moins une, il en reste trois.
    expect(parRegle(refuse(detourne(1)), GRAPH_RULES.liveLeads)).toStrictEqual([]);

    // Deux détournées : il en reste deux, et deux est moins que trois.
    const cites = parRegle(refuse(detourne(2)), GRAPH_RULES.liveLeads);
    expect(cites).toHaveLength(1);
    const message = cites[0]?.message ?? '';
    expect(message).toContain('le nœud « le-grenier-vide »');
    expect(message).toContain('ne garde que 2 sortie(s) sur les 3 exigées');
    expect(message).toContain('« le-puits-de-glace »');
    expect(message).toContain('« la-porte-emmuree »');
    expect(message).toContain('Ajoutez 1 piste(s)');
    expect(cites[0]?.pass).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('règle « aucun nœud orphelin »', () => {
  it('un nœud que personne ne vise, et qui n’est pas un point d’entrée, est refusé', () => {
    const carte = graphe();
    ecrire(
      carte,
      'nodes/le-refuge-oublie.json',
      noeud('le-refuge-oublie', NOEUDS_MODERNES, MODERNE, 'avarosa-reach', {
        entryPoint: false,
        pistes: 3,
      }),
    );
    const cites = parRegle(refuse(compter(carte)), GRAPH_RULES.orphan);
    expect(cites).toHaveLength(1);
    const message = cites[0]?.message ?? '';
    expect(message).toContain('le nœud « le-refuge-oublie »');
    expect(message).toContain('aucune piste vivante ne mène à lui');
    expect(message).toContain('Ajoutez une piste depuis un nœud atteignable');
    expect(message).toContain('"entryPoint": true');
    expect(cites[0]?.file).toBe('nodes/le-refuge-oublie.json');

    // L'autre sens, et il porte la vraie garantie : le MÊME nœud, déclaré
    // point d'entrée, passe. Sans cette ligne la règle 2 serait insatisfiable.
    modifier(carte, 'nodes/le-refuge-oublie.json', (document) => {
      document['entryPoint'] = true;
    });
    const bundle = validateContent(carte, { root: 'content-fixtures' });
    expect(bundle.nodes.get('le-refuge-oublie')?.entryPoint).toBe(true);
  });

  it('quatre nœuds reliés entre eux et à rien d’autre forment un îlot, nommé en entier', () => {
    // LA LETTRE DE LA FICHE NE SUFFIT PAS : chacun de ces quatre nœuds est visé
    // par trois pistes, donc « atteignable depuis au moins un autre » est vrai
    // pour les quatre. Ils sont pourtant injouables. C'est ce que cette mesure
    // garde, et c'est pour ça que la passe marche depuis les points d'entrée.
    const cites = parRegle(
      refuse(
        modifier(graphe(), `nodes/${NOEUDS_ANCIENS[0]}.json`, (document) => {
          document['entryPoint'] = false;
        }),
      ),
      GRAPH_RULES.orphan,
    );
    expect(cites).toHaveLength(1);
    const message = cites[0]?.message ?? '';
    expect(message).toContain('le nœud « la-porte-emmuree »');
    // Les quatre membres, par ordre d'identifiant, et le compte.
    expect(message).toContain(
      '« la-salle-des-veilleurs », « le-chant-sous-la-glace », « le-puits-de-glace »',
    );
    expect(message).toContain('un îlot de 4 nœuds');
    expect(message).toContain('Ajoutez une piste depuis un nœud atteignable');
  });

  it('deux îlots donnent deux refus, chacun avec ses propres membres', () => {
    // Section 5 bis de la recette : DEUX ACTEURS AU LIEU D'UN. Avec un seul
    // îlot, le tri des groupes n'est jamais appelé et un rapport qui mélangerait
    // les membres des deux îlots passerait inaperçu. Ici les deux tableaux sont
    // assertés en entier.
    const CAIRNS = ['le-cairn-brise', 'le-cairn-du-nord', 'le-cairn-fendu', 'le-cairn-noir'];
    const carte = graphe();
    modifier(carte, `nodes/${NOEUDS_ANCIENS[0]}.json`, (document) => {
      document['entryPoint'] = false;
    });
    for (const id of CAIRNS) {
      ecrire(
        carte,
        `nodes/${id}.json`,
        noeud(id, CAIRNS, MODERNE, 'avarosa-reach', { entryPoint: false, pistes: 3 }),
      );
    }
    const cites = parRegle(refuse(compter(carte)), GRAPH_RULES.orphan);
    expect(cites.map((probleme) => probleme.file)).toStrictEqual([
      'nodes/la-porte-emmuree.json',
      'nodes/le-cairn-brise.json',
    ]);
    // Chaque message ne nomme QUE les siens : un cairn n'apparaît pas dans
    // l'îlot ancien, et réciproquement.
    expect(cites[0]?.message).toContain(
      '« la-salle-des-veilleurs », « le-chant-sous-la-glace », « le-puits-de-glace »',
    );
    expect(cites[0]?.message).not.toContain('cairn');
    expect(cites[1]?.message).toContain(
      '« le-cairn-du-nord », « le-cairn-fendu », « le-cairn-noir »',
    );
    expect(cites[1]?.message).not.toContain('glace');
  });

  it('des nœuds sans le moindre point d’entrée sont refusés une seule fois, et nommés', () => {
    const carte = graphe();
    for (const id of [NOEUDS_MODERNES[0], NOEUDS_ANCIENS[0]]) {
      modifier(carte, `nodes/${id}.json`, (document) => {
        document['entryPoint'] = false;
      });
    }
    const cites = parRegle(refuse(carte), GRAPH_RULES.orphan);
    expect(cites).toHaveLength(1);
    const message = cites[0]?.message ?? '';
    expect(message).toContain("9 nœud(s) chargé(s) et aucun point d'entrée");
    expect(message).toContain('"entryPoint": true');
    expect(cites[0]?.file).toBe('nodes/');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('règle « pas de figure hors période » — la cinquième, celle que S-01 a laissée', () => {
  it('un nœud qui nomme une figure d’une autre période est refusé', () => {
    const cites = parRegle(
      refuse(
        modifier(graphe(), 'nodes/le-convoi-retourne.json', (document) => {
          document['figureIds'] = [FIGURE_ANCIENNE];
        }),
      ),
      GRAPH_RULES.figurePeriod,
    );
    expect(cites).toHaveLength(1);
    const message = cites[0]?.message ?? '';
    expect(message).toContain('le nœud « le-convoi-retourne »');
    expect(message).toContain(`« ${MODERNE} »`);
    expect(message).toContain(`« ${FIGURE_ANCIENNE} »`);
    expect(message).toContain(`« ${ANCIEN} »`);
    expect(message).toContain('Retirez-la de « figureIds »');
    expect(cites[0]?.path).toBe('figureIds[0]');

    // L'autre sens : la figure de la BONNE période passe.
    const bundle = validateContent(
      modifier(graphe(), 'nodes/le-convoi-retourne.json', (document) => {
        document['figureIds'] = [FIGURE_MODERNE];
      }),
      { root: 'content-fixtures' },
    );
    expect(bundle.nodes.get('le-convoi-retourne')?.figureIds).toStrictEqual([FIGURE_MODERNE]);
  });

  it('un ressort qui propose un lien avec une figure d’une autre période est refusé', () => {
    const cites = parRegle(
      refuse(
        modifier(graphe(), 'hooks/on-vous-doit-un-hiver.json', (document) => {
          document['suggestedBondIds'] = [FIGURE_ANCIENNE];
        }),
      ),
      GRAPH_RULES.figurePeriod,
    );
    expect(cites).toHaveLength(1);
    const message = cites[0]?.message ?? '';
    expect(message).toContain('le ressort « on-vous-doit-un-hiver »');
    expect(message).toContain('propose un lien avec');
    expect(message).toContain('Retirez-la de « suggestedBondIds »');
    expect(cites[0]?.file).toBe('hooks/on-vous-doit-un-hiver.json');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('l’ordre des passes n’est pas une convention', () => {
  it('une piste vers un nœud inexistant tombe en passe 3, jamais en passe 5', () => {
    const problemes = refuse(
      modifier(graphe(), 'nodes/le-grenier-vide.json', (document) => {
        pistes(document)[0] = { toNodeId: 'le-noeud-qui-nexiste-pas', trigger: 'On y va.' };
      }),
    );
    expect(texte(problemes)).toContain('nœud "le-noeud-qui-nexiste-pas" introuvable');
    expect(problemes.filter((probleme) => probleme.pass === 5)).toStrictEqual([]);
  });

  it('une figure inexistante tombe en passe 3, jamais en passe 5', () => {
    const problemes = refuse(
      modifier(graphe(), 'nodes/le-convoi-retourne.json', (document) => {
        document['figureIds'] = ['la-figure-qui-nexiste-pas'];
      }),
    );
    expect(texte(problemes)).toContain('figure "la-figure-qui-nexiste-pas" introuvable');
    expect(problemes.filter((probleme) => probleme.pass === 5)).toStrictEqual([]);
  });

  it('un nœud mal formé arrête tout AVANT la passe 5', () => {
    // C'est le `throw` qui suit la passe 3 qui tient l'ordre, et rien d'autre.
    // Mesuré : le retirer laisse la passe 5 marcher sur un bundle à moitié
    // chargé. Ce nœud porte DEUX fautes — une de forme (passe 2) et une de
    // graphe (passe 5) — et le rapport ne doit contenir que la première.
    const problemes = refuse(
      modifier(graphe(), `nodes/${NOEUDS_ANCIENS[0]}.json`, (document) => {
        document['kind'] = 'chateau';
        document['entryPoint'] = false;
      }),
    );
    expect(problemes).not.toStrictEqual([]);
    expect([...new Set(problemes.map((probleme) => probleme.pass))]).toStrictEqual([2]);
    expect(problemes[0]?.file).toBe(`nodes/${NOEUDS_ANCIENS[0]}.json`);
  });

  it('le rapport verbeux sait dire « passe 5 »', () => {
    const problemes = refuse(
      modifier(graphe(), `nodes/${NOEUDS_ANCIENS[0]}.json`, (document) => {
        document['entryPoint'] = false;
      }),
    );
    expect(new ContentError(problemes, 'content-fixtures').format(true)).toContain('passe 5');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// La passe appelée seule, pour ce que le chargeur ne peut pas lui présenter.
describe('la passe de graphe, appelée directement', () => {
  const noeudsDe = (documents: readonly unknown[]): Map<string, NodeContent> =>
    new Map(
      documents.map((document) => {
        const analyse = NodeSchema.parse(document);
        return [analyse.id, analyse] as const;
      }),
    );

  it('un bundle sans aucun nœud ne produit rien', () => {
    // La sortie précoce : S-01 livre le vocabulaire, S-03 les pièces, et entre
    // les deux `content/` n'a pas un seul nœud. Si cette ligne tombe, le dépôt
    // ne se charge plus jusqu'à S-03.
    expect(
      validateScenarioGraph({ nodes: new Map(), figures: new Map(), hooks: new Map() }),
    ).toStrictEqual([]);
  });

  it('une figure absente de la carte ne dit rien : c’est la passe 3 qui la possède', () => {
    // Le chargeur ne peut pas fabriquer ce cas — la passe 3 jette avant. Seule
    // l'appel direct montre que la passe 5 SE TAIT au lieu de doubler le
    // message, et envoyer le lecteur au mauvais endroit.
    const nodes = noeudsDe(
      NOEUDS_MODERNES.map((id) => ({
        ...noeud(id, NOEUDS_MODERNES, MODERNE, 'avarosa-reach', {
          entryPoint: id === NOEUDS_MODERNES[0],
          pistes: id === NOEUDS_MODERNES[0] ? 4 : 3,
        }),
        figureIds: ['une-figure-que-personne-ne-connait'],
      })),
    );
    expect(validateScenarioGraph({ nodes, figures: new Map(), hooks: new Map() })).toStrictEqual(
      [],
    );

    // L'autre sens : la même carte, avec la figure PRÉSENTE et d'une autre
    // période, produit cinq refus.
    const figures = new Map([
      [
        'une-figure-que-personne-ne-connait',
        FigureSchema.parse(figure('une-figure-que-personne-ne-connait', 'avarosans', ANCIEN)),
      ],
    ]);
    expect(validateScenarioGraph({ nodes, figures, hooks: new Map() })).toHaveLength(
      NOEUDS_MODERNES.length,
    );
  });

  it('une piste vers un nœud absent de la carte ne dit rien non plus', () => {
    const nodes = noeudsDe([
      {
        ...noeud(NOEUDS_MODERNES[0], NOEUDS_MODERNES, MODERNE, 'avarosa-reach', {
          entryPoint: true,
          pistes: 4,
        }),
      },
    ]);
    // Les quatre pistes visent des nœuds que la carte n'a pas. La passe 5 ne
    // les compte pas, ne les refuse pas, et ne trouve donc aucun orphelin.
    expect(validateScenarioGraph({ nodes, figures: new Map(), hooks: new Map() })).toStrictEqual(
      [],
    );
  });

  it('les nœuds sont rapportés dans l’ordre de leurs identifiants, pas dans celui de la carte', () => {
    // Sonde 7 : la carte est construite à l'ENVERS. Le chargeur, lui, trie ses
    // fichiers avant de les parcourir, donc seul cet appel direct peut montrer
    // que le tri est bien celui de la passe et pas un effet de bord.
    const documents = [...NOEUDS_ANCIENS].reverse().map((id) => ({
      ...noeud(id, NOEUDS_ANCIENS, ANCIEN, 'freljord', { entryPoint: true, pistes: 3 }),
      figureIds: [FIGURE_ANCIENNE],
    }));
    const nodes = noeudsDe(documents);
    const figures = new Map([
      [FIGURE_ANCIENNE, FigureSchema.parse(figure(FIGURE_ANCIENNE, 'avarosans', MODERNE))],
    ]);
    expect(
      validateScenarioGraph({ nodes, figures, hooks: new Map() }).map((probleme) => probleme.file),
    ).toStrictEqual([
      'nodes/la-porte-emmuree.json',
      'nodes/la-salle-des-veilleurs.json',
      'nodes/le-chant-sous-la-glace.json',
      'nodes/le-puits-de-glace.json',
    ]);
  });

  it('un ressort sans figure connue ne dit rien', () => {
    const hooks = new Map([
      [
        'on-vous-doit-un-hiver',
        HookSchema.parse({
          schemaVersion: 1,
          id: 'on-vous-doit-un-hiver',
          name: 'On vous doit un hiver',
          appliesTo: { kind: 'trait', tag: 'montagnard' },
          pitch: 'Le hameau qui vous a nourris n’a rien reçu.',
          vowRank: 'dangereux',
          suggestedBondIds: ['personne'],
          periodId: MODERNE,
        }),
      ],
    ]);
    expect(validateScenarioGraph({ nodes: new Map(), figures: new Map(), hooks })).toStrictEqual(
      [],
    );
  });
});
