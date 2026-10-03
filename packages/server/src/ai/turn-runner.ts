/**
 * `runNarrationTurn` HAD NO CALLER. This is the caller.
 *
 * M0-29 wrote the whole storyteller turn — the prompt, the stream, the
 * post-filter, the retry ladder, the circuit breaker, the refusal, the scene
 * block, the fallback — and nothing in the server ever ran it: the intent path
 * still went through `intent-pipeline.ts::narrate`, M0-24's placeholder (one
 * call, the brief as JSON, no prompt). This file builds `TurnDeps` once per
 * process and hands `gamePlugin` a `NarrateTurn` the pipeline can await.
 *
 * ── WHAT IS BUILT ONCE, AND WHAT IS BUILT PER TURN ───────────────────────
 * The system prompt, the dispatcher, the breaker and the delivery are
 * process-wide. The CAMPAIGN BLOCK is per campaign and per turn: it names the
 * characters at the table and the champions reserved by the others, and both
 * move when a player joins. `buildCampaignBlock` sorts by identifier and
 * renders deterministically, so at equal data the bytes are equal and the
 * cached prefix does not move (02-mj-ia.md section 4.2).
 *
 * ── TWO FIELDS OF THE CAMPAIGN BLOCK HAVE NO SOURCE IN M0, AND IT IS SAID ─
 * `CampaignBlockCharacter` asks for `pronouns` and `oneLine`.
 *
 *   - `pronouns` exists NOWHERE: not on `CharacterState`, not on
 *     `ChampionSchema`, not in the campaign settings. There is no field to
 *     read, so the block says « pronoms non précisés » rather than guessing a
 *     player's. Giving the model an invented pronoun is worse than giving it
 *     none;
 *   - `oneLine` falls back to the champion's own `pitch` — « one sentence,
 *     shown on the character-choice screen », which is exactly what the block
 *     wants — and to the champion's `title` when the sheet is forged and the
 *     content has no entry.
 *
 * Both are reported, not papered over: a character description written by its
 * player is a field `characters` does not have, and adding it is a schema
 * change plus a migration.
 *
 * ── THE TONE COMES FROM THE CAMPAIGN'S OWN SETTINGS ──────────────────────
 * `CampaignSettings.gmVerbosity` is the only authored dial M0 has for how the
 * storyteller speaks, and it is rendered as the tone line. HELD BY
 * `tests/ai/turn-runner.test.ts`, « le bloc de campagne porte le réglage de la
 * table, pas une constante » — two campaigns, two settings, two blocks.
 */

import { CONTEUR_SYSTEM_PROMPT, buildCampaignBlock } from '@for/ai';

import { NarratorBreaker } from './calls.js';
import { championLocks, championOfCharacter } from './lockout.js';
import { runNarrationTurn } from './turn.js';

import type { CampaignBlockCharacter, CampaignBlockNpc } from '@for/ai';
import type { ContentRegistry } from '@for/content';
import type { NarratorPort } from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type { CampaignState, FallbackTemplates, IdFactory, Rng } from '@for/engine';
import type { RngSource, TimeSource } from '../deps.js';
import type { NarrateTurn } from '../game/intent-pipeline.js';
import type { EventDelivery } from '../game/types.js';
import type { NarrationDispatcher } from './broadcast.js';
import type { AiLogger } from './refusal.js';

/** 02-mj-ia.md section 2.2: the tone line, from the only dial M0 authors. */
const TONE_BY_VERBOSITY: Readonly<Record<CampaignState['settings']['gmVerbosity'], string>> = {
  sobre: 'sobre et sec — on coupe plutôt que d’allonger',
  standard: 'âpre et concret, à la façon des sagas',
  ample: 'ample, mais jamais ornemental',
};

/** No field carries this in M0. See the header. */
const PRONOUNS_UNKNOWN = 'pronoms non précisés';

export interface TurnRunnerOptions {
  readonly connection: SqliteConnection;
  readonly content: ContentRegistry;
  readonly narrator: NarratorPort;
  readonly ids: IdFactory;
  readonly clock: TimeSource;
  readonly logger: AiLogger;
  readonly dispatcher: NarrationDispatcher;
  readonly delivery: EventDelivery;
  readonly fallbacks: FallbackTemplates;
  readonly rng: RngSource;
  /** In [0, 1), for the retry backoff. Injected: a wait is a value. */
  readonly jitter?: () => number;
  /** Awaits `ms`. Injected so a test does not sleep. */
  readonly wait?: (ms: number) => Promise<void>;
}

/**
 * The characters at the table, as the prompt names them.
 *
 * SORTED BY `buildCampaignBlock` ITSELF, not here: two renderings of one list
 * must not disagree about order, and the one that renders is the one that
 * sorts.
 */
export function campaignBlockCharacters(
  options: Pick<TurnRunnerOptions, 'connection' | 'content'>,
  campaignId: string,
  state: CampaignState,
): readonly CampaignBlockCharacter[] {
  return Object.values(state.characters).map((character) => {
    const championId =
      championOfCharacter(options.connection, campaignId, character.id) ?? character.championId;
    const champion = options.content.findChampion(championId);
    return {
      id: character.id,
      name: character.displayName,
      championDisplayName: champion?.name ?? championId,
      pronouns: PRONOUNS_UNKNOWN,
      oneLine: champion?.pitch ?? champion?.title ?? 'pas de description',
    };
  });
}

/** The champions the storyteller MAY summon: the campaign's `allowed_npc` locks. */
export function campaignBlockNpcs(
  options: Pick<TurnRunnerOptions, 'connection' | 'content'>,
  campaignId: string,
): readonly CampaignBlockNpc[] {
  return championLocks(options.connection, campaignId)
    .filter((lock) => lock.lockKind === 'allowed_npc')
    .map((lock) => {
      const champion = options.content.findChampion(lock.championId);
      return {
        id: lock.championId,
        name: champion?.name ?? lock.championId,
        role: champion?.title ?? 'figure du Freljord',
        oneLine: champion?.pitch ?? 'pas de description',
      };
    });
}

/** The reserved half: the champions the OTHER players of this table hold. */
export function campaignBlockReserved(
  options: Pick<TurnRunnerOptions, 'connection' | 'content'>,
  campaignId: string,
): readonly { id: string; displayName: string; aliases: readonly string[] }[] {
  return championLocks(options.connection, campaignId)
    .filter((lock) => lock.lockKind === 'reserved_pc')
    .map((lock) => {
      const entry = options.content
        .listChampionIndex()
        .find((champion) => champion.id === lock.championId);
      return {
        id: lock.championId,
        displayName: entry?.displayName ?? lock.championId,
        aliases: entry?.aliases ?? [],
      };
    });
}

/** `system[1]`, for one campaign at one instant. */
export function buildCampaignBlockFor(
  options: Pick<TurnRunnerOptions, 'connection' | 'content'>,
  campaignId: string,
  campaignName: string,
  state: CampaignState,
): string {
  return buildCampaignBlock({
    name: campaignName,
    tone: TONE_BY_VERBOSITY[state.settings.gmVerbosity],
    houseRules: null,
    characters: campaignBlockCharacters(options, campaignId, state),
    reservedChampions: campaignBlockReserved(options, campaignId),
    allowedNpcs: campaignBlockNpcs(options, campaignId),
  });
}

/**
 * The `NarrateTurn` the intent pipeline awaits.
 *
 * IT NEVER THROWS ON THE PORT'S ACCOUNT — `runNarrationTurn` says so and holds
 * it — and this wrapper does not add a `try` around it: a failure that escapes
 * is a failure of the DATABASE or of this composition, and swallowing it here
 * would hide the one class of bug the fallback does not cover. The game state
 * is already committed and already delivered when this runs, which is what
 * makes letting it propagate safe: the caller logs it and the turn stands.
 */
export function createTurnRunner(options: TurnRunnerOptions): NarrateTurn {
  const breaker = new NarratorBreaker();
  const fallbackRng = (state: CampaignState): Rng =>
    options.rng.forCampaign(state.rng.seed, state.seq + 1, 'fallback');

  return async (input) => {
    const campaignName = campaignNameOf(options.connection, input.campaignId);
    await runNarrationTurn(
      {
        connection: options.connection,
        content: options.content,
        narrator: options.narrator,
        ids: options.ids,
        clock: options.clock,
        logger: options.logger,
        dispatcher: options.dispatcher,
        breaker,
        delivery: options.delivery,
        fallbacks: options.fallbacks,
        fallbackRng,
        campaignBlock: buildCampaignBlockFor(options, input.campaignId, campaignName, input.state),
        systemPrompt: CONTEUR_SYSTEM_PROMPT,
        jitter: options.jitter ?? (() => 0),
        wait: options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      },
      {
        campaignId: input.campaignId,
        brief: input.brief,
        state: input.state,
        sinceSeq: input.sinceSeq,
        now: options.clock.now(),
      },
    );
  };
}

/** The table's name, for the first line of the block. */
function campaignNameOf(connection: SqliteConnection, campaignId: string): string {
  const row = connection.prepare(`SELECT name FROM campaigns WHERE id = ?`).get(campaignId) as
    { name: string } | undefined;
  return row?.name ?? campaignId;
}
