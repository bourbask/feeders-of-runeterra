/**
 * `<fait>`, `<intention>` and `<consignes_du_tour>` — the three blocks of the
 * current turn (02-mj-ia.md section 4.5).
 *
 * ── THE DIRECTION OF TRAVEL ─────────────────────────────────────────────────
 * Everything rendered here is ALREADY TRUE. The roll happened, the outcome was
 * decided, the gauges moved, the price was drawn and applied, the journal was
 * written. The block states it in the past tense on purpose: a conditional
 * would invite the model to decide, and deciding is invariant 1. That the
 * block is well formed with or without a roll, a price and a presage is held
 * by tests/context-budget.test.ts « un <fait> sans jet, sans prix et sans
 * présage reste bien formé » ; the past tense itself is prompt text, and no
 * test can hold it.
 *
 * ── WHY THE NUMBERS ARE SPELLED OUT ─────────────────────────────────────────
 * Section 4.5, point 1: digits in the context are digits a model can copy, and
 * the post-filter forbids every numeric character in the prose. Spelling
 * them lowers the odds at the source — held by tests/context-budget.test.ts
 * « les chiffres du <fait> sont en toutes lettres » and « spellNumber rend le
 * français, et rend les chiffres au-delà de sa portée ». It is a mitigation,
 * not a guarantee: what guarantees the PROSE carries none is `no_digits`,
 * held by tests/assertions.test.ts « no_digits tombe sur un seul chiffre et
 * cite sa position ».
 *
 * ── THE FRENCH THAT LIVES HERE, AND THE FRENCH THAT DOES NOT ────────────────
 * The block SKELETON — « Mouvement : », « Issue : », the sentence that
 * introduces the arithmetic — is prompt text, and the prompt lives in this
 * package. Everything campaign-specific arrives as data: the move's name, the
 * outcome's label and the already-applied consequences come from the content
 * bundle through `FactVocabulary`, and the price and presage texts are copied
 * from the brief WITHOUT EDIT, because the engine copied them from the
 * content table without edit (ADR 0006). Held by
 * tests/context-budget.test.ts « et le prix imposé est recopié sans
 * retouche ».
 */

import type { NarrationBriefDto } from '@for/contracts';

import { escapePlayerText } from './escape.js';

// -------------------------------------------------------------- numbers

const UNITS = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
  'dix-sept',
  'dix-huit',
  'dix-neuf',
] as const;

const TENS: Readonly<Record<number, string>> = {
  2: 'vingt',
  3: 'trente',
  4: 'quarante',
  5: 'cinquante',
  6: 'soixante',
};

/**
 * Spell a small non-negative integer in French.
 *
 * Bounded on purpose: dice, attributes and totals in this game live under one
 * hundred, and a number this function cannot spell is a number that has no
 * business being in the prompt. Past its range it returns the digits, which
 * the post-filter then catches in the OUTPUT if the model copies them — a
 * visible failure rather than a silent lie.
 */
export function spellNumber(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 69) return String(value);
  if (value < 20) return UNITS[value] ?? String(value);
  const tens = Math.floor(value / 10);
  const unit = value % 10;
  const tensWord = TENS[tens] ?? String(value);
  if (unit === 0) return tensWord;
  if (unit === 1) return `${tensWord} et un`;
  return `${tensWord}-${UNITS[unit] ?? String(unit)}`;
}

// -------------------------------------------------------------- vocabulary

/**
 * Everything the `<fait>` block needs that is NOT on the brief.
 *
 * It arrives as data rather than being looked up here, for the same reason the
 * engine takes its templates as a parameter: the caller holds the content
 * bundle, this package holds the prompt.
 */
export interface FactVocabulary {
  /** The move's display name, e.g. « Affronter le danger ». */
  readonly moveLabel: string | null;
  /** The attribute the move was rolled on, e.g. « fer ». */
  readonly attributeLabel: string | null;
  /** The outcome, spelled the way the prompt spells it, e.g. « RÉUSSITE PARTIELLE ». */
  readonly outcomeLabel: string | null;
  /**
   * The already-applied consequences, one French sentence each, built by the
   * caller from the content bundle. Past tense, already true.
   */
  readonly effectSentences: readonly string[];
}

// -------------------------------------------------------------- <fait>

function rollSentence(roll: NonNullable<NarrationBriefDto['roll']>): string {
  const [first, second] = roll.challengeDice;
  /**
   * The adds are SUMMED rather than listed. `RollAdd.source` is a code
   * identifier, in English, and the one thing this block must not do is teach
   * the model our vocabulary of mechanics — rule 2 forbids it in the prose,
   * and putting it in the context is how it gets copied.
   */
  const addTotal = roll.adds.reduce((sum, add) => sum + add.value, 0);
  const pieces = [
    `dé d'action ${spellNumber(roll.actionDie)}`,
    `attribut ${spellNumber(roll.attributeValue)}`,
    ...(addTotal === 0 ? [] : [`bonus ${spellNumber(addTotal)}`]),
    `total ${spellNumber(roll.total)}`,
    `dés de défi ${spellNumber(first)} et ${spellNumber(second)}`,
  ];
  return `Détail du calcul, pour ta compréhension seule : ${pieces.join(', ')}.`;
}

/**
 * Render `<fait>` — the settled fact, section 4.5.
 *
 * `imposedPrice.text` is copied verbatim and introduced as « à mettre en scène
 * tel quel » : the entry is not a menu. Rule 6 of the system prompt says the
 * same thing to the model, and `price_respected` measures it on the output.
 */
export function buildFactBlock(brief: NarrationBriefDto, vocab: FactVocabulary): string {
  const lines: string[] = ['<fait>'];

  if (vocab.moveLabel !== null) {
    const attribute = vocab.attributeLabel === null ? '' : ` (${vocab.attributeLabel})`;
    lines.push(`Mouvement : ${vocab.moveLabel}${attribute}.`);
  }
  if (vocab.outcomeLabel !== null) {
    lines.push(`Issue : ${vocab.outcomeLabel}. Présage : ${brief.isPresage ? 'oui' : 'non'}.`);
  }
  if (brief.roll !== null) lines.push(rollSentence(brief.roll));
  if (vocab.effectSentences.length > 0) {
    lines.push(`Ce qui a déjà eu lieu et qui est acquis : ${vocab.effectSentences.join(' ')}`);
  }
  if (brief.presage !== null) lines.push(`Présage imposé : ${brief.presage.text}`);
  if (brief.imposedPrice !== null) {
    lines.push(
      `Prix imposé, déjà survenu, à mettre en scène tel quel : « ${brief.imposedPrice.text} »`,
    );
  }

  lines.push('</fait>');
  return lines.join('\n');
}

// -------------------------------------------------------------- <intention>

/**
 * Render `<intention>` from the player's own words, escaped (section 4.6).
 *
 * `actorLabel` is the projection's name plus the player's, exactly as the
 * template of section 4.5 writes it.
 */
export function buildIntentionBlock(brief: NarrationBriefDto, actorLabel: string): string {
  return [
    '<intention>',
    `${actorLabel} : « ${escapePlayerText(brief.playerInput)} »`,
    '</intention>',
  ].join('\n');
}

// -------------------------------------------------- <consignes_du_tour>

/** Section 4.5: the form rules, repeated where attention is best. */
const CONSIGNES_BASE =
  'Écris maintenant. Trois à cinq phrases, prose seule, deuxième personne du singulier adressée à {{acteur}}. ' +
  "N'écris aucun chiffre. N'écris aucun nom de mécanique. Ne fais ni parler ni décider {{acteur}}. " +
  'Ne nomme aucun champion interdit. Ne fais pas passer le temps. ' +
  'Termine sur un fait, pas sur une atmosphère, et jamais sur une question adressée au joueur.';

/**
 * The line section 0.2 adds when `tools` are not sent.
 *
 * ADR 0011 makes prose-only the ONLY mode in M0, so this line is no longer
 * conditional: it is on every turn. It is the counterpart of the tool table
 * going to zero — without the tools, the model has no legitimate way to
 * introduce anything, so it is told not to.
 */
export const CONSIGNE_PROSE_SEULE =
  "N'introduis aucun personnage, lieu ou fil nouveau dans ce tour.";

/** Section 4.5: what the model writes after the prose. */
const CONSIGNE_SCENE_APRES =
  'Puis écris le bloc <scene_apres> : qui est encore là, qui est parti, et refus à null sauf si un fait ci-dessus rend l’action matériellement impossible.';

export interface ConsignesInput {
  /** The acting character's name, as the projection holds it. */
  readonly actorLabel: string;
  /** Names the model must not bring back, from `brief.perceivableFacts`. */
  readonly absentNames: readonly string[];
  /** True when `<fait>` carries a « Prix imposé » line. */
  readonly hasImposedPrice: boolean;
}

/**
 * Render `<consignes_du_tour>`.
 *
 * The absent names are repeated here as well as in `<scene>` deliberately: the
 * bug this closes — someone who left walking back into the scene — was
 * observed in a real session, and the end of the context is where attention is
 * best (section 4.5, point 5).
 */
export function buildConsignesBlock(input: ConsignesInput): string {
  const lines = [CONSIGNES_BASE.replaceAll('{{acteur}}', input.actorLabel)];
  if (input.absentNames.length > 0) {
    lines.push(`Ne fais revenir ni ${input.absentNames.join(' ni ')}.`);
  }
  if (input.hasImposedPrice) {
    lines.push(
      "Mets en scène le prix imposé tel qu'il est écrit, sans le remplacer par autre chose.",
    );
  }
  lines.push(CONSIGNE_PROSE_SEULE);
  lines.push(CONSIGNE_SCENE_APRES);
  return ['<consignes_du_tour>', ...lines, '</consignes_du_tour>'].join('\n');
}
