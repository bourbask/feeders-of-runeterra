/**
 * The three versions of the campaign's chronicle, WRITTEN BY HAND.
 *
 * P2 of the task list settled this: the three-layer compaction model is gone,
 * and the seed writes « 3 versions d'un document unique », with no AI call
 * anywhere. `pnpm db:seed` must run with no provider, no key and no network.
 *
 * WHAT MAKES A VERSION HONEST HERE. Every `facts[].event_seq` names a real
 * journal line, and `demo.ts` refuses to write a chronicle whose provenance
 * points past the sequence its `chronicle.compacted` declares. That is the
 * anti-drift mechanism of `02-mj-ia.md` section 5.2 exercised on real data:
 * a fact with no line behind it is a fact the memory invented.
 *
 * The three versions are cumulative and APPEND-ONLY in their statements: a
 * fact written in version 1 appears verbatim in versions 2 and 3, or carries
 * `superseded_by`. Nothing is rewritten — that is the property `db:check`
 * control 11 protects the SHAPE of, and that this text protects the CONTENT of.
 */

import type { ChronicleDoc } from '@for/contracts';

export interface WrittenChronicle {
  readonly doc: ChronicleDoc;
  readonly renderedMd: string;
  /** What `chronicle.compacted.tokenCount` records. Estimated, never measured. */
  readonly tokenCount: number;
}

const PREMISE =
  'La Porte Basse se referme un hiver plus tôt que prévu. Trois clans qui ne se doivent rien ' +
  "doivent décider, avant la première neige tenue, ce qu'ils acceptent de se devoir.";

const CHARACTERS: ChronicleDoc['characters'] = [
  {
    character_id: 'braum',
    name: 'Braum',
    one_line:
      "Il se met devant, et il trouve ça tellement normal qu'il ne comprend pas qu'on le remercie.",
    notable_deeds: ['A tenu la Porte Basse pendant que le chariot passait.'],
    current_burden: "Il a promis à Keld quelque chose qu'il n'a dit à personne.",
  },
  {
    character_id: 'ashe',
    name: 'Ashe',
    one_line: 'Elle compte les gens avant de compter les flèches.',
    notable_deeds: ['A obtenu du Gué Bas le nom de celui qui a creusé.'],
    current_burden: 'Le grenier commun ne passera pas l’hiver sans le tribut.',
  },
  {
    character_id: 'sejuani',
    name: 'Sejuani',
    one_line: "Elle prend ce qu'on ne lui donne pas, et elle le dit avant de le faire.",
    notable_deeds: ['A juré devant la horde de ne pas toucher au Gué Bas cet hiver.'],
    current_burden: "La Griffe d'Hiver attend de voir si un serment nourrit.",
  },
];

const PLACES: ChronicleDoc['places'] = [
  {
    place_id: 'la-porte-basse',
    name: 'La Porte Basse',
    one_line: "Un col si étroit qu'on y passe un chariot à la fois.",
    state: 'ouvert, mais la neige gagne chaque nuit',
  },
  {
    place_id: 'le-gue-bas',
    name: 'Le Gué Bas',
    one_line: 'Trois maisons, un grenier commun, une rivière qui gèle trop tard.',
    state: 'grenier au tiers',
  },
  {
    place_id: 'la-tombe-basse',
    name: 'La Tombe Basse',
    one_line: 'Sous trois mètres de glace, et personne ne creuse.',
    state: 'quelqu’un a creusé, et a refermé',
  },
];

function npc(
  id: string,
  name: string,
  role: string,
  status: ChronicleDoc['npcs'][number]['status'],
  stance: string,
  voice: string,
  place: string,
  seq: number,
): ChronicleDoc['npcs'][number] {
  return {
    npc_id: id,
    name,
    role,
    status,
    stance,
    voice,
    last_seen_place: place,
    last_event_seq: seq,
  };
}

/** The first arc of version 1, named once so version 2 can close it. */
const PASS_ARC: ChronicleDoc['arcs'][number] = {
  id: 'arc-porte-basse',
  title: 'Passer avant que le col se ferme',
  status: 'ouvert',
  summary: 'Le chariot du relais doit franchir la Porte Basse avant que la neige la tienne.',
  last_event_seq: 44,
};

/**
 * Version 1 — end of the first scene of the first session.
 *
 * Short on purpose: a chronicle that already knew everything at its first
 * compaction would teach the reader the wrong shape of the mechanism.
 */
const V1: ChronicleDoc = {
  premise: PREMISE,
  arcs: [PASS_ARC],
  characters: CHARACTERS.slice(0, 3),
  npcs: [
    npc(
      'keld-le-tanneur',
      'Keld le Tanneur',
      'tient le relais de la Porte Basse',
      'vivant',
      'il rend service et compte',
      'court, et il finit ses phrases par un chiffre',
      'La Porte Basse',
      27,
    ),
  ],
  places: PLACES.slice(0, 1),
  facts: [
    {
      fact_id: 'f-col-se-ferme',
      statement: 'La Porte Basse se referme un hiver plus tôt que ce que les anciens annonçaient.',
      entities: ['la-porte-basse'],
      event_seq: 26,
      superseded_by: null,
    },
    {
      fact_id: 'f-keld-tient-le-relais',
      statement: 'Keld tient le relais de la Porte Basse et connaît les dettes de chacun.',
      entities: ['keld-le-tanneur', 'la-porte-basse'],
      event_seq: 27,
      superseded_by: null,
    },
  ],
  // EMPTY, and that is a fact about the first compaction rather than an
  // oversight: at sequence 44 nobody has sworn anything yet.
  open_threads: [],
  recent_digest: ['Première veillée : la bande se forme à la Porte Basse et Keld ouvre sa porte.'],
};

/** Version 2 — the first session, closed. Olaf is dead and stays dead. */
const V2: ChronicleDoc = {
  ...V1,
  arcs: [
    { ...PASS_ARC, status: 'resolu', last_event_seq: 176 },
    {
      id: 'arc-tombe',
      title: 'Qui a ouvert la tombe',
      status: 'ouvert',
      summary: "Des outils propres, laissés sur place : quelqu'un a creusé avant eux.",
      last_event_seq: 56,
    },
  ],
  npcs: [
    npc(
      'keld-le-tanneur',
      'Keld le Tanneur',
      'tient le relais de la Porte Basse',
      'vivant',
      'il rend service et compte',
      'court, et il finit ses phrases par un chiffre',
      'La Porte Basse',
      27,
    ),
    npc(
      'yrsa-du-gue-bas',
      'Yrsa du Gué Bas',
      'tient le grenier commun',
      'vivant',
      'elle ouvre le grenier à qui rend',
      'lente, et elle répète les chiffres',
      'Le Gué Bas',
      77,
    ),
    npc(
      'olaf-le-revenant',
      'Olaf',
      'compagnon tombé à la Porte Basse',
      'mort',
      "on raconte qu'on l'a revu au nord",
      'il riait avant de frapper',
      'La Porte Basse',
      118,
    ),
  ],
  places: PLACES.slice(0, 2),
  facts: [
    ...V1.facts,
    {
      fact_id: 'f-olaf-tombe',
      statement: "Olaf est tombé à la Porte Basse, et la bande ne l'a pas ramené.",
      entities: ['olaf-le-revenant', 'la-porte-basse'],
      event_seq: 118,
      superseded_by: null,
    },
    {
      fact_id: 'f-grenier-au-tiers',
      statement: 'Le grenier commun du Gué Bas est au tiers et ne tiendra pas seul.',
      entities: ['le-gue-bas', 'yrsa-du-gue-bas'],
      event_seq: 77,
      superseded_by: null,
    },
  ],
  open_threads: [
    {
      thread_id: 'qui-a-ouvert-la-tombe',
      title: 'Qui a ouvert la tombe ?',
      summary: 'Des outils laissés sur place, propres, et aucune trace autour.',
      opened_event_seq: 56,
      tied_to: 'la-tombe-basse',
    },
  ],
  recent_digest: [
    'Première veillée : la bande se forme à la Porte Basse et Keld ouvre sa porte.',
    "Fin de la première veillée : Olaf tombe, Udyr repart au nord, et le pacte n'est pas encore juré.",
  ],
};

/** Version 3 — mid-way through the second session, the pact sworn. */
const V3: ChronicleDoc = {
  ...V2,
  arcs: [
    ...V2.arcs,
    {
      id: 'arc-pacte',
      title: 'Le Pacte de la Griffe-de-Givre',
      status: 'ouvert',
      summary: 'Trois clans jurent de tenir le col ensemble le temps d’un hiver.',
      last_event_seq: 217,
    },
  ],
  places: PLACES,
  facts: [
    ...V2.facts,
    {
      fact_id: 'f-pacte-jure',
      statement: "Le pacte est juré pour le temps d'un hiver, et pas un jour de plus.",
      entities: ['le-pacte-de-la-griffe-de-givre', 'la-griffe-d-hiver'],
      event_seq: 217,
      superseded_by: null,
    },
    {
      fact_id: 'f-tombe-ouverte',
      statement: "Quelqu'un a ouvert la Tombe Basse avant eux et a refermé derrière lui.",
      entities: ['la-tombe-basse', 'qui-a-ouvert-la-tombe'],
      event_seq: 194,
      superseded_by: null,
    },
  ],
  open_threads: [
    ...V2.open_threads,
    {
      thread_id: 'le-pacte-de-la-griffe-de-givre',
      title: 'Le Pacte de la Griffe-de-Givre',
      summary: 'Ce que trois clans acceptent de se devoir avant que le col se referme.',
      opened_event_seq: 196,
      tied_to: 'la-porte-basse',
    },
  ],
  recent_digest: [
    'Première veillée : la bande se forme à la Porte Basse et Keld ouvre sa porte.',
    "Fin de la première veillée : Olaf tombe, Udyr repart au nord, et le pacte n'est pas encore juré.",
    'Deuxième veillée : le pacte est juré au Gué Bas, et la Tombe Basse pose une question neuve.',
  ],
};

function render(version: number, doc: ChronicleDoc): string {
  const lines = [
    `# Chronique — version ${String(version)}`,
    '',
    doc.premise,
    '',
    '## Arcs',
    ...doc.arcs.map((arc) => `- **${arc.title}** (${arc.status}) — ${arc.summary}`),
    '',
    '## Faits établis',
    ...doc.facts.map((fact) => `- ${fact.statement} *(seq ${String(fact.event_seq)})*`),
    '',
    '## Fils ouverts',
    ...doc.open_threads.map((thread) => `- **${thread.title}** — ${thread.summary}`),
  ];
  return lines.join('\n');
}

/** The three versions, in order. Index 0 is version 1. */
export const CHRONICLE_VERSIONS: readonly WrittenChronicle[] = [
  { doc: V1, renderedMd: render(1, V1), tokenCount: 310 },
  { doc: V2, renderedMd: render(2, V2), tokenCount: 640 },
  { doc: V3, renderedMd: render(3, V3), tokenCount: 880 },
];
