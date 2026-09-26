/**
 * The vocabulary of a guided scenario build (ADR 0012, S-04).
 *
 * ── WHAT CROSSES THE PORT, AND WHY IT IS SO NARROW ───────────────────────
 * The model answers a `ScenarioDecision`: ONE identifier taken from a list we
 * handed it, plus one sentence of justification. It never writes a name, a
 * place, a rule or a number. That is invariant 1 applied to the scenario — the
 * engine asks the question and CLOSES the answers.
 *
 * The narrowness is also a measurement, not a taste: M0-32 mounted two free
 * local models and collected 24 samples with ZERO structured block. A build
 * that asked for one big JSON document would fail on exactly those models. One
 * closed question at a time, answered by an identifier, is what a three
 * billion parameter model can do.
 *
 * ── THE TWO PHASES ───────────────────────────────────────────────────────
 * `situation` runs before the characters exist: period, region, front, the
 * portent already crossed, the pivotal figure, the entry node and the opening
 * lead. `ressorts` runs after the distribution, because `hook.appliesTo` reads
 * the sheets, and the vow and the driving question hang off the hook. Decision
 * 3 of ADR 0012 puts the cut exactly there.
 */

import type { Disposition, Rank, SegmentCount } from '@for/contracts';

/**
 * The named draw stream of decision 6, seeded per campaign.
 *
 * NOT a member of the engine's `RNG_STREAMS`, and that is deliberate: that
 * tuple types `GameEvent.rngStream`, is mirrored in `@for/contracts` and is
 * written into a SQL `CHECK`. A scenario build emits no event and persists no
 * draw index, so adding `scenario` there would put a value in three journals
 * that nothing ever writes. Reported in the PR rather than done quietly.
 */
export const SCENARIO_RNG_STREAM = 'scenario';

export type ScenarioRngStream = typeof SCENARIO_RNG_STREAM;

/**
 * What the build knows about one seat at the table.
 *
 * ASSEMBLED BY THE CALLER, never read from disk here. `traits` are the free
 * slugs of a sheet (`champion.tags`), `regionIds` the regions the character is
 * attached to, `factionIds` the factions the campaign has them belong to — a
 * champion sheet carries no faction today, so that list comes from the server.
 */
export interface ScenarioPartyMember {
  readonly characterId: string;
  readonly championId: string;
  readonly traits: readonly string[];
  readonly regionIds: readonly string[];
  readonly factionIds: readonly string[];
}

/** One closed answer. `id` is all the model may write. */
export interface ScenarioCandidate {
  readonly id: string;
  /** One line, French, read from the content. */
  readonly label: string;
  /** One more line, French, so the choice is informed rather than blind. */
  readonly detail: string;
}

/**
 * The ten elements of `04-scenarios.md` section 6, in order.
 *
 * MIRRORS NOTHING. The engine has no notion of a build step, so per the
 * operating rule of ADR 0007 this tuple is owned here and pinned IN FULL
 * LETTERS by `tests/steps.test.ts` « les dix étapes de la section 6, dans
 * l'ordre » › « les dix identifiants, écrits en toutes lettres », rather than
 * "compared" to a list that does not exist.
 */
export const SCENARIO_STEP_IDS = [
  'periode',
  'lieu',
  'front',
  'enjeu',
  'figure',
  'noeud',
  'piste',
  'ressort',
  'serment',
  'question-d-enjeu',
] as const;

export type ScenarioStepId = (typeof SCENARIO_STEP_IDS)[number];

/** Step A of decision 3, then step B. */
export const SCENARIO_PHASES = ['situation', 'ressorts'] as const;

export type ScenarioPhase = (typeof SCENARIO_PHASES)[number];

/**
 * What the decision port is shown.
 *
 * EVERY FIELD IS READ BY SOMEBODY. `party` is here because step B cannot be
 * answered without it; `chosen` because a candidate only makes sense next to
 * what already stands; `attempt` because a model that is being asked a second
 * time should be told so.
 *
 * A KEY SET IS NOT A CONTENT. All four assertions live in `tests/build.test.ts`
 * under « ce que le faux reçoit, le vrai le recevra », and measuring said so:
 * emptying `chosen`, forcing `attemptsAllowed` to 99 and freezing `phase` each
 * left the suite green while only the key set was compared.
 *
 *   - the exact key set — « la question porte exactement les neuf champs
 *     annoncés »
 *   - `party`, at BOTH seats — « la distribution arrive ENTIÈRE jusqu'au port,
 *     aux deux places de la table »
 *   - `chosen`, four entries deep, last one being the `enjeu` decision —
 *     « `chosen` porte CE QUI PRÉCÈDE : QUATRE choix devant « figure », le
 *     dernier est l'enjeu »
 *   - `phase` and `attemptsAllowed` — « la phase de la question est celle de
 *     l'étape : « situation » puis « ressorts » » and « `attemptsAllowed` vaut
 *     TROIS à chaque question : le chiffre du critère »
 */
export interface ScenarioQuestion {
  readonly stepId: ScenarioStepId;
  readonly phase: ScenarioPhase;
  /** French, one sentence, ending with a question mark. */
  readonly question: string;
  /** French, one line: what makes an answer legal. */
  readonly rule: string;
  readonly candidates: readonly ScenarioCandidate[];
  /** 1-based. Equal to `attemptsAllowed` on the last try before the default. */
  readonly attempt: number;
  readonly attemptsAllowed: number;
  readonly chosen: readonly ScenarioChoice[];
  readonly party: readonly ScenarioPartyMember[];
}

/** An identifier, and one sentence saying why. Nothing else is accepted. */
export interface ScenarioDecision {
  readonly choiceId: string;
  readonly why: string;
}

/**
 * The decision port, on the exact model of `NarratorPort` (ADR 0002).
 *
 * A port, not a provider: the simulated adapter of `fake-decider.ts` and a
 * real model behind `@for/ai` plug in the same way, and NO SDK is named here
 * or anywhere in this package.
 */
export interface ScenarioDecisionPort {
  readonly portId: string;
  choisir(question: ScenarioQuestion): Promise<ScenarioDecision>;
}

export interface ScenarioChoice {
  readonly stepId: ScenarioStepId;
  readonly chosenId: string;
  /** The model's sentence, trimmed. Never interpreted. */
  readonly why: string;
  /** How many times the question was asked before it landed. */
  readonly attempts: number;
  /** True when the three attempts were spent and the default was taken. */
  readonly viaDefault: boolean;
}

/** What the vow of step 9 is sworn about. Two closed shapes, never a phrase. */
export type ScenarioVowTarget =
  | { readonly kind: 'front'; readonly frontId: string }
  | { readonly kind: 'figure'; readonly figureId: string };

/**
 * The assembled scenario: identifiers and text COPIED from the content.
 *
 * Not one string here was written by the model. `stake`, `crossedPortentText`
 * and `stakeQuestion` are copies of content fields, carried so that S-05 can
 * seed a clock, a scene and a vow without reopening the registry.
 */
export interface AssembledScenario {
  readonly periodId: string;
  readonly regionId: string;
  readonly frontId: string;
  /** `front.stake` — what is lost if the clock fills. */
  readonly stake: string;
  readonly segments: SegmentCount;
  /** 1-based index of the portent already crossed when the campaign opens. */
  readonly crossedPortent: number;
  readonly crossedPortentText: string;
  readonly figureId: string;
  readonly figureDisposition: Disposition;
  readonly entryNodeId: string;
  readonly openingLeadNodeId: string;
  /** `null` until step B has run. */
  readonly hookId: string | null;
  readonly vowTarget: ScenarioVowTarget | null;
  readonly vowRank: Rank | null;
  readonly bondFigureIds: readonly string[];
  readonly stakeQuestionNodeId: string | null;
  readonly stakeQuestion: string | null;
}

export interface ScenarioBuild {
  readonly seed: string;
  readonly stream: ScenarioRngStream;
  /** The last phase that ran. */
  readonly phase: ScenarioPhase;
  readonly choices: readonly ScenarioChoice[];
  readonly scenario: AssembledScenario;
}

/**
 * Why a build could not even start.
 *
 * A REFUSAL IS NOT A FAILED ATTEMPT. Three bad answers from the model end on
 * the step's default candidate and the build completes (decision: a half-built
 * campaign is unusable and nobody repairs it on a Saturday night). These two
 * codes are different: they say the CONTENT or the CALLER cannot support a
 * build at all, and they are returned before anything is assembled.
 */
export const SCENARIO_REFUSAL_CODES = ['party_required', 'no_candidate'] as const;

export type ScenarioRefusalCode = (typeof SCENARIO_REFUSAL_CODES)[number];

export interface ScenarioRefusal {
  readonly code: ScenarioRefusalCode;
  readonly stepId: ScenarioStepId;
  /** French, names the step and what is missing. */
  readonly message: string;
}

export type ScenarioBuildResult =
  | { readonly ok: true; readonly build: ScenarioBuild }
  | { readonly ok: false; readonly refusal: ScenarioRefusal };
