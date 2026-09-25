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
