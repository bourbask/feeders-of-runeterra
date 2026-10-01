/**
 * The campaign fixture a case names, and the chronicle it shares.
 *
 * ── ONE GOLDEN CORPUS, TWO USES ─────────────────────────────────────────────
 * Section 8.2: « Les cas d'eval réutilisent les mêmes fixtures que les tests
 * de moteur : un seul corpus doré pour tout le projet. » So the chronicle
 * document lives ONCE, in `chronicle/`, and is read from there both by the
 * context builder — it is the `<chronique>` block of every request snapshot —
 * and by the chronicle N0 check of section 8.7. A second copy beside the
 * cases would be a copy nothing compares.
 *
 * ── THE CONTEXT WINDOW IS THE FIXTURE'S, NOT THE PROVIDER'S ─────────────────
 * `buildNarrateRequest` takes `contextWindowTokens`, and in production that
 * number comes from `capabilities.contextWindowTokens` of the port in use.
 * Reading it from a selected narrator HERE would make the request snapshot
 * depend on `NARRATOR_PROVIDER`, which the M0-27 acceptance criterion forbids
 * in as many words: « changer de NARRATOR_PROVIDER ne fait bouger aucun
 * `*.request.json` ». The fixture therefore fixes it, and
 * `request.test.ts` « la fenêtre de contexte vient de la fixture, pas d'un
 * fournisseur » reads the four provider identifiers out of the environment
 * one after the other and compares the bytes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CampaignBlockInput, ReservedChampion } from '@for/ai';
import { ChronicleDoc, type ChronicleDoc as ChronicleDocument } from '@for/contracts';

import { EvalCaseError } from './cases.js';

/** One person the merge may know about (`SceneMergeState.actors`). */
export interface EvalActor {
  readonly ref: { readonly kind: 'character' | 'entity'; readonly id: string };
  readonly name: string;
  readonly isPlayerCharacter: boolean;
  /** True only when the ENGINE killed them. S4 and `cible_morte` lean on it. */
  readonly isDead: boolean;
  readonly placeId: string | null;
}

export interface EvalChronicle {
  readonly doc: ChronicleDocument;
  /** C2: the sequences that exist. Built from a bound, never enumerated by hand. */
  readonly knownEventSeqMax: number;
  readonly targetEventSeq: number;
  /** D7: the facts a regeneration must never lose. */
  readonly goldenFactIds: readonly string[];
}

export interface EvalFixture {
  readonly id: string;
  readonly contextWindowTokens: number;
  readonly campaign: CampaignBlockInput;
  readonly reservedChampions: readonly ReservedChampion[];
  readonly actors: readonly EvalActor[];
  readonly placeIds: readonly string[];
  readonly seq: number;
  readonly etat: { readonly core: string; readonly inventoryAndIdleClocks: string };
  readonly lore: readonly string[];
  readonly turns: readonly string[];
  readonly chronicle: EvalChronicle;
}

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

const rows = (holder: Record<string, unknown>, key: string, where: string): unknown[] => {
  const value = holder[key];
  if (!Array.isArray(value)) {
    throw new EvalCaseError(`${where} : le champ « ${key} » doit être un tableau`);
  }
  return value;
};

const words = (holder: Record<string, unknown>, key: string, where: string): string[] =>
  rows(holder, key, where).map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new EvalCaseError(`${where}.${key}[${String(index)}] : chaîne attendue`);
    }
    return entry;
  });

export const FIXTURES_DIR = join(import.meta.dirname, '..', 'cases', 'fixtures');
export const CHRONICLE_DIR = join(import.meta.dirname, '..', 'chronicle');

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new EvalCaseError(
      `${path} : illisible (${cause instanceof Error ? cause.message : 'inconnu'})`,
    );
  }
}

/**
 * Read the chronicle fixture and parse it with the PRODUCTION schema.
 *
 * `ChronicleDoc.safeParse` rather than a hand-written check: this document is
 * the one the server validates at section 5.6, and a fixture that would not
 * pass `C1` is a fixture that proves nothing about `C2` … `C9`.
 *
 * THE GOLDEN FACTS LIVE IN A SECOND FILE, and that is the point: C6 compares
 * the document to that list, and two operands that share a file are one
 * operand compared to itself (ADR 0007). `<name>.golden.json` is written by
 * hand and names what a regeneration must never lose; deleting a fact from
 * `<name>.json` makes C6 fire.
 */
export function loadChronicle(name: string, dir: string = CHRONICLE_DIR): EvalChronicle {
  const where = `${name}.json`;
  const root = record(readJson(join(dir, where)), where);
  const parsed = ChronicleDoc.safeParse(root['doc']);
  if (!parsed.success) {
    throw new EvalCaseError(
      `${where} : la chronique ne passe pas ChronicleDoc — ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join(' ; ')}`,
    );
  }
  const goldenWhere = `${name}.golden.json`;
  const golden = record(readJson(join(dir, goldenWhere)), goldenWhere);
  const goldenFactIds = words(golden, 'fact_ids', goldenWhere);
  if (goldenFactIds.length === 0) {
    throw new EvalCaseError(
      `${goldenWhere} : aucun fait doré, le contrôle C6 n'aurait rien à tenir`,
    );
  }
  return {
    doc: parsed.data,
    knownEventSeqMax: whole(root, 'known_event_seq_max', where),
    targetEventSeq: whole(root, 'target_event_seq', where),
    goldenFactIds,
  };
}

export function loadFixture(
  name: string,
  dir: string = FIXTURES_DIR,
  chronicleDir: string = CHRONICLE_DIR,
): EvalFixture {
  const where = `${name}.json`;
  const root = record(readJson(join(dir, `${name}.json`)), where);
  const campaign = record(root['campaign'], `${where}.campaign`);
  const etat = record(root['etat'], `${where}.etat`);

  const characters = rows(campaign, 'characters', `${where}.campaign`).map((entry, index) => {
    const at = `${where}.campaign.characters[${String(index)}]`;
    const item = record(entry, at);
    return {
      id: text(item, 'id', at),
      name: text(item, 'name', at),
      championDisplayName: text(item, 'champion_display_name', at),
      pronouns: text(item, 'pronouns', at),
      oneLine: text(item, 'one_line', at),
    };
  });

  const reserved = rows(campaign, 'reserved_champions', `${where}.campaign`).map((entry, index) => {
    const at = `${where}.campaign.reserved_champions[${String(index)}]`;
    const item = record(entry, at);
    const aliases = words(item, 'aliases', at);
    if (aliases.length === 0) {
      throw new EvalCaseError(`${at} : aucun alias, le verrou n'aurait qu'une porte sur deux`);
    }
    return { id: text(item, 'id', at), displayName: text(item, 'display_name', at), aliases };
  });

  const npcs = rows(campaign, 'allowed_npcs', `${where}.campaign`).map((entry, index) => {
    const at = `${where}.campaign.allowed_npcs[${String(index)}]`;
    const item = record(entry, at);
    return {
      id: text(item, 'id', at),
      name: text(item, 'name', at),
      role: text(item, 'role', at),
      oneLine: text(item, 'one_line', at),
    };
  });

  const actors = rows(root, 'actors', where).map((entry, index) => {
    const at = `${where}.actors[${String(index)}]`;
    const item = record(entry, at);
    const ref = record(item['ref'], `${at}.ref`);
    const kind = text(ref, 'kind', `${at}.ref`);
    if (kind !== 'character' && kind !== 'entity') {
      throw new EvalCaseError(`${at}.ref.kind : character ou entity attendu`);
    }
    const refKind: 'character' | 'entity' = kind;
    return {
      ref: { kind: refKind, id: text(ref, 'id', `${at}.ref`) },
      name: text(item, 'name', at),
      isPlayerCharacter: flag(item, 'is_player_character', at),
      isDead: flag(item, 'is_dead', at),
      placeId: item['place_id'] === null ? null : text(item, 'place_id', at),
    };
  });

  return {
    id: text(root, 'id', where),
    contextWindowTokens: whole(root, 'context_window_tokens', where),
    campaign: {
      name: text(campaign, 'name', `${where}.campaign`),
      tone: text(campaign, 'tone', `${where}.campaign`),
      houseRules:
        campaign['house_rules'] === null
          ? null
          : text(campaign, 'house_rules', `${where}.campaign`),
      characters,
      reservedChampions: reserved,
      allowedNpcs: npcs,
    },
    reservedChampions: reserved.map((champion) => ({
      displayName: champion.displayName,
      aliases: champion.aliases,
    })),
    actors,
    placeIds: words(root, 'place_ids', where),
    seq: whole(root, 'seq', where),
    etat: {
      core: text(etat, 'core', `${where}.etat`),
      inventoryAndIdleClocks: text(etat, 'inventory_and_idle_clocks', `${where}.etat`),
    },
    lore: words(root, 'lore', where),
    turns: words(root, 'turns', where),
    chronicle: loadChronicle(text(root, 'chronicle', where), chronicleDir),
  };
}

/** Memoised loader: twelve cases share one fixture, and the bytes must match. */
export function fixtureLoader(
  dir: string = FIXTURES_DIR,
  chronicleDir: string = CHRONICLE_DIR,
): (name: string) => EvalFixture {
  const cache = new Map<string, EvalFixture>();
  return (name) => {
    const hit = cache.get(name);
    if (hit !== undefined) return hit;
    const loaded = loadFixture(name, dir, chronicleDir);
    cache.set(name, loaded);
    return loaded;
  };
}
