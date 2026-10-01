/**
 * The machine. PURE: it receives a decision port, it calls nobody.
 *
 * No network, no disk, no database. The registry arrives as an argument, the
 * model arrives behind `ScenarioDecisionPort`, and the randomness arrives as a
 * seed. `tsconfig.json` gives this package `types: []`, so importing a Node
 * builtin is a COMPILE error (TS2307); the bare side-effect form compiles, and
 * the lint block named `pureteDuScenario` in the root `eslint.config.js`
 * catches that one. `.dependency-cruiser.cjs` refuses any edge towards
 * `@for/db` or `@for/server`. All three are measured in the PR, in both
 * directions.
 *
 * The builtin is NOT SPELT OUT anywhere under `src/`, and that is not
 * squeamishness: the acceptance criterion of S-04 is a `grep` over this
 * directory that must print `0`, and a comment quoting the module name makes
 * it print `1`. Reported in the PR.
 *
 * ── TWO ENTRY POINTS, BECAUSE THERE ARE TWO MOMENTS ──────────────────────
 * `buildSituation` runs before the characters exist. `buildHooks` runs after
 * the distribution and RESUMES from the phase-A build — it needs nothing but
 * that build and the seed, because every step draws on its own sub-stream
 * (`candidates.ts`). `buildScenario` chains the two for a caller who already
 * has a party.
 *
 * ── WHAT NEVER THROWS, AND WHAT DOES ─────────────────────────────────────
 * A model that answers badly NEVER breaks a build: three refusals land on the
 * step's default candidate. A port that THROWS does not break one either — the
 * rejection is caught and counted as one failed attempt, which is the same
 * degradation. What a build does refuse, before asking anything, is a piece of
 * content that does not exist (`no_candidate`) or a phase B with nobody at the
 * table (`party_required`). Those are returned as a `ScenarioRefusal`, not
 * thrown, and they name the step.
 */

import type { ContentRegistry } from '@for/content';

import { shuffleFor } from './candidates.js';
import type { ScenarioSelection, ScenarioStep } from './steps.js';
import { parsePortentCandidateId, parseVowCandidateId, stepsOfPhase } from './steps.js';
import type {
  AssembledScenario,
  ScenarioBuild,
  ScenarioBuildResult,
  ScenarioChoice,
  ScenarioDecisionPort,
  ScenarioPartyMember,
  ScenarioQuestion,
  ScenarioStepId,
} from './types.js';
import { SCENARIO_RNG_STREAM } from './types.js';
import type { ChoiceVerdict } from './validate.js';
import {
  ATTEMPTS_BEFORE_DEFAULT,
  DEFAULT_TAKEN_REASON,
  defaultCandidate,
  NO_REASON_GIVEN,
  verifyChoice,
} from './validate.js';

export interface SituationRequest {
  readonly registry: ContentRegistry;
  /** The campaign seed. Same seed and same answers give the same scenario. */
  readonly seed: string;
  readonly decide: ScenarioDecisionPort;
}

export interface HooksRequest {
  readonly registry: ContentRegistry;
  /** What `buildSituation` returned. Carries the seed and the phase-A choices. */
  readonly situation: ScenarioBuild;
  readonly party: readonly ScenarioPartyMember[];
  readonly decide: ScenarioDecisionPort;
}

export interface ScenarioRequest extends SituationRequest {
  readonly party: readonly ScenarioPartyMember[];
}

/**
 * Raised when `assembleScenario` is handed a selection that is missing a
 * phase-A step.
 *
 * `buildSituation` cannot produce one: it refuses a step with no candidate
 * BEFORE it asks, so every phase-A step has landed by the time it assembles.
 * This exists for the caller who drives the steps by hand, and it is held by
 * `tests/build.test.ts` « assembleScenario » › « assembler une sélection
 * tronquée se plaint de l'étape manquante ».
 */
export class ScenarioAssemblyError extends Error {
  public constructor(public readonly stepId: ScenarioStepId) {
    super(`assemblage impossible : l’étape « ${stepId} » n’a pas été jouée`);
    this.name = 'ScenarioAssemblyError';
  }
}

const settled = (selection: ScenarioSelection, stepId: ScenarioStepId): string => {
  const value = selection.get(stepId);
  if (value === undefined) throw new ScenarioAssemblyError(stepId);
  return value;
};

/**
 * Turns the chosen identifiers into the pieces S-05 seeds from.
 *
 * NOT ONE STRING HERE COMES FROM THE MODEL: `stake`, the crossed portent and
 * the stake question are copied out of the content the chosen identifiers
 * point at.
 */
export function assembleScenario(
  registry: ContentRegistry,
  selection: ScenarioSelection,
): AssembledScenario {
  const front = registry.getFront(settled(selection, 'front'));
  const figure = registry.getFigure(settled(selection, 'figure'));
  // The identifier must name THIS front and a portent it really has. A
  // `?? ''` here would turn a corrupted selection into a clock segment with
  // nothing to narrate, which is worse than a named failure.
  const portent = parsePortentCandidateId(settled(selection, 'enjeu'));
  if (portent?.frontId !== front.id) throw new ScenarioAssemblyError('enjeu');
  const portentText = front.portents[portent.index - 1];
  if (portentText === undefined) throw new ScenarioAssemblyError('enjeu');

  const hookId = selection.get('ressort') ?? null;
  const hook = hookId === null ? undefined : registry.getHook(hookId);
  const vowId = selection.get('serment');
  const stakeNodeId = selection.get('question-d-enjeu') ?? null;

  return {
    periodId: settled(selection, 'periode'),
    regionId: settled(selection, 'lieu'),
    frontId: front.id,
    stake: front.stake,
    segments: front.segments,
    crossedPortent: portent.index,
    crossedPortentText: portentText,
    figureId: figure.id,
    figureDisposition: figure.disposition,
    entryNodeId: settled(selection, 'noeud'),
    openingLeadNodeId: settled(selection, 'piste'),
    hookId,
    vowTarget: vowId === undefined ? null : parseVowCandidateId(vowId),
    vowRank: hook?.vowRank ?? null,
    bondFigureIds: hook?.suggestedBondIds ?? [],
    stakeQuestionNodeId: stakeNodeId,
    stakeQuestion: stakeNodeId === null ? null : registry.getNode(stakeNodeId).stakeQuestion,
  };
}

async function runStep(
  step: ScenarioStep,
  registry: ContentRegistry,
  party: readonly ScenarioPartyMember[],
  selection: ScenarioSelection,
  chosen: readonly ScenarioChoice[],
  seed: string,
  decide: ScenarioDecisionPort,
): Promise<ScenarioChoice | null> {
  // Computed HERE, from the live selection, after every earlier `await` has
  // settled. A candidate list captured before the loop would answer the
  // question with the state of a previous step.
  const candidates = shuffleFor(seed, step.id, step.candidates({ registry, party, selection }));
  const fallback = defaultCandidate(candidates);
  if (fallback === undefined) return null;

  for (let attempt = 1; attempt <= ATTEMPTS_BEFORE_DEFAULT; attempt += 1) {
    const question: ScenarioQuestion = {
      stepId: step.id,
      phase: step.phase,
      question: step.question,
      rule: step.rule,
      candidates,
      attempt,
      attemptsAllowed: ATTEMPTS_BEFORE_DEFAULT,
      chosen: [...chosen],
      party,
    };

    let verdict: ChoiceVerdict;
    try {
      verdict = verifyChoice(await decide.choisir(question), candidates);
    } catch {
      verdict = {
        accepted: false,
        why: NO_REASON_GIVEN,
        reason: 'le port de décision a échoué : tentative perdue',
      };
    }

    if (verdict.accepted) {
      return {
        stepId: step.id,
        chosenId: verdict.chosenId,
        why: verdict.why,
        attempts: attempt,
        viaDefault: false,
      };
    }
  }

  return {
    stepId: step.id,
    chosenId: fallback.id,
    why: DEFAULT_TAKEN_REASON,
    attempts: ATTEMPTS_BEFORE_DEFAULT,
    viaDefault: true,
  };
}

async function runPhase(
  steps: readonly ScenarioStep[],
  registry: ContentRegistry,
  party: readonly ScenarioPartyMember[],
  selection: Map<ScenarioStepId, string>,
  choices: ScenarioChoice[],
  seed: string,
  decide: ScenarioDecisionPort,
): Promise<ScenarioStep | null> {
  for (const step of steps) {
    const choice = await runStep(step, registry, party, selection, choices, seed, decide);
    if (choice === null) return step;
    selection.set(step.id, choice.chosenId);
    choices.push(choice);
  }
  return null;
}

const selectionOf = (choices: readonly ScenarioChoice[]): Map<ScenarioStepId, string> =>
  new Map(choices.map((choice) => [choice.stepId, choice.chosenId]));

const noCandidate = (step: ScenarioStep): ScenarioBuildResult => ({
  ok: false,
  refusal: {
    code: 'no_candidate',
    stepId: step.id,
    message:
      `étape « ${step.element} » : aucun candidat. ${step.rule} ` +
      'Le contenu chargé n’en porte aucun — le scénario ne part pas.',
  },
});

/** Step A of decision 3: the state of the world, decided before anybody is cast. */
export async function buildSituation(request: SituationRequest): Promise<ScenarioBuildResult> {
  const selection = new Map<ScenarioStepId, string>();
  const choices: ScenarioChoice[] = [];
  const stuck = await runPhase(
    stepsOfPhase('situation'),
    request.registry,
    [],
    selection,
    choices,
    request.seed,
    request.decide,
  );
  if (stuck !== null) return noCandidate(stuck);

  return {
    ok: true,
    build: {
      seed: request.seed,
      stream: SCENARIO_RNG_STREAM,
      phase: 'situation',
      choices,
      scenario: assembleScenario(request.registry, selection),
    },
  };
}

/**
 * Step B of decision 3: why THESE characters.
 *
 * REFUSES AN EMPTY TABLE rather than building something lopsided. A ressort is
 * chosen against `appliesTo`, which reads the sheets; with nobody cast the
 * candidate list would be empty and the default would hang a stranger's
 * ressort on a band that does not exist yet.
 */
export async function buildHooks(request: HooksRequest): Promise<ScenarioBuildResult> {
  if (request.party.length === 0) {
    return {
      ok: false,
      refusal: {
        code: 'party_required',
        stepId: 'ressort',
        message:
          'étape « Ressort » : la distribution est vide. Les ressorts se choisissent APRÈS ' +
          'les personnages (ADR 0012, décision 3) — rien à accrocher.',
      },
    };
  }

  const selection = selectionOf(request.situation.choices);
  const choices = [...request.situation.choices];
  const stuck = await runPhase(
    stepsOfPhase('ressorts'),
    request.registry,
    request.party,
    selection,
    choices,
    request.situation.seed,
    request.decide,
  );
  if (stuck !== null) return noCandidate(stuck);

  return {
    ok: true,
    build: {
      seed: request.situation.seed,
      stream: SCENARIO_RNG_STREAM,
      phase: 'ressorts',
      choices,
      scenario: assembleScenario(request.registry, selection),
    },
  };
}

/** The two phases, for a caller who already has a table. */
export async function buildScenario(request: ScenarioRequest): Promise<ScenarioBuildResult> {
  const situation = await buildSituation(request);
  if (!situation.ok) return situation;
  return buildHooks({
    registry: request.registry,
    situation: situation.build,
    party: request.party,
    decide: request.decide,
  });
}
