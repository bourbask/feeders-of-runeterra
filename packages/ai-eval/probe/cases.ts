/**
 * The probe corpus, read from `cases/` AT RUN TIME (M0-31).
 *
 * ── WHAT A CASE IS, AND WHAT IT IS NOT ──────────────────────────────────────
 * A case is one TURN as the server would hand it to the storyteller: a
 * `NarrationBrief`, the campaign block's data, the French words of the turn,
 * and everything the truncation ladder may cut. It is NOT a prompt: the prompt
 * is built by `buildNarrateRequest` of `@for/ai`, the production builder, and
 * this file never assembles a string the model will read.
 *
 * ── THE BRIEF IS PARSED BY THE PRODUCTION SCHEMA ────────────────────────────
 * `zNarrationBrief.parse`, not a hand-written shape check. A fixture that
 * drifts from the contract is then a loud failure here rather than a silent
 * divergence between what the probe measures and what the server sends. Held
 * by `cases.test.ts` « un brief hors contrat tombe à la lecture ».
 *
 * ── TWO FIELDS ARE RESOLVED FROM THE CONTENT, NOT FROM THE FIXTURE ──────────
 * The imposed price's text and keywords, and the reserved champions' display
 * names and aliases. Production reads both from the versioned content
 * (`turn.ts` for the price entry, `lockout.ts` for the index), and a fixture
 * that recopied them would score the model against a copy that can drift from
 * the bundle the server actually ships. The fixture names an IDENTIFIER; the
 * bundle answers with the words. Held by `cases.test.ts` « le prix vient du
 * bundle, pas du fichier de cas » and « les alias viennent de l'index des
 * champions ».
 *
 * ── WHY THE DIRECTORY IS WALKED ─────────────────────────────────────────────
 * Same reason as the smoke probe: a hard-coded list of imports is its own
 * source of truth, and emptying `cases/` would leave the run green on nothing.
 * `run-probe.ts` refuses to run under the sheet's floor of six.
 */

import { staticBundle, staticContent } from '@for/content';
import { zNarrationBrief, type NarrationBriefDto } from '@for/contracts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  CampaignBlockInput,
  ChronicleParts,
  FactVocabulary,
  ReservedChampion,
  TrimmableContext,
} from '@for/ai';

/** Raised on a malformed fixture; `run-probe.ts` turns it into one line and exit 1. */
export class ProbeCaseError extends Error {}

/**
 * The server-side scene, as the projection holds it.
 *
 * SEPARATE FROM THE BRIEF, and that separation is the point. `turn.ts` builds
 * the grading context from `sceneBefore(state)` — the WHOLE scene — while the
 * `<scene>` block of the prompt comes from `brief.perceivableFacts` alone
 * (ADR 0008 decision 3). Merging the two here would make
 * `no_absent_reappearance` unable to express the M1 case where somebody is in
 * the scene and out of the brief.
 */
export interface ProbeSceneState {
  readonly presentNames: readonly string[];
  readonly absentNames: readonly string[];
}

export interface ProbeCase {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  /** The acting character's name, as the projection holds it. */
  readonly actorLabel: string;
  /** Every player character's display name, for `no_pc_agency`. */
  readonly playerCharacterNames: readonly string[];
  /** Champion identifiers reserved by the OTHER players of this table. */
  readonly reservedChampionIds: readonly string[];
  /** Values for `mentions_any` — soft, carried so the report can say so. */
  readonly mentionsAny: readonly string[];
  readonly scene: ProbeSceneState;
  readonly campaign: CampaignBlockInput;
  readonly vocabulary: FactVocabulary;
  readonly trimmable: TrimmableContext;
  readonly brief: NarrationBriefDto;
  /** Resolved from the bundle: `null` when the turn imposes no price. */
  readonly priceKeywords: readonly string[] | null;
  /** Resolved from `champions-index.json`, exactly as `lockout.ts` does. */
  readonly reservedChampions: readonly ReservedChampion[];
}

// ------------------------------------------------------------- shape checks

const record = (value: unknown, where: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProbeCaseError(`${where} : un objet est attendu`);
  }
  return value as Record<string, unknown>;
};

const text = (holder: Record<string, unknown>, key: string, where: string): string => {
  const value = holder[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProbeCaseError(`${where} : le champ « ${key} » doit être une chaîne non vide`);
  }
  return value;
};

/** Like `text`, but an empty string is a legitimate value (a chronicle seam). */
const looseText = (holder: Record<string, unknown>, key: string, where: string): string => {
  const value = holder[key];
  if (typeof value !== 'string') {
    throw new ProbeCaseError(`${where} : le champ « ${key} » doit être une chaîne`);
  }
  return value;
};

const list = (holder: Record<string, unknown>, key: string, where: string): unknown[] => {
  const value = holder[key];
  if (!Array.isArray(value)) {
    throw new ProbeCaseError(`${where} : le champ « ${key} » doit être un tableau`);
  }
  return value;
};

const texts = (holder: Record<string, unknown>, key: string, where: string): readonly string[] =>
  list(holder, key, where).map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new ProbeCaseError(`${where}.${key}[${String(index)}] : chaîne attendue`);
    }
    return entry;
  });

const CHRONICLE_SEAMS = [
  'premise',
  'openArcs',
  'otherArcs',
  'characters',
  'sceneNpcs',
  'otherNpcs',
  'places',
  'sceneFacts',
  'otherFacts',
  'openThreads',
  'recentDigest',
] as const;

function chronicle(holder: Record<string, unknown>, where: string): ChronicleParts {
  const parts: Record<string, string> = {};
  for (const seam of CHRONICLE_SEAMS) parts[seam] = looseText(holder, seam, where);
  return parts as unknown as ChronicleParts;
}

// ------------------------------------------------------------ the resolution

/**
 * The names a reserved champion answers to, read from the content index.
 *
 * The fallback — identifier as sole name, empty aliases — is `lockout.ts`'s
 * own, deliberately: a champion the index does not know is a HOLE IN THE LOCK,
 * and the probe must report what production would do rather than refuse to
 * measure.
 */
export function resolveReserved(ids: readonly string[]): readonly ReservedChampion[] {
  const index = staticContent().listChampionIndex();
  return ids.map((id) => {
    const entry = index.find((row) => row.id === id);
    return entry === undefined
      ? { displayName: id, aliases: [] }
      : { displayName: entry.displayName, aliases: entry.aliases };
  });
}

/** The price entry of the versioned content, by identifier. `turn.ts`'s lookup. */
export function resolvePriceEntry(entryId: string): {
  readonly text: string;
  readonly severity: string;
  readonly keywords: readonly string[];
} {
  const entry = staticBundle().priceTable.entries.find((row) => row.id === entryId);
  if (entry === undefined) {
    throw new ProbeCaseError(
      `entrée de prix « ${entryId} » absente de content/tables/pay-the-price.json`,
    );
  }
  return { text: entry.text, severity: entry.severity, keywords: entry.keywords };
}

// ------------------------------------------------------------- one case file

function parseCase(raw: unknown, where: string): ProbeCase {
  const root = record(raw, where);
  const sceneRaw = record(root['scene'], `${where}.scene`);
  const campaignRaw = record(root['campaign'], `${where}.campaign`);
  const vocabularyRaw = record(root['vocabulary'], `${where}.vocabulary`);
  const contextRaw = record(root['context'], `${where}.context`);
  const etatRaw = record(contextRaw['etat'], `${where}.context.etat`);
  const briefRaw = record(root['brief'], `${where}.brief`);

  const priceEntryId = root['imposed_price_entry_id'];
  if (priceEntryId !== null && typeof priceEntryId !== 'string') {
    throw new ProbeCaseError(`${where} : « imposed_price_entry_id » doit être une chaîne ou null`);
  }

  /**
   * The price is COMPOSED here, from the bundle, and never read from the
   * fixture. `rollId`, `value` and `effectIndex` are the engine's draws and
   * stay in the fixture, because they are the turn's arithmetic, not content.
   */
  let brief: NarrationBriefDto;
  const composed =
    priceEntryId === null
      ? { ...briefRaw, imposedPrice: null }
      : (() => {
          const entry = resolvePriceEntry(priceEntryId);
          const draw = record(root['imposed_price_draw'], `${where}.imposed_price_draw`);
          return {
            ...briefRaw,
            imposedPrice: {
              rollId: draw['rollId'],
              tableId: 'pay-the-price',
              value: draw['value'],
              entryId: priceEntryId,
              text: entry.text,
              severity: entry.severity,
              effectIndex: draw['effectIndex'],
            },
          };
        })();
  try {
    brief = zNarrationBrief.parse(composed);
  } catch (cause) {
    throw new ProbeCaseError(
      `${where}.brief : hors contrat (${cause instanceof Error ? cause.message.slice(0, 300) : 'inconnu'})`,
    );
  }

  const reservedChampionIds = texts(root, 'reserved_champion_ids', where);

  return {
    id: text(root, 'id', where),
    title: text(root, 'title', where),
    tags: texts(root, 'tags', where),
    actorLabel: text(root, 'actor_label', where),
    playerCharacterNames: texts(root, 'player_character_names', where),
    reservedChampionIds,
    mentionsAny: texts(root, 'mentions_any', where),
    scene: {
      presentNames: texts(sceneRaw, 'present_names', `${where}.scene`),
      absentNames: texts(sceneRaw, 'absent_names', `${where}.scene`),
    },
    campaign: parseCampaign(campaignRaw, `${where}.campaign`),
    vocabulary: {
      moveLabel: optionalText(vocabularyRaw, 'move_label', `${where}.vocabulary`),
      attributeLabel: optionalText(vocabularyRaw, 'attribute_label', `${where}.vocabulary`),
      outcomeLabel: optionalText(vocabularyRaw, 'outcome_label', `${where}.vocabulary`),
      effectSentences: texts(vocabularyRaw, 'effect_sentences', `${where}.vocabulary`),
    },
    trimmable: {
      lore: texts(contextRaw, 'lore', `${where}.context`),
      etat: {
        core: looseText(etatRaw, 'core', `${where}.context.etat`),
        inventoryAndIdleClocks: looseText(
          etatRaw,
          'inventory_and_idle_clocks',
          `${where}.context.etat`,
        ),
      },
      turns: texts(contextRaw, 'turns', `${where}.context`),
      chronicle: chronicle(
        record(contextRaw['chronicle'], `${where}.context.chronicle`),
        `${where}.context.chronicle`,
      ),
    },
    brief,
    priceKeywords:
      brief.imposedPrice === null
        ? null
        : [...resolvePriceEntry(brief.imposedPrice.entryId).keywords],
    reservedChampions: resolveReserved(reservedChampionIds),
  };
}

const optionalText = (
  holder: Record<string, unknown>,
  key: string,
  where: string,
): string | null => {
  const value = holder[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ProbeCaseError(`${where} : le champ « ${key} » doit être une chaîne ou null`);
  }
  return value;
};

function parseCampaign(holder: Record<string, unknown>, where: string): CampaignBlockInput {
  const characters = list(holder, 'characters', where).map((entry, index) => {
    const row = record(entry, `${where}.characters[${String(index)}]`);
    const at = `${where}.characters[${String(index)}]`;
    return {
      id: text(row, 'id', at),
      name: text(row, 'name', at),
      championDisplayName: text(row, 'champion_display_name', at),
      pronouns: text(row, 'pronouns', at),
      oneLine: text(row, 'one_line', at),
    };
  });
  const npcs = list(holder, 'allowed_npcs', where).map((entry, index) => {
    const row = record(entry, `${where}.allowed_npcs[${String(index)}]`);
    const at = `${where}.allowed_npcs[${String(index)}]`;
    return {
      id: text(row, 'id', at),
      name: text(row, 'name', at),
      role: text(row, 'role', at),
      oneLine: text(row, 'one_line', at),
    };
  });
  const reserved = texts(holder, 'reserved_champion_ids', where).map((id) => {
    const resolved = resolveReserved([id])[0];
    return {
      id,
      displayName: resolved?.displayName ?? id,
      aliases: resolved?.aliases ?? [],
    };
  });
  return {
    name: text(holder, 'name', where),
    tone: text(holder, 'tone', where),
    houseRules: optionalText(holder, 'house_rules', where),
    characters,
    reservedChampions: reserved,
    allowedNpcs: npcs,
  };
}

// ---------------------------------------------------------------- the walk

/** Where the fixtures live, resolved from this file rather than from the cwd. */
export const PROBE_CASES_DIR = join(import.meta.dirname, 'cases');

/**
 * Lists the raw entries of a directory. Injected ONLY so the sort can be
 * proved, and typed with the single parameter `loadProbeCases` actually
 * passes, so a double cannot be laxer than the call site (mode 8 of
 * `docs/RECETTE.md`).
 */
export type ProbeDirLister = (dir: string) => readonly string[];

const listDir: ProbeDirLister = (dir) => readdirSync(dir);

/**
 * Read every `*.case.json` of `dir`, sorted by file name.
 *
 * THE SORT IS NOT PROVABLE AGAINST THE REAL FILE SYSTEM — on ext4 `readdirSync`
 * already hands the names back in order. Hence `lister`, which lets a test
 * hand in the reversed listing the file system refuses to produce. Held by
 * `cases.test.ts` « trie par nom de fichier, même quand le répertoire les rend
 * à l'envers ».
 */
export function loadProbeCases(
  dir: string = PROBE_CASES_DIR,
  lister: ProbeDirLister = listDir,
): readonly ProbeCase[] {
  let names: string[];
  try {
    names = [...lister(dir)].filter((name) => name.endsWith('.case.json'));
  } catch {
    throw new ProbeCaseError(`répertoire de cas introuvable : ${dir}`);
  }
  names.sort();
  return names.map((name) => {
    const path = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (cause) {
      throw new ProbeCaseError(
        `${name} : JSON illisible (${cause instanceof Error ? cause.message : 'inconnu'})`,
      );
    }
    return parseCase(parsed, name);
  });
}
