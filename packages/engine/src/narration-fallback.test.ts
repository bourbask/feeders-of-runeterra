/**
 * The engine's own narration, measured on the three properties it claims —
 * each one violated on purpose, in both directions where there are two.
 */

import { aCharacter, aScene, aTableState, anId, createSeededRng, scriptedRng } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { FallbackTemplates, NarrationBrief } from './index.js';
import {
  FALLBACK_PLACEHOLDERS,
  FallbackTemplateMissing,
  FallbackTemplateUnresolved,
  fallbackNarration,
  variantsFor,
} from './index.js';

const HERO = anId('character');

const TEMPLATES: FallbackTemplates = {
  templates: {
    'face-danger': {
      franche: ['Le passage s ouvre.', 'La voie tient.', 'Rien ne cede.'],
      partielle: ['Tu passes, et {{place}} prend sa part.'],
      echec: ['Le danger arrive avant {{character}}.'],
    },
    default: { franche: ['Le silence retombe.'] },
    'endure-cold': { franche: ['{{character}} tient, a {{place}}.'] },
  },
};

function aBrief(overrides: Partial<NarrationBrief> = {}): NarrationBrief {
  return {
    correlationId: 'turn-1',
    sceneId: null,
    actorCharacterId: HERO,
    moveId: 'face-danger',
    outcome: 'franche',
    isPresage: false,
    roll: null,
    appliedEffects: [],
    imposedPrice: null,
    presage: null,
    playerInput: '',
    eventSeqs: [],
    fallbackTemplateId: 'face-danger/franche',
    ...overrides,
  };
}

const state = aTableState({
  characters: [aCharacter({ id: HERO, displayName: 'Ashe' })],
  scene: aScene({ placeName: 'Le col de Rakelstake' }),
});

describe('it picks a variant, and picks the same one again', () => {
  it('takes the variant the fallback stream lands on', () => {
    expect(fallbackNarration(aBrief(), state, TEMPLATES, scriptedRng([2]))).toBe('La voie tient.');
  });

  it('replays identically from the same seed', () => {
    const once = fallbackNarration(
      aBrief(),
      state,
      TEMPLATES,
      createSeededRng('campaign|12|fallback'),
    );
    const twice = fallbackNarration(
      aBrief(),
      state,
      TEMPLATES,
      createSeededRng('campaign|12|fallback'),
    );
    expect(once).toBe(twice);
  });

  it('spends exactly one draw, even on a single variant', () => {
    const rng = scriptedRng([1]);
    fallbackNarration(
      aBrief({ fallbackTemplateId: 'default/franche', moveId: null }),
      state,
      TEMPLATES,
      rng,
    );
    expect(rng.consumed()).toBe(1);
  });

  it('reads the reserved key for a turn that played no move', () => {
    expect(
      fallbackNarration(
        aBrief({ moveId: null, outcome: null, fallbackTemplateId: 'default/franche' }),
        state,
        TEMPLATES,
        scriptedRng([1]),
      ),
    ).toBe('Le silence retombe.');
  });
});

describe('it fills placeholders from the state, and refuses to invent', () => {
  it('names the place the state knows', () => {
    expect(
      fallbackNarration(
        aBrief({ outcome: 'partielle', fallbackTemplateId: 'face-danger/partielle' }),
        state,
        TEMPLATES,
        scriptedRng([1]),
      ),
    ).toBe('Tu passes, et Le col de Rakelstake prend sa part.');
  });

  it('names the character the state knows', () => {
    expect(
      fallbackNarration(
        aBrief({ outcome: 'echec', fallbackTemplateId: 'face-danger/echec' }),
        state,
        TEMPLATES,
        scriptedRng([1]),
      ),
    ).toBe('Le danger arrive avant Ashe.');
  });

  it('refuses a place no scene establishes', () => {
    const nowhere = aTableState({ characters: [aCharacter({ id: HERO })], scene: null });
    expect(() =>
      fallbackNarration(
        aBrief({ outcome: 'partielle', fallbackTemplateId: 'face-danger/partielle' }),
        nowhere,
        TEMPLATES,
        scriptedRng([1]),
      ),
    ).toThrow(FallbackTemplateUnresolved);
  });

  it('refuses a character the state does not hold', () => {
    const empty = aTableState({ characters: [aCharacter({ id: anId('character', 9) })] });
    expect(() =>
      fallbackNarration(
        aBrief({ outcome: 'echec', fallbackTemplateId: 'face-danger/echec' }),
        empty,
        TEMPLATES,
        scriptedRng([1]),
      ),
    ).toThrow(/character/);
  });

  it('refuses a placeholder that is not one of the two it knows', () => {
    const invented: FallbackTemplates = {
      templates: { 'face-danger': { franche: ['Le {{dragon}} passe.'] } },
    };
    expect(() => fallbackNarration(aBrief(), state, invented, scriptedRng([1]))).toThrow(
      FallbackTemplateUnresolved,
    );
  });

  it('knows exactly two placeholders, and says which', () => {
    expect([...FALLBACK_PLACEHOLDERS]).toEqual(['place', 'character']);
  });

  it('leaves a template without placeholders alone', () => {
    expect(fallbackNarration(aBrief(), state, TEMPLATES, scriptedRng([3]))).toBe('Rien ne cede.');
  });
});

describe('it refuses silence rather than improvising it', () => {
  it('throws when the bundle has no variant for the pair', () => {
    expect(() =>
      fallbackNarration(
        aBrief({ moveId: 'strike', fallbackTemplateId: 'strike/franche' }),
        state,
        TEMPLATES,
        scriptedRng([1]),
      ),
    ).toThrow(FallbackTemplateMissing);
  });

  it('throws when the identifier names no outcome at all', () => {
    expect(() =>
      fallbackNarration(
        aBrief({ fallbackTemplateId: 'face-danger' }),
        state,
        TEMPLATES,
        scriptedRng([1]),
      ),
    ).toThrow(FallbackTemplateMissing);
  });

  it('names the identifier it could not resolve', () => {
    expect(() =>
      fallbackNarration(
        aBrief({ fallbackTemplateId: 'strike/echec' }),
        state,
        TEMPLATES,
        scriptedRng([1]),
      ),
    ).toThrow(/strike\/echec/);
  });

  it('reports the variants it can see, so a bundle can be checked ahead of time', () => {
    expect(variantsFor(TEMPLATES, 'face-danger/franche')).toHaveLength(3);
    expect(variantsFor(TEMPLATES, 'face-danger/echec')).toHaveLength(1);
    expect(variantsFor(TEMPLATES, 'strike/franche')).toEqual([]);
    expect(variantsFor(TEMPLATES, 'face-danger/impossible')).toEqual([]);
  });
});

describe('the engine holds no French of its own', () => {
  it('returns a sentence the CONTENT wrote, byte for byte', () => {
    const sentence = 'Une phrase que seul le contenu connait.';
    const bundle: FallbackTemplates = { templates: { 'face-danger': { franche: [sentence] } } };
    expect(fallbackNarration(aBrief(), state, bundle, scriptedRng([1]))).toBe(sentence);
  });
});
