/**
 * « Pourquoi ? » — the proof of one turn, and it is a PROJECTION of the
 * journal, never a record kept for display (P22).
 *
 * THIS FILE ROLLS NOTHING AND READS NOTHING. Not one call to the decision
 * function, not one to either dice helper, no ambient randomness, no
 * connection, no clock. The acceptance criterion is a `grep` over this path
 * for those four names that must print `0` — which is why they are not
 * spelled out even in this comment. The rule is a criterion rather than a
 * convention because "the proof is computed, not stored" is only worth
 * something if computing it cannot change anything: a proof that drew a die
 * would give a different answer every time it was opened, and would consume a
 * draw index that belongs to the game.
 *
 * WHAT MAKES IT CHECKABLE: every entry carries the `eventSeq` of the journal
 * line that establishes it. `zTurnProof` requires it on `move`, `roll`,
 * `revision`, each effect, `price`, `presage` and `narration`; nothing in the
 * shape can be filled without a line to point at. So a reader can always walk
 * back from a label to the entry, and the test walks back from every entry to
 * the group it was handed.
 *
 * ── ADR 0008, THE SAME RULE AS `getSnapshot` ─────────────────────────────
 * The proof is built for ONE viewer. An entry of scope `table` is everyone's;
 * an entry of scope `subset` or `private` belongs to the identifiers in
 * `recipients`. Filtering happens FIRST, so a line the viewer never received
 * cannot reach a label, a sequence bound or the effect count. Replaying from
 * a player's point of view gives exactly what that player saw — that is the
 * invariant, and a proof view is a replay.
 *
 * ── A CANCELLED TURN IS STILL A PROOF ────────────────────────────────────
 * 03-donnees.md section 3.7, point 5: the cancelled turn stays on screen,
 * struck through, with its proof readable. So `system.reverted` sets
 * `status: 'reverted'` and `revertedBy`, and REMOVES NOTHING: the roll, the
 * effects, the price and the presage of the cancelled turn are all still
 * there. Erasing would be lying about what happened, and would leave the
 * player without an explanation for a round trip they watched.
 *
 * ── WHY THE `system.reverted` ENTRY IS IN THE GROUP ──────────────────────
 * `revertTurn` stamps the cancellation with the `correlation_id` OF THE TURN
 * IT CANCELS. That is what keeps this function pure: the caller reads one
 * group and hands it over, with no second query for "was this turn
 * cancelled". `correlation_id` groups every entry of a turn, and being
 * cancelled is part of that turn's story.
 */

import {
  TURN_PROOF_LABEL_MAX,
  TURN_PROOF_MAX_EFFECTS,
  TURN_PROOF_TEXT_MAX,
  zTurnProof,
} from '@for/contracts';

import type { TurnProofDto, TurnProofEffectDto } from '@for/contracts';
import type { GameEvent, PlayerId } from '@for/engine';

/**
 * Entry types that are the turn's STRUCTURE rather than one of its
 * consequences: they already have a field of their own on the proof.
 * Everything else the engine wrote in the group is an applied effect.
 *
 * A LIST THAT IS WALKED, NOT PINNED: `effectsOf` filters with it, so emptying
 * it puts `move.declared` and `roll.action_resolved` into `effects` and the
 * test falls over. `narration.*` is matched by prefix for the same reason the
 * engine excludes it by nature — it is the trace of what was SAID, with no
 * effect on the reducer.
 */
const STRUCTURAL_TYPES: ReadonlySet<string> = new Set([
  'move.declared',
  'move.resolved',
  'roll.action_resolved',
  'roll.action_revised',
  'roll.price_paid',
  'roll.presage_drawn',
  'system.reverted',
]);

/** Cuts a label to what `zTurnProof` accepts, with an ellipsis that says so. */
function label(value: string): string {
  return value.length <= TURN_PROOF_LABEL_MAX
    ? value
    : `${value.slice(0, TURN_PROOF_LABEL_MAX - 1)}…`;
}

/** The same, at the wider bound a copied content text is allowed. */
function copied(value: string): string {
  return value.length <= TURN_PROOF_TEXT_MAX
    ? value
    : `${value.slice(0, TURN_PROOF_TEXT_MAX - 1)}…`;
}

/** ADR 0008: `table` reaches everyone, anything else reaches its recipients. */
function visibleTo(event: GameEvent, viewerId: PlayerId): boolean {
  return event.scope === 'table' || (event.recipients?.includes(viewerId) ?? false);
}

function find<TType extends GameEvent['type']>(
  events: readonly GameEvent[],
  type: TType,
): Extract<GameEvent, { type: TType }> | undefined {
  return events.find((event): event is Extract<GameEvent, { type: TType }> => event.type === type);
}

/**
 * One consequence, in one French line.
 *
 * The numbers come from the payload, which carries `from` and `to` precisely
 * so a reader does not have to recompute them (03-donnees.md section 3.4). A
 * type with nothing worth spelling out falls back to its own name: an entry
 * with no sentence is still an entry with a sequence, and a sequence is what
 * makes the line checkable.
 */
function effectLabel(event: GameEvent): string {
  if (event.type === 'character.gauge_changed') {
    const { gauge, from, to } = event.payload;
    return `${gauge} ${String(from)} → ${String(to)}`;
  }
  if (event.type === 'character.momentum_changed') {
    const { from, to } = event.payload;
    return `souffle ${String(from)} → ${String(to)}`;
  }
  if (event.type === 'character.momentum_burned') {
    const { spent, resetTo } = event.payload;
    return `souffle brûlé : ${String(spent)}, retombe à ${String(resetTo)}`;
  }
  if (event.type === 'character.condition_added') return `marque : ${event.payload.label}`;
  if (event.type === 'character.condition_removed') {
    return `marque levée : ${event.payload.conditionId}`;
  }
  if (event.type === 'character.xp_earned') {
    return `expérience +${String(event.payload.amount)}`;
  }
  if (event.type === 'track.ticked') {
    const { from, to } = event.payload;
    return `crans ${String(from)} → ${String(to)}`;
  }
  if (event.type === 'track.created') return `piste ouverte : ${event.payload.title}`;
  if (event.type === 'track.resolved') return `piste ${event.payload.outcome}`;
  if (event.type === 'clock.advanced') {
    const { from, to } = event.payload;
    return `horloge ${String(from)} → ${String(to)}`;
  }
  if (event.type === 'clock.filled') return 'horloge pleine';
  return event.type;
}

/**
 * The consequences of a group THIS VIEWER RECEIVED, before the bound is
 * applied.
 *
 * Exported because the caller has to answer `truncated`, and the only honest
 * way to answer it is to compare this count with the length of the list the
 * proof carries — TWO OPERANDS, TWO ORIGINS. A `truncated` flag set by the
 * same code that did the cutting would be a number compared with itself.
 *
 * ── WHY `viewerId` IS A PARAMETER AND NOT AN OMISSION ────────────────────
 * It used to count the WHOLE group while the proof carried only what the
 * viewer could see, and that was an information leak, not an off-by-one: on a
 * turn of two consequences where one was `private` to another player, the
 * viewer got one effect and `truncated: true` — with the bound of 32 nowhere
 * near. The flag lied, AND it told them an entry exists that they have no
 * right to see. ADR 0008 says a replay from a player's point of view gives
 * exactly what that player saw, "ni plus ni moins", and a count is something
 * seen. So the same visibility rule applies HERE, before the counting, and
 * `truncated` then means the one thing it claims: the bound dropped something.
 *
 * Latent in M0, where the engine writes only `('table', null)`; real from M1,
 * when the rule that splits the pair arrives.
 */
export function proofEffectCandidates(
  events: readonly GameEvent[],
  viewerId: PlayerId,
): readonly GameEvent[] {
  return events.filter(
    (event) =>
      visibleTo(event, viewerId) &&
      !STRUCTURAL_TYPES.has(event.type) &&
      !event.type.startsWith('narration.'),
  );
}

function effectsOf(
  events: readonly GameEvent[],
  viewerId: PlayerId,
): readonly TurnProofEffectDto[] {
  return proofEffectCandidates(events, viewerId)
    .slice(0, TURN_PROOF_MAX_EFFECTS)
    .map((event) => ({ eventSeq: event.seq, type: event.type, label: label(effectLabel(event)) }));
}

/**
 * The proof of one `correlation_id` group, for one viewer.
 *
 * `events` is the group, in `seq` order, exactly as the journal holds it —
 * including the `system.reverted` entry when the turn was cancelled. Returns
 * `null` when the viewer saw nothing of this turn: a proof with no line is
 * not an empty proof, it is a turn that is none of their business.
 *
 * The result is PARSED before it is returned. A shape this function got wrong
 * fails here rather than at the socket, and `.strict()` refuses a key nobody
 * declared rather than letting a client render it.
 */
export function buildTurnProof(
  events: readonly GameEvent[],
  viewerId: PlayerId,
): TurnProofDto | null {
  const visible = events.filter((event) => visibleTo(event, viewerId));
  const first = visible[0];
  const last = visible[visible.length - 1];
  if (first === undefined || last === undefined) return null;

  const declared = find(visible, 'move.declared');
  const rolled = find(visible, 'roll.action_resolved');
  const revised = find(visible, 'roll.action_revised');
  const priced = find(visible, 'roll.price_paid');
  const presaged = find(visible, 'roll.presage_drawn');
  const narrated = find(visible, 'narration.gm_message');
  const reverted = find(visible, 'system.reverted');

  const proof: TurnProofDto = {
    correlationId: first.correlationId ?? '',
    firstSeq: first.seq,
    lastSeq: last.seq,
    status: reverted === undefined ? 'applied' : 'reverted',
    revertedBy:
      reverted === undefined ? null : { seq: reverted.seq, reason: label(reverted.payload.reason) },
    move:
      declared === undefined
        ? null
        : {
            eventSeq: declared.seq,
            moveId: declared.payload.moveId,
            attribute: declared.payload.chosenAttribute ?? null,
            // The bonus the PLAYER declared, which is the only add that is a
            // decision. The others are the engine's arithmetic and are on the
            // roll line.
            bonus:
              declared.payload.declaredAdds?.find((add) => add.source === 'intent')?.value ?? null,
            // What the player wrote. The move's French NAME lives in the
            // content bundle, and reaching for the bundle here would make this
            // function depend on the version a campaign pins — state the proof
            // must not need. The client already has the bundle.
            label: label(declared.payload.narrativeInput),
          },
    roll:
      rolled === undefined
        ? null
        : {
            eventSeq: rolled.seq,
            rngStream: rolled.payload.rngStream,
            rngDrawIndex: rolled.payload.rngDrawIndex,
            action: rolled.payload.actionDie,
            challenge: [rolled.payload.challengeDice[0], rolled.payload.challengeDice[1]],
            total: rolled.payload.total,
            outcome: rolled.payload.outcome,
          },
    revision:
      revised === undefined
        ? null
        : {
            eventSeq: revised.seq,
            label: label(
              `souffle ${String(revised.payload.total)} → ${revised.payload.outcome}` +
                ` (jet ${String(revised.payload.revisedFromSeq)})`,
            ),
          },
    effects: [...effectsOf(visible, viewerId)],
    price:
      priced === undefined
        ? null
        : {
            eventSeq: priced.seq,
            entryId: priced.payload.entryId,
            text: copied(priced.payload.text),
            value: priced.payload.value,
            effectIndex: priced.payload.effectIndex,
          },
    presage:
      presaged === undefined
        ? null
        : {
            eventSeq: presaged.seq,
            entryId: presaged.payload.entryId,
            text: copied(presaged.payload.text),
          },
    narration:
      narrated === undefined ? null : { eventSeq: narrated.seq, source: narrated.payload.source },
  };

  return zTurnProof.parse(proof);
}
