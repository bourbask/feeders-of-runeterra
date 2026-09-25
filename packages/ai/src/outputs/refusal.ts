/**
 * `proveRefusal` — R1 → R7 (02-mj-ia.md section 4.8.2).
 *
 * ── WHAT THE MODEL GETS TO DO, AND WHAT IT DOES NOT ─────────────────────────
 * It supplies a `cause` from a closed list of four and a name. No sequence
 * numbers, no effect, no value. The SERVER recomputes the proof from
 * structured state alone. If the state does not prove the cause, the refusal
 * falls without consequence: the turn plays out, the prose is broadcast, a
 * `narration.proposal_rejected` is journalled. The storyteller can never
 * cancel a roll by sheer will — only POINT AT A FACT the server re-checks.
 *
 * ── THE PROOF IS BLIND TO THE OUTCOME, AND THAT IS STRUCTURAL ───────────────
 * `RefusalProofInput` has no outcome, no roll and no dice. It cannot: the type
 * does not carry them. `refusalProofInput()` is the only way to build one from
 * a turn, and it DROPS the outcome the turn carries. Wiring the dice into the
 * decision therefore means adding a field to this file — a change a reviewer
 * sees, and one `tests/refusal-proof.test.ts` reddens on, because it replays
 * the same case with `franche` and with `echec` and demands the same verdict.
 *
 * Without that blindness the right of refusal becomes what section 4.8.5 names
 * as the risk: a back door for cancelling dice the model dislikes.
 */

import type { SceneBlockRefusal, SceneStateDto } from '@for/contracts';

import { findTerms, normalize } from '../assertions/text.js';
import type { SceneActor, SceneMergeState } from './scene.js';

/** Section 4.8.5: at most three upheld refusals over twenty turns. */
export const REFUSAL_QUOTA_UPHELD = 3;
export const REFUSAL_QUOTA_WINDOW_TURNS = 20;

/** R6: moves with no target. A refusal on one of them is meaningless. */
export const TARGETLESS_MOVE_IDS = [
  'endure-cold',
  'endure-harm',
  'swear-a-vow',
  'reach-a-milestone',
] as const;

export type RefusalRejectionReason =
  | 'refusal_multiple'
  | 'refusal_target_unknown'
  | 'refusal_unproven'
  | 'refusal_off_target'
  | 'refusal_targetless_move'
  | 'refusal_quota';

export type RefusalVerdict = 'upheld' | { readonly rejected: RefusalRejectionReason };

/**
 * Everything `proveRefusal` is allowed to read.
 *
 * Read the field list as the guarantee it is: there is no outcome here, and
 * no die. Section 4.8.2, « R4 lit l'état au moment de la déclaration, jamais
 * l'issue ».
 */
export interface RefusalProofInput {
  readonly refusal: SceneBlockRefusal | null;
  /** How many refusals the block declared. R2 allows one. */
  readonly declaredCount: number;
  /** The scene BEFORE the turn — the state at `move.declared`. */
  readonly sceneBefore: SceneStateDto;
  /** Who exists, what they are called, and whether the engine killed them. */
  readonly state: SceneMergeState;
  /** The acting character's inventory, by name. */
  readonly actorInventory: readonly string[];
  /** The acting character's sheet assets, by name. */
  readonly actorAssets: readonly string[];
  /** The escaped `<intention>` text, for R5. */
  readonly intention: string;
  readonly moveId: string | null;
  /** Upheld refusals over the last twenty turns of this campaign, for R7. */
  readonly upheldRefusalsInWindow: number;
}

/**
 * The turn as the server holds it — outcome INCLUDED, because the server has
 * it and pretending otherwise would be theatre.
 */
export interface RefusalTurn extends RefusalProofInput {
  /** Present here, and dropped by `refusalProofInput`. That is the whole point. */
  readonly outcome: string | null;
}

/**
 * Build the proof's input from a turn, dropping the outcome.
 *
 * Written out field by field rather than with a rest-spread: a spread would
 * carry a future field through in silence, and the one field that must never
 * cross is exactly the kind that gets added later.
 */
export function refusalProofInput(turn: RefusalTurn): RefusalProofInput {
  return {
    refusal: turn.refusal,
    declaredCount: turn.declaredCount,
    sceneBefore: turn.sceneBefore,
    state: turn.state,
    actorInventory: turn.actorInventory,
    actorAssets: turn.actorAssets,
    intention: turn.intention,
    moveId: turn.moveId,
    upheldRefusalsInWindow: turn.upheldRefusalsInWindow,
  };
}

const rejected = (reason: RefusalRejectionReason): RefusalVerdict => ({ rejected: reason });

const actorNamed = (name: string, state: SceneMergeState): SceneActor | null => {
  const folded = normalize(name);
  return state.actors.find((actor) => normalize(actor.name) === folded) ?? null;
};

const hasObjectNamed = (name: string, input: RefusalProofInput): boolean => {
  const folded = normalize(name);
  const sceneEntityNames = input.sceneBefore.present.map((entry) => entry.name);
  return [...input.actorInventory, ...input.actorAssets, ...sceneEntityNames].some(
    (candidate) => normalize(candidate) === folded,
  );
};

/**
 * Section 4.8.1, the only four causes, each re-derived from structured state.
 *
 * `objet_inexistant` is the mirror image of the other three: it is proven by
 * an ABSENCE, which is why R3 cannot apply to it (see `proveRefusal`).
 */
function causeIsProven(refusal: SceneBlockRefusal, input: RefusalProofInput): boolean {
  const target = refusal.cible;
  switch (refusal.cause) {
    case 'cible_absente': {
      const entry = input.sceneBefore.absent.find(
        (absent) => normalize(absent.name) === normalize(target),
      );
      return entry !== undefined && (entry.cause === 'parti' || entry.cause === 'hors_de_portee');
    }
    case 'cible_morte':
      return actorNamed(target, input.state)?.isDead === true;
    case 'hors_de_portee': {
      const actor = actorNamed(target, input.state);
      return (
        actor !== null && actor.placeId !== null && actor.placeId !== input.sceneBefore.placeId
      );
    }
    case 'objet_inexistant':
      return !hasObjectNamed(target, input);
    default:
      return false;
  }
}

/**
 * Prove a refusal, or say why it falls.
 *
 * ── R3 IS SKIPPED FOR ONE CAUSE, AND IT IS REPORTED ─────────────────────────
 * R3 demands that `cible` match an entity, a character, an inventory object or
 * an asset. `objet_inexistant` is the claim that it matches NONE of those — so
 * applying R3 to it would reject, by construction, every refusal of that
 * cause. The criterion is false for that one pair; it is reported in the pull
 * request and pinned by `tests/refusal-proof.test.ts` rather than worked
 * around silently.
 */
export function proveRefusal(input: RefusalProofInput): RefusalVerdict {
  // R1: no refusal declared, or none that parsed — nothing to do, normal turn.
  if (input.refusal === null) return rejected('refusal_unproven');

  // R2: one refusal per turn.
  if (input.declaredCount > 1) return rejected('refusal_multiple');

  // R6: a move with no target cannot be refused for its target.
  if (input.moveId !== null && (TARGETLESS_MOVE_IDS as readonly string[]).includes(input.moveId)) {
    return rejected('refusal_targetless_move');
  }

  // R3, for the three causes that point at something that EXISTS.
  if (input.refusal.cause !== 'objet_inexistant') {
    const knownActor = actorNamed(input.refusal.cible, input.state) !== null;
    const target = input.refusal.cible;
    const knownAbsent = input.sceneBefore.absent.some(
      (entry) => normalize(entry.name) === normalize(target),
    );
    if (!knownActor && !knownAbsent && !hasObjectNamed(input.refusal.cible, input)) {
      return rejected('refusal_target_unknown');
    }
  }

  // R5: the player's own words must designate this target.
  if (findTerms(input.intention, [input.refusal.cible]).length === 0) {
    return rejected('refusal_off_target');
  }

  // R4: the cause, proven on the state at declaration. The heart of the guard.
  if (!causeIsProven(input.refusal, input)) return rejected('refusal_unproven');

  // R7: the campaign's quota.
  if (input.upheldRefusalsInWindow >= REFUSAL_QUOTA_UPHELD) return rejected('refusal_quota');

  return 'upheld';
}

/** The shape `tests/refusal-proof.test.ts` and the assertions compare. */
export interface RefusalOutcomeView {
  readonly verdict: 'upheld' | 'rejected';
  readonly cause: string | null;
  readonly target: string | null;
  readonly reason: RefusalRejectionReason | null;
}

export function refusalView(
  refusal: SceneBlockRefusal | null,
  verdict: RefusalVerdict,
): RefusalOutcomeView {
  return {
    verdict: verdict === 'upheld' ? 'upheld' : 'rejected',
    cause: refusal?.cause ?? null,
    target: refusal?.cible ?? null,
    reason: verdict === 'upheld' ? null : verdict.rejected,
  };
}
