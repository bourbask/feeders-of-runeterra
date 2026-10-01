/**
 * Les fixtures de `tests/ai` : une table de M0-24 à laquelle on ajoute une
 * scène, un lieu, un PNJ présent et un PNJ parti.
 *
 * ── POURQUOI CE MODULE EST LUI-MÊME UN `.test.ts` ──────────────────────────
 * La même raison qu'en `tests/game` : la configuration ESLint n'attache un
 * programme TypeScript qu'aux `**\/*.test.ts` sous `tests/`. Et la même
 * contrepartie : le module paie sa place en se vérifiant lui-même, en bas de
 * fichier. Une fixture qui a cessé de couvrir ce que la suite suppose est une
 * suite verte qui ne mesure rien.
 *
 * ── LES DOUBLES PRENNENT TOUT CE QUE LE VRAI PREND ─────────────────────────
 * Règle 7 de `RECETTE.md` §3, et elle a déjà coûté une recette : TypeScript
 * accepte une fonction qui prend MOINS de paramètres, donc un argument que le
 * faux ignore disparaît pour toute la suite. `scriptedNarrator` implémente
 * `NarratorPort` en entier — `narrer` reçoit sa `NarrateRequest` et la
 * CONSERVE, `structurer` reçoit sa `StructureRequest` et la conserve aussi —
 * et `recordingSink` implémente les cinq méthodes de `NarrationSink` avec leur
 * charge. Le test « les doubles reçoivent tout ce que le vrai reçoit » en bas
 * de ce fichier le lit sur les objets capturés, pas sur les signatures.
 */

import { appendEvents, writeProjectionsFrom } from '@for/db';
import { describe, expect, it } from 'vitest';

import { loadReplay } from '../../src/game/snapshots.js';
import {
  CAMPAIGN_ID,
  CHARACTER_ID,
  OTHER_CHARACTER_ID,
  OTHER_PLAYER_ID,
  PLAYER_ID,
  aTable,
  counterUlids,
  uuidAt,
} from '../game/support.test.js';

import type {
  NarrateEvent,
  NarrateFinish,
  NarrateRequest,
  NarratorCapabilities,
  NarratorPort,
  StructureRequest,
  StructureResult,
} from '@for/contracts';
import type { AppendableEvent } from '@for/db';
import type {
  NarrationDeltaPayload,
  NarrationDonePayload,
  NarrationErrorPayload,
  NarrationSink,
  NarrationSnapshotPayload,
  NarrationStartedPayload,
} from '../../src/ai/broadcast.js';
import type { AiLogger } from '../../src/ai/refusal.js';
import type { Table } from '../game/support.test.js';

/**
 * Des ULID, pas des slugs lisibles.
 *
 * `zGameEvent` refuse un `entityId` qui n'est pas un ULID, et la fixture passe
 * par le VRAI `appendEvents` puis le VRAI rejeu : un identifiant de confort
 * aurait fait tomber la fixture, ce qui est la bonne nouvelle. Les lettres
 * exclues par Crockford — I, L, O, U — ne figurent dans aucun de ces mots.
 */
export const PLACE_ID = '0000000000000000000000PAC3';
export const NPC_PRESENT_ID = '0000000000000000000000KED1';
export const NPC_GONE_ID = '0000000000000000000000SGR2';
export const NPC_DEAD_ID = '0000000000000000000000TVD3';
export const SCENE_ID = '0000000000000000000000SCN4';

export const PLACE_NAME = 'Le Col des Hurleurs';
export const NPC_PRESENT_NAME = 'Keld';
export const NPC_GONE_NAME = 'Sigrid';
export const NPC_DEAD_NAME = 'Torvald';

const EPOCH = 1_700_000_000_000;

/**
 * La table de `tests/game`, plus une scène ouverte.
 *
 * Trois figurants et pas un : un présent, un PARTI et un MORT. Les trois
 * causes de refus que l'état peut prouver ont chacune leur sujet, et aucune ne
 * se prouve par défaut — c'est ce qui permet de mesurer `refusal_unproven`
 * contre un sujet qui existe vraiment.
 */
export function anAiTable(options: { readonly momentum?: number } = {}): Table {
  const table = aTable(options);
  const ids = counterUlids(2_000_000);

  const envelope = (type: string, payload: unknown): AppendableEvent => ({
    id: ids.next(),
    type,
    payload,
    payloadVersion: 1,
    actorKind: 'system',
    actorPlayerId: null,
    subjectCharacterId: null,
    correlationId: uuidAt(900),
    causationId: null,
    rngStream: null,
    rngDrawIndex: null,
    scope: 'table',
    recipients: null,
    createdAt: EPOCH,
  });

  const entity = (
    id: string,
    kind: string,
    name: string,
    slug: string,
    details: Record<string, unknown> = {},
  ): AppendableEvent =>
    envelope('entity.introduced', {
      entityId: id,
      kind,
      slug,
      name,
      summary: `${name}, au Freljord.`,
      details,
    });

  appendEvents(table.connection, {
    campaignId: CAMPAIGN_ID,
    now: EPOCH,
    events: [
      // LE VERROU DE DISTRIBUTION, posé comme le seed le pose.
      //
      // UN ÉCART, SIGNALÉ : `ARCHITECTURE.md` §4.4 écrit « c'est
      // `character.created` qui pose le verrou », et le réducteur ne le fait
      // PAS — `championLocks` n'est alimenté que par `party.champion_locked`
      // (`reduce.ts`, `case 'character.created'`). Le seed de démonstration
      // écrit donc les deux entrées, et la fixture fait pareil. Mesuré, pas
      // supposé : sans ces deux lignes, `campaign_champion_locks` reste vide
      // et le post-filtre des champions réservés ne garde rien.
      envelope('party.champion_locked', {
        championId: 'ashe',
        lockKind: 'reserved_pc',
        reason: 'Ashe est jouée à cette table',
      }),
      envelope('party.champion_locked', {
        championId: 'braum',
        lockKind: 'reserved_pc',
        reason: 'Braum est joué à cette table',
      }),
      entity(PLACE_ID, 'place', PLACE_NAME, 'col-des-hurleurs'),
      entity(NPC_PRESENT_ID, 'npc', NPC_PRESENT_NAME, 'keld', { placeId: PLACE_ID }),
      entity(NPC_GONE_ID, 'npc', NPC_GONE_NAME, 'sigrid', { placeId: PLACE_ID }),
      entity(NPC_DEAD_ID, 'npc', NPC_DEAD_NAME, 'torvald', { placeId: PLACE_ID }),
      // Le moteur seul tue : S4 et `cible_morte` ne lisent que ça.
      envelope('entity.status_changed', {
        entityId: NPC_DEAD_ID,
        from: 'active',
        to: 'dead',
        cause: 'test:fixture',
      }),
      envelope('scene.started', {
        sceneId: SCENE_ID,
        title: PLACE_NAME,
        entityIds: [PLACE_ID, NPC_PRESENT_ID, NPC_DEAD_ID],
        presentCharacterIds: [CHARACTER_ID, OTHER_CHARACTER_ID],
      }),
      // L'instantané complet de la scène : le lieu, qui est là, qui est parti.
      envelope('scene.facts_updated', {
        sceneId: SCENE_ID,
        placeId: PLACE_ID,
        placeName: PLACE_NAME,
        timeOfDay: 'crépuscule',
        present: [
          { ref: { kind: 'character', id: CHARACTER_ID }, name: 'Ashe', state: '', sinceSeq: 12 },
          {
            ref: { kind: 'entity', id: NPC_PRESENT_ID },
            name: NPC_PRESENT_NAME,
            state: 'adossé au rocher',
            sinceSeq: 12,
          },
        ],
        absent: [
          {
            ref: { kind: 'entity', id: NPC_GONE_ID },
            name: NPC_GONE_NAME,
            cause: 'parti',
            sinceSeq: 12,
          },
        ],
        source: 'engine',
      }),
    ],
  });

  writeProjectionsFrom(table.connection, CAMPAIGN_ID, loadReplay(table.connection, CAMPAIGN_ID));
  return table;
}

// ------------------------------------------------------------- le conteur

export interface ScriptedNarrator extends NarratorPort {
  /** Les requêtes reçues, dans l'ordre. Le double garde TOUT ce qu'on lui donne. */
  readonly narrateRequests: NarrateRequest[];
  readonly structureRequests: StructureRequest<unknown>[];
}

export interface NarratorScript {
  /** Une réponse par appel. Le dernier élément resert si on rappelle. */
  readonly answers: readonly (
    { readonly text: string; readonly finish?: NarrateFinish } | { readonly throws: unknown }
  )[];
  readonly capabilities?: Partial<NarratorCapabilities>;
  readonly providerModel?: string;
  /** Découpe la réponse en fragments de cette taille. 0 = un seul fragment. */
  readonly chunkSize?: number;
  /**
   * Les réponses de `structurer()`. `unknown` porte les deux cas — une valeur
   * rendue, ou `{ throws }` — parce qu'une union avec `unknown` est
   * `unknown` : le discriminant se lit à l'exécution, et il est lu.
   */
  readonly structured?: readonly unknown[];
}

const BASE_CAPABILITIES: NarratorCapabilities = {
  streaming: true,
  tools: false,
  structuredOutput: true,
  promptCache: false,
  contextWindowTokens: 8192,
  maxCacheBreakpoints: 0,
};

/**
 * Un port scripté, complet.
 *
 * `narrer` REND UN `AsyncIterable`, comme le vrai, et il rend exactement un
 * `end` en dernier — contrat 1 du §0.1. Un double qui rendrait le texte d'un
 * coup sans `delta` rendrait la retenue de la balise `<scene_apres>`
 * intestable, ce qui est précisément la chose à mesurer.
 */
export function scriptedNarrator(script: NarratorScript): ScriptedNarrator {
  const narrateRequests: NarrateRequest[] = [];
  const structureRequests: StructureRequest<unknown>[] = [];
  let narrateIndex = 0;
  let structureIndex = 0;

  const answerFor = (): NarratorScript['answers'][number] => {
    const answer = script.answers[Math.min(narrateIndex, script.answers.length - 1)];
    narrateIndex += 1;
    return answer ?? { text: '' };
  };

  const stream = (request: NarrateRequest): AsyncIterable<NarrateEvent> => {
    narrateRequests.push(request);
    const answer = answerFor();
    if ('throws' in answer) {
      // Le port LÈVE, comme le vrai : `NarratorError` est la seule chose qui
      // traverse (§0.1, contrat 3), et un rejet qui ne serait pas une erreur
      // ne ressemblerait à rien de ce que le serveur attrape.
      const thrown = answer.throws;
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(thrown instanceof Error ? thrown : new Error(String(thrown))),
        }),
      };
    }
    const size = script.chunkSize ?? 0;
    const pieces =
      size <= 0
        ? [answer.text]
        : (answer.text.match(new RegExp(`[^]{1,${String(size)}}`, 'gu')) ?? []);
    const events: NarrateEvent[] = pieces
      .filter((piece) => piece.length > 0)
      .map((piece) => ({ type: 'delta', text: piece }));
    events.push({
      type: 'end',
      result: {
        text: answer.text,
        finish: answer.finish ?? 'complete',
        toolCalls: [],
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
        },
        providerModel: script.providerModel ?? 'stub:narration',
        latencyMs: 12,
      },
    });
    return {
      [Symbol.asyncIterator]: () => {
        const iterator = events[Symbol.iterator]();
        return { next: () => Promise.resolve(iterator.next()) };
      },
    };
  };

  return {
    providerId: 'stub',
    capabilities: { ...BASE_CAPABILITIES, ...(script.capabilities ?? {}) },
    narrer: stream,
    structurer: <T>(request: StructureRequest<T>): Promise<StructureResult<T>> => {
      structureRequests.push(request);
      const answers = script.structured ?? [];
      const answer = answers[Math.min(structureIndex, Math.max(0, answers.length - 1))];
      structureIndex += 1;
      if (answer !== null && typeof answer === 'object' && 'throws' in answer) {
        const thrown = (answer as { readonly throws: unknown }).throws;
        return Promise.reject(thrown instanceof Error ? thrown : new Error(String(thrown)));
      }
      return Promise.resolve({
        value: answer as T,
        usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
        providerModel: script.providerModel ?? 'stub:structured',
        latencyMs: 7,
        repairPasses: 0,
      });
    },
    narrateRequests,
    structureRequests,
  };
}

// --------------------------------------------------------------- les sinks

export type SinkFrame =
  | { readonly t: 's2c.narration_started'; readonly p: NarrationStartedPayload }
  | { readonly t: 's2c.narration_delta'; readonly p: NarrationDeltaPayload }
  | { readonly t: 's2c.narration_snapshot'; readonly p: NarrationSnapshotPayload }
  | { readonly t: 's2c.narration_done'; readonly p: NarrationDonePayload }
  | { readonly t: 's2c.narration_error'; readonly p: NarrationErrorPayload };

export interface RecordingSink extends NarrationSink {
  readonly frames: SinkFrame[];
}

/** Un destinataire qui garde ce qu'il a reçu, charge comprise. */
export function recordingSink(playerId: string, into: SinkFrame[] = []): RecordingSink {
  return {
    playerId,
    frames: into,
    started: (p) => into.push({ t: 's2c.narration_started', p }),
    delta: (p) => into.push({ t: 's2c.narration_delta', p }),
    snapshot: (p) => into.push({ t: 's2c.narration_snapshot', p }),
    done: (p) => into.push({ t: 's2c.narration_done', p }),
    error: (p) => into.push({ t: 's2c.narration_error', p }),
  };
}

// -------------------------------------------------------------- le journal

export interface LoggedLine {
  readonly level: 'warn';
  readonly fields: Record<string, unknown>;
  readonly message: string;
}

export interface CapturingLogger extends AiLogger {
  readonly lines: LoggedLine[];
}

/** Le logger, avec ses DEUX paramètres. Un faux à un seul les perdrait. */
export function capturingLogger(): CapturingLogger {
  const lines: LoggedLine[] = [];
  return {
    lines,
    warn: (fields, message) => {
      lines.push({ level: 'warn', fields, message });
    },
  };
}

/** Une horloge qu'on avance à la main. */
export function movableClock(start = EPOCH): { now(): number; advance(ms: number): void } {
  let value = start;
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

// ---------------------------------------------------------------- vérifications

describe('les fixtures de tests/ai', () => {
  it('ouvre une scène portant un présent, un parti et un mort', () => {
    const table = anAiTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect(state.scene?.placeId).toBe(PLACE_ID);
      expect(state.scene?.present.map((entry) => entry.name).sort()).toEqual(
        ['Ashe', NPC_PRESENT_NAME].sort(),
      );
      expect(state.scene?.absent).toEqual([
        {
          ref: { kind: 'entity', id: NPC_GONE_ID },
          name: NPC_GONE_NAME,
          cause: 'parti',
          sinceSeq: 12,
        },
      ]);
      // Le mort est mort DANS LA PROJECTION : `cible_morte` ne lit que ça.
      expect(state.entities[NPC_DEAD_ID as never]?.status).toBe('dead');
      // ET LES DEUX VERROUS sont dans la projection : c'est eux que le
      // post-filtre relit au retour de la prose.
      const locks = table.connection
        .prepare(
          `SELECT champion_id, lock_kind FROM campaign_champion_locks
            WHERE campaign_id = ? ORDER BY champion_id`,
        )
        .all(CAMPAIGN_ID);
      expect(locks).toEqual([
        { champion_id: 'ashe', lock_kind: 'reserved_pc' },
        { champion_id: 'braum', lock_kind: 'reserved_pc' },
      ]);
    } finally {
      table.close();
    }
  });

  it('les doubles reçoivent tout ce que le vrai reçoit', async () => {
    const narrator = scriptedNarrator({ answers: [{ text: 'Trois phrases.' }] });
    const request: NarrateRequest = {
      purpose: 'narration',
      requestId: 'req-1',
      system: [{ type: 'text', text: 'système' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'utilisateur' }] }],
      tools: [],
      toolPolicy: 'none',
      maxOutputTokens: 800,
      effort: 'low',
    };
    const seen: unknown[] = [];
    for await (const event of narrator.narrer(request)) seen.push(event);
    // Le flux rend au moins son `end` : la sonde n'est pas vide.
    expect(seen.length).toBeGreaterThan(0);
    // La requête ENTIÈRE est conservée, pas son seul identifiant : un double
    // qui n'aurait gardé que `requestId` rendrait invisible tout le reste.
    expect(narrator.narrateRequests).toEqual([request]);

    const frames: SinkFrame[] = [];
    const sink = recordingSink('joueur', frames);
    sink.delta({ narrationId: 'n', chunk: 3, text: 'tt' });
    expect(frames).toEqual([
      { t: 's2c.narration_delta', p: { narrationId: 'n', chunk: 3, text: 'tt' } },
    ]);

    const logger = capturingLogger();
    logger.warn({ event: 'x' }, 'message');
    expect(logger.lines).toEqual([{ level: 'warn', fields: { event: 'x' }, message: 'message' }]);
  });

  it('l’horloge avance de ce qu’on lui demande, et de rien d’autre', () => {
    const clock = movableClock(1000);
    clock.advance(50);
    expect(clock.now()).toBe(1050);
  });
});

export { CAMPAIGN_ID, CHARACTER_ID, OTHER_CHARACTER_ID, OTHER_PLAYER_ID, PLAYER_ID, uuidAt };
