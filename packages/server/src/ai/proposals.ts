/**
 * The proposal sink: what the server does with a `propose_*` call.
 *
 * `@for/ai` validates the arguments against `TOOL_INPUT_SCHEMAS` and hands
 * them over; this file decides, writes and answers. Every entry it appends
 * goes through `gateEvents(PROPOSAL_CIRCUIT, …)`, which is where circuit 1 of
 * invariant 1 closes.
 *
 * ── PROSE-ONLY MODE, AND WHY THIS EXISTS ANYWAY ──────────────────────────
 * ADR 0011 sends no tool definition, on any turn, so in M0 nothing calls this
 * sink through a model. It is not dead code for two reasons. First, the GATE
 * is what `tests/proposal-surface.test.ts` exercises, and a gate written the
 * day tools come back is a gate written after the hole. Second, the
 * `<scene_apres>` block is not a tool but takes the SAME circuit
 * (`scene-state.ts`), so circuit 1 is live today whatever the tool table says.
 *
 * ── `propose_scene_transition` DOES NOT MAKE TIME PASS (P11) ─────────────
 * It carries exactly two keys — `to_place_id` and `new_place_name` — and it
 * produces exactly `scene.ended` then `scene.started`. No gauge, no cost, no
 * clock. The elapsed time of a turn, and its price, come from the MOVE that
 * was played, which the engine already resolved. A handler that grew a cost
 * would produce a `character.gauge_changed`, and circuit 1 does not list one:
 * `gateEvents` throws, and `tests/proposal-surface.test.ts` reads the throw —
 * « un coût ajouté au transfert de scène tombe sur la première liste close ».
 *
 * ── EVERY PROPOSAL LEAVES A TRACE ────────────────────────────────────────
 * 03-donnees.md section 0.5: "Toute proposition `propose_*` produit, dans tous
 * les cas, un `narration.proposal_accepted` ou `narration.proposal_rejected`.
 * Une proposition sans trace est un bug." So `narration.gm_proposal` is
 * written first, and one of the two answers always follows.
 *
 * ── A DIVERGENCE, REPORTED ───────────────────────────────────────────────
 * `packages/contracts/src/ai/tools.ts` says the engine caps a clock advance
 * with `MAX_CLOCK_ADVANCE_BY_OUTCOME`. THERE IS NO SUCH EXPORT: the name
 * appears in that comment and nowhere else in the repository. The cap of
 * ARCHITECTURE.md section 4.4 — franche 0, partielle 1, echec 2, +1 on a
 * presage — is therefore written here, in `clockAdvanceCap`, and it belongs in
 * `@for/engine` beside the rest of the rules. Reported rather than left to be
 * discovered by whoever adds the engine constant later and finds a second one.
 */

import { PROPOSAL_TOOL_NAMES, TOOL_INPUT_SCHEMAS } from '@for/contracts';
import { appendEvents } from '@for/db';

import { toAppendable } from '../game/intent-pipeline.js';
import { PROPOSAL_CIRCUIT, gateEvents } from './proposal-surface.js';

import type { ProposalToolName } from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type {
  CampaignState,
  ClockId,
  EntityId,
  EventId,
  GameEvent,
  IdFactory,
  Outcome,
  ProposalId,
  SceneId,
} from '@for/engine';

/**
 * ARCHITECTURE.md section 4.4: how many segments an outcome allows.
 *
 * Written out in full rather than derived, because the four values ARE the
 * rule. `+1 si presage` is the second argument.
 */
export function clockAdvanceCap(outcome: Outcome | null, isPresage: boolean): number {
  const base = outcome === 'franche' ? 0 : outcome === 'partielle' ? 1 : outcome === null ? 0 : 2;
  return base + (isPresage ? 1 : 0);
}

export interface ProposalContext {
  readonly campaignId: string;
  readonly correlationId: string;
  readonly state: CampaignState;
  /** The turn's outcome, for the clock cap. `null` outside a move. */
  readonly outcome: Outcome | null;
  readonly isPresage: boolean;
  readonly now: number;
}

export interface ProposalDeps {
  readonly connection: SqliteConnection;
  readonly ids: IdFactory;
}

export interface ProposalAnswer {
  readonly status: 'applied' | 'adjusted' | 'rejected';
  readonly reason: string | null;
  readonly applied: Record<string, unknown> | null;
  /** Sequences the proposal produced, ascending. Empty on a refusal. */
  readonly resultingEventSeqs: readonly number[];
}

interface Built {
  readonly events: readonly GameEvent[];
  readonly status: 'applied' | 'adjusted';
  readonly reason: string | null;
  readonly applied: Record<string, unknown>;
}

type BuildResult = Built | { readonly rejected: string };

const isRejected = (value: BuildResult): value is { readonly rejected: string } =>
  'rejected' in value;

/**
 * Apply one proposal.
 *
 * It NEVER throws on the model's account: a shape the schema refuses, an
 * identifier that does not exist, a place nobody knows — all of them answer
 * `rejected` and journal one. The only throw is `gateEvents`, and that one is
 * about OUR code growing a consequence.
 */
export function applyProposal(
  deps: ProposalDeps,
  context: ProposalContext,
  tool: ProposalToolName,
  rawInput: unknown,
): ProposalAnswer {
  const proposalId = deps.ids.next();
  let offset = 1;
  const next = (): number => {
    const value = offset;
    offset += 1;
    return value;
  };

  const trace = event(deps, context, next(), null, 'narration.gm_proposal', {
    proposalId: proposalId as ProposalId,
    kind: KIND_OF[tool],
    payload: rawInput,
  });
  append(deps, context, [trace]);

  const parsed = TOOL_INPUT_SCHEMAS[tool].safeParse(rawInput);
  const built: BuildResult = parsed.success
    ? build(deps, context, tool, parsed.data, next)
    : { rejected: 'arguments hors schéma' };

  if (isRejected(built)) {
    const rejected = event(deps, context, next(), trace.id, 'narration.proposal_rejected', {
      proposalId: proposalId as ProposalId,
      reasonCode: built.rejected,
      validationErrors: [],
    });
    append(deps, context, [rejected]);
    return { status: 'rejected', reason: built.rejected, applied: null, resultingEventSeqs: [] };
  }

  // CIRCUIT 1'S GATE, before anything reaches the journal.
  gateEvents(PROPOSAL_CIRCUIT, built.events);
  const seqs = append(deps, context, built.events);

  const accepted = event(deps, context, next(), trace.id, 'narration.proposal_accepted', {
    proposalId: proposalId as ProposalId,
    resultingEventSeqs: seqs,
  });
  append(deps, context, [accepted]);

  return {
    status: built.status,
    reason: built.reason,
    applied: built.applied,
    resultingEventSeqs: seqs,
  };
}

/** `narration.gm_proposal.kind`, one per tool. The map is total by type. */
const KIND_OF: Record<ProposalToolName, 'entity' | 'clock' | 'thread' | 'lore_fact' | 'scene'> = {
  propose_npc_introduce: 'entity',
  propose_clock_create: 'clock',
  propose_clock_advance: 'clock',
  propose_thread_open: 'thread',
  propose_lore_fact: 'lore_fact',
  propose_scene_transition: 'scene',
  propose_vow_hook: 'thread',
};

/** The seven, named here so nothing iterates a list it also defines. */
export const PROPOSAL_TOOLS: readonly ProposalToolName[] = PROPOSAL_TOOL_NAMES;

function build(
  deps: ProposalDeps,
  context: ProposalContext,
  tool: ProposalToolName,
  input: unknown,
  next: () => number,
): BuildResult {
  switch (tool) {
    case 'propose_npc_introduce': {
      const value = input as { name: string; role: string; one_line: string; place_id: string };
      const entityId = deps.ids.next() as EntityId;
      return {
        status: 'applied',
        reason: null,
        applied: { entityId, name: value.name },
        events: [
          event(deps, context, next(), null, 'entity.introduced', {
            entityId,
            kind: 'npc',
            slug: slugify(value.name),
            name: value.name,
            summary: value.one_line,
            details: { role: value.role, placeId: value.place_id },
          }),
        ],
      };
    }

    case 'propose_thread_open': {
      const value = input as { title: string; summary: string };
      const entityId = deps.ids.next() as EntityId;
      return {
        status: 'applied',
        reason: null,
        applied: { entityId, title: value.title },
        events: [
          event(deps, context, next(), null, 'entity.introduced', {
            entityId,
            kind: 'thread',
            slug: slugify(value.title),
            name: value.title,
            summary: value.summary,
            details: {},
          }),
        ],
      };
    }

    case 'propose_lore_fact': {
      const value = input as { statement: string; tied_to_id: string };
      const target = context.state.entities[value.tied_to_id as EntityId];
      if (target === undefined) return { rejected: 'entité inconnue' };
      return {
        status: 'applied',
        reason: null,
        applied: { entityId: target.id },
        events: [
          event(deps, context, next(), null, 'entity.updated', {
            entityId: target.id,
            patch: { details: { ...target.details, lore: value.statement } },
            before: { details: target.details },
          }),
        ],
      };
    }

    case 'propose_clock_create': {
      const value = input as { name: string; segments: 4 | 6 | 8 | 10; rationale: string };
      const clockId = deps.ids.next() as ClockId;
      return {
        status: 'applied',
        reason: null,
        applied: { clockId, segments: value.segments },
        events: [
          event(deps, context, next(), null, 'clock.created', {
            clockId,
            title: value.name,
            description: value.rationale,
            segments: value.segments,
            visibility: 'public',
            consequence: '',
          }),
        ],
      };
    }

    case 'propose_clock_advance': {
      const value = input as { clock_id: string; segments: number };
      const clock = context.state.clocks[value.clock_id as ClockId];
      if (clock === undefined) return { rejected: 'horloge inconnue' };
      // THE ENGINE'S CAP WINS OVER THE ASK. An over-ask is adjusted, never
      // refused — the model proposed a direction, the rules decide the size.
      const cap = clockAdvanceCap(context.outcome, context.isPresage);
      const delta = Math.min(value.segments, cap);
      if (delta <= 0) return { rejected: 'issue sans avance possible' };
      const to = Math.min(clock.filled + delta, clock.segments);
      return {
        status: delta === value.segments ? 'applied' : 'adjusted',
        reason: delta === value.segments ? null : `avance ramenée à ${String(delta)} par l'issue`,
        applied: { clockId: clock.id, from: clock.filled, to },
        events: [
          event(deps, context, next(), null, 'clock.advanced', {
            clockId: clock.id,
            delta: to - clock.filled,
            from: clock.filled,
            to,
            cause: 'gm:proposal',
          }),
        ],
      };
    }

    case 'propose_scene_transition': {
      const value = input as { to_place_id: string; new_place_name: string };
      const place = context.state.entities[value.to_place_id as EntityId];
      if (place?.kind !== 'place') return { rejected: 'lieu inconnu' };
      const sceneId = deps.ids.next() as SceneId;
      const ending = context.state.scene?.sceneId ?? null;
      const events: GameEvent[] = [];
      if (ending !== null) {
        events.push(event(deps, context, next(), null, 'scene.ended', { sceneId: ending }));
      }
      events.push(
        event(deps, context, next(), null, 'scene.started', {
          sceneId,
          title: value.new_place_name.length > 0 ? value.new_place_name : place.name,
          entityIds: [place.id],
          presentCharacterIds: Object.values(context.state.characters)
            .filter((character) => character.status === 'active')
            .map((character) => character.id),
        }),
      );
      // NOTHING ELSE. P11: a scene transition is a change of PLACE. The time
      // that passed, and what it costs, came out of the move the engine
      // already resolved.
      return {
        status: 'applied',
        reason: null,
        applied: { sceneId, placeId: place.id },
        events,
      };
    }

    case 'propose_vow_hook':
      // Section 3.3: the offer is EPHEMERAL, and only the player may swear.
      // No state entry, and that absence is the rule — a hook that wrote one
      // would be the model opening a progress track.
      return { status: 'applied', reason: 'offre éphémère', applied: {}, events: [] };
  }
}

// ------------------------------------------------------------------- helpers

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/(^-|-$)/gu, '');
}

function event<TType extends GameEvent['type']>(
  deps: ProposalDeps,
  context: ProposalContext,
  offset: number,
  causationId: EventId | null,
  type: TType,
  payload: Extract<GameEvent, { type: TType }>['payload'],
): Extract<GameEvent, { type: TType }> {
  return {
    id: deps.ids.next() as EventId,
    campaignId: context.state.campaignId,
    seq: context.state.seq + offset,
    playSessionId: null,
    payloadVersion: 1,
    // The SERVER writes what it validated. The model proposed.
    actorKind: 'engine',
    actorPlayerId: null,
    subjectCharacterId: null,
    correlationId: context.correlationId,
    causationId,
    rngStream: null,
    rngDrawIndex: null,
    createdAt: context.now,
    scope: 'table',
    recipients: null,
    type,
    payload,
  } as Extract<GameEvent, { type: TType }>;
}

function append(
  deps: ProposalDeps,
  context: ProposalContext,
  events: readonly GameEvent[],
): readonly number[] {
  if (events.length === 0) return [];
  const appended = appendEvents(deps.connection, {
    campaignId: context.campaignId,
    events: events.map((entry) => toAppendable(entry, context.correlationId)),
    now: context.now,
  });
  return appended.events.map((row) => row.seq);
}
