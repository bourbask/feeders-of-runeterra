/**
 * The names a scenario refusal quotes, and the one way it opens (S-06).
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 * Six rules refuse a scenario, and they do NOT all live in the same place:
 * two are decided by a single file and belong to a schema's `superRefine`
 * (pass 2), four need two pieces at once and belong to the graph pass of
 * `@for/content` (pass 5). Before this file they spoke two dialects — the
 * four of pass 5 opened with `règle « … » — `, the two of pass 2 named the
 * piece and nothing else — so the person writing content met two shapes of
 * refusal on one graph and could grep for neither.
 *
 * The names live HERE because `@for/contracts` is the only package both ends
 * can import: `@for/content` depends on it, never the reverse. Writing
 * « trois pistes minimum » a second time inside the graph pass would be two
 * answers to "what is this rule called", and a rename would silently leave
 * half the reports behind.
 *
 * ── WHERE EACH NAME IS PINNED ────────────────────────────────────────────
 * These six strings come from the S-02 brief and the gap S-02's tester
 * measured — from a criterion, never from the code — so they are written out
 * IN FULL LETTERS by the tests that check them, per ADR 0007:
 *   - all six, member by member, by `tests/content/scenario.test.ts`
 *     « SCENARIO_RULES — les six noms de refus, écrits en toutes lettres » ;
 *   - the five of pass 5 again, through `GRAPH_RULES`, by
 *     `packages/content/tests/scenario-graph.test.ts` « les cinq règles de la
 *     passe de graphe, écrites en toutes lettres ».
 */

export const SCENARIO_RULES = {
  /** A node keeps three distinct ways out — pass 2 per file, pass 5 across periods. */
  liveLeads: 'trois pistes minimum',
  /** A front promises exactly one portent per segment of the clock it becomes. */
  portentsPerSegment: 'autant de présages que de segments',
  /** Every node is reachable by walking from an entry point. */
  orphan: 'aucun nœud orphelin',
  /** A lead stays inside its own period. */
  periodJump: 'pas de saut de période',
  /** A piece does not name a figure of another period. */
  figurePeriod: 'pas de figure hors période',
  /** A piece does not name a faction its period lists in `absentFactionIds`. */
  absentFaction: 'pas de faction absente de la période',
} as const;

export type ScenarioRule = (typeof SCENARIO_RULES)[keyof typeof SCENARIO_RULES];

/**
 * How every scenario refusal opens, wherever it is produced.
 *
 * One function rather than a template written twice: the graph pass filters
 * its own reports by this exact prefix, so a space lost on one side would make
 * a rule's messages invisible to the tests that count them.
 */
export const scenarioRuleHead = (rule: ScenarioRule): string => `règle « ${rule} » — `;
