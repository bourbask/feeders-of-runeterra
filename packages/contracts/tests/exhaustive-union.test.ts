/**
 * THE DIRECTION `satisfies` CANNOT SEE.
 *
 * `zGameEvent satisfies z.ZodType<GameEvent>` fails when the schema FORGETS a
 * variant the engine declares. It does NOT fail when the schema INVENTS one:
 * an output type with an extra member is still assignable to the union it
 * extends, so `tsc` stays quiet. Same for `zIntent`, same for every mirrored
 * enum in `core/enums.ts`.
 *
 * That is not a theoretical hole. A typo in a discriminant — `roll.presage_drawn`
 * written `roll.presage_draw` — passes the compiler as an extra member and
 * silently loses the real one. This file is what catches it, by comparing the
 * runtime lists in both directions.
 */
import {
  ATTRIBUTES,
  CLOCK_SEGMENT_COUNTS,
  ENGINE_ONLY_EVENT_TYPES,
  ENTITY_KINDS,
  GAME_EVENT_TYPES,
  GAUGES,
  INTENT_TYPES,
  MOVE_IDS,
  OUTCOMES,
  PROGRESS_RANKS,
  RNG_STREAMS,
  RULE_VIOLATION_CODES,
  SCENE_ABSENCE_CAUSES,
} from '@for/engine';
import { describe, expect, it } from 'vitest';

import {
  zAttributeId,
  zClockSegmentCount,
  zEntityKind,
  zGaugeId,
  zMoveId,
  zOutcome,
  zProgressRank,
  zRngStream,
  zRuleViolationCode,
  zSceneAbsenceCause,
} from '../src/core/enums.js';
import { gameEventTypesOfSchema } from '../src/events/index.js';
import { intentTypesOfSchema } from '../src/intents/index.js';

describe('exhaustivité des unions', () => {
  it('zGameEvent et GAME_EVENT_TYPES portent exactement les mêmes membres', () => {
    expect(gameEventTypesOfSchema()).toStrictEqual([...GAME_EVENT_TYPES]);
  });

  it('zIntent et INTENT_TYPES portent exactement les mêmes membres', () => {
    expect(intentTypesOfSchema()).toStrictEqual([...INTENT_TYPES]);
  });

  it('aucune variante dupliquée dans zGameEvent ni dans zIntent', () => {
    const events = gameEventTypesOfSchema();
    const intents = intentTypesOfSchema();
    expect(new Set(events).size).toBe(events.length);
    expect(new Set(intents).size).toBe(intents.length);
  });

  it('tous les types réservés au moteur existent dans le schéma', () => {
    const declared = new Set(gameEventTypesOfSchema());
    for (const type of ENGINE_ONLY_EVENT_TYPES) {
      expect(declared.has(type), `${type} est absent de zGameEvent`).toBe(true);
    }
  });

  // Les enums sont recopiés à la main (contracts ne peut pas importer une
  // VALEUR du moteur : règle `contracts-ne-depend-que-de-zod`). La recopie est
  // gardée à la compilation dans les deux sens ; ce test le redit à l'exécution,
  // parce qu'une recopie est exactement le genre de chose qu'on croit juste.
  it.each([
    ['RNG_STREAMS', [...RNG_STREAMS], zRngStream.options],
    ['ATTRIBUTES', [...ATTRIBUTES], zAttributeId.options],
    ['GAUGES', [...GAUGES], zGaugeId.options],
    ['MOVE_IDS', [...MOVE_IDS], zMoveId.options],
    ['OUTCOMES', [...OUTCOMES], zOutcome.options],
    ['PROGRESS_RANKS', [...PROGRESS_RANKS], zProgressRank.options],
    ['ENTITY_KINDS', [...ENTITY_KINDS], zEntityKind.options],
    ['SCENE_ABSENCE_CAUSES', [...SCENE_ABSENCE_CAUSES], zSceneAbsenceCause.options],
    ['RULE_VIOLATION_CODES', [...RULE_VIOLATION_CODES], zRuleViolationCode.options],
  ])('%s : le miroir Zod a les mêmes membres, dans le même ordre', (_name, engine, schema) => {
    expect(schema).toStrictEqual(engine);
  });

  it('CLOCK_SEGMENT_COUNTS : le miroir Zod accepte 4, 6, 8, 10 et rien d’autre', () => {
    expect([...zClockSegmentCount.values].sort((a, b) => a - b)).toStrictEqual([
      ...CLOCK_SEGMENT_COUNTS,
    ]);
    expect(zClockSegmentCount.safeParse(5).success).toBe(false);
    expect(zClockSegmentCount.safeParse(10).success).toBe(true);
  });

  it('le flux RNG est une union fermée, pas une chaîne libre', () => {
    // 03-donnees.md §3.1 écrit `z.string().nullable()`. Le moteur est canonique.
    expect(zRngStream.safeParse('action').success).toBe(true);
    expect(zRngStream.safeParse('actions').success).toBe(false);
    expect(zRngStream.safeParse('').success).toBe(false);
  });
});
