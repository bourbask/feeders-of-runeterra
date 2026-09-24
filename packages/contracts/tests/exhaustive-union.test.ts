/**
 * THE DIRECTIONS `satisfies` CANNOT SEE — ADR 0007.
 *
 * `zGameEvent satisfies z.ZodType<GameEvent>` fails when a MIRRORED OBJECT
 * forgets a field the engine declares. Measured, it fails at nothing else:
 *
 *   - it does NOT fail on a variant INVENTED in the schema — an output type
 *     with an extra member is still assignable to the union it extends;
 *   - it does NOT fail on a variant MISSING from the schema, nor on an enum
 *     NARROWED on the schema side, because `ZodType` is covariant in its
 *     output: a schema accepting only 'roll' stays assignable to a type whose
 *     mode is 'roll' | 'gm_choice'.
 *
 * None of that is theoretical. A typo in a discriminant — `roll.presage_drawn`
 * written `roll.presage_draw` — passes the compiler as an extra member and
 * silently loses the real one; and `PAY_PRICE_MODES` rewritten to two members
 * in the engine left `typecheck`, `test`, `lint` and `depcruise` all green.
 *
 * THIS FILE IS THE ONLY THING THAT CATCHES THEM, by comparing the two runtime
 * lists member by member, in both directions. Hence the rule the lead derived
 * from ADR 0007: EVERY engine constant that carries an invariant belongs in
 * this file. Importing engine VALUES here is legitimate and deliberate — this
 * file sits outside `from: '^packages/contracts/src'` in the
 * `contracts-ne-depend-que-de-zod` rule and outside the cruise altogether
 * (`exclude: { path: '(coverage|\\.test\\.ts$)' }`).
 */
import {
  ACTION_SCORE_CAP,
  ACTOR_KINDS,
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  ATTRIBUTE_SPREAD,
  ATTRIBUTES,
  CAMPAIGN_STATUSES,
  CHAMPION_LOCK_KINDS,
  CHARACTER_STATUSES,
  CLOCK_ADVANCE_MAX,
  CLOCK_ADVANCE_MIN,
  CLOCK_SEGMENT_COUNTS,
  CLOCK_STATUSES,
  CREATABLE_TRACK_KINDS,
  EFFECT_OPS,
  EFFECT_TARGETS,
  ENGINE_ONLY_EVENT_TYPES,
  ENTITY_DISPOSITIONS,
  ENTITY_KINDS,
  ENTITY_STATUSES,
  EVENT_SCOPES,
  GAME_EVENT_TYPES,
  GAUGE_MAX,
  GAUGE_MIN,
  GAUGES,
  GM_PROPOSAL_KINDS,
  INTENT_TYPES,
  LIKELIHOOD_THRESHOLDS,
  LIKELIHOODS,
  MAX_PROGRESS_BOXES,
  MAX_PROGRESS_TICKS,
  MOVE_IDS,
  OUTCOMES,
  PARTY_ROLES,
  PAY_PRICE_MODES,
  PROGRESS_RANKS,
  PROGRESS_TRACK_KINDS,
  PROGRESS_TRACK_STATUSES,
  RNG_STREAMS,
  RULE_VIOLATION_CODES,
  SCENE_ABSENCE_CAUSES,
  SCENE_PRESENCE_MAX,
  SHEET_SOURCES,
  TICKS_PER_BOX,
  TICKS_PER_MILESTONE,
} from '@for/engine';
import { describe, expect, it } from 'vitest';

import { RANK_TICKS } from '../src/content/common.js';
import { likelihoodKeysOfSchema, YESNO_THRESHOLDS } from '../src/content/oracle.js';
import {
  ATTRIBUTE_SPREAD_SIGNATURE,
  ATTRIBUTE_MAX as contractsAttributeMax,
  ATTRIBUTE_MIN as contractsAttributeMin,
} from '../src/core/attributes.js';
import {
  CLOCK_ADVANCE_MAX as contractsClockAdvanceMax,
  CLOCK_ADVANCE_MIN as contractsClockAdvanceMin,
} from '../src/core/clock.js';
import { effectOpsOfSchema, zPayPriceMode } from '../src/core/effects.js';
import {
  zActorKind,
  zAttributeId,
  zCampaignStatus,
  zChampionLockKind,
  zCharacterStatus,
  zClockSegmentCount,
  zClockStatus,
  zCreatableTrackKind,
  zEffectTarget,
  zEntityDisposition,
  zEntityKind,
  zEntityStatus,
  zEventScope,
  zGaugeId,
  zGmProposalKind,
  zLikelihood,
  zMoveId,
  zOutcome,
  zPartyRole,
  zProgressRank,
  zProgressTrackKind,
  zProgressTrackStatus,
  zRngStream,
  zRuleViolationCode,
  zSceneAbsenceCause,
  zSheetSource,
} from '../src/core/enums.js';
import {
  GAUGE_MAX as contractsGaugeMax,
  GAUGE_MIN as contractsGaugeMin,
} from '../src/core/gauges.js';
import {
  MAX_PROGRESS_BOXES as contractsMaxProgressBoxes,
  MAX_PROGRESS_TICKS as contractsMaxProgressTicks,
  TICKS_PER_BOX as contractsTicksPerBox,
} from '../src/core/progress-track.js';
import { SCENE_PRESENCE_MAX as contractsScenePresenceMax } from '../src/core/scene-state.js';
import { ACTION_SCORE_CAP as contractsActionScoreCap } from '../src/events/dice.js';
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
  // ────────────────────────────────────────────────────────────────────────
  // LE BARREL DE @for/engine, ÉNUMÉRÉ EN ENTIER — ce que la règle opératoire
  // d'ADR 0007 exige, pour que « les importantes » cesse d'être un critère.
  //
  // 47 constantes (plus 6 fonctions : createCampaignRng, createSeededRng, ok,
  // err, isOk, isErr, qui ne sont pas des miroirs et n'ont rien à comparer).
  // 38 constantes sont comparées ici ou ailleurs. Les 9 autres ne le sont pas,
  // et voici pourquoi, une par une :
  //
  //   EFFECT_OPS ............... comparé par effectOpsOfSchema(), effects.test.ts
  //   GAME_EVENT_TYPES ......... comparé par gameEventTypesOfSchema(), et croisé
  //                              avec le markdown de 03-donnees.md §3.4 par
  //                              event-catalog.test.ts
  //   INTENT_TYPES ............. comparé par intentTypesOfSchema()
  //   ENGINE_ONLY_EVENT_TYPES .. dérivé de GAME_EVENT_TYPES, couvert avec lui
  //   ATTRIBUTE_SPREAD ......... recopié côté contrats, mais APLATI en chaîne :
  //                              c'est ATTRIBUTE_SPREAD_SIGNATURE qui est comparé,
  //                              et la comparaison de la chaîne suffit puisque
  //                              la chaîne est dérivée du tuple.
  //   CLOCK_SEGMENT_COUNTS ..... recopié et comparé, plus bas, par son propre `it`.
  //   DEFAULT_MOMENTUM_BOUNDS .. PAS recopié dans les contrats : rien à miroiter,
  //                              et épinglé côté moteur par index.test.ts
  //   VOW_RESOLUTION_MOVES ..... idem
  //   RNG_STREAMS .............. comparé, première ligne du tableau ci-dessous
  //
  // DEUX LIGNES ONT CHANGÉ DE CAMP AVEC M0-09 (schémas de contenu) :
  //   TICKS_PER_MILESTONE ...... désormais RECOPIÉ, en `RANK_TICKS`
  //                              (03-donnees.md §4.2) → comparé ci-dessous.
  //   LIKELIHOOD_THRESHOLDS .... désormais RECOPIÉ, en `YESNO_THRESHOLDS`
  //                              (§4.6, seuils du d100) → comparé ci-dessous.
  // Les deux portaient la justification « pas recopié, rien à miroiter ». Elle
  // est devenue fausse le jour où le contenu en a eu besoin, et une
  // justification périmée est exactement ce que cette liste doit empêcher.
  //
  // La règle : une constante non recopiée n'a pas de miroir à garder. Une
  // constante recopiée en a un, et il figure ici. Si un export apparaît dans
  // @for/engine sans être dans cette liste, cette liste est périmée.

  // ────────────────────────────────────────────────────────────────────────
  // LES SCALAIRES, ajoutés par le lead — précision d'ADR 0007 du 24 septembre.
  //
  // Un nombre recopié est PIRE qu'un enum recopié. Un enum garde au moins la
  // paire `satisfies` + `AssertNever` à la compilation ; dans un nombre, le
  // compilateur ne voit qu'un `number`. Mesuré : ATTRIBUTE_MAX porté de 3 à 4,
  // ATTRIBUTE_MIN de 1 à 0, CLOCK_ADVANCE_MAX de 3 à 7 et ACTION_SCORE_CAP de
  // 10 à 99 dans le moteur, reconstruction complète en `tsc -b --force` — les
  // quatre portes restaient vertes pendant que les contrats annonçaient encore
  // les anciennes bornes.
  //
  // SCENE_PRESENCE_MAX n'est pas décoratif : il porte le critère d'acceptation
  // n° 3 de la fiche M0-05 (« 8 présents, 8 partis »), et ce 8 était un chiffre
  // recopié à la main que rien ne comparait au moteur.
  it.each([
    ['ATTRIBUTE_MIN', ATTRIBUTE_MIN, contractsAttributeMin],
    ['ATTRIBUTE_MAX', ATTRIBUTE_MAX, contractsAttributeMax],
    ['GAUGE_MIN', GAUGE_MIN, contractsGaugeMin],
    ['GAUGE_MAX', GAUGE_MAX, contractsGaugeMax],
    ['CLOCK_ADVANCE_MIN', CLOCK_ADVANCE_MIN, contractsClockAdvanceMin],
    ['CLOCK_ADVANCE_MAX', CLOCK_ADVANCE_MAX, contractsClockAdvanceMax],
    ['ACTION_SCORE_CAP', ACTION_SCORE_CAP, contractsActionScoreCap],
    ['TICKS_PER_BOX', TICKS_PER_BOX, contractsTicksPerBox],
    ['MAX_PROGRESS_BOXES', MAX_PROGRESS_BOXES, contractsMaxProgressBoxes],
    ['MAX_PROGRESS_TICKS', MAX_PROGRESS_TICKS, contractsMaxProgressTicks],
    ['SCENE_PRESENCE_MAX', SCENE_PRESENCE_MAX, contractsScenePresenceMax],
  ])('%s : la recopie des contrats vaut la constante du moteur', (_name, engine, mirror) => {
    expect(mirror).toBe(engine);
  });

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
    // ADR 0006 + ADR 0007. Le littéral `z.literal('roll')` de contracts ne
    // gardait que la COPIE ; le tuple du moteur, qui définit `PayPriceMode` et
    // qui porte l'invariant 1 (« une seule branche à écrire dans l'exécuteur
    // d'effets »), n'était gardé par rien. Élargir `PAY_PRICE_MODES` côté
    // moteur laissait les quatre portes vertes. Cette ligne est le test que
    // l'ADR 0006 assigne nommément à M0-05, et c'est elle qui rougit.
    ['PAY_PRICE_MODES', [...PAY_PRICE_MODES], [...zPayPriceMode.values]],
    // Le reste de la recopie, au titre de la règle générale d'ADR 0007 : toute
    // constante du moteur qui porte un invariant figure ici. Les neuf premières
    // lignes étaient celles que M0-05 avait jugées « importantes » ; le trou de
    // PAY_PRICE_MODES a montré que ce tri n'était pas le bon critère, parce
    // qu'une recopie non comparée est inerte quelle que soit son importance.
    ['EVENT_SCOPES', [...EVENT_SCOPES], zEventScope.options],
    ['ACTOR_KINDS', [...ACTOR_KINDS], zActorKind.options],
    ['CAMPAIGN_STATUSES', [...CAMPAIGN_STATUSES], zCampaignStatus.options],
    ['CHARACTER_STATUSES', [...CHARACTER_STATUSES], zCharacterStatus.options],
    ['SHEET_SOURCES', [...SHEET_SOURCES], zSheetSource.options],
    ['PARTY_ROLES', [...PARTY_ROLES], zPartyRole.options],
    ['CHAMPION_LOCK_KINDS', [...CHAMPION_LOCK_KINDS], zChampionLockKind.options],
    ['PROGRESS_TRACK_KINDS', [...PROGRESS_TRACK_KINDS], zProgressTrackKind.options],
    ['PROGRESS_TRACK_STATUSES', [...PROGRESS_TRACK_STATUSES], zProgressTrackStatus.options],
    ['CREATABLE_TRACK_KINDS', [...CREATABLE_TRACK_KINDS], zCreatableTrackKind.options],
    ['CLOCK_STATUSES', [...CLOCK_STATUSES], zClockStatus.options],
    ['ENTITY_STATUSES', [...ENTITY_STATUSES], zEntityStatus.options],
    ['ENTITY_DISPOSITIONS', [...ENTITY_DISPOSITIONS], zEntityDisposition.options],
    ['LIKELIHOODS', [...LIKELIHOODS], zLikelihood.options],
    ['EFFECT_TARGETS', [...EFFECT_TARGETS], zEffectTarget.options],
    ['GM_PROPOSAL_KINDS', [...GM_PROPOSAL_KINDS], zGmProposalKind.options],
  ])('%s : le miroir Zod a les mêmes membres, dans le même ordre', (_name, engine, schema) => {
    expect(schema).toStrictEqual(engine);
  });

  it('zEngineEffect et EFFECT_OPS portent exactement les mêmes membres', () => {
    // Le trou de covariance refermé pour zGameEvent et zIntent l'était resté
    // ici : `zEngineEffect: z.ZodType<EngineEffect>` est une annotation, pas un
    // garde. Supprimer la variante `condition_remove` du miroir laissait les
    // quatre portes vertes, et M0-09 aurait chargé un contenu parfaitement
    // légal côté moteur que le schéma refusait au bord.
    expect(effectOpsOfSchema()).toStrictEqual([...EFFECT_OPS]);
  });

  it('aucune variante dupliquée dans zEngineEffect', () => {
    const ops = effectOpsOfSchema();
    expect(new Set(ops).size).toBe(ops.length);
  });

  it('CLOCK_SEGMENT_COUNTS : le miroir Zod accepte 4, 6, 8, 10 et rien d’autre', () => {
    expect([...zClockSegmentCount.values].sort((a, b) => a - b)).toStrictEqual([
      ...CLOCK_SEGMENT_COUNTS,
    ]);
    expect(zClockSegmentCount.safeParse(5).success).toBe(false);
    expect(zClockSegmentCount.safeParse(10).success).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // LES TABLES RECOPIÉES PAR M0-09. Même raisonnement que les scalaires, en
  // pire : une table est cinq nombres, et le compilateur n'en voit aucun. Une
  // valeur retouchée côté moteur laisserait le contenu annoncer l'ancienne
  // sans qu'aucune porte ne bronche.
  it('TICKS_PER_MILESTONE : RANK_TICKS vaut la table du moteur, rang par rang', () => {
    expect(RANK_TICKS).toStrictEqual({ ...TICKS_PER_MILESTONE });
  });

  it('LIKELIHOOD_THRESHOLDS : YESNO_THRESHOLDS vaut la table du moteur, seuil par seuil', () => {
    expect({ ...YESNO_THRESHOLDS }).toStrictEqual({ ...LIKELIHOOD_THRESHOLDS });
  });

  it('YesNoOracleSchema porte exactement les cinq vraisemblances du moteur', () => {
    // Les clés sont lues SUR LE SCHÉMA, pas retapées : c'est ce qui attrape une
    // vraisemblance oubliée dans le schéma de l'oracle oui/non, que
    // `z.literal` ne garde pas.
    expect([...likelihoodKeysOfSchema()].sort()).toStrictEqual([...LIKELIHOODS].sort());
  });

  it('ATTRIBUTE_SPREAD : la signature recopiée suit le tuple du moteur', () => {
    // `ATTRIBUTE_SPREAD_SIGNATURE = '3,2,2,1,1'` est une recopie APLATIE du
    // tuple du moteur, et personne ne la comparait. Le jour où la répartition
    // devient [3,3,2,1,1], c'est cette ligne qui rougit — pas le compilateur,
    // qui ne voit qu'une chaîne.
    expect(ATTRIBUTE_SPREAD_SIGNATURE).toBe([...ATTRIBUTE_SPREAD].join(','));
  });

  // VISIBILITIES n'a pas sa ligne : le moteur exporte le TYPE `Visibility`,
  // pas de tuple de valeurs (vérifié sur `@for/engine`). La recopie de
  // `core/enums.ts` reste donc gardée par la seule paire
  // `satisfies` + `AssertNever`, qui couvre membre en trop et membre manquant
  // à la compilation. À rouvrir si le moteur publie un jour le tuple.

  it('le flux RNG est une union fermée, pas une chaîne libre', () => {
    // 03-donnees.md §3.1 écrit `z.string().nullable()`. Le moteur est canonique.
    expect(zRngStream.safeParse('action').success).toBe(true);
    expect(zRngStream.safeParse('actions').success).toBe(false);
    expect(zRngStream.safeParse('').success).toBe(false);
  });
});
