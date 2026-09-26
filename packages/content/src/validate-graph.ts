/**
 * THE FIFTH PASS — what no single file can know (S-02, ADR 0012 decision 4).
 *
 * The four other passes read one document at a time. This one reads the
 * SCENARIO GRAPH: a node and the node it leads to, a node and the figure it
 * names. Nothing here can be decided from a file alone, and nothing here
 * repeats what a file already decides — see « WHAT THIS PASS DELIBERATELY DOES
 * NOT CHECK » below.
 *
 * ── WHAT A REPORT HAS TO CONTAIN TO BE WORTH ANYTHING ────────────────────
 * The person who writes content does not read this file; they read the line it
 * prints. Every message therefore carries THREE things, in this order:
 *   1. the RULE, quoted by name, between « » ;
 *   2. the PIECE at fault, by id ;
 *   3. WHAT TO ADD to make it pass.
 * Each rule's `describe` in `tests/scenario-graph.test.ts` asserts those three
 * parts of the message it produces — never the exit code alone. Measured on a
 * real content root with the contractual command, the four shapes read:
 *
 *   règle « pas de saut de période » — le nœud « le-grenier-vide » est de la
 *   période « freljord-moderne » et sa piste mène à « le-puits-de-glace », qui
 *   est de la période « la-longue-nuit ». Visez un nœud de « freljord-moderne
 *   », ou déplacez « le-puits-de-glace » dans cette période.
 *
 * ── ORDER MATTERS, AND IT IS NOT A COMMENT ───────────────────────────────
 * This pass runs AFTER pass 3. A lead towards a node that does not exist, or a
 * `figureIds` entry naming nobody, is a DEAD REFERENCE and pass 3 reports it
 * with a Levenshtein suggestion. If this pass reported it too, the reader
 * would be sent to the wrong place. So every lookup here that comes up empty
 * is SKIPPED, not reported — held by `tests/scenario-graph.test.ts`
 * « une piste vers un nœud absent de la carte ne dit rien non plus », « une
 * figure absente de la carte ne dit rien : c'est la passe 3 qui la possède »
 * and « un ressort sans figure connue ne dit rien », which call this module
 * DIRECTLY, because the loader cannot present that case: it throws first.
 *
 * That throw is a SECOND, separate guarantee, and the first set of tests does
 * NOT hold it — measured: removing the throw leaves them green. It has its own
 * test, « un nœud mal formé arrête tout AVANT la passe 5 ».
 *
 * ── WHAT THIS PASS DELIBERATELY DOES NOT CHECK ───────────────────────────
 * Two of the four rules of the S-02 brief are ALREADY HELD, per file, in
 * pass 2, and re-implementing them here would be a guard nothing can reach —
 * `validateContent` throws after pass 3, so pass 5 never sees a document that
 * failed pass 2. Measured, both ways, and reported in the PR:
 *
 *   | Rule of the brief              | Held by                                    |
 *   |--------------------------------|--------------------------------------------|
 *   | « trois pistes minimum »       | `NodeSchema.superRefine` (three DISTINCT   |
 *   |                                | destinations, none of them itself)          |
 *   | « autant de présages que de    | `FrontSchema.superRefine` (`portents.length |
 *   |   segments »                   | === segments`)                              |
 *
 * What this pass adds to the first of the two is the half a file cannot see:
 * a lead that crosses periods is REFUSED, so it is not a way out, so a node
 * whose leads all cross periods is stuck although its file counts three.
 * That is `GRAPH_RULES.liveLeads`, and it is not the schema's rule written
 * twice: it only ever fires on a node some of whose leads cross a period.
 */

import type { FigureContent, HookContent, NodeContent } from '@for/contracts';
import { MIN_LEADS_PER_NODE } from '@for/contracts';

import type { ContentIssue } from './issue.js';

/**
 * What the fifth pass needs, and nothing else.
 *
 * A `ContentBundle` satisfies this structurally, which is how `validate.ts`
 * calls it with the real thing. Narrower than the bundle ON PURPOSE: this pass
 * has no business with moves, champions or oracles, and a reader can see the
 * whole of its input in four lines.
 */
export interface ScenarioGraph {
  readonly nodes: ReadonlyMap<string, NodeContent>;
  readonly figures: ReadonlyMap<string, FigureContent>;
  readonly hooks: ReadonlyMap<string, HookContent>;
}

/**
 * The rules, by the name their message quotes.
 *
 * PINNED, because these four names come from the S-02 brief and not from the
 * code: `tests/scenario-graph.test.ts` « les quatre règles de la passe de
 * graphe, écrites en toutes lettres » writes all four out and compares them
 * member by member, so renaming one here turns it red (measured). The tests
 * then quote the rules THROUGH this object, which is what stops a message from
 * drifting away from the name its test looks for.
 */
export const GRAPH_RULES = {
  liveLeads: 'trois pistes minimum',
  orphan: 'aucun nœud orphelin',
  periodJump: 'pas de saut de période',
  figurePeriod: 'pas de figure hors période',
} as const;

export type GraphRule = (typeof GRAPH_RULES)[keyof typeof GRAPH_RULES];

/** Every message opens the same way, so a reader can grep the rule. */
const head = (rule: GraphRule): string => `règle « ${rule} » — `;

const quoted = (ids: readonly string[]): string => ids.map((id) => `« ${id} »`).join(', ');

const PASS = 5 as const;

/**
 * The fifth pass. Returns the issues; it never throws and never prints.
 *
 * Private: `validateScenarioGraph` below is the whole public surface of this
 * pass, so the barrel gains one name and not four.
 */
function scenarioGraphIssues(graph: ScenarioGraph): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const nodes = [...graph.nodes.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
  if (nodes.length === 0) return issues;

  // ── Rules « pas de saut de période » and « trois pistes minimum » ─────
  //
  // One walk, because the second rule COUNTS what the first one refuses: a
  // node keeps only the leads that stay inside its period.
  const liveLeads = new Map<string, string[]>();
  for (const node of nodes) {
    const live: string[] = [];
    const crossing: string[] = [];
    for (const [index, lead] of node.leads.entries()) {
      const target = graph.nodes.get(lead.toNodeId);
      // Pass 3 owns the dead reference. See the header.
      if (target === undefined) continue;
      if (target.periodId === node.periodId) {
        live.push(target.id);
        continue;
      }
      crossing.push(target.id);
      issues.push({
        file: `nodes/${node.id}.json`,
        path: `leads[${String(index)}].toNodeId`,
        message:
          `${head(GRAPH_RULES.periodJump)}le nœud « ${node.id} » est de la période ` +
          `« ${node.periodId} » et sa piste mène à « ${target.id} », qui est de la période ` +
          `« ${target.periodId} ». Visez un nœud de « ${node.periodId} », ou déplacez ` +
          `« ${target.id} » dans cette période.`,
        pass: PASS,
      });
    }
    liveLeads.set(node.id, live);

    if (crossing.length === 0 || live.length >= MIN_LEADS_PER_NODE) continue;
    issues.push({
      file: `nodes/${node.id}.json`,
      path: 'leads',
      message:
        `${head(GRAPH_RULES.liveLeads)}le nœud « ${node.id} » ne garde que ` +
        `${String(live.length)} sortie(s) sur les ${String(MIN_LEADS_PER_NODE)} exigées : ` +
        `${quoted(crossing)} ${crossing.length > 1 ? 'sont écartées' : 'est écartée'} par la ` +
        `règle « ${GRAPH_RULES.periodJump} ». Ajoutez ` +
        `${String(MIN_LEADS_PER_NODE - live.length)} piste(s) vers un nœud de la période ` +
        `« ${node.periodId} ».`,
      pass: PASS,
    });
  }

  // ── Rule « aucun nœud orphelin » ──────────────────────────────────────
  //
  // THE BRIEF SAYS "reachable from at least one other node, or `entryPoint`".
  // Taken literally that is in-degree ≥ 1, and four nodes pointing only at
  // each other pass it while being unplayable: nothing leads INTO the island
  // from where the party starts. So the rule is applied by its reason — every
  // node is reachable FROM AN ENTRY POINT — which is strictly stronger and
  // subsumes the letter: a node nobody points at is reachable from no walk at
  // all. Declared in the PR, and held in both shapes by
  // `tests/scenario-graph.test.ts`.
  //
  // A lead that crosses periods is not a way in either, so the walk follows
  // `liveLeads`, the same edges the first rule counted.
  const entries = nodes.filter((node) => node.entryPoint);
  if (entries.length === 0) {
    issues.push({
      file: 'nodes/',
      path: '',
      message:
        `${head(GRAPH_RULES.orphan)}${String(nodes.length)} nœud(s) chargé(s) et aucun point ` +
        `d'entrée : la bande n'a nulle part où commencer, donc aucun nœud n'est atteignable. ` +
        `Ajoutez « "entryPoint": true » au nœud d'ouverture de chaque période.`,
      pass: PASS,
    });
    return issues;
  }

  // The walk, as a fixpoint rather than a queue: `Array.pop` would hand back
  // `string | undefined` and the shared lint config forbids both `!` and the
  // cast that would remove it. A graph of a few dozen nodes makes the cost
  // irrelevant, and the loop needs no assertion to be total.
  const reached = new Set(entries.map((node) => node.id));
  let growing = true;
  while (growing) {
    growing = false;
    for (const [id, live] of liveLeads) {
      if (!reached.has(id)) continue;
      for (const next of live) {
        if (reached.has(next)) continue;
        reached.add(next);
        growing = true;
      }
    }
  }

  const stranded = nodes.filter((node) => !reached.has(node.id));
  if (stranded.length === 0) return issues;

  // Group the stranded nodes into ISLANDS — the weakly connected components of
  // the live leads, among stranded nodes only — so a twelve-node island reports
  // ONCE, naming its members, instead of twelve times.
  //
  // `stranded` is sorted by id, so the first node of a component to be seen is
  // its smallest id: `first` needs no sort and no `[0]` that TypeScript would
  // type as possibly absent.
  const island = new Map<string, string>();
  const rootOf = (id: string): string => {
    let cursor = id;
    let parent = island.get(cursor);
    while (parent !== undefined && parent !== cursor) {
      cursor = parent;
      parent = island.get(cursor);
    }
    return cursor;
  };
  for (const node of stranded) island.set(node.id, node.id);
  for (const [id, live] of liveLeads) {
    if (!island.has(id)) continue;
    for (const next of live) {
      if (!island.has(next)) continue;
      const left = rootOf(id);
      const right = rootOf(next);
      if (left !== right) island.set(right, left);
    }
  }

  interface Island {
    readonly first: string;
    readonly others: string[];
  }
  const islands = new Map<string, Island>();
  for (const node of stranded) {
    const root = rootOf(node.id);
    const known = islands.get(root);
    if (known === undefined) islands.set(root, { first: node.id, others: [] });
    else known.others.push(node.id);
  }

  for (const { first, others } of [...islands.values()].sort((left, right) =>
    left.first < right.first ? -1 : 1,
  )) {
    issues.push({
      file: `nodes/${first}.json`,
      path: '',
      message:
        `${head(GRAPH_RULES.orphan)}le nœud « ${first} » n'est atteignable depuis aucun point ` +
        `d'entrée` +
        (others.length === 0
          ? ' : aucune piste vivante ne mène à lui.'
          : `, ni ${quoted(others)} : ils forment un îlot de ${String(others.length + 1)} nœuds ` +
            'que rien ne relie au reste du graphe.') +
        ` Ajoutez une piste depuis un nœud atteignable vers « ${first} », ou déclarez ` +
        `« "entryPoint": true » sur ${others.length === 0 ? 'ce nœud' : "l'un d'eux"}.`,
      pass: PASS,
    });
  }

  return issues;
}

/**
 * Rule « pas de figure hors période », the fifth rule — the one S-02 was handed
 * rather than briefed.
 *
 * `period.absentFactionIds` stops the anachronism from one end: a period names
 * what does not exist yet. NOTHING stopped it from the other end — a node of
 * the modern Freljord could name a figure who died three centuries earlier,
 * and the four rules of the brief only ever look at leads. This closes it.
 *
 * TWO EDGES CARRY A PERIOD ON BOTH ENDS, and they are written out below
 * rather than driven by a table: a table of two entries would be a list that
 * is its own source of truth, and emptying it would make the loop check
 * nothing without a single test falling. Each edge has its own test instead —
 * « un nœud qui nomme une figure d'une autre période est refusé » and « un
 * ressort qui propose un lien avec une figure d'une autre période est refusé »
 * — so deleting either loop reddens a named test.
 */
function figurePeriodIssues(graph: ScenarioGraph): ContentIssue[] {
  const issues: ContentIssue[] = [];

  const mismatch = (
    file: string,
    path: string,
    owner: string,
    ownerLabel: string,
    ownerPeriod: string,
    figureId: string,
    verb: string,
    field: string,
  ): void => {
    const figure = graph.figures.get(figureId);
    // Pass 3 owns the dead reference. See the header.
    if (figure === undefined || figure.periodId === ownerPeriod) return;
    issues.push({
      file,
      path,
      message:
        `${head(GRAPH_RULES.figurePeriod)}${ownerLabel} « ${owner} » est de la période ` +
        `« ${ownerPeriod} » et ${verb} la figure « ${figureId} », qui est de la période ` +
        `« ${figure.periodId} ». Retirez-la de « ${field} », ou donnez-lui une pièce de sa ` +
        `période.`,
      pass: PASS,
    });
  };

  const nodes = [...graph.nodes.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
  for (const node of nodes) {
    for (const [index, figureId] of node.figureIds.entries()) {
      mismatch(
        `nodes/${node.id}.json`,
        `figureIds[${String(index)}]`,
        node.id,
        'le nœud',
        node.periodId,
        figureId,
        'nomme',
        'figureIds',
      );
    }
  }

  const hooks = [...graph.hooks.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
  for (const hook of hooks) {
    for (const [index, figureId] of hook.suggestedBondIds.entries()) {
      mismatch(
        `hooks/${hook.id}.json`,
        `suggestedBondIds[${String(index)}]`,
        hook.id,
        'le ressort',
        hook.periodId,
        figureId,
        'propose un lien avec',
        'suggestedBondIds',
      );
    }
  }

  return issues;
}

/** The whole fifth pass, in the order `validateContent` calls it. */
export function validateScenarioGraph(graph: ScenarioGraph): ContentIssue[] {
  return [...scenarioGraphIssues(graph), ...figurePeriodIssues(graph)];
}
