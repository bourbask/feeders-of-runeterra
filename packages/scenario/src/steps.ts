/**
 * The ten elements of `04-scenarios.md` section 6, turned into ten CLOSED
 * questions, in order.
 *
 * Each step carries three things and nothing else: its question in French, the
 * function that computes its candidates from the content AND from what has
 * already been chosen, and the one-line rule that says what a legal answer is.
 *
 * ── HOW THE TEN ELEMENTS MAP, INCLUDING THE TWO THAT NEEDED A DECISION ───
 * Eight of the ten are a family of content and pick themselves: period,
 * region, front, figure, node, lead, ressort. Two are properties rather than
 * pieces, and asking the model to "choose" something already decided would be
 * a fake question with one candidate:
 *
 *   - ENJEU (4) — what is lost if the front lands IS `front.stake`, carried
 *     along by the choice of front. The question that remains open, and that
 *     genuinely changes the campaign, is HOW FAR the threat already got: which
 *     portent is ALREADY crossed when the party arrives. It is closed (the
 *     front's own portents), it comes from the content, and it is exactly what
 *     S-05 needs to create the clock at the right fill. The LAST portent is
 *     excluded: a front whose final portent is crossed has already landed, and
 *     there would be no scenario left.
 *   - SERMENT (9) — a vow's RANK is `hook.vowRank`, and a rank decides how
 *     many ticks a milestone is worth. Letting the model pick one would hand
 *     it a game number, which is invariant 1 through the back door. What it
 *     picks is the vow's OBJECT: the front to stop, or a figure to protect.
 *
 * ── WHERE THE CUT BETWEEN THE PHASES IS, AND WHY THERE ───────────────────
 * Steps 1 to 7 are `situation`: none of them reads a sheet, so the state of
 * the world is decided before anybody is cast. Steps 8, 9 and 10 are
 * `ressorts`: step 8 reads `appliesTo` against the party, and steps 9 and 10
 * draw their candidates from what step 8 chose — the vow's object comes from
 * the ressort's suggested bonds, the driving question from the nodes those
 * bonds stand in. All three are therefore unreachable without a party, which
 * is what `buildHooks` refuses rather than fudges.
 */

import type { ContentRegistry } from '@for/content';

import {
  figuresOfPeriod,
  frontsOfPeriod,
  hooksOfPeriod,
  nodesOfPeriod,
  playablePeriods,
  playableRegionIds,
} from './candidates.js';
import { DISPOSITION_LABELS, RANK_LABELS, segmentsLabel } from './labels.js';
import type {
  ScenarioCandidate,
  ScenarioPartyMember,
  ScenarioPhase,
  ScenarioStepId,
  ScenarioVowTarget,
} from './types.js';

export type ScenarioSelection = ReadonlyMap<ScenarioStepId, string>;

export interface StepContext {
  readonly registry: ContentRegistry;
  readonly party: readonly ScenarioPartyMember[];
  readonly selection: ScenarioSelection;
}

export interface ScenarioStep {
  readonly id: ScenarioStepId;
  /** The name `04-scenarios.md` section 6 gives the element. */
  readonly element: string;
  readonly phase: ScenarioPhase;
  readonly question: string;
  readonly rule: string;
  candidates(context: StepContext): readonly ScenarioCandidate[];
}

// ───────────────────────────────────────────────────────── small utilities

const trimmed = (text: string, max = 120): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** The chosen period, or `undefined` when step 1 has not landed. */
const period = (context: StepContext) => {
  const id = context.selection.get('periode');
  return id === undefined ? undefined : context.registry.findPeriod(id);
};

const front = (context: StepContext) => {
  const id = context.selection.get('front');
  return id === undefined ? undefined : context.registry.findFront(id);
};

const entryNode = (context: StepContext) => {
  const id = context.selection.get('noeud');
  return id === undefined ? undefined : context.registry.findNode(id);
};

const hook = (context: StepContext) => {
  const id = context.selection.get('ressort');
  return id === undefined ? undefined : context.registry.findHook(id);
};

/** `<frontId>#<n>`, n 1-based. The id of one portent of one front. */
export function portentCandidateId(frontId: string, oneBasedIndex: number): string {
  return `${frontId}#${String(oneBasedIndex)}`;
}

/** Reads back what `portentCandidateId` wrote. `null` when it is not one. */
export function parsePortentCandidateId(
  id: string,
): { readonly frontId: string; readonly index: number } | null {
  const cut = id.lastIndexOf('#');
  if (cut <= 0) return null;
  const index = Number(id.slice(cut + 1));
  if (!Number.isInteger(index) || index < 1) return null;
  return { frontId: id.slice(0, cut), index };
}

/** `front:<id>` or `figure:<id>`. The object a vow is sworn about. */
export function vowCandidateId(target: ScenarioVowTarget): string {
  return target.kind === 'front' ? `front:${target.frontId}` : `figure:${target.figureId}`;
}

export function parseVowCandidateId(id: string): ScenarioVowTarget | null {
  if (id.startsWith('front:')) return { kind: 'front', frontId: id.slice('front:'.length) };
  if (id.startsWith('figure:')) return { kind: 'figure', figureId: id.slice('figure:'.length) };
  return null;
}

/** Whether a ressort's `appliesTo` matches ANY seat at the table. */
export function hookMatchesParty(
  appliesTo:
    | { readonly kind: 'trait'; readonly tag: string }
    | { readonly kind: 'faction'; readonly factionId: string }
    | { readonly kind: 'region'; readonly regionId: string }
    | { readonly kind: 'champion'; readonly championId: string },
  party: readonly ScenarioPartyMember[],
): boolean {
  return party.some((member) => {
    switch (appliesTo.kind) {
      case 'trait':
        return member.traits.includes(appliesTo.tag);
      case 'faction':
        return member.factionIds.includes(appliesTo.factionId);
      case 'region':
        return member.regionIds.includes(appliesTo.regionId);
      case 'champion':
        return member.championId === appliesTo.championId;
    }
  });
}

// ─────────────────────────────────────────────────────────────── the steps

const PERIODE: ScenarioStep = {
  id: 'periode',
  element: 'Période',
  phase: 'situation',
  question: 'À quelle période du Freljord cette campagne se joue-t-elle ?',
  rule: 'Une période jouable du contenu. Elle filtrera toutes les questions suivantes.',
  candidates: (context) =>
    playablePeriods(context.registry).map((item) => ({
      id: item.id,
      label: item.name,
      detail: trimmed(item.summary),
    })),
};

const LIEU: ScenarioStep = {
  id: 'lieu',
  element: 'Lieu',
  phase: 'situation',
  question: 'Dans quelle région la situation se noue-t-elle ?',
  rule: 'Une région où cette période porte à la fois un front et un nœud d’entrée.',
  candidates: (context) => {
    const chosen = period(context);
    if (chosen === undefined) return [];
    return playableRegionIds(context.registry, chosen.id).map((regionId) => {
      const region = context.registry.getRegion(regionId);
      return { id: region.id, label: region.name, detail: trimmed(region.summary) };
    });
  },
};

const FRONT: ScenarioStep = {
  id: 'front',
  element: 'Front',
  phase: 'situation',
  question: 'Quelle menace avance toute seule si personne n’intervient ?',
  rule: 'Un front de cette période qui touche la région choisie.',
  candidates: (context) => {
    const chosen = period(context);
    const regionId = context.selection.get('lieu');
    if (chosen === undefined || regionId === undefined) return [];
    return frontsOfPeriod(context.registry, chosen.id)
      .filter((item) => item.regionIds.includes(regionId))
      .map((item) => ({
        id: item.id,
        label: item.name,
        detail: `${segmentsLabel(item.segments)} — on perd : ${trimmed(item.stake)}`,
      }));
  },
};

const ENJEU: ScenarioStep = {
  id: 'enjeu',
  element: 'Enjeu',
  phase: 'situation',
  question: 'Quel présage de ce front est DÉJÀ franchi quand la bande arrive ?',
  rule: 'Un présage du front choisi, le dernier excepté — sinon la menace a déjà abouti.',
  candidates: (context) => {
    const chosen = front(context);
    if (chosen === undefined) return [];
    return chosen.portents.slice(0, -1).map((portent, index) => ({
      id: portentCandidateId(chosen.id, index + 1),
      label: `Segment ${String(index + 1)} sur ${String(chosen.segments)}`,
      detail: trimmed(portent, 200),
    }));
  },
};

const FIGURE: ScenarioStep = {
  id: 'figure',
  element: 'Figures',
  phase: 'situation',
  question: 'Quelle figure est au centre de cette situation ?',
  rule: 'Une figure de cette période, dont la faction n’en est pas déclarée absente.',
  candidates: (context) => {
    const chosen = period(context);
    if (chosen === undefined) return [];
    return figuresOfPeriod(context.registry, chosen).map((item) => ({
      id: item.id,
      label: `${item.name} (${DISPOSITION_LABELS[item.disposition]})`,
      detail: `veut : ${trimmed(item.wants, 90)} — refuse : ${trimmed(item.refuses, 90)}`,
    }));
  },
};

const NOEUD: ScenarioStep = {
  id: 'noeud',
  element: 'Nœuds',
  phase: 'situation',
  question: 'Par quel nœud la bande entre-t-elle dans la situation ?',
  rule: 'Un nœud d’entrée de cette période, dans la région choisie.',
  candidates: (context) => {
    const chosen = period(context);
    const regionId = context.selection.get('lieu');
    if (chosen === undefined || regionId === undefined) return [];
    return nodesOfPeriod(context.registry, chosen.id)
      .filter((node) => node.entryPoint && node.regionId === regionId)
      .map((node) => ({
        id: node.id,
        label: node.name,
        detail: `${node.kind} — ${trimmed(node.stakeQuestion, 90)}`,
      }));
  },
};

const PISTE: ScenarioStep = {
  id: 'piste',
  element: 'Pistes',
  phase: 'situation',
  question: 'Quelle piste s’ouvre la première depuis ce nœud ?',
  rule: 'Une destination des pistes du nœud d’entrée, dans la même période.',
  candidates: (context) => {
    const node = entryNode(context);
    const chosen = period(context);
    if (node === undefined || chosen === undefined) return [];
    return node.leads.flatMap((lead) => {
      // `getNode`, not `findNode`: `toNodeId` carries a `ref:node` marker, so
      // pass 3 of the loader has already refused an unresolvable lead. The
      // only thing left to filter here is the period.
      const destination = context.registry.getNode(lead.toNodeId);
      if (destination.periodId !== chosen.id) return [];
      return [
        {
          id: destination.id,
          label: destination.name,
          detail: trimmed(lead.trigger, 140),
        },
      ];
    });
  },
};

const RESSORT: ScenarioStep = {
  id: 'ressort',
  element: 'Ressort',
  phase: 'ressorts',
  question: 'Pourquoi CES personnages-là sont-ils concernés ?',
  rule: 'Un ressort de cette période qui touche un personnage — à défaut, un ressort de la période.',
  candidates: (context) => {
    const chosen = period(context);
    // Sans personne à la table, il n'y a rien à accrocher : la liste est vide
    // et `buildHooks` refuse avant d'en arriver là.
    if (chosen === undefined || context.party.length === 0) return [];
    const all = hooksOfPeriod(context.registry, chosen);
    const aimed = all.filter((item) => hookMatchesParty(item.appliesTo, context.party));
    // DEUX ÉTAGES, et l'ordre compte : tant qu'un ressort vise quelqu'un de
    // cette bande, lui seul est proposé. Sinon on élargit plutôt que de
    // refuser — une construction qui s'arrête ici laisse une campagne
    // inutilisable, et le contenu manquant se signale, il ne bloque pas.
    const offered = aimed.length > 0 ? aimed : all;
    const aimedIds = new Set(aimed.map((item) => item.id));
    return offered.map((item) => ({
      id: item.id,
      label: item.name,
      detail:
        (aimedIds.has(item.id) ? '' : '(ne vise personne à cette table) ') +
        `serment ${RANK_LABELS[item.vowRank]} — ${trimmed(item.pitch, 140)}`,
    }));
  },
};

const SERMENT: ScenarioStep = {
  id: 'serment',
  element: 'Serment d’ouverture',
  phase: 'ressorts',
  question: 'Que la bande jure-t-elle, et à propos de quoi ?',
  rule: 'Le front à arrêter, ou une figure que le ressort met sur son chemin. Le rang vient du ressort.',
  candidates: (context) => {
    const chosenFront = front(context);
    const chosenHook = hook(context);
    if (chosenFront === undefined || chosenHook === undefined) return [];
    const figureIds = new Set<string>(chosenHook.suggestedBondIds);
    const node = entryNode(context);
    if (node !== undefined) for (const id of node.figureIds) figureIds.add(id);
    const pivot = context.selection.get('figure');
    if (pivot !== undefined) figureIds.add(pivot);

    const fronts: ScenarioCandidate[] = [
      {
        id: vowCandidateId({ kind: 'front', frontId: chosenFront.id }),
        label: `Arrêter : ${chosenFront.name}`,
        detail: `on perd sinon : ${trimmed(chosenFront.stake, 140)}`,
      },
    ];
    // Same reasoning: `suggestedBondIds`, `figureIds` and the pivot are all
    // `ref:figure`, resolved by pass 3 before anybody gets a registry.
    const figures = [...figureIds].sort().map((figureId) => {
      const figure = context.registry.getFigure(figureId);
      return {
        id: vowCandidateId({ kind: 'figure', figureId: figure.id }),
        label: `Répondre de : ${figure.name}`,
        detail: `${DISPOSITION_LABELS[figure.disposition]} — veut : ${trimmed(figure.wants, 90)}`,
      };
    });
    return [...fronts, ...figures];
  },
};

const QUESTION_D_ENJEU: ScenarioStep = {
  id: 'question-d-enjeu',
  element: 'Question d’enjeu',
  phase: 'ressorts',
  question: 'Quelle question d’enjeu cette campagne cherche-t-elle à trancher ?',
  rule: 'La question d’enjeu d’un nœud où le ressort choisi mène la bande.',
  candidates: (context) => {
    const chosen = period(context);
    const chosenHook = hook(context);
    if (chosen === undefined || chosenHook === undefined) return [];
    const wanted = new Set<string>(chosenHook.suggestedBondIds);
    const node = entryNode(context);
    const lead = context.selection.get('piste');
    return nodesOfPeriod(context.registry, chosen.id)
      .filter((candidate) => {
        if (candidate.id === node?.id) return true;
        if (candidate.id === lead) return true;
        return candidate.figureIds.some((figureId) => wanted.has(figureId));
      })
      .map((candidate) => ({
        id: candidate.id,
        label: trimmed(candidate.stakeQuestion, 140),
        detail: `chez « ${candidate.name} » — ${candidate.kind}`,
      }));
  },
};

/** The ten, in the order of section 6. */
export const SCENARIO_STEPS: readonly ScenarioStep[] = [
  PERIODE,
  LIEU,
  FRONT,
  ENJEU,
  FIGURE,
  NOEUD,
  PISTE,
  RESSORT,
  SERMENT,
  QUESTION_D_ENJEU,
];

export const stepsOfPhase = (phase: ScenarioPhase): readonly ScenarioStep[] =>
  SCENARIO_STEPS.filter((step) => step.phase === phase);
