/**
 * What a scenario is, and how one is read off disk.
 *
 * ── WHY THE LOADER IS HAND-WRITTEN AND NOT A ZOD SCHEMA ──────────────────
 * ARCHITECTURE.md section 4.3 puts EVERY Zod schema in `@for/contracts`, game
 * content and AI I/O included. A scenario file is neither: it is this tool's
 * own input, and declaring `zScenario` here would be the second schema home
 * that rule exists to prevent. So the envelope is checked by hand, field by
 * field, and the ONE part that is a contract — the `Intent` itself — goes
 * through the frozen `zIntent` rather than through a copy of it. A scenario
 * that names an intent the protocol does not declare is refused at load time,
 * not discovered three steps later.
 *
 * ── WHY IDENTIFIERS ARE SYMBOLS IN THE FILE AND ULIDS IN THE RUN ─────────
 * `events.id`, `players.id` and `characters.id` are ULIDs — 26 Crockford
 * base32 symbols — and `zGameEvent.parse` refuses anything else. Writing them
 * out in a scenario file would make it unreadable, so a file names a player
 * `PYRA` and the harness pads it (`expandUlid`). The padding is total and
 * reversible, so the same symbol always denotes the same identifier: a golden
 * corpus stays legible AND stays a real ULID.
 *
 * ── WHAT `expect` IS FOR ─────────────────────────────────────────────────
 * The golden corpus pins the whole final state; `expect` pins the handful of
 * facts a READER of the scenario needs to see without opening the corpus —
 * and, for the numbers that come from a rule table, it is the second origin
 * the repository's own rule demands: `ticks: 8` written out here is compared
 * to what `TICKS_PER_MILESTONE.dangereux` produced, never to itself.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zIntent } from '@for/contracts';
import { ENTITY_KINDS } from '@for/engine';

import type { AttributeId, EntityKind, GaugeSet, Intent, Outcome, ProgressRank } from '@for/engine';

/** Where the scenario files live, anchored to THIS file and never to the cwd. */
export const SCENARIO_DIR = fileURLToPath(new URL('../scenarios', import.meta.url));

const SUFFIX = '.scenario.json';

/** Raised when a scenario file is not a scenario. Never a silent skip. */
export class ScenarioUnreadable extends Error {
  constructor(
    readonly file: string,
    readonly detail: string,
  ) {
    super(`scénario illisible (${file}) : ${detail}`);
    this.name = 'ScenarioUnreadable';
  }
}

/** One character, as the bootstrap journal will write it. */
export interface ScenarioCharacter {
  /** Symbol, expanded to a ULID by the harness. */
  readonly symbol: string;
  readonly championId: string;
  readonly displayName: string;
  readonly attributes: Readonly<Record<AttributeId, number>>;
  readonly gauges: GaugeSet;
  readonly momentum: number;
}

export interface ScenarioPlayer {
  /** Symbol, expanded to a ULID by the harness. */
  readonly symbol: string;
  readonly displayName: string;
  readonly character: ScenarioCharacter;
}

/** A non-player entity present in the opening scene. */
export interface ScenarioEntity {
  readonly symbol: string;
  readonly kind: EntityKind;
  readonly displayName: string;
}

/** The scene the campaign opens in, or none. */
export interface ScenarioScene {
  readonly title: string;
  readonly locationName: string;
  /** Entity symbols present. Characters are added by the harness. */
  readonly entities: readonly string[];
}

/** What a step asserts about the table once it has run. */
export interface ScenarioExpectation {
  readonly accepted?: boolean;
  /** A code of the closed `RuleViolation` union. */
  readonly rejection?: string;
  /**
   * The entry types this step APPENDED TO THE JOURNAL, in order.
   *
   * Read by sequence and never from the intent's result: the safety net's
   * `momentum.keep` and the narration entries are journalled and absent from
   * that result (M0-24). A harness that read the result would leave a hole.
   */
  readonly events?: readonly string[];
  /** Whether a burn window is open for this actor once the step has run. */
  readonly window?: 'open' | 'closed';
  /** Gauges and momentum, per character symbol. */
  readonly gauges?: Readonly<Record<string, Partial<GaugeSet> & { readonly momentum?: number }>>;
  /** Progress tracks, in identifier order. */
  readonly tracks?: readonly {
    readonly rank: ProgressRank;
    readonly ticks: number;
    readonly boxes: number;
    readonly status?: string;
  }[];
  /** The outcome the roll of this step settled on. */
  readonly outcome?: Outcome;
  /** Characters whose status must be this, per symbol. */
  readonly characterStatus?: Readonly<Record<string, string>>;
}

export type ScenarioStep =
  | {
      readonly kind: 'intent';
      /** Player symbol. */
      readonly player: string;
      readonly intent: Intent;
      readonly expect?: ScenarioExpectation;
      readonly note?: string;
    }
  | {
      readonly kind: 'speak';
      readonly player: string;
      readonly channel: 'ic' | 'ooc';
      readonly text: string;
      readonly expect?: ScenarioExpectation;
      readonly note?: string;
    }
  /**
   * Closes an open burn window, the way a player does.
   *
   * A SEPARATE KIND RATHER THAN AN `Intent` IN THE FILE, and the reason is
   * the `rollId`: it is minted by the engine at the instant of the roll, so a
   * scenario cannot name it without hard-coding a counter's output. The
   * harness reads the actor's OPEN window and builds a real
   * `momentum.burn` / `momentum.keep` intent from it — the same frame a
   * client sends, resolved one step later.
   */
  | {
      readonly kind: 'burn' | 'keep';
      readonly player: string;
      readonly expect?: ScenarioExpectation;
      readonly note?: string;
    }
  /**
   * Acts on a vow the run itself opened, named by its RANK IN THE STATE.
   *
   * Same reason as `burn` / `keep`: a `TrackId` is minted by the engine at the
   * instant `track_create` runs, so a scenario cannot name it without
   * hard-coding a counter's output — and a corpus that hard-codes one breaks
   * the day an entry is added before it, for a reason that has nothing to do
   * with the rule under test. The harness resolves the identifier from the
   * state and sends a real `move.reach_a_milestone` /
   * `move.fulfill_your_vow` / `move.forsake_your_vow` intent.
   */
  | {
      readonly kind: 'vow';
      readonly player: string;
      readonly action: 'milestone' | 'fulfill' | 'forsake';
      /** Index into the campaign's tracks, sorted by identifier. */
      readonly index: number;
      readonly reason?: string;
      readonly expect?: ScenarioExpectation;
      readonly note?: string;
    }
  /**
   * A journal entry ADDRESSED TO ONE PLAYER, written by the harness itself.
   *
   * WHY IT EXISTS, AND WHY IT IS NOT A CHEAT. In M0 the engine writes
   * `('table', null)` on every entry it produces — `intent-pipeline.ts` says
   * so, and M1 brings the rule that splits a party. So NO scenario driven
   * through `decide()` can produce a `private` entry, and the per-recipient
   * half of invariant 4 would be green because nothing is ever addressed:
   * the exact shape of a check that keeps nothing. This step appends a
   * `system.note` at `scope: 'private'` through the same `appendEvents` the
   * bootstrap uses, so one player's `deliverySeq` advances and the other's
   * does not, and `seq` gains the hole ADR 0010 exists to answer.
   *
   * It does NOT go through `decide()` and it decides nothing: it is a note.
   */
  | {
      readonly kind: 'secret';
      readonly player: string;
      readonly text: string;
      readonly note?: string;
    }
  /** The socket goes away and comes back with the cursor it had. */
  | { readonly kind: 'reconnect'; readonly player: string; readonly note?: string }
  /** The socket asks for what it missed, from the cursor it names. */
  | {
      readonly kind: 'resume';
      readonly player: string;
      readonly sinceDeliverySeq: number;
      readonly note?: string;
    }
  /** Cancels the turn an earlier step opened, by its index. */
  | {
      readonly kind: 'revert';
      readonly step: number;
      readonly reason: string;
      readonly note?: string;
    };

export interface Scenario {
  readonly id: string;
  readonly title: string;
  /** Campaign seed. Every die of the run derives from it. */
  readonly seed: string;
  /** ISO-8601 instant with an explicit timezone. The clock never moves. */
  readonly startedAt: string;
  readonly players: readonly ScenarioPlayer[];
  readonly entities: readonly ScenarioEntity[];
  readonly scene: ScenarioScene | null;
  readonly steps: readonly ScenarioStep[];
  /** Where it was read from, for the report. */
  readonly file: string;
}

// --------------------------------------------------------------- the reader

function asRecord(value: unknown, file: string, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ScenarioUnreadable(file, `${path} n'est pas un objet`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, file: string, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new ScenarioUnreadable(file, `${path} n'est pas un tableau`);
  return value as readonly unknown[];
}

function asString(value: unknown, file: string, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ScenarioUnreadable(file, `${path} n'est pas une chaîne non vide`);
  }
  return value;
}

function asNumber(value: unknown, file: string, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ScenarioUnreadable(file, `${path} n'est pas un nombre`);
  }
  return value;
}

/**
 * A symbol: uppercase Crockford base32 only.
 *
 * `I`, `L`, `O` and `U` are NOT in the alphabet, so a symbol that uses one
 * would pad into a string `zPlayerId` refuses — three steps later, in a parse
 * error that names neither the symbol nor the file. Refused here instead.
 */
const SYMBOL = /^[0-9A-HJKMNP-TV-Z]{1,26}$/;

function asSymbol(value: unknown, file: string, path: string): string {
  const raw = asString(value, file, path);
  if (!SYMBOL.test(raw)) {
    throw new ScenarioUnreadable(
      file,
      `${path} = « ${raw} » n'est pas un symbole Crockford (I, L, O et U exclus, 26 max)`,
    );
  }
  return raw;
}

function readExpectation(value: unknown, file: string, path: string): ScenarioExpectation {
  const raw = asRecord(value, file, path);
  const expectation: Record<string, unknown> = {};
  for (const key of [
    'accepted',
    'rejection',
    'events',
    'window',
    'gauges',
    'tracks',
    'outcome',
    'characterStatus',
  ]) {
    if (raw[key] !== undefined) expectation[key] = raw[key];
  }
  const unknownKeys = Object.keys(raw).filter((key) => expectation[key] === undefined);
  if (unknownKeys.length > 0) {
    throw new ScenarioUnreadable(
      file,
      `${path} porte des clés inconnues : ${unknownKeys.join(', ')}`,
    );
  }
  // NO CAST: `ScenarioExpectation` is all-optional, so the record satisfies
  // it as it stands. What is NOT checked here is the shape INSIDE each
  // field — `events: 42` would get through. It fails loudly one step later,
  // in a comparison that prints both sides, and validating it twice would be
  // the second schema home §4.3 refuses. Said rather than implied.
  return expectation;
}

function readStep(value: unknown, file: string, index: number): ScenarioStep {
  const path = `steps[${String(index)}]`;
  const raw = asRecord(value, file, path);
  const kind = asString(raw['kind'], file, `${path}.kind`);
  const note = raw['note'] === undefined ? undefined : asString(raw['note'], file, `${path}.note`);
  const expect =
    raw['expect'] === undefined
      ? undefined
      : readExpectation(raw['expect'], file, `${path}.expect`);

  switch (kind) {
    case 'intent': {
      const parsed = zIntent.safeParse(raw['intent']);
      if (!parsed.success) {
        throw new ScenarioUnreadable(
          file,
          `${path}.intent est refusée par zIntent : ${parsed.error.issues[0]?.message ?? '?'}`,
        );
      }
      return {
        kind: 'intent',
        player: asSymbol(raw['player'], file, `${path}.player`),
        intent: parsed.data,
        ...(expect === undefined ? {} : { expect }),
        ...(note === undefined ? {} : { note }),
      };
    }
    case 'speak': {
      const channel = asString(raw['channel'], file, `${path}.channel`);
      if (channel !== 'ic' && channel !== 'ooc') {
        throw new ScenarioUnreadable(file, `${path}.channel doit valoir « ic » ou « ooc »`);
      }
      return {
        kind: 'speak',
        player: asSymbol(raw['player'], file, `${path}.player`),
        channel,
        text: asString(raw['text'], file, `${path}.text`),
        ...(expect === undefined ? {} : { expect }),
        ...(note === undefined ? {} : { note }),
      };
    }
    case 'burn':
    case 'keep':
      return {
        kind,
        player: asSymbol(raw['player'], file, `${path}.player`),
        ...(expect === undefined ? {} : { expect }),
        ...(note === undefined ? {} : { note }),
      };
    case 'vow': {
      const action = asString(raw['action'], file, `${path}.action`);
      if (action !== 'milestone' && action !== 'fulfill' && action !== 'forsake') {
        throw new ScenarioUnreadable(file, `${path}.action = « ${action} » est inconnu`);
      }
      return {
        kind: 'vow',
        player: asSymbol(raw['player'], file, `${path}.player`),
        action,
        index: asNumber(raw['index'], file, `${path}.index`),
        ...(raw['reason'] === undefined
          ? {}
          : { reason: asString(raw['reason'], file, `${path}.reason`) }),
        ...(expect === undefined ? {} : { expect }),
        ...(note === undefined ? {} : { note }),
      };
    }
    case 'secret':
      return {
        kind: 'secret',
        player: asSymbol(raw['player'], file, `${path}.player`),
        text: asString(raw['text'], file, `${path}.text`),
        ...(note === undefined ? {} : { note }),
      };
    case 'reconnect':
      return {
        kind: 'reconnect',
        player: asSymbol(raw['player'], file, `${path}.player`),
        ...(note === undefined ? {} : { note }),
      };
    case 'resume':
      return {
        kind: 'resume',
        player: asSymbol(raw['player'], file, `${path}.player`),
        sinceDeliverySeq: asNumber(raw['sinceDeliverySeq'], file, `${path}.sinceDeliverySeq`),
        ...(note === undefined ? {} : { note }),
      };
    case 'revert':
      return {
        kind: 'revert',
        step: asNumber(raw['step'], file, `${path}.step`),
        reason: asString(raw['reason'], file, `${path}.reason`),
        ...(note === undefined ? {} : { note }),
      };
    default:
      throw new ScenarioUnreadable(file, `${path}.kind = « ${kind} » est inconnu`);
  }
}

function readCharacter(value: unknown, file: string, path: string): ScenarioCharacter {
  const raw = asRecord(value, file, path);
  const attributes = asRecord(raw['attributes'], file, `${path}.attributes`);
  const gauges = asRecord(raw['gauges'], file, `${path}.gauges`);
  return {
    symbol: asSymbol(raw['symbol'], file, `${path}.symbol`),
    championId: asString(raw['championId'], file, `${path}.championId`),
    displayName: asString(raw['displayName'], file, `${path}.displayName`),
    attributes: attributes as unknown as Readonly<Record<AttributeId, number>>,
    gauges: gauges as unknown as GaugeSet,
    momentum: asNumber(raw['momentum'], file, `${path}.momentum`),
  };
}

/** One scenario, parsed. Throws rather than returning a partial value. */
export function parseScenario(text: string, file: string): Scenario {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ScenarioUnreadable(file, error instanceof Error ? error.message : String(error));
  }

  const raw = asRecord(json, file, '<racine>');
  const sceneRaw = raw['scene'];
  const scene =
    sceneRaw === null || sceneRaw === undefined
      ? null
      : {
          title: asString(asRecord(sceneRaw, file, 'scene')['title'], file, 'scene.title'),
          locationName: asString(
            asRecord(sceneRaw, file, 'scene')['locationName'],
            file,
            'scene.locationName',
          ),
          entities: asArray(
            asRecord(sceneRaw, file, 'scene')['entities'],
            file,
            'scene.entities',
          ).map((entry, index) => asSymbol(entry, file, `scene.entities[${String(index)}]`)),
        };

  return {
    id: asString(raw['id'], file, 'id'),
    title: asString(raw['title'], file, 'title'),
    seed: asString(raw['seed'], file, 'seed'),
    startedAt: asString(raw['startedAt'], file, 'startedAt'),
    players: asArray(raw['players'], file, 'players').map((entry, index) => {
      const player = asRecord(entry, file, `players[${String(index)}]`);
      return {
        symbol: asSymbol(player['symbol'], file, `players[${String(index)}].symbol`),
        displayName: asString(player['displayName'], file, `players[${String(index)}].displayName`),
        character: readCharacter(player['character'], file, `players[${String(index)}].character`),
      };
    }),
    entities: asArray(raw['entities'] ?? [], file, 'entities').map((entry, index) => {
      const entity = asRecord(entry, file, `entities[${String(index)}]`);
      const kind = asString(entity['kind'], file, `entities[${String(index)}].kind`);
      if (!(ENTITY_KINDS as readonly string[]).includes(kind)) {
        throw new ScenarioUnreadable(
          file,
          `entities[${String(index)}].kind = « ${kind} » est inconnu`,
        );
      }
      return {
        symbol: asSymbol(entity['symbol'], file, `entities[${String(index)}].symbol`),
        kind: kind as EntityKind,
        displayName: asString(
          entity['displayName'],
          file,
          `entities[${String(index)}].displayName`,
        ),
      };
    }),
    scene,
    steps: asArray(raw['steps'], file, 'steps').map((entry, index) => readStep(entry, file, index)),
    file,
  };
}

/** Every scenario of `SCENARIO_DIR`, in file-name order. */
export function loadScenarios(dir: string = SCENARIO_DIR): readonly Scenario[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(SUFFIX))
    .sort((a, b) => a.localeCompare(b, 'en'));
  return files.map((name) => parseScenario(readFileSync(join(dir, name), 'utf8'), name));
}

/**
 * The scenarios a `--scenario=` selector names.
 *
 * A selector that matches NOTHING throws. "Zero scenario ran" must never look
 * like "zero scenario failed" — that is the same green-over-nothing the golden
 * runner refuses for a missing corpus.
 */
export function selectScenarios(
  all: readonly Scenario[],
  selector: string | null,
): readonly Scenario[] {
  if (selector === null) return all;
  const wanted = all.filter(
    (scenario) => scenario.id === selector || scenario.id.startsWith(`${selector}-`),
  );
  if (wanted.length === 0) {
    throw new ScenarioUnreadable(
      selector,
      `aucun scénario ne correspond. Connus : ${all.map((scenario) => scenario.id).join(', ')}`,
    );
  }
  return wanted;
}

/** `PYRA` -> `0000000000000000000000PYRA`, a real ULID, reversibly. */
export function expandUlid(symbol: string): string {
  return symbol.padStart(26, '0');
}

/** The file name a scenario was read from, without its directory. */
export function scenarioFileName(scenario: Scenario): string {
  return basename(scenario.file);
}
