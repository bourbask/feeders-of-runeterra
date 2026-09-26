/**
 * Les dix étapes de la section 6, et ce que chacune ferme.
 *
 * Les dix identifiants, leurs éléments et leurs phases sont ÉPINGLÉS EN
 * TOUTES LETTRES : ils ne mirroitent rien dans le moteur, donc la règle
 * opératoire de l'ADR 0007 dit de les écrire, pas de les « comparer » à une
 * liste qui n'existe pas.
 */

import { SegmentCountSchema } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { regionIdsOfPeriod } from '../src/candidates.js';
import type { ScenarioSelection } from '../src/steps.js';
import {
  hookMatchesParty,
  parsePortentCandidateId,
  parseVowCandidateId,
  portentCandidateId,
  SCENARIO_STEPS,
  stepsOfPhase,
  vowCandidateId,
} from '../src/steps.js';
import type { ScenarioPartyMember, ScenarioStepId } from '../src/types.js';
import { SCENARIO_STEP_IDS } from '../src/types.js';

import {
  ANCIENT,
  ANCIENT_ENTRY_NODE_ID,
  corpusRegistry,
  crossPeriodLeadRegistry,
  ENTRY_NODE_ID,
  LONG_NIGHT,
  MODERN,
  MODERN_REGIONS,
  PLAYABLE_PERIODS,
} from './corpus.js';

const registry = corpusRegistry();

const selection = (entries: Partial<Record<ScenarioStepId, string>>): ScenarioSelection =>
  new Map(Object.entries(entries) as [ScenarioStepId, string][]);

const step = (id: ScenarioStepId) => {
  const found = SCENARIO_STEPS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`étape « ${id} » absente`);
  return found;
};

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

const candidatesOf = (
  id: ScenarioStepId,
  entries: Partial<Record<ScenarioStepId, string>>,
  party: readonly ScenarioPartyMember[] = [],
): readonly string[] =>
  step(id)
    .candidates({ registry, party, selection: selection(entries) })
    .map((candidate) => candidate.id);

describe('les dix étapes de la section 6, dans l’ordre', () => {
  it('les dix identifiants, écrits en toutes lettres', () => {
    expect(SCENARIO_STEPS.map((item) => item.id)).toEqual([
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
    expect([...SCENARIO_STEP_IDS]).toEqual(SCENARIO_STEPS.map((item) => item.id));
  });

  it('les dix éléments, dans les mots de la section 6', () => {
    expect(SCENARIO_STEPS.map((item) => item.element)).toEqual([
      'Période',
      'Lieu',
      'Front',
      'Enjeu',
      'Figures',
      'Nœuds',
      'Pistes',
      'Ressort',
      'Serment d’ouverture',
      'Question d’enjeu',
    ]);
  });

  it('la coupure de la décision 3 est entre la septième et la huitième', () => {
    expect(stepsOfPhase('situation').map((item) => item.id)).toEqual([
      'periode',
      'lieu',
      'front',
      'enjeu',
      'figure',
      'noeud',
      'piste',
    ]);
    expect(stepsOfPhase('ressorts').map((item) => item.id)).toEqual([
      'ressort',
      'serment',
      'question-d-enjeu',
    ]);
  });

  it('chaque étape pose une question en français et dit sa règle', () => {
    for (const item of SCENARIO_STEPS) {
      expect(item.question.endsWith('?')).toBe(true);
      expect(item.rule.trim()).not.toBe('');
    }
  });
});

describe('chaque étape ferme sa liste sur la période', () => {
  it('période : seulement celles sur lesquelles un scénario tient debout', () => {
    // Le corpus porte SIX périodes ; trois seulement ont un front, une figure
    // et un nœud d'entrée dans une région que ce front menace. Offrir les
    // trois autres ferait dépenser la première question pour finir sur un
    // refus — mesuré, c'est ce qui arrivait avant le filtre.
    expect(registry.listPeriods()).toHaveLength(6);
    expect([...candidatesOf('periode', {})].sort()).toEqual([...PLAYABLE_PERIODS].sort());
  });

  it('une région sans point d’entrée n’est pas jouable, même si un front la menace', () => {
    // `howling-abyss` est menacée par « le-givre-rouvre-l-abime » sur la
    // période moderne ET porte des nœuds d'entrée : elle est jouable.
    // Sur la Longue Nuit, le même front la menace mais aucun nœud n'y ouvre.
    expect(regionIdsOfPeriod(registry, LONG_NIGHT)).toContain('howling-abyss');
    expect(candidatesOf('lieu', { periode: LONG_NIGHT })).not.toContain('howling-abyss');
    expect(candidatesOf('lieu', { periode: LONG_NIGHT })).toEqual(['frostguard-citadel']);
  });

  it('lieu : les régions de la période, et rien d’autre', () => {
    expect([...candidatesOf('lieu', { periode: MODERN })].sort()).toEqual(
      [...MODERN_REGIONS].sort(),
    );
    expect(candidatesOf('lieu', { periode: ANCIENT })).toEqual(['freljord']);
  });

  it('front : ceux de la période QUI touchent la région choisie', () => {
    const list = candidatesOf('front', { periode: MODERN, lieu: 'howling-abyss' });
    expect(list).toEqual(['le-givre-rouvre-l-abime']);
    const autre = candidatesOf('front', { periode: MODERN, lieu: 'avarosa-reach' });
    expect([...autre].sort()).toEqual([
      'la-famine-remonte-le-fleuve',
      'la-griffe-descend-des-cols',
    ]);
  });

  it('enjeu : un présage par segment, le dernier excepté — pour chaque taille du moteur', () => {
    // Parcourt le tuple du moteur, il n'est pas retapé ici.
    const bySegments = new Map(
      registry.listFronts().map((front) => [front.segments, front] as const),
    );
    for (const count of SegmentCountSchema.def.values) {
      const front = bySegments.get(count);
      expect(front, `aucun front à ${String(count)} segments dans le corpus`).toBeDefined();
      if (front === undefined) continue;
      const list = candidatesOf('enjeu', { front: front.id });
      expect(list).toHaveLength(count - 1);
      expect(list[0]).toBe(portentCandidateId(front.id, 1));
      expect(list.at(-1)).toBe(portentCandidateId(front.id, count - 1));
    }
  });

  it('figure : celles de la période, et pas une figure moderne sous une période ancienne', () => {
    const anciennes = candidatesOf('figure', { periode: ANCIENT });
    expect(anciennes).toContain('la-voix-des-souches');
    expect(anciennes).not.toContain('la-gardienne-du-grain');
  });

  it('nœud : les points d’entrée de la période, dans la région choisie', () => {
    const list = candidatesOf('noeud', { periode: MODERN, lieu: 'avarosa-reach' });
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const id of list) {
      const node = registry.getNode(id);
      expect(node.entryPoint).toBe(true);
      expect(node.regionId).toBe('avarosa-reach');
      expect(node.periodId).toBe(MODERN);
    }
  });

  it('piste : les destinations du nœud d’entrée, trois distinctes', () => {
    const list = candidatesOf('piste', { periode: MODERN, noeud: ENTRY_NODE_ID });
    expect(new Set(list).size).toBe(3);
    expect(list).not.toContain(ENTRY_NODE_ID);
  });

  it('piste : une destination d’UNE AUTRE PÉRIODE est écartée', () => {
    // Le seul document du corpus qui n'est pas propre au sens de S-02 : il
    // porte une piste qui traverse les périodes. Si un jour `validateContent`
    // le refuse, c'est que la règle 3 de S-02 est arrivée — ce filtre devient
    // redondant et ce test peut tomber.
    const croisé = crossPeriodLeadRegistry();
    const list = step('piste')
      .candidates({
        registry: croisé,
        party: [],
        selection: selection({ periode: MODERN, noeud: ENTRY_NODE_ID }),
      })
      .map((candidate) => candidate.id);
    expect(croisé.getNode(ENTRY_NODE_ID).leads.map((lead) => lead.toNodeId)).toContain(
      ANCIENT_ENTRY_NODE_ID,
    );
    expect(list).not.toContain(ANCIENT_ENTRY_NODE_ID);
    expect(list).toHaveLength(2);
  });
});

describe('l’étape B lit les fiches — et les lit TOUTES', () => {
  it('un ressort accroché au DEUXIÈME personnage est proposé', () => {
    // À un seul acteur, un `party[0]` codé en dur passerait inaperçu.
    const list = candidatesOf('ressort', { periode: MODERN }, [BRAUM, ASHE]);
    expect(list).toContain('la-fleche-et-le-grain');
    const seul = candidatesOf('ressort', { periode: MODERN }, [BRAUM]);
    expect(seul).not.toContain('la-fleche-et-le-grain');
  });

  it('les quatre formes de `appliesTo` se résolvent, et refusent qui ne correspond pas', () => {
    expect(hookMatchesParty({ kind: 'champion', championId: 'braum' }, [BRAUM])).toBe(true);
    expect(hookMatchesParty({ kind: 'champion', championId: 'ashe' }, [BRAUM])).toBe(false);
    expect(hookMatchesParty({ kind: 'trait', tag: 'defense' }, [BRAUM])).toBe(true);
    expect(hookMatchesParty({ kind: 'trait', tag: 'ruse' }, [BRAUM])).toBe(false);
    expect(hookMatchesParty({ kind: 'region', regionId: 'avarosa-reach' }, [ASHE])).toBe(true);
    expect(hookMatchesParty({ kind: 'region', regionId: 'rakelstake' }, [ASHE])).toBe(false);
    expect(hookMatchesParty({ kind: 'faction', factionId: 'avarosans' }, [ASHE])).toBe(true);
    expect(hookMatchesParty({ kind: 'faction', factionId: 'avarosans' }, [BRAUM])).toBe(false);
    expect(hookMatchesParty({ kind: 'champion', championId: 'braum' }, [])).toBe(false);
  });

  it('sans distribution, aucun ressort n’est proposé', () => {
    expect(candidatesOf('ressort', { periode: MODERN }, [])).toEqual([]);
  });

  it('quand AUCUN ressort ne vise la bande, la liste s’élargit au lieu de se vider', () => {
    // Braum et Ashe ne touchent aucun ressort de la Longue Nuit — ni la
    // Citadelle, ni les Gardiens. Refuser ici laisserait la campagne à
    // mi-chemin ; on élargit, et le candidat le dit.
    const personne: ScenarioPartyMember = {
      characterId: 'pj-3',
      championId: 'braum',
      traits: [],
      regionIds: [],
      factionIds: [],
    };
    const élargie = step('ressort').candidates({
      registry,
      party: [personne],
      selection: selection({ periode: LONG_NIGHT }),
    });
    expect(élargie.map((c) => c.id).sort()).toEqual(
      registry
        .listHooks()
        .filter((h) => h.periodId === LONG_NIGHT)
        .map((h) => h.id)
        .sort(),
    );
    for (const candidate of élargie) {
      expect(candidate.detail).toContain('ne vise personne à cette table');
    }
  });

  it('dès qu’un ressort vise quelqu’un, les autres disparaissent', () => {
    const viseur: ScenarioPartyMember = {
      characterId: 'pj-4',
      championId: 'braum',
      traits: [],
      regionIds: ['frostguard-citadel'],
      factionIds: [],
    };
    const ciblée = step('ressort').candidates({
      registry,
      party: [viseur],
      selection: selection({ periode: LONG_NIGHT }),
    });
    expect(ciblée.map((c) => c.id)).toEqual(['le-feu-qu-on-vous-a-confie']);
    expect(ciblée[0]?.detail).not.toContain('ne vise personne');
  });

  it('serment : le front à arrêter, plus les figures que le ressort met sur la route', () => {
    const list = candidatesOf(
      'serment',
      {
        periode: MODERN,
        front: 'la-famine-remonte-le-fleuve',
        noeud: ENTRY_NODE_ID,
        figure: 'le-scribe-sans-nom',
        ressort: 'on-vous-doit-un-hiver',
      },
      [BRAUM],
    );
    expect(list[0]).toBe('front:la-famine-remonte-le-fleuve');
    expect(list).toContain('figure:la-gardienne-du-grain');
    expect(list).toContain('figure:le-scribe-sans-nom');
    // Aucun rang n'est proposé : le rang vient du ressort, jamais du modèle.
    expect(list.some((id) => id.startsWith('rang:'))).toBe(false);
  });

  it('question d’enjeu : les nœuds où le ressort mène, jamais une question inventée', () => {
    const list = candidatesOf(
      'question-d-enjeu',
      {
        periode: MODERN,
        noeud: ENTRY_NODE_ID,
        piste: registry.getNode(ENTRY_NODE_ID).leads[0]?.toNodeId ?? '',
        ressort: 'on-vous-doit-un-hiver',
      },
      [BRAUM],
    );
    expect(list).toContain(ENTRY_NODE_ID);
    for (const id of list) expect(registry.getNode(id).periodId).toBe(MODERN);
  });

  it('question d’enjeu : un nœud moderne que le ressort N’ATTEINT PAS est ÉCARTÉ', () => {
    // Les deux assertions ci-dessus restent vraies si le filtre s'ouvre en
    // grand : mesuré, quatre-vingt-quatre tests verts. C'est la question 6 de
    // la recette — il faut une assertion NÉGATIVE.
    const piste = registry.getNode(ENTRY_NODE_ID).leads[0]?.toNodeId ?? '';
    const list = candidatesOf(
      'question-d-enjeu',
      { periode: MODERN, noeud: ENTRY_NODE_ID, piste, ressort: 'on-vous-doit-un-hiver' },
      [BRAUM],
    );

    // Les trois raisons pour lesquelles ce nœud n'est pas atteint sont lues
    // dans le REGISTRE, pas dans l'étape : ni le nœud d'entrée, ni la piste
    // ouverte, ni un nœud où se tient un lien suggéré par le ressort.
    const ÉCARTÉ = 'le-conseil-des-clans';
    const liens = new Set(registry.getHook('on-vous-doit-un-hiver').suggestedBondIds);
    expect(liens.size).toBeGreaterThan(0);
    expect(registry.getNode(ÉCARTÉ).periodId).toBe(MODERN);
    expect(ÉCARTÉ).not.toBe(ENTRY_NODE_ID);
    expect(ÉCARTÉ).not.toBe(piste);
    expect(registry.getNode(ÉCARTÉ).figureIds.some((id) => liens.has(id))).toBe(false);
    expect(list).not.toContain(ÉCARTÉ);

    // Et la liste est STRICTEMENT plus courte que les nœuds modernes : ouvrir
    // le filtre la porterait à vingt.
    const modernes = registry.listNodes().filter((node) => node.periodId === MODERN);
    expect(modernes.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThan(modernes.length);

    // Le tableau exact, trié : huit sur vingt.
    expect([...list].sort()).toEqual([
      'la-tour-basse',
      'la-veille-du-gue',
      'le-col-sans-guetteur',
      'le-convoi-retourne',
      'le-grenier-ouvert-de-l-interieur',
      'le-marche-de-glace',
      'le-puits-noir',
      'les-pierres-dressees',
    ]);
  });
});

describe('question d’enjeu : les trois raisons d’entrer dans la liste', () => {
  // DEUX RESSORTS AU LIEU D’UN. Avec « on-vous-doit-un-hiver », le nœud
  // d’entrée porte lui-même un lien suggéré du ressort : la clause du nœud
  // d’entrée est alors masquée par celle des liens, et la retirer laissait
  // quatre-vingt-onze tests verts — mesuré. « celui-qui-tient-la-porte » ne
  // suggère aucune figure du nœud d’entrée ni de la piste ouverte, ce qui
  // rend les trois clauses séparables.
  const RESSORT = 'celui-qui-tient-la-porte';
  const PISTE = registry.getNode(ENTRY_NODE_ID).leads[0]?.toNodeId ?? '';
  const liens = new Set(registry.getHook(RESSORT).suggestedBondIds);
  const list = candidatesOf(
    'question-d-enjeu',
    { periode: MODERN, noeud: ENTRY_NODE_ID, piste: PISTE, ressort: RESSORT },
    [BRAUM],
  );

  it('le ressort choisi ne suggère aucune figure du nœud d’entrée ni de la piste', () => {
    expect(liens.size).toBeGreaterThan(0);
    expect(registry.getNode(ENTRY_NODE_ID).figureIds.some((id) => liens.has(id))).toBe(false);
    expect(registry.getNode(PISTE).figureIds.some((id) => liens.has(id))).toBe(false);
    expect(PISTE).not.toBe(ENTRY_NODE_ID);
  });

  it('le nœud d’entrée y est, et il n’y est QUE par la clause du nœud d’entrée', () => {
    expect(list).toContain(ENTRY_NODE_ID);
  });

  it('la piste ouverte y est, et elle n’y est QUE par la clause de la piste', () => {
    expect(list).toContain(PISTE);
  });

  it('un nœud où se tient un lien suggéré y est, sans être ni l’entrée ni la piste', () => {
    const PAR_LE_LIEN = 'le-col-sans-guetteur';
    expect(registry.getNode(PAR_LE_LIEN).periodId).toBe(MODERN);
    expect(PAR_LE_LIEN).not.toBe(ENTRY_NODE_ID);
    expect(PAR_LE_LIEN).not.toBe(PISTE);
    expect(registry.getNode(PAR_LE_LIEN).figureIds.some((id) => liens.has(id))).toBe(true);
    expect(list).toContain(PAR_LE_LIEN);
  });

  it('et un nœud moderne qu’aucune des trois raisons n’atteint reste dehors', () => {
    const ÉCARTÉ = 'la-taverne-du-pont-bas';
    expect(registry.getNode(ÉCARTÉ).periodId).toBe(MODERN);
    expect(ÉCARTÉ).not.toBe(ENTRY_NODE_ID);
    expect(ÉCARTÉ).not.toBe(PISTE);
    expect(registry.getNode(ÉCARTÉ).figureIds.some((id) => liens.has(id))).toBe(false);
    expect(list).not.toContain(ÉCARTÉ);
    const modernes = registry.listNodes().filter((node) => node.periodId === MODERN);
    expect(list.length).toBeLessThan(modernes.length);
  });
});

describe('les identifiants composés se relisent', () => {
  it('présage', () => {
    expect(parsePortentCandidateId(portentCandidateId('un-front', 3))).toEqual({
      frontId: 'un-front',
      index: 3,
    });
    expect(parsePortentCandidateId('un-front')).toBeNull();
    expect(parsePortentCandidateId('#3')).toBeNull();
    expect(parsePortentCandidateId('un-front#zero')).toBeNull();
    expect(parsePortentCandidateId('un-front#0')).toBeNull();
  });

  it('serment', () => {
    expect(parseVowCandidateId(vowCandidateId({ kind: 'front', frontId: 'f' }))).toEqual({
      kind: 'front',
      frontId: 'f',
    });
    expect(parseVowCandidateId(vowCandidateId({ kind: 'figure', figureId: 'g' }))).toEqual({
      kind: 'figure',
      figureId: 'g',
    });
    expect(parseVowCandidateId('autre-chose')).toBeNull();
  });
});

describe('une étape dont la question précédente manque ne propose rien', () => {
  it.each([
    ['lieu', {}],
    ['front', { periode: MODERN }],
    ['enjeu', {}],
    ['figure', {}],
    ['noeud', { periode: MODERN }],
    ['piste', { periode: MODERN }],
    ['ressort', {}],
    ['serment', { periode: MODERN }],
    ['question-d-enjeu', { periode: MODERN }],
  ] as const)('%s', (id, entries) => {
    expect(candidatesOf(id, entries, [BRAUM])).toEqual([]);
  });
});
