/**
 * State builders — `aCharacter()`, `aTableState()`, `anEvent()`,
 * `LONG_CAMPAIGN` (`01-architecture.md` section 7.2).
 *
 * Deliberately EMPTY at this point: the shapes they build
 * (`CharacterState`, `CampaignState`, `GameEvent`) only get their defaults with
 * the rules, in M0-10. Writing builders now would mean freezing default values
 * chosen by nobody, and every test written against them would have to be
 * rewritten.
 *
 * The file exists so that `M0-10` has one place to fill and `src/index.ts`
 * already re-exports it.
 */

export {};
