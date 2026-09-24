/**
 * Deterministic identifiers for fixtures.
 *
 * `counterIds('ev')` gives `ev-1`, which is exactly what a golden file wants
 * and exactly what `zEventId` REFUSES: every identifier of the system is a
 * ULID (`primitives.ts`, `ULID_PATTERN`), 26 characters of Crockford base32
 * whose first character is in `[0-7]`. A fixture built with `ev-1` therefore
 * fails `zCampaignState.parse` on its very first key, which is the kind of
 * wasted afternoon this file exists to prevent.
 *
 * So `anId` mints ULID-SHAPED identifiers that stay legible in a diff:
 *
 *   anId('character')    -> 0CHARACTER0000000000000001
 *   anId('character', 2) -> 0CHARACTER0000000000000002
 *   anId('track', 41)    -> 0TRACK00000000000000000019
 *
 * They are NOT real ULIDs — no timestamp, no entropy — and that is deliberate:
 * a real ULID carries the wall clock, which no fixture may read. They only
 * satisfy the SHAPE the contracts check, which is all a fixture needs.
 *
 * The brand is type-only, so one cast is unavoidable. It is here, once, rather
 * than at every call site.
 */

import type {
  AiCallId,
  CampaignId,
  CharacterId,
  ChronicleId,
  ClockId,
  EntityId,
  EventId,
  PlayerId,
  PlaySessionId,
  ProposalId,
  RollId,
  SceneId,
  TrackId,
} from '@for/engine';

/** Crockford base32: no `I`, no `L`, no `O`, no `U`. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const ULID_LENGTH = 26;
/** Characters of the counter part, base32, right-aligned. */
const COUNTER_LENGTH = 8;
/** What is left for the label, between the leading `0` and the counter. */
const LABEL_LENGTH = ULID_LENGTH - 1 - COUNTER_LENGTH;
/** One more than the largest index a counter of `COUNTER_LENGTH` can hold. */
const COUNTER_SPAN = 32 ** COUNTER_LENGTH;

/** Letters Crockford drops, and what it reads them as. `U` has no reading; `V` is adjacent. */
const CONFUSABLE: Readonly<Record<string, string>> = { I: '1', L: '1', O: '0', U: 'V' };

/** What each identifier kind gets as its branded type. */
interface FixtureIds {
  readonly campaign: CampaignId;
  readonly character: CharacterId;
  readonly player: PlayerId;
  readonly event: EventId;
  readonly session: PlaySessionId;
  readonly track: TrackId;
  readonly clock: ClockId;
  readonly entity: EntityId;
  readonly scene: SceneId;
  readonly roll: RollId;
  readonly proposal: ProposalId;
  readonly chronicle: ChronicleId;
  readonly aicall: AiCallId;
}

export type FixtureIdKind = keyof FixtureIds;

function toCrockford(label: string): string {
  let out = '';
  for (const raw of label.toUpperCase()) {
    const mapped = CONFUSABLE[raw] ?? raw;
    if (CROCKFORD.includes(mapped)) {
      out += mapped;
    }
  }
  return out;
}

function toBase32(index: number): string {
  let rest = index;
  let out = '';
  while (rest > 0) {
    out = (CROCKFORD[rest % 32] ?? '0') + out;
    rest = Math.floor(rest / 32);
  }
  return out.padStart(COUNTER_LENGTH, '0');
}

/**
 * A ULID-shaped identifier, branded for the kind asked for.
 *
 * @param kind what the identifier denotes. It also becomes the readable part.
 * @param index 0 to 32^8 - 1. Two calls with the same pair give the same
 * string, which is the whole point: a fixture that called `anId('track')`
 * twice would otherwise build a state pointing at two different tracks.
 */
export function anId<TKind extends FixtureIdKind>(kind: TKind, index = 1): FixtureIds[TKind] {
  if (!Number.isInteger(index) || index < 0 || index >= COUNTER_SPAN) {
    throw new RangeError(
      `anId: index must be an integer in [0, ${String(COUNTER_SPAN - 1)}], got ${String(index)}`,
    );
  }

  const label = toCrockford(kind).slice(0, LABEL_LENGTH).padEnd(LABEL_LENGTH, '0');
  const ulid = `0${label}${toBase32(index)}`;

  // The only cast of the package. Brands exist in the type system alone, so
  // there is no runtime value to produce; `zBrandedId` does the same thing in
  // `@for/contracts`, by way of `z.custom`.
  return ulid as FixtureIds[TKind];
}

/** Largest index `aCorrelationId` can hold in its last UUID group. */
const CORRELATION_SPAN = 2 ** 48;

/**
 * A correlation identifier: the one envelope field that is a UUID and not a
 * ULID, because the CLIENT mints it for idempotence (01-architecture.md
 * section 5.4). Shaped as a v4 so `z.uuid()` accepts it, with the index in the
 * last group so a turn stays readable in a diff.
 */
export function aCorrelationId(index = 1): string {
  if (!Number.isInteger(index) || index < 0 || index >= CORRELATION_SPAN) {
    throw new RangeError(
      `aCorrelationId: index must be an integer in [0, 2^48 - 1], got ${String(index)}`,
    );
  }
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}
