/**
 * V1 → V12 — server-side validation and repair of a forged champion sheet
 * (02-mj-ia.md section 9.5).
 *
 * ── WHY EVERY BOUND IS REPLAYED HERE ────────────────────────────────────────
 * The JSON Schema a provider accepts is an impoverished subset of ours: no
 * length bounds, no value bounds, no recursion. The 3/2/2/1/1 attribute spread
 * is a `superRefine` with no JSON Schema translation at all. So a sheet that a
 * provider "validated" has been checked against almost nothing, and V12 —
 * `ChampionSchema.safeParse` on the COMPLETED object — is the gate no sheet
 * gets past.
 *
 * ── THE REPAIRS ARE DETERMINISTIC, WHICH IS THE POINT ───────────────────────
 * V3 in particular: sort the proposed values descending, break ties by the
 * fixed order `vif, coeur, fer, ombre, esprit`, then reassign the canonical
 * `3,2,2,1,1` along that ranking. Two runs on the same output produce the same
 * sheet, so a forge can be replayed and compared.
 *
 * ── A FAILED FORGE NEVER BLOCKS A GAME ──────────────────────────────────────
 * Two retries at most, then the sheet is persisted as `draft` — kept for
 * analysis, NOT playable — and the player is offered one of the twenty
 * handwritten champions.
 */

import { ChampionSchema, ForgeOutputSchema, type ForgeOutput } from '@for/contracts';

import { RULES_LEXICON, RULES_LEXICON_ACCENT_SENSITIVE } from '../assertions/lexicons.js';
import { findTerms, normalize, splitSentences } from '../assertions/text.js';

export type ForgeCheckId =
  'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10' | 'V11' | 'V12';

export type ForgeAction = 'ok' | 'repaired' | 'retry' | 'reject';

export interface ForgeFinding {
  readonly check: ForgeCheckId;
  readonly action: ForgeAction;
  readonly detail: string;
}

/** Section 9.5: two retries, then `status: 'draft'`. */
export const FORGE_RETRIES_MAX = 2;

/** The tie-breaking order of V3. Fixed, and it is what makes the repair replayable. */
export const ATTRIBUTE_ORDER = ['vif', 'coeur', 'fer', 'ombre', 'esprit'] as const;

/** The canonical spread, highest first. */
export const ATTRIBUTE_CANONICAL = [3, 2, 2, 1, 1] as const;

export type AttributeName = (typeof ATTRIBUTE_ORDER)[number];

export type AttributeSpread = Record<AttributeName, number>;

/**
 * V3's deterministic repair.
 *
 * `[3,3,2,1,1]` becomes `[3,2,2,1,1]`: the values are ranked descending, ties
 * broken by `vif, coeur, fer, ombre, esprit`, and the canonical sequence is
 * dealt along that ranking.
 */
export function repairAttributes(proposed: AttributeSpread): AttributeSpread {
  const ranked = [...ATTRIBUTE_ORDER].sort((left, right) => {
    const delta = proposed[right] - proposed[left];
    if (delta !== 0) return delta;
    return ATTRIBUTE_ORDER.indexOf(left) - ATTRIBUTE_ORDER.indexOf(right);
  });
  const repaired = {} as AttributeSpread;
  ranked.forEach((name, index) => {
    repaired[name] = ATTRIBUTE_CANONICAL[index] ?? 1;
  });
  return repaired;
}

const spreadIsCanonical = (spread: AttributeSpread): boolean =>
  ATTRIBUTE_ORDER.map((name) => spread[name])
    .sort((left, right) => right - left)
    .join(',') === ATTRIBUTE_CANONICAL.join(',');

export interface ForgeValidationInput {
  /** The model's raw output. */
  readonly raw: unknown;
  /** The slug the server asked for. V1 imposes it. */
  readonly requestedId: string;
  /** The canonical region of `content/champions-index.json`. V2 imposes it. */
  readonly canonicalRegionId: string;
  /** Every champion name and alias of Runeterra, for V7. */
  readonly championNames: readonly string[];
  /** Asset identifiers that exist, for V11. */
  readonly knownAssetIds: readonly string[];
  /** The default starting assets, for V11's repair. */
  readonly defaultAssetIds: readonly string[];
  /** True when a handwritten sheet already exists for this id. V10 rejects. */
  readonly handwrittenSheetExists: boolean;
}

export interface ForgeValidation {
  readonly action: ForgeAction;
  readonly findings: readonly ForgeFinding[];
  /** The completed, revalidated sheet — `null` unless `action` is ok/repaired. */
  readonly sheet: unknown;
}

/** V4: cut at the last word boundary before the bound. */
export function truncateOnWord(text: string, bound: number): string {
  if (text.length <= bound) return text;
  const cut = text.slice(0, bound);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * V5: drop the sentence that carries a digit or a rule term.
 *
 * Returns whether anything was DROPPED rather than comparing strings: the
 * split-and-rejoin normalises whitespace, so string equality would report a
 * repair on a text nothing was removed from — and a false repair is a false
 * `retry`, which is a forge that fails on a good sheet.
 */
export function stripOffendingSentences(text: string): {
  readonly text: string;
  readonly removed: number;
} {
  const sentences = splitSentences(text);
  const kept = sentences.filter(
    (sentence) =>
      !/[0-9]/u.test(sentence) &&
      findTerms(sentence, RULES_LEXICON).length === 0 &&
      findTerms(sentence, RULES_LEXICON_ACCENT_SENSITIVE, 'strict').length === 0,
  );
  return { text: kept.join(' ').trim(), removed: sentences.length - kept.length };
}

/** V9's heuristic: an action verb and a named object. */
export function vowIsFalsifiable(description: string): boolean {
  const hasVerb =
    /\b[\p{L}]+(?:er|ir|re|endre|ttre)\b/u.test(description) ||
    /\b(ramener|trouver|tuer|briser|rendre|libérer|venger|protéger|retrouver)\b/iu.test(
      description,
    );
  const hasObject = /\b(le|la|les|l'|un|une|des|du)\s+[\p{L}]{3,}/iu.test(description);
  return hasVerb && hasObject;
}

const worst = (actions: readonly ForgeAction[]): ForgeAction => {
  if (actions.includes('reject')) return 'reject';
  if (actions.includes('retry')) return 'retry';
  if (actions.includes('repaired')) return 'repaired';
  return 'ok';
};

/**
 * Run V1 → V12 and return the completed sheet, or why it cannot be completed.
 *
 * The order is strict: V10 comes before anything is repaired, because a sheet
 * that should never have been forged is a CALLING bug, and repairing it would
 * hide the bug behind a plausible result.
 */
/**
 * Read a spread out of a raw answer, when it looks like one.
 *
 * `null` when the five keys are not all there as integers — at that point it
 * is not a spread to repair, it is a shape for the schema to refuse.
 */
function readSpread(raw: unknown): AttributeSpread | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const spread = {} as AttributeSpread;
  for (const name of ATTRIBUTE_ORDER) {
    const value = record[name];
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    spread[name] = value;
  }
  return spread;
}

export function validateForge(input: ForgeValidationInput): ForgeValidation {
  const findings: ForgeFinding[] = [];

  // V10: a handwritten sheet already exists. The forge should not have run.
  if (input.handwrittenSheetExists) {
    return {
      action: 'reject',
      findings: [{ check: 'V10', action: 'reject', detail: 'fiche écrite à la main existante' }],
      sheet: null,
    };
  }

  /**
   * V3 RUNS BEFORE THE SCHEMA, AND IT HAS TO.
   *
   * `ForgeOutputSchema` derives from `ChampionSchema.shape`, so it still
   * carries `zAttributeSpread`'s refinement: an illegal spread is REFUSED by
   * the parse. Repairing after the parse would therefore mean repairing a
   * value that can never arrive — the deterministic repair section 9.5
   * specifies would be unreachable code, and `[3,3,2,1,1]` would be a
   * `retry` rather than the `[3,2,2,1,1]` the criterion names.
   *
   * So the spread is read from the RAW answer, repaired if it is not
   * canonical, and the repaired object is what goes through the schema. V12
   * still has the last word, on the completed sheet.
   */
  let raw = input.raw;
  const proposedSpread =
    typeof raw === 'object' && raw !== null
      ? readSpread((raw as Record<string, unknown>)['attributes'])
      : null;
  if (proposedSpread !== null && !spreadIsCanonical(proposedSpread)) {
    const repaired = repairAttributes(proposedSpread);
    findings.push({
      check: 'V3',
      action: 'repaired',
      detail: `répartition ${JSON.stringify(proposedSpread)} → ${JSON.stringify(repaired)}`,
    });
    raw = { ...(raw as Record<string, unknown>), attributes: repaired };
  }

  const parsed = ForgeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      action: 'retry',
      findings: [
        {
          check: 'V12',
          action: 'retry',
          detail: `sortie hors schéma : ${parsed.error.issues
            .map((issue) => issue.path.join('.'))
            .join(', ')}`,
        },
      ],
      sheet: null,
    };
  }

  const draft: ForgeOutput = parsed.data;

  // V2: the canonical region is imposed, never negotiated.
  let regionId = draft.origin.regionId;
  if (regionId !== input.canonicalRegionId) {
    findings.push({
      check: 'V2',
      action: 'repaired',
      detail: `région ${regionId} remplacée par ${input.canonicalRegionId}`,
    });
    regionId = input.canonicalRegionId;
  }

  // V3 already ran, above the schema. What the parse returned is canonical.
  const attributes: AttributeSpread = draft.attributes;

  // V4 and V5: bounds and forbidden vocabulary, on the long text fields.
  /**
   * V4 then V5 on one text field.
   *
   * The « under forty per cent of the bound » floor is checked ONLY WHEN A
   * REPAIR HAPPENED. Section 9.5 says « si le champ TOMBE sous 40 % » — it is
   * about what a repair left behind, not about a field the model wrote short
   * on purpose. Checked unconditionally, a legitimate one-line `pitch` of
   * thirty-six characters asks for a retry, and every good sheet is forged
   * three times. Measured on the fixture of this file.
   */
  const repairText = (label: string, text: string, bound: number): string => {
    let out = text;
    let repaired = false;
    if (out.length > bound) {
      out = truncateOnWord(out, bound);
      repaired = true;
      findings.push({ check: 'V4', action: 'repaired', detail: `${label} tronqué` });
    }
    const cleaned = stripOffendingSentences(out);
    if (cleaned.removed > 0) {
      findings.push({ check: 'V5', action: 'repaired', detail: `${label} : phrase retirée` });
      out = cleaned.text;
      repaired = true;
    }
    if (repaired && (out.length === 0 || out.length < bound * 0.4)) {
      findings.push({
        check: 'V4',
        action: 'retry',
        detail: `${label} trop court après réparation`,
      });
    }
    return out;
  };

  const description = repairText('description', draft.description, 2000);
  const pitch = repairText('pitch', draft.pitch, 280);

  // V6: exactly three assets, unique after normalisation.
  const assetNames = draft.startingAssets;
  const unique = [...new Map(assetNames.map((name) => [normalize(name), name])).values()];
  if (unique.length !== assetNames.length) {
    findings.push({ check: 'V6', action: 'repaired', detail: 'atouts dédoublonnés' });
  }
  if (unique.length < 3) {
    findings.push({
      check: 'V6',
      action: 'retry',
      detail: `${String(unique.length)} atouts après dédoublonnage`,
    });
  }

  // V7: no other champion of Runeterra named in the texts.
  const named =
    input.championNames.length === 0
      ? []
      : findTerms(
          [description, pitch, draft.startingVow.description].join(' '),
          input.championNames,
        );
  if (named.length > 0) {
    findings.push({
      check: 'V7',
      action: 'retry',
      detail: `champions nommés : ${named.join(', ')}`,
    });
  }

  // V8: French.
  const words = description.match(/[\p{L}]+/gu) ?? [];
  const french = words.filter((word) =>
    ['le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'dans', 'sur', 'qui', 'que'].includes(
      normalize(word),
    ),
  ).length;
  if (words.length >= 10 && french / words.length < 0.1) {
    findings.push({ check: 'V8', action: 'retry', detail: 'français non détecté' });
  }

  // V9: a vow with a verifiable objective.
  if (!vowIsFalsifiable(draft.startingVow.description)) {
    findings.push({ check: 'V9', action: 'retry', detail: 'serment sans objectif vérifiable' });
  }

  // V11: every starting asset identifier must exist.
  let startingAssets = unique;
  const unknown = startingAssets.filter((id) => !input.knownAssetIds.includes(id));
  if (unknown.length > 0) {
    findings.push({
      check: 'V11',
      action: 'repaired',
      detail: `atouts inconnus remplacés : ${unknown.join(', ')}`,
    });
    startingAssets = [...input.defaultAssetIds];
  }

  const decided = worst(findings.map((finding) => finding.action));
  if (decided === 'retry' || decided === 'reject') {
    return { action: decided, findings, sheet: null };
  }

  // V1 and V12: the server's own fields, then the final gate.
  const completed = {
    ...draft,
    schemaVersion: 1 as const,
    id: input.requestedId,
    source: 'forged' as const,
    relations: [],
    aliases: [draft.name],
    origin: { ...draft.origin, regionId },
    attributes,
    description,
    pitch,
    startingAssets,
  };
  findings.push({ check: 'V1', action: 'repaired', detail: `id imposé : ${input.requestedId}` });

  const final = ChampionSchema.safeParse(completed);
  if (!final.success) {
    findings.push({
      check: 'V12',
      action: 'retry',
      detail: final.error.issues.map((issue) => issue.path.join('.')).join(', '),
    });
    return { action: 'retry', findings, sheet: null };
  }

  findings.push({ check: 'V12', action: 'ok', detail: 'ChampionSchema passé' });
  return { action: 'repaired', findings, sheet: final.data };
}
