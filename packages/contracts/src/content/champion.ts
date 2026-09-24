/**
 * `content/champions/*.json` — the ONE champion-sheet schema (03-donnees.md
 * section 4.5). The same schema validates a handwritten sheet and a forged
 * one: the forge gets no privilege, and `ForgeOutputSchema` (M0-15) is an
 * `.omit()` of this one, never a parallel shape.
 *
 * `aliases` IS NOT OPTIONAL. It is the single source of the distribution lock
 * (`no_reserved_champion`, `check_name_allowed`, 02-mj-ia.md section 2.2): a
 * missing alias is a reserved champion walking out of the storyteller's mouth
 * under a nickname nobody listed.
 *
 * ── ADR 0009, acted 24 September 2026 ────────────────────────────────────
 * Perception traits are PROBABILISTIC and carry five fields: domain, trigger,
 * strength, frequency, effect. The values get balanced by playing (M1); what
 * is decided here is the FORM, and M0-16 writes the sheets against it.
 *
 * Three things this shape refuses to do, each on purpose:
 *
 *  1. THE TRIGGER IS NOT PROSE ALONE. `text` is there for the reviewer, but a
 *     trigger must also carry at least one condition the ENGINE can evaluate
 *     from state it already holds — a present entity of a given kind and
 *     disposition, or a declared move. That is the piece the ADR says avoids
 *     the ridiculous: Rengar's predator eye must see TARGETS, and "target" is
 *     `disposition: hostile`, not a French sentence a model would interpret.
 *     A prose-only trigger would hand the firing decision to the storyteller,
 *     which is invariant 1 through the back door.
 *  2. `strength` IS BOUNDED 1..99, never 0 and never 100. The ADR's balancing
 *     principle, made mechanical: "a trait that always fires is a rule, a
 *     trait that never fires does not exist."
 *  3. A TRAIT CARRIES NO `EngineEffect`. It reveals a fact or opens a move.
 *     Hanging gauge deltas off a probabilistic trait would give versioned
 *     content a random path into the gauges, and there is no journal event for
 *     that today. To be reopened by ADR if M1 needs it.
 *
 * `id` is a sixth field the ADR does not list: the journal has to name which
 * trait fired for a turn to be replayable (invariant 4).
 */

import { z } from 'zod';

import { zAttributeSpread } from '../core/attributes.js';
import { EffectSchema } from '../core/effects.js';
import { zEntityDisposition, zEntityKind, zMoveId, zSheetSource } from '../core/enums.js';
import { FrTextSchema, RankSchema, RefSchema, SlugSchema, TagsSchema } from './common.js';

/** ADR 0009: never a certainty, never an impossibility. */
export const PERCEPTION_STRENGTH_MIN = 1;
export const PERCEPTION_STRENGTH_MAX = 99;

export const PERCEPTION_TEXT_MAX = 200;

/**
 * What the engine checks against the scene facts before rolling.
 *
 * Every field points at a union the engine already owns, so nothing here
 * needs a new vocabulary — and a trigger that names none of them is refused.
 */
export const PerceptionTriggerSchema = z
  .object({
    /** Read by the PR reviewer, and framed to the storyteller after the fact. */
    text: FrTextSchema.max(PERCEPTION_TEXT_MAX),
    /** At least one entity present in the scene must match all of this. */
    presentEntity: z
      .object({
        kinds: z.array(zEntityKind).min(1).max(7),
        dispositions: z.array(zEntityDisposition).min(1).max(4),
      })
      .optional(),
    /** Or: the trait hangs off a declared move rather than off the scene. */
    moveIds: z.array(zMoveId).max(11).default([]),
  })
  .superRefine((trigger, ctx) => {
    if (trigger.presentEntity === undefined && trigger.moveIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message:
          'un déclencheur doit porter au moins une condition vérifiable par le moteur ' +
          '(`presentEntity` ou `moveIds`) : un texte seul laisserait le conteur décider',
      });
    }
  });

/** What firing reveals or opens. Never a gauge, never a die. */
export const PerceptionEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reveal'), text: FrTextSchema.max(PERCEPTION_TEXT_MAX) }),
  z.object({
    kind: z.literal('grant'),
    text: FrTextSchema.max(PERCEPTION_TEXT_MAX),
    moveIds: z.array(zMoveId).min(1).max(11),
  }),
]);

export const PerceptionTraitSchema = z.object({
  /** Named so the journal can say which trait fired. */
  id: SlugSchema,
  /** Open list — the ADR writes "danger · traque · mensonge · froid · blessure…". */
  domain: SlugSchema,
  trigger: PerceptionTriggerSchema,
  /** Chance out of 100 that it fires on this domain. Content, tunable in M1. */
  strength: z.number().int().min(PERCEPTION_STRENGTH_MIN).max(PERCEPTION_STRENGTH_MAX),
  frequency: z.enum(['scene', 'session', 'aventure']),
  effect: PerceptionEffectSchema,
});

export const ChampionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: SlugSchema,
    name: FrTextSchema,
    title: FrTextSchema,
    /** Nicknames, titles, epithets — French AND English. See the header. */
    aliases: z.array(FrTextSchema).min(1).max(12),
    origin: z.object({
      regionId: RefSchema('region'),
      homeText: FrTextSchema,
    }),
    /** One sentence, shown on the character-choice screen. */
    pitch: FrTextSchema.max(280),
    description: FrTextSchema.max(2000),

    attributes: zAttributeSpread,

    startingGauges: z
      .object({
        vigueur: z.number().int().min(0).max(5).default(5),
        ame: z.number().int().min(0).max(5).default(5),
        vivres: z.number().int().min(0).max(5).default(5),
      })
      .default({ vigueur: 5, ame: 5, vivres: 5 }),
    startingMomentum: z.number().int().min(-6).max(10).default(2),

    startingAssets: z.array(RefSchema('asset')).min(1).max(3),
    signatureAsset: z.object({
      id: SlugSchema,
      name: FrTextSchema,
      text: FrTextSchema,
      effects: z.array(EffectSchema).max(4).default([]),
    }),
    startingVow: z.object({
      title: FrTextSchema,
      rank: RankSchema,
      description: FrTextSchema,
    }),
    startingBonds: z
      .array(z.object({ with: FrTextSchema, text: FrTextSchema }))
      .max(3)
      .default([]),

    /** ADR 0009. Probabilistic, engine-rolled, engine-decided. */
    perceptionTraits: z.array(PerceptionTraitSchema).max(6).default([]),

    /** Voice guidance for the storyteller. Non-mechanical, purely narrative. */
    voice: z.object({
      register: FrTextSchema,
      speechTics: z.array(FrTextSchema).max(6).default([]),
      forbidden: z.array(FrTextSchema).max(6).default([]),
      sampleLines: z.array(FrTextSchema).min(1).max(5),
    }),

    loreHooks: z.array(FrTextSchema).min(1).max(8),
    relations: z
      .array(
        z.object({
          championId: RefSchema('champion'),
          kind: z.enum(['allie', 'rival', 'parent', 'ennemi', 'mentor', 'inconnu']),
          text: FrTextSchema,
        }),
      )
      .max(8)
      .default([]),

    source: zSheetSource,
    portraitUrl: z.url().optional(),
    contentWarnings: z.array(SlugSchema).max(6).default([]),
    tags: TagsSchema,
  })
  .superRefine((champion, ctx) => {
    if (champion.relations.some((relation) => relation.championId === champion.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['relations'],
        message: 'un champion ne peut pas être en relation avec lui-même',
      });
    }
    const traitIds = champion.perceptionTraits.map((trait) => trait.id);
    if (new Set(traitIds).size !== traitIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['perceptionTraits'],
        message:
          'deux atouts de perception partagent le même id : le journal ne saurait lequel a parlé',
      });
    }
  });

export type ChampionContent = z.output<typeof ChampionSchema>;
export type PerceptionTraitContent = z.output<typeof PerceptionTraitSchema>;
