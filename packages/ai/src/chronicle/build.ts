/**
 * The compaction request, and the deterministic markdown rendering of a
 * chronicle (02-mj-ia.md sections 5.2 and 5.5).
 *
 * ── DETERMINISTIC, AND THAT IS NOT DECORATION ───────────────────────────────
 * `rendered` is a projection of `doc` in a FIXED order: premise, open arcs
 * then dormant ones, characters, living NPCs then the rest, open threads,
 * facts sorted by `event_seq`, recent digest. Two renderings of equal data are
 * equal bytes, which is what keeps `<chronique>` — message 1 of section 4.1,
 * and the largest cacheable block after the system prompt — from moving for
 * nothing. Held by tests/outputs.test.ts « rend les mêmes octets à document
 * égal, quel que soit l'ordre reçu ».
 *
 * ── THE SEAMS ARE PART OF THE RENDERING ─────────────────────────────────────
 * T4 drops `places` and the NPCs absent from the scene; T7 keeps only the
 * premise, the open arcs, the threads and the facts tied to the scene. So the
 * rendering does not produce one string: it produces the PARTS the truncation
 * ladder cuts along (`context/budget.ts`). A single string would force the
 * ladder to re-parse its own output. Held by tests/outputs.test.ts « sépare
 * ce que la scène porte de ce qu'elle ne porte pas » and « et une liste vide
 * ne rend aucune section, jamais un titre orphelin » ; that the ladder really
 * cuts along them is tests/context-budget.test.ts « et chaque niveau retire
 * vraiment quelque chose ».
 */

import type { ChronicleDoc, SceneStateDto, StructureRequest } from '@for/contracts';
import { ChronicleDoc as ChronicleDocSchema } from '@for/contracts';

import { normalize } from '../assertions/text.js';
import type { ChronicleParts } from '../context/budget.js';

const section = (heading: string, lines: readonly string[]): string =>
  lines.length === 0 ? '' : [`## ${heading}`, ...lines].join('\n');

const byEventSeq = <T extends { readonly event_seq: number; readonly fact_id: string }>(
  facts: readonly T[],
): readonly T[] =>
  [...facts].sort((left, right) =>
    left.event_seq === right.event_seq
      ? left.fact_id.localeCompare(right.fact_id)
      : left.event_seq - right.event_seq,
  );

/**
 * Render a chronicle into the parts the ladder cuts along.
 *
 * `scene` decides which NPCs and which facts count as « of the current
 * scene » — the seams T4 and T7 are defined against it, not against a guess.
 */
export function renderChronicleParts(
  doc: ChronicleDoc,
  scene: SceneStateDto | null,
): ChronicleParts {
  const inScene = new Set(
    (scene === null ? [] : [...scene.present, ...scene.absent]).map((entry) =>
      normalize(entry.name),
    ),
  );
  const sceneIds = new Set(
    (scene === null ? [] : [...scene.present, ...scene.absent]).map((entry) => entry.ref.id),
  );

  const arcs = [...doc.arcs].sort((left, right) => left.id.localeCompare(right.id));
  const openArcs = arcs.filter((arc) => arc.status === 'ouvert');
  const otherArcs = arcs.filter((arc) => arc.status !== 'ouvert');

  const npcs = [...doc.npcs].sort((left, right) => left.npc_id.localeCompare(right.npc_id));
  const sceneNpcs = npcs.filter((npc) => inScene.has(normalize(npc.name)));
  const otherNpcs = npcs.filter((npc) => !inScene.has(normalize(npc.name)));

  const facts = byEventSeq(doc.facts);
  const tied = (fact: (typeof facts)[number]): boolean =>
    fact.entities.some((entity) => sceneIds.has(entity));

  return {
    premise: doc.premise.length === 0 ? '' : `# Chronique\n${doc.premise}`,
    openArcs: section(
      'Arcs ouverts',
      openArcs.map((arc) => `- ${arc.title} — ${arc.summary}`),
    ),
    otherArcs: section(
      'Arcs dormants ou résolus',
      otherArcs.map((arc) => `- ${arc.title} (${arc.status}) — ${arc.summary}`),
    ),
    characters: section(
      'Personnages',
      [...doc.characters]
        .sort((left, right) => left.character_id.localeCompare(right.character_id))
        .map(
          (character) =>
            `- ${character.name} — ${character.one_line} ; fardeau : ${character.current_burden}`,
        ),
    ),
    sceneNpcs: section(
      'Personnages non joueurs en scène',
      sceneNpcs.map((npc) => `- ${npc.name} (${npc.role}, ${npc.status}) — ${npc.stance}`),
    ),
    otherNpcs: section(
      'Autres personnages non joueurs',
      otherNpcs.map((npc) => `- ${npc.name} (${npc.role}, ${npc.status}) — ${npc.stance}`),
    ),
    places: section(
      'Lieux',
      [...doc.places]
        .sort((left, right) => left.place_id.localeCompare(right.place_id))
        .map((place) => `- ${place.name} — ${place.one_line} ; ${place.state}`),
    ),
    sceneFacts: section(
      'Faits liés à la scène',
      facts.filter(tied).map((fact) => `- ${fact.statement}`),
    ),
    otherFacts: section(
      'Autres faits',
      facts.filter((fact) => !tied(fact)).map((fact) => `- ${fact.statement}`),
    ),
    openThreads: section(
      'Fils ouverts',
      [...doc.open_threads]
        .sort((left, right) => left.thread_id.localeCompare(right.thread_id))
        .map((thread) => `- ${thread.title} — ${thread.summary}`),
    ),
    recentDigest: section(
      'Séances récentes',
      doc.recent_digest.map((line) => `- ${line}`),
    ),
  };
}

export interface ChronicleRequestInput {
  readonly requestId: string;
  readonly systemPrompt: string;
  /** The journal material to compact, already rendered by the caller. */
  readonly material: string;
  /** Appended to the USER message on a retry. Never a system-prompt rewrite. */
  readonly corrections?: string | undefined;
  readonly maxOutputTokens: number;
}

/**
 * Build the compaction request.
 *
 * `schema` is `ChronicleDoc` itself: section 0.1 makes the Zod schema the
 * SOURCE of the expected shape, and `structurer()` returns a value already
 * validated against it — a signature guarantee, not a convention.
 */
export function buildChronicleRequest(
  input: ChronicleRequestInput,
): StructureRequest<ChronicleDoc> {
  const user = [input.material, input.corrections ?? '']
    .filter((part) => part.length > 0)
    .join('\n\n');
  return {
    purpose: 'chronicle',
    requestId: input.requestId,
    system: [{ type: 'text', text: input.systemPrompt, cacheHint: 'stable' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    schema: ChronicleDocSchema,
    schemaName: 'chronique',
    maxOutputTokens: input.maxOutputTokens,
    effort: 'medium',
  };
}
