/**
 * C1 → C9 — server-side validation of a regenerated chronicle (02-mj-ia.md
 * section 5.6).
 *
 * Pure: the checks take the document, the journal sequences that exist and
 * the current scene state, and return a verdict. The nine of them are held
 * one by one by tests/outputs.test.ts, « C1 : … » through « C9 : … ».
 * Persistence, the ten-minute lease and the retry live in `@for/server`.
 *
 * ── WHAT A FAILURE COSTS, AND WHY IT IS SMALL ───────────────────────────────
 * One retry with a `<corrections>` block APPENDED TO THE USER MESSAGE — never
 * a rewrite of the system prompt, which would invalidate the cache. The
 * placement is held by tests/outputs.test.ts « la requête de compaction met
 * les corrections dans le message utilisateur ». What this file guarantees on
 * its own is that a failure is a verdict and never an exception — held by
 * « readChronicleAnswer ne lève jamais, même sur du bruit ». « The previous
 * version stays in service » is a decision `@for/server` takes with that
 * verdict, and M0 has not delivered it yet.
 *
 * ── C9 IS THE ONE THAT CARRIES A RULE ───────────────────────────────────────
 * `<scene>` beats `<chronique>` whenever they disagree (section 4.7.4, and
 * rule « Continuité » of the system prompt). C9 is that precedence, enforced
 * server-side: a chronicle that calls an NPC alive when the scene holds them
 * dead is rejected. Held in both directions by tests/outputs.test.ts « C9 :
 * une chronique qui donne vivant un mort de la scène est refusée » and « et
 * C9 ne dit rien quand la scène ne donne personne pour mort ».
 */

import {
  CHRONICLE_TOKEN_BUDGET,
  ChronicleDoc,
  type ChronicleDoc as ChronicleDocument,
  type SceneStateDto,
} from '@for/contracts';

import { findTerms, normalize } from '../assertions/text.js';
import type { ReservedChampion } from '../assertions/types.js';
import { estimateTokens } from '../prompts/estimate.js';

export type ChronicleCheckId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9';

export interface ChronicleViolation {
  readonly check: ChronicleCheckId;
  /** What the `<corrections>` block will quote. */
  readonly detail: string;
  /** The identifiers at fault, listed so the retry can name them. */
  readonly offenders: readonly string[];
}

export interface ChronicleValidationInput {
  /** The raw document the model produced. */
  readonly doc: unknown;
  /** The version in service, for C3. `null` on the first generation. */
  readonly previous: ChronicleDocument | null;
  /** Journal sequences that exist, for C2. */
  readonly knownEventSeqs: ReadonlySet<number>;
  /** C2: nothing may cite a sequence past the regeneration's target. */
  readonly targetEventSeq: number;
  readonly reservedChampions: readonly ReservedChampion[];
  /** The scene as the engine holds it, for C9. `null` when no scene is open. */
  readonly scene: SceneStateDto | null;
  /** C6 runs in CI only, against a fixture's golden facts. */
  readonly goldenFactIds?: readonly string[] | undefined;
  /** The rendered markdown, whose size C7 measures. */
  readonly rendered: string;
}

export interface ChronicleValidation {
  readonly ok: boolean;
  readonly violations: readonly ChronicleViolation[];
  /** Present only when C1 passed. */
  readonly doc: ChronicleDocument | null;
  readonly tokenCount: number;
}

/** Every free-text field of the document, for C4, C5 and C8. */
function textFields(doc: ChronicleDocument): readonly string[] {
  return [
    doc.premise,
    ...doc.arcs.flatMap((arc) => [arc.title, arc.summary]),
    ...doc.characters.flatMap((character) => [
      character.name,
      character.one_line,
      character.current_burden,
      ...character.notable_deeds,
    ]),
    ...doc.npcs.flatMap((npc) => [npc.name, npc.role, npc.stance, npc.voice, npc.last_seen_place]),
    ...doc.places.flatMap((place) => [place.name, place.one_line, place.state]),
    ...doc.facts.map((fact) => fact.statement),
    ...doc.open_threads.flatMap((thread) => [thread.title, thread.summary]),
    ...doc.recent_digest,
  ];
}

/** C8: the same ratio-based detector `language_fr` uses (section 8.4). */
function looksFrench(text: string): boolean {
  const words = text.match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) ?? [];
  if (words.length < 10) return true;
  const french = words.filter((word) =>
    ['le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'dans', 'sur', 'qui', 'que'].includes(
      normalize(word),
    ),
  ).length;
  return french / words.length >= 0.1;
}

/**
 * Run the nine checks, in the order of section 5.6, stopping at the first
 * BLOCKING failure — which is C1, because nothing downstream can read a
 * document that does not parse.
 */
export function validateChronicle(input: ChronicleValidationInput): ChronicleValidation {
  const parsed = ChronicleDoc.safeParse(input.doc);
  if (!parsed.success) {
    return {
      ok: false,
      violations: [
        {
          check: 'C1',
          detail: 'le document ne passe pas le schéma',
          offenders: parsed.error.issues.map((issue) => issue.path.join('.')),
        },
      ],
      doc: null,
      tokenCount: estimateTokens(input.rendered),
    };
  }

  const doc = parsed.data;
  const violations: ChronicleViolation[] = [];
  const tokenCount = estimateTokens(input.rendered);

  // C2: provenance. Every fact cites a sequence that exists, and none in the future.
  const badProvenance = doc.facts.filter(
    (fact) => !input.knownEventSeqs.has(fact.event_seq) || fact.event_seq > input.targetEventSeq,
  );
  if (badProvenance.length > 0) {
    violations.push({
      check: 'C2',
      detail: 'faits dont la provenance n’existe pas ou dépasse la cible',
      offenders: badProvenance.map((fact) => fact.fact_id),
    });
  }

  // C3: a fact's statement is immutable at constant `fact_id`.
  if (input.previous !== null) {
    const before = new Map(input.previous.facts.map((fact) => [fact.fact_id, fact.statement]));
    const altered = doc.facts.filter(
      (fact) => before.has(fact.fact_id) && before.get(fact.fact_id) !== fact.statement,
    );
    if (altered.length > 0) {
      violations.push({
        check: 'C3',
        detail: 'énoncés réécrits à fact_id constant',
        offenders: altered.map((fact) => fact.fact_id),
      });
    }
  }

  // C4: no digit in a text field.
  const withDigits = textFields(doc).filter((field) => /[0-9]/u.test(field));
  if (withDigits.length > 0) {
    violations.push({ check: 'C4', detail: 'chiffres dans un champ texte', offenders: withDigits });
  }

  // C5: no reserved champion, aliases included.
  const reserved = input.reservedChampions.flatMap((champion) => [
    champion.displayName,
    ...champion.aliases,
  ]);
  const leaked = reserved.length === 0 ? [] : findTerms(textFields(doc).join(' '), reserved);
  if (leaked.length > 0) {
    violations.push({ check: 'C5', detail: 'champion réservé nommé', offenders: [...leaked] });
  }

  // C6: CI only — the golden facts of a fixture must survive a regeneration.
  if (input.goldenFactIds !== undefined) {
    const present = new Set(doc.facts.map((fact) => fact.fact_id));
    const missing = input.goldenFactIds.filter((id) => !present.has(id));
    if (missing.length > 0) {
      violations.push({ check: 'C6', detail: 'faits dorés perdus', offenders: missing });
    }
  }

  // C7: the budget of section 5.2.
  if (tokenCount > CHRONICLE_TOKEN_BUDGET) {
    violations.push({
      check: 'C7',
      detail: `${String(tokenCount)} tokens estimés, plafond ${String(CHRONICLE_TOKEN_BUDGET)}`,
      offenders: [],
    });
  }

  // C8: French.
  if (!looksFrench(textFields(doc).join(' '))) {
    violations.push({ check: 'C8', detail: 'français non détecté', offenders: [] });
  }

  // C9: the scene wins. An NPC the scene holds dead is not alive in the chronicle.
  if (input.scene !== null) {
    const deadInScene = new Set(
      input.scene.absent
        .filter((entry) => entry.cause === 'mort')
        .map((entry) => normalize(entry.name)),
    );
    const contradicting = doc.npcs.filter(
      (npc) =>
        deadInScene.has(normalize(npc.name)) &&
        (npc.status === 'vivant' || npc.status === 'inconnu'),
    );
    if (contradicting.length > 0) {
      violations.push({
        check: 'C9',
        detail: 'la chronique contredit l’état de scène sur un mort',
        offenders: contradicting.map((npc) => npc.npc_id),
      });
    }
  }

  return { ok: violations.length === 0, violations, doc, tokenCount };
}

/** The `<corrections>` block appended to the USER message, never the system one. */
export function buildChronicleCorrections(violations: readonly ChronicleViolation[]): string {
  if (violations.length === 0) return '';
  const lines = violations.map(
    (violation) =>
      `- ${violation.check} : ${violation.detail}` +
      (violation.offenders.length > 0 ? ` (${violation.offenders.join(', ')})` : ''),
  );
  return ['<corrections>', ...lines, '</corrections>'].join('\n');
}
