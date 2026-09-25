/**
 * The storyteller's system prompt must stay BIG.
 *
 * ── WHY A FLOOR AND NOT A CEILING ───────────────────────────────────────────
 * Providers that cache only cache a MINIMUM PREFIX — 512 to 4 096 tokens
 * depending on the model (section 4.2). A prompt that shrinks below it stops
 * being cached, everywhere, silently, and the bill goes up by a factor of two
 * and a half. And the heaviest piece of the text is the `MAUVAIS:` / `BON:`
 * pair, which is also the most effective one and the first a well-meaning
 * simplification would delete (ARCHITECTURE.md risk 2).
 *
 * ── HOW IT IS MEASURED, AND WHY NOT EXACTLY ─────────────────────────────────
 * An exact count is a network call, and a blocking pull-request test never
 * calls a provider (section 4.2). So: the local estimator of section 4.3, plus
 * a COMMITTED REFERENCE. The nightly workflow, which has a key, is what
 * compares the estimator to the real count.
 *
 * ── THE TWO ASSERTIONS DO DIFFERENT JOBS, ON PURPOSE ────────────────────────
 * The floor of 1 900 comes from an acceptance criterion, so it is written here
 * in full letters and never read from `src/`. But measured against the text as
 * written it is a LOOSE floor — see the pull request, where the figures are
 * given: removing a third of the prompt does not reach it. What actually
 * catches an amputation is the reference: at eight per cent of tolerance, a
 * third of the text gone is a red test naming the drift. Both are kept, and
 * the weaker one is not presented as the guard.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CHRONICLE_PROMPT_VERSION,
  CHRONICLE_SYSTEM_PROMPT,
} from '../src/prompts/chronicle.system.js';
import { buildCampaignBlock } from '../src/prompts/conteur.campaign.js';
import { CONTEUR_PROMPT_VERSION, CONTEUR_SYSTEM_PROMPT } from '../src/prompts/conteur.system.js';
import { estimateTokens } from '../src/prompts/estimate.js';
import { FORGE_PROMPT_VERSION, FORGE_SYSTEM_PROMPT } from '../src/prompts/forge.system.js';

/** Section 4.2, in full letters. Never imported from `src/`. */
const FLOOR_TOKENS = 1900;

/** Section 4.3's stated tolerance on the local estimator. */
const REFERENCE_TOLERANCE_PCT = 8;

interface Reference {
  readonly promptVersion: string;
  readonly estimatedTokens: number;
  readonly chars: number;
  readonly recordedAt: string;
}

const reference = JSON.parse(
  readFileSync(new URL('./prompt-size.reference.json', import.meta.url), 'utf8'),
) as Reference;

describe('la taille du prompt système du Conteur', () => {
  it('reste au-dessus du plancher de 1 900 tokens', () => {
    expect(estimateTokens(CONTEUR_SYSTEM_PROMPT)).toBeGreaterThanOrEqual(FLOOR_TOKENS);
  });

  it('correspond à la référence commitée, à huit pour cent près', () => {
    const measured = estimateTokens(CONTEUR_SYSTEM_PROMPT);
    const drift = Math.abs(measured - reference.estimatedTokens) / reference.estimatedTokens;
    expect(drift * 100).toBeLessThanOrEqual(REFERENCE_TOLERANCE_PCT);
  });

  it('et la référence porte la version qu’elle a mesurée', () => {
    expect(reference.promptVersion).toBe(CONTEUR_PROMPT_VERSION);
  });

  it('rougit si l’on en retire un tiers — mesuré ici, pas supposé', () => {
    const amputated = CONTEUR_SYSTEM_PROMPT.slice(
      0,
      Math.floor((CONTEUR_SYSTEM_PROMPT.length * 2) / 3),
    );
    const measured = estimateTokens(amputated);
    const drift = Math.abs(measured - reference.estimatedTokens) / reference.estimatedTokens;
    expect(drift * 100).toBeGreaterThan(REFERENCE_TOLERANCE_PCT);
  });
});

describe('ce que le prompt doit contenir, et qu’une réécriture jetterait', () => {
  it('porte la paire d’exemples du §2.1', () => {
    expect(CONTEUR_SYSTEM_PROMPT).toContain('MAUVAIS :');
    expect(CONTEUR_SYSTEM_PROMPT).toContain('BON :');
    expect(CONTEUR_SYSTEM_PROMPT).toContain('Écris toujours comme le second exemple.');
  });

  /**
   * The prompt's blacklist and the `banned_style_lexicon` assertion of section
   * 8.4 are meant to be the same list seen twice — once as an instruction,
   * once as a production post-filter. A term the filter rejects and the prompt
   * never names is a refusal the model was never warned about, and one
   * refusal is one engine fallback a player sees.
   *
   * ── SEARCHED ON A WORD BOUNDARY, AND THAT IS NOT A DETAIL ─────────────────
   * A plain `includes` reports `paraissent` as present because the prompt
   * writes `n'apparaissent`. Written that way this test was green on a term
   * the prompt does not carry, which is the shape of an assertion that guards
   * nothing. Section 8.4 says the assertion matches on a word boundary; so
   * does this.
   *
   * ── THREE TERMS ARE MISSING, AND THEY ARE NAMED ───────────────────────────
   * `semblent`, `semblaient` and `paraissent`: the prompt's rule lists four
   * verb forms where the assertion lists seven. It is a gap in the
   * SPECIFICATION, not in this file — the prompt text of section 2.1 is
   * verbatim and frozen, and widening it would be a `conteur/2.0.0` rewrite
   * nobody asked for. So the gap is pinned here rather than hidden: a fourth
   * missing term fails this test, and the day the prompt gains the three, the
   * list below has to shrink deliberately. Flagged in the pull request.
   */
  it('nomme les termes de banned_style_lexicon, aux trois près qui manquent', () => {
    const banned = [
      'semble',
      'semblent',
      'semblait',
      'semblaient',
      'paraît',
      'paraissent',
      'paraissait',
      'une sorte de',
      'une espèce de',
      'comme si',
      'quelque chose de',
      "quelque chose d'",
      'mystérieux',
      'mystérieuse',
      'mystère',
      'étrange',
      'étrangement',
      'indéchiffrable',
      'indicible',
      'insondable',
      'palpable',
      'oppressant',
      'oppressante',
    ];
    /** What section 2.1's rule does not carry, measured. */
    const KNOWN_GAP = ['semblent', 'semblaient', 'paraissent'];

    const onWordBoundary = (term: string): boolean =>
      new RegExp(
        `(?<![\\p{L}])${term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}])`,
        'u',
      ).test(CONTEUR_SYSTEM_PROMPT);

    const missing = banned.filter((term) => !onWordBoundary(term));
    expect(missing).toStrictEqual(KNOWN_GAP);
  });

  it('porte la règle 6 — le prix imposé (P10)', () => {
    expect(CONTEUR_SYSTEM_PROMPT).toContain('Prix imposé');
    expect(CONTEUR_SYSTEM_PROMPT).toContain("il n'est pas négociable");
    expect(CONTEUR_SYSTEM_PROMPT).toContain('sans en offrir le choix à qui que ce soit');
  });

  it('porte la règle 7 — aucun saut de temps (P11)', () => {
    expect(CONTEUR_SYSTEM_PROMPT).toContain('Tu ne fais jamais passer le temps de toi-même');
    expect(CONTEUR_SYSTEM_PROMPT).toContain(
      "jamais de ta narration ni d'un changement de lieu que tu proposes",
    );
  });

  it('porte l’ancrage de registre, le droit de refus et le bloc de fin', () => {
    expect(CONTEUR_SYSTEM_PROMPT).toContain('Écris comme une saga islandaise');
    expect(CONTEUR_SYSTEM_PROMPT).toContain('Quand une action est impossible');
    expect(CONTEUR_SYSTEM_PROMPT).toContain('<scene_apres>');
    expect(CONTEUR_SYSTEM_PROMPT).toContain('Les faits de scène');
  });

  it('et sa version est bien conteur/2.0.0', () => {
    expect(CONTEUR_PROMPT_VERSION).toBe('conteur/2.0.0');
  });
});

/**
 * The campaign block, `system[1]`.
 *
 * Two things are asserted, and the second is the one that costs money: the
 * reserved list is the prompt side of the distribution lock, and the rendering
 * is DETERMINISTIC. At equal data the bytes must be equal, or the cached
 * prefix of the campaign moves for nothing — and it is exactly the kind of
 * property that quietly stops holding the day somebody inserts a player in the
 * middle of the list.
 */
describe('le bloc de campagne', () => {
  const campaign = {
    name: 'Le Col des Hurleurs',
    tone: 'âpre',
    houseRules: null,
    characters: [
      {
        id: 'chr_sejuani',
        name: 'Sejuani',
        championDisplayName: 'Sejuani',
        pronouns: 'elle',
        oneLine: 'mène la battue',
      },
      {
        id: 'chr_braum',
        name: 'Braum',
        championDisplayName: 'Braum',
        pronouns: 'il',
        oneLine: 'porte la porte',
      },
    ],
    reservedChampions: [
      { id: 'lissandra', displayName: 'Lissandra', aliases: ['la Sorcière de Glace'] },
      { id: 'ashe', displayName: 'Ashe', aliases: ['la Reine du Gel', 'Frost Archer'] },
    ],
    allowedNpcs: [{ id: 'npc_ulrun', name: 'Ulrun', role: 'éclaireur', oneLine: 'méfiant' }],
  };

  it('rend les listes triées par identifiant, quel que soit l’ordre reçu', () => {
    const direct = buildCampaignBlock(campaign);
    const shuffled = buildCampaignBlock({
      ...campaign,
      characters: [...campaign.characters].reverse(),
      reservedChampions: [...campaign.reservedChampions].reverse(),
    });
    expect(direct).toBe(shuffled);
    expect(direct.indexOf('- Braum (Braum')).toBeLessThan(direct.indexOf('- Sejuani (Sejuani'));
    expect(direct.indexOf('- Ashe (également')).toBeLessThan(direct.indexOf('- Lissandra ('));
  });

  it('nomme chaque champion réservé avec ses alias', () => {
    const block = buildCampaignBlock(campaign);
    expect(block).toContain('- Ashe (également : la Reine du Gel, Frost Archer)');
    expect(block).toContain('- Lissandra (également : la Sorcière de Glace)');
  });

  it('rend « aucune » quand il n’y a pas de règle maison, et une ligne pour une liste vide', () => {
    const block = buildCampaignBlock({
      ...campaign,
      houseRules: null,
      reservedChampions: [],
    });
    expect(block).toContain('Règles maison : aucune');
    expect(block).toContain('ni sous aucun de leurs surnoms :\n\n- aucun');
  });

  it('renvoie à propose_npc_introduce pour tout nom hors liste', () => {
    expect(buildCampaignBlock(campaign)).toContain(
      'Pour tout personnage nommé qui ne figure pas dans cette liste, passe par propose_npc_introduce.',
    );
  });
});

/**
 * The two other frozen prompts. Their versions are read by the recording
 * format of section 8.5 and by the chronicle validation of section 5.6, so a
 * silent bump would invalidate comparisons nobody re-ran.
 */
describe('les prompts de la chronique et de la forge', () => {
  it('portent leur version', () => {
    expect(CHRONICLE_PROMPT_VERSION).toBe('chronicle/1.0.0');
    expect(FORGE_PROMPT_VERSION).toBe('forge/1.0.0');
  });

  it('portent les règles qui tiennent l’invariant 2 — provenance et immuabilité', () => {
    expect(CHRONICLE_SYSTEM_PROMPT).toContain(
      "doit porter le numéro de séquence de l'événement qui l'établit",
    );
    expect(CHRONICLE_SYSTEM_PROMPT).toContain('recopié mot pour mot');
    expect(CHRONICLE_SYSTEM_PROMPT).toContain('superseded_by');
    expect(CHRONICLE_SYSTEM_PROMPT).toContain("Tu n'écris aucun chiffre");
  });

  it('interdisent à la forge de convoquer un autre champion', () => {
    expect(FORGE_SYSTEM_PROMPT).toContain("Tu n'inventes aucun lien avec un autre champion nommé");
    expect(FORGE_SYSTEM_PROMPT).toContain('trois, deux, deux, un et un');
  });
});
