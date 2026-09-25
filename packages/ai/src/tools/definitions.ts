/**
 * `TOOL_DEFINITIONS` — the twelve tools exposed to the model, in the FROZEN
 * ORDER of 02-mj-ia.md section 3.4.
 *
 * ── WHY THE ORDER IS PART OF THE CONTRACT ───────────────────────────────────
 * The table renders at position 0 of every request (section 4.2). A table that
 * varies from one call to the next moves the cacheable prefix, so a reorder
 * invalidates the prompt cache of EVERY campaign at once. That is why
 * `tests/tools.snapshot.json` pins the rendered table and why changing it
 * without bumping `TOOLS_VERSION` fails the build.
 *
 * ── WHY THE SCHEMAS ARE DERIVED AND NOT RETYPED ─────────────────────────────
 * The Zod schemas in `@for/contracts` are what VALIDATES an incoming tool
 * call. If this file typed the JSON Schema by hand, the model would be told
 * one shape and checked against another, and nothing would notice — ADR 0007,
 * applied to a pair that is not even an enum. So the JSON Schema is produced
 * from the very schema the handler validates with, `io: 'input'` (a default
 * conversion writes `additionalProperties: false` on non-strict objects too,
 * which would make a strictness check green for the wrong reason).
 *
 * Only the DESCRIPTIONS are written here, because Zod carries none: they are
 * the French text of sections 3.2 and 3.3 and they are what the model reads.
 * `tests/tool-surface.test.ts` compares the described property names to the
 * generated ones in both directions, so a description attached to a key that
 * no longer exists is an error rather than dead text.
 *
 * ── THERE IS NO THIRTEENTH TOOL ─────────────────────────────────────────────
 * And above all no price tool: the engine rolls the d12 and hands the entry
 * over as an imposed fact (section 3.4, ADR 0006). Opening that circuit takes
 * an ADR, a `TOOLS_VERSION` bump and the invalidation of every prompt cache.
 */

import {
  PROPOSAL_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  TOOL_INPUT_SCHEMAS,
  TOOL_NAMES,
  type JsonSchemaObject,
  type NarratorToolSpec,
  type ToolName,
} from '@for/contracts';
import { z } from 'zod';

/**
 * Bumped by ANY change to the order, a name, a description or a schema below.
 * The snapshot test is what makes forgetting impossible.
 */
export const TOOLS_VERSION = 'tools/1.0.0';

/** Section 3.1: three tool calls per turn, then the prose. */
export const TOOL_CALLS_PER_TURN_MAX = 3;

/** Section 3.1 and section 0.1 contract 5: three loop iterations, then `none`. */
export const TOOL_LOOP_ITERATIONS_MAX = 3;

// --------------------------------------------------------------- the texts

/** Tool-level descriptions, verbatim from sections 3.2 and 3.3. */
const TOOL_DESCRIPTIONS = {
  get_state:
    "Lit l'état courant de la table (jauges, horloges, serments, lieux, inventaire). Lecture seule : cet outil ne modifie rien.",
  get_lore:
    'Recherche dans le contenu de jeu versionné (régions, lieux, factions, coutumes, champions autorisés). Lecture seule. Les entrées concernant un champion réservé ne sont jamais renvoyées.',
  get_chronicle:
    'Lit une section de la chronique compactée de la campagne, y compris les éléments archivés absents du contexte courant. Lecture seule.',
  check_name_allowed:
    "Vérifie qu'un nom propre peut être écrit dans la narration. Renvoie faux pour tout champion réservé de la campagne, y compris ses surnoms et épithètes. Lecture seule.",
  roll_oracle:
    "Consulte une table d'oracle évocatrice du jeu, ou pose une question oui/non pondérée. Le tirage est effectué par le moteur avec son générateur seedé, et journalisé. Cet outil ne résout jamais l'action d'un personnage, ne modifie aucune jauge et ne tranche aucune issue. Les tables « payer le prix » et « présages » ne sont PAS accessibles ici : elles ne sont tirées que par le moteur, en conséquence d'un mouvement.",
  propose_npc_introduce:
    "Propose l'apparition d'un personnage non joueur nommé. Le serveur vérifie qu'il ne s'agit pas d'un champion réservé, déduplique avec les PNJ existants et attribue un identifiant. Ne crée rien tant que le serveur n'a pas répondu.",
  propose_clock_create:
    "Propose la création d'une horloge de menace ou d'enjeu. Le serveur fixe le nombre de segments autorisé et décide de sa visibilité.",
  propose_clock_advance:
    "Propose de faire avancer une horloge existante d'un à trois segments, lorsque la fiction du tour le justifie. Le serveur vérifie que le fait du tour autorise cette avance et peut la réduire ou la refuser. Cet outil ne modifie aucune jauge de personnage.",
  propose_thread_open:
    "Propose l'ouverture d'un fil narratif que la campagne devra reprendre plus tard. Le serveur l'enregistre comme dette narrative visible dans la chronique.",
  propose_lore_fact:
    "Propose d'inscrire au canon de la campagne un fait du monde établi pendant la scène (une coutume, l'histoire d'un lieu, un lien entre deux personnages non joueurs). Le serveur refuse tout fait qui contredit le canon existant, mentionne un champion réservé ou porte une valeur chiffrée.",
  propose_scene_transition:
    'Propose de déplacer la scène vers un autre lieu. Le serveur applique la transition et met à jour la scène. Cet outil ne fait pas passer le temps, ne coûte rien et ne déclenche aucune conséquence mécanique.',
  propose_vow_hook:
    "Propose au joueur une occasion de jurer un serment. Le serveur enregistre l'offre ; c'est le joueur, via l'interface, qui décide de jurer ou non. Ne raconte jamais le serment comme s'il était prêté.",
} as const satisfies Record<ToolName, string>;

/**
 * Property-level descriptions, verbatim from sections 3.2 and 3.3.
 *
 * A key absent here simply carries no description — the spec leaves several
 * without one. A key PRESENT here that the schema does not have is a bug, and
 * the surface test says so.
 */
const TOOL_PROPERTY_DESCRIPTIONS = {
  get_state: {
    scope: 'Périmètre lu.',
    character_id:
      'Identifiant du personnage, requis si scope vaut character ou inventory, sinon null.',
  },
  get_lore: {
    query: 'Ce que tu cherches, en français, en quelques mots.',
  },
  get_chronicle: {
    subject_id: "Identifiant d'arc, de PNJ, de lieu ou de personnage à cibler, sinon null.",
  },
  check_name_allowed: {},
  roll_oracle: {
    table_id: "Table consultée. yes-no exige likelihood ; les autres l'ignorent.",
    question: "La question posée, en français. Chaîne vide si la table n'est pas yes-no.",
  },
  propose_npc_introduce: {
    name: 'Nom propre, cohérent avec le Freljord.',
    role: 'Rôle social en quelques mots : chasseresse, forgeron, éclaireur du clan.',
    one_line: 'Une phrase de caractérisation, sans chiffre ni terme de règle.',
    place_id: "Lieu où il apparaît, identifiant tiré de l'état ou de la chronique.",
  },
  propose_clock_create: {
    name: "Nom de l'horloge, formulé comme une menace concrète : « La tempête se lève ».",
    rationale: 'Pourquoi la fiction courante la justifie, en une phrase.',
  },
  propose_clock_advance: {},
  propose_thread_open: {
    summary: 'Une à deux phrases, sans chiffre.',
    tied_to_id: 'Identifiant lié, chaîne vide si tied_to_kind vaut none.',
  },
  propose_lore_fact: {
    statement: 'Une phrase affirmative, sans chiffre, sans terme de règle.',
  },
  propose_scene_transition: {
    to_place_id: 'Lieu existant, ou chaîne vide si tu proposes un lieu neuf.',
    new_place_name: 'Nom du lieu neuf proposé, ou chaîne vide.',
  },
  propose_vow_hook: {},
} as const satisfies Record<ToolName, Readonly<Record<string, string>>>;

// ------------------------------------------------------------- the building

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null) return value;
  for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  return Object.freeze(value);
};

/**
 * `$schema` is dropped: it says which dialect the document speaks, which no
 * provider reads and which would sit in the cached prefix for nothing.
 */
const buildInputSchema = (name: ToolName): JsonSchemaObject => {
  const generated = z.toJSONSchema(TOOL_INPUT_SCHEMAS[name], { io: 'input' }) as Record<
    string,
    unknown
  > & {
    properties?: Record<string, Record<string, unknown>>;
  };
  // `$schema` names the dialect. No provider reads it, and it would sit in
  // the cached prefix of every request for nothing.
  const rest: Record<string, unknown> = { ...generated };
  delete rest['$schema'];
  const described: Record<string, string> = TOOL_PROPERTY_DESCRIPTIONS[name];
  const properties: Record<string, unknown> = {};
  const shapes = generated.properties ?? {};
  for (const [key, shape] of Object.entries(shapes)) {
    const description = described[key];
    properties[key] = description === undefined ? { ...shape } : { ...shape, description };
  }
  return { ...rest, properties } as unknown as JsonSchemaObject;
};

/**
 * The twelve, in the frozen order, deep-frozen so nothing downstream can
 * mutate a description or a schema in place and move the cached prefix of a
 * running process.
 */
export const TOOL_DEFINITIONS: readonly NarratorToolSpec[] = deepFreeze(
  TOOL_NAMES.map((name): NarratorToolSpec => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    inputSchema: buildInputSchema(name),
  })),
);

/** Lookup by name, for the handler. Same twelve objects, same freeze. */
export const TOOL_DEFINITIONS_BY_NAME: Readonly<Record<ToolName, NarratorToolSpec>> = Object.freeze(
  Object.fromEntries(TOOL_DEFINITIONS.map((tool) => [tool.name, tool])) as Record<
    ToolName,
    NarratorToolSpec
  >,
);

export { PROPOSAL_TOOL_NAMES, READ_ONLY_TOOL_NAMES, TOOL_NAMES };
