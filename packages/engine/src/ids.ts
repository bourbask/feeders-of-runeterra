/**
 * Branded identifiers.
 *
 * Every identifier is a ULID at runtime, so they are all `string` and the
 * compiler would happily let a `TrackId` land in a `CharacterId` slot. The
 * brand lives in the type system only and costs nothing at runtime.
 *
 * The engine never MINTS an identifier: it receives an `IdFactory` through the
 * decision context. Generating one here would mean ambient randomness, which
 * is exactly what invariant 4 forbids.
 */

/** A nominal string type. The `__brand` member exists only in the type system. */
export type Branded<TBrand extends string> = string & { readonly __brand: TBrand };

export type CampaignId = Branded<'CampaignId'>;
export type CharacterId = Branded<'CharacterId'>;
export type PlayerId = Branded<'PlayerId'>;
export type EventId = Branded<'EventId'>;
export type PlaySessionId = Branded<'PlaySessionId'>;
export type TrackId = Branded<'TrackId'>;
export type ClockId = Branded<'ClockId'>;
export type EntityId = Branded<'EntityId'>;
export type SceneId = Branded<'SceneId'>;
export type RollId = Branded<'RollId'>;
export type ProposalId = Branded<'ProposalId'>;
export type ChronicleId = Branded<'ChronicleId'>;
export type AiCallId = Branded<'AiCallId'>;

/**
 * Identifier source, injected.
 *
 * The engine calls it from `decide()` only, never from `reduce()`: a reducer
 * that minted identifiers would make a replay diverge from the journal.
 */
export interface IdFactory {
  next(): string;
}
