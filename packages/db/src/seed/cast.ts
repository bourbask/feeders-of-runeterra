/**
 * Who is at the table, what they play, and the fixed identifiers everything
 * else hangs from.
 *
 * ── A DIVERGENCE BETWEEN THE SPEC AND THE DELIVERED SHEETS, REPORTED ─────
 * 03-donnees.md section 7.1 describes the three characters as « Braum (fer 3),
 * Ashe (vif 3), Sejuani (cœur 3) ». The hand-written sheets M0-16 delivered say
 * something else: Braum is `coeur 3`, Ashe is `vif 3`, Sejuani is `fer 3`. The
 * SHEET wins here — `character.created` freezes the sheet, and a seed that
 * contradicted it would hand the eval harness a character no content file
 * describes. Two of the three lines of that table need correcting; that is an
 * ADR, not a seed edit.
 *
 * ── WHY THERE ARE FIVE CHARACTERS AND THREE OF THEM PLAY ─────────────────
 * The catalogue holds `character.died`, `character.retired`,
 * `character.renamed`, `character.sheet_rebound` and
 * `character.attributes_corrected`, and the seed must carry one of each. None
 * of them may land on Braum, Ashe or Sejuani: they are the three the project
 * owner and his friends open the application to see, and a demo that greets
 * them with a dead Braum is a demo that failed.
 *
 * So the campaign owner — who plays as well as owns — had TWO characters
 * before the pact was sworn: Olaf, who died at the Porte Basse, and Udyr, who
 * turned back north at the end of the first session. Both carry a FORGED sheet,
 * which is where a repair, a rebinding and an attribute correction belong in
 * real life. What is left at the end is exactly what section 7.1 asks for:
 * three active characters, three `reserved_pc` locks, and six `allowed_npc`
 * — Olaf and Udyr among them, their locks released as they left play.
 */

import type { AttributeId, GaugeId } from '@for/engine';

/** Discord identities: fake, consecutive, and never a real snowflake. */
export const DEMO_DISCORD_BASE = 900_000_000_000_000_001n;

export interface DemoPlayer {
  /** The handle section 7.1 names. Discord username, not the identifier. */
  readonly handle: string;
  readonly displayName: string;
}

/** In mint order: the owner first, then the three players of the trio. */
export const DEMO_PLAYERS = [
  { handle: 'demo-mj', displayName: 'Kévin' },
  { handle: 'demo-braum', displayName: 'Théo' },
  { handle: 'demo-ashe', displayName: 'Maëlle' },
  { handle: 'demo-sejuani', displayName: 'Anouk' },
] as const satisfies readonly DemoPlayer[];

export type DemoPlayerHandle = (typeof DEMO_PLAYERS)[number]['handle'];

export interface DemoCharacter {
  readonly key: string;
  readonly championId: string;
  readonly displayName: string;
  readonly player: DemoPlayerHandle;
  readonly sheetSource: 'handwritten' | 'forged';
  readonly attributes: Readonly<Record<AttributeId, number>>;
  readonly gauges: Readonly<Record<GaugeId, number>>;
  readonly momentum: number;
}

/** The three hand-written sheets, read straight off `content/champions/`. */
export const TRIO = ['braum', 'ashe', 'sejuani'] as const;

/** Champions the table allows the storyteller to use, once nobody plays them. */
export const ALLOWED_NPC_CHAMPIONS = [
  'lissandra',
  'volibear',
  'trundle',
  'gragas',
  'olaf',
  'udyr',
] as const;

/** The two forged sheets, written by hand here because no forge ran. */
export const FORGED_SHEETS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  olaf: {
    schemaVersion: 1,
    id: 'olaf',
    name: 'Olaf',
    title: 'Le Berserker',
    pitch: "Il court vers ce qui devrait le tuer, et il n'a jamais compris pourquoi ça choque.",
    origin: {
      regionId: 'ice-reaches',
      homeText: "Un village de pêcheurs de glace qui l'a laissé partir sans discuter.",
    },
    voice: {
      register: 'direct',
      tics: ['il rit avant de frapper', 'il ne dit jamais « peut-être »'],
    },
  },
  udyr: {
    schemaVersion: 1,
    id: 'udyr',
    name: 'Udyr',
    title: "L'Esprit-Marcheur",
    pitch: 'Quatre bêtes vivent sous sa peau, et aucune ne parle la même langue.',
    origin: {
      regionId: 'freljord',
      homeText: "Les Sentiers de l'Éveil, où l'on n'arrive jamais par hasard.",
    },
    voice: {
      register: 'sobre',
      tics: ['il répond par un geste', 'il nomme les bêtes avant les gens'],
    },
  },
};

/** What the demo journal says of each character at creation. */
export const DEMO_CHARACTERS: readonly DemoCharacter[] = [
  {
    key: 'braum',
    championId: 'braum',
    displayName: 'Braum',
    player: 'demo-braum',
    sheetSource: 'handwritten',
    attributes: { vif: 1, coeur: 3, fer: 2, ombre: 1, esprit: 2 },
    gauges: { vigueur: 5, ame: 5, vivres: 5 },
    momentum: 2,
  },
  {
    key: 'ashe',
    championId: 'ashe',
    displayName: 'Ashe',
    player: 'demo-ashe',
    sheetSource: 'handwritten',
    attributes: { vif: 3, coeur: 2, fer: 1, ombre: 1, esprit: 2 },
    gauges: { vigueur: 5, ame: 5, vivres: 5 },
    momentum: 2,
  },
  {
    key: 'sejuani',
    championId: 'sejuani',
    displayName: 'Sejuani',
    player: 'demo-sejuani',
    sheetSource: 'handwritten',
    attributes: { vif: 2, coeur: 1, fer: 3, ombre: 2, esprit: 1 },
    gauges: { vigueur: 5, ame: 5, vivres: 5 },
    momentum: 2,
  },
  {
    key: 'olaf',
    championId: 'olaf',
    displayName: 'Olaf',
    player: 'demo-mj',
    sheetSource: 'forged',
    attributes: { vif: 2, coeur: 1, fer: 3, ombre: 1, esprit: 2 },
    gauges: { vigueur: 5, ame: 5, vivres: 5 },
    momentum: 2,
  },
  {
    key: 'udyr',
    championId: 'udyr',
    displayName: 'Udyr',
    player: 'demo-mj',
    sheetSource: 'forged',
    attributes: { vif: 2, coeur: 2, fer: 3, ombre: 1, esprit: 1 },
    gauges: { vigueur: 5, ame: 5, vivres: 5 },
    /**
     * NEGATIVE, AND THAT IS THE WHOLE POINT. The forge gave this sheet a
     * starting momentum below zero and nobody caught it before the first roll.
     * It is the only state in which the rules can cancel an action die, and no
     * effect in `content/` ever drives momentum below zero — so without this
     * defect `character.momentum_negated` would be unreachable and the seed
     * would have to fake it. `character.sheet_rebound` repairs the sheet a few
     * beats later, which is what a repaired forge output looks like.
     */
    momentum: -5,
  },
] satisfies readonly DemoCharacter[];

export interface DemoEntity {
  readonly key: string;
  readonly kind: 'npc' | 'place' | 'faction' | 'thread';
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly regionId?: string | undefined;
  readonly championId?: string | undefined;
  readonly disposition?: 'allie' | 'neutre' | 'hostile' | 'inconnu' | undefined;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * Eleven entities — four people, three places, two factions, two threads —
 * exactly the count section 7.1 fixes.
 */
export const DEMO_ENTITIES: readonly DemoEntity[] = [
  {
    key: 'porte-basse',
    kind: 'place',
    slug: 'la-porte-basse',
    name: 'La Porte Basse',
    summary: "Un col si étroit qu'on y passe un chariot à la fois, et jamais deux de front.",
    regionId: 'rakelstake',
    details: { accès: 'un seul chariot à la fois', risque: 'la neige ferme le col en une nuit' },
  },
  {
    key: 'keld',
    kind: 'npc',
    slug: 'keld-le-tanneur',
    name: 'Keld le Tanneur',
    summary:
      'Il tient le relais de la Porte Basse depuis vingt hivers et connaît toutes les dettes.',
    regionId: 'rakelstake',
    disposition: 'neutre',
    details: { métier: 'tanneur', dette: 'trois peaux dues à Yrsa' },
  },
  {
    key: 'veilleurs',
    kind: 'faction',
    slug: 'les-veilleurs-de-la-tombe',
    name: 'Les Veilleurs de la Tombe',
    summary: "Ils attendent depuis si longtemps qu'ils ont oublié quoi.",
    details: { effectif: 'une vingtaine', signe: 'une bande de cuir bleue au poignet' },
  },
  {
    key: 'gue-bas',
    kind: 'place',
    slug: 'le-gue-bas',
    name: 'Le Gué Bas',
    summary: 'Trois maisons, un grenier commun, et une rivière qui gèle trop tard.',
    regionId: 'avarosa-reach',
    details: { feux: 3, grenier: 'commun, et presque vide' },
  },
  {
    key: 'yrsa',
    kind: 'npc',
    slug: 'yrsa-du-gue-bas',
    name: 'Yrsa du Gué Bas',
    summary: "Elle compte le grain et n'a jamais entendu parler de tout ça.",
    regionId: 'avarosa-reach',
    disposition: 'allie',
    details: { charge: 'le grenier commun', secret: 'elle sait lire' },
  },
  {
    key: 'tombe-basse',
    kind: 'place',
    slug: 'la-tombe-basse',
    name: 'La Tombe Basse',
    summary: 'Sous trois mètres de glace, et personne ne creuse.',
    regionId: 'avarosa-reach',
    details: { profondeur: 'trois mètres de glace', gardée: true },
  },
  {
    key: 'griffe-hiver',
    kind: 'faction',
    slug: 'la-griffe-d-hiver',
    name: "La Griffe d'Hiver",
    summary: "La horde de Sejuani, qui prend ce qu'on ne lui donne pas.",
    disposition: 'neutre',
    details: { chef: 'Sejuani', usage: 'le tribut plutôt que le grenier' },
  },
  {
    key: 'sigrid',
    kind: 'npc',
    slug: 'sigrid-la-passeuse',
    name: 'Sigrid la Passeuse',
    summary: 'Elle fait traverser ceux qui paient, et se souvient de ceux qui ne paient pas.',
    regionId: 'rakelstake',
    disposition: 'inconnu',
    details: { tarif: 'deux peaux, ou un service' },
  },
  {
    key: 'olaf-npc',
    kind: 'npc',
    slug: 'olaf-le-revenant',
    name: 'Olaf',
    summary: "Ce qu'on raconte de lui à la Porte Basse depuis qu'il n'en est pas ressorti.",
    championId: 'olaf',
    disposition: 'inconnu',
    details: { statut: 'mort à la Porte Basse', rumeur: 'on jure l’avoir revu au nord' },
  },
  {
    key: 'fil-pacte',
    kind: 'thread',
    slug: 'le-pacte-de-la-griffe-de-givre',
    name: 'Le Pacte de la Griffe-de-Givre',
    summary: 'Ce que trois clans acceptent de se devoir avant que la Porte Basse se referme.',
    details: { parties: ['Rakelstake', 'le Gué Bas', "la Griffe d'Hiver"] },
  },
  {
    key: 'fil-tombe',
    kind: 'thread',
    slug: 'qui-a-ouvert-la-tombe',
    name: 'Qui a ouvert la tombe ?',
    summary: "Quelqu'un a creusé avant eux, et a refermé derrière lui.",
    details: { indice: 'des outils laissés sur place, propres' },
  },
] satisfies readonly DemoEntity[];

/** The three truths the table chose, from `content/truths/freljord-truths.json`. */
export const DEMO_TRUTHS = [
  { truthId: 'truth-avarosa', optionId: 'une-tombe-gardee' },
  { truthId: 'truth-le-grain', optionId: 'par-le-grenier-commun' },
  {
    truthId: 'truth-les-serments',
    optionId: 'le-temps-d-un-hiver',
    customText: 'Et on rallume le serment au premier feu du printemps, ou on le laisse mourir.',
  },
] as const;
