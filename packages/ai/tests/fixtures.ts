/**
 * Fixtures for the M0-22 tests: one brief, one scene, and a campaign that
 * GROWS.
 *
 * `longCampaign(seq)` is the `LONG_CAMPAIGN` of the acceptance criteria. Its
 * point is that it gets heavier with the journal: a chronicle that fills up,
 * a rolling window that reaches twelve turns, an `<etat>` that accumulates
 * inventory and idle clocks. Measuring the budget on a fresh campaign proves
 * nothing — the whole promise of invariant 2 is that the context weighs the
 * same in the sixth month as in the second week, and only a fixture that
 * grows can put that promise under load.
 *
 * Sizes are in CHARACTERS and derived from section 4.3's ceilings through the
 * estimator's ratio, so the fixture saturates where the spec says the real
 * blocks saturate rather than at a number picked to make a test pass.
 */

import type { NarrationBriefDto, SceneStateDto } from '@for/contracts';

import type { TrimmableContext } from '../src/context/budget.js';
import type { FactVocabulary } from '../src/context/fact.js';
import type { SceneActor, SceneMergeState } from '../src/outputs/scene.js';

/** Deterministic filler: same bytes for the same length, and French-shaped. */
export function filler(chars: number, salt = 'a'): string {
  const words = [
    'la',
    'neige',
    'tombe',
    'sur',
    'le',
    'col',
    'et',
    'le',
    'vent',
    'porte',
    'une',
    'odeur',
    'de',
    'suif',
    salt,
  ];
  let out = '';
  let at = 0;
  while (out.length < chars) {
    out += `${words[at % words.length] ?? 'et'} `;
    at += 1;
  }
  return out.slice(0, Math.max(0, chars)).trimEnd();
}

const section = (heading: string, chars: number, salt: string): string =>
  chars <= 0 ? '' : `## ${heading}\n${filler(chars, salt)}`;

/** Grows linearly with `seq`, then stops at `max`. */
const grown = (seq: number, perTurn: number, max: number): number =>
  Math.min(max, Math.round(seq * perTurn));

/**
 * The campaign at journal sequence `seq`, with the chronicle optionally
 * inflated — that is the lever the acceptance criterion hands the tester.
 */
export function longCampaign(seq: number, extraChronicleChars = 0): TrimmableContext {
  const turns = Math.min(12, Math.floor(seq / 3));
  return {
    // Section 4.3: three excerpts of four hundred characters.
    lore: [filler(400, 'lore1'), filler(400, 'lore2'), filler(400, 'lore3')],
    etat: {
      core: filler(1000, 'etat'),
      inventoryAndIdleClocks: filler(grown(seq, 3, 3300), 'inv'),
    },
    turns: Array.from({ length: turns }, (_unused, index) => filler(900, `tour${String(index)}`)),
    chronicle: {
      premise: `# Chronique\n${filler(380, 'premise')}`,
      openArcs: section('Arcs ouverts', grown(seq, 1.2, 1400) + extraChronicleChars, 'arcs'),
      otherArcs: section('Arcs dormants', grown(seq, 0.8, 900), 'arcsd'),
      characters: section('Personnages', grown(seq, 0.7, 800), 'perso'),
      sceneNpcs: section('PNJ en scène', grown(seq, 0.6, 700), 'npcs'),
      otherNpcs: section('Autres PNJ', grown(seq, 1.1, 1300), 'npco'),
      places: section('Lieux', grown(seq, 1, 1200), 'lieux'),
      sceneFacts: section('Faits liés à la scène', grown(seq, 0.9, 1000), 'factss'),
      otherFacts: section('Autres faits', grown(seq, 1.4, 1600), 'factso'),
      openThreads: section('Fils ouverts', grown(seq, 0.5, 600), 'fils'),
      recentDigest: section('Séances récentes', grown(seq, 0.6, 700), 'digest'),
    },
  };
}

// ------------------------------------------------------------------- brief

type Fact = NarrationBriefDto['perceivableFacts'][number];

export const perceivable = (over: Partial<Fact> & Pick<Fact, 'kind' | 'name'>): Fact => ({
  ref: { kind: 'entity', id: `ent_${over.name.toLowerCase()}` },
  detail: '',
  sinceSeq: 1,
  ...over,
});

export const BRIEF_FACTS: readonly Fact[] = [
  perceivable({ kind: 'present', name: 'Braum', detail: 'en retrait, corde en main' }),
  perceivable({
    ref: { kind: 'character', id: 'chr_sejuani' },
    kind: 'present',
    name: 'Sejuani',
    detail: 'debout, la paume ouverte',
  }),
  perceivable({ kind: 'absent', name: 'Keld', detail: 'mort' }),
  perceivable({ kind: 'absent', name: 'Signy', detail: 'parti' }),
];

export function brief(over: Partial<NarrationBriefDto> = {}): NarrationBriefDto {
  return {
    correlationId: 'cor_1',
    sceneId: 'scn_1',
    audience: { scope: 'table', recipients: null },
    perceivableFacts: [...BRIEF_FACTS],
    actorCharacterId: 'chr_sejuani',
    moveId: 'face-danger',
    outcome: 'partielle',
    isPresage: true,
    roll: {
      rollId: 'rol_1',
      attribute: 'fer',
      attributeValue: 3,
      actionDie: 4,
      adds: [{ source: 'asset', value: 1 }],
      rawTotal: 8,
      total: 8,
      cappedAtTen: false,
      challengeDice: [7, 7],
      momentumNegated: false,
      burned: false,
    },
    appliedEffects: [],
    imposedPrice: {
      rollId: 'rol_2',
      tableId: 'pay-the-price',
      value: 7,
      entryId: 'ptp_allie_retourne',
      text: 'Un allié se retourne contre toi.',
      severity: 'grave',
      effectIndex: 2,
    },
    presage: {
      tableId: 'presage',
      value: 3,
      entryId: 'prs_retournement',
      text: 'un retournement doit survenir dans cette scène',
    },
    // Deliberately NAMES NOBODY: `context-budget.test.ts` hides Ulrun from
    // the perceivable list and demands he appear nowhere in the request. A
    // player input that named him would make that probe pass for the wrong
    // reason — or rather, fail for a legitimate one.
    playerInput: 'Je traverse la corniche sans attendre, je veux voir la vallée avant la nuit.',
    eventSeqs: [41, 42, 43],
    fallbackTemplateId: 'face-danger/partielle',
    ...over,
  } as NarrationBriefDto;
}

export const VOCABULARY: FactVocabulary = {
  moveLabel: 'Affronter le danger',
  attributeLabel: 'fer',
  outcomeLabel: 'RÉUSSITE PARTIELLE',
  effectSentences: [
    'Sejuani a franchi la corniche, mais la traversée lui a coûté.',
    'Sa vigueur a baissé d’un cran.',
  ],
};

export const CAMPAIGN_BLOCK = [
  '# Campagne : Le Col des Hurleurs',
  'Ton : âpre.',
  '## Personnages joueurs présents à la table',
  '- Braum (Braum, il) — porte la porte',
  '- Sejuani (Sejuani, elle) — mène la battue',
  '## Champions interdits (réservés)',
  '- Lissandra (également : la Sorcière de Glace)',
].join('\n');

// ------------------------------------------------------------------- scene

/**
 * Somebody the ENGINE has in the scene and the brief's list does not carry —
 * the M1 case where the party has split.
 *
 * NOT `Ulrun`: the storyteller's own system prompt names him in its worked
 * example, so a probe built on `Ulrun` would be red on the prompt rather than
 * on the perception channel. Measured, and the reason this constant exists.
 */
export const HIDDEN_FROM_BRIEF = 'Hreidar';

export const scenePresence = (
  id: string,
  name: string,
  state = '',
  sinceSeq = 1,
): SceneStateDto['present'][number] => ({
  ref: { kind: id.startsWith('chr_') ? 'character' : 'entity', id },
  name,
  state,
  sinceSeq,
});

export const sceneAbsence = (
  id: string,
  name: string,
  cause: SceneStateDto['absent'][number]['cause'],
  sinceSeq = 1,
): SceneStateDto['absent'][number] => ({
  ref: { kind: id.startsWith('chr_') ? 'character' : 'entity', id },
  name,
  cause,
  sinceSeq,
});

export function sceneState(over: Partial<SceneStateDto> = {}): SceneStateDto {
  return {
    // `SceneId` is branded, and a fixture is the one place where a plain
    // string legitimately becomes one: the parser that would produce it is
    // not what this file is testing.
    sceneId: 'scn_1' as SceneStateDto['sceneId'],
    placeId: 'col_des_hurleurs',
    placeName: 'Le Col des Hurleurs',
    timeOfDay: 'fin d’après-midi',
    // SORTED BY `ref.id`, like the projection itself: both lists carry that
    // invariant (03-donnees.md section 3.5, property 2), and a fixture that
    // ignored it would make every « nothing changed » comparison lie.
    present: [
      scenePresence('chr_sejuani', 'Sejuani', 'debout'),
      scenePresence('ent_hreidar', HIDDEN_FROM_BRIEF, 'adossé au cairn nord'),
      scenePresence('ent_ulrun', 'Ulrun', 'assis contre le cairn'),
    ],
    absent: [sceneAbsence('ent_keld', 'Keld', 'mort'), sceneAbsence('ent_signy', 'Signy', 'parti')],
    updatedSeq: 40,
    ...over,
  };
}

export const actor = (over: Partial<SceneActor> & Pick<SceneActor, 'name'>): SceneActor => ({
  ref: { kind: 'entity', id: `ent_${over.name.toLowerCase()}` },
  isPlayerCharacter: false,
  isDead: false,
  placeId: 'col_des_hurleurs',
  ...over,
});

export function mergeState(over: Partial<SceneMergeState> = {}): SceneMergeState {
  return {
    actors: [
      actor({
        ref: { kind: 'character', id: 'chr_sejuani' },
        name: 'Sejuani',
        isPlayerCharacter: true,
      }),
      actor({
        ref: { kind: 'character', id: 'chr_braum' },
        name: 'Braum',
        isPlayerCharacter: true,
      }),
      actor({ name: 'Ulrun' }),
      actor({ name: 'Keld', isDead: true }),
      actor({ name: 'Signy', placeId: 'vallee_basse' }),
      actor({ name: 'Hreidar' }),
    ],
    placeIds: ['col_des_hurleurs', 'vallee_basse'],
    seq: 42,
    ...over,
  };
}

export const RESERVED = [
  { displayName: 'Lissandra', aliases: ['la Sorcière de Glace'] },
  { displayName: 'Ashe', aliases: ['la Reine du Gel'] },
];
