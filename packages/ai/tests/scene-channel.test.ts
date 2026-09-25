/**
 * THE PERCEPTION CHANNEL — ADR 0008 decision 3, made mechanical.
 *
 * "Le moteur calcule, pour chaque destinataire, la liste des faits
 * perceptibles, et le conteur n'a le droit d'utiliser que celle-la."
 *
 * ── WHY THIS IS THE TEST THAT MATTERS ───────────────────────────────────────
 * A filter on the model's OUTPUT proves nothing: by the time it runs, the
 * information is already in the context window, and a narrator that has read a
 * fact will lean on it whether or not the sentence naming it survives. What
 * carries the rule is the INPUT: the `<scene>` block is built from
 * `brief.perceivableFacts` and from nothing else.
 *
 * So the test below does not check that the renderer sorts nicely. It builds a
 * campaign state carrying a presence, HIDES that presence from the brief, and
 * demands that the name never reaches the rendered prompt. That is the
 * property M1 will lean on when the party splits, and the one a well-meaning
 * refactor toward `state.scene` would silently destroy.
 */

import type { NarrationBriefDto } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { buildSceneBlock } from '../src/prompts/scene.block.js';

type Fact = NarrationBriefDto['perceivableFacts'][number];

const fact = (over: Partial<Fact> & Pick<Fact, 'kind' | 'name'>): Fact => ({
  ref: { kind: 'entity', id: `ent_${over.name.toLowerCase()}` },
  detail: '',
  sinceSeq: 1,
  ...over,
});

const brief = (facts: readonly Fact[]): NarrationBriefDto =>
  ({
    correlationId: 'cor_1',
    sceneId: 'scn_1',
    audience: { scope: 'table', recipients: null },
    perceivableFacts: facts,
    actorCharacterId: 'chr_sejuani',
    moveId: 'face-danger',
    outcome: 'partielle',
    isPresage: false,
    roll: null,
    appliedEffects: [],
    imposedPrice: null,
    presage: null,
    playerInput: 'je traverse',
    eventSeqs: [1],
    fallbackTemplateId: 'face-danger/partielle',
  }) as unknown as NarrationBriefDto;

/**
 * The scene as the ENGINE holds it: three people at the pass. Ulrun is the one
 * this recipient cannot perceive — say, the M1 case where the party has split
 * and he stayed at the camp.
 */
const SCENE_PRESENT_NAMES = ['Braum', 'Sejuani', 'Ulrun'];

describe('le bloc <scene> se construit depuis brief.perceivableFacts', () => {
  it('rend ce que la liste porte, dans l’ordre où elle le porte', () => {
    const rendered = buildSceneBlock(
      brief([
        fact({ kind: 'present', name: 'Braum', detail: 'en retrait, corde en main' }),
        fact({ kind: 'present', name: 'Sejuani', detail: 'debout, la paume ouverte' }),
        fact({ kind: 'absent', name: 'Keld', detail: 'mort' }),
        fact({ kind: 'absent', name: 'Signy', detail: 'parti' }),
      ]),
    );
    expect(rendered.split('\n')).toStrictEqual([
      '<scene>',
      'Ces lignes sont des faits tenus par le moteur, pas du récit. Tu ne les contredis pas, tu ne les oublies pas.',
      'Présents :',
      '- Braum (en retrait, corde en main)',
      '- Sejuani (debout, la paume ouverte)',
      'Partis, morts ou hors de portée — ils ne reviennent pas dans cette scène :',
      '- Keld (mort)',
      '- Signy (parti)',
      '</scene>',
    ]);
  });

  /**
   * THE ASSERTION OF ADR 0008. Ulrun is in the scene the engine holds and is
   * NOT in this recipient's list. He must be nowhere in the prompt.
   */
  it('un fait présent dans l’état mais absent de la liste n’apparaît pas', () => {
    const perceived = SCENE_PRESENT_NAMES.filter((name) => name !== 'Ulrun');
    const rendered = buildSceneBlock(
      brief(perceived.map((name) => fact({ kind: 'present', name }))),
    );
    expect(SCENE_PRESENT_NAMES).toContain('Ulrun');
    expect(rendered).not.toContain('Ulrun');
    for (const name of perceived) expect(rendered).toContain(name);
  });

  it('une liste vide rend une ligne explicite, jamais rien du tout (§4.5)', () => {
    const rendered = buildSceneBlock(brief([]));
    expect(rendered).toContain('Présents :\n- aucun');
    expect(rendered).toContain('dans cette scène :\n- aucun');
  });

  it('rend deux fois les mêmes octets à faits égaux (préfixe de cache)', () => {
    const facts = [
      fact({ kind: 'present', name: 'Braum', detail: 'en retrait' }),
      fact({ kind: 'absent', name: 'Keld', detail: 'mort' }),
    ];
    expect(buildSceneBlock(brief(facts))).toBe(buildSceneBlock(brief([...facts])));
  });

  /**
   * The signature is the guard. `buildSceneBlock` takes the brief and nothing
   * else, so adding a `SceneState` parameter is a change a reviewer sees.
   * Asserted mechanically because "it takes one argument" is exactly the kind
   * of claim that survives the refactor that breaks it.
   */
  it('ne prend qu’un seul paramètre, et c’est le brief', () => {
    expect(buildSceneBlock.length).toBe(1);
  });
});
