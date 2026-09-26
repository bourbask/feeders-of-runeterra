/**
 * A scenario corpus AT THE SCALE S-03 ANNOUNCES, built in memory.
 *
 * ── WHY A FIXTURE AND NOT `content/` ─────────────────────────────────────
 * S-03 delivers the pieces and IS NOT MERGED on this branch: `content/` has
 * no `periods/`, no `fronts/` and no `nodes/` at all. The acceptance criterion
 * « dix graines donnent au moins huit scénarios distincts SUR LE CONTENU DE
 * S-03 » is therefore false by construction here, and it is SIGNALLED in the
 * PR rather than worked around. What is measured instead is the same
 * criterion over a corpus with the counts S-03 promises — six periods, six
 * fronts, twenty modern nodes, twelve figures, ten ressorts, fifteen
 * rencontres — so the measurement transfers the day S-03 lands.
 *
 * ── AND WHY IT GOES THROUGH THE REAL LOADER ──────────────────────────────
 * `validateContent` + `createRegistry`, the same four passes `pnpm
 * content:check` runs. A hand-rolled `ContentRegistry` double would be a
 * double laxer than the interface — the exact trap section 5 bis of the
 * recipe names — and would let a piece that the loader refuses feed a green
 * test. Here every fixture document is parsed by the shipped schemas.
 *
 * The corpus is S-02-clean on purpose: three distinct leads per node, no
 * orphan outside an `entryPoint`, no lead across periods, portents exactly
 * equal to segments. `crossPeriodLeadRegistry()` is the one deliberate
 * exception, and says so.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentRegistry } from '@for/content';
import { createRegistry, readContentFiles, validateContent } from '@for/content';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'content-fixtures');

export const MODERN = 'freljord-moderne';
export const LONG_NIGHT = 'la-longue-nuit';
export const ANCIENT = 'avant-les-soeurs';

export const AVAROSANS = 'avarosans';
export const WINTERS_CLAW = 'griffe-d-hiver';
export const FROSTGUARD = 'gardiens-du-givre';

/** The four regions the modern period plays in. Two come from the fixtures. */
export const MODERN_REGIONS = [
  'avarosa-reach',
  'rakelstake',
  'howling-abyss',
  'frostguard-citadel',
] as const;

type Doc = Record<string, unknown>;

/**
 * Indexation sûre, en boucle sur la longueur.
 *
 * `noUncheckedIndexedAccess` rend `list[i]` optionnel, et les deux règles de
 * lint qui encadrent l'assertion se contredisent sur ce cas précis :
 * `non-nullable-type-assertion-style` demande un `!`, `no-non-null-assertion`
 * l'interdit. Une fonction lève la contradiction sans mentir sur le type.
 */
const pick = <T>(list: readonly T[], index: number): T => {
  const value = list[index % list.length];
  if (value === undefined) throw new Error('corpus : liste vide');
  return value;
};

const region = (id: string, name: string, kind: string, factions: readonly Doc[]): Doc => ({
  schemaVersion: 1,
  id,
  name,
  parentId: 'freljord',
  kind,
  summary: `${name} : on y arrive par le froid, on en repart rarement seul.`,
  description: `${name}. Des murs bas, des feux courts, et des gens qui comptent ce qui reste avant de parler.`,
  dangerRank: 'dangereux',
  climate: 'Vent continu, gel de fond, neige sèche.',
  factions,
  landmarks: [`La porte basse de ${name}`],
  hooks: [`Quelqu’un de ${name} n’est pas rentré.`],
  oracleRefs: [],
  neighborIds: ['freljord'],
  tags: [],
});

/** Six tranches de frise, ordonnées par `after`. */
const PERIODS: readonly Doc[] = [
  {
    schemaVersion: 1,
    id: ANCIENT,
    name: 'Avant les Sœurs',
    summary: 'Les demi-dieux du nord règnent encore, et personne ne leur dit non.',
    after: null,
    before: 100,
    factionIds: [],
    absentFactionIds: [AVAROSANS, WINTERS_CLAW, FROSTGUARD],
    tags: [],
  },
  {
    schemaVersion: 1,
    id: 'le-pacte',
    name: 'Le pacte',
    summary: 'Une sœur traite dans le dos des deux autres, et la glace écoute.',
    after: 100,
    before: 200,
    factionIds: [],
    absentFactionIds: [AVAROSANS, WINTERS_CLAW, FROSTGUARD],
    tags: [],
  },
  {
    schemaVersion: 1,
    id: 'union-des-trois-soeurs',
    name: 'L’union des Trois Sœurs',
    summary: 'Les clans tiennent ensemble le temps d’abattre ce qui les dépasse.',
    after: 200,
    before: 300,
    factionIds: [],
    absentFactionIds: [AVAROSANS, WINTERS_CLAW, FROSTGUARD],
    tags: [],
  },
  {
    schemaVersion: 1,
    id: 'guerre-des-trois-soeurs',
    name: 'La Guerre des Trois Sœurs',
    summary: 'La rupture, la Vraie Glace, et un rituel qu’on ne raconte plus.',
    after: 300,
    before: 400,
    factionIds: [],
    absentFactionIds: [AVAROSANS, WINTERS_CLAW, FROSTGUARD],
    tags: [],
  },
  {
    schemaVersion: 1,
    id: LONG_NIGHT,
    name: 'La Longue Nuit',
    summary: 'Le monde refroidit, et ce qui a été emmuré gratte encore.',
    after: 400,
    before: 500,
    factionIds: [FROSTGUARD],
    absentFactionIds: [AVAROSANS, WINTERS_CLAW],
    tags: [],
  },
  {
    schemaVersion: 1,
    id: MODERN,
    name: 'Le Freljord moderne',
    // Volontairement long : c'est ce document qui fait passer les libellés de
    // candidat par la troncature à 120 signes.
    summary:
      'Trois prétendantes, trois manières de vouloir la même vallée : par le grain, par la ' +
      'hache, par le silence — et personne ne cède avant le dégel, qui ne viendra pas.',
    after: 500,
    before: null,
    factionIds: [AVAROSANS, WINTERS_CLAW, FROSTGUARD],
    absentFactionIds: [],
    tags: [],
  },
];

const front = (
  id: string,
  name: string,
  stake: string,
  segments: number,
  periodId: string,
  regionIds: readonly string[],
): Doc => ({
  schemaVersion: 1,
  id,
  name,
  stake,
  segments,
  portents: Array.from(
    { length: segments },
    (_unused, index) => `Étape ${String(index + 1)} de « ${name} » : ce qui cède cette fois-là.`,
  ),
  periodId,
  regionIds,
  tags: [],
});

/** Six fronts, dont trois modernes qui se gênent : trois enjeux distincts. */
const FRONTS: readonly Doc[] = [
  front(
    'la-famine-remonte-le-fleuve',
    'La famine remonte le fleuve',
    'Les greniers de la Marche, et les clans qui en dépendent.',
    4,
    MODERN,
    ['avarosa-reach', 'rakelstake'],
  ),
  front(
    'la-griffe-descend-des-cols',
    'La Griffe descend des cols',
    'Le droit de passage des vallées basses, et qui le prélève.',
    6,
    MODERN,
    ['rakelstake', 'avarosa-reach'],
  ),
  front(
    'le-givre-rouvre-l-abime',
    'Le Givre rouvre l’Abîme',
    'Ce qui dort sous la faille, et la parole donnée de l’y laisser.',
    8,
    MODERN,
    ['howling-abyss', 'frostguard-citadel'],
  ),
  front(
    'la-nuit-ne-finit-pas',
    'La nuit ne finit pas',
    'Le dernier feu tenu au nord, et les gens autour.',
    10,
    LONG_NIGHT,
    ['frostguard-citadel', 'howling-abyss'],
  ),
  front(
    'la-vraie-glace-se-partage',
    'La Vraie Glace se partage',
    'Le serment des trois, et ce qu’il reste d’une famille.',
    4,
    'guerre-des-trois-soeurs',
    ['freljord'],
  ),
  front(
    'les-anciens-dieux-reclament',
    'Les anciens dieux réclament',
    'Le tribut des vallées, payé en vivants.',
    6,
    ANCIENT,
    ['freljord'],
  ),
];

const NODE_NAMES: readonly string[] = [
  'le-grenier-ouvert-de-l-interieur',
  'le-convoi-retourne',
  'le-conseil-des-clans',
  'la-taverne-du-pont-bas',
  'le-col-sans-guetteur',
  'la-halle-des-serments',
  'le-marche-de-glace',
  'la-fosse-aux-betes',
  'le-campement-brule',
  'la-passe-des-corbeaux',
  'le-puits-noir',
  'la-chapelle-de-gel',
  'les-pierres-dressees',
  'le-pont-de-corde',
  'la-cave-aux-sacs',
  'le-rempart-fendu',
  'la-veille-du-gue',
  'le-sentier-des-loups',
  'la-tour-basse',
  'le-dernier-feu',
];

const ANCIENT_NODE_NAMES: readonly string[] = [
  'la-caverne-qui-respire',
  'le-cercle-de-souches',
  'la-gueule-blanche',
  'le-tertre-fendu',
];

const LONG_NIGHT_NODE_NAMES: readonly string[] = [
  'le-mur-de-glace-vive',
  'la-salle-des-veilleurs',
  'le-couloir-sans-echo',
  'la-derniere-lampe',
];

/** Douze figures : six modernes réparties sur trois factions, six anciennes. */
const DISPOSITIONS = ['allie', 'neutre', 'hostile', 'inconnu'] as const;

const figure = (
  id: string,
  name: string,
  periodId: string,
  factionId: string | null,
  index: number,
): Doc => ({
  schemaVersion: 1,
  id,
  name,
  wants: `${name} veut que la vallée lui doive quelque chose avant le dégel.`,
  refuses: `${name} refuse de prendre à qui n’a plus rien, même pour gagner.`,
  knows: `${name} sait qui a ouvert la porte, et pourquoi on ne le dit pas.`,
  disposition: DISPOSITIONS[index % DISPOSITIONS.length],
  factionId,
  periodId,
  tags: [],
});

const MODERN_FIGURES: readonly Doc[] = [
  figure('la-gardienne-du-grain', 'La gardienne du grain', MODERN, AVAROSANS, 0),
  figure('le-comptable-des-sacs', 'Le comptable des sacs', MODERN, AVAROSANS, 1),
  figure('la-meneuse-des-cols', 'La meneuse des cols', MODERN, WINTERS_CLAW, 2),
  figure('le-porteur-de-hache', 'Le porteur de hache', MODERN, WINTERS_CLAW, 3),
  figure('la-veilleuse-du-givre', 'La veilleuse du givre', MODERN, FROSTGUARD, 0),
  figure('le-scribe-sans-nom', 'Le scribe sans nom', MODERN, null, 1),
];

const OTHER_FIGURES: readonly Doc[] = [
  figure('la-premiere-emmuree', 'La première emmurée', LONG_NIGHT, FROSTGUARD, 2),
  figure('le-porte-flamme', 'Le porte-flamme', LONG_NIGHT, null, 3),
  figure('la-soeur-cadette', 'La sœur cadette', 'guerre-des-trois-soeurs', null, 0),
  figure('le-forgeur-de-glace', 'Le forgeur de glace', 'guerre-des-trois-soeurs', null, 1),
  figure('la-voix-des-souches', 'La voix des souches', ANCIENT, null, 2),
  figure('le-mangeur-de-tribut', 'Le mangeur de tribut', ANCIENT, null, 3),
];

const MODERN_FIGURE_IDS = MODERN_FIGURES.map((doc) => doc['id'] as string);

const modernNode = (index: number): Doc => {
  const id = pick(NODE_NAMES, index);
  const regionId = pick(MODERN_REGIONS, index);
  const destinations = [1, 7, 13].map((offset) => NODE_NAMES[(index + offset) % NODE_NAMES.length]);
  return {
    schemaVersion: 1,
    id,
    name: `Nœud ${String(index + 1)} — ${id.replaceAll('-', ' ')}`,
    kind: (['lieu', 'confrontation', 'rencontre', 'revelation'] as const)[index % 4],
    situation: 'Un endroit où quelque chose est déjà arrivé, et où personne ne le dit le premier.',
    stakeQuestion: `Qui a décidé, à « ${id} », et qui a payé pour ?`,
    figureIds: [pick(MODERN_FIGURE_IDS, index), pick(MODERN_FIGURE_IDS, index + 2)],
    regionId,
    periodId: MODERN,
    // Deux points d'entrée par région : l'étape « nœud » a un vrai choix.
    entryPoint: index < MODERN_REGIONS.length * 2,
    leads: destinations.map((toNodeId) => ({
      toNodeId,
      trigger: `On part vers « ${String(toNodeId)} » parce que c’est là qu’on a vu passer quelqu’un.`,
    })),
    tags: [],
  };
};

const ancientNode = (index: number): Doc => {
  const id = pick(ANCIENT_NODE_NAMES, index);
  const destinations = [1, 2, 3].map(
    (offset) => ANCIENT_NODE_NAMES[(index + offset) % ANCIENT_NODE_NAMES.length],
  );
  return {
    schemaVersion: 1,
    id,
    name: `Nœud ancien — ${id.replaceAll('-', ' ')}`,
    kind: 'lieu',
    situation: 'Avant les Sœurs, un lieu que personne n’a encore appris à nommer.',
    stakeQuestion: `Qu’est-ce qui dort à « ${id} » ?`,
    figureIds: ['la-voix-des-souches'],
    regionId: 'freljord',
    periodId: ANCIENT,
    entryPoint: index === 0,
    leads: destinations.map((toNodeId) => ({
      toNodeId,
      trigger: `On suit la trace jusqu’à « ${String(toNodeId)} ».`,
    })),
    tags: [],
  };
};

const longNightNode = (index: number): Doc => {
  const id = pick(LONG_NIGHT_NODE_NAMES, index);
  const destinations = [1, 2, 3].map(
    (offset) => LONG_NIGHT_NODE_NAMES[(index + offset) % LONG_NIGHT_NODE_NAMES.length],
  );
  return {
    schemaVersion: 1,
    id,
    name: `Nœud de la Longue Nuit — ${id.replaceAll('-', ' ')}`,
    kind: 'lieu',
    situation: 'Le froid est entré par une porte que personne n’avoue avoir ouverte.',
    stakeQuestion: `Qui veille encore à « ${id} » ?`,
    figureIds: ['la-premiere-emmuree', 'le-porte-flamme'],
    regionId: 'frostguard-citadel',
    periodId: LONG_NIGHT,
    entryPoint: index < 2,
    leads: destinations.map((toNodeId) => ({
      toNodeId,
      trigger: `On suit le courant d’air jusqu’à « ${String(toNodeId)} ».`,
    })),
    tags: [],
  };
};

const RANKS = ['genant', 'dangereux', 'redoutable', 'extreme', 'epique'] as const;

const hook = (
  id: string,
  name: string,
  appliesTo: Doc,
  periodId: string,
  bondIds: readonly string[],
  index: number,
): Doc => ({
  schemaVersion: 1,
  id,
  name,
  appliesTo,
  pitch: `${name} : ce qu’on vous doit, et ce que vous n’avez pas encore demandé.`,
  vowRank: RANKS[index % RANKS.length],
  suggestedBondIds: bondIds,
  periodId,
  tags: [],
});

const HOOKS: readonly Doc[] = [
  hook(
    'on-vous-doit-un-hiver',
    'On vous doit un hiver',
    { kind: 'champion', championId: 'braum' },
    MODERN,
    ['la-gardienne-du-grain'],
    0,
  ),
  hook(
    'la-fleche-et-le-grain',
    'La flèche et le grain',
    { kind: 'champion', championId: 'ashe' },
    MODERN,
    ['le-comptable-des-sacs'],
    1,
  ),
  hook(
    'celui-qui-tient-la-porte',
    'Celui qui tient la porte',
    { kind: 'trait', tag: 'defense' },
    MODERN,
    ['la-veilleuse-du-givre'],
    2,
  ),
  hook(
    'celle-qui-parle-en-premier',
    'Celle qui parle en premier',
    { kind: 'trait', tag: 'commandement' },
    MODERN,
    ['la-meneuse-des-cols'],
    3,
  ),
  hook(
    'le-grain-des-avarosans',
    'Le grain des Avarosans',
    { kind: 'faction', factionId: AVAROSANS },
    MODERN,
    ['le-comptable-des-sacs'],
    4,
  ),
  hook(
    'la-marche-vous-connait',
    'La Marche vous connaît',
    { kind: 'region', regionId: 'avarosa-reach' },
    MODERN,
    ['la-gardienne-du-grain', 'le-scribe-sans-nom'],
    0,
  ),
  hook(
    'le-feu-qu-on-vous-a-confie',
    'Le feu qu’on vous a confié',
    { kind: 'region', regionId: 'frostguard-citadel' },
    LONG_NIGHT,
    ['le-porte-flamme'],
    1,
  ),
  hook(
    'la-dette-des-emmures',
    'La dette des emmurés',
    { kind: 'faction', factionId: FROSTGUARD },
    LONG_NIGHT,
    ['la-premiere-emmuree'],
    2,
  ),
  hook(
    'le-serment-des-trois',
    'Le serment des trois',
    { kind: 'region', regionId: 'freljord' },
    'guerre-des-trois-soeurs',
    ['la-soeur-cadette'],
    3,
  ),
  hook(
    'le-tribut-qu-on-ne-paie-plus',
    'Le tribut qu’on ne paie plus',
    { kind: 'region', regionId: 'freljord' },
    ANCIENT,
    ['la-voix-des-souches'],
    4,
  ),
];

const ENCOUNTER_KINDS = ['marchand', 'allie', 'bete', 'trouvaille', 'obstacle'] as const;

const ENCOUNTERS: readonly Doc[] = Array.from({ length: 15 }, (_unused, index) => ({
  schemaVersion: 1,
  id: `rencontre-${String(index + 1).padStart(2, '0')}`,
  name: `Rencontre ${String(index + 1)}`,
  kind: ENCOUNTER_KINDS[index % ENCOUNTER_KINDS.length],
  summary: 'Quelqu’un ou quelque chose sur la route, et pas au moment prévu.',
  periodId: index % 3 === 0 ? LONG_NIGHT : MODERN,
  regionKinds: ['etablissement', 'site'],
  oracleRef: 'complication',
  tags: [],
}));

const write = (files: Map<string, string>, path: string, doc: unknown): void => {
  files.set(path, JSON.stringify(doc, null, 2));
};

/** The fixture bundle, plus the scenario corpus, plus the announced counts. */
export function corpusFiles(): Map<string, string> {
  const files = new Map(readContentFiles(FIXTURES));

  write(
    files,
    'regions/rakelstake.json',
    region('rakelstake', 'Rakelstake', 'etablissement', [
      { id: WINTERS_CLAW, name: 'Griffe d’Hiver', stance: 'Prennent ce que l’hiver ne prend pas.' },
    ]),
  );
  write(
    files,
    'regions/howling-abyss.json',
    region('howling-abyss', 'L’Abîme Hurlant', 'site', []),
  );
  write(
    files,
    'regions/frostguard-citadel.json',
    region('frostguard-citadel', 'La Citadelle du Givre', 'etablissement', []),
  );

  for (const doc of PERIODS) write(files, `periods/${String(doc['id'])}.json`, doc);
  for (const doc of FRONTS) write(files, `fronts/${String(doc['id'])}.json`, doc);
  for (const doc of [...MODERN_FIGURES, ...OTHER_FIGURES]) {
    write(files, `figures/${String(doc['id'])}.json`, doc);
  }
  for (const doc of HOOKS) write(files, `hooks/${String(doc['id'])}.json`, doc);
  for (const doc of ENCOUNTERS) write(files, `encounters/${String(doc['id'])}.json`, doc);
  for (let index = 0; index < NODE_NAMES.length; index += 1) {
    const doc = modernNode(index);
    write(files, `nodes/${String(doc['id'])}.json`, doc);
  }
  for (let index = 0; index < ANCIENT_NODE_NAMES.length; index += 1) {
    const doc = ancientNode(index);
    write(files, `nodes/${String(doc['id'])}.json`, doc);
  }
  for (let index = 0; index < LONG_NIGHT_NODE_NAMES.length; index += 1) {
    const doc = longNightNode(index);
    write(files, `nodes/${String(doc['id'])}.json`, doc);
  }

  const manifest = JSON.parse(files.get('manifest.json') ?? '{}') as {
    expectedCounts: Record<string, number>;
  };
  manifest.expectedCounts = {
    ...manifest.expectedCounts,
    regions: 5,
    periods: PERIODS.length,
    fronts: FRONTS.length,
    nodes: NODE_NAMES.length + ANCIENT_NODE_NAMES.length + LONG_NIGHT_NODE_NAMES.length,
    figures: MODERN_FIGURES.length + OTHER_FIGURES.length,
    hooks: HOOKS.length,
    encounters: ENCOUNTERS.length,
  };
  write(files, 'manifest.json', manifest);
  return files;
}

export function corpusRegistry(): ContentRegistry {
  return createRegistry(validateContent(corpusFiles(), { root: 'content-fixtures' }));
}

/**
 * The same corpus with ONE lead crossing a period boundary.
 *
 * Deliberate, and the only piece of the fixture that is not S-02-clean: it is
 * what proves the period filter of the `piste` step is not inert. If a future
 * `validateContent` refuses this bundle, that means S-02's rule 3 has landed
 * and now refuses the same thing one pass earlier — the filter becomes
 * redundant, and this helper can go.
 */
export function crossPeriodLeadRegistry(): ContentRegistry {
  const files = corpusFiles();
  const entry = pick(NODE_NAMES, 0);
  const document = JSON.parse(files.get(`nodes/${entry}.json`) ?? '{}') as {
    leads: { toNodeId: string; trigger: string }[];
  };
  document.leads = [
    { toNodeId: pick(ANCIENT_NODE_NAMES, 0), trigger: 'On descend sous la glace, bien plus tôt.' },
    ...document.leads.slice(1),
  ];
  write(files, `nodes/${entry}.json`, document);
  return createRegistry(validateContent(files, { root: 'content-fixtures' }));
}

/** Périodes que le contenu rend jouables : un front, une figure, un point d'entrée. */
export const PLAYABLE_PERIODS = [ANCIENT, LONG_NIGHT, MODERN] as const;

/**
 * Le corpus, plus UNE figure qui se contredit : elle se déclare de la Longue
 * Nuit, période qui déclare les Avarosans absents, et se dit avarosane.
 *
 * Elle existe parce que sans elle le filtre de faction absente ne gardait
 * RIEN : la boucle qui le vérifiait ne trouvait aucune figure à écarter et
 * passait à vide. Mesuré — retirer le filtre laissait 84 tests verts. S-03
 * refusera ce document par son propre test de cohérence ; ici il sert à
 * prouver que le filtre mord.
 */
export function contradictoryFigureRegistry(): ContentRegistry {
  const files = corpusFiles();
  write(files, 'figures/la-transfuge-impossible.json', {
    ...figure('la-transfuge-impossible', 'La transfuge impossible', LONG_NIGHT, AVAROSANS, 0),
  });
  const manifest = JSON.parse(files.get('manifest.json') ?? '{}') as {
    expectedCounts: Record<string, number>;
  };
  manifest.expectedCounts = {
    ...manifest.expectedCounts,
    figures: (manifest.expectedCounts['figures'] ?? 0) + 1,
  };
  write(files, 'manifest.json', manifest);
  return createRegistry(validateContent(files, { root: 'content-fixtures' }));
}

export const CONTRADICTORY_FIGURE_ID = 'la-transfuge-impossible';

export const ENTRY_NODE_ID = pick(NODE_NAMES, 0);
export const ANCIENT_ENTRY_NODE_ID = pick(ANCIENT_NODE_NAMES, 0);
export const MODERN_NODE_COUNT = NODE_NAMES.length;
