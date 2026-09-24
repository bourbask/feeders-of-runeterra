/**
 * THE TWELVE TOOLS — the surface where invariant 1 can actually be lost.
 *
 * Three families of check, and none of them is a re-reading of the source:
 *
 *   1. JSON SCHEMA. Every input schema is converted and the tree is WALKED:
 *      `additionalProperties: false` on every object, `required` covering
 *      every property. "It looks strict" is not a measurement, and half the
 *      providers silently accept whatever a loose schema lets through.
 *   2. THE FROZEN LIST. Twelve names, in the order of section 3.4, with no
 *      price tool and no thirteenth. `TOOL_JOURNAL_ONLY` empty everywhere but
 *      `roll_oracle` (P12).
 *   3. `propose_scene_transition` has EXACTLY two keys, and `time_shift` is
 *      not one of them (P11).
 *   4. THE VOCABULARY TUPLES THAT HAVE NO ENGINE MIRROR, pinned value by
 *      value against sections 3.2 and 3.3. This block is new, and it exists
 *      because the file header of `tools.ts` claimed these tuples were
 *      "compared by the tests" while NOTHING looked at them: rewriting
 *      `NPC_PROPOSAL_DISPOSITIONS` to the engine's four values left 98/98
 *      green, and renaming an oracle table id left 98/98 green — measured.
 *      What has an engine mirror is compared to the mirror (`likelihood`,
 *      `segments`, `rank`, below); what has none is written out in full.
 *      Neither is ever compared to itself (ADR 0007).
 */
import { CLOCK_SEGMENT_COUNTS, LIKELIHOODS, PROGRESS_RANKS } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { z } from 'zod';
import { ORACLE_JOURNAL_ONLY_EVENT_TYPES } from '../../src/ai/narrator-port.js';
import {
  CLOCK_PROPOSAL_KINDS,
  FORBIDDEN_TOOL_NAMES,
  GET_CHRONICLE_SECTIONS,
  GET_LORE_KINDS,
  GET_STATE_SCOPES,
  LORE_FACT_TIE_KINDS,
  NPC_PROPOSAL_DISPOSITIONS,
  ORACLE_LIKELIHOODS,
  ORACLE_TABLE_IDS,
  PROPOSAL_STATUSES,
  PROPOSAL_TOOL_NAMES,
  ProposeSceneTransitionInputSchema,
  READ_ONLY_TOOL_NAMES,
  THREAD_TIE_KINDS,
  TOOL_DESCRIPTORS,
  TOOL_INPUT_SCHEMAS,
  TOOL_JOURNAL_ONLY,
  TOOL_NAMES,
  TOOL_OUTPUT_SCHEMAS,
  type ToolName,
} from '../../src/ai/tools.js';

/** The frozen order of section 3.4, written once so the test can read it. */
const FROZEN_ORDER = [
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
  readonly type?: unknown;
  readonly enum?: readonly unknown[];
  readonly properties?: Record<string, JsonNode>;
  readonly required?: readonly string[];
  readonly additionalProperties?: unknown;
  readonly items?: JsonNode;
  readonly anyOf?: readonly JsonNode[];
  readonly allOf?: readonly JsonNode[];
}

/** Every object node of a JSON Schema tree, with the path that reaches it. */
function objectNodes(node: JsonNode, path = '$'): readonly (readonly [string, JsonNode])[] {
  const found: (readonly [string, JsonNode])[] = [];
  if (node.type === 'object' || node.properties !== undefined) found.push([path, node]);
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    found.push(...objectNodes(child, `${path}.${key}`));
  }
  if (node.items !== undefined) found.push(...objectNodes(node.items, `${path}[]`));
  for (const [index, child] of [...(node.anyOf ?? []), ...(node.allOf ?? [])].entries()) {
    found.push(...objectNodes(child, `${path}|${String(index)}`));
  }
  return found;
}

describe('le tableau d’outils', () => {
  it('porte DOUZE outils, dans l’ordre figé de la §3.4', () => {
    expect([...TOOL_NAMES]).toStrictEqual(FROZEN_ORDER);
    expect(TOOL_NAMES).toHaveLength(12);
    expect(READ_ONLY_TOOL_NAMES).toHaveLength(5);
    expect(PROPOSAL_TOOL_NAMES).toHaveLength(7);
  });

  it('n’a pas de treizième outil, et surtout pas d’outil de prix (P10, ADR 0006)', () => {
    const names = TOOL_NAMES.join(' ');
    for (const forbidden of [...FORBIDDEN_TOOL_NAMES, 'propose_price', 'pay_price', 'price']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('chaque outil a un schéma d’entrée et un schéma de sortie, et rien d’orphelin', () => {
    expect(Object.keys(TOOL_INPUT_SCHEMAS).sort()).toStrictEqual([...TOOL_NAMES].sort());
    expect(Object.keys(TOOL_OUTPUT_SCHEMAS).sort()).toStrictEqual([...TOOL_NAMES].sort());
  });

  it('les douze descripteurs suivent le même ordre et la même famille', () => {
    expect(TOOL_DESCRIPTORS.map((tool) => tool.name)).toStrictEqual(FROZEN_ORDER);
    expect(TOOL_DESCRIPTORS.filter((tool) => tool.kind === 'read')).toHaveLength(5);
    expect(TOOL_DESCRIPTORS.filter((tool) => tool.kind === 'proposal')).toHaveLength(7);
  });
});

describe('JSON Schema : additionalProperties false partout, required complet', () => {
  // `io: 'input'` et pas le défaut. MESURÉ : en sortie, zod 4.6 écrit
  // `additionalProperties: false` même pour un objet NON strict — la
  // conversion par défaut rendait ce test vert quoi qu'il arrive, et on
  // aurait prouvé un garde-fou qui ne mordait pas. Un schéma d'entrée d'outil
  // décrit d'ailleurs bien ce que le modèle ENVOIE : c'est le sens correct.
  it.each(TOOL_NAMES.map((name) => [name] as const))('%s', (name: ToolName) => {
    const json = z.toJSONSchema(TOOL_INPUT_SCHEMAS[name], { io: 'input' }) as JsonNode;
    const nodes = objectNodes(json);
    expect(nodes.length).toBeGreaterThan(0);
    for (const [path, node] of nodes) {
      expect(node.additionalProperties, `${name} ${path} : additionalProperties`).toBe(false);
      const properties = Object.keys(node.properties ?? {});
      expect([...(node.required ?? [])].sort(), `${name} ${path} : required`).toStrictEqual(
        [...properties].sort(),
      );
    }
  });
});

describe('un argument non conforme est REFUSÉ, jamais réparé (§3.1)', () => {
  // Le JSON Schema dit au fournisseur ce qu'on attend ; ce test dit ce qu'on
  // fait quand il ne le respecte pas. Les deux sont nécessaires : « les
  // arguments d'un appel d'outil sont toujours revalidés par nous, quelle que
  // soit la promesse du fournisseur ».
  it.each(TOOL_NAMES.map((name) => [name] as const))('%s refuse une clé inconnue', (name) => {
    const schema = TOOL_INPUT_SCHEMAS[name];
    const parsed = schema.safeParse({ passager_clandestin: 1 });
    expect(parsed.success).toBe(false);
    const issues = parsed.error?.issues ?? [];
    expect(issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
  });
});

describe('propose_scene_transition — P11', () => {
  it('porte EXACTEMENT to_place_id et new_place_name', () => {
    expect(Object.keys(ProposeSceneTransitionInputSchema.shape).sort()).toStrictEqual([
      'new_place_name',
      'to_place_id',
    ]);
  });

  it('n’accepte pas un time_shift, même glissé dans un appel valide', () => {
    // Le modèle choisissait l'entrée qui DÉTERMINAIT un coût en vivres :
    // `character.gauge_changed` devenait atteignable par un circuit de
    // proposition. La lettre de l'invariant 1 était sauve, l'esprit non.
    expect(
      ProposeSceneTransitionInputSchema.safeParse({
        to_place_id: 'plc_col',
        new_place_name: '',
        time_shift: 'plusieurs_jours',
      }).success,
    ).toBe(false);
    expect(
      ProposeSceneTransitionInputSchema.safeParse({ to_place_id: 'plc_col', new_place_name: '' })
        .success,
    ).toBe(true);
  });
});

describe('roll_oracle — P12', () => {
  it('journalOnly est vide partout sauf roll_oracle', () => {
    for (const name of READ_ONLY_TOOL_NAMES) {
      if (name === 'roll_oracle') continue;
      expect(TOOL_JOURNAL_ONLY[name], `${name} écrit au journal`).toStrictEqual([]);
    }
    expect([...TOOL_JOURNAL_ONLY.roll_oracle]).toStrictEqual([...ORACLE_JOURNAL_ONLY_EVENT_TYPES]);
  });

  it('les tables « payer le prix » et « présages » ne sont PAS consultables', () => {
    // Elles ne sont tirées que par le moteur, en conséquence d'un mouvement.
    // Un modèle qui pourrait tirer un prix choisirait sa propre conséquence.
    expect([...ORACLE_TABLE_IDS]).not.toContain('pay-the-price');
    expect([...ORACLE_TABLE_IDS]).not.toContain('presages');
    expect(ORACLE_TABLE_IDS).toHaveLength(9);
  });
});

describe('les vocabulaires SANS contrepartie moteur, épinglés en toutes lettres', () => {
  // Ces tuples ne dérivent de rien : ils sont la §3.2 et la §3.3 recopiées.
  // Rien d'autre dans le dépôt ne peut les contredire, donc rien d'autre ne
  // peut les garder. C'est le seul cas où une liste littérale dans un test
  // est la bonne réponse, et c'est ce que l'ADR 0007 demande.
  it.each([
    [
      'get_state.scope',
      GET_STATE_SCOPES,
      ['table', 'character', 'clocks', 'vows', 'inventory', 'scene'],
    ],
    [
      'get_lore.kind',
      GET_LORE_KINDS,
      ['any', 'region', 'place', 'faction', 'custom', 'champion', 'creature'],
    ],
    [
      'get_chronicle.section',
      GET_CHRONICLE_SECTIONS,
      ['arcs', 'npcs', 'places', 'facts', 'open_threads', 'archived_facts', 'character'],
    ],
    [
      'roll_oracle.table_id',
      ORACLE_TABLE_IDS,
      [
        'yes-no',
        'action-theme',
        'place-features',
        'npc-names-freljord',
        'npc-roles',
        'npc-goals',
        'settlement-troubles',
        'freljord-weather',
        'complication',
      ],
    ],
    [
      'propose_npc_introduce.disposition',
      NPC_PROPOSAL_DISPOSITIONS,
      ['hostile', 'mefiant', 'neutre', 'curieux', 'allie'],
    ],
    ['propose_clock_create.kind', CLOCK_PROPOSAL_KINDS, ['scene', 'menace', 'campagne']],
    [
      'propose_thread_open.tied_to_kind',
      THREAD_TIE_KINDS,
      ['npc', 'place', 'vow', 'character', 'none'],
    ],
    [
      'propose_lore_fact.tied_to_kind',
      LORE_FACT_TIE_KINDS,
      ['npc', 'place', 'region', 'faction', 'character', 'none'],
    ],
    ['propose_*.status', PROPOSAL_STATUSES, ['applied', 'adjusted', 'rejected']],
  ] as const)('%s vaut EXACTEMENT la liste de la spéc, dans son ordre', (_name, actual, spec) => {
    expect([...actual]).toStrictEqual([...spec]);
  });

  it('chaque tuple est bien celui que le schéma d’entrée fait respecter', () => {
    // L'épinglage ci-dessus garde la CONSTANTE ; celui-ci garde le lien entre
    // la constante et le refus à l'exécution, faute de quoi on prouverait une
    // liste que plus aucun schéma n'utilise.
    expect(
      TOOL_INPUT_SCHEMAS.propose_npc_introduce.safeParse({
        name: 'Hrafn',
        role: 'eclaireur',
        one_line: 'Il lit le vent.',
        place_id: 'plc_col',
        disposition: 'inconnu',
      }).success,
    ).toBe(false);
    expect(
      TOOL_INPUT_SCHEMAS.roll_oracle.safeParse({
        table_id: 'presages',
        question: '',
        likelihood: 'sans-objet',
      }).success,
    ).toBe(false);
    expect(
      TOOL_INPUT_SCHEMAS.roll_oracle.safeParse({
        table_id: 'yes-no',
        question: 'Le col est-il gardé ?',
        likelihood: 'incertain',
      }).success,
    ).toBe(true);
  });
});

describe('les énumérations dérivées du moteur (ADR 0007)', () => {
  it('likelihood = les cinq vraisemblances du moteur + sans-objet', () => {
    expect([...ORACLE_LIKELIHOODS]).toStrictEqual([...LIKELIHOODS, 'sans-objet']);
  });

  it('propose_clock_create.segments = CLOCK_SEGMENT_COUNTS', () => {
    const json = z.toJSONSchema(TOOL_INPUT_SCHEMAS.propose_clock_create) as JsonNode;
    expect(json.properties?.['segments']?.enum).toStrictEqual([...CLOCK_SEGMENT_COUNTS]);
  });

  it('propose_vow_hook.rank = PROGRESS_RANKS', () => {
    const json = z.toJSONSchema(TOOL_INPUT_SCHEMAS.propose_vow_hook) as JsonNode;
    expect(json.properties?.['rank']?.enum).toStrictEqual([...PROGRESS_RANKS]);
  });
});

describe('aucun outil n’accepte une valeur de jeu', () => {
  it.each(TOOL_NAMES.map((name) => [name] as const))('%s', (name: ToolName) => {
    // La liste de noms interdits de la §3.1, appliquée aux CLÉS D'ENTRÉE.
    // Un outil qui prendrait une jauge, une issue, un dé ou un effet
    // remettrait le conteur sur le chemin de décision.
    const json = JSON.stringify(z.toJSONSchema(TOOL_INPUT_SCHEMAS[name]));
    for (const forbidden of [
      'gauge',
      'vigueur',
      'ame',
      'vivres',
      'momentum',
      'outcome',
      'franche',
      'partielle',
      'echec',
      'effect',
      'damage',
      'time_shift',
      'optionId',
      'pay_price',
    ]) {
      expect(json, `${name} porte ${forbidden}`).not.toContain(`"${forbidden}"`);
    }
  });
});
