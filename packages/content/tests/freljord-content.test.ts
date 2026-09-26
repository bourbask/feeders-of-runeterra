/**
 * Les six familles de scénario TELLES QU'ELLES SONT LIVRÉES (S-03, ADR 0012).
 *
 * `scenario-vocabulary.test.ts` (S-01) prouve que le chargeur connaît les six
 * familles, sur des documents fabriqués en mémoire. Ce fichier-ci prouve tout
 * autre chose : que le contenu **posé sur le disque** tient les promesses de la
 * fiche S-03. Il lit `content/`, jamais une fixture.
 *
 * ── D'OÙ VIENT CHAQUE CHIFFRE (ADR 0007) ─────────────────────────────────
 * Tous les seuils ci-dessous viennent d'un CRITÈRE D'ACCEPTATION, donc ils
 * s'écrivent en toutes lettres, jamais lus depuis le schéma qu'ils vérifient.
 * `MIN_LEADS_PER_NODE` existe dans `@for/contracts` et n'est PAS importé ici :
 * S-01 l'exporte pour le code, pas pour les assertions, et un `3` comparé à
 * lui-même passerait sur un schéma qui n'exigerait plus rien.
 *
 * Les seuls chiffres qui ne sont pas écrits ici sont ceux qui appartiennent à
 * un TUPLE : les cinq genres de rencontre viennent de `ENCOUNTER_KINDS`, et le
 * nombre de fiches manuscrites est compté sur `content/champions/`.
 *
 * ── CHAQUE GARDE-FOU EST VIOLÉ, DANS LES DEUX SENS ───────────────────────
 * La suite « chaque garde-fou rougit sur la faute qu'il annonce » réécrit un
 * document dans une COPIE du bundle et exige le message exact. Le vert d'à
 * côté, sur le bundle intact, est l'autre moitié de la mesure.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENCOUNTER_KINDS } from '@for/contracts';

import { readContentFiles } from '../src/load.js';
import { KNOWN_DIRECTORIES } from '../src/validate.js';

import { foldApostrophes, normaliseChampionName } from './champion-names.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', 'content');

// ─────────────────────────────────────────────────────────────────────────
// Les chiffres de la fiche S-03, en toutes lettres
// ─────────────────────────────────────────────────────────────────────────

const MIN_PERIODS = 6;
const MIN_FRONTS = 6;
const MIN_MODERN_FRONTS = 3;
const MIN_NODES = 20;
const MIN_FIGURES = 12;
const MIN_HOOKS = 10;
const MIN_ENCOUNTERS = 15;

/** « Six familles neuves » — ADR 0012, décision 2. */
const SCENARIO_FAMILY_COUNT = 6;

/** « un nœud porte au moins TROIS pistes sortantes » — et vers trois nœuds différents. */
const MIN_DISTINCT_LEADS = 3;

/** « un test part de chaque entryPoint et vérifie qu'il atteint au moins DOUZE nœuds distincts ». */
const MIN_REACHED_FROM_ENTRY = 12;

/** « dix ressorts, dont au moins TROIS accrochés aux fiches livrées ». */
const MIN_HOOKS_ON_SHEETS = 3;

/** La période sur laquelle la fiche demande les vingt nœuds et les trois fronts qui se gênent. */
const MODERN_PERIOD = 'freljord-moderne';

/** Le mot-clé qui déclare un front « en concurrence sur le même territoire ». */
const CONTESTED_TAG = 'territoire-conteste';

/**
 * Les six répertoires de l'ADR 0012, dans l'ordre de la décision 2.
 *
 * CETTE LISTE EST SA PROPRE SOURCE DE BOUCLE : la vider ferait passer sans
 * rien vérifier la marche de prose, le compte du manifeste et la répartition
 * des rencontres. Deux assertions la tiennent, dans « connaît les six
 * répertoires de l'ADR 0012 » : sa longueur, écrite en toutes lettres, et le
 * fait que le chargeur les connaisse tous les six (`KNOWN_DIRECTORIES`, un
 * autre propriétaire, un autre fichier).
 */
const SCENARIO_DIRECTORIES = [
  'periods',
  'fronts',
  'nodes',
  'figures',
  'hooks',
  'encounters',
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Plomberie JSON brute
// ─────────────────────────────────────────────────────────────────────────

type Files = ReadonlyMap<string, string>;

const disk = (): Map<string, string> => new Map(readContentFiles(ROOT));

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const slugs = (value: unknown): readonly string[] =>
  list(value)
    .map((item) => text(item))
    .filter((item): item is string => item !== undefined);

const filesUnder = (files: Files, directory: string): readonly string[] =>
  [...files.keys()].filter((file) => file.startsWith(`${directory}/`)).sort();

/** Tous les documents d'un répertoire, `id` → document, dans l'ordre des noms de fichier. */
const documentsUnder = (files: Files, directory: string): Map<string, Record<string, unknown>> => {
  const found = new Map<string, Record<string, unknown>>();
  for (const file of filesUnder(files, directory)) {
    const document = record(JSON.parse(files.get(file) ?? 'null') as unknown);
    if (document === undefined) continue;
    found.set(text(document['id']) ?? file, document);
  }
  return found;
};

/** Réécrit un document dans une COPIE du bundle. Utilisé par les tests de violation. */
const edit = (
  files: Map<string, string>,
  file: string,
  mutate: (document: Record<string, unknown>) => void,
): Map<string, string> => {
  const document = JSON.parse(files.get(file) ?? '{}') as Record<string, unknown>;
  mutate(document);
  files.set(file, JSON.stringify(document, null, 2));
  return files;
};

// ─────────────────────────────────────────────────────────────────────────
// 1. La frise : six périodes qui s'enchaînent sans trou ni recouvrement
// ─────────────────────────────────────────────────────────────────────────

export function timelineProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const periods = [...documentsUnder(files, 'periods').values()];

  const bounded = periods.map((period) => ({
    id: text(period['id']) ?? '(sans id)',
    after: typeof period['after'] === 'number' ? period['after'] : null,
    before: typeof period['before'] === 'number' ? period['before'] : null,
  }));

  const opening = bounded.filter((period) => period.after === null);
  const closing = bounded.filter((period) => period.before === null);
  if (opening.length !== 1) {
    problems.push(
      `frise : ${String(opening.length)} période(s) sans borne « after » — il en faut exactement une, celle qui ouvre`,
    );
  }
  if (closing.length !== 1) {
    problems.push(
      `frise : ${String(closing.length)} période(s) sans borne « before » — il en faut exactement une, celle qui court jusqu'à maintenant`,
    );
  }

  const ordered = [...bounded].sort(
    (left, right) => (left.after ?? -Infinity) - (right.after ?? -Infinity),
  );
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    if (current === undefined || next === undefined) continue;
    if (current.before === next.after) continue;
    problems.push(
      `frise : « ${current.id} » se ferme à ${String(current.before)} et « ${next.id} » s'ouvre à ` +
        `${String(next.after)} — la frise a un trou ou un recouvrement entre les deux`,
    );
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Anachronisme : une faction déclarée absente n'apparaît nulle part
// ─────────────────────────────────────────────────────────────────────────

/**
 * Les clés dont la valeur est un IDENTIFIANT, pas de la prose.
 *
 * Écartées plutôt qu'énumérées à l'endroit : un champ de texte ajouté demain à
 * l'une des six familles est couvert par la marche sans que personne ait à
 * l'inscrire, ce qui est l'inverse d'une liste qui est sa propre source.
 */
const REFERENCE_KEYS = new Set([
  'id',
  'kind',
  'toNodeId',
  'regionId',
  'regionIds',
  'regionKinds',
  'periodId',
  'figureIds',
  'factionId',
  'factionIds',
  'absentFactionIds',
  'suggestedBondIds',
  'championId',
  'oracleRef',
  'disposition',
  'vowRank',
  'tag',
  'tags',
]);

/** Toutes les feuilles de texte d'un document, champs de référence exclus. */
function proseOf(value: unknown, key?: string): readonly string[] {
  if (key !== undefined && REFERENCE_KEYS.has(key)) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value))
    return (value as readonly unknown[]).flatMap((item) => proseOf(item, key));
  const object = record(value);
  if (object === undefined) return [];
  return Object.entries(object).flatMap(([child, nested]) => proseOf(nested, child));
}

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/**
 * Accents pliés, tirets réduits, ET apostrophes typographiques repliées.
 *
 * Le dernier repli n'est pas dans 02-mj-ia.md section 8.4 : mesuré, « d’Hiver »
 * et « d'Hiver » sont deux chaînes différentes pour elle. Voir
 * `champion-names.ts`, et la PR de S-03 qui le signale.
 */
const normalise = (value: string): string => normaliseChampionName(foldApostrophes(value));

/** Le mot entier, accents pliés, dans un texte lui aussi normalisé. */
const mentions = (haystack: string, needle: string): boolean => {
  if (needle === '') return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u').test(
    haystack,
  );
};

/** `factions[].id` → `factions[].name`, ramassé sur les régions : une faction n'a pas de fichier. */
function factionNames(files: Files): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const region of documentsUnder(files, 'regions').values()) {
    for (const faction of list(region['factions'])) {
      const entry = record(faction);
      const id = text(entry?.['id']);
      if (id === undefined) continue;
      names.set(id, text(entry?.['name']) ?? id);
    }
  }
  return names;
}

/**
 * Une faction déclarée absente d'une période n'apparaît dans AUCUNE pièce de
 * cette période — ni par référence, ni en toutes lettres dans un texte.
 *
 * LA PÉRIODE ELLE-MÊME EST EXCLUE DE LA MARCHE DE PROSE, et c'est délibéré :
 * c'est le document qui DÉCLARE l'absence, et « les Avarosans n'existent pas
 * encore » est exactement ce qu'un résumé de période a le droit d'écrire. Ses
 * références, elles, sont bien vérifiées — `factionIds` et `absentFactionIds`
 * ne peuvent pas nommer la même faction, et ça, c'est `PeriodSchema` qui le
 * refuse.
 *
 * LES RÉGIONS NE SONT PAS UNE SOURCE D'ANACHRONISME. Un `regions/*.json` ne
 * porte aucune période : les factions qu'il déclare sont celles d'aujourd'hui,
 * et en déduire qu'un nœud ancien placé là convoque une faction moderne
 * refuserait du contenu correct. Dit ici plutôt que découvert par le suivant.
 */
export function anachronismProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const names = factionNames(files);
  const periods = documentsUnder(files, 'periods');

  const pieces = SCENARIO_DIRECTORIES.filter((directory) => directory !== 'periods').flatMap(
    (directory) =>
      [...documentsUnder(files, directory).entries()].map(([id, document]) => ({
        directory,
        id,
        document,
      })),
  );

  for (const [periodId, period] of periods) {
    const absent = slugs(period['absentFactionIds']);
    if (absent.length === 0) continue;

    for (const piece of pieces) {
      if (piece.document['periodId'] !== periodId) continue;
      const appliesTo = record(piece.document['appliesTo']);
      const declared = new Set<string>(
        [
          text(piece.document['factionId']),
          appliesTo?.['kind'] === 'faction' ? text(appliesTo['factionId']) : undefined,
        ].filter((faction): faction is string => faction !== undefined),
      );
      const haystack = normalise(proseOf(piece.document).join(' \n '));

      for (const faction of absent) {
        if (declared.has(faction)) {
          problems.push(
            `${piece.directory}/${piece.id} : référence la faction « ${faction} », déclarée absente ` +
              `de la période « ${periodId} »`,
          );
          continue;
        }
        const spellings = [names.get(faction) ?? faction, faction.replaceAll('-', ' ')];
        for (const spelling of spellings) {
          if (!mentions(haystack, normalise(spelling))) continue;
          problems.push(
            `${piece.directory}/${piece.id} : écrit « ${spelling} » alors que la faction ` +
              `« ${faction} » est déclarée absente de la période « ${periodId} »`,
          );
          break;
        }
      }
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Les trois fronts modernes qui se gênent
// ─────────────────────────────────────────────────────────────────────────

const modernFronts = (files: Files): readonly Record<string, unknown>[] =>
  [...documentsUnder(files, 'fronts').values()].filter(
    (front) => front['periodId'] === MODERN_PERIOD,
  );

export function contestedFrontProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const contested = modernFronts(files).filter((front) =>
    slugs(front['tags']).includes(CONTESTED_TAG),
  );

  if (contested.length < MIN_MODERN_FRONTS) {
    problems.push(
      `fronts : ${String(contested.length)} front(s) modernes marqués « ${CONTESTED_TAG} » pour ` +
        `${String(MIN_MODERN_FRONTS)} exigés — la situation la plus riche de la frise n'est pas montée`,
    );
  }

  // Deux à deux, comme le demande le critère : trois `stake` distincts.
  for (let left = 0; left < contested.length; left += 1) {
    for (let right = left + 1; right < contested.length; right += 1) {
      const one = contested[left];
      const other = contested[right];
      if (one === undefined || other === undefined) continue;
      if (one['stake'] !== other['stake']) continue;
      problems.push(
        `fronts : « ${String(one['id'])} » et « ${String(other['id'])} » visent le même enjeu — ` +
          `deux fronts qui perdent la même chose ne se gênent pas, ils se répètent`,
      );
    }
  }

  // Se gêner, c'est vouloir le MÊME terrain : au moins une région commune aux trois.
  const shared = contested
    .map((front) => new Set(slugs(front['regionIds'])))
    .reduce<Set<string> | undefined>(
      (accumulator, current) =>
        accumulator === undefined
          ? current
          : new Set([...accumulator].filter((region) => current.has(region))),
      undefined,
    );
  if (contested.length >= MIN_MODERN_FRONTS && (shared === undefined || shared.size === 0)) {
    problems.push(
      `fronts : les fronts marqués « ${CONTESTED_TAG} » ne partagent aucune région — ` +
        `trois menaces sur trois terrains différents ne se gênent pas`,
    );
  }
  return problems;
}

/** Décision 4 de l'ADR 0012 : autant de présages que de segments. Prouvé sur le contenu livré. */
export function frontClockProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  for (const [id, front] of documentsUnder(files, 'fronts')) {
    const segments = front['segments'];
    const portents = list(front['portents']).length;
    if (segments === portents) continue;
    problems.push(
      `fronts/${id} : ${String(portents)} présage(s) pour ${String(segments)} segment(s)`,
    );
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Le graphe moderne : les quatre règles de S-02, prouvées sur le contenu
// ─────────────────────────────────────────────────────────────────────────

interface GraphNode {
  readonly id: string;
  readonly periodId: string;
  readonly entryPoint: boolean;
  readonly leads: readonly string[];
}

function graphOf(files: Files): readonly GraphNode[] {
  return [...documentsUnder(files, 'nodes').entries()].map(([id, node]) => ({
    id,
    periodId: text(node['periodId']) ?? '',
    entryPoint: node['entryPoint'] === true,
    leads: list(node['leads'])
      .map((lead) => text(record(lead)?.['toNodeId']))
      .filter((target): target is string => target !== undefined),
  }));
}

export function graphProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const nodes = graphOf(files);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    const destinations = new Set(node.leads.filter((target) => target !== node.id));
    if (destinations.size < MIN_DISTINCT_LEADS) {
      problems.push(
        `nodes/${node.id} : ${String(destinations.size)} sortie(s) distincte(s) pour ` +
          `${String(MIN_DISTINCT_LEADS)} exigée(s)`,
      );
    }
    for (const target of new Set(node.leads)) {
      const destination = byId.get(target);
      if (destination === undefined) {
        problems.push(`nodes/${node.id} : la piste vers « ${target} » ne mène à aucun nœud`);
        continue;
      }
      if (destination.periodId === node.periodId) continue;
      problems.push(
        `nodes/${node.id} : la piste vers « ${target} » traverse les périodes ` +
          `(« ${node.periodId} » → « ${destination.periodId} »)`,
      );
    }
  }
  return problems;
}

/** Les nœuds atteints depuis un point d'entrée, lui compris. */
export function reachableFrom(files: Files, entryId: string): ReadonlySet<string> {
  const byId = new Map(graphOf(files).map((node) => [node.id, node]));
  const seen = new Set<string>([entryId]);
  const stack = [entryId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const target of byId.get(current)?.leads ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      stack.push(target);
    }
  }
  return seen;
}

export const entryPoints = (files: Files): readonly string[] =>
  graphOf(files)
    .filter((node) => node.entryPoint)
    .map((node) => node.id)
    .sort();

/**
 * Les nœuds qu'aucun point d'entrée n'atteint — règle 2 de S-02, et la seule
 * assertion de traversée qui ait des dents.
 *
 * DIT À VOIX HAUTE : le critère « le testeur coupe une piste, le compte tombe »
 * est presque toujours FAUX sur un bon graphe, et c'est voulu. La règle des
 * trois indices inversée achète précisément de la redondance : mesuré sur le
 * graphe livré, une seule des soixante-cinq pistes fait bouger le nombre de
 * nœuds atteints. Le seuil de douze ne mord donc pas ; cette liste-ci, si.
 */
export function unreachableNodes(files: Files): readonly string[] {
  const nodes = graphOf(files);
  const reached = new Set<string>();
  for (const entry of nodes.filter((node) => node.entryPoint)) {
    for (const id of reachableFrom(files, entry.id)) reached.add(id);
  }
  return nodes
    .filter((node) => !reached.has(node.id))
    .map((node) => node.id)
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Aucun champion de l'annuaire cité, aucun chiffre de règle écrit
// ─────────────────────────────────────────────────────────────────────────

/**
 * Aucun texte de scénario ne cite un champion de `champions-index.json`.
 *
 * « hors de son propre fichier » n'a pas d'exception ici : une pièce de
 * scénario n'appartient à aucun champion. Le seul endroit où un champion est
 * nommé est `hook.appliesTo.championId`, qui est une RÉFÉRENCE et que la marche
 * de prose écarte. Un ressort dit donc pourquoi CETTE bande est concernée sans
 * écrire le nom de personne — ce qui est aussi ce qui le rend jouable par
 * quelqu'un d'autre.
 */
export function citationProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const entries = list(
    record(JSON.parse(files.get('champions-index.json') ?? 'null'))?.['champions'],
  )
    .map((item) => record(item))
    .filter((item): item is Record<string, unknown> => item !== undefined);

  for (const directory of SCENARIO_DIRECTORIES) {
    for (const [id, document] of documentsUnder(files, directory)) {
      const haystack = normalise(proseOf(document).join(' \n '));
      for (const entry of entries) {
        const spellings = [entry['displayName'], ...list(entry['aliases'])]
          .map((spelling) => text(spelling))
          .filter((spelling): spelling is string => spelling !== undefined);
        for (const spelling of spellings) {
          if (!mentions(haystack, normalise(spelling))) continue;
          problems.push(
            `${directory}/${id} : cite « ${spelling} » (${String(entry['id'])}) dans ses champs de texte`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * Aucun chiffre arabe dans un texte de scénario.
 *
 * PLUS STRICT QUE LE CRITÈRE, qui dit « aucun chiffre de règle » et donne
 * « +2 » en exemple. Distinguer « +2 » de « 3 hameaux » demanderait une
 * grammaire ; refuser tout chiffre demande une expression régulière, et donne
 * un meilleur français au passage — une figure dit « quarante feux », pas
 * « 40 feux ». Les nombres de MÉCANIQUE (`segments`, `after`, `before`,
 * `schemaVersion`) ne sont pas du texte et ne passent pas par cette marche.
 */
export function ruleNumberProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  for (const directory of SCENARIO_DIRECTORIES) {
    for (const [id, document] of documentsUnder(files, directory)) {
      for (const prose of proseOf(document)) {
        const digits = /\d/u.exec(prose);
        if (digits === null) continue;
        problems.push(
          `${directory}/${id} : « ${prose.slice(0, 60)} » écrit un chiffre — ` +
            `les nombres d'un texte de scénario s'écrivent en lettres`,
        );
      }
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Les ressorts accrochent les fiches livrées
// ─────────────────────────────────────────────────────────────────────────

/** Les fiches manuscrites, comptées sur le disque plutôt qu'épinglées. */
const deliveredSheets = (files: Files): ReadonlyMap<string, readonly string[]> => {
  const sheets = new Map<string, readonly string[]>();
  for (const [id, sheet] of documentsUnder(files, 'champions'))
    sheets.set(id, slugs(sheet['tags']));
  return sheets;
};

/**
 * Chaque fiche livrée est atteinte par au moins un ressort, par son id ou par
 * un trait qu'elle porte — « par leur serment ou leurs atouts », dit la fiche.
 */
export function hookAnchorProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const sheets = deliveredSheets(files);
  const hooks = [...documentsUnder(files, 'hooks').entries()];

  const anchored = new Map<string, string[]>();
  for (const [sheetId] of sheets) anchored.set(sheetId, []);

  for (const [hookId, hook] of hooks) {
    const appliesTo = record(hook['appliesTo']);
    if (appliesTo?.['kind'] === 'champion') {
      const championId = text(appliesTo['championId']) ?? '';
      anchored.get(championId)?.push(hookId);
      continue;
    }
    if (appliesTo?.['kind'] !== 'trait') continue;
    const tag = text(appliesTo['tag']) ?? '';
    for (const [sheetId, tags] of sheets) {
      if (tags.includes(tag)) anchored.get(sheetId)?.push(hookId);
    }
  }

  for (const [sheetId, reached] of anchored) {
    if (reached.length > 0) continue;
    problems.push(
      `hooks : aucun ressort n'accroche la fiche « ${sheetId} » — ni par son id, ni par un de ses traits`,
    );
  }

  const covered = [...anchored.values()].filter((reached) => reached.length > 0).length;
  if (covered < MIN_HOOKS_ON_SHEETS) {
    problems.push(
      `hooks : ${String(covered)} fiche(s) accrochée(s) pour ${String(MIN_HOOKS_ON_SHEETS)} exigée(s)`,
    );
  }
  return problems;
}

/** Les quinze rencontres sont réparties sur les cinq genres, aucun laissé vide. */
export function encounterSpreadProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const encounters = [...documentsUnder(files, 'encounters').values()];
  for (const kind of ENCOUNTER_KINDS) {
    const count = encounters.filter((encounter) => encounter['kind'] === kind).length;
    if (count > 0) continue;
    problems.push(`encounters : aucune rencontre du genre « ${kind} »`);
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// Le contenu tel qu'il est commité
// ─────────────────────────────────────────────────────────────────────────

describe('la frise du Freljord et de quoi jouer', () => {
  it('livre les six familles au compte que la fiche S-03 annonce', () => {
    const files = disk();
    expect(filesUnder(files, 'periods').length).toBeGreaterThanOrEqual(MIN_PERIODS);
    expect(filesUnder(files, 'fronts').length).toBeGreaterThanOrEqual(MIN_FRONTS);
    expect(filesUnder(files, 'nodes').length).toBeGreaterThanOrEqual(MIN_NODES);
    expect(filesUnder(files, 'figures').length).toBeGreaterThanOrEqual(MIN_FIGURES);
    expect(filesUnder(files, 'hooks').length).toBeGreaterThanOrEqual(MIN_HOOKS);
    expect(filesUnder(files, 'encounters').length).toBeGreaterThanOrEqual(MIN_ENCOUNTERS);
  });

  it('connaît les six répertoires de l’ADR 0012, et le chargeur les connaît aussi', () => {
    expect(SCENARIO_DIRECTORIES).toHaveLength(SCENARIO_FAMILY_COUNT);
    for (const directory of SCENARIO_DIRECTORIES) {
      expect(KNOWN_DIRECTORIES).toContain(directory);
    }
  });

  it('annonce les six familles au manifeste, au compte exact de ce qui est sur le disque', () => {
    const files = disk();
    const declared = record(
      record(JSON.parse(files.get('manifest.json') ?? 'null'))?.['expectedCounts'],
    );
    for (const directory of SCENARIO_DIRECTORIES) {
      expect(declared?.[directory]).toBe(filesUnder(files, directory).length);
    }
  });

  it('enchaîne six périodes sans trou ni recouvrement', () => {
    expect(timelineProblems(disk())).toStrictEqual([]);
  });

  it('ne fait apparaître aucune faction dans une période qui la déclare absente', () => {
    expect(anachronismProblems(disk())).toStrictEqual([]);
  });

  it('monte trois fronts modernes sur le même territoire, avec trois enjeux distincts', () => {
    expect(contestedFrontProblems(disk())).toStrictEqual([]);
  });

  it('donne à chaque front exactement autant de présages que de segments', () => {
    expect(frontClockProblems(disk())).toStrictEqual([]);
  });

  it('donne à chaque nœud trois sorties distinctes, résolues et dans sa période', () => {
    expect(graphProblems(disk())).toStrictEqual([]);
  });

  it('atteint au moins douze nœuds distincts depuis chacun de ses points d’entrée', () => {
    const files = disk();
    const entries = entryPoints(files);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(reachableFrom(files, entry).size).toBeGreaterThanOrEqual(MIN_REACHED_FROM_ENTRY);
    }
  });

  it('ne laisse aucun nœud hors d’atteinte de ses points d’entrée', () => {
    expect(unreachableNodes(disk())).toStrictEqual([]);
  });

  it('n’écrit le nom d’aucun champion de l’annuaire dans un texte de scénario', () => {
    expect(citationProblems(disk())).toStrictEqual([]);
  });

  it('n’écrit aucun chiffre dans un texte de scénario', () => {
    expect(ruleNumberProblems(disk())).toStrictEqual([]);
  });

  it('accroche les trois fiches livrées par au moins un ressort chacune', () => {
    expect(hookAnchorProblems(disk())).toStrictEqual([]);
  });

  it('répartit ses rencontres sur les cinq genres', () => {
    expect(encounterSpreadProblems(disk())).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Les mêmes garde-fous, violés exprès
// ─────────────────────────────────────────────────────────────────────────

describe('chaque garde-fou rougit sur la faute qu’il annonce', () => {
  it('une borne de période déplacée ouvre un trou dans la frise', () => {
    const files = edit(disk(), 'periods/la-longue-nuit.json', (document) => {
      document['before'] = 450;
    });
    expect(timelineProblems(files)).toStrictEqual([
      "frise : « la-longue-nuit » se ferme à 450 et « freljord-moderne » s'ouvre à 500 — " +
        'la frise a un trou ou un recouvrement entre les deux',
    ]);
  });

  it('une faction glissée par référence dans une période qui la déclare absente est nommée', () => {
    const files = edit(disk(), 'figures/la-soeur-qui-est-restee.json', (document) => {
      document['factionId'] = 'avarosans';
    });
    expect(anachronismProblems(files)).toStrictEqual([
      'figures/la-soeur-qui-est-restee : référence la faction « avarosans », déclarée absente ' +
        'de la période « guerre-des-trois-soeurs »',
    ]);
  });

  it('une faction glissée EN TOUTES LETTRES dans un texte de la mauvaise période est nommée', () => {
    const files = edit(disk(), 'fronts/les-murs-de-glace-se-fendent.json', (document) => {
      const portents = [...(document['portents'] as string[])];
      portents[0] =
        "La Griffe d'Hiver installe ses bandes au pied du mur et regarde les veilleurs.";
      document['portents'] = portents;
    });
    expect(anachronismProblems(files)).toStrictEqual([
      "fronts/les-murs-de-glace-se-fendent : écrit « La Griffe d'Hiver » alors que la faction " +
        '« griffe-d-hiver » est déclarée absente de la période « la-longue-nuit »',
    ]);
  });

  it('une apostrophe typographique ne fait pas passer une faction interdite', () => {
    // MESURÉ : sans `foldApostrophes`, cette même phrase passait. La
    // normalisation de 02-mj-ia.md section 8.4 plie les accents et les tirets,
    // pas les apostrophes — « d’Hiver » et « d'Hiver » y sont deux chaînes
    // différentes. Le trou est signalé dans la PR ; il vaut aussi pour
    // `no_reserved_champion`, que S-03 laisse tel que la spec l'écrit.
    const files = edit(disk(), 'fronts/les-murs-de-glace-se-fendent.json', (document) => {
      const portents = [...(document['portents'] as string[])];
      portents[0] =
        'La Griffe d’Hiver installe ses bandes au pied du mur et regarde les veilleurs.';
      document['portents'] = portents;
    });
    expect(anachronismProblems(files)).toStrictEqual([
      "fronts/les-murs-de-glace-se-fendent : écrit « La Griffe d'Hiver » alors que la faction " +
        '« griffe-d-hiver » est déclarée absente de la période « la-longue-nuit »',
    ]);
  });

  it('deux fronts modernes qui perdent la même chose ne se gênent pas', () => {
    const files = disk();
    const stake = (
      JSON.parse(files.get('fronts/le-serment-du-grenier.json') ?? '{}') as Record<string, unknown>
    )['stake'];
    edit(files, 'fronts/la-descente-de-la-griffe.json', (document) => {
      document['stake'] = stake;
    });
    expect(contestedFrontProblems(files)).toStrictEqual([
      'fronts : « la-descente-de-la-griffe » et « le-serment-du-grenier » visent le même enjeu — ' +
        'deux fronts qui perdent la même chose ne se gênent pas, ils se répètent',
    ]);
  });

  it('un front qui perd son mot-clé de territoire fait tomber le compte des trois', () => {
    const files = edit(disk(), 'fronts/la-veille-qui-s-impatiente.json', (document) => {
      document['tags'] = slugs(document['tags']).filter((tag) => tag !== CONTESTED_TAG);
    });
    expect(contestedFrontProblems(files)).toStrictEqual([
      'fronts : 2 front(s) modernes marqués « territoire-conteste » pour 3 exigés — ' +
        "la situation la plus riche de la frise n'est pas montée",
    ]);
  });

  it('un présage retiré est rapporté avec le compte des segments', () => {
    const files = edit(disk(), 'fronts/le-froid-qui-descend-du-col.json', (document) => {
      document['portents'] = (document['portents'] as string[]).slice(1);
    });
    expect(frontClockProblems(files)).toStrictEqual([
      'fronts/le-froid-qui-descend-du-col : 3 présage(s) pour 4 segment(s)',
    ]);
  });

  it('une piste retirée sur un nœud qui en a trois nomme le nœud', () => {
    const files = edit(disk(), 'nodes/le-feu-partage.json', (document) => {
      document['leads'] = list(document['leads']).slice(1);
    });
    expect(graphProblems(files)).toStrictEqual([
      'nodes/le-feu-partage : 2 sortie(s) distincte(s) pour 3 exigée(s)',
    ]);
  });

  it('une piste qui change de période est rapportée comme un saut de frise', () => {
    const files = edit(disk(), 'nodes/le-pont-sans-fin.json', (document) => {
      document['periodId'] = 'la-longue-nuit';
    });
    expect(graphProblems(files)).toStrictEqual([
      'nodes/la-faille-hurlante : la piste vers « le-pont-sans-fin » traverse les périodes ' +
        '(« freljord-moderne » → « la-longue-nuit »)',
      'nodes/le-pont-sans-fin : la piste vers « la-marque-sur-la-glace » traverse les périodes ' +
        '(« la-longue-nuit » → « freljord-moderne »)',
      'nodes/le-pont-sans-fin : la piste vers « la-faille-hurlante » traverse les périodes ' +
        '(« la-longue-nuit » → « freljord-moderne »)',
      'nodes/le-pont-sans-fin : la piste vers « le-feu-partage » traverse les périodes ' +
        '(« la-longue-nuit » → « freljord-moderne »)',
    ]);
  });

  it('la seule piste qui mène à un nœud, coupée, le sort du graphe et fait tomber le compte', () => {
    const before = reachableFrom(disk(), 'le-grenier-de-pierre').size;
    const files = edit(disk(), 'nodes/la-faille-hurlante.json', (document) => {
      document['leads'] = list(document['leads']).filter(
        (lead) => record(lead)?.['toNodeId'] !== 'le-pont-sans-fin',
      );
    });
    expect(unreachableNodes(files)).toStrictEqual(['le-pont-sans-fin']);
    expect(reachableFrom(files, 'le-grenier-de-pierre').size).toBeLessThan(before);
  });

  it('un champion de l’annuaire cité dans un ressort est nommé avec son orthographe', () => {
    const files = edit(disk(), 'hooks/la-porte-qu-on-vous-doit.json', (document) => {
      document['pitch'] = 'Le hameau des pics attend Braum, et personne d’autre ne fera l’affaire.';
    });
    expect(citationProblems(files)).toStrictEqual([
      'hooks/la-porte-qu-on-vous-doit : cite « Braum » (braum) dans ses champs de texte',
    ]);
  });

  it('un alias de champion, accents pliés, est attrapé comme le nom lui-même', () => {
    const files = edit(disk(), 'figures/eira-la-veilleuse.json', (document) => {
      document['knows'] = 'Ce que la gardienne de glace a laissé derrière elle en repartant.';
    });
    expect(citationProblems(files)).toStrictEqual([
      'figures/eira-la-veilleuse : cite « la Gardienne de Glace » (lissandra) dans ses champs de texte',
    ]);
  });

  it('un chiffre de règle dans un texte de figure est nommé', () => {
    const files = edit(disk(), 'figures/katla-la-compteuse.json', (document) => {
      document['wants'] = 'Que le compte tombe juste, et elle ajoute +2 à qui la soutient.';
    });
    expect(ruleNumberProblems(files)).toStrictEqual([
      'figures/katla-la-compteuse : « Que le compte tombe juste, et elle ajoute +2 à qui la soutie » ' +
        "écrit un chiffre — les nombres d'un texte de scénario s'écrivent en lettres",
    ]);
  });

  it('une fiche livrée que plus aucun ressort n’accroche est nommée', () => {
    const files = disk();
    edit(files, 'hooks/ce-qu-on-ne-mendie-plus.json', (document) => {
      document['appliesTo'] = { kind: 'region', regionId: 'ice-reaches' };
    });
    edit(files, 'hooks/ceux-qui-comptent-les-sacs.json', (document) => {
      document['appliesTo'] = { kind: 'region', regionId: 'avarosa-reach' };
    });
    expect(hookAnchorProblems(files)).toStrictEqual([
      "hooks : aucun ressort n'accroche la fiche « sejuani » — ni par son id, ni par un de ses traits",
      'hooks : 2 fiche(s) accrochée(s) pour 3 exigée(s)',
    ]);
  });

  it('un genre de rencontre vidé est nommé', () => {
    const files = disk();
    for (const file of filesUnder(files, 'encounters')) {
      edit(files, file, (document) => {
        if (document['kind'] === 'trouvaille') document['kind'] = 'obstacle';
      });
    }
    expect(encounterSpreadProblems(files)).toStrictEqual([
      'encounters : aucune rencontre du genre « trouvaille »',
    ]);
  });

  it('vider `content/nodes/` fait tomber le graphe, pas passer le test', () => {
    const files = disk();
    for (const file of filesUnder(files, 'nodes')) files.delete(file);
    expect(entryPoints(files)).toStrictEqual([]);
    expect(unreachableNodes(files)).toStrictEqual([]);
    // Et c'est pourquoi le compte de fichiers est vérifié à part, en toutes lettres.
    expect(filesUnder(files, 'nodes').length).toBeLessThan(MIN_NODES);
  });
});
