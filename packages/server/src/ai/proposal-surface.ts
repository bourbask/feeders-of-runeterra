/**
 * WHERE INVARIANT 1 CLOSES ON THE SERVER SIDE.
 *
 * Three circuits reach the journal of GAME STATE from the model, and three
 * only (ARCHITECTURE.md section 1, 03-donnees.md section 0.5). Each one is
 * gated here, by its own function, against its own list:
 *
 *   1. a PROPOSAL validated by the server — a `propose_*` tool or the
 *      `<scene_apres>` block, which is not a tool but takes the same route;
 *   2. `roll_oracle`, the one READ tool that writes;
 *   3. the storyteller's RIGHT OF REFUSAL.
 *
 * ── THE THREE STAY SEPARATE, AND THAT IS THE WHOLE DESIGN ─────────────────
 * One list of eleven types would read as "what the model may write", which is
 * the sentence invariant 1 exists to make false. Kept apart, widening one
 * cannot widen another by inattention: `assertProposalWritable` REFUSES
 * `roll.oracle_resolved`, and `assertOracleWritable` refuses
 * `scene.facts_updated`. Held by `tests/proposal-surface.test.ts`, « aucun
 * circuit n'accepte le type d'un autre », which walks the nine cross pairs.
 *
 * ── THE LISTS ARE NOT RETYPED HERE ────────────────────────────────────────
 * `@for/engine` declares the three tuples (`invariants.ts`) and uses them for
 * `assertNotAiAuthored`. A fourth copy would be a mirror nobody compares —
 * ADR 0007's whole subject. What `tests/proposal-surface.test.ts` does
 * instead is spell the eleven values OUT IN FULL LETTERS, from the table of
 * 03-donnees.md section 0.5, and compare them to these three exports, in
 * order. Widening a tuple in the engine therefore reddens that test, and the
 * test imports nothing from the code it guards.
 *
 * ── AND THE GATE IS ON THE WAY IN, NOT IN A COMMENT ───────────────────────
 * `gateEvents` runs `assertNotAiAuthored` too. M0-13 reported that predicate
 * as exported, tested in both directions and called on the intent path only;
 * the path it was WRITTEN for is this one, and this is where it is called.
 * Held by `tests/proposal-surface.test.ts`, « la porte des propositions
 * refuse aussi une entrée signée gm_ai ».
 */

import {
  AI_PROPOSABLE_EVENT_TYPES,
  AI_REFUSAL_EVENT_TYPES,
  AI_TOOL_EVENT_TYPES,
  assertNotAiAuthored,
} from '@for/engine';

import type { GameEvent, GameEventType } from '@for/engine';

/** The three routes, named so a log line and an error can say which one. */
export type AiWriteCircuitId = 'proposal' | 'oracle' | 'refusal';

export interface AiWriteCircuit {
  readonly id: AiWriteCircuitId;
  readonly types: readonly GameEventType[];
}

/** Circuit 1 — a `propose_*` tool, or the `<scene_apres>` block. */
export const PROPOSAL_CIRCUIT: AiWriteCircuit = {
  id: 'proposal',
  types: AI_PROPOSABLE_EVENT_TYPES,
};

/** Circuit 2 — `roll_oracle`, and nothing else. */
export const ORACLE_CIRCUIT: AiWriteCircuit = { id: 'oracle', types: AI_TOOL_EVENT_TYPES };

/** Circuit 3 — the right of refusal, and nothing else. */
export const REFUSAL_CIRCUIT: AiWriteCircuit = { id: 'refusal', types: AI_REFUSAL_EVENT_TYPES };

/**
 * Raised when a model-reachable path would write a type its circuit does not
 * list.
 *
 * It THROWS rather than answering a `RuleViolation`, for the reason
 * `assertNotAiAuthored` throws: no player can cause this and none will ever
 * read it. It is a programming error — a handler that grew a consequence.
 */
export class AiSurfaceViolation extends Error {
  readonly circuit: AiWriteCircuitId;

  readonly eventType: string;

  constructor(circuit: AiWriteCircuitId, eventType: string) {
    super(
      `${JSON.stringify(eventType)} n'est pas atteignable par le circuit « ${circuit} ». ` +
        `Invariant 1 : trois circuits, trois listes closes, tenues séparément ` +
        `(ARCHITECTURE.md §1, 03-donnees.md §0.5).`,
    );
    this.name = 'AiSurfaceViolation';
    this.circuit = circuit;
    this.eventType = eventType;
  }
}

function assertReachable(circuit: AiWriteCircuit, type: string): void {
  if (!(circuit.types as readonly string[]).includes(type)) {
    throw new AiSurfaceViolation(circuit.id, type);
  }
}

/** Circuit 1's gate. Refuses circuit 2's and circuit 3's types. */
export function assertProposalWritable(type: string): void {
  assertReachable(PROPOSAL_CIRCUIT, type);
}

/** Circuit 2's gate. Refuses circuit 1's and circuit 3's types. */
export function assertOracleWritable(type: string): void {
  assertReachable(ORACLE_CIRCUIT, type);
}

/** Circuit 3's gate. Refuses circuit 1's and circuit 2's types. */
export function assertRefusalWritable(type: string): void {
  assertReachable(REFUSAL_CIRCUIT, type);
}

/**
 * Every entry a model-reachable path is about to append, checked twice.
 *
 * Once against the circuit's own closed list, once against
 * `assertNotAiAuthored` — two different questions. The first asks "may this
 * ROUTE produce this type"; the second asks "may this ENTRY carry
 * `actorKind: 'gm_ai'`". A `clock.advanced` passes the first and fails the
 * second when the model signed it instead of the engine.
 */
export function gateEvents(circuit: AiWriteCircuit, events: readonly GameEvent[]): void {
  for (const event of events) {
    assertReachable(circuit, event.type);
    assertNotAiAuthored(event);
  }
}
