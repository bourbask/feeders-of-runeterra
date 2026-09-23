/**
 * Shared primitives of every schema in this package.
 *
 * TWO RULES GOVERN THIS FILE, and both cost something.
 *
 * 1. THE MIRROR RULE (ARCHITECTURE.md section 4.3). Canonical types live in
 *    `@for/engine` and are imported here with `import type`. Writing
 *    `type X = z.infer<...>` would create the runtime edge
 *    `engine -> contracts` and kill the purity of the engine.
 *
 * 2. `@for/contracts` MAY NOT IMPORT A VALUE FROM `@for/engine`. The
 *    dependency-cruiser rule `contracts-ne-depend-que-de-zod` allows exactly
 *    two edges out of `src/`: `zod`, and TYPE-ONLY imports. So the engine's
 *    `as const` tuples (`ATTRIBUTES`, `RNG_STREAMS`, …) cannot be reused at
 *    runtime: each one is retyped here, and guarded in BOTH directions.
 *
 *    - `satisfies readonly T[]` rejects a member that is not in the engine
 *      union;
 *    - `AssertNever<Exclude<T, Tuple[number]>>` rejects a member the engine
 *      has and the tuple is missing.
 *
 *    One direction alone is inert: a tuple that merely `satisfies` could be
 *    emptied without a single compiler complaint.
 */

import { z } from 'zod';

import type { Branded } from '@for/engine';

/**
 * Compile guard. `T` must be `never`, so any leftover member of a union turns
 * into a type error at its declaration site.
 */
export type AssertNever<T extends never> = T;

/** Crockford base32, 26 characters, first character in `[0-7]`. */
export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** kebab-case ASCII, as 03-donnees.md section 4.2 spells it. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A bare ULID, unbranded. Use a branded one wherever the engine brands it. */
export const zId = z.string().regex(ULID_PATTERN, {
  message: 'doit être un ULID (26 caractères, base32 de Crockford)',
});

/**
 * A ULID carrying the engine's nominal brand.
 *
 * `z.custom` rather than `zId.transform(...)`: the output type is the branded
 * one without a single cast, and a cast here would be the one place where the
 * whole identifier discipline could be lost silently.
 */
export function zBrandedId<TBrand extends string>(brand: TBrand): z.ZodType<Branded<TBrand>> {
  return z.custom<Branded<TBrand>>(
    (value) => typeof value === 'string' && ULID_PATTERN.test(value),
    { message: `doit être un ULID (${brand})` },
  );
}

export const zCampaignId = zBrandedId('CampaignId');
export const zCharacterId = zBrandedId('CharacterId');
export const zPlayerId = zBrandedId('PlayerId');
export const zEventId = zBrandedId('EventId');
export const zPlaySessionId = zBrandedId('PlaySessionId');
export const zTrackId = zBrandedId('TrackId');
export const zClockId = zBrandedId('ClockId');
export const zEntityId = zBrandedId('EntityId');
export const zSceneId = zBrandedId('SceneId');
export const zRollId = zBrandedId('RollId');
export const zProposalId = zBrandedId('ProposalId');
export const zChronicleId = zBrandedId('ChronicleId');
export const zAiCallId = zBrandedId('AiCallId');

/** A table IS a campaign: the product word for the same identifier. */
export const zTableId = zCampaignId;

/**
 * Journal sequence number. Dense and strictly increasing within a campaign,
 * starting at 1 — hence `positive()` and not `nonnegative()`.
 */
export const zSeq = z.number().int().positive();

/** A sequence number read from an event, which may be any journal position. */
export const zEventSeq = z.number().int();

/** Milliseconds since the epoch. The engine never mints one; it receives it. */
export const zEpochMillis = z.number().int();

export const zIsoDate = z.iso.datetime();

/** Campaign RNG seed. Free string, carried, never interpreted here. */
export const zSeed = z.string().min(1).max(128);

export const zSlug = z.string().regex(SLUG_PATTERN, {
  message: 'doit être un slug kebab-case ASCII (ex. « griffe-de-givre »)',
});

/** French text, trimmed, never empty. */
export const zNonEmptyText = z.string().trim().min(1, { message: 'texte français requis' });

/**
 * Groups every event of one turn. A UUID, not a ULID: it is minted by the
 * client for idempotence and by the server for engine-born turns
 * (01-architecture.md section 5.4).
 */
export const zCorrelationId = z.uuid();

/**
 * A short machine string that makes the journal readable — `move:strike/weak`,
 * `price:d12=7`. Never a sentence, never shown as is (engine `EventCause`).
 */
export const zEventCause = z.string().min(1).max(120);

/** Opaque JSON object. Used where the engine carries a payload it never reads. */
export const zJsonObject = z.record(z.string(), z.unknown());
