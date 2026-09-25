/**
 * The three smoke cases, read from `cases/` AT RUN TIME (M0-32).
 *
 * WHY THE DIRECTORY IS WALKED AND NOT A LIST OF IMPORTS. A hard-coded list of
 * three imports is its own loop source: emptying `cases/` would leave the run
 * green on nothing at all. Reading the directory makes the fixture the source,
 * and `runSmoke` refuses to run on zero cases. Two files, two tests:
 * `cases.test.ts` « rend un tableau vide sur un répertoire vide — c'est
 * runSmoke qui refuse » on an emptied temporary directory, and
 * `run-smoke.test.ts` « refuse de tourner sur zéro cas » for the refusal
 * itself. The refusal is NOT in `cases.test.ts`.
 *
 * WHY THE SHAPE IS CHECKED BY HAND. This package depends on `@for/ai` and
 * `@for/contracts` and on nothing else (M0-32's file list). Pulling `zod` in
 * for three fixtures we write ourselves would add a runtime dependency to the
 * package for a check a dozen lines do. The one schema that DOES cross a trust
 * boundary here — the model's `<scene_apres>` block — is validated by
 * `SceneBlockSchema`, the production one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One person the engine holds as present in, or gone from, the scene. */
export interface SmokeSceneEntry {
  readonly name: string;
  readonly detail: string;
}

export interface SmokeSceneIn {
  readonly place: string;
  readonly time: string;
  readonly present: readonly SmokeSceneEntry[];
  readonly absent: readonly SmokeSceneEntry[];
}

/**
 * A champion played by somebody else at this table. Name AND nicknames: the
 * nicknames are the half a prompt rule alone never covers, and the reason the
 * fixture carries them rather than deriving them from `@for/content`.
 */
export interface SmokeLockedChampion {
  readonly name: string;
  readonly aliases: readonly string[];
}

export interface SmokeCase {
  readonly id: string;
  readonly title: string;
  readonly actor: string;
  /** True when the turn carries a price the engine already rolled and applied. */
  readonly imposedPrice: boolean;
  /** Body of the `<fait>` block, verbatim. */
  readonly fact: string;
  /** Body of the `<intention>` block, verbatim. */
  readonly intent: string;
  readonly sceneIn: SmokeSceneIn;
  readonly lockedChampions: readonly SmokeLockedChampion[];
}

/** Raised on a malformed fixture; `run-smoke.ts` turns it into one line and exit 1. */
export class SmokeCaseError extends Error {}

const record = (value: unknown, where: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SmokeCaseError(`${where} : un objet est attendu`);
  }
  return value as Record<string, unknown>;
};

const text = (holder: Record<string, unknown>, key: string, where: string): string => {
  const value = holder[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new SmokeCaseError(`${where} : le champ « ${key} » doit être une chaîne non vide`);
  }
  return value;
};

const flag = (holder: Record<string, unknown>, key: string, where: string): boolean => {
  const value = holder[key];
  if (typeof value !== 'boolean') {
    throw new SmokeCaseError(`${where} : le champ « ${key} » doit être un booléen`);
  }
  return value;
};

const array = (holder: Record<string, unknown>, key: string, where: string): unknown[] => {
  const value = holder[key];
  if (!Array.isArray(value)) {
    throw new SmokeCaseError(`${where} : le champ « ${key} » doit être un tableau`);
  }
  return value;
};

function entries(holder: Record<string, unknown>, key: string, where: string): SmokeSceneEntry[] {
  return array(holder, key, where).map((raw, index) => {
    const item = record(raw, `${where}.${key}[${String(index)}]`);
    return {
      name: text(item, 'name', `${where}.${key}[${String(index)}]`),
      detail: text(item, 'detail', `${where}.${key}[${String(index)}]`),
    };
  });
}

function parseCase(raw: unknown, where: string): SmokeCase {
  const root = record(raw, where);
  const scene = record(root['scene_in'], `${where}.scene_in`);
  const locked = array(root, 'locked_champions', where).map((entry, index) => {
    const item = record(entry, `${where}.locked_champions[${String(index)}]`);
    const aliases = array(item, 'aliases', `${where}.locked_champions[${String(index)}]`).map(
      (alias, aliasIndex) => {
        if (typeof alias !== 'string' || alias.length === 0) {
          throw new SmokeCaseError(
            `${where}.locked_champions[${String(index)}].aliases[${String(aliasIndex)}] : chaîne non vide attendue`,
          );
        }
        return alias;
      },
    );
    return {
      name: text(item, 'name', `${where}.locked_champions[${String(index)}]`),
      aliases,
    };
  });
  if (locked.length === 0) {
    throw new SmokeCaseError(`${where} : « locked_champions » ne peut pas être vide`);
  }
  return {
    id: text(root, 'id', where),
    title: text(root, 'title', where),
    actor: text(root, 'actor', where),
    imposedPrice: flag(root, 'imposed_price', where),
    fact: text(root, 'fact', where),
    intent: text(root, 'intent', where),
    sceneIn: {
      place: text(scene, 'place', `${where}.scene_in`),
      time: text(scene, 'time', `${where}.scene_in`),
      present: entries(scene, 'present', `${where}.scene_in`),
      absent: entries(scene, 'absent', `${where}.scene_in`),
    },
    lockedChampions: locked,
  };
}

/** Where the fixtures live, resolved from this file rather than from the cwd. */
export const SMOKE_CASES_DIR = join(import.meta.dirname, 'cases');

/**
 * Lists the raw entries of a directory. Injected ONLY so the sort below can be
 * proved, and typed with the single parameter `loadCases` actually passes, so
 * that a double cannot be laxer than the call site (mode 8 of `docs/RECETTE.md`).
 */
export type SmokeDirLister = (dir: string) => readonly string[];

const listDir: SmokeDirLister = (dir) => readdirSync(dir);

/**
 * Read every `*.case.json` of `dir`, sorted by file name so two runs give the
 * same order — and therefore the same verdict, character for character.
 *
 * THE SORT IS NOT PROVABLE AGAINST THE REAL FILE SYSTEM. On ext4 `readdirSync`
 * already hands back the names in order, so writing `02-` before `01-` and
 * reading the directory back proves nothing: removing `names.sort()` leaves
 * that test green. Hence `lister`, which lets a test hand in the reversed
 * listing the file system refuses to produce. Held by `cases.test.ts`
 * « trie par nom de fichier, même quand le répertoire les rend à l'envers ».
 */
export function loadCases(
  dir: string = SMOKE_CASES_DIR,
  lister: SmokeDirLister = listDir,
): readonly SmokeCase[] {
  let names: string[];
  try {
    names = lister(dir).filter((name) => name.endsWith('.case.json'));
  } catch {
    throw new SmokeCaseError(`répertoire de cas introuvable : ${dir}`);
  }
  names.sort();
  return names.map((name) => {
    const path = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (cause) {
      throw new SmokeCaseError(
        `${name} : JSON illisible (${cause instanceof Error ? cause.message : 'inconnu'})`,
      );
    }
    return parseCase(parsed, name);
  });
}
