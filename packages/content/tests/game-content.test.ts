/**
 * What the DELIVERED bundle says, proven by breaking it.
 *
 * `content-validity.test.ts` proves that the LOADER refuses a broken bundle.
 * This file answers the other question, the one M0-16 is accountable for: does
 * `content/` — the real root, the one `pnpm content:index` embeds — actually
 * hold what the rules need? Those are two different failures. A loader can be
 * perfect over a bundle that is missing half its fallback lines.
 *
 * ── EVERY CHECK RUNS ON THE FILES ON DISK, AND ON A MUTATED COPY ──────────
 * Each guard-rail below appears twice: once against `content/` as committed
 * (green), once against a copy carrying the exact fault it claims to catch
 * (red, with the offending pair or id named). Showing that a test exists is
 * worth nothing; what counts is that it reddens on the violation and only on
 * it.
 *
 * ── WHY THE CHECKS READ RAW JSON AND NOT PARSED DOCUMENTS ────────────────
 * A schema-parsed document cannot carry the faults this file must catch: a
 * `keywords: []` never gets past `PriceEntrySchema`, so a test that parsed
 * first would report a Zod throw instead of its own message, and the tester
 * removing one keyword would learn nothing about WHICH entry broke. The
 * schemas are still used where they are the right tool — `collectRefs` walks a
 * schema next to a raw value, exactly as pass 3 of the loader does.
 *
 * ── THE NUMBERS BELOW, AND WHERE EACH ONE COMES FROM (ADR 0007) ──────────
 * A number from an ACCEPTANCE CRITERION is written here in full letters: two
 * variants per pair, twelve price entries, three handwritten sheets, nine
 * oracles, five regions, six assets. A number that belongs to the ENGINE is
 * compared to the engine and never retyped: the eleven moves and the three
 * outcomes come from `zMoveId` / `zOutcome`, which mirror the engine's closed
 * tuples. That is also what stops the loops below from being their own source:
 * emptying `content/moves/` does not shrink `zMoveId.options`, so the fallback
 * check still demands eleven move keys and reddens.
 *
 * ONE RECOPY IS DECLARED, because `@for/content` cannot import `@for/engine`
 * (01-architecture.md section 1.2 — its only runtime dependency is
 * `@for/contracts`): `FALLBACK_DEFAULT_KEY` repeats the engine's
 * `FALLBACK_DEFAULT_TEMPLATE_ID`, which no schema mirrors today. Reported with
 * the task rather than hidden here.
 *
 * ── ONE DIVERGENCE IS ACCEPTED, AND THIS IS WHERE IT IS WRITTEN ──────
 * `MoveSchema.rollKind` and the roll each engine handler actually plans are
 * NOT compared, here or anywhere. `moves/strike.json` switched to
 * `rollKind: 'none'` with `attributeOptions: []` leaves `pnpm content:check`
 * at 0 while `strike`'s handler keeps planning `{ kind: 'action' }`.
 *
 * The engine is not silent about it: the eleven handlers each pin the roll
 * they plan in their `plan()` body (`strike.ts`, `endure-cold.ts` and the six
 * other action moves give `kind: 'action'`; `fulfill-your-vow.ts` gives
 * `'progress'`; `reach-a-milestone.ts` and `forsake-your-vow.ts` give
 * `'none'`), and all eleven agree with the delivered content today. What is
 * missing is an EXPOSED constant: `MoveHandler` carries no `rollKind` field.
 *
 * It is not fixed here, and not because it is small. `@for/content` declares
 * `@for/contracts` as its only runtime dependency (01-architecture.md
 * section 1.2), so this file cannot read `MOVE_REGISTRY`: comparing the two
 * from here would mean recopying the eleven kinds, which is the number
 * compared to itself of ADR 0007, one commit later. The comparison belongs
 * where the delivered bundle first meets the engine — the task that runs
 * `content/` through `decide()` — written as
 * `MOVE_REGISTRY[id].rollKind === bundle.moves.get(id)?.rollKind` over the
 * eleven, with no recopy. Raised with the lead in the M0-16 follow-up.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AssetSchema,
  ChampionIndexSchema,
  ChampionSchema,
  ConditionsFileSchema,
  ManifestSchema,
  MoveSchema,
  OracleTableSchema,
  PresageTableSchema,
  PriceTableSchema,
  RegionSchema,
  TruthsFileSchema,
  YesNoOracleSchema,
  zMoveId,
  zOutcome,
} from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { readContentFiles } from '../src/load.js';
import { collectRefs } from '../src/validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', 'content');

// ─────────────────────────────────────────────────────────────────────────
// The numbers the acceptance criteria state, in full letters
// ─────────────────────────────────────────────────────────────────────────

/** « chaque couple (mouvement, issue) avec au moins 2 variantes ». */
const MIN_FALLBACK_VARIANTS = 2;
/** « pay-the-price a exactement 12 entrées couvrant 1..12 ». */
const PRICE_ENTRY_COUNT = 12;
/** « les trois fiches » — écrites à la main, nommément. */
const HANDWRITTEN_SHEETS = ['ashe', 'braum', 'sejuani'] as const;
/** « content/oracles/*.json (les 9, dont yes-no) ». */
const ORACLE_DOCUMENT_COUNT = 9;
/** « content/regions/*.json (≥ 5, en forêt) ». */
const MIN_REGIONS = 5;
/** « content/assets/*.json (≥ 6) ». */
const MIN_ASSETS = 6;
/** « les trois fiches portent une répartition 3/2/2/1/1 ». */
const ATTRIBUTE_SPREAD = '3,2,2,1,1';

/**
 * ADR 0009 : « un atout qui ne se déclenche jamais n'existe pas ». Une fiche
 * sans atout de perception rend la perception par personnage décorative, ce
 * qui est l'avertissement exact qui a produit la décision 3 de l'ADR 0008.
 * DEUX et non un : un seul atout fait tenir tout un personnage sur un domaine,
 * et le schéma en autorise six.
 */
const MIN_PERCEPTION_TRAITS = 2;

/**
 * La bande de CONTENU d'une force d'atout — plus étroite que la bande de FORME
 * du schéma (`PERCEPTION_STRENGTH_MIN/MAX` = 1..99, qui n'interdit que la
 * certitude 100 et l'impossibilité 0, et que le chargeur fait déjà respecter).
 *
 * L'ADR 0009 ne pose aucun chiffre. Il pose le principe — « un atout qui se
 * déclenche toujours n'est plus un atout, c'est une règle ; un atout qui ne se
 * déclenche jamais n'existe pas » — et deux adjectifs, « forte » et
 * « minuscule ». Les bornes ci-dessous traduisent ce principe dans le seul
 * vocabulaire de chances que le jeu possède déjà, celui de l'oracle oui/non
 * livré dans `content/oracles/yes-no.json` : `quasi-certain` y vaut 90,
 * `improbable` y vaut 10. Une force de 90 ou plus est donc quasi-certaine —
 * une règle ; une force sous 10 est sous « improbable » — elle n'existe pas.
 *
 * Écrites en toutes lettres plutôt qu'importées de `YESNO_THRESHOLDS` : c'est
 * un choix de contenu pris ici, pas une dépendance de l'atout envers l'oracle.
 * Rééquilibrable en M1, et signalé au lead pour ratification en ADR.
 */
const PERCEPTION_STRENGTH_FLOOR = 10;
const PERCEPTION_STRENGTH_CEILING = 89;

/**
 * The reserved key of a turn that played no move: `fallbackTemplateId(null,
 * null)` returns `default/franche` (`packages/engine/src/decide.ts`). Recopied,
 * and declared in the file header.
 */
const FALLBACK_DEFAULT_KEY = 'default';

// ─────────────────────────────────────────────────────────────────────────
// Raw-JSON plumbing
// ─────────────────────────────────────────────────────────────────────────

type Files = ReadonlyMap<string, string>;

const disk = (): Map<string, string> => new Map(readContentFiles(ROOT));

const parsed = (files: Files, file: string): unknown => {
  const raw = files.get(file);
  if (raw === undefined) return undefined;
  return JSON.parse(raw) as unknown;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const list = (value: unknown): readonly unknown[] | undefined =>
  Array.isArray(value) ? (value as readonly unknown[]) : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const filesUnder = (files: Files, directory: string): readonly string[] =>
  [...files.keys()].filter((file) => file.startsWith(`${directory}/`)).sort();

/** Rewrites one document in a COPY of the bundle. Used by the violation tests. */
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

/** The schema that validates each path — the loader's plan, for `collectRefs`. */
const schemaFor = (file: string): unknown => {
  if (file === 'manifest.json') return ManifestSchema;
  if (file === 'champions-index.json') return ChampionIndexSchema;
  if (file === 'conditions.json') return ConditionsFileSchema;
  if (file === 'oracles/yes-no.json') return YesNoOracleSchema;
  if (file === 'tables/pay-the-price.json') return PriceTableSchema;
  if (file === 'tables/presages.json') return PresageTableSchema;
  if (file.startsWith('moves/')) return MoveSchema;
  if (file.startsWith('champions/')) return ChampionSchema;
  if (file.startsWith('regions/')) return RegionSchema;
  if (file.startsWith('oracles/')) return OracleTableSchema;
  if (file.startsWith('assets/')) return AssetSchema;
  if (file.startsWith('truths/')) return TruthsFileSchema;
  return undefined;
};

// ─────────────────────────────────────────────────────────────────────────
// 1. The fallback narration covers every (move, outcome) pair
// ─────────────────────────────────────────────────────────────────────────

/**
 * Loops over the ENGINE's eleven moves and three outcomes, never over the keys
 * of the file being checked: a `templates: {}` must fail, and it does.
 */
export function fallbackProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const document = record(parsed(files, 'fallbacks/narration.json'));
  const templates = record(document?.['templates']);
  if (templates === undefined) {
    return ['fallbacks/narration.json : aucun bloc « templates »'];
  }

  for (const move of [...zMoveId.options, FALLBACK_DEFAULT_KEY]) {
    for (const outcome of zOutcome.options) {
      const pair = `${move}/${outcome}`;
      const variants = list(record(templates[move])?.[outcome]);
      if (variants === undefined) {
        problems.push(`${pair} : aucune variante de narration de repli`);
        continue;
      }
      if (variants.length < MIN_FALLBACK_VARIANTS) {
        problems.push(
          `${pair} : ${String(variants.length)} variante(s), il en faut au moins ${String(MIN_FALLBACK_VARIANTS)}`,
        );
      }
      for (const [index, variant] of variants.entries()) {
        if ((text(variant) ?? '').trim() === '') {
          problems.push(`${pair}[${String(index)}] : variante vide`);
        }
      }
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Every table covers its die, face by face
// ─────────────────────────────────────────────────────────────────────────

/** The oracle tables plus the two engine-reserved ones. `yes-no` has no faces. */
const rolledTables = (files: Files): readonly string[] => [
  ...filesUnder(files, 'oracles').filter((file) => file !== 'oracles/yes-no.json'),
  'tables/presages.json',
  'tables/pay-the-price.json',
];

export function dieCoverageProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  for (const file of rolledTables(files)) {
    const document = record(parsed(files, file));
    if (document === undefined) {
      problems.push(`${file} : document absent ou illisible`);
      continue;
    }
    const die = document['die'];
    const entries = list(document['entries']);
    if (typeof die !== 'number' || entries === undefined) {
      problems.push(`${file} : « die » ou « entries » absent`);
      continue;
    }
    const hits = new Map<number, number>();
    for (const entry of entries) {
      const bounds = record(entry);
      const min = bounds?.['min'];
      const max = bounds?.['max'];
      if (typeof min !== 'number' || typeof max !== 'number') continue;
      for (let face = min; face <= max; face += 1) {
        hits.set(face, (hits.get(face) ?? 0) + 1);
      }
    }
    for (let face = 1; face <= die; face += 1) {
      const count = hits.get(face) ?? 0;
      if (count === 0)
        problems.push(`${file} : la face ${String(face)} n'est couverte par aucune entrée`);
      if (count > 1) {
        problems.push(`${file} : la face ${String(face)} est couverte ${String(count)} fois`);
      }
    }
    for (const face of hits.keys()) {
      if (face < 1 || face > die) {
        problems.push(`${file} : la face ${String(face)} est hors du dé d${String(die)}`);
      }
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. `pay-the-price`: twelve entries, and keywords an assertion can score on
// ─────────────────────────────────────────────────────────────────────────

/**
 * `keywords` is the only data `price_respected` (02-mj-ia.md section 8.4) has
 * to score against, in the eval AND in the production post-filter. An empty or
 * numeric list is a silent hole in a filter, not a documentation gap.
 */
export function priceProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const document = record(parsed(files, 'tables/pay-the-price.json'));
  const entries = list(document?.['entries']);
  if (entries === undefined) return ['tables/pay-the-price.json : aucune entrée'];

  if (entries.length !== PRICE_ENTRY_COUNT) {
    problems.push(
      `tables/pay-the-price.json : ${String(entries.length)} entrées, il en faut exactement ${String(PRICE_ENTRY_COUNT)}`,
    );
  }

  for (const [index, raw] of entries.entries()) {
    const entry = record(raw);
    const id = text(entry?.['id']) ?? `#${String(index)}`;
    const keywords = list(entry?.['keywords']);
    if (keywords === undefined || keywords.length === 0) {
      problems.push(
        `pay-the-price/${id} : aucun mot-clé — « price_respected » n'aurait rien à noter`,
      );
      continue;
    }
    for (const keyword of keywords) {
      const word = text(keyword);
      if (word === undefined || word.trim() === '') {
        problems.push(`pay-the-price/${id} : mot-clé vide`);
        continue;
      }
      if (/\d/u.test(word)) {
        problems.push(`pay-the-price/${id} : le mot-clé « ${word} » porte un chiffre`);
      }
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Cross-references, and the region forest
// ─────────────────────────────────────────────────────────────────────────

const idsOf = (files: Files, directory: string): readonly string[] =>
  filesUnder(files, directory).map((file) => text(record(parsed(files, file))?.['id']) ?? file);

const listedIds = (files: Files, file: string, key: string): readonly string[] =>
  (list(record(parsed(files, file))?.[key]) ?? [])
    .map((item) => text(record(item)?.['id']))
    .filter((id): id is string => id !== undefined);

/** The id index of pass 3, rebuilt here so the check does not delegate. */
function knownIds(files: Files): Readonly<Record<string, readonly string[]>> {
  const oracles = idsOf(files, 'oracles');
  return {
    move: idsOf(files, 'moves'),
    champion: [
      ...new Set([
        ...idsOf(files, 'champions'),
        ...listedIds(files, 'champions-index.json', 'champions'),
      ]),
    ],
    region: idsOf(files, 'regions'),
    oracle: oracles,
    asset: idsOf(files, 'assets'),
    condition: listedIds(files, 'conditions.json', 'conditions'),
    table: [...oracles, 'pay-the-price', 'presages'],
    truth: filesUnder(files, 'truths').flatMap((file) => listedIds(files, file, 'truths')),
  };
}

export function referenceProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const known = knownIds(files);
  for (const file of [...files.keys()].sort()) {
    const schema = schemaFor(file);
    if (schema === undefined) continue;
    for (const reference of collectRefs(schema, parsed(files, file))) {
      const candidates = known[reference.kind] ?? [];
      if (candidates.includes(reference.id)) continue;
      problems.push(
        `${file} : ${reference.kind} « ${reference.id} » introuvable (${reference.path.join('.')})`,
      );
    }
  }
  return problems;
}

export function forestProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const parents = new Map<string, string | null>();
  for (const file of filesUnder(files, 'regions')) {
    const document = record(parsed(files, file));
    const id = text(document?.['id']);
    if (id === undefined) continue;
    const parent = document?.['parentId'];
    parents.set(id, typeof parent === 'string' ? parent : null);
  }

  for (const id of parents.keys()) {
    const chain = [id];
    let cursor = parents.get(id) ?? null;
    while (cursor !== null) {
      if (chain.includes(cursor)) {
        problems.push(
          `régions : ${[...chain, cursor].join(' → ')} — une région est sa propre ancêtre`,
        );
        break;
      }
      chain.push(cursor);
      cursor = parents.get(cursor) ?? null;
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// 5. The three handwritten sheets, and their agreement with the directory
// ─────────────────────────────────────────────────────────────────────────

const sheetOf = (files: Files, id: string): Record<string, unknown> | undefined =>
  record(parsed(files, `champions/${id}.json`));

/** The normalisation of 02-mj-ia.md section 8.4, used by `no_reserved_champion`. */
export function normaliseChampionName(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replaceAll(/[\s‐-―_-]+/gu, ' ')
    .trim();
}

export function sheetProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  for (const id of HANDWRITTEN_SHEETS) {
    const sheet = sheetOf(files, id);
    if (sheet === undefined) {
      problems.push(`champions/${id}.json : fiche absente`);
      continue;
    }
    if (sheet['source'] !== 'handwritten') {
      problems.push(`${id} : source « ${String(sheet['source'])} », attendu « handwritten »`);
    }

    const attributes = record(sheet['attributes']) ?? {};
    const spread = Object.values(attributes)
      .filter((value): value is number => typeof value === 'number')
      .sort((left, right) => right - left)
      .join(',');
    if (spread !== ATTRIBUTE_SPREAD) {
      problems.push(`${id} : répartition « ${spread} », attendu « ${ATTRIBUTE_SPREAD} »`);
    }

    const name = text(sheet['name']) ?? '';
    const aliases = (list(sheet['aliases']) ?? [])
      .map((alias) => text(alias))
      .filter((alias): alias is string => alias !== undefined);
    const beyondTheName = aliases.filter(
      (alias) => normaliseChampionName(alias) !== normaliseChampionName(name),
    );
    if (beyondTheName.length === 0) {
      problems.push(
        `${id} : aucun alias en plus du nom — le verrouillage de distribution n'aurait qu'une orthographe`,
      );
    }

    // ADR 0009. The loop below IS its own source of iteration: empty
    // `perceptionTraits` and it reports nothing. That is precisely why the
    // count is checked FIRST and against a number written in full letters —
    // emptying the array trips that one, on all three sheets at once.
    const traits = (list(sheet['perceptionTraits']) ?? [])
      .map((trait) => record(trait))
      .filter((trait): trait is Record<string, unknown> => trait !== undefined);
    if (traits.length < MIN_PERCEPTION_TRAITS) {
      problems.push(
        `${id} : ${String(traits.length)} atout(s) de perception, il en faut au moins ` +
          `${String(MIN_PERCEPTION_TRAITS)} — sans eux la perception par personnage est décorative`,
      );
    }
    for (const trait of traits) {
      const traitId = text(trait['id']) ?? '(sans id)';
      const trigger = record(trait['trigger']) ?? {};
      const moveIds = list(trigger['moveIds']) ?? [];
      if (record(trigger['presentEntity']) === undefined && moveIds.length === 0) {
        problems.push(
          `${id}/${traitId} : déclencheur sans « presentEntity » ni « moveIds » — ` +
            `« le regard de prédateur voit des cibles », pas une phrase que le conteur interprète`,
        );
      }
      const strength = trait['strength'];
      if (
        typeof strength !== 'number' ||
        strength < PERCEPTION_STRENGTH_FLOOR ||
        strength > PERCEPTION_STRENGTH_CEILING
      ) {
        problems.push(
          `${id}/${traitId} : force ${String(strength)} hors de la bande ` +
            `${String(PERCEPTION_STRENGTH_FLOOR)}..${String(PERCEPTION_STRENGTH_CEILING)} — ` +
            `au-dessus c'est une règle, en dessous l'atout n'existe pas`,
        );
      }
    }
  }
  return problems;
}

export function indexAgreementProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const entries = list(record(parsed(files, 'champions-index.json'))?.['champions']) ?? [];

  for (const id of HANDWRITTEN_SHEETS) {
    const sheet = sheetOf(files, id);
    if (sheet === undefined) continue;
    const entry = entries.map((item) => record(item)).find((item) => item?.['id'] === id);
    if (entry === undefined) {
      problems.push(`${id} : aucune entrée dans champions-index.json`);
      continue;
    }
    if (entry['displayName'] !== sheet['name']) {
      problems.push(
        `${id} : nom « ${String(sheet['name'])} » ≠ displayName « ${String(entry['displayName'])} »`,
      );
    }
    const sheetAliases = [...(list(sheet['aliases']) ?? [])].map(String).sort().join(' · ');
    const indexAliases = [...(list(entry['aliases']) ?? [])].map(String).sort().join(' · ');
    if (sheetAliases !== indexAliases) {
      problems.push(
        `${id} : alias divergents — fiche [${sheetAliases}] · annuaire [${indexAliases}]`,
      );
    }
    const sheetRegion = record(sheet['origin'])?.['regionId'];
    if (entry['canonicalRegionId'] !== sheetRegion) {
      problems.push(
        `${id} : région « ${String(sheetRegion)} » ≠ canonicalRegionId « ${String(entry['canonicalRegionId'])} »`,
      );
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// 6. No sheet names another champion of the directory
// ─────────────────────────────────────────────────────────────────────────

/**
 * Keys whose value is an IDENTIFIER, not prose. They are skipped rather than
 * listed positively: a text field added to `ChampionSchema` tomorrow is covered
 * by this walk without anybody remembering to enrol it, which is the opposite
 * of a list that is its own source.
 */
const REFERENCE_KEYS = new Set([
  'id',
  'championId',
  'regionId',
  'conditionId',
  'tableId',
  'moveIds',
  'startingAssets',
  'domain',
  'tags',
  'contentWarnings',
  'kinds',
  'dispositions',
]);

/** Every prose leaf of a document, reference fields excluded. */
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

export function citationProblems(files: Files): readonly string[] {
  const problems: string[] = [];
  const entries = (list(record(parsed(files, 'champions-index.json'))?.['champions']) ?? [])
    .map((item) => record(item))
    .filter((item): item is Record<string, unknown> => item !== undefined);

  for (const id of HANDWRITTEN_SHEETS) {
    const sheet = sheetOf(files, id);
    if (sheet === undefined) continue;
    const haystack = normaliseChampionName(proseOf(sheet).join(' \n '));

    for (const entry of entries) {
      if (entry['id'] === id) continue;
      const spellings = [entry['displayName'], ...(list(entry['aliases']) ?? [])]
        .map((spelling) => text(spelling))
        .filter((spelling): spelling is string => spelling !== undefined);
      for (const spelling of spellings) {
        const needle = normaliseChampionName(spelling);
        if (needle === '') continue;
        const pattern = new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`,
          'u',
        );
        if (pattern.test(haystack)) {
          problems.push(
            `${id} : cite « ${spelling} » (${String(entry['id'])}) dans ses champs de texte`,
          );
        }
      }
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// The bundle as committed
// ─────────────────────────────────────────────────────────────────────────

describe('le contenu livré porte ce que les règles exigent', () => {
  it('tient l’inventaire que la fiche M0-16 annonce', () => {
    const files = disk();
    expect(zMoveId.options).toHaveLength(idsOf(files, 'moves').length);
    expect([...idsOf(files, 'champions')].sort()).toStrictEqual([...HANDWRITTEN_SHEETS].sort());
    expect(filesUnder(files, 'oracles')).toHaveLength(ORACLE_DOCUMENT_COUNT);
    expect(filesUnder(files, 'regions').length).toBeGreaterThanOrEqual(MIN_REGIONS);
    expect(filesUnder(files, 'assets').length).toBeGreaterThanOrEqual(MIN_ASSETS);
    expect([...filesUnder(files, 'tables')].sort()).toStrictEqual([
      'tables/pay-the-price.json',
      'tables/presages.json',
    ]);
  });

  it('couvre chaque couple (mouvement, issue) d’au moins deux variantes de repli', () => {
    expect(fallbackProblems(disk())).toStrictEqual([]);
  });

  it('couvre intégralement le dé de chaque table', () => {
    expect(dieCoverageProblems(disk())).toStrictEqual([]);
  });

  it('donne à « payer le prix » douze entrées et des mots-clés notables', () => {
    expect(priceProblems(disk())).toStrictEqual([]);
  });

  it('résout toutes ses références croisées', () => {
    expect(referenceProblems(disk())).toStrictEqual([]);
  });

  it('range ses régions en forêt : aucune n’est sa propre ancêtre', () => {
    expect(forestProblems(disk())).toStrictEqual([]);
  });

  it('livre trois fiches manuscrites en 3/2/2/1/1, chacune avec un alias de plus que son nom, et chacune au moins deux atouts de perception déclenchables et dans la bande', () => {
    expect(sheetProblems(disk())).toStrictEqual([]);
  });

  it('accorde chaque fiche avec son entrée d’annuaire', () => {
    expect(indexAgreementProblems(disk())).toStrictEqual([]);
  });

  it('n’écrit le nom d’aucun autre champion de l’annuaire dans une fiche', () => {
    expect(citationProblems(disk())).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The same guard-rails, violated on purpose
// ─────────────────────────────────────────────────────────────────────────

describe('chaque garde-fou rougit sur la faute qu’il annonce', () => {
  it('une variante retirée nomme le couple (mouvement, issue)', () => {
    const files = edit(disk(), 'fallbacks/narration.json', (document) => {
      const templates = document['templates'] as Record<string, Record<string, string[]>>;
      const endureCold = templates['endure-cold'] ?? {};
      endureCold['partielle'] = ['Tu passes, et le gel prélève sa part sur le sac.'];
      templates['endure-cold'] = endureCold;
    });
    expect(fallbackProblems(files)).toStrictEqual([
      'endure-cold/partielle : 1 variante(s), il en faut au moins 2',
    ]);
  });

  it('un bloc de mouvement entier retiré est rapporté pour ses trois issues', () => {
    const files = edit(disk(), 'fallbacks/narration.json', (document) => {
      const templates = document['templates'] as Record<string, unknown>;
      delete templates['strike'];
    });
    expect(fallbackProblems(files)).toStrictEqual([
      'strike/franche : aucune variante de narration de repli',
      'strike/partielle : aucune variante de narration de repli',
      'strike/echec : aucune variante de narration de repli',
    ]);
  });

  it('un fichier de gabarits vide ne passe pas pour « rien à redire »', () => {
    const files = edit(disk(), 'fallbacks/narration.json', (document) => {
      document['templates'] = {};
    });
    // Onze mouvements plus la clé « default », trois issues chacun.
    expect(fallbackProblems(files)).toHaveLength((zMoveId.options.length + 1) * 3);
  });

  it('un trou dans un dé nomme la face manquante', () => {
    const files = edit(disk(), 'oracles/complication.json', (document) => {
      const entries = document['entries'] as Record<string, unknown>[];
      entries[0] = { ...entries[0], max: 1 };
    });
    expect(dieCoverageProblems(files)).toStrictEqual([
      "oracles/complication.json : la face 2 n'est couverte par aucune entrée",
    ]);
  });

  it('un chevauchement dans un dé nomme la face comptée deux fois', () => {
    const files = edit(disk(), 'tables/presages.json', (document) => {
      const entries = document['entries'] as Record<string, unknown>[];
      entries[1] = { ...entries[1], min: 2 };
    });
    expect(dieCoverageProblems(files)).toStrictEqual([
      'tables/presages.json : la face 2 est couverte 2 fois',
    ]);
  });

  it('une entrée de prix privée de ses mots-clés est nommée', () => {
    const files = edit(disk(), 'tables/pay-the-price.json', (document) => {
      const entries = document['entries'] as Record<string, unknown>[];
      entries[5] = { ...entries[5], keywords: [] };
    });
    expect(priceProblems(files)).toStrictEqual([
      "pay-the-price/un-ennui-nouveau : aucun mot-clé — « price_respected » n'aurait rien à noter",
    ]);
  });

  it('un mot-clé de prix qui porte un chiffre est refusé', () => {
    const files = edit(disk(), 'tables/pay-the-price.json', (document) => {
      const entries = document['entries'] as Record<string, unknown>[];
      entries[1] = { ...entries[1], keywords: ['2 points de vigueur'] };
    });
    expect(priceProblems(files)).toStrictEqual([
      'pay-the-price/le-froid-mord : le mot-clé « 2 points de vigueur » porte un chiffre',
    ]);
  });

  it('une treizième entrée de prix est refusée', () => {
    const files = edit(disk(), 'tables/pay-the-price.json', (document) => {
      const entries = document['entries'] as Record<string, unknown>[];
      entries.push({ ...entries[11], id: 'une-entree-de-trop', min: 13, max: 13 });
    });
    expect(priceProblems(files)).toContain(
      'tables/pay-the-price.json : 13 entrées, il en faut exactement 12',
    );
  });

  it('un atout qui n’existe pas est nommé, avec l’endroit où il est cité', () => {
    const files = edit(disk(), 'champions/braum.json', (document) => {
      document['startingAssets'] = ['bouclier-de-portes'];
    });
    expect(referenceProblems(files)).toStrictEqual([
      'champions/braum.json : asset « bouclier-de-portes » introuvable (startingAssets.0)',
    ]);
  });

  it('une condition qui n’existe pas est nommée depuis l’effet qui la pose', () => {
    const files = edit(disk(), 'moves/endure-cold.json', (document) => {
      const outcomes = document['outcomes'] as Record<string, Record<string, unknown>>;
      outcomes['echec'] = {
        ...outcomes['echec'],
        effects: [{ op: 'condition_add', conditionId: 'transis' }],
      };
    });
    expect(referenceProblems(files)).toStrictEqual([
      'moves/endure-cold.json : condition « transis » introuvable (outcomes.echec.effects.0.conditionId)',
    ]);
  });

  it('une région devenue sa propre ancêtre est rapportée avec sa chaîne', () => {
    const files = edit(disk(), 'regions/freljord.json', (document) => {
      document['parentId'] = 'rakelstake';
    });
    expect(forestProblems(files)).toContain(
      'régions : freljord → rakelstake → avarosa-reach → freljord — une région est sa propre ancêtre',
    );
  });

  it('une fiche forgée qui se dit manuscrite est refusée', () => {
    const files = edit(disk(), 'champions/ashe.json', (document) => {
      document['source'] = 'forged';
    });
    expect(sheetProblems(files)).toStrictEqual([
      'ashe : source « forged », attendu « handwritten »',
    ]);
  });

  it('une répartition d’attributs hors 3/2/2/1/1 est refusée', () => {
    const files = edit(disk(), 'champions/sejuani.json', (document) => {
      document['attributes'] = { vif: 3, coeur: 3, fer: 3, ombre: 1, esprit: 1 };
    });
    expect(sheetProblems(files)).toStrictEqual([
      'sejuani : répartition « 3,3,3,1,1 », attendu « 3,2,2,1,1 »',
    ]);
  });

  it('une fiche sans alias autre que son nom est refusée', () => {
    const files = edit(disk(), 'champions/braum.json', (document) => {
      document['aliases'] = ['Braum'];
    });
    expect(sheetProblems(files)).toStrictEqual([
      "braum : aucun alias en plus du nom — le verrouillage de distribution n'aurait qu'une orthographe",
    ]);
  });

  it('les trois fiches vidées de leurs atouts de perception tombent toutes les trois', () => {
    let files = disk();
    for (const id of HANDWRITTEN_SHEETS) {
      files = edit(files, `champions/${id}.json`, (document) => {
        document['perceptionTraits'] = [];
      });
    }
    expect(sheetProblems(files)).toStrictEqual([
      'ashe : 0 atout(s) de perception, il en faut au moins 2 — sans eux la perception par personnage est décorative',
      'braum : 0 atout(s) de perception, il en faut au moins 2 — sans eux la perception par personnage est décorative',
      'sejuani : 0 atout(s) de perception, il en faut au moins 2 — sans eux la perception par personnage est décorative',
    ]);
  });

  it('une fiche ramenée à un seul atout de perception est refusée', () => {
    const files = edit(disk(), 'champions/braum.json', (document) => {
      document['perceptionTraits'] = (document['perceptionTraits'] as unknown[]).slice(0, 1);
    });
    expect(sheetProblems(files)).toStrictEqual([
      'braum : 1 atout(s) de perception, il en faut au moins 2 — sans eux la perception par personnage est décorative',
    ]);
  });

  it('un déclencheur sans entité présente ni mouvement est nommé avec son atout', () => {
    const files = edit(disk(), 'champions/braum.json', (document) => {
      const traits = document['perceptionTraits'] as Record<string, unknown>[];
      const trigger = traits[0]?.['trigger'] as Record<string, unknown>;
      delete trigger['presentEntity'];
      trigger['moveIds'] = [];
    });
    expect(sheetProblems(files)).toStrictEqual([
      'braum/pressent-le-danger : déclencheur sans « presentEntity » ni « moveIds » — ' +
        '« le regard de prédateur voit des cibles », pas une phrase que le conteur interprète',
    ]);
  });

  it('une force quasi-certaine fait de l’atout une règle, et est refusée', () => {
    const files = edit(disk(), 'champions/braum.json', (document) => {
      const traits = document['perceptionTraits'] as Record<string, unknown>[];
      for (const trait of traits) trait['strength'] = 99;
    });
    expect(sheetProblems(files)).toStrictEqual([
      "braum/pressent-le-danger : force 99 hors de la bande 10..89 — au-dessus c'est une règle, en dessous l'atout n'existe pas",
      "braum/voit-qui-va-lacher : force 99 hors de la bande 10..89 — au-dessus c'est une règle, en dessous l'atout n'existe pas",
    ]);
  });

  it('une force sous « improbable » fait un atout qui n’existe pas, et est refusée', () => {
    const files = edit(disk(), 'champions/sejuani.json', (document) => {
      const traits = document['perceptionTraits'] as Record<string, unknown>[];
      if (traits[0] !== undefined) traits[0]['strength'] = 9;
    });
    expect(sheetProblems(files)).toStrictEqual([
      "sejuani/flaire-la-faiblesse : force 9 hors de la bande 10..89 — au-dessus c'est une règle, en dessous l'atout n'existe pas",
    ]);
  });

  it('un alias retiré CÔTÉ FICHE fait diverger la fiche et l’annuaire', () => {
    const files = edit(disk(), 'champions/sejuani.json', (document) => {
      document['aliases'] = (document['aliases'] as string[]).slice(1);
    });
    expect(indexAgreementProblems(files)).toStrictEqual([
      'sejuani : alias divergents — fiche [La Griffe de Givre · Sejuani Avarosan · the Fury of the North] · annuaire [La Fureur du Nord · La Griffe de Givre · Sejuani Avarosan · the Fury of the North]',
    ]);
  });

  it('un alias retiré CÔTÉ ANNUAIRE fait diverger la fiche et l’annuaire', () => {
    const files = edit(disk(), 'champions-index.json', (document) => {
      const champions = document['champions'] as Record<string, unknown>[];
      const braum = champions.find((entry) => entry['id'] === 'braum');
      if (braum !== undefined) braum['aliases'] = (braum['aliases'] as string[]).slice(1);
    });
    expect(indexAgreementProblems(files)).toStrictEqual([
      "braum : alias divergents — fiche [L'homme à la porte · Le Coeur du Freljord · Le Cœur du Freljord · the Heart of the Freljord] · annuaire [L'homme à la porte · Le Coeur du Freljord · the Heart of the Freljord]",
    ]);
  });

  it('une entrée d’annuaire manquante est rapportée', () => {
    const files = edit(disk(), 'champions-index.json', (document) => {
      document['champions'] = (document['champions'] as Record<string, unknown>[]).filter(
        (entry) => entry['id'] !== 'ashe',
      );
    });
    expect(indexAgreementProblems(files)).toStrictEqual([
      'ashe : aucune entrée dans champions-index.json',
    ]);
  });

  it('une région d’annuaire qui diverge de la fiche est rapportée', () => {
    const files = edit(disk(), 'champions-index.json', (document) => {
      const champions = document['champions'] as Record<string, unknown>[];
      const ashe = champions.find((entry) => entry['id'] === 'ashe');
      if (ashe !== undefined) ashe['canonicalRegionId'] = 'freljord';
    });
    expect(indexAgreementProblems(files)).toStrictEqual([
      'ashe : région « avarosa-reach » ≠ canonicalRegionId « freljord »',
    ]);
  });

  it('un autre champion cité dans une fiche est nommé, alias compris', () => {
    const files = edit(disk(), 'champions/braum.json', (document) => {
      document['loreHooks'] = [
        'Il a croisé la Sorcière de Glace une fois, et n’en a jamais rien dit.',
      ];
    });
    expect(citationProblems(files)).toStrictEqual([
      'braum : cite « la Sorcière de Glace » (lissandra) dans ses champs de texte',
    ]);
  });

  it('un nom propre cité dans une fiche est nommé, même hors casse et hors accent', () => {
    const files = edit(disk(), 'champions/ashe.json', (document) => {
      document['description'] = 'Elle a partagé un hiver avec OLAF, et n’en parle jamais.';
    });
    expect(citationProblems(files)).toStrictEqual([
      'ashe : cite « Olaf » (olaf) dans ses champs de texte',
    ]);
  });

  it('un identifiant de référence n’est PAS pris pour une citation', () => {
    // `relations[].championId` vaut « ashe » sur la fiche de Braum : une
    // référence, pas une mention. Si la marche à plat comptait les champs de
    // référence, ce test serait rouge sur le contenu livré.
    const sheet = sheetOf(disk(), 'braum');
    expect(proseOf(sheet).some((value) => value === 'ashe')).toBe(false);
  });
});
