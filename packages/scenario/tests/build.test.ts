/**
 * La machine : ce qu'elle refuse, ce qu'elle dégrade, et ce qu'elle rejoue.
 *
 * Tous les chiffres de critère sont écrits EN TOUTES LETTRES — trois
 * tentatives, dix graines, huit scénarios distincts — jamais lus depuis la
 * constante qu'ils vérifient (ADR 0007).
 */

import { describe, expect, it } from 'vitest';

import {
  assembleScenario,
  buildHooks,
  buildScenario,
  buildSituation,
  ScenarioAssemblyError,
} from '../src/build.js';
import { firstCandidateDecider, scriptedDecider } from '../src/deciders.js';
import type { ScenarioSelection } from '../src/steps.js';
import type {
  ScenarioBuild,
  ScenarioDecision,
  ScenarioDecisionPort,
  ScenarioPartyMember,
  ScenarioQuestion,
  ScenarioStepId,
} from '../src/types.js';

import { corpusRegistry, ENTRY_NODE_ID, MODERN } from './corpus.js';

const registry = corpusRegistry();

const BRAUM: ScenarioPartyMember = {
  characterId: 'pj-1',
  championId: 'braum',
  traits: ['defense'],
  regionIds: ['freljord'],
  factionIds: [],
};

const ASHE: ScenarioPartyMember = {
  characterId: 'pj-2',
  championId: 'ashe',
  traits: ['commandement'],
  regionIds: ['avarosa-reach'],
  factionIds: ['avarosans'],
};

const PARTY = [BRAUM, ASHE];

/** Enregistre TOUT ce que le port reçoit. Déclaré `ScenarioDecisionPort`. */
const recordingDecider = (
  answer: (question: ScenarioQuestion) => ScenarioDecision,
): { readonly port: ScenarioDecisionPort; readonly seen: ScenarioQuestion[] } => {
  const seen: ScenarioQuestion[] = [];
  const port: ScenarioDecisionPort = {
    portId: 'recording',
    choisir(question: ScenarioQuestion): Promise<ScenarioDecision> {
      seen.push(question);
      return Promise.resolve(answer(question));
    },
  };
  return { port, seen };
};

const ok = (result: Awaited<ReturnType<typeof buildScenario>>): ScenarioBuild => {
  if (!result.ok) throw new Error(`refus inattendu : ${result.refusal.message}`);
  return result.build;
};

const chosen = (build: ScenarioBuild, stepId: ScenarioStepId): string => {
  const found = build.choices.find((choice) => choice.stepId === stepId);
  if (found === undefined) throw new Error(`étape « ${stepId} » absente du compte rendu`);
  return found.chosenId;
};

// ─────────────────────────────────────────────────────────────────────────

describe('une construction complète', () => {
  it('joue les dix étapes, dans l’ordre, et assemble un scénario jouable', async () => {
    const build = ok(
      await buildScenario({
        registry,
        seed: 'campagne-1',
        party: PARTY,
        decide: firstCandidateDecider(),
      }),
    );
    expect(build.choices.map((choice) => choice.stepId)).toEqual([
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
    ]);
    expect(build.stream).toBe('scenario');
    expect(build.phase).toBe('ressorts');

    const scenario = build.scenario;
    const front = registry.getFront(scenario.frontId);
    expect(registry.getPeriod(scenario.periodId).id).toBe(scenario.periodId);
    expect(front.periodId).toBe(scenario.periodId);
    expect(front.regionIds).toContain(scenario.regionId);
    expect(scenario.segments).toBe(front.segments);
    expect(scenario.crossedPortent).toBeGreaterThanOrEqual(1);
    expect(scenario.crossedPortent).toBeLessThan(front.segments);
    expect(registry.getNode(scenario.entryNodeId).entryPoint).toBe(true);
    expect(scenario.hookId).not.toBeNull();
    expect(scenario.vowRank).toBe(registry.getHook(scenario.hookId ?? '').vowRank);
    expect(scenario.vowTarget).not.toBeNull();
  });

  it('AUCUN texte du scénario ne vient du modèle : tout est copié du contenu', async () => {
    // Le port répond juste, mais sa justification est pleine de lore inventé.
    const invente = 'La Reine des Braises de Zaun-sur-Glace';
    const { port } = recordingDecider((question) => ({
      choiceId: question.candidates[0]?.id ?? '',
      why: `parce que ${invente} l'a voulu`,
    }));
    const build = ok(
      await buildScenario({ registry, seed: 'campagne-2', party: PARTY, decide: port }),
    );
    const scenario = build.scenario;
    const front = registry.getFront(scenario.frontId);

    expect(scenario.stake).toBe(front.stake);
    expect(scenario.crossedPortentText).toBe(front.portents[scenario.crossedPortent - 1]);
    expect(scenario.stakeQuestion).toBe(
      registry.getNode(scenario.stakeQuestionNodeId ?? '').stakeQuestion,
    );
    expect(scenario.figureDisposition).toBe(registry.getFigure(scenario.figureId).disposition);
    expect(JSON.stringify(scenario)).not.toContain(invente);
  });
});

describe('un identifiant inventé est refusé, et la question est reposée', () => {
  it('le double rend `figure-qui-nexiste-pas`, l’étape est reposée, la deuxième réponse tient', async () => {
    const decide = scriptedDecider({
      periode: [MODERN],
      figure: ['figure-qui-nexiste-pas', 'le-scribe-sans-nom'],
    });
    const build = ok(await buildScenario({ registry, seed: 'campagne-3', party: PARTY, decide }));
    const figure = build.choices.find((choice) => choice.stepId === 'figure');
    expect(figure?.chosenId).toBe('le-scribe-sans-nom');
    expect(figure?.attempts).toBe(2);
    expect(figure?.viaDefault).toBe(false);
  });

  it('l’identifiant inventé n’apparaît nulle part dans le scénario assemblé', async () => {
    const decide = scriptedDecider({
      periode: [MODERN],
      figure: ['figure-qui-nexiste-pas', 'le-scribe-sans-nom'],
    });
    const build = ok(await buildScenario({ registry, seed: 'campagne-3', party: PARTY, decide }));
    expect(JSON.stringify(build.scenario)).not.toContain('figure-qui-nexiste-pas');
  });

  it('la question reposée porte le même tableau de candidats, et dit la tentative', async () => {
    const { port, seen } = recordingDecider((question) =>
      question.attempt === 1
        ? { choiceId: 'rien-de-tout-ca', why: 'au hasard' }
        : { choiceId: question.candidates[0]?.id ?? '', why: 'la bonne' },
    );
    await buildSituation({ registry, seed: 'campagne-4', decide: port });
    const periode = seen.filter((question) => question.stepId === 'periode');
    expect(periode).toHaveLength(2);
    expect(periode[0]?.attempt).toBe(1);
    expect(periode[1]?.attempt).toBe(2);
    expect(periode[0]?.candidates).toEqual(periode[1]?.candidates);
  });
});

describe('trois échecs mènent au défaut, jamais à une exception', () => {
  it('le double rend n’importe quoi : la construction ABOUTIT sur le défaut', async () => {
    const { port, seen } = recordingDecider(() => ({ choiceId: 'n-importe-quoi', why: '' }));
    const build = ok(
      await buildScenario({ registry, seed: 'campagne-5', party: PARTY, decide: port }),
    );
    expect(build.choices).toHaveLength(10);
    for (const choice of build.choices) {
      expect(choice.viaDefault).toBe(true);
      // TROIS, en toutes lettres : c'est le chiffre du critère.
      expect(choice.attempts).toBe(3);
    }
    expect(seen).toHaveLength(10 * 3);
  });

  it('le défaut est le PREMIER candidat du mélange, donc fonction de la graine', async () => {
    const { port, seen } = recordingDecider(() => ({ choiceId: 'n-importe-quoi', why: '' }));
    const build = ok(await buildSituation({ registry, seed: 'campagne-5', decide: port }));
    const premiere = seen[0];
    expect(build.choices[0]?.chosenId).toBe(premiere?.candidates[0]?.id);
  });

  it('un port qui LÈVE ne casse pas la construction : la tentative est perdue, c’est tout', async () => {
    let calls = 0;
    const port: ScenarioDecisionPort = {
      portId: 'cassé',
      choisir(question: ScenarioQuestion): Promise<ScenarioDecision> {
        calls += 1;
        if (question.stepId === 'figure' && question.attempt < 3) {
          return Promise.reject(new Error('le modèle est tombé'));
        }
        return Promise.resolve({ choiceId: question.candidates[0]?.id ?? '', why: 'ok' });
      },
    };
    const build = ok(
      await buildScenario({ registry, seed: 'campagne-6', party: PARTY, decide: port }),
    );
    const figure = build.choices.find((choice) => choice.stepId === 'figure');
    expect(figure?.attempts).toBe(3);
    expect(figure?.viaDefault).toBe(false);
    expect(calls).toBe(12);
  });
});

describe('rejouable', () => {
  it('même graine, mêmes réponses : le même scénario, OCTET À OCTET', async () => {
    const run = async (seed: string): Promise<string> =>
      JSON.stringify(
        ok(await buildScenario({ registry, seed, party: PARTY, decide: firstCandidateDecider() })),
      );
    expect(await run('campagne-7')).toBe(await run('campagne-7'));
  });

  it('changer la graine change le scénario', async () => {
    const run = async (seed: string): Promise<string> =>
      JSON.stringify(
        ok(await buildScenario({ registry, seed, party: PARTY, decide: firstCandidateDecider() }))
          .scenario,
      );
    expect(await run('campagne-7')).not.toBe(await run('campagne-8'));
  });

  it('l’étape B se rejoue seule depuis le build d’étape A, à l’identique', async () => {
    const decide = firstCandidateDecider();
    const complet = ok(await buildScenario({ registry, seed: 'campagne-9', party: PARTY, decide }));
    const situation = ok(await buildSituation({ registry, seed: 'campagne-9', decide }));
    const repris = ok(await buildHooks({ registry, situation, party: PARTY, decide }));
    expect(JSON.stringify(repris)).toBe(JSON.stringify(complet));
  });
});

describe('variable', () => {
  it('dix graines donnent au moins HUIT scénarios distincts', async () => {
    const graines = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10'];
    expect(graines).toHaveLength(10);
    const scenarios = new Set<string>();
    for (const seed of graines) {
      const build = ok(
        await buildScenario({ registry, seed, party: PARTY, decide: firstCandidateDecider() }),
      );
      scenarios.add(JSON.stringify(build.scenario));
    }
    expect(scenarios.size).toBeGreaterThanOrEqual(8);
  });
});

describe('l’étape B ne tourne pas sans personnages', () => {
  it('refus explicite, nommé, et aucun scénario bancal', async () => {
    const decide = firstCandidateDecider();
    const situation = ok(await buildSituation({ registry, seed: 'campagne-10', decide }));
    const result = await buildHooks({ registry, situation, party: [], decide });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('inatteignable');
    expect(result.refusal.code).toBe('party_required');
    expect(result.refusal.stepId).toBe('ressort');
    expect(result.refusal.message).toContain('distribution est vide');
  });

  it('l’étape A seule aboutit, et laisse les champs de l’étape B à null', async () => {
    const build = ok(
      await buildSituation({ registry, seed: 'campagne-10', decide: firstCandidateDecider() }),
    );
    expect(build.phase).toBe('situation');
    expect(build.choices).toHaveLength(7);
    expect(build.scenario.hookId).toBeNull();
    expect(build.scenario.vowRank).toBeNull();
    expect(build.scenario.vowTarget).toBeNull();
    expect(build.scenario.stakeQuestion).toBeNull();
    expect(build.scenario.bondFigureIds).toEqual([]);
  });
});

describe('un contenu qui ne porte rien est refusé, pas dégradé', () => {
  it('aucune pièce de scénario : refus nommant l’étape et sa règle', async () => {
    const vide = corpusRegistry();
    const sansPeriode: typeof vide = {
      ...vide,
      listPeriods: () => [],
    };
    const result = await buildSituation({
      registry: sansPeriode,
      seed: 'campagne-11',
      decide: firstCandidateDecider(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('inatteignable');
    expect(result.refusal.code).toBe('no_candidate');
    expect(result.refusal.stepId).toBe('periode');
    expect(result.refusal.message).toContain('Période');
  });

  it('`buildScenario` s’arrête sur le refus de l’étape A, sans entamer l’étape B', async () => {
    const vide = corpusRegistry();
    const sansPeriode: typeof vide = { ...vide, listPeriods: () => [] };
    const { port, seen } = recordingDecider((question) => ({
      choiceId: question.candidates[0]?.id ?? '',
      why: 'va',
    }));
    const result = await buildScenario({
      registry: sansPeriode,
      seed: 'campagne-16',
      party: PARTY,
      decide: port,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('inatteignable');
    expect(result.refusal.stepId).toBe('periode');
    expect(seen).toEqual([]);
  });

  it('un refus au milieu de l’étape B nomme l’étape B', async () => {
    const vide = corpusRegistry();
    const sansRessort: typeof vide = { ...vide, listHooks: () => [] };
    const decide = firstCandidateDecider();
    const situation = ok(await buildSituation({ registry, seed: 'campagne-12', decide }));
    const result = await buildHooks({ registry: sansRessort, situation, party: PARTY, decide });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('inatteignable');
    expect(result.refusal.stepId).toBe('ressort');
  });
});

describe('ce que le faux reçoit, le vrai le recevra', () => {
  it('la question porte exactement les neuf champs annoncés', async () => {
    const { port, seen } = recordingDecider((question) => ({
      choiceId: question.candidates[0]?.id ?? '',
      why: 'va',
    }));
    await buildScenario({ registry, seed: 'campagne-13', party: PARTY, decide: port });
    const question = seen[0];
    expect(question).toBeDefined();
    expect(Object.keys(question ?? {}).sort()).toEqual(
      [
        'attempt',
        'attemptsAllowed',
        'candidates',
        'chosen',
        'party',
        'phase',
        'question',
        'rule',
        'stepId',
      ].sort(),
    );
  });

  it('la distribution arrive ENTIÈRE jusqu’au port, aux deux places de la table', async () => {
    const { port, seen } = recordingDecider((question) => ({
      choiceId: question.candidates[0]?.id ?? '',
      why: 'va',
    }));
    await buildScenario({ registry, seed: 'campagne-13', party: PARTY, decide: port });
    const ressort = seen.find((question) => question.stepId === 'ressort');
    expect(ressort?.party.map((member) => member.characterId)).toEqual(['pj-1', 'pj-2']);
  });

  it('l’étape A ne voit personne : `party` y est vide', async () => {
    const { port, seen } = recordingDecider((question) => ({
      choiceId: question.candidates[0]?.id ?? '',
      why: 'va',
    }));
    await buildSituation({ registry, seed: 'campagne-13', decide: port });
    for (const question of seen) expect(question.party).toEqual([]);
  });
});

describe('les candidats sont calculés APRÈS l’attente, pas avant', () => {
  it('l’étape qui suit voit le choix que l’étape précédente a fait sur une promesse', async () => {
    // Le port ne répond qu'après deux tours de micro-tâche : un contexte
    // capturé avant le premier `await` proposerait des régions d'une autre
    // période, et le test tomberait ici.
    const lent: ScenarioDecisionPort = {
      portId: 'lent',
      async choisir(question: ScenarioQuestion): Promise<ScenarioDecision> {
        await Promise.resolve();
        await Promise.resolve();
        if (question.stepId === 'periode') return { choiceId: 'avant-les-soeurs', why: 'loin' };
        return { choiceId: question.candidates[0]?.id ?? '', why: 'suite' };
      },
    };
    const build = ok(await buildSituation({ registry, seed: 'campagne-14', decide: lent }));
    expect(chosen(build, 'periode')).toBe('avant-les-soeurs');
    expect(chosen(build, 'lieu')).toBe('freljord');
    expect(registry.getFront(chosen(build, 'front')).periodId).toBe('avant-les-soeurs');
    expect(registry.getNode(chosen(build, 'noeud')).periodId).toBe('avant-les-soeurs');
  });

  it('deux constructions menées en parallèle ne se mélangent pas', async () => {
    const decide = firstCandidateDecider();
    const [a, b, seul] = await Promise.all([
      buildScenario({ registry, seed: 'parallele-a', party: PARTY, decide }),
      buildScenario({ registry, seed: 'parallele-b', party: PARTY, decide }),
      buildScenario({ registry, seed: 'parallele-a', party: PARTY, decide }),
    ]);
    expect(JSON.stringify(ok(a))).toBe(JSON.stringify(ok(seul)));
    expect(JSON.stringify(ok(a))).not.toBe(JSON.stringify(ok(b)));
  });
});

describe('assembleScenario', () => {
  it('assembler une sélection tronquée se plaint de l’étape manquante', () => {
    const selection: ScenarioSelection = new Map<ScenarioStepId, string>([
      ['periode', MODERN],
      ['lieu', 'avarosa-reach'],
    ]);
    const caught = ((): unknown => {
      try {
        assembleScenario(registry, selection);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(caught).toBeInstanceOf(ScenarioAssemblyError);
    expect((caught as ScenarioAssemblyError).stepId).toBe('front');
    expect((caught as Error).message).toContain('front');
  });

  it.each([
    ['illisible', 'pas-un-presage'],
    ['celui d’un AUTRE front', 'la-griffe-descend-des-cols#2'],
    ['hors des présages du front', 'la-famine-remonte-le-fleuve#99'],
  ])('un identifiant de présage %s se plaint, il ne rend pas un présage vide', (_nom, enjeu) => {
    const selection: ScenarioSelection = new Map<ScenarioStepId, string>([
      ['periode', MODERN],
      ['lieu', 'avarosa-reach'],
      ['front', 'la-famine-remonte-le-fleuve'],
      ['enjeu', enjeu],
      ['figure', 'la-gardienne-du-grain'],
      ['noeud', ENTRY_NODE_ID],
      ['piste', ENTRY_NODE_ID],
    ]);
    expect(() => assembleScenario(registry, selection)).toThrow(ScenarioAssemblyError);
  });
});

describe('les adaptateurs simulés', () => {
  it('`firstCandidateDecider` porte un identifiant de port, comme `NarratorPort`', () => {
    expect(firstCandidateDecider().portId).toBe('stub');
    expect(firstCandidateDecider('autre').portId).toBe('autre');
  });

  it('`scriptedDecider` en mode silence force le chemin du défaut', async () => {
    const decide = scriptedDecider({}, { whenExhausted: 'silence', portId: 'muet' });
    expect(decide.portId).toBe('muet');
    const build = ok(await buildSituation({ registry, seed: 'campagne-15', decide }));
    for (const choice of build.choices) expect(choice.viaDefault).toBe(true);
  });

  it('un port muet devant une liste vide rend une chaîne vide plutôt que de lever', async () => {
    const decide = firstCandidateDecider();
    const reponse = await decide.choisir({
      stepId: 'periode',
      phase: 'situation',
      question: 'q ?',
      rule: 'r',
      candidates: [],
      attempt: 1,
      attemptsAllowed: 3,
      chosen: [],
      party: [],
    });
    expect(reponse.choiceId).toBe('');
    const scripted = await scriptedDecider({}).choisir({
      stepId: 'periode',
      phase: 'situation',
      question: 'q ?',
      rule: 'r',
      candidates: [],
      attempt: 1,
      attemptsAllowed: 3,
      chosen: [],
      party: [],
    });
    expect(scripted.choiceId).toBe('');
  });
});
