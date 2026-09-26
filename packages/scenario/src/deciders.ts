/**
 * Two implementations of the decision port that open no socket.
 *
 * The same reasoning as the narrator's `stub` adapter (02-mj-ia.md section
 * 0.6): the simulator, the CI and the tests must be able to build a scenario
 * with no key and no model. NO SDK IS NAMED IN THIS PACKAGE, here or anywhere
 * else — a real model plugs in from `@for/ai`, behind the same interface.
 *
 * Both are declared `: ScenarioDecisionPort`, which is what keeps them from
 * drifting from the real thing. The trap the recipe names — a double declared
 * with one parameter fewer, which compiles without a word and makes the
 * missing argument invisible to the whole suite — is closed twice: by that
 * annotation, and by `build.test.ts` « le faux reçoit tout ce que le vrai
 * reçoit », which asserts the exact key set of the question object.
 */

import type { ScenarioDecision, ScenarioDecisionPort, ScenarioQuestion } from './types.js';

const because = (question: ScenarioQuestion): string =>
  `choix par défaut pour « ${question.stepId} », sans modèle`;

/**
 * Answers the first candidate, every time.
 *
 * The first candidate is the first AFTER the shuffle, so this port still
 * produces a scenario that varies with the seed — it simply makes no
 * editorial choice. That is the honest no-model behaviour.
 */
export function firstCandidateDecider(portId = 'stub'): ScenarioDecisionPort {
  return {
    portId,
    choisir(question: ScenarioQuestion): Promise<ScenarioDecision> {
      const first = question.candidates[0];
      return Promise.resolve({
        choiceId: first === undefined ? '' : first.id,
        why: because(question),
      });
    },
  };
}

export interface ScriptedDeciderOptions {
  readonly portId?: string;
  /**
   * What to answer once the script is exhausted for a step.
   *
   * `'first'` falls back to the first candidate; `'silence'` answers the empty
   * string, which `verifyChoice` refuses — that is how a test drives the
   * three-attempts-then-default path without a throwing port.
   */
  readonly whenExhausted?: 'first' | 'silence';
}

/**
 * Answers from a script, one entry per attempt, keyed by step.
 *
 * `{ periode: ['inventé', 'freljord-moderne'] }` answers an invented id on the
 * first attempt and a real one on the second — the shape the "an invented id
 * is refused and the question is asked again" criterion needs.
 */
export function scriptedDecider(
  script: Readonly<Partial<Record<string, readonly string[]>>>,
  options: ScriptedDeciderOptions = {},
): ScenarioDecisionPort {
  const whenExhausted = options.whenExhausted ?? 'first';
  return {
    portId: options.portId ?? 'scripted',
    choisir(question: ScenarioQuestion): Promise<ScenarioDecision> {
      const answers = script[question.stepId];
      const scripted = answers?.[question.attempt - 1];
      if (scripted !== undefined) {
        return Promise.resolve({ choiceId: scripted, why: `réponse ${String(question.attempt)}` });
      }
      if (whenExhausted === 'silence') {
        return Promise.resolve({ choiceId: '', why: '' });
      }
      const first = question.candidates[0];
      return Promise.resolve({
        choiceId: first === undefined ? '' : first.id,
        why: because(question),
      });
    },
  };
}
