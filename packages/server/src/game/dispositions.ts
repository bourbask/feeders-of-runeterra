/**
 * FIVE VALUES IN, FOUR VALUES OUT — and the two that do not fit are REFUSED,
 * not dropped.
 *
 * `propose_npc_introduce.disposition` offers five (`hostile`, `mefiant`,
 * `neutre`, `curieux`, `allie`), straight from 02-mj-ia.md section 3.3.
 * `EntityDisposition` in `@for/engine` holds four (`allie`, `neutre`,
 * `hostile`, `inconnu`). Three line up. `mefiant` and `curieux` have nowhere
 * to land, and `inconnu` is a state the storyteller cannot propose — it means
 * "nobody has decided yet".
 *
 * M0-12 implemented the specification as written and flagged the gap for this
 * task. Two answers were on the table, and only two:
 *
 *   1. THE ENGINE GAINS THE FIFTH VALUE. That is a change to `EntityState`, to
 *      its Zod mirror, and to the SQL `CHECK` on `entities.disposition` —
 *      a migration, and a migration is an ADR (03-donnees.md section 5.2). It
 *      is also a rules decision, and this is a server task.
 *   2. THE CONVERSION REFUSES, LOUDLY. Chosen. A proposal carrying `mefiant`
 *      is not quietly turned into `neutre` and not quietly turned into `null`:
 *      the conversion answers "no value", and the caller refuses the proposal.
 *
 * WHY SILENCE WAS THE WORST OPTION, which is what the code did before: the
 * storyteller says "this one is wary of you", the journal records "neutral",
 * and the next prompt reads the journal. The model is then told its own
 * proposal was accepted while the fact it proposed is gone — the exact drift
 * the structured scene state exists to close (02-mj-ia.md section 4.7). A
 * refused proposal is visible; a flattened one is not.
 *
 * THE MAP IS WALKED, NOT PINNED. `toEngineDisposition` looks the value up in
 * `EXACT_MATCHES`; emptying that record makes every conversion refuse, and the
 * test falls over. A `switch` with the three cases written out would have been
 * a list that is its own loop source.
 */

import { ENTITY_DISPOSITIONS } from '@for/engine';

import type { EntityDisposition } from '@for/engine';

/** The five the model may propose (02-mj-ia.md section 3.3). */
export type ProposedDisposition = 'hostile' | 'mefiant' | 'neutre' | 'curieux' | 'allie';

/**
 * The three that mean the same thing on both sides, derived from the ENGINE's
 * own tuple rather than typed again.
 *
 * `inconnu` is excluded because it is not a proposable value: it is the
 * absence of a decision, and the model proposing "nobody has decided" would be
 * a proposal that says nothing.
 */
const EXACT_MATCHES: Readonly<Record<string, EntityDisposition>> = Object.fromEntries(
  ENTITY_DISPOSITIONS.filter((value) => value !== 'inconnu').map((value) => [value, value]),
);

/** Raised when a proposal names a disposition the engine has no value for. */
export class UnmappableDisposition extends Error {
  constructor(readonly proposed: string) {
    super(
      `disposition « ${proposed} » sans équivalent moteur : ` +
        `le moteur connaît ${ENTITY_DISPOSITIONS.join(', ')}`,
    );
    this.name = 'UnmappableDisposition';
  }
}

/**
 * The engine value, or `null` when there is none.
 *
 * `null` here is NOT `inconnu`: it means the conversion failed, and the caller
 * must refuse the proposal rather than write an entity with no disposition.
 */
export function toEngineDisposition(proposed: string): EntityDisposition | null {
  return EXACT_MATCHES[proposed] ?? null;
}

/** The same, for a caller that would rather not test for `null`. */
export function requireEngineDisposition(proposed: string): EntityDisposition {
  const mapped = toEngineDisposition(proposed);
  if (mapped === null) throw new UnmappableDisposition(proposed);
  return mapped;
}
