/**
 * The guard of invariant 1 on the model's side (02-mj-ia.md section 3).
 *
 * ── WHY THE FORBIDDEN NAMES ARE WRITTEN OUT IN FULL LETTERS ─────────────────
 * Measured in the M0-12 acceptance pass: the only test that read
 * `FORBIDDEN_TOOL_NAMES` ITERATED over it, so emptying the tuple down to
 * `['apply_damage']` failed nothing at all — 569 out of 569 green. A list that
 * is its own loop source guards nothing. So the eight names are typed here,
 * character by character, and compared with `toStrictEqual` BEFORE anything
 * loops over them. Remove one from the tuple and this file goes red on the
 * first assertion, not on the last.
 *
 * ── WHAT THE OTHER ASSERTIONS ARE FOR ───────────────────────────────────────
 * The frozen order (section 3.4) is the prompt cache of every campaign; the
 * two families are the type-level form of "no tool ever settles an outcome";
 * the absence of `time_shift` and of `optionId` are P11 and P10, the two
 * circuits that let the model pick its own consequence by the side door.
 */

import {
  FORBIDDEN_TOOL_NAMES,
  PROPOSAL_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  TOOL_DESCRIPTORS,
  TOOL_INPUT_SCHEMAS,
} from '@for/contracts';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { estimateTokens } from '../src/prompts/estimate.js';
import {
  TOOL_DEFINITIONS,
  TOOL_DEFINITIONS_BY_NAME,
  TOOLS_VERSION,
} from '../src/tools/definitions.js';
import { runToolCall, stableJson } from '../src/tools/handlers.js';

/**
 * The eight names of the M0-18 acceptance criterion, typed out. This array is
 * the SECOND path: it is not derived from anything the package exports, so
 * comparing it to the tuple compares two definitions instead of one with
 * itself.
 */
const FORBIDDEN_IN_FULL_LETTERS = [
  'apply_damage',
  'set_gauge',
  'resolve_move',
  'roll_dice',
  'kill_character',
  'advance_vow',
  'spend_momentum',
  'propose_price',
];

/** Section 3.4's frozen order, typed out for the same reason. */
const TWELVE_IN_FULL_LETTERS = [
  'get_state',
  'get_lore',
  'get_chronicle',
  'check_name_allowed',
  'roll_oracle',
  'propose_npc_introduce',
  'propose_clock_create',
  'propose_clock_advance',
  'propose_thread_open',
  'propose_lore_fact',
  'propose_scene_transition',
  'propose_vow_hook',
];

interface JsonNode {
  type?: unknown;
  properties?: Record<string, JsonNode>;
  required?: string[];
  additionalProperties?: unknown;
  items?: JsonNode;
  anyOf?: JsonNode[];
  description?: string;
}

/** Every object node of a JSON Schema tree, the root included. */
function objectNodes(node: JsonNode | undefined, found: JsonNode[] = []): JsonNode[] {
  if (node === undefined) return found;
  if (node.type === 'object') found.push(node);
  for (const child of Object.values(node.properties ?? {})) objectNodes(child, found);
  objectNodes(node.items, found);
  for (const child of node.anyOf ?? []) objectNodes(child, found);
  return found;
}

describe('la liste des noms interdits est épinglée avant d’être parcourue', () => {
  it('porte exactement les huit noms du critère, dans cet ordre', () => {
    expect([...FORBIDDEN_TOOL_NAMES]).toStrictEqual(FORBIDDEN_IN_FULL_LETTERS);
  });

  it('aucun outil du registre ne porte un de ces noms', () => {
    const exposed = new Set<string>(TOOL_DEFINITIONS.map((tool) => tool.name));
    for (const forbidden of FORBIDDEN_IN_FULL_LETTERS) {
      expect(exposed.has(forbidden)).toBe(false);
    }
  });

  it('et ne les cherche pas non plus dans les descripteurs de famille', () => {
    const named = new Set<string>(TOOL_DESCRIPTORS.map((descriptor) => descriptor.name));
    for (const forbidden of FORBIDDEN_IN_FULL_LETTERS) {
      expect(named.has(forbidden)).toBe(false);
    }
  });
});

describe('la surface exposée au modèle', () => {
  it('compte douze outils, dans l’ordre figé du §3.4', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toStrictEqual(TWELVE_IN_FULL_LETTERS);
  });

  it('classe chaque outil en LECTURE ou en PROPOSITION, et rien d’autre', () => {
    const kinds = new Map<string, string>(
      TOOL_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor.kind]),
    );
    expect([...kinds.keys()]).toStrictEqual(TWELVE_IN_FULL_LETTERS);
    for (const tool of TOOL_DEFINITIONS) {
      const kind = kinds.get(tool.name);
      expect(kind === 'read' || kind === 'proposal').toBe(true);
    }
    expect([...READ_ONLY_TOOL_NAMES]).toStrictEqual(TWELVE_IN_FULL_LETTERS.slice(0, 5));
    expect([...PROPOSAL_TOOL_NAMES]).toStrictEqual(TWELVE_IN_FULL_LETTERS.slice(5));
  });

  it('est gelée, jusqu’aux schémas', () => {
    expect(Object.isFrozen(TOOL_DEFINITIONS)).toBe(true);
    for (const tool of TOOL_DEFINITIONS) {
      expect(Object.isFrozen(tool)).toBe(true);
      expect(Object.isFrozen(tool.inputSchema)).toBe(true);
    }
  });

  it('porte une description non vide pour chacun des douze', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it('a un schéma strict, avec un required complet, à chaque niveau (§3.1)', () => {
    for (const tool of TOOL_DEFINITIONS) {
      const nodes = objectNodes(tool.inputSchema as unknown as JsonNode);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required ?? [])].sort()).toStrictEqual(
          Object.keys(node.properties ?? {}).sort(),
        );
      }
    }
  });

  it('décrit le schéma que le handler valide, clé pour clé', () => {
    for (const tool of TOOL_DEFINITIONS) {
      const fromZod = Object.keys(
        (TOOL_INPUT_SCHEMAS[tool.name as keyof typeof TOOL_INPUT_SCHEMAS] as { shape: object })
          .shape,
      ).sort();
      expect(Object.keys(tool.inputSchema.properties).sort()).toStrictEqual(fromZod);
    }
  });
});

describe('les deux circuits fermés par arbitrage', () => {
  it('propose_scene_transition ne porte pas de clé time_shift (P11)', () => {
    const transition = TOOL_DEFINITIONS_BY_NAME.propose_scene_transition;
    expect(Object.keys(transition.inputSchema.properties).sort()).toStrictEqual([
      'new_place_name',
      'to_place_id',
    ]);
    expect(Object.hasOwn(transition.inputSchema.properties, 'time_shift')).toBe(false);
  });

  it('aucun schéma d’outil ne porte de clé optionId (P10)', () => {
    for (const tool of TOOL_DEFINITIONS) {
      const serialised = JSON.stringify(tool.inputSchema);
      expect(serialised).not.toContain('optionId');
      expect(serialised).not.toContain('option_id');
    }
  });

  it('ni prix, ni choix de prix, nulle part dans la surface', () => {
    const serialised = JSON.stringify(TOOL_DEFINITIONS.map((tool) => tool.name));
    expect(serialised).not.toContain('price');
    expect(serialised).not.toContain('prix');
  });
});

describe('la version de la surface', () => {
  it('existe et est lisible', () => {
    expect(TOOLS_VERSION).toBe('tools/1.0.0');
  });
});

/**
 * The snapshot, and what it is actually for.
 *
 * Not "has the file changed" but "has the CACHED PREFIX of every campaign
 * changed without anybody saying so". A reorder, a reworded description or a
 * widened schema all move the bytes rendered at position 0 of every request,
 * and all three invalidate the prompt cache of every campaign at once. So the
 * snapshot pins the rendered table AND the version beside it: changing the
 * table without bumping `TOOLS_VERSION` cannot be green, and bumping the
 * version is a deliberate refresh of this file.
 */
describe('l’instantané du tableau d’outils', () => {
  it('correspond à la référence commitée, version comprise', () => {
    const recorded = JSON.parse(
      readFileSync(new URL('./tools.snapshot.json', import.meta.url), 'utf8'),
    ) as unknown;
    expect(recorded).toStrictEqual(
      JSON.parse(JSON.stringify({ toolsVersion: TOOLS_VERSION, tools: TOOL_DEFINITIONS })),
    );
  });
});

/**
 * Running a call, and the one behaviour that carries invariant 1 here:
 * A MALFORMED CALL IS DROPPED, NEVER REPAIRED (section 0.2).
 *
 * Repairing a bad argument into a plausible value would be the AI layer
 * deciding on behalf of the model that decides on behalf of the engine. And a
 * fabricated `tool_result` would tell the storyteller that something happened
 * which did not.
 */
describe('l’exécution d’un appel d’outil', () => {
  const reads = {
    get_state: () =>
      Promise.resolve({
        scope: 'clocks' as const,
        clocks: [{ clock_id: 'clk_1', name: 'La tempête', segments: 6 as const, filled: 3 }],
        as_of_event_seq: 1482,
      }),
    get_lore: () => Promise.resolve({ results: [], filtered_count: 0 }),
    get_chronicle: () =>
      Promise.resolve({ section: 'arcs' as const, entries: [], chronicle_version: 17 }),
    check_name_allowed: () =>
      Promise.resolve({ name: 'x', allowed: true, reason: null, suggestion: null }),
    roll_oracle: () =>
      Promise.resolve({
        table_id: 'yes-no' as const,
        value: 61,
        answer: 'non' as const,
        is_extreme: false,
        event_seq: 1483,
      }),
  };
  const proposals = {
    propose: () => Promise.resolve({ status: 'applied' as const, reason: null, applied: { a: 1 } }),
  };
  const runtime = { reads, proposals };

  it('abandonne un appel dont les arguments ne valident pas', async () => {
    const outcome = await runToolCall(
      { type: 'tool_use', callId: 'c1', tool: 'get_state', input: { scope: 'nimporte' } },
      runtime,
    );
    expect(outcome).toStrictEqual({
      kind: 'dropped',
      tool: 'get_state',
      reason: 'invalid_arguments',
    });
  });

  it('abandonne un appel à un outil qui n’existe pas', async () => {
    const outcome = await runToolCall(
      { type: 'tool_use', callId: 'c2', tool: 'set_gauge', input: {} },
      runtime,
    );
    expect(outcome).toStrictEqual({ kind: 'dropped', tool: 'set_gauge', reason: 'unknown_tool' });
  });

  it('ne fabrique jamais de valeur plausible à la place d’un argument fautif', async () => {
    const outcome = await runToolCall(
      {
        type: 'tool_use',
        callId: 'c3',
        tool: 'propose_clock_advance',
        input: { clock_id: 'clk_1', segments: 9, rationale: 'r' },
      },
      runtime,
    );
    expect(outcome.kind).toBe('dropped');
  });

  it('sérialise un résultat avec des clés triées, à toute profondeur', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } })).toBe(
      '{"a":{"c":[{"e":4,"f":3}],"d":2},"b":1}',
    );
  });

  it('exécute une lecture et rend un tool_result validé', async () => {
    const outcome = await runToolCall(
      {
        type: 'tool_use',
        callId: 'c4',
        tool: 'get_state',
        input: { scope: 'clocks', character_id: null },
      },
      runtime,
    );
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.block.isError).toBe(false);
    expect(outcome.block.content).toContain('"as_of_event_seq":1482');
  });

  it('marque en erreur une proposition refusée, sans jamais l’inventer', async () => {
    const outcome = await runToolCall(
      {
        type: 'tool_use',
        callId: 'c5',
        tool: 'propose_lore_fact',
        input: {
          statement: 'Le clan laisse une offrande.',
          tied_to_kind: 'place',
          tied_to_id: 'plc_1',
        },
      },
      {
        reads,
        proposals: {
          propose: () =>
            Promise.resolve({
              status: 'rejected' as const,
              reason: 'contredit le canon',
              applied: null,
            }),
        },
      },
    );
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.block.isError).toBe(true);
    expect(outcome.block.content).toContain('rejected');
  });

  it('rend une erreur d’outil, jamais une exception, quand la source tombe', async () => {
    const outcome = await runToolCall(
      {
        type: 'tool_use',
        callId: 'c6',
        tool: 'get_lore',
        input: { query: 'q', kind: 'any', limit: 3 },
      },
      { reads: { ...reads, get_lore: () => Promise.reject(new Error('base absente')) }, proposals },
    );
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.block.isError).toBe(true);
  });

  it('refuse une sortie d’outil qui ne valide pas contre son schéma', async () => {
    const outcome = await runToolCall(
      {
        type: 'tool_use',
        callId: 'c7',
        tool: 'get_chronicle',
        input: { section: 'arcs', subject_id: null, limit: 5 },
      },
      {
        reads: { ...reads, get_chronicle: () => Promise.resolve({ nimporte: true } as never) },
        proposals,
      },
    );
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.block.content).toContain('tool_output_invalid');
  });
});

/**
 * THE READ / PROPOSAL FRONTIER, WALKED TOOL BY TOOL.
 *
 * `runToolCall` sorts the twelve calls into two piles, and the set it sorts
 * with used to RETYPE the five read names by hand. Nothing compared that copy
 * to anything: measured, deleting `'roll_oracle'` from it left 127 tests out
 * of 127 green while the one read tool that WRITES to the journal went off to
 * `proposals.propose`, and emptying the copy entirely failed one test. The set
 * is derived from `READ_ONLY_TOOL_NAMES` now; below is the behavioural half of
 * the guard, the one that fails whichever way the frontier moves.
 *
 * Written as an EXACT TABLE and not as a loop over the same tuple the code
 * sorts with — otherwise both operands would come from one definition and the
 * assertion would compare a list with itself (ADR 0007).
 */
describe('la frontière lecture / proposition, parcourue outil par outil', () => {
  /** One valid call per tool: the routing is only reached once arguments validate. */
  const VALID_INPUT: Record<string, unknown> = {
    get_state: { scope: 'clocks', character_id: null },
    get_lore: { query: 'le col', kind: 'place', limit: 3 },
    get_chronicle: { section: 'arcs', subject_id: null, limit: 5 },
    check_name_allowed: { name: 'Ulrun' },
    roll_oracle: { table_id: 'yes-no', question: 'La corde tient-elle ?', likelihood: 'incertain' },
    propose_npc_introduce: {
      name: 'Ulrun',
      role: 'éclaireur',
      one_line: 'il connaît le col',
      place_id: 'plc_1',
      disposition: 'neutre',
    },
    propose_clock_create: {
      name: 'La tempête',
      segments: 6,
      kind: 'menace',
      rationale: 'le vent se lève',
    },
    propose_clock_advance: { clock_id: 'clk_1', segments: 2, rationale: 'la neige monte' },
    propose_thread_open: {
      title: 'La dette du col',
      summary: 'Ulrun attend une réponse.',
      tied_to_kind: 'none',
      tied_to_id: '',
    },
    propose_lore_fact: {
      statement: 'Le clan laisse une offrande au col.',
      tied_to_kind: 'place',
      tied_to_id: 'plc_1',
    },
    propose_scene_transition: { to_place_id: 'plc_2', new_place_name: '' },
    propose_vow_hook: { title: 'Ramener Keld', rank: 'dangereux', why_now: 'le col se ferme' },
  };

  /** The side of the frontier each of the twelve must land on, typed out. */
  const EXPECTED_SIDES: readonly (readonly [string, string])[] = [
    ['get_state', 'read'],
    ['get_lore', 'read'],
    ['get_chronicle', 'read'],
    ['check_name_allowed', 'read'],
    ['roll_oracle', 'read'],
    ['propose_npc_introduce', 'proposal'],
    ['propose_clock_create', 'proposal'],
    ['propose_clock_advance', 'proposal'],
    ['propose_thread_open', 'proposal'],
    ['propose_lore_fact', 'proposal'],
    ['propose_scene_transition', 'proposal'],
    ['propose_vow_hook', 'proposal'],
  ];

  /** A runtime that records WHICH side answered, and answers validly on both. */
  function spyRuntime(): {
    readonly runtime: Parameters<typeof runToolCall>[1];
    readonly landed: { name: string; side: string }[];
  } {
    const landed: { name: string; side: string }[] = [];
    const note = (name: string, side: string): void => void landed.push({ name, side });
    return {
      landed,
      runtime: {
        reads: {
          get_state: () => {
            note('get_state', 'read');
            return Promise.resolve({
              scope: 'clocks' as const,
              clocks: [],
              as_of_event_seq: 1482,
            });
          },
          get_lore: () => {
            note('get_lore', 'read');
            return Promise.resolve({ results: [], filtered_count: 0 });
          },
          get_chronicle: () => {
            note('get_chronicle', 'read');
            return Promise.resolve({
              section: 'arcs' as const,
              entries: [],
              chronicle_version: 17,
            });
          },
          check_name_allowed: () => {
            note('check_name_allowed', 'read');
            return Promise.resolve({
              name: 'Ulrun',
              allowed: true,
              reason: null,
              suggestion: null,
            });
          },
          roll_oracle: () => {
            note('roll_oracle', 'read');
            return Promise.resolve({
              table_id: 'yes-no' as const,
              value: 61,
              answer: 'non' as const,
              is_extreme: false,
              event_seq: 1483,
            });
          },
        },
        proposals: {
          propose: (tool: string) => {
            note(tool, 'proposal');
            return Promise.resolve({ status: 'applied' as const, reason: null, applied: {} });
          },
        },
      },
    };
  }

  it('envoie chacun des douze du côté où il doit aller, et rend un tool_result', async () => {
    const { runtime, landed } = spyRuntime();
    const dropped: string[] = [];
    for (const name of TWELVE_IN_FULL_LETTERS) {
      const outcome = await runToolCall(
        { type: 'tool_use', callId: `c_${name}`, tool: name, input: VALID_INPUT[name] },
        runtime,
      );
      if (outcome.kind !== 'result') dropped.push(name);
    }
    expect(dropped).toStrictEqual([]);
    expect(landed.map((entry) => [entry.name, entry.side])).toStrictEqual(
      EXPECTED_SIDES.map((entry) => [...entry]),
    );
  });

  /**
   * `roll_oracle` is the read tool that APPENDS to the journal
   * (`ReadOnlyTool.journalOnly`, P12). Routed to the proposal sink it would
   * become a write path standing outside the invariant-1 guard, which is
   * exactly what the untested hand-typed set allowed.
   */
  it('roll_oracle atteint reads.roll_oracle, et jamais le puits de propositions', async () => {
    const { runtime, landed } = spyRuntime();
    const outcome = await runToolCall(
      {
        type: 'tool_use',
        callId: 'c_oracle',
        tool: 'roll_oracle',
        input: VALID_INPUT['roll_oracle'],
      },
      runtime,
    );
    expect(landed).toStrictEqual([{ name: 'roll_oracle', side: 'read' }]);
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.block.isError).toBe(false);
    expect(outcome.block.content).toContain('"event_seq":1483');
  });
});

/**
 * WHAT THE TOOL TABLE WEIGHS — measured, because section 4.3 says it is.
 *
 * ── WHY THIS TEST EXISTS AT ALL ─────────────────────────────────────────────
 * Section 4.3 gives the `tools` segment a hard ceiling of 900 tokens and
 * writes "figé, mesuré en CI" beside it. Nothing measured it. The table is
 * rendered at position 0 of EVERY request of every campaign (section 4.2), so
 * it is the one segment nobody can trim at run time — the truncation ladder of
 * section 4.4 has no level for it.
 *
 * ── WHAT IS MEASURED ────────────────────────────────────────────────────────
 * The provider-neutral rendering, `JSON.stringify(TOOL_DEFINITIONS)`, with the
 * local estimator of section 4.3 — the same one `prompt-size.test.ts` uses,
 * because two estimators is how a budget and a size test start disagreeing
 * about the same bytes. Each adapter then wraps it in its own envelope, which
 * only ADDS: this figure is a floor on what is actually sent, never a ceiling.
 *
 * ── REPORTED, NOT WORKED AROUND ─────────────────────────────────────────────
 * The table weighs 2 112 estimated tokens against a ceiling of 900. The
 * overrun is 1 212 tokens, and it is not this task's to arbitrate: with
 * `system[0]` measured at 4 279 against 2 400 (see `prompt-size.test.ts` and
 * the pull request), section 4.3 is over by about 3 091 tokens before a single
 * variable block. So the measurement is PINNED rather than asserted green: the
 * day the table fits, or the day the ceiling is re-arbitrated, the assertion
 * below goes red and forces the reference and the flag to be redone
 * deliberately. Escalated to the lead, for M0-22.
 */
describe('ce que pèse la table d’outils', () => {
  /** Section 4.3's `tools` ceiling, in full letters. Never read from `src/`. */
  const TOOLS_CEILING_TOKENS = 900;
  /** Section 4.3's stated tolerance on the local estimator. */
  const REFERENCE_TOLERANCE_PCT = 8;
  /** The overrun as measured today, in full letters. */
  const MEASURED_OVERRUN_TOKENS = 1212;

  interface Reference {
    readonly toolsVersion: string;
    readonly estimatedTokens: number;
    readonly chars: number;
    readonly recordedAt: string;
  }

  const reference = JSON.parse(
    readFileSync(new URL('./tools-size.reference.json', import.meta.url), 'utf8'),
  ) as Reference;

  const serialised = JSON.stringify(TOOL_DEFINITIONS);

  it('correspond à la référence commitée, à huit pour cent près', () => {
    const measured = estimateTokens(serialised);
    const drift = Math.abs(measured - reference.estimatedTokens) / reference.estimatedTokens;
    expect(drift * 100).toBeLessThanOrEqual(REFERENCE_TOLERANCE_PCT);
  });

  it('et la référence porte la version de surface qu’elle a mesurée', () => {
    expect(reference.toolsVersion).toBe(TOOLS_VERSION);
  });

  it('rougit si l’on en retire un tiers — mesuré ici, pas supposé', () => {
    const amputated = JSON.stringify(TOOL_DEFINITIONS.slice(0, 8));
    const measured = estimateTokens(amputated);
    const drift = Math.abs(measured - reference.estimatedTokens) / reference.estimatedTokens;
    expect(drift * 100).toBeGreaterThan(REFERENCE_TOLERANCE_PCT);
  });

  it('dépasse le plafond de 900 du §4.3 — écart mesuré et signalé, jamais maquillé', () => {
    const measured = estimateTokens(serialised);
    expect(measured).toBeGreaterThan(TOOLS_CEILING_TOKENS);
    expect(measured - TOOLS_CEILING_TOKENS).toBe(MEASURED_OVERRUN_TOKENS);
  });
});
