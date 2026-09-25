/**
 * `<scene_apres>` — reading (F1 → F8, section 2.3) and merging (S1 → S10,
 * section 4.7.3).
 *
 * ── PURE, AND IT NEVER THROWS ───────────────────────────────────────────────
 * That is the whole availability argument of section 2.3. An absent block, a
 * truncated one, a badly closed one, one that is not JSON, one that is JSON
 * but not our shape: every one of them keeps the PREVIOUS scene state TO THE
 * BYTE and lets the turn finish. A mechanism that could fail a turn would be a
 * mechanism that degrades availability, and this one exists to close a
 * coherence bug, not to open a reliability one.
 *
 * ── S9 IS WORTH READING TWICE ───────────────────────────────────────────────
 * Only an explicit mention in `partis` takes somebody out of a scene. A model
 * that forgets to copy a name does not make that person vanish — forgetting is
 * the most frequent failure mode, and it must cost nothing.
 *
 * ── WHAT THE MERGE IS HANDED, AND WHY IT IS NARROW ──────────────────────────
 * Section 4.7.3 writes `mergeSceneBlock(before, block, state)` with the whole
 * `CampaignState`. What it actually reads is: who exists, what they are called,
 * whether they are a player character, whether the ENGINE has them dead, and
 * which place identifiers exist. `SceneMergeState` is exactly that and nothing
 * more — a narrower channel is a channel that cannot quietly widen, and it
 * keeps this package free of `@for/engine`. The narrowing is deliberate and is
 * named in the pull request.
 */

import {
  SCENE_BLOCK_MAX_CHARS,
  SCENE_PRESENCE_MAX,
  SceneBlockSchema,
  type SceneBlock,
  type SceneRefusalCause,
  type SceneStateDto,
} from '@for/contracts';

import { RULES_LEXICON, RULES_LEXICON_ACCENT_SENSITIVE } from '../assertions/lexicons.js';
import { findTerms, normalize } from '../assertions/text.js';
import type { ReservedChampion } from '../assertions/types.js';

// ------------------------------------------------------------------ F1 → F8

export const SCENE_OPEN_TAG = '<scene_apres>';
export const SCENE_CLOSE_TAG = '</scene_apres>';

/** What section 2.3 records in `ai_calls.eval_tags_json`. */
export type SceneBlockTag =
  'scene_block_missing' | 'scene_block_malformed' | 'reserved_champion_leak';

export interface SceneBlockReading {
  /** F2: the prose broadcast to players — everything before the tag, trimmed. */
  readonly prose: string;
  /** `null` whenever any of F1, F4, F5 or F8 rejected the block. */
  readonly block: SceneBlock | null;
  /** Empty when the block was usable. */
  readonly tags: readonly SceneBlockTag[];
  /** The rule that rejected it, for the log. */
  readonly rejectedBy: 'F1' | 'F4' | 'F5' | 'F8' | null;
}

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

const hasDigit = (text: string): boolean => /[0-9]/u.test(text);

const hasRulesLexicon = (text: string): boolean =>
  findTerms(text, RULES_LEXICON).length > 0 ||
  findTerms(text, RULES_LEXICON_ACCENT_SENSITIVE, 'strict').length > 0;

const namesOf = (reserved: readonly ReservedChampion[]): readonly string[] =>
  reserved.flatMap((champion) => [champion.displayName, ...champion.aliases]);

/**
 * Read the model's answer: prose on one side, scene block on the other.
 *
 * The rules run in the order section 2.3 writes them, and the order matters:
 * F1 decides whether there is a block at all, so the prose is known before
 * anything is parsed — which is what lets a malformed block leave the prose
 * untouched.
 */
export function readSceneBlock(
  response: string,
  reservedChampions: readonly ReservedChampion[] = [],
): SceneBlockReading {
  const opens = occurrences(response, SCENE_OPEN_TAG);
  const closes = occurrences(response, SCENE_CLOSE_TAG);

  // F1: exactly one opening tag and one closing tag.
  if (opens !== 1 || closes !== 1) {
    return {
      prose: (opens >= 1 ? response.slice(0, response.indexOf(SCENE_OPEN_TAG)) : response).trim(),
      block: null,
      tags: [opens === 0 && closes === 0 ? 'scene_block_missing' : 'scene_block_malformed'],
      rejectedBy: 'F1',
    };
  }

  const open = response.indexOf(SCENE_OPEN_TAG);
  const close = response.indexOf(SCENE_CLOSE_TAG);
  if (close < open) {
    return {
      prose: response.slice(0, open).trim(),
      block: null,
      tags: ['scene_block_malformed'],
      rejectedBy: 'F1',
    };
  }

  // F2 and F3: prose is what precedes; what follows the closing tag is dropped.
  const prose = response.slice(0, open).trim();
  const inner = response.slice(open + SCENE_OPEN_TAG.length, close);

  const reject = (rule: 'F4' | 'F5' | 'F8', tag: SceneBlockTag): SceneBlockReading => ({
    prose,
    block: null,
    tags: [tag],
    rejectedBy: rule,
  });

  // F4: nine hundred characters between the tags.
  if (inner.length > SCENE_BLOCK_MAX_CHARS) return reject('F4', 'scene_block_malformed');

  // F5: JSON, then the shape.
  let raw: unknown;
  try {
    raw = JSON.parse(inner) as unknown;
  } catch {
    return reject('F5', 'scene_block_malformed');
  }
  const parsed = SceneBlockSchema.safeParse(raw);
  if (!parsed.success) return reject('F5', 'scene_block_malformed');

  // F8: a reserved champion anywhere in the block sinks the whole block.
  const reserved = namesOf(reservedChampions);
  const everyName = [
    parsed.data.lieu,
    ...parsed.data.presents.flatMap((entry) => [entry.nom, entry.etat]),
    ...parsed.data.partis.map((entry) => entry.nom),
    ...(parsed.data.refus === null ? [] : [parsed.data.refus.cible]),
  ].join(' ');
  if (reserved.length > 0 && findTerms(everyName, reserved).length > 0) {
    return reject('F8', 'reserved_champion_leak');
  }

  // F6 and F7: field-level repairs, which never sink the block.
  const block: SceneBlock = {
    lieu: hasDigit(parsed.data.lieu) ? '' : parsed.data.lieu,
    presents: parsed.data.presents
      .filter((entry) => !hasDigit(entry.nom))
      .map((entry) => ({
        nom: entry.nom,
        etat: hasDigit(entry.etat) || hasRulesLexicon(entry.etat) ? '' : entry.etat,
      })),
    partis: parsed.data.partis.filter((entry) => !hasDigit(entry.nom)),
    refus:
      parsed.data.refus === null || hasDigit(parsed.data.refus.cible) ? null : parsed.data.refus,
  };

  return { prose, block, tags: [], rejectedBy: null };
}

// ------------------------------------------------------------------ S1 → S10

/** What the merge reads of the world. Nothing else, on purpose. */
export interface SceneActor {
  readonly ref: SceneStateDto['present'][number]['ref'];
  /** The projection's name. S8 writes THIS one, never the model's. */
  readonly name: string;
  readonly isPlayerCharacter: boolean;
  /** True only when the ENGINE killed them. S4 leans on this and nothing else. */
  readonly isDead: boolean;
  /** Where they are, for the refusal proof. `null` when unknown. */
  readonly placeId: string | null;
}

export interface SceneMergeState {
  readonly actors: readonly SceneActor[];
  /** Existing `kind: 'place'` identifiers, for S6. */
  readonly placeIds: readonly string[];
  /** Current journal sequence: the `sinceSeq` of anything this turn moves. */
  readonly seq: number;
}

export type SceneRejectionCode =
  | 'scene_name_unknown'
  | 'scene_name_ambiguous'
  | 'pc_removal_attempt'
  | 'absent_reappearance'
  | 'place_unknown'
  | 'death_not_proven'
  | 'list_truncated';

export interface SceneRejection {
  readonly code: SceneRejectionCode;
  readonly rule: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7';
  readonly detail: string;
}

export interface SceneMergeResult {
  readonly after: SceneStateDto;
  readonly rejections: readonly SceneRejection[];
  /** True when the merge changed nothing: section 4.7.1, no event is written. */
  readonly unchanged: boolean;
}

/** S1: fold, then match on the scene first and the rest of the world after. */
function matchActor(
  name: string,
  state: SceneMergeState,
  inScene: ReadonlySet<string>,
): { actor: SceneActor | null; ambiguous: boolean } {
  const folded = normalize(name);
  if (folded.length === 0) return { actor: null, ambiguous: false };
  const all = state.actors.filter((actor) => normalize(actor.name) === folded);
  if (all.length === 0) return { actor: null, ambiguous: false };
  const scoped = all.filter((actor) => inScene.has(actor.ref.id));
  const candidates = scoped.length > 0 ? scoped : all;
  if (candidates.length > 1) return { actor: null, ambiguous: true };
  return { actor: candidates[0] ?? null, ambiguous: false };
}

/** S7: keep the most recent by `sinceSeq`, then by `ref.id`. Deterministic. */
function capList<T extends { readonly sinceSeq: number; readonly ref: { readonly id: string } }>(
  entries: readonly T[],
): readonly T[] {
  if (entries.length <= SCENE_PRESENCE_MAX) return sortByRefId(entries);
  const kept = [...entries]
    .sort((left, right) =>
      right.sinceSeq === left.sinceSeq
        ? left.ref.id.localeCompare(right.ref.id)
        : right.sinceSeq - left.sinceSeq,
    )
    .slice(0, SCENE_PRESENCE_MAX);
  return sortByRefId(kept);
}

/** Both lists are stored sorted by `ref.id` — the rendering must be stable. */
function sortByRefId<T extends { readonly ref: { readonly id: string } }>(
  entries: readonly T[],
): readonly T[] {
  return [...entries].sort((left, right) => left.ref.id.localeCompare(right.ref.id));
}

/**
 * Merge a read block into the scene state.
 *
 * Returns only a `SceneStateDto`: S10 is carried by the RETURN TYPE, not by
 * discipline — there is no way for this function to touch `entities`,
 * `characters`, `clocks` or a gauge, because it cannot return one.
 */
export function mergeSceneBlock(
  before: SceneStateDto,
  block: SceneBlock | null,
  state: SceneMergeState,
): SceneMergeResult {
  if (block === null) return { after: before, rejections: [], unchanged: true };

  const rejections: SceneRejection[] = [];
  const inScene = new Set([
    ...before.present.map((entry) => entry.ref.id),
    ...before.absent.map((entry) => entry.ref.id),
  ]);
  const absentBefore = new Set(before.absent.map((entry) => entry.ref.id));

  // S9: everyone present before stays present unless explicitly departed.
  const present = new Map(before.present.map((entry) => [entry.ref.id, entry]));
  const absent = new Map(before.absent.map((entry) => [entry.ref.id, entry]));

  for (const entry of block.presents) {
    const { actor, ambiguous } = matchActor(entry.nom, state, inScene);
    if (ambiguous) {
      rejections.push({ code: 'scene_name_ambiguous', rule: 'S2', detail: entry.nom });
      continue;
    }
    if (actor === null) {
      rejections.push({ code: 'scene_name_unknown', rule: 'S1', detail: entry.nom });
      continue;
    }
    // S5: monotony. Whoever was absent before does not come back through here.
    if (absentBefore.has(actor.ref.id)) {
      rejections.push({ code: 'absent_reappearance', rule: 'S5', detail: actor.name });
      continue;
    }
    const existing = present.get(actor.ref.id);
    present.set(actor.ref.id, {
      ref: actor.ref,
      // S8: always the projection's name.
      name: actor.name,
      state: entry.etat,
      sinceSeq: existing?.sinceSeq ?? state.seq,
    });
  }

  for (const entry of block.partis) {
    const { actor, ambiguous } = matchActor(entry.nom, state, inScene);
    if (ambiguous) {
      rejections.push({ code: 'scene_name_ambiguous', rule: 'S2', detail: entry.nom });
      continue;
    }
    if (actor === null) {
      rejections.push({ code: 'scene_name_unknown', rule: 'S1', detail: entry.nom });
      continue;
    }
    // S3: a player character is never walked out of a scene by the model.
    if (actor.isPlayerCharacter) {
      rejections.push({ code: 'pc_removal_attempt', rule: 'S3', detail: actor.name });
      continue;
    }
    // S4: `mort` only when the engine already killed them.
    let cause = entry.cause;
    if (cause === 'mort' && !actor.isDead) {
      rejections.push({ code: 'death_not_proven', rule: 'S4', detail: actor.name });
      cause = 'parti';
    }
    const existing = absent.get(actor.ref.id);
    present.delete(actor.ref.id);
    absent.set(actor.ref.id, {
      ref: actor.ref,
      name: actor.name,
      cause,
      sinceSeq: existing?.sinceSeq ?? state.seq,
    });
  }

  // S6: a place that does not exist does not move the scene.
  let placeId = before.placeId;
  if (block.lieu.length > 0) {
    if (state.placeIds.includes(block.lieu)) placeId = block.lieu;
    else rejections.push({ code: 'place_unknown', rule: 'S6', detail: block.lieu });
  }

  const presentList = capList([...present.values()]);
  const absentList = capList([...absent.values()]);
  if (presentList.length < present.size || absentList.length < absent.size) {
    rejections.push({ code: 'list_truncated', rule: 'S7', detail: 'plus de huit entrées' });
  }

  const after: SceneStateDto = {
    ...before,
    placeId,
    present: [...presentList],
    absent: [...absentList],
    updatedSeq: state.seq,
  };

  // Section 4.7.1: no event unless the merge changed something.
  const unchanged =
    JSON.stringify({ ...after, updatedSeq: 0 }) === JSON.stringify({ ...before, updatedSeq: 0 });

  return { after: unchanged ? before : after, rejections, unchanged };
}

/** The four refusal causes, re-exported where the parser lives. */
export type { SceneRefusalCause };
