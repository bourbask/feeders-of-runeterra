/**
 * `fallbackNarration()` — what the players read when the storyteller does not
 * speak.
 *
 * 02-mj-ia.md section 0.2, in six words: WE DEGRADE THE PROSE, NEVER THE
 * FAIRNESS. The mechanical fact is already decided, already written and
 * already broadcast when this function runs (ARCHITECTURE.md section 6, step
 * 7); all that is missing is the sentence. An AI outage never loses a game.
 *
 * THREE PROPERTIES, and each one is proven by violating it in the test file:
 *
 *  1. NO FRENCH IN THE ENGINE. The templates come from
 *     `content/fallbacks/narration.json`, passed in as an argument like the
 *     rest of the content (ARCHITECTURE.md section 4.3, last row). This file
 *     contains no sentence anyone would read.
 *  2. IT INVENTS NOTHING. A template may name the place and the character, and
 *     those two values are READ FROM THE STATE. A placeholder that the state
 *     cannot fill is refused rather than guessed, for the same reason
 *     `rollOracle` refuses a value that lands in no entry: an invented fact
 *     travels silently all the way into the fiction, and the whole point of
 *     the structured scene (02-mj-ia.md section 4.7) is that it must not.
 *  3. IT IS REPLAYABLE. The variant is picked with the `fallback` RNG stream,
 *     so the same journal gives the same sentence (03-donnees.md section 3.6).
 *
 * WHAT THE PLAYER SEES. The narration this function returns is written with
 * `narration.gm_message { source: 'engine' }`, and the turn's proof — the one
 * folded behind « Pourquoi ? » (ADR 0008 decision 4, 02-mj-ia.md section
 * 4.8.6) — carries that source. The player can always find out that the engine
 * spoke and not the storyteller; it is never pushed at them.
 *
 * ---------------------------------------------------------------------------
 * ONE DEVIATION FROM 02-mj-ia.md section 7.5, REPORTED. That section sketches
 * `fallbackNarration(fact, scene, templates, rng)` with types `EngineFact` and
 * `Scene` that exist nowhere in this package. The settled fact IS
 * `NarrationBrief` (`types/brief.ts`), and the second argument is the whole
 * `CampaignState` rather than the scene: the character's display name lives in
 * `characters`, not in `SceneState`, and property 2 above cannot be held
 * without it.
 * ---------------------------------------------------------------------------
 */

import type { Rng } from './rng.js';
import type { NarrationBrief } from './types/brief.js';
import type { CampaignState } from './types/campaign.js';
import type { Outcome } from './types/moves.js';

/**
 * `content/fallbacks/narration.json`, seen by the engine: variants indexed by
 * move then by outcome. Two or three each (02-mj-ia.md section 7.5).
 */
export interface FallbackTemplates {
  readonly templates: Readonly<
    Record<string, Readonly<Partial<Record<Outcome, readonly string[]>>>>
  >;
}

/**
 * The placeholders a template may use, and the ONLY ones.
 *
 * Both are facts of the state. A template asking for anything else is refused:
 * see `FallbackTemplateUnresolved`.
 */
export const FALLBACK_PLACEHOLDERS = ['place', 'character'] as const;

export type FallbackPlaceholder = (typeof FALLBACK_PLACEHOLDERS)[number];

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Thrown when the content holds no variant for the pair the turn produced. */
export class FallbackTemplateMissing extends Error {
  readonly templateId: string;

  constructor(templateId: string) {
    super(
      `the content bundle holds no fallback narration for ${JSON.stringify(templateId)}. ` +
        `Every (move, outcome) pair needs at least one variant in ` +
        `content/fallbacks/narration.json, plus the reserved "default" key for a turn that ` +
        `played no move. Returning an empty narration here would leave the table with a ` +
        `silent storyteller and no way to tell an outage from a bug.`,
    );
    this.name = 'FallbackTemplateMissing';
    this.templateId = templateId;
  }
}

/** Thrown when a template asks for a fact the state cannot supply. */
export class FallbackTemplateUnresolved extends Error {
  readonly templateId: string;
  readonly placeholder: string;

  constructor(templateId: string, placeholder: string) {
    super(
      `the fallback template ${JSON.stringify(templateId)} asks for ` +
        `${JSON.stringify(placeholder)}, which this state cannot supply. The engine refuses ` +
        `to fill it with anything: a fabricated place or name is a fact nobody established, ` +
        `and it would reach the players as if it had been.`,
    );
    this.name = 'FallbackTemplateUnresolved';
    this.templateId = templateId;
    this.placeholder = placeholder;
  }
}

/** `<move>/<outcome>` split back into the two keys the bundle is indexed by. */
function splitTemplateId(templateId: string): { readonly move: string; readonly outcome: string } {
  const separator = templateId.lastIndexOf('/');
  if (separator < 0) return { move: templateId, outcome: '' };
  return { move: templateId.slice(0, separator), outcome: templateId.slice(separator + 1) };
}

function isOutcome(value: string): value is Outcome {
  return value === 'franche' || value === 'partielle' || value === 'echec';
}

/** The variants the bundle offers for this template id, possibly none. */
export function variantsFor(templates: FallbackTemplates, templateId: string): readonly string[] {
  const { move, outcome } = splitTemplateId(templateId);
  if (!isOutcome(outcome)) return [];
  return templates.templates[move]?.[outcome] ?? [];
}

/**
 * The value of one placeholder, read from the state, or `null`.
 *
 * `null` is not "empty", it is "this state does not say": the caller turns it
 * into a refusal rather than into a blank.
 */
function resolvePlaceholder(
  brief: NarrationBrief,
  state: CampaignState,
  placeholder: string,
): string | null {
  if (placeholder === 'place') {
    const name = state.scene?.placeName ?? '';
    return name === '' ? null : name;
  }
  if (placeholder === 'character') {
    const name = state.characters[brief.actorCharacterId]?.displayName ?? '';
    return name === '' ? null : name;
  }
  return null;
}

/**
 * The narration the engine writes when the storyteller fails.
 *
 * @param brief the settled fact, carrying the template id the turn chose.
 * @param state the campaign state the facts are read from.
 * @param templates the content bundle's fallback templates.
 * @param rng a generator on the `fallback` stream, so the variant replays.
 */
export function fallbackNarration(
  brief: NarrationBrief,
  state: CampaignState,
  templates: FallbackTemplates,
  rng: Rng,
): string {
  const templateId = brief.fallbackTemplateId;
  const variants = variantsFor(templates, templateId);
  if (variants.length === 0) {
    throw new FallbackTemplateMissing(templateId);
  }
  // One draw, always, even on a single variant: the caller derives this
  // generator per turn, so a draw that does not happen cannot shift anything —
  // and a constant number of draws per fallback keeps the trace readable.
  // `noUncheckedIndexedAccess` is on, and rightly: the index comes from a die
  // whose faces are the length of the list, so it is in range by construction.
  // The assertion says so once, rather than leaking `string | undefined` into
  // the substitution below or adding a branch no test can ever reach.
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- the `!` this rule asks for is itself banned by `no-non-null-assertion`; the two rules only agree on this form.
  const chosen = variants[rng.roll(variants.length) - 1] as string;

  return chosen.replaceAll(PLACEHOLDER_PATTERN, (_match, placeholder: string) => {
    const value = resolvePlaceholder(brief, state, placeholder);
    if (value === null) throw new FallbackTemplateUnresolved(templateId, placeholder);
    return value;
  });
}
