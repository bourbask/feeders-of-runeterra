/**
 * The three structured outputs: narration, chronicle (C1 → C9) and forge
 * (V1 → V12).
 *
 * All three share one property, and it is the one that keeps a table playable:
 * NOTHING HERE THROWS AND NOTHING HERE BLOCKS. A malformed scene block keeps
 * the previous state, a failed chronicle keeps the previous version in
 * service, a failed forge persists a `draft` and the player picks one of the
 * twenty handwritten champions. A failure of the AI layer costs prose, never a
 * turn.
 */

import { CHRONICLE_TOKEN_BUDGET, ForgeOutputSchema, type ChronicleDoc } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { buildChronicleRequest, renderChronicleParts } from '../src/chronicle/build.js';
import { buildChronicleCorrections, validateChronicle } from '../src/chronicle/validate.js';
import { buildForgeCorrections, buildForgeRequest } from '../src/forge/build.js';
import {
  ATTRIBUTE_CANONICAL,
  ATTRIBUTE_ORDER,
  FORGE_TEXT_BOUNDS,
  repairAttributes,
  truncateOnWord,
  validateForge,
  vowIsFalsifiable,
} from '../src/forge/validate.js';
import { readChronicleAnswer } from '../src/outputs/chronicle.js';
import { readForgeAnswer } from '../src/outputs/forge.js';
import { readNarration } from '../src/outputs/narration.js';
import { SCENE_CLOSE_TAG, SCENE_OPEN_TAG } from '../src/outputs/scene.js';
import { RESERVED, sceneAbsence, sceneState } from './fixtures.js';

// ---------------------------------------------------------------- narration

describe('la lecture d’une réponse de narration', () => {
  it('sépare la prose du bloc, et ne diffuse jamais le bloc', () => {
    const answer = `Tu passes. La glace cède.\n${SCENE_OPEN_TAG}{"presents":[{"nom":"Ulrun","etat":"debout"}]}${SCENE_CLOSE_TAG}`;
    const read = readNarration(answer);
    expect(read.output.prose).toBe('Tu passes. La glace cède.');
    expect(read.output.prose).not.toContain('scene_apres');
    expect(read.output.sceneBlock?.presents).toStrictEqual([{ nom: 'Ulrun', etat: 'debout' }]);
    expect(read.tags).toStrictEqual([]);
  });

  it('une réponse tronquée garde sa prose et perd son bloc', () => {
    const read = readNarration(`Tu passes.\n${SCENE_OPEN_TAG}{"presen`);
    expect(read.output.prose).toBe('Tu passes.');
    expect(read.output.sceneBlock).toBeNull();
    expect(read.tags).toStrictEqual(['scene_block_malformed']);
  });

  it('et la prose est bornée par la sécurité du contrat, pas par le style', () => {
    const read = readNarration('a'.repeat(5000));
    expect(read.proseTruncated).toBe(true);
    expect(read.output.prose).toHaveLength(4000);
  });

  it('un champion réservé dans le bloc coule le bloc, pas la prose', () => {
    const read = readNarration(
      `Tu passes.\n${SCENE_OPEN_TAG}{"presents":[{"nom":"Ashe","etat":""}]}${SCENE_CLOSE_TAG}`,
      RESERVED,
    );
    expect(read.output.prose).toBe('Tu passes.');
    expect(read.output.sceneBlock).toBeNull();
    expect(read.tags).toStrictEqual(['reserved_champion_leak']);
  });
});

// ----------------------------------------------------------------- chronicle

const doc = (over: Partial<ChronicleDoc> = {}): ChronicleDoc => ({
  premise: 'Un clan remonte vers le col avant la tempête.',
  arcs: [
    {
      id: 'arc_tempete',
      title: 'La tempête se lève',
      status: 'ouvert',
      summary: 'Le col se ferme.',
      last_event_seq: 30,
    },
    {
      id: 'arc_avarosa',
      title: 'La lame d’Avarosa',
      status: 'dormant',
      summary: 'Perdue sous la glace.',
      last_event_seq: 12,
    },
  ],
  characters: [
    {
      character_id: 'chr_sejuani',
      name: 'Sejuani',
      one_line: 'mène la battue',
      notable_deeds: ['a franchi la corniche'],
      current_burden: 'une paume ouverte',
    },
  ],
  npcs: [
    {
      npc_id: 'npc_keld',
      name: 'Keld',
      role: 'porteur',
      status: 'mort',
      stance: 'loyal jusqu’au bout',
      voice: 'rare',
      last_seen_place: 'col_des_hurleurs',
      last_event_seq: 28,
    },
  ],
  places: [
    {
      place_id: 'col_des_hurleurs',
      name: 'Le Col des Hurleurs',
      one_line: 'une passe étroite',
      state: 'battue par le vent',
    },
  ],
  facts: [
    {
      fact_id: 'fct_keld',
      statement: 'Keld est tombé sous la corniche.',
      entities: ['ent_keld'],
      event_seq: 28,
      superseded_by: null,
    },
    {
      fact_id: 'fct_offrande',
      statement: 'Le clan laisse une offrande avant de passer.',
      entities: ['ent_lointain'],
      event_seq: 4,
      superseded_by: null,
    },
  ],
  open_threads: [
    {
      thread_id: 'thr_dette',
      title: 'La dette de Signy',
      summary: 'Elle n’a pas rendu la corde.',
      opened_event_seq: 15,
      tied_to: 'ent_signy',
    },
  ],
  recent_digest: ['Le clan est monté au col.'],
  ...over,
});

const chronicleInput = (over: Partial<Parameters<typeof validateChronicle>[0]> = {}) => ({
  doc: doc(),
  previous: null,
  knownEventSeqs: new Set([4, 12, 15, 28, 30]),
  targetEventSeq: 40,
  reservedChampions: RESERVED,
  scene: sceneState(),
  rendered: 'chronique courte',
  ...over,
});

describe('la validation d’une chronique, C1 → C9', () => {
  it('une chronique conforme passe les neuf contrôles', () => {
    const result = validateChronicle(chronicleInput());
    expect(result.violations).toStrictEqual([]);
    expect(result.ok).toBe(true);
  });

  it('C1 : un document hors schéma s’arrête là, et nomme les chemins', () => {
    const result = validateChronicle(chronicleInput({ doc: { premise: 42 } }));
    expect(result.violations.map((violation) => violation.check)).toStrictEqual(['C1']);
    expect(result.doc).toBeNull();
  });

  it('C2 : une provenance inexistante ou future est refusée', () => {
    const inventedSeq = validateChronicle(
      chronicleInput({
        doc: doc({ facts: [{ ...doc().facts[0]!, event_seq: 999 }] }),
      }),
    );
    expect(inventedSeq.violations.map((violation) => violation.check)).toStrictEqual(['C2']);
    expect(inventedSeq.violations[0]?.offenders).toStrictEqual(['fct_keld']);
  });

  it('C3 : un énoncé réécrit à fact_id constant est refusé', () => {
    const result = validateChronicle(
      chronicleInput({
        previous: doc(),
        doc: doc({
          facts: [{ ...doc().facts[0]!, statement: 'Keld a survécu.' }, doc().facts[1]!],
        }),
      }),
    );
    expect(result.violations.map((violation) => violation.check)).toStrictEqual(['C3']);
  });

  it('C4 : un chiffre dans un champ texte est refusé', () => {
    const result = validateChronicle(
      chronicleInput({ doc: doc({ premise: 'Le clan a perdu 3 hommes.' }) }),
    );
    expect(result.violations.map((violation) => violation.check)).toContain('C4');
  });

  it('C5 : un champion réservé, alias compris, est refusé', () => {
    const result = validateChronicle(
      chronicleInput({ doc: doc({ premise: 'La Sorcière de Glace veille.' }) }),
    );
    expect(result.violations.map((violation) => violation.check)).toContain('C5');
  });

  it('C6 : un fait doré perdu fait échouer la CI, et seulement elle', () => {
    expect(
      validateChronicle(chronicleInput({ goldenFactIds: ['fct_keld'] })).violations,
    ).toStrictEqual([]);
    const lost = validateChronicle(chronicleInput({ goldenFactIds: ['fct_disparu'] }));
    expect(lost.violations.map((violation) => violation.check)).toStrictEqual(['C6']);
  });

  it('C7 : au-delà du budget, la chronique est signalée', () => {
    const big = validateChronicle(
      chronicleInput({ rendered: 'x'.repeat(CHRONICLE_TOKEN_BUDGET * 4) }),
    );
    expect(big.violations.map((violation) => violation.check)).toContain('C7');
    expect(big.tokenCount).toBeGreaterThan(CHRONICLE_TOKEN_BUDGET);
  });

  /**
   * C8 reads the document's text AS A WHOLE, so the fixture is wholly English:
   * an English premise buried in French fields dilutes the ratio and the check
   * stays green — which is how a language detector goes quiet.
   */
  it('C8 : un document en anglais est refusé', () => {
    const result = validateChronicle(
      chronicleInput({
        doc: doc({
          premise: 'The clan walks up to the pass and the storm comes with the night wind.',
          arcs: [],
          characters: [],
          npcs: [],
          places: [],
          facts: [],
          open_threads: [],
          recent_digest: ['The clan walked up into the pass with the wind and the snow.'],
        }),
      }),
    );
    expect(result.violations.map((violation) => violation.check)).toContain('C8');
  });

  /**
   * C9 IS THE PRECEDENCE RULE. `<scene>` beats `<chronique>`: an NPC the scene
   * holds dead cannot be alive in the chronicle. It is the server-side half of
   * the « Continuité » rule of the system prompt.
   */
  it('C9 : une chronique qui donne vivant un mort de la scène est refusée', () => {
    const result = validateChronicle(
      chronicleInput({ doc: doc({ npcs: [{ ...doc().npcs[0]!, status: 'vivant' }] }) }),
    );
    expect(result.violations.map((violation) => violation.check)).toStrictEqual(['C9']);
    expect(result.violations[0]?.offenders).toStrictEqual(['npc_keld']);
  });

  it('et C9 ne dit rien quand la scène ne donne personne pour mort', () => {
    const result = validateChronicle(
      chronicleInput({
        doc: doc({ npcs: [{ ...doc().npcs[0]!, status: 'vivant' }] }),
        scene: sceneState({ absent: [sceneAbsence('ent_signy', 'Signy', 'parti')] }),
      }),
    );
    expect(result.violations).toStrictEqual([]);
  });

  it('les corrections nomment le contrôle et les fautifs', () => {
    const result = validateChronicle(
      chronicleInput({ doc: doc({ npcs: [{ ...doc().npcs[0]!, status: 'vivant' }] }) }),
    );
    expect(buildChronicleCorrections(result.violations)).toContain('C9');
    expect(buildChronicleCorrections(result.violations)).toContain('npc_keld');
    expect(buildChronicleCorrections([])).toBe('');
  });

  /**
   * Three shapes, and the third is the one a coverage report finds: an object
   * whose braces BALANCE and whose content is not JSON. `{oups` never reaches
   * `JSON.parse` — the extractor rejects it first — so a test built only on
   * that input leaves the parse failure unexercised.
   */
  it('readChronicleAnswer ne lève jamais, même sur du bruit', () => {
    expect(readChronicleAnswer('pas de json ici', chronicleInput()).violations[0]?.detail).toBe(
      'aucun objet JSON dans la réponse',
    );
    expect(readChronicleAnswer('{oups', chronicleInput()).ok).toBe(false);
    expect(readChronicleAnswer('{premise: oui}', chronicleInput()).violations[0]?.detail).toBe(
      'JSON invalide',
    );
    expect(readChronicleAnswer(JSON.stringify(doc()), chronicleInput()).ok).toBe(true);
  });
});

describe('le rendu déterministe de la chronique', () => {
  it('rend les mêmes octets à document égal, quel que soit l’ordre reçu', () => {
    const scene = sceneState();
    const straight = renderChronicleParts(doc(), scene);
    const shuffled = renderChronicleParts(
      doc({ arcs: [...doc().arcs].reverse(), facts: [...doc().facts].reverse() }),
      scene,
    );
    expect(straight).toStrictEqual(shuffled);
  });

  /**
   * The seams T4 and T7 cut along are defined AGAINST THE SCENE. An NPC in the
   * scene and one outside land in different parts, which is what lets the
   * ladder drop the second without touching the first.
   */
  it('sépare ce que la scène porte de ce qu’elle ne porte pas', () => {
    const parts = renderChronicleParts(doc(), sceneState());
    expect(parts.sceneNpcs).toContain('Keld');
    expect(parts.otherNpcs).toBe('');
    expect(parts.openArcs).toContain('La tempête se lève');
    expect(parts.otherArcs).toContain('La lame d’Avarosa');
  });

  it('et une liste vide ne rend aucune section, jamais un titre orphelin', () => {
    const parts = renderChronicleParts(doc({ places: [], recent_digest: [] }), null);
    expect(parts.places).toBe('');
    expect(parts.recentDigest).toBe('');
  });

  it('la requête de compaction met les corrections dans le message utilisateur', () => {
    const request = buildChronicleRequest({
      requestId: 'chr_1',
      systemPrompt: 'SYSTEME',
      material: 'MATIERE',
      corrections: '<corrections>\n- C9\n</corrections>',
      maxOutputTokens: 2000,
    });
    expect(request.system[0]?.text).toBe('SYSTEME');
    const block = request.messages[0]?.content[0];
    expect(block?.type === 'text' ? block.text : '').toContain('<corrections>');
    expect(request.system.map((entry) => entry.text).join('')).not.toContain('<corrections>');
  });
});

// --------------------------------------------------------------------- forge

const sheet = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Hreidar',
  title: 'le porteur de cairn',
  origin: { regionId: 'freljord', homeText: 'Né sous le col, il a grandi contre le vent.' },
  pitch: 'Il porte ce que les autres laissent.',
  description:
    'Il a grandi contre le vent, à porter ce que les autres laissent derrière eux. ' +
    'Sa parole est rare et son dos est large. ' +
    'Quand le clan bouge, il ferme la marche et compte les siens. '.repeat(10),
  attributes: { vif: 1, coeur: 2, fer: 3, ombre: 1, esprit: 2 },
  startingGauges: { vigueur: 5, ame: 5, vivres: 5 },
  startingMomentum: 2,
  startingAssets: ['corde-de-crin', 'fourrure-de-drake', 'marque-de-cairn'],
  signatureAsset: {
    id: 'dos-large',
    name: 'Dos large',
    text: 'Il porte plus que sa part.',
    effects: [],
  },
  startingVow: {
    title: 'Ramener les siens',
    rank: 'redoutable',
    description: 'Ramener le corps de son frère jusqu’au cairn du clan.',
  },
  startingBonds: [],
  perceptionTraits: [],
  voice: {
    register: 'bas et lent',
    speechTics: [],
    forbidden: [],
    sampleLines: ['Avance.'],
  },
  loreHooks: ['Il connaît la passe par cœur.'],
  contentWarnings: [],
  tags: [],
  ...over,
});

const forgeInput = (over: Record<string, unknown> = {}) => ({
  requestedId: 'hreidar',
  canonicalRegionId: 'freljord',
  championNames: ['Ashe', 'Lissandra', 'Braum'],
  knownAssetIds: ['corde-de-crin', 'fourrure-de-drake', 'marque-de-cairn', 'atout-par-defaut'],
  defaultAssetIds: ['atout-par-defaut', 'corde-de-crin', 'fourrure-de-drake'],
  handwrittenSheetExists: false,
  ...over,
});

describe('la validation d’une fiche forgée, V1 → V12', () => {
  it('une fiche conforme passe, et le serveur écrit ses six champs', () => {
    const result = validateForge({ ...forgeInput(), raw: sheet() });
    expect(result.action).toBe('repaired');
    const written = result.sheet as Record<string, unknown>;
    expect(written['id']).toBe('hreidar');
    expect(written['source']).toBe('forged');
    expect(written['relations']).toStrictEqual([]);
    expect(written['schemaVersion']).toBe(1);
  });

  it('V10 : une fiche écrite à la main existante rejette, sans rien réparer', () => {
    const result = validateForge({
      ...forgeInput({ handwrittenSheetExists: true }),
      raw: sheet(),
    });
    expect(result).toStrictEqual({
      action: 'reject',
      findings: [{ check: 'V10', action: 'reject', detail: 'fiche écrite à la main existante' }],
      sheet: null,
    });
  });

  it('V2 : une région hors canon est imposée, et la réparation est consignée', () => {
    const result = validateForge({
      ...forgeInput(),
      raw: sheet({ origin: { regionId: 'ionia', homeText: 'ailleurs' } }),
    });
    expect(result.findings.some((finding) => finding.check === 'V2')).toBe(true);
    expect((result.sheet as { origin: { regionId: string } }).origin.regionId).toBe('freljord');
  });

  /**
   * V3, THE ONE THE CRITERION NAMES: `[3,3,2,1,1]` becomes `[3,2,2,1,1]`, ties
   * broken by `vif, coeur, fer, ombre, esprit`.
   */
  it('V3 : [3,3,2,1,1] devient [3,2,2,1,1], départagé par l’ordre fixe', () => {
    expect(repairAttributes({ vif: 3, coeur: 3, fer: 2, ombre: 1, esprit: 1 })).toStrictEqual({
      vif: 3,
      coeur: 2,
      fer: 2,
      ombre: 1,
      esprit: 1,
    });
  });

  it('V3 : l’égalité totale se départage par vif, coeur, fer, ombre, esprit', () => {
    expect(repairAttributes({ vif: 2, coeur: 2, fer: 2, ombre: 2, esprit: 2 })).toStrictEqual({
      vif: 3,
      coeur: 2,
      fer: 2,
      ombre: 1,
      esprit: 1,
    });
  });

  it('V3 : la réparation est déterministe, et laisse une répartition légale', () => {
    const repaired = repairAttributes({ vif: 3, coeur: 3, fer: 3, ombre: 3, esprit: 1 });
    expect(repairAttributes({ vif: 3, coeur: 3, fer: 3, ombre: 3, esprit: 1 })).toStrictEqual(
      repaired,
    );
    expect(
      ATTRIBUTE_ORDER.map((name) => repaired[name]).sort((left, right) => right - left),
    ).toStrictEqual([...ATTRIBUTE_CANONICAL]);
  });

  it('V3 : et une fiche mal répartie est réparée de bout en bout', () => {
    const result = validateForge({
      ...forgeInput(),
      raw: sheet({ attributes: { vif: 3, coeur: 3, fer: 2, ombre: 1, esprit: 1 } }),
    });
    expect(result.findings.some((finding) => finding.check === 'V3')).toBe(true);
    expect((result.sheet as { attributes: Record<string, number> }).attributes).toStrictEqual({
      vif: 3,
      coeur: 2,
      fer: 2,
      ombre: 1,
      esprit: 1,
    });
  });

  it('V4 : la troncature coupe à la frontière de mot', () => {
    expect(truncateOnWord('le vent froid du col', 12)).toBe('le vent');
    expect(truncateOnWord('court', 12)).toBe('court');
  });

  /**
   * ── THE TEST ABOVE EXERCISES THE HELPER, NOT THE RULE ─────────────────
   * `ForgeOutputSchema` keeps `pitch.max(280)`, so for as long as the
   * truncation lived BELOW the entry parse, an over-long pitch came back
   * as `retry` and the branch was unreachable: deleting it whole left 340
   * tests green. The three tests below go through `validateForge`, which
   * is where section 9.5 puts the rule.
   *
   * The bound is written out in full letters — 280 is a criterion of
   * section 9.5, and a criterion's number is never read from `src/` by the
   * test that checks it (ADR 0007).
   */
  it('V4 : un pitch trop long est tronqué par la validation, jamais renvoyé en relance', () => {
    const tail = 'porte ce que les autres laissent derrière eux sans se plaindre du poids. ';
    const long = `Il ${tail.repeat(6)}`;
    expect(long.length).toBeGreaterThan(280);
    const result = validateForge({ ...forgeInput(), raw: sheet({ pitch: long }) });
    expect(result.action).toBe('repaired');
    expect(result.findings).toContainEqual({
      check: 'V4',
      action: 'repaired',
      detail: 'pitch tronqué',
    });
    const written = (result.sheet as { pitch: string }).pitch;
    expect(written).toBe(long.slice(0, long.lastIndexOf(' ', 280)).trimEnd());
    expect(written.length).toBeLessThanOrEqual(280);
    // And the cut landed on a word boundary rather than mid-word.
    expect(long.startsWith(`${written} `)).toBe(true);
  });

  it('V4 : et une troncature qui laisse moins de 40 % de la borne demande une relance', () => {
    // One word of fifty characters, then one very long one: the cut at the
    // last space keeps fifty, which is under 40 % of 280 — that is 112.
    const stunted = `${'a'.repeat(50)} ${'b'.repeat(260)}`;
    const result = validateForge({ ...forgeInput(), raw: sheet({ pitch: stunted }) });
    expect(result.action).toBe('retry');
    expect(result.findings).toContainEqual({
      check: 'V4',
      action: 'retry',
      detail: 'pitch trop court après réparation',
    });
  });

  /**
   * The bounds are written in `forge/validate.ts` AND in `ChampionSchema`,
   * in two places. This pins them together: truncating to a length the
   * entry parse still refuses would put V4 straight back into dead code.
   */
  it('V4 : les bornes de la validation sont celles du schéma', () => {
    expect(Object.keys(FORGE_TEXT_BOUNDS).sort()).toStrictEqual(['description', 'pitch']);
    for (const [field, bound] of Object.entries(FORGE_TEXT_BOUNDS)) {
      expect({
        field,
        aLaBorne: ForgeOutputSchema.safeParse(sheet({ [field]: 'a'.repeat(bound) })).success,
        unDePlus: ForgeOutputSchema.safeParse(sheet({ [field]: 'a'.repeat(bound + 1) })).success,
      }).toStrictEqual({ field, aLaBorne: true, unDePlus: false });
    }
  });

  it('V5 : une phrase avec un chiffre ou un terme de règle est retirée', () => {
    const result = validateForge({
      ...forgeInput(),
      raw: sheet({
        pitch: 'Il porte ce que les autres laissent. Sa vigueur ne baisse jamais.',
      }),
    });
    expect(result.findings.some((finding) => finding.check === 'V5')).toBe(true);
  });

  it('V6 : moins de trois atouts après dédoublonnage demande une relance', () => {
    const result = validateForge({
      ...forgeInput(),
      raw: sheet({ startingAssets: ['corde-de-crin', 'corde-de-crin'] }),
    });
    expect(result.action).toBe('retry');
    expect(result.findings.some((finding) => finding.check === 'V6')).toBe(true);
  });

  it('V7 : un autre champion de Runeterra nommé demande une relance', () => {
    const result = validateForge({
      ...forgeInput(),
      raw: sheet({ pitch: 'Il a servi Ashe avant la tempête.' }),
    });
    expect(result.action).toBe('retry');
    expect(result.findings.some((finding) => finding.check === 'V7')).toBe(true);
  });

  it('V8 : une description en anglais demande une relance', () => {
    const result = validateForge({
      ...forgeInput(),
      raw: sheet({
        description:
          'He grew up against the wind and he carries what the others leave behind him. '.repeat(
            12,
          ),
      }),
    });
    expect(result.findings.some((finding) => finding.check === 'V8')).toBe(true);
  });

  it('V9 : un serment sans objectif vérifiable demande une relance', () => {
    expect(vowIsFalsifiable('Ramener le corps de son frère jusqu’au cairn du clan.')).toBe(true);
    expect(vowIsFalsifiable('Être meilleur.')).toBe(false);
    const result = validateForge({
      ...forgeInput(),
      raw: sheet({
        startingVow: { title: 'Grandir', rank: 'redoutable', description: 'Être meilleur.' },
      }),
    });
    expect(result.action).toBe('retry');
    expect(result.findings.some((finding) => finding.check === 'V9')).toBe(true);
  });

  it('V11 : un atout inconnu est remplacé par le jeu par défaut', () => {
    const result = validateForge({
      ...forgeInput(),
      raw: sheet({ startingAssets: ['atout-inconnu', 'corde-de-crin', 'fourrure-de-drake'] }),
    });
    expect(result.findings.some((finding) => finding.check === 'V11')).toBe(true);
    expect((result.sheet as { startingAssets: string[] }).startingAssets).toStrictEqual([
      'atout-par-defaut',
      'corde-de-crin',
      'fourrure-de-drake',
    ]);
  });

  it('V12 : la porte finale est ChampionSchema, et aucune fiche ne l’esquive', () => {
    const result = validateForge({ ...forgeInput(), raw: sheet() });
    expect(
      result.findings.some((finding) => finding.check === 'V12' && finding.action === 'ok'),
    ).toBe(true);
    // `loreHooks: []` is refused by the ENTRY parse. It never reaches the
    // final gate, and the wording now says which of the two spoke.
    const entry = validateForge({ ...forgeInput(), raw: sheet({ loreHooks: [] }) });
    expect(entry).toStrictEqual({
      action: 'retry',
      findings: [
        {
          check: 'V12',
          action: 'retry',
          detail: 'sortie du modèle hors ForgeOutputSchema : loreHooks',
        },
      ],
      sheet: null,
    });
  });

  /**
   * ── THE GATE NOTHING WAS WATCHING ─────────────────────────────────────
   * Neutralising the LAST `safeParse` left 340 tests green: the only
   * negative case above goes through the entry parse and stops there. Yet
   * the final gate is the only one that sees the six fields the SERVER
   * writes itself — `id`, `source`, `relations`, `aliases`,
   * `schemaVersion` — which the model never saw and no earlier check
   * looks at. Without it a non-conforming sheet comes back out
   * `repaired`, typed `Champion`, and everything downstream believes it.
   *
   * `requestedId` is one of those six. A slug `SlugSchema` refuses
   * therefore reaches the final gate and nothing else, which is what the
   * exact findings array below states.
   */
  it('V12 : la porte FINALE refuse la fiche complétée, et son refus n’est pas celui de l’entrée', () => {
    const result = validateForge({
      ...forgeInput({ requestedId: 'ID INVALIDE !!' }),
      raw: sheet(),
    });
    expect(result).toStrictEqual({
      action: 'retry',
      findings: [
        { check: 'V1', action: 'repaired', detail: 'id imposé : ID INVALIDE !!' },
        { check: 'V12', action: 'retry', detail: 'fiche complétée hors ChampionSchema : id' },
      ],
      sheet: null,
    });
    // V1 is in the list: the entry parse PASSED, so the gate that spoke is
    // the last one. A list of length one would mean the opposite.
    expect(result.findings.at(-1)?.check).toBe('V12');
  });

  it('readForgeAnswer extrait le JSON d’une réponse bavarde, et ne lève jamais', () => {
    const chatty = `Voici la fiche :\n${JSON.stringify(sheet())}\nVoilà.`;
    expect(readForgeAnswer(chatty, forgeInput()).action).toBe('repaired');
    expect(readForgeAnswer('aucun json', forgeInput()).findings[0]?.detail).toBe(
      'aucun objet JSON dans la réponse',
    );
    expect(readForgeAnswer('{cassé', forgeInput()).action).toBe('retry');
    // Balanced braces, invalid JSON: the only input that reaches `JSON.parse`.
    expect(readForgeAnswer('{name: Hreidar}', forgeInput()).findings[0]?.detail).toBe(
      'JSON invalide',
    );
  });

  it('la requête de forge porte les atouts autorisés et ses corrections', () => {
    const request = buildForgeRequest({
      requestId: 'frg_1',
      systemPrompt: 'SYSTEME',
      brief: 'BRIEF',
      allowedAssetIds: ['corde-de-crin'],
      corrections: buildForgeCorrections([{ check: 'V3', detail: 'répartition' }]),
      maxOutputTokens: 1800,
    });
    const block = request.messages[0]?.content[0];
    const text = block?.type === 'text' ? block.text : '';
    expect(text).toContain('corde-de-crin');
    expect(text).toContain('V3');
    expect(request.schemaName).toBe('fiche_de_champion');
  });

  it('et sans correction, le message utilisateur n’en porte pas de bloc vide', () => {
    const request = buildForgeRequest({
      requestId: 'frg_2',
      systemPrompt: 'S',
      brief: 'B',
      allowedAssetIds: [],
      maxOutputTokens: 100,
    });
    const block = request.messages[0]?.content[0];
    expect(block?.type === 'text' ? block.text : '').not.toContain('<corrections>');
  });
});
