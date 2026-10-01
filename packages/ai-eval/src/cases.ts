/**
 * The N0 corpus, read from `cases/` AT RUN TIME (02-mj-ia.md section 8.2).
 *
 * ── THE DIRECTORY IS WALKED, NEVER LISTED ───────────────────────────────────
 * A hard-coded list of imports is its own loop source: emptying `cases/` would
 * leave the run green over nothing. Reading the directory makes the fixture
 * the source, and `runOffline` refuses to run under `CASES_MIN`. Two files,
 * two tests: `cases.test.ts` « rend un tableau vide sur un répertoire vide »
 * and `run-offline.test.ts` « refuse de tourner sous le plancher de cas ».
 *
 * ── WHAT `expect.assertions` IS, AND WHAT IT IS NOT ─────────────────────────
 * It is NOT the list of checks that run. Section 8.5 is explicit: the recorded
 * outputs « repassent dans toute la batterie d'assertions », and this harness
 * runs `ASSERTIONS` in full on every sample of every case. The list in a case
 * supplies the PARAMETERS a case may override — `sentence_count`'s bounds,
 * `max_chars`'s ceiling, `mentions_any`'s values, `tool_calls`'s allow-list,
 * `no_pc_agency`'s names — and nothing else. An identifier that is not an
 * `ASSERTIONS` key is a load error rather than a line nobody reads: held by
 * `cases.test.ts` « refuse un identifiant d'assertion inconnu ».
 *
 * ── THE SHAPES THAT CROSS A SCHEMA, CROSS THE PRODUCTION ONE ────────────────
 * `turn.scene_in` is parsed by `zSceneState`, the schema the server uses. A
 * second hand-written validator for the same shape is how a fixture and the
 * product start disagreeing. The rest — identifiers, titles, expectations —
 * is checked by hand, because pulling `zod` into this package's runtime
 * dependencies for a dozen lines would widen the dependency graph of the one
 * package that is supposed to consume and not host.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ASSERTIONS } from '@for/ai';
import {
  SCENE_REFUSAL_CAUSES,
  zMoveId,
  zOutcome,
  zSceneState,
  type SceneStateDto,
} from '@for/contracts';

/** Section 8.2 asks for ten. The floor is here so that deleting one is loud. */
export const CASES_MIN = 10;

/** Raised on a malformed corpus; the runners turn it into one line and exit 1. */
export class EvalCaseError extends Error {}

/** The arithmetic of the action roll, as the brief carries it. */
export interface EvalRoll {
  readonly rollId: string;
  readonly actionDie: number;
  readonly attributeValue: number;
  readonly adds: readonly { readonly source: string; readonly value: number }[];
  readonly rawTotal: number;
  readonly total: number;
  readonly cappedAtTen: boolean;
  readonly challengeDice: readonly [number, number];
  readonly momentumNegated: boolean;
  readonly burned: boolean;
}

/**
 * A price the engine ALREADY rolled and applied (ADR 0006).
 *
 * `keywords` comes from the content table's entry and is what
 * `price_respected` scores against. Without it that hard assertion has
 * nothing to compare, which section 8.4 says in as many words.
 */
export interface EvalPrice {
  readonly rollId: string;
  readonly tableId: string;
  readonly value: number;
  readonly entryId: string;
  readonly text: string;
  readonly severity: string;
  readonly effectIndex: number;
  readonly keywords: readonly string[];
}

export interface EvalPresage {
  readonly tableId: string;
  readonly value: number;
  readonly entryId: string;
  readonly text: string;
}

export interface EvalFact {
  readonly moveId: string | null;
  readonly moveLabel: string | null;
  readonly attribute: string | null;
  readonly attributeLabel: string | null;
  readonly outcome: string | null;
  readonly outcomeLabel: string | null;
  readonly isPresage: boolean;
  readonly roll: EvalRoll | null;
  /**
   * The already-applied consequences, one French sentence each.
   *
   * The brief's `appliedEffects` stays EMPTY in this corpus and that is said
   * out loud: `buildFactBlock` renders `vocabulary.effectSentences` and never
   * reads `appliedEffects`, so filling the latter would put bytes in a fixture
   * that no rendered prompt contains — a fixture nobody can falsify.
   */
  readonly effectSentences: readonly string[];
  readonly price: EvalPrice | null;
  readonly presage: EvalPresage | null;
  /** True when the `<fait>` itself carries a time skip, for `no_time_skip`. */
  readonly hasTimeSkip: boolean;
  readonly eventSeqs: readonly number[];
  readonly fallbackTemplateId: string;
}

export interface EvalTurn {
  readonly intent: string;
  readonly actorCharacterId: string;
  readonly actorLabel: string;
  readonly correlationId: string;
  /** The scene BEFORE the turn: rendered in `<scene>`, and the merge's base. */
  readonly sceneIn: SceneStateDto;
  readonly fact: EvalFact;
  /** What the acting character carries, for R3 and `objet_inexistant`. */
  readonly actorInventory: readonly string[];
  readonly actorAssets: readonly string[];
  /** R7: upheld refusals over the last twenty turns of this campaign. */
  readonly upheldRefusalsInWindow: number;
}

/** What a case expects of the refusal proof. `none` means: no upheld refusal. */
export interface EvalRefusalExpectation {
  readonly verdict: 'upheld' | 'rejected' | 'none';
  readonly cause: string | null;
  readonly target: string | null;
  /** Expected rejection reason (R1→R7), when `verdict` is `rejected`. */
  readonly reason: string | null;
}

export interface EvalSceneOut {
  readonly mustStayAbsent: readonly string[];
  readonly mustStayPresent: readonly string[];
}

/** Per-case overrides. Keyed by assertion identifier, validated on load. */
export interface EvalParams {
  readonly sentenceMin?: number;
  readonly sentenceMax?: number;
  readonly maxChars?: number;
  readonly mentionsAny?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly toolCallsMax?: number;
  readonly playerCharacterNames?: readonly string[];
}

export interface EvalCase {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly fixture: string;
  readonly turn: EvalTurn;
  /** The identifiers the case parameterises, in file order. */
  readonly parameterised: readonly string[];
  readonly params: EvalParams;
  readonly sceneOut: EvalSceneOut | null;
  readonly refusal: EvalRefusalExpectation | null;
}

// --------------------------------------------------------------- validation

const record = (value: unknown, where: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EvalCaseError(`${where} : un objet est attendu`);
  }
  return value as Record<string, unknown>;
};

const text = (holder: Record<string, unknown>, key: string, where: string): string => {
  const value = holder[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new EvalCaseError(`${where} : le champ « ${key} » doit être une chaîne non vide`);
  }
  return value;
};

const maybeText = (holder: Record<string, unknown>, key: string, where: string): string | null => {
  const value = holder[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new EvalCaseError(`${where} : le champ « ${key} » doit être une chaîne ou null`);
  }
  return value;
};

const whole = (holder: Record<string, unknown>, key: string, where: string): number => {
  const value = holder[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new EvalCaseError(`${where} : le champ « ${key} » doit être un entier`);
  }
  return value;
};

const flag = (holder: Record<string, unknown>, key: string, where: string): boolean => {
  const value = holder[key];
  if (typeof value !== 'boolean') {
    throw new EvalCaseError(`${where} : le champ « ${key} » doit être un booléen`);
  }
  return value;
};

const list = (holder: Record<string, unknown>, key: string, where: string): unknown[] => {
  const value = holder[key];
  if (!Array.isArray(value)) {
    throw new EvalCaseError(`${where} : le champ « ${key} » doit être un tableau`);
  }
  return value;
};

const words = (holder: Record<string, unknown>, key: string, where: string): string[] =>
  list(holder, key, where).map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new EvalCaseError(`${where}.${key}[${String(index)}] : chaîne non vide attendue`);
    }
    return entry;
  });

const numbers = (holder: Record<string, unknown>, key: string, where: string): number[] =>
  list(holder, key, where).map((entry, index) => {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) {
      throw new EvalCaseError(`${where}.${key}[${String(index)}] : entier attendu`);
    }
    return entry;
  });

function parseRoll(raw: unknown, where: string): EvalRoll | null {
  if (raw === null || raw === undefined) return null;
  const root = record(raw, where);
  const dice = numbers(root, 'challenge_dice', where);
  if (dice.length !== 2) throw new EvalCaseError(`${where}.challenge_dice : deux dés attendus`);
  const [first, second] = dice as [number, number];
  return {
    rollId: text(root, 'roll_id', where),
    actionDie: whole(root, 'action_die', where),
    attributeValue: whole(root, 'attribute_value', where),
    adds: list(root, 'adds', where).map((entry, index) => {
      const add = record(entry, `${where}.adds[${String(index)}]`);
      return {
        source: text(add, 'source', `${where}.adds[${String(index)}]`),
        value: whole(add, 'value', `${where}.adds[${String(index)}]`),
      };
    }),
    rawTotal: whole(root, 'raw_total', where),
    total: whole(root, 'total', where),
    cappedAtTen: flag(root, 'capped_at_ten', where),
    challengeDice: [first, second],
    momentumNegated: flag(root, 'momentum_negated', where),
    burned: flag(root, 'burned', where),
  };
}

function parsePrice(raw: unknown, where: string): EvalPrice | null {
  if (raw === null || raw === undefined) return null;
  const root = record(raw, where);
  const keywords = words(root, 'keywords', where);
  if (keywords.length === 0) {
    throw new EvalCaseError(`${where}.keywords : vide, « price_respected » n'aurait rien à noter`);
  }
  return {
    rollId: text(root, 'roll_id', where),
    tableId: text(root, 'table_id', where),
    value: whole(root, 'value', where),
    entryId: text(root, 'entry_id', where),
    text: text(root, 'text', where),
    severity: text(root, 'severity', where),
    effectIndex: whole(root, 'effect_index', where),
    keywords,
  };
}

function parsePresage(raw: unknown, where: string): EvalPresage | null {
  if (raw === null || raw === undefined) return null;
  const root = record(raw, where);
  return {
    tableId: text(root, 'table_id', where),
    value: whole(root, 'value', where),
    entryId: text(root, 'entry_id', where),
    text: text(root, 'text', where),
  };
}

/**
 * The two enums are read from the CONTRACTS, never recopied.
 *
 * `zMoveId.options` and `zOutcome.options` are the mirrors `@for/contracts`
 * compares to the engine's tuples member by member. A list written out here
 * would be a third copy nothing compares (ADR 0007).
 */
const MOVE_VALUES: readonly string[] = zMoveId.options;
const OUTCOME_VALUES: readonly string[] = zOutcome.options;

function parseFact(raw: unknown, where: string): EvalFact {
  const root = record(raw, where);
  const outcome = maybeText(root, 'outcome', where);
  if (outcome !== null && !OUTCOME_VALUES.includes(outcome)) {
    throw new EvalCaseError(`${where}.outcome : « ${outcome} » n'est pas une issue du moteur`);
  }
  const moveId = maybeText(root, 'move', where);
  if (moveId !== null && !MOVE_VALUES.includes(moveId)) {
    throw new EvalCaseError(`${where}.move : « ${moveId} » n'est pas un mouvement du moteur`);
  }
  return {
    moveId,
    moveLabel: maybeText(root, 'move_label', where),
    attribute: maybeText(root, 'attribute', where),
    attributeLabel: maybeText(root, 'attribute_label', where),
    outcome,
    outcomeLabel: maybeText(root, 'outcome_label', where),
    isPresage: flag(root, 'presage', where),
    roll: parseRoll(root['roll'], `${where}.roll`),
    effectSentences: words(root, 'effect_sentences', where),
    price: parsePrice(root['price'], `${where}.price`),
    presage: parsePresage(root['presage_entry'], `${where}.presage_entry`),
    hasTimeSkip: flag(root, 'time_skip', where),
    eventSeqs: numbers(root, 'event_seqs', where),
    fallbackTemplateId: text(root, 'fallback_template_id', where),
  };
}

/**
 * The parameter entries, mapped onto the fields the assertions actually read.
 *
 * The identifier is checked against `ASSERTIONS` — imported from `@for/ai`,
 * never copied — so a renamed assertion breaks the corpus loudly instead of
 * leaving a dead line in a JSON file.
 */
function parseParams(raw: unknown, where: string): { ids: string[]; params: EvalParams } {
  const entries = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) throw new EvalCaseError(`${where} : un tableau est attendu`);
  const ids: string[] = [];
  let params: EvalParams = {};
  for (const [index, entry] of entries.entries()) {
    const at = `${where}[${String(index)}]`;
    const item = record(entry, at);
    const id = text(item, 'id', at);
    if (!(id in ASSERTIONS)) {
      throw new EvalCaseError(`${at} : « ${id} » n'est pas une assertion de @for/ai`);
    }
    if (ids.includes(id)) throw new EvalCaseError(`${at} : « ${id} » est listé deux fois`);
    ids.push(id);
    switch (id) {
      case 'sentence_count':
        params = {
          ...params,
          sentenceMin: whole(item, 'min', at),
          sentenceMax: whole(item, 'max', at),
        };
        break;
      case 'max_chars':
        params = { ...params, maxChars: whole(item, 'value', at) };
        break;
      case 'mentions_any':
        params = { ...params, mentionsAny: words(item, 'values', at) };
        break;
      case 'tool_calls':
        params = {
          ...params,
          allowedTools: words(item, 'allowed', at),
          toolCallsMax: whole(item, 'max', at),
        };
        break;
      case 'no_pc_agency':
        params = { ...params, playerCharacterNames: words(item, 'pc_names', at) };
        break;
      default:
        break;
    }
  }
  return { ids, params };
}

function parseRefusal(raw: unknown, where: string): EvalRefusalExpectation | null {
  if (raw === null || raw === undefined) return null;
  const root = record(raw, where);
  const verdict = text(root, 'verdict', where);
  if (verdict !== 'upheld' && verdict !== 'rejected' && verdict !== 'none') {
    throw new EvalCaseError(`${where}.verdict : upheld, rejected ou none attendu`);
  }
  const cause = maybeText(root, 'cause', where);
  if (cause !== null && !(SCENE_REFUSAL_CAUSES as readonly string[]).includes(cause)) {
    throw new EvalCaseError(`${where}.cause : « ${cause} » n'est pas une cause de refus`);
  }
  return {
    verdict,
    cause,
    target: maybeText(root, 'target', where),
    reason: maybeText(root, 'reason', where),
  };
}

function parseSceneOut(raw: unknown, where: string): EvalSceneOut | null {
  if (raw === null || raw === undefined) return null;
  const root = record(raw, where);
  return {
    mustStayAbsent: words(root, 'must_stay_absent', where),
    mustStayPresent: words(root, 'must_stay_present', where),
  };
}

function parseCase(raw: unknown, where: string): EvalCase {
  const root = record(raw, where);
  const turn = record(root['turn'], `${where}.turn`);
  const expect = record(root['expect'], `${where}.expect`);
  const scene = zSceneState.safeParse(turn['scene_in']);
  if (!scene.success) {
    throw new EvalCaseError(
      `${where}.turn.scene_in : ${scene.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join(' ; ')}`,
    );
  }
  const { ids, params } = parseParams(expect['assertions'], `${where}.expect.assertions`);
  return {
    id: text(root, 'id', where),
    title: text(root, 'title', where),
    tags: words(root, 'tags', where),
    fixture: text(root, 'fixture', where),
    turn: {
      intent: text(turn, 'intent', `${where}.turn`),
      actorCharacterId: text(turn, 'actor_character_id', `${where}.turn`),
      actorLabel: text(turn, 'actor_label', `${where}.turn`),
      correlationId: text(turn, 'correlation_id', `${where}.turn`),
      sceneIn: scene.data,
      fact: parseFact(turn['fact'], `${where}.turn.fact`),
      actorInventory: words(turn, 'actor_inventory', `${where}.turn`),
      actorAssets: words(turn, 'actor_assets', `${where}.turn`),
      upheldRefusalsInWindow: whole(turn, 'upheld_refusals_in_window', `${where}.turn`),
    },
    parameterised: ids,
    params,
    sceneOut: parseSceneOut(expect['scene_out'], `${where}.expect.scene_out`),
    refusal: parseRefusal(expect['refusal'], `${where}.expect.refusal`),
  };
}

// ------------------------------------------------------------------ loading

/** Where the corpus lives, resolved from this file rather than from the cwd. */
export const CASES_DIR = join(import.meta.dirname, '..', 'cases');

/**
 * Lists the raw entries of a directory.
 *
 * Injected ONLY so the sort below can be proved, and declared with the single
 * parameter `loadCases` actually passes — a double with fewer parameters than
 * the real function compiles without a word, and the argument it drops stops
 * existing for the whole suite (`docs/RECETTE.md`, mode 8).
 */
export type DirLister = (dir: string) => readonly string[];

const listDir: DirLister = (dir) => readdirSync(dir);

/**
 * Read every `*.case.json` of `dir`, sorted by file name.
 *
 * THE SORT IS NOT PROVABLE AGAINST THE REAL FILE SYSTEM: on ext4 `readdirSync`
 * already returns the names in order, so a test that writes `02-` before `01-`
 * and reads the directory back stays green with the sort removed. Hence
 * `lister`, which hands in the reversed listing the file system refuses to
 * produce. Held by `cases.test.ts` « trie par nom de fichier, même quand le
 * répertoire les rend à l'envers ».
 */
export function loadCases(
  dir: string = CASES_DIR,
  lister: DirLister = listDir,
): readonly EvalCase[] {
  let names: string[];
  try {
    names = [...lister(dir)].filter((name) => name.endsWith('.case.json'));
  } catch {
    throw new EvalCaseError(`répertoire de cas introuvable : ${dir}`);
  }
  names.sort();
  const cases = names.map((name) => {
    const path = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (cause) {
      throw new EvalCaseError(
        `${name} : JSON illisible (${cause instanceof Error ? cause.message : 'inconnu'})`,
      );
    }
    return parseCase(parsed, name);
  });
  const seen = new Set<string>();
  for (const one of cases) {
    if (seen.has(one.id)) throw new EvalCaseError(`identifiant de cas en double : ${one.id}`);
    seen.add(one.id);
  }
  return cases;
}
