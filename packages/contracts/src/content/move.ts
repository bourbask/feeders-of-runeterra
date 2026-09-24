/**
 * `content/moves/*.json` — the eleven moves (03-donnees.md section 4.4).
 *
 * A move file declares TEXT and EFFECTS, never logic. `EffectSchema` comes
 * from `src/core/effects.ts`: the engine is the only thing that runs an
 * effect, which is what keeps a JSON file from reaching invariant 1.
 */

import { z } from 'zod';

import { EffectSchema } from '../core/effects.js';
import { AttributeKeySchema, FrTextSchema, RefSchema, SlugSchema, TagsSchema } from './common.js';

export const MoveOutcomeSchema = z.object({
  /** What the player reads. */
  text: FrTextSchema,
  /** Injected into the storyteller prompt. Never shown as is. */
  gmGuidance: FrTextSchema.optional(),
  effects: z.array(EffectSchema).max(8).default([]),
});

export const MoveSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: SlugSchema,
    name: FrTextSchema,
    category: z.enum(['aventure', 'combat', 'relation', 'serment', 'survie', 'meta']),
    trigger: FrTextSchema,
    rollKind: z.enum(['action', 'progress', 'none']),
    attributeOptions: z.array(AttributeKeySchema).max(5).default([]),
    allowsMomentumBurn: z.boolean().default(true),
    outcomes: z.object({
      franche: MoveOutcomeSchema,
      partielle: MoveOutcomeSchema,
      echec: MoveOutcomeSchema,
    }),
    presage: z.object({ text: FrTextSchema, tableId: RefSchema('table').optional() }).optional(),
    tags: TagsSchema,
    notes: FrTextSchema.optional(),
  })
  .superRefine((move, ctx) => {
    if (move.rollKind === 'action' && move.attributeOptions.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['attributeOptions'],
        message: "un mouvement à jet d'action doit proposer au moins un attribut",
      });
    }
    if (move.rollKind !== 'action' && move.attributeOptions.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['attributeOptions'],
        message: "attributs interdits hors jet d'action",
      });
    }
  });

export type MoveContent = z.output<typeof MoveSchema>;
