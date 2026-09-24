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
 */
import { CLOCK_SEGMENT_COUNTS, LIKELIHOODS, PROGRESS_RANKS } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { z } from 'zod';
import { ORACLE_JOURNAL_ONLY_EVENT_TYPES } from '../../src/ai/narrator-port.js';
import {
  FORBIDDEN_TOOL_NAMES,
  ORACLE_LIKELIHOODS,
  ORACLE_TABLE_IDS,
  PROPOSAL_TOOL_NAMES,
  ProposeSceneTransitionInputSchema,
  READ_ONLY_TOOL_NAMES,
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
