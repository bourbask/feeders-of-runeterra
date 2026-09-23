/**
 * `zEngineEffect` — the core contract, mirrored from `EngineEffect`
 * (03-donnees.md section 4.3).
 *
 * Content NEVER holds logic. It declares effects the engine knows how to run.
 * That is what keeps a JSON file from working around invariant 1, and it is
 * why no `EngineEffect` ever travels FROM the model.
 *
 * ADR 0006 — `pay_price` HAS EXACTLY ONE MODE, `roll`. The engine rolls the
 * d12 on the price table and hands the drawn entry to the storyteller as an
 * imposed fact. `gm_choice` and `player_choice` are gone: they reopened
 * invariant 1 through the back door. `PAY_PRICE_MODE` below is a literal, not
 * an enum, and `effects.test.ts` fails if a second mode ever reappears.
 *
 * ADR 0006 — `choice` SURVIVES, and is not a back door. It is ordinary PLAYER
 * agency ("lose supplies or take the hit"), never the model's. Three bounds
 * separate it from one, and they do not negotiate:
 *
 *   1. `choice` is never reachable FROM `pay_price`. A drawn price does not
 *      become a menu. The `pay_price` variant carries `op` and `mode` and
 *      nothing else — an `options` key handed to it is stripped, never kept
 *      (proven in `effects.test.ts`).
 *   2. Options come from versioned content or from the engine, never from the
 *      model. Enforced by the content loader (M0-13) and by the fact that no
 *      tool exposed to the model accepts an `EngineEffect`.
 *   3. The player's selection is an ordinary intent, validated by the server
 *      like any other (invariant 3).
 */

import { z } from 'zod';

import type { EngineEffect } from '@for/engine';

import { zNonEmptyText, zSlug } from '../primitives.js';
import {
  zCreatableTrackKind,
  zEffectTarget,
  zGaugeId,
  zProgressRank,
  zProgressTrackKind,
} from './enums.js';

/**
 * ADR 0006. A literal, so "how many modes are there" has a single answer that
 * a test can read. An enum here would make a second mode a one-word change.
 */
export const PAY_PRICE_MODE = 'roll';

export const zPayPriceMode = z.literal(PAY_PRICE_MODE);

/**
 * Recursive: `choice` options carry their own effects. The explicit
 * `z.ZodType<EngineEffect>` annotation is what breaks the cycle for TypeScript,
 * and it checks the mirror exactly as a `satisfies` would.
 */
export const zEngineEffect: z.ZodType<EngineEffect> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({
      op: z.literal('gauge'),
      gauge: zGaugeId,
      delta: z.number().int().min(-5).max(5),
      target: zEffectTarget.default('self'),
    }),
    z.object({ op: z.literal('momentum'), delta: z.number().int().min(-6).max(6) }),
    z.object({ op: z.literal('momentum_reset') }),
    z.object({ op: z.literal('condition_add'), conditionId: zSlug }),
    z.object({ op: z.literal('condition_remove'), conditionId: zSlug }),
    z.object({
      op: z.literal('track_tick'),
      trackKind: zProgressTrackKind,
      ticks: z.number().int().min(-40).max(40),
      useRank: z.boolean().default(false),
    }),
    z.object({
      op: z.literal('track_create'),
      trackKind: zCreatableTrackKind,
      rankFrom: z.enum(['player', 'fixed']),
      rank: zProgressRank.optional(),
    }),
    z.object({ op: z.literal('clock_advance'), segments: z.number().int().min(1).max(3) }),
    z.object({ op: z.literal('xp'), amount: z.number().int().min(-10).max(10) }),
    z.object({ op: z.literal('pay_price'), mode: zPayPriceMode }),
    z.object({ op: z.literal('oracle'), tableId: zSlug }),
    z.object({ op: z.literal('narrative'), prompt: zNonEmptyText }),
    z.object({
      op: z.literal('choice'),
      label: zNonEmptyText,
      pick: z.number().int().min(1).max(3).default(1),
      options: z
        .array(
          z.object({
            id: zSlug,
            label: zNonEmptyText,
            effects: z.array(zEngineEffect).max(6),
          }),
        )
        .min(2)
        .max(6),
    }),
  ]),
);

/** The name 03-donnees.md section 4.3 uses. Same schema, single owner. */
export const EffectSchema = zEngineEffect;

export type EngineEffectDto = z.output<typeof zEngineEffect>;
