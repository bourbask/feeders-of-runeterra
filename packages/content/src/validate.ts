/**
 * The four passes of 03-donnees.md section 4.8, over an in-memory file map.
 *
 * NOTHING HERE TOUCHES THE DISK. `load.ts` is the only module allowed to read
 * a file (M0-14 acceptance criterion), which is also what lets the SAME four
 * passes validate the statically-imported bundle of `generated/index.ts` at
 * runtime, with no I/O at all.
 *
 * ── THE FAILURE THIS MODULE EXISTS TO AVOID ──────────────────────────────
 * A loader that accepts a MISSING file, or compares a count to an EMPTY set,
 * turns `pnpm content:check` into a command that returns 0 whatever happens.
 * Three rules keep that from being true here:
 *
 *   1. `REQUIRED_FILES` and `REQUIRED_DIRECTORIES` are explicit lists. An
 *      absent entry is an error naming the path, never a default value.
 *   2. `expectedCounts` is compared for EQUALITY, not for "at least". A
 *      manifest announcing more items than the bundle holds is exactly the
 *      dropped-`COPY` bug section 4.7 describes, and it fails.
 *   3. An unknown directory or an unknown file under the root is an error. A
 *      file nobody validates is a file that can say anything.
 *
 * ── THE ONE PATH THAT IS KNOWINGLY NOT VALIDATED ─────────────────────────
 * `fallbacks/narration.json` (section 4.1) has NO schema in `@for/contracts`
 * and NO field in `ContentBundle` (section 4.8). It is therefore listed, not
 * loaded, and the success summary says so out loud. Reported in the PR: this
 * is signalled, not worked around.
 */

import type {
  AssetContent,
  ChampionContent,
  ChampionIndexEntryContent,
  ConditionContent,
  EncounterContent,
  FigureContent,
  FrontContent,
  HookContent,
  ManifestContent,
  MoveContent,
  NodeContent,
  OracleTableContent,
  PeriodContent,
  PresageTableContent,
  PriceTableContent,
  RegionContent,
  TruthContent,
} from '@for/contracts';
import {
  AssetSchema,
  ChampionIndexSchema,
  ChampionSchema,
  ConditionsFileSchema,
  EncounterSchema,
  FigureSchema,
  FrontSchema,
  HookSchema,
  ManifestSchema,
  MoveSchema,
  NodeSchema,
  OracleTableSchema,
  PeriodSchema,
  PresageTableSchema,
  PriceTableSchema,
  RegionSchema,
  TruthsFileSchema,
  YesNoOracleSchema,
  zAttributeId,
  zGaugeId,
  zMoveId,
  zOutcome,
} from '@for/contracts';
import type { JsonPath, JsonSource } from './json-source.js';
import { formatPath, JsonSyntaxError, lineOf, parseJsonSource } from './json-source.js';

// ─────────────────────────────────────────────────────────────────────────
// What the loader hands back
// ─────────────────────────────────────────────────────────────────────────

/**
 * Output types derived from the schemas WITHOUT importing zod.
 *
 * `@for/content` depends on `@for/contracts` and nothing else
 * (01-architecture.md section 1.2). `ReturnType<typeof Schema.parse>` gives
 * the same type as `z.output<…>` and adds no runtime edge to the graph.
 */
export type YesNoOracleContent = ReturnType<typeof YesNoOracleSchema.parse>;
type ConditionsFileContent = ReturnType<typeof ConditionsFileSchema.parse>;
type ChampionIndexFileContent = ReturnType<typeof ChampionIndexSchema.parse>;
type TruthsFileContent = ReturnType<typeof TruthsFileSchema.parse>;

/** 03-donnees.md section 4.8. */
export interface ContentBundle {
  readonly version: string;
  /** sha256 of the canonical JSON of the bundle (`manifest.ts`). */
  readonly hash: string;
  readonly rulesVersion: number;
  readonly moves: ReadonlyMap<string, MoveContent>;
  readonly champions: ReadonlyMap<string, ChampionContent>;
  readonly championIndex: ReadonlyMap<string, ChampionIndexEntryContent>;
  readonly regions: ReadonlyMap<string, RegionContent>;
  readonly oracles: ReadonlyMap<string, OracleTableContent>;
  readonly yesNo: YesNoOracleContent;
  readonly priceTable: PriceTableContent;
  readonly presages: PresageTableContent;
  readonly assets: ReadonlyMap<string, AssetContent>;
  readonly conditions: ReadonlyMap<string, ConditionContent>;
  readonly truths: readonly TruthContent[];
  /**
   * The six scenario families of ADR 0012. EMPTY IS LEGAL: S-01 ships the
   * vocabulary, S-03 ships the pieces, and the loader must accept a bundle
   * that has the first without the second — held by
   * `tests/scenario-vocabulary.test.ts` « un bundle SANS aucune pièce de
   * scénario charge quand même ».
   */
  readonly periods: ReadonlyMap<string, PeriodContent>;
  readonly fronts: ReadonlyMap<string, FrontContent>;
  readonly nodes: ReadonlyMap<string, NodeContent>;
  readonly figures: ReadonlyMap<string, FigureContent>;
  readonly hooks: ReadonlyMap<string, HookContent>;
  readonly encounters: ReadonlyMap<string, EncounterContent>;
  /** Paths found under the root that no schema validates. See the header. */
  readonly unvalidated: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────

export type ContentPass = 1 | 2 | 3 | 4;

export interface ContentIssue {
  /** Root-relative path of the offending file, e.g. `champions/ashe.json`. */
  readonly file: string;
  /** Path inside the document, e.g. `startingAssets[0]`. Empty for the file itself. */
  readonly path: string;
  readonly message: string;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly pass: ContentPass;
}

export class ContentError extends Error {
  public constructor(
    public readonly issues: readonly ContentIssue[],
    public readonly root: string,
  ) {
    super(`contenu invalide : ${String(issues.length)} erreur(s) sous « ${root} »`);
    this.name = 'ContentError';
  }

  /** The report of 03-donnees.md section 4.8. */
  public format(verbose = false): string {
    return formatReport(this.issues, this.root, verbose);
  }
}

export function formatReport(
  issues: readonly ContentIssue[],
  root: string,
  verbose = false,
): string {
  const byFile = new Map<string, ContentIssue[]>();
  for (const issue of issues) {
    const bucket = byFile.get(issue.file);
    if (bucket === undefined) byFile.set(issue.file, [issue]);
    else bucket.push(issue);
  }

  const count = issues.length;
  const lines: string[] = [
    `✖ Contenu invalide — le serveur ne démarrera pas (${String(count)} ${count > 1 ? 'erreurs' : 'erreur'})`,
    '',
  ];

  for (const file of [...byFile.keys()].sort()) {
    // `.` is the root itself (absent, empty, not a directory): printing
    // « content/. » would name a path nobody can open.
    lines.push(`  ${file === '.' ? root : `${root}/${file}`}`);
    for (const issue of byFile.get(file) ?? []) {
      const where = issue.line === undefined ? '' : ` (ligne ${String(issue.line)})`;
      const head = issue.path === '' ? where.trim() : `${issue.path}${where}`;
      lines.push(`    → ${head === '' ? '' : `${head} : `}${issue.message}`);
      if (verbose) lines.push(`        passe ${String(issue.pass)}`);
    }
    lines.push('');
  }

  lines.push('Corrigez ces fichiers puis relancez. Détail : pnpm content:check --verbose');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Levenshtein — the suggestion of pass 3
// ─────────────────────────────────────────────────────────────────────────

export function levenshtein(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current.push(Math.min(substitution, deletion, insertion));
    }
    previous = current;
  }
  return previous[right.length] ?? right.length;
}

/** The closest id, when it is close enough to be worth printing. */
export function suggest(unknownId: string, candidates: Iterable<string>): string | undefined {
  const tolerance = Math.max(2, Math.floor(unknownId.length / 3));
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = levenshtein(unknownId, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best !== undefined && bestDistance <= tolerance ? best : undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// The file plan: which schema validates which path
// ─────────────────────────────────────────────────────────────────────────

/** Directories the root may contain. Anything else is an error. */
export const KNOWN_DIRECTORIES = [
  'moves',
  'champions',
  'regions',
  'oracles',
  'tables',
  'assets',
  'truths',
  'fallbacks',
  // ADR 0012 — the six scenario families. KNOWN, and deliberately NOT in
  // `REQUIRED_DIRECTORIES`: S-01 delivers the schemas and S-03 the content, so
  // between the two an absent `periods/` is a bundle that still loads. The day
  // S-03 lands, what makes them non-optional is `expectedCounts`, which
  // `checkCounts` demands as soon as one document of a family is present.
  'periods',
  'fronts',
  'nodes',
  'figures',
  'hooks',
  'encounters',
] as const;

/** Files that MUST be there. An absent one is never a default. */
export const REQUIRED_FILES = [
  'manifest.json',
  'champions-index.json',
  'conditions.json',
  'oracles/yes-no.json',
  'tables/pay-the-price.json',
  'tables/presages.json',
] as const;

/** Directories that must exist AND hold at least one `.json`. */
export const REQUIRED_DIRECTORIES = [
  'moves',
  'champions',
  'regions',
  'oracles',
  'assets',
  'truths',
] as const;

/**
 * The one path with no schema. `content/fallbacks/narration.json` is in the
 * tree of section 4.1 and in no `ContentBundle` field of section 4.8; the
 * engine's fallback templates are M0-13's shape. Listed so the summary can say
 * it, and closed so a SECOND unvalidated file cannot appear unnoticed.
 */
export const UNVALIDATED_PATHS = ['fallbacks/narration.json'] as const;

// ─────────────────────────────────────────────────────────────────────────
// Reference resolution (pass 3)
// ─────────────────────────────────────────────────────────────────────────

/** The kinds `RefSchema(kind)` uses across `@for/contracts/content`. */
export type RefKind =
  | 'move'
  | 'champion'
  | 'region'
  | 'oracle'
  | 'asset'
  | 'condition'
  | 'table'
  | 'truth'
  | 'period'
  | 'front'
  | 'node'
  | 'figure'
  | 'hook'
  | 'encounter'
  // A FACTION HAS NO FILE. Faction ids are declared inside `regions/*.json`,
  // under `factions[].id`, and that set is what `ref:faction` resolves
  // against. Without this kind, `period.absentFactionIds` would be a list of
  // free slugs nobody checks — and the field exists precisely to be checked.
  | 'faction';

const REF_LABELS: Readonly<Record<RefKind, string>> = {
  move: 'mouvement',
  champion: 'champion',
  region: 'région',
  oracle: 'oracle',
  asset: 'atout',
  condition: 'condition',
  table: 'table',
  truth: 'vérité',
  period: 'période',
  front: 'front',
  node: 'nœud',
  figure: 'figure',
  hook: 'ressort',
  encounter: 'rencontre',
  faction: 'faction',
};

/**
 * References the engine-effect union carries WITHOUT a `ref:` marker.
 *
 * `zEngineEffect` mirrors the engine's `EngineEffect` and is owned by
 * `contracts/src/core/effects.ts` (ADR 0006: one declaration, not two). Its
 * `conditionId` and `tableId` are plain `zSlug`, so the marker walk cannot see
 * them — yet section 4.8's own worked example reports
 * `outcomes.echec.effects[1].conditionId : condition "blesse" introuvable`.
 *
 * Resolving those two by FIELD NAME closes the hole from this side without
 * declaring the effect union a second time. Reported in the PR: the durable
 * fix is a `ref:` marker in `contracts`, a file this task does not own.
 */
const REF_BY_FIELD_NAME: Readonly<Record<string, RefKind>> = {
  conditionId: 'condition',
  tableId: 'table',
};

interface SchemaDef {
  readonly type: string;
  readonly innerType?: SchemaNode;
  readonly element?: SchemaNode;
  readonly getter?: () => SchemaNode;
  readonly options?: readonly SchemaNode[];
  readonly discriminator?: string;
  readonly values?: readonly unknown[];
}

interface SchemaNode {
  readonly description?: string | undefined;
  readonly def: SchemaDef;
  readonly shape?: Record<string, SchemaNode>;
}

const asNode = (schema: unknown): SchemaNode => schema as SchemaNode;

/** One reference found in a document, with the place it was written. */
export interface FoundRef {
  readonly path: JsonPath;
  readonly kind: RefKind;
  readonly id: string;
}

const isRefKind = (candidate: string): candidate is RefKind => Object.hasOwn(REF_LABELS, candidate);

/**
 * Walk a schema and a RAW value side by side, collecting every reference.
 *
 * RAW, and on purpose: a file that failed pass 2 still gets its references
 * checked, which is how section 4.8's example reports a bad attribute spread
 * AND a dead asset reference on the same sheet, in a single run.
 */
export function collectRefs(schema: unknown, value: unknown): FoundRef[] {
  const found: FoundRef[] = [];
  /**
   * The open `z.lazy` frames, as (getter, VALUE) pairs — not getters alone.
   *
   * Re-entering the same `z.lazy` is NORMAL content: `choice.options[].effects[]`
   * points straight back at `zEngineEffectUnion` (ADR 0006 keeps `choice`). A
   * guard on the getter alone made the walk stop at the first `choice` and
   * report NOTHING nested under it. What must never repeat is the same getter
   * over the SAME value: that, and only that, is a walk going nowhere. The
   * value shrinks at every array or object step and a JSON document is finite,
   * so the walk terminates on its own.
   */
  const openFrames: { getter: unknown; value: unknown }[] = [];

  const walk = (node: SchemaNode | undefined, current: unknown, path: JsonPath): void => {
    if (node === undefined || current === undefined || current === null) return;
    // `def` is typed as present, but this walk runs over values that are only
    // shaped like Zod nodes: an unwrapped literal or a schema class this build
    // does not know would land here with nothing to read.
    const def = node.def as SchemaDef | undefined;
    if (def === undefined) return;

    switch (def.type) {
      case 'lazy': {
        const getter = def.getter;
        if (getter === undefined) return;
        if (openFrames.some((frame) => frame.getter === getter && frame.value === current)) return;
        openFrames.push({ getter, value: current });
        walk(asNode(getter()), current, path);
        openFrames.pop();
        return;
      }
      case 'optional':
      case 'nullable':
      case 'default':
      case 'prefault':
      case 'nonoptional':
      case 'readonly':
      case 'catch':
        walk(def.innerType, current, path);
        return;
      case 'array': {
        if (!Array.isArray(current)) return;
        const element = def.element;
        current.forEach((item, index) => {
          walk(element, item, [...path, index]);
        });
        return;
      }
      case 'object': {
        if (typeof current !== 'object' || Array.isArray(current)) return;
        const shape = node.shape;
        if (shape === undefined) return;
        const record = current as Record<string, unknown>;
        for (const [key, child] of Object.entries(shape)) {
          if (!Object.hasOwn(record, key)) continue;
          walk(child, record[key], [...path, key]);
        }
        return;
      }
      case 'union': {
        const options = def.options;
        const discriminator = def.discriminator;
        // A union with no discriminator cannot be resolved against a raw value
        // without guessing the branch. None of the content schemas carry one
        // that holds a reference (`DieSizeSchema` is literals).
        if (
          options === undefined ||
          discriminator === undefined ||
          typeof current !== 'object' ||
          Array.isArray(current)
        ) {
          return;
        }
        const tag = (current as Record<string, unknown>)[discriminator];
        for (const option of options) {
          const literal = asNode(option).shape?.[discriminator]?.def.values;
          if (literal?.includes(tag) === true) {
            walk(asNode(option), current, path);
            return;
          }
        }
        return;
      }
      case 'string': {
        if (typeof current !== 'string') return;
        const marker = node.description;
        if (marker?.startsWith('ref:') === true) {
          const kind = marker.slice('ref:'.length);
          if (isRefKind(kind)) found.push({ path, kind, id: current });
          return;
        }
        const last = path.at(-1);
        const byName = typeof last === 'string' ? REF_BY_FIELD_NAME[last] : undefined;
        if (byName !== undefined) found.push({ path, kind: byName, id: current });
        return;
      }
      default:
        return;
    }
  };

  walk(asNode(schema), value, []);
  return found;
}

// ─────────────────────────────────────────────────────────────────────────
// The four passes
// ─────────────────────────────────────────────────────────────────────────

/** Root-relative path -> raw file contents. Produced by `load.ts` or the generator. */
export type ContentFiles = ReadonlyMap<string, string>;

export interface ValidateOptions {
  /** Printed in the report, e.g. `content-fixtures`. */
  readonly root?: string;
  /** sha256 of the canonical bundle. Computed by `load.ts`, embedded by the generator. */
  readonly hash?: string;
}

/** The shape of `safeParse`, spelled out so `zod` stays out of this package. */
interface ParseIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}
type ParseResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly error: { readonly issues: readonly ParseIssue[] } };

interface ParsedFile {
  readonly file: string;
  readonly source: JsonSource;
  readonly schema: unknown;
}

const basenameId = (file: string): string => {
  const slash = file.lastIndexOf('/');
  return file.slice(slash + 1).replace(/\.json$/, '');
};

const directoryOf = (file: string): string => {
  const slash = file.indexOf('/');
  return slash === -1 ? '' : file.slice(0, slash);
};

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
  if (file.startsWith('periods/')) return PeriodSchema;
  if (file.startsWith('fronts/')) return FrontSchema;
  if (file.startsWith('nodes/')) return NodeSchema;
  if (file.startsWith('figures/')) return FigureSchema;
  if (file.startsWith('hooks/')) return HookSchema;
  if (file.startsWith('encounters/')) return EncounterSchema;
  return undefined;
};

/** Files that carry an `id` which must equal the file name (section 4.1). */
const HAS_FILE_NAMED_ID = new Set([
  'moves',
  'champions',
  'regions',
  'oracles',
  'assets',
  'periods',
  'fronts',
  'nodes',
  'figures',
  'hooks',
  'encounters',
]);

/**
 * The four passes. Throws `ContentError` carrying every issue found.
 *
 * Passes 1 to 3 are per file and accumulate together — one run reports every
 * broken file, never just the first. Pass 4 is GLOBAL and runs only when 1 to
 * 3 are clean: counting entities in a bundle whose files failed to parse would
 * report an `expectedCounts` mismatch caused by the earlier error, and bury
 * the real one.
 */
export function validateContent(files: ContentFiles, options: ValidateOptions = {}): ContentBundle {
  const root = options.root ?? 'content';
  const issues: ContentIssue[] = [];
  const add: Add = (issue) => {
    issues.push(issue);
  };

  // ── Structure: nothing missing, nothing unknown ──────────────────────
  const present = [...files.keys()].sort();
  const unvalidated: string[] = [];

  for (const file of present) {
    if (!file.endsWith('.json')) {
      add({ file, path: '', message: 'fichier inattendu : le contenu est du JSON', pass: 1 });
      continue;
    }
    const directory = directoryOf(file);
    if (directory !== '' && !(KNOWN_DIRECTORIES as readonly string[]).includes(directory)) {
      add({
        file,
        path: '',
        message: `répertoire inconnu « ${directory}/ » : aucun schéma ne valide ce fichier`,
        pass: 1,
      });
      continue;
    }
    if ((UNVALIDATED_PATHS as readonly string[]).includes(file)) {
      unvalidated.push(file);
      continue;
    }
    if (schemaFor(file) === undefined) {
      add({ file, path: '', message: 'fichier inattendu : aucun schéma ne le valide', pass: 1 });
    }
  }

  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) {
      add({ file: required, path: '', message: 'fichier obligatoire absent', pass: 1 });
    }
  }

  for (const directory of REQUIRED_DIRECTORIES) {
    if (!present.some((file) => file.startsWith(`${directory}/`))) {
      add({
        file: `${directory}/`,
        path: '',
        message: 'répertoire obligatoire absent ou vide : aucun fichier à charger',
        pass: 1,
      });
    }
  }

  // ── Pass 1 : syntax ──────────────────────────────────────────────────
  //
  // NO SCHEMA IS NOT NO CHECK. `fallbacks/narration.json` has no shape in
  // `@for/contracts`, and the previous version skipped it entirely: a file
  // holding `{ ceci n est pas du JSON` left `content:check` at 0. "Listed, not
  // loaded" has to mean listed AND readable, or the summary line announces a
  // file the server will choke on. Its syntax is checked here; its SHAPE is
  // still nobody's business, and the summary still says so.
  const parsed: ParsedFile[] = [];
  for (const file of present) {
    const schema = schemaFor(file);
    const unschemad = (UNVALIDATED_PATHS as readonly string[]).includes(file);
    const raw = files.get(file);
    if ((schema === undefined && !unschemad) || raw === undefined) continue;
    try {
      const source = parseJsonSource(raw);
      if (schema !== undefined) parsed.push({ file, source, schema });
    } catch (error) {
      if (!(error instanceof JsonSyntaxError)) throw error;
      add({
        file,
        path: '',
        message: `JSON invalide : ${error.message} (ligne ${String(error.line)}, colonne ${String(error.column)})`,
        line: error.line,
        column: error.column,
        pass: 1,
      });
    }
  }

  // ── Pass 2 : Zod, per file, every issue collected ─────────────────────
  const values = new Map<string, unknown>();
  for (const entry of parsed) {
    const result = (entry.schema as { safeParse: (input: unknown) => ParseResult }).safeParse(
      entry.source.value,
    );
    if (result.success) {
      values.set(entry.file, result.data);
      continue;
    }
    for (const issue of result.error.issues) {
      const path = issue.path as JsonPath;
      add({
        file: entry.file,
        path: formatPath(path),
        message: issue.message,
        line: lineOf(entry.source, path),
        pass: 2,
      });
    }
  }

  // ── The id index, built from RAW values so pass 3 works on broken files ──
  const known = indexRawIds(parsed);

  // ── Pass 3 : references ───────────────────────────────────────────────
  for (const entry of parsed) {
    for (const reference of collectRefs(entry.schema, entry.source.value)) {
      const candidates = known[reference.kind];
      if (candidates.includes(reference.id)) continue;
      const hint = suggest(reference.id, candidates);
      add({
        file: entry.file,
        path: formatPath(reference.path),
        message:
          `${REF_LABELS[reference.kind]} "${reference.id}" introuvable` +
          (hint === undefined ? '' : ` (suggestion : "${hint}")`),
        line: lineOf(entry.source, reference.path),
        pass: 3,
      });
    }
  }

  if (issues.length > 0) throw new ContentError(issues, root);

  // ── Pass 4 : global invariants, on fully validated data ───────────────
  const bundle = assemble(values, parsed, unvalidated, options.hash ?? '');

  checkFileNamedIds(parsed, add);
  checkCounts(values.get('manifest.json') as ManifestContent, bundle, present, add);
  checkMoveIds(bundle, add);
  checkUniqueIds(bundle, add);
  checkRegionForest(bundle, add);
  checkChampionIndexAgreement(bundle, add);

  if (issues.length > 0) throw new ContentError(issues, root);
  return bundle;
}

// ─────────────────────────────────────────────────────────────────────────
// Pass 3 and 4 helpers
// ─────────────────────────────────────────────────────────────────────────

type Add = (issue: ContentIssue) => void;

function indexRawIds(parsed: readonly ParsedFile[]): Readonly<Record<RefKind, readonly string[]>> {
  const idsOf = (prefix: string): string[] =>
    parsed
      .filter((entry) => directoryOf(entry.file) === prefix)
      .map((entry) => {
        const record = entry.source.value as Record<string, unknown> | null;
        const id = record?.['id'];
        return typeof id === 'string' ? id : basenameId(entry.file);
      });

  const listOf = (file: string, key: string): string[] => {
    const entry = parsed.find((candidate) => candidate.file === file);
    const record = entry?.source.value as Record<string, unknown> | undefined;
    const list = record?.[key];
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => (item as Record<string, unknown> | null)?.['id'])
      .filter((id): id is string => typeof id === 'string');
  };

  const oracleIds = idsOf('oracles');
  // Faction ids live INSIDE the region documents, so they are gathered rather
  // than listed: emptying `regions/` empties this set, and every `ref:faction`
  // in the bundle then fails. A hard-coded list would survive that and guard
  // nothing.
  const factionIds = new Set<string>();
  for (const entry of parsed) {
    if (directoryOf(entry.file) !== 'regions') continue;
    const record = entry.source.value as Record<string, unknown> | null;
    const factions = record?.['factions'];
    if (!Array.isArray(factions)) continue;
    for (const faction of factions) {
      const id = (faction as Record<string, unknown> | null)?.['id'];
      if (typeof id === 'string') factionIds.add(id);
    }
  }
  return {
    move: idsOf('moves'),
    // A sheet may name a champion who has no sheet: the INDEX is the table of
    // truth for names (section 4.7), so both sets resolve a `ref:champion`.
    champion: [...new Set([...idsOf('champions'), ...listOf('champions-index.json', 'champions')])],
    region: idsOf('regions'),
    oracle: oracleIds,
    asset: idsOf('assets'),
    condition: listOf('conditions.json', 'conditions'),
    table: [...oracleIds, 'pay-the-price', 'presages'],
    truth: parsed
      .filter((entry) => directoryOf(entry.file) === 'truths')
      .flatMap((entry) => listOf(entry.file, 'truths')),
    period: idsOf('periods'),
    front: idsOf('fronts'),
    node: idsOf('nodes'),
    figure: idsOf('figures'),
    hook: idsOf('hooks'),
    encounter: idsOf('encounters'),
    faction: [...factionIds],
  };
}

/**
 * Section 4.8 asks for a bundle FROZEN, recursively.
 *
 * `Object.freeze` alone is shallow, and `ReadonlyMap` is a TYPE, not a lock.
 * Measured on the previous version of this file: `Object.isFrozen(bundle)` was
 * true while `Object.isFrozen(bundle.moves)` was false,
 * `bundle.moves.set('invente-par-le-mj', …)` carried the size from 3 to 4, and
 * `bundle.moves.get('endure-cold').name = 'Nom réécrit à chaud'` took effect —
 * on the ONE bundle `staticContent()` memoises for the whole process. Any
 * caller could rewrite a rule of the game for every campaign at once. Both
 * halves are shut below.
 */
const deepFreeze = <T>(value: T, seen: WeakSet<object> = new WeakSet()): T => {
  if (value === null || typeof value !== 'object') return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  Object.freeze(object);
  for (const child of Object.values(object as Record<string, unknown>)) deepFreeze(child, seen);
  return value;
};

/**
 * A `Map` whose mutators have no working path. `Object.freeze` does not reach
 * a `Map`'s entries — they live in an internal slot — so the only way to make
 * one refuse a write at RUNTIME is to take the write away.
 *
 * The constructor fills the map through `super.set`, on purpose: the override
 * is unconditional, with no "sealed" flag anyone could turn back off.
 */
class FrozenMap<V> extends Map<string, V> {
  public constructor(entries: Iterable<readonly [string, V]>) {
    super();
    for (const [key, value] of entries) super.set(key, value);
    Object.freeze(this);
  }

  public override set(key: string): never {
    throw new TypeError(`contenu gelé : « ${key} » ne s’ajoute pas au bundle chargé`);
  }

  public override delete(key: string): never {
    throw new TypeError(`contenu gelé : « ${key} » ne se retire pas du bundle chargé`);
  }

  public override clear(): never {
    throw new TypeError('contenu gelé : le bundle chargé ne se vide pas');
  }
}

const mapOf = <T extends { id: string }>(values: readonly T[]): ReadonlyMap<string, T> =>
  new FrozenMap(values.map((value) => [value.id, deepFreeze(value)] as const));

function assemble(
  values: ReadonlyMap<string, unknown>,
  parsed: readonly ParsedFile[],
  unvalidated: readonly string[],
  hash: string,
): ContentBundle {
  const pick = <T>(prefix: string, except: readonly string[] = []): T[] =>
    parsed
      .filter((entry) => directoryOf(entry.file) === prefix && !except.includes(entry.file))
      .map((entry) => values.get(entry.file) as T);

  const manifest = values.get('manifest.json') as ManifestContent;
  const conditionsFile = values.get('conditions.json') as ConditionsFileContent;
  const championIndex = values.get('champions-index.json') as ChampionIndexFileContent;

  // `deepFreeze` on the bundle object would stop at each map — a `Map` has no
  // own enumerable entries to walk — so the documents are frozen in `mapOf`
  // and the three single documents here, one by one.
  return Object.freeze({
    version: manifest.version,
    hash,
    rulesVersion: manifest.rulesVersion,
    moves: mapOf(pick<MoveContent>('moves')),
    champions: mapOf(pick<ChampionContent>('champions')),
    championIndex: mapOf(championIndex.champions),
    regions: mapOf(pick<RegionContent>('regions')),
    oracles: mapOf(pick<OracleTableContent>('oracles', ['oracles/yes-no.json'])),
    yesNo: deepFreeze(values.get('oracles/yes-no.json') as YesNoOracleContent),
    priceTable: deepFreeze(values.get('tables/pay-the-price.json') as PriceTableContent),
    presages: deepFreeze(values.get('tables/presages.json') as PresageTableContent),
    assets: mapOf(pick<AssetContent>('assets')),
    conditions: mapOf(conditionsFile.conditions),
    truths: deepFreeze(pick<TruthsFileContent>('truths').flatMap((file) => file.truths)),
    periods: mapOf(pick<PeriodContent>('periods')),
    fronts: mapOf(pick<FrontContent>('fronts')),
    nodes: mapOf(pick<NodeContent>('nodes')),
    figures: mapOf(pick<FigureContent>('figures')),
    hooks: mapOf(pick<HookContent>('hooks')),
    encounters: mapOf(pick<EncounterContent>('encounters')),
    unvalidated: deepFreeze([...unvalidated]),
  });
}

/** Section 4.1: `id` equals the file name. A rename without a rename fails here. */
function checkFileNamedIds(parsed: readonly ParsedFile[], add: Add): void {
  for (const entry of parsed) {
    if (!HAS_FILE_NAMED_ID.has(directoryOf(entry.file))) continue;
    const record = entry.source.value as Record<string, unknown> | null;
    const id = record?.['id'];
    const expected = basenameId(entry.file);
    if (typeof id === 'string' && id !== expected) {
      add({
        file: entry.file,
        path: 'id',
        message: `l'id « ${id} » diffère du nom de fichier « ${expected} » : renommez l'un ou l'autre`,
        line: lineOf(entry.source, ['id']),
        pass: 4,
      });
    }
  }
}

/**
 * `expectedCounts` compared for EQUALITY.
 *
 * "Au moins" would let a manifest announcing 11 moves pass on a bundle of 3 —
 * the dropped-`COPY` bug the field exists to catch, upside down. This is also
 * where the champion THRESHOLD lives (P1): 3 in M0, 20 in V1, never a number
 * in the code.
 */
function checkCounts(
  manifest: ManifestContent,
  bundle: ContentBundle,
  present: readonly string[],
  add: Add,
): void {
  const actual: Readonly<Record<keyof ManifestContent['expectedCounts'], number>> = {
    moves: bundle.moves.size,
    champions: bundle.champions.size,
    regions: bundle.regions.size,
    // Section 4.7: "9 en V1 (dont yes-no)" — the weighted oracle counts.
    oracles: bundle.oracles.size + 1,
    tables: present.filter((file) => directoryOf(file) === 'tables').length,
    assets: bundle.assets.size,
    championIndex: bundle.championIndex.size,
    // ADR 0012. OPTIONAL in the schema, because S-01 ships the vocabulary and
    // S-03 the pieces; the second loop below is what stops that from becoming
    // a family nobody counts.
    periods: bundle.periods.size,
    fronts: bundle.fronts.size,
    nodes: bundle.nodes.size,
    figures: bundle.figures.size,
    hooks: bundle.hooks.size,
    encounters: bundle.encounters.size,
  };
  for (const [key, expected] of Object.entries(manifest.expectedCounts)) {
    if (expected === undefined) continue;
    const got = actual[key as keyof typeof actual];
    if (got !== expected) {
      add({
        file: 'manifest.json',
        path: `expectedCounts.${key}`,
        message: `le manifeste annonce ${String(expected)} ${key}, ${String(got)} chargé(s)`,
        pass: 4,
      });
    }
  }

  // A FAMILY THAT IS SHIPPED IS A FAMILY THAT IS COUNTED.
  //
  // The seven original counts are required by `ManifestSchema`, so this loop
  // only ever fires on the six optional ones. Without it, S-03 could add
  // twenty nodes, forget the manifest line, and lose nineteen of them to a
  // truncated `COPY` without a single command turning red — which is the exact
  // bug `expectedCounts` exists to catch (section 4.7).
  //
  // Walked, not pinned: emptying `actual` makes this loop check nothing, and
  // the test « toute famille chargée est comptée » is what notices.
  const declared = manifest.expectedCounts as Readonly<Record<string, number | undefined>>;
  for (const [key, got] of Object.entries(actual)) {
    if (got === 0 || declared[key] !== undefined) continue;
    add({
      file: 'manifest.json',
      path: `expectedCounts.${key}`,
      message:
        `${String(got)} ${key} chargé(s) et aucun compte annoncé : ajoutez ` +
        `« expectedCounts.${key} » au manifeste, sinon un fichier perdu ne se verrait pas`,
      pass: 4,
    });
  }
}

/**
 * Every move id belongs to the engine's closed `MOVE_IDS`.
 *
 * SECTION 4.8 WRITES "les 11 mouvements V1 présents", A NUMBER IN THE CODE.
 * That reading is false by construction against this task's own acceptance
 * criterion, which asks a THREE-move fixture bundle to exit 0 — and it
 * contradicts P1, which moved the champion threshold into the manifest for
 * exactly this reason. Reported in the PR; implemented as the pair that says
 * the same thing without a literal: every id is canonical, and the count is
 * the manifest's. At `expectedCounts.moves === 11` the two together force the
 * whole set, because the ids are unique and there are only eleven to pick.
 */
function checkMoveIds(bundle: ContentBundle, add: Add): void {
  const canonical = new Set<string>(zMoveId.options);
  for (const id of bundle.moves.keys()) {
    if (canonical.has(id)) continue;
    add({
      file: `moves/${id}.json`,
      path: 'id',
      message: `« ${id} » n'est pas un mouvement du moteur — MOVE_IDS : ${[...canonical].join(', ')}`,
      pass: 4,
    });
  }
}

function checkUniqueIds(bundle: ContentBundle, add: Add): void {
  const owners = new Map<string, string>();
  const claim = (kind: string, id: string): void => {
    const previous = owners.get(id);
    if (previous === undefined) {
      owners.set(id, kind);
      return;
    }
    add({
      file: 'manifest.json',
      path: '',
      message: `id « ${id} » partagé par deux types de contenu : ${previous} et ${kind}`,
      pass: 4,
    });
  };
  for (const id of bundle.moves.keys()) claim('mouvement', id);
  for (const id of bundle.champions.keys()) claim('champion', id);
  for (const id of bundle.regions.keys()) claim('région', id);
  for (const id of bundle.oracles.keys()) claim('oracle', id);
  for (const id of bundle.assets.keys()) claim('atout', id);
  for (const id of bundle.conditions.keys()) claim('condition', id);
  for (const truth of bundle.truths) claim('vérité', truth.id);
  for (const id of bundle.periods.keys()) claim('période', id);
  for (const id of bundle.fronts.keys()) claim('front', id);
  for (const id of bundle.nodes.keys()) claim('nœud', id);
  for (const id of bundle.figures.keys()) claim('figure', id);
  for (const id of bundle.hooks.keys()) claim('ressort', id);
  for (const id of bundle.encounters.keys()) claim('rencontre', id);
}

/** `regions.parentId` forms a FOREST: no cycle, no unknown parent. */
function checkRegionForest(bundle: ContentBundle, add: Add): void {
  for (const region of bundle.regions.values()) {
    const chain = [region.id];
    let cursor = region.parentId;
    while (cursor !== null) {
      if (chain.includes(cursor)) {
        add({
          file: `regions/${region.id}.json`,
          path: 'parentId',
          message: `référence circulaire entre régions : ${[...chain, cursor].join(' → ')}`,
          pass: 4,
        });
        break;
      }
      chain.push(cursor);
      const parent = bundle.regions.get(cursor);
      if (parent === undefined) break;
      cursor = parent.parentId;
    }
  }
}

/**
 * Section 4.8: same id, same alias set, same canonical region — plus the
 * DISPLAYED NAME.
 *
 * Section 4.8 names only the first three, and on that letter the previous
 * version was conformant: renaming the « Ashe » entry to « Quelqu un d autre »
 * in `champions-index.json` left `content:check` at 0. But section 4.7 makes
 * the directory the table of truth FOR NAMES, and the guard-rail this function
 * announces is « sheet and directory never diverge in silence ». On that one
 * field they did. Added, and declared in the PR as a proposed ADR.
 */
function checkChampionIndexAgreement(bundle: ContentBundle, add: Add): void {
  for (const champion of bundle.champions.values()) {
    const file = `champions/${champion.id}.json`;
    const entry = bundle.championIndex.get(champion.id);
    if (entry === undefined) {
      add({
        file,
        path: 'id',
        message: `aucune entrée « ${champion.id} » dans champions-index.json : le verrouillage de distribution et l'écran de choix divergeraient en silence`,
        pass: 4,
      });
      continue;
    }
    if (entry.displayName !== champion.name) {
      add({
        file,
        path: 'name',
        message: `nom « ${champion.name} » ≠ displayName « ${entry.displayName} » de champions-index.json : l'écran de choix et la fiche afficheraient deux noms`,
        pass: 4,
      });
    }
    const sheet = [...champion.aliases].sort().join(' · ');
    const index = [...entry.aliases].sort().join(' · ');
    if (sheet !== index) {
      add({
        file,
        path: 'aliases',
        message: `alias différents de champions-index.json — fiche : [${sheet}] · annuaire : [${index}]`,
        pass: 4,
      });
    }
    if (entry.canonicalRegionId !== champion.origin.regionId) {
      add({
        file,
        path: 'origin.regionId',
        message: `région « ${champion.origin.regionId} » ≠ canonicalRegionId « ${String(entry.canonicalRegionId)} » de champions-index.json`,
        pass: 4,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// UI labels — a mirror, and therefore compared member by member (ADR 0007)
// ─────────────────────────────────────────────────────────────────────────

/** The label files, and the closed engine list each one must cover EXACTLY. */
export const LABELLED_ENUMS = {
  attributes: zAttributeId.options,
  gauges: zGaugeId.options,
  outcomes: zOutcome.options,
} as const;

export type LabelFileName = keyof typeof LABELLED_ENUMS | 'ui';

export type LabelFile = Readonly<Record<string, string>>;

export interface LabelProblem {
  readonly file: string;
  readonly key: string;
  readonly message: string;
}

/**
 * Both directions, as ADR 0007 requires: a MISSING key and an INVENTED one.
 *
 * `satisfies` would catch neither — none of this is a type. The comparison is
 * a runtime walk of two lists, and it is the only thing that reddens the day
 * the engine gains a gauge whose French label nobody writes.
 *
 * `ui.json` has no closed source to mirror, so only emptiness is guaranteed
 * there. Said plainly rather than implied.
 */
export function validateLabels(name: LabelFileName, labels: LabelFile): readonly LabelProblem[] {
  const file = `data/labels/${name}.json`;
  const problems: LabelProblem[] = [];
  const keys = Object.keys(labels);

  if (keys.length === 0) {
    problems.push({ file, key: '', message: 'aucun libellé : un fichier vide ne dit rien' });
  }
  for (const [key, value] of Object.entries(labels)) {
    if (value.trim() === '') problems.push({ file, key, message: 'libellé vide' });
  }
  if (name === 'ui') return problems;

  const expected: readonly string[] = LABELLED_ENUMS[name];
  for (const key of expected) {
    if (!keys.includes(key)) {
      problems.push({ file, key, message: `libellé manquant : « ${key} » existe dans le moteur` });
    }
  }
  for (const key of keys) {
    if (!expected.includes(key)) {
      problems.push({
        file,
        key,
        message: `libellé en trop : « ${key} » n’existe pas dans le moteur`,
      });
    }
  }
  return problems;
}
