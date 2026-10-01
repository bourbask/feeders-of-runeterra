/**
 * THE TWENTY-EIGHT ASSERTIONS — 02-mj-ia.md section 8.4.
 *
 * ── WHAT IS ACTUALLY AT STAKE HERE ──────────────────────────────────────────
 * These functions are graders AND the production post-filter (section 8.6). A
 * false failure is an engine fallback a player sees; a missed failure is a
 * reserved champion in a broadcast narration. So every assertion is exercised
 * in BOTH directions — a text it must reject and a text it must accept — and
 * the lexicons are emptied to prove they are walked rather than pinned.
 *
 * ── THE SEGMENTATION GETS TWENTY-ODD EXAMPLES ───────────────────────────────
 * ARCHITECTURE.md risk 4 names it as the first source of false failures, and
 * `sentence_count` and `sentence_length_cap` both stand on it. Ellipses,
 * abbreviations and quoted dialogue are the three shapes that break naive
 * splitting, and all three are below.
 */

import { describe, expect, it } from 'vitest';

import {
  ABSENCE_MARKERS,
  ANONYMOUS_TERMS,
  ASSERTIONS,
  ASSERTION_IDS,
  BANNED_STYLE_LEXICON,
  HARD_ASSERTIONS,
  OUTCOME_DECISION_LEXICON,
  RULES_LEXICON,
  assertionContext,
  countDialoguePairs,
  countWords,
  findTerms,
  runAssertions,
  splitSentences,
  stripQuoted,
} from '../src/assertions/index.js';
import { RESERVED } from './fixtures.js';

const run = (id: string, text: string, ctx = assertionContext()) => {
  const assertion = ASSERTIONS[id];
  if (assertion === undefined) throw new Error(`assertion inconnue : ${id}`);
  return assertion.run(text, ctx);
};

// ------------------------------------------------------------------ the count

describe('le compte et le partage des assertions', () => {
  /**
   * Section 8.4 lists twenty-nine identifiers; `refusal_is_outcome_blind` is a
   * CORPUS grader, not an `(output, ctx)` function, and belongs to M0-27.
   * 29 − 1 = 28, and the sheet's own command reads this very record.
   */
  it('il y en a vingt-huit, et refusal_is_outcome_blind n’en est pas', () => {
    expect(Object.keys(ASSERTIONS)).toHaveLength(28);
    expect(ASSERTION_IDS).not.toContain('refusal_is_outcome_blind');
  });

  /**
   * THE HARD SET IS SECTION 8.6's LIST, spelled out here in full letters. It
   * is not read from `src/` — that would be a list compared to itself.
   */
  it('les dures sont exactement les post-filtres du §8.6', () => {
    expect(HARD_ASSERTIONS.map((assertion) => assertion.id).sort()).toStrictEqual(
      [
        'banned_style_lexicon',
        'max_one_dialogue_line',
        'no_absent_reappearance',
        'no_atmosphere_ending',
        'no_digits',
        'no_named_emotion',
        'no_outcome_decision',
        'no_pc_agency',
        'no_reserved_champion',
        'no_rules_lexicon',
        'no_terminal_prompt',
        'no_time_skip',
        'price_respected',
        'scene_block_consistent',
        'sentence_count',
        'sentence_length_cap',
      ].sort(),
    );
  });

  it('adverb_budget, no_triads et no_anonymous_recurrent restent souples', () => {
    for (const id of ['adverb_budget', 'no_triads', 'no_anonymous_recurrent']) {
      expect({ id, hard: ASSERTIONS[id]?.hard }).toStrictEqual({ id, hard: false });
    }
  });

  it('ends_concrete est optionnelle, réservée au juge N2', () => {
    expect(ASSERTIONS['ends_concrete']?.optional).toBe(true);
  });

  it('runAssertions rend un résultat par assertion, dans l’ordre', () => {
    const results = runAssertions('Tu passes. La glace cède. Le vent tombe.', assertionContext());
    expect(results.map((result) => result.id)).toStrictEqual([...ASSERTION_IDS]);
  });
});

// ----------------------------------------------------------- the segmentation

describe('la segmentation de phrases françaises', () => {
  /**
   * Twenty-two examples. Each one is a pair: the text, and the number of
   * sentences a reader counts. A segmentation that splits on every full stop
   * fails eight of them.
   */
  const EXAMPLES: readonly (readonly [string, number])[] = [
    ['Tu passes.', 1],
    ['Tu passes. La glace cède.', 2],
    ['Tu passes ! La glace cède ?', 2],
    ['Tu passes… La glace cède.', 2],
    ['Tu passes... La glace cède.', 2],
    ['Il hésite. Puis il saute. Et il tombe.', 3],
    ['M. Ulrun ne bouge pas.', 1],
    ['Mme Signy regarde le nord.', 1],
    ['Le froid, la neige, etc. Rien ne bouge.', 2],
    ['Il tient la corde, cf. la marque sur sa paume.', 1],
    ['« Viens. » Il tend la main.', 2],
    ['« Tu es en retard ? » Ulrun ne répond pas.', 2],
    ['Ulrun dit : « Pas ce soir. » La porte se ferme.', 2],
    ['Elle regarde la vallée. « Rien. »', 2],
    ['Une trace. Une seule.', 2],
    ['Rien.', 1],
    ['', 0],
    ['   ', 0],
    ['Le vent tombe ?! Le silence reste.', 2],
    ['Il compte : un, deux, trois. Puis il s’arrête.', 2],
    ['La corde tient. Le cairn, non.', 2],
    ['Tu passes. La corniche cède sous ton pied gauche ; tu te rattrapes.', 2],
  ];

  it('découpe les vingt-deux exemples comme un lecteur les compte', () => {
    expect(EXAMPLES.map(([text]) => splitSentences(text).length)).toStrictEqual(
      EXAMPLES.map(([, count]) => count),
    );
  });

  it('ne coupe pas à l’intérieur d’une réplique', () => {
    expect(splitSentences('Ulrun dit : « Pas ce soir. » La porte se ferme.')).toStrictEqual([
      'Ulrun dit : « Pas ce soir. »',
      'La porte se ferme.',
    ]);
  });

  it('stripQuoted retire la parole, et avale une ouverture non fermée', () => {
    expect(stripQuoted('Il dit « pars » et se tait.')).toBe('Il dit  et se tait.');
    expect(stripQuoted('Il dit « pars et se tait.')).toBe('Il dit ');
  });

  it('countWords joint les élisions et sépare les traits d’union', () => {
    expect(countWords("Tu t'arrêtes là, au-dessus du vide.")).toBe(7);
  });

  it('countDialoguePairs compte les paires appariées', () => {
    expect(countDialoguePairs('« a » « b »')).toBe(2);
    expect(countDialoguePairs('« a » « b')).toBe(1);
  });
});

// ------------------------------------------------------------------ the rules

describe('les assertions de forme', () => {
  it('sentence_count borne entre trois et cinq', () => {
    expect(run('sentence_count', 'Un. Deux. Trois.').passed).toBe(true);
    expect(run('sentence_count', 'Un. Deux.').passed).toBe(false);
    expect(run('sentence_count', 'Un. Deux. Trois. Quatre. Cinq. Six.').passed).toBe(false);
  });

  it('no_digits tombe sur un seul chiffre et cite sa position', () => {
    const failed = run('no_digits', 'Tu passes. La glace cède de 3 doigts. Rien.');
    expect(failed.passed).toBe(false);
    expect(failed.detail).toContain('3');
    expect(run('no_digits', 'Tu passes. La glace cède. Rien.').passed).toBe(true);
  });

  it('sentence_length_cap tombe au-delà de trente mots', () => {
    const long = `Tu passes ${'et encore '.repeat(16)}enfin.`;
    expect(countWords(long)).toBeGreaterThan(30);
    expect(run('sentence_length_cap', long).passed).toBe(false);
    expect(run('sentence_length_cap', 'Tu passes. La glace cède.').passed).toBe(true);
  });

  it('max_one_dialogue_line tolère une réplique, pas deux', () => {
    expect(run('max_one_dialogue_line', 'Il dit « viens ».').passed).toBe(true);
    expect(run('max_one_dialogue_line', 'Il dit « viens ». Elle dit « non ».').passed).toBe(false);
  });

  it('second_person_singular exige le tutoiement et refuse le vouvoiement', () => {
    expect(run('second_person_singular', 'Tu passes. La glace cède.').passed).toBe(true);
    expect(run('second_person_singular', 'Vous passez. La glace cède.').passed).toBe(false);
    expect(run('second_person_singular', 'La glace cède.').passed).toBe(false);
    // Inside quotes, `vous` is an NPC speaking: allowed.
    expect(run('second_person_singular', 'Tu passes. Il dit « vous êtes en retard ».').passed).toBe(
      true,
    );
  });

  it('no_terminal_prompt refuse la question finale, même déguisée', () => {
    expect(run('no_terminal_prompt', 'Tu passes. Que fais-tu ?').passed).toBe(false);
    expect(run('no_terminal_prompt', 'Tu passes. À toi de jouer.').passed).toBe(false);
    expect(run('no_terminal_prompt', 'Tu passes. La glace cède.').passed).toBe(true);
    // A question INSIDE quotes is an NPC, and is allowed.
    expect(run('no_terminal_prompt', 'Tu passes. Il demande « tu viens ? »').passed).toBe(true);
  });

  it('language_fr refuse l’anglais et le vide', () => {
    expect(run('language_fr', 'Tu passes et la glace cède dans le vent.').passed).toBe(true);
    expect(run('language_fr', 'You walk into the ice and the wind.').passed).toBe(false);
    expect(run('language_fr', '').passed).toBe(false);
  });
});

describe('les assertions de contenu', () => {
  it('no_rules_lexicon attrape le vocabulaire de règle hors guillemets', () => {
    expect(run('no_rules_lexicon', 'Ta vigueur baisse.').passed).toBe(false);
    expect(run('no_rules_lexicon', 'Il dit « ta vigueur baisse ».').passed).toBe(true);
    expect(run('no_rules_lexicon', 'Le froid entre par la manche.').passed).toBe(true);
  });

  /**
   * THE DEPARTURE FROM THE SPEC, PINNED RATHER THAN HIDDEN.
   *
   * Section 8.4 prescribes an accent-INSENSITIVE search. Applied to `dé` and
   * `dés` that matches `de` and `des`, so the hard assertion would fail on
   * every French sentence and the post-filter would fall back to the engine on
   * every turn. Those two are searched accent-sensitively; the rest are not.
   */
  it('mais « dé » garde son accent, sinon « de » ferait tomber toute phrase', () => {
    expect(run('no_rules_lexicon', 'Le vent vient de la vallée et des cairns.').passed).toBe(true);
    expect(run('no_rules_lexicon', 'Le dé roule sur la pierre.').passed).toBe(false);
    expect(run('no_rules_lexicon', 'Les dés roulent sur la pierre.').passed).toBe(false);
  });

  /**
   * THE OTHER DEPARTURE, and it costs something. Section 8.4 writes
   * `âme (en contexte de jauge)`. « Context of gauge » is not mechanically
   * expressible, so this assertion is STRICTER than written: any `âme`
   * outside quotes fails. Pinned here so that the cost is visible rather than
   * discovered in production.
   */
  it('et « âme » est refusée sans son contexte de jauge — plus strict que la spec', () => {
    expect(run('no_rules_lexicon', 'Son âme est lourde.').passed).toBe(false);
  });

  it('no_outcome_decision attrape les formulations décisives', () => {
    expect(run('no_outcome_decision', 'Tu réussis la traversée.').passed).toBe(false);
    expect(run('no_outcome_decision', 'Lance les dés.').passed).toBe(false);
    expect(run('no_outcome_decision', 'La corniche cède sous ton pied.').passed).toBe(true);
  });

  it('no_reserved_champion attrape le nom ET l’alias', () => {
    const ctx = assertionContext({ reservedChampions: RESERVED });
    expect(run('no_reserved_champion', 'Lissandra passe le col.', ctx).passed).toBe(false);
    expect(run('no_reserved_champion', 'La Sorcière de Glace passe.', ctx).passed).toBe(false);
    expect(run('no_reserved_champion', 'la sorciere de glace passe.', ctx).passed).toBe(false);
    expect(run('no_reserved_champion', 'Ulrun passe le col.', ctx).passed).toBe(true);
  });

  /**
   * SECTION 6, QUESTION 3: emptying a list must make something fall. With no
   * reserved champion, this assertion guards nothing — and says so.
   */
  it('et une liste de réservés vide ne garde rien, par construction', () => {
    expect(run('no_reserved_champion', 'Lissandra passe le col.').passed).toBe(true);
  });

  it('no_pc_agency refuse la décision prêtée et la réplique attribuée', () => {
    const ctx = assertionContext({ playerCharacterNames: ['Sejuani'] });
    expect(run('no_pc_agency', 'Tu décides de faire confiance.', ctx).passed).toBe(false);
    expect(run('no_pc_agency', '« Assez », dit Sejuani.', ctx).passed).toBe(false);
    expect(run('no_pc_agency', 'Sejuani dit : « assez ».', ctx).passed).toBe(false);
    expect(run('no_pc_agency', 'Tu franchis la corniche.', ctx).passed).toBe(true);
  });

  it('no_ooc_lexicon attrape le vocabulaire de jeu vidéo', () => {
    expect(run('no_ooc_lexicon', 'Tu perds des points de vie.').passed).toBe(false);
    expect(run('no_ooc_lexicon', 'Le froid entre par la manche.').passed).toBe(true);
  });

  it('mentions_any passe sans valeur demandée, et note quand il y en a', () => {
    expect(run('mentions_any', 'rien').passed).toBe(true);
    const ctx = assertionContext({ mentionsAny: ['corniche', 'cairn'] });
    expect(run('mentions_any', 'La corniche cède.', ctx).passed).toBe(true);
    expect(run('mentions_any', 'La glace cède.', ctx).passed).toBe(false);
  });
});

/**
 * `price_respected` — the criterion that says the test must cover BOTH halves.
 */
describe('price_respected, les deux moitiés de la règle', () => {
  const ctx = assertionContext({ priceKeywords: ['allié', 'trahison', 'retourne'] });

  it('échoue sur une narration qui esquive le prix', () => {
    const result = run(
      'price_respected',
      'Ton allié lève la main, mais tu en sors indemne. Rien ne change.',
      ctx,
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('évitement');
  });

  it('échoue aussi quand aucun mot-clé de l’entrée n’apparaît', () => {
    const result = run('price_respected', 'La neige tombe. Le vent se lève. Rien ne bouge.', ctx);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('aucun mot-clé');
  });

  it('passe quand le prix est mis en scène avec ses mots', () => {
    expect(
      run('price_respected', 'Ton allié se retourne et lève la lame vers toi.', ctx).passed,
    ).toBe(true);
  });

  it('ne note rien quand le tour n’impose aucun prix', () => {
    expect(run('price_respected', 'La neige tombe.').passed).toBe(true);
  });

  /**
   * Section 8.4 says `keywords` is MANDATORY in the content: without it this
   * hard assertion has nothing to score against. An empty list is therefore a
   * FAILURE with a legible reason, not a silent pass.
   */
  it('et une entrée sans keywords est signalée, pas tolérée', () => {
    const result = run('price_respected', 'peu importe', assertionContext({ priceKeywords: [] }));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('keywords');
  });
});

describe('no_time_skip', () => {
  it('échoue sur « le lendemain matin » quand le <fait> ne porte aucun saut', () => {
    expect(run('no_time_skip', 'Le lendemain, tu repars vers le col.').passed).toBe(false);
  });

  it('et passe quand le <fait> en porte un', () => {
    const ctx = assertionContext({ factHasTimeSkip: true });
    expect(run('no_time_skip', 'Le lendemain, tu repars vers le col.', ctx).passed).toBe(true);
  });

  it('un saut cité entre guillemets est de la parole, pas du temps écoulé', () => {
    expect(run('no_time_skip', 'Il dit « le lendemain, on repart ».').passed).toBe(true);
  });
});

describe('les assertions de registre', () => {
  /**
   * THE LIST IS WALKED, AND THE COUNT IS WRITTEN IN FULL LETTERS.
   *
   * `caught` compared to `BANNED_STYLE_LEXICON` alone is a list compared to
   * itself: empty the lexicon and both sides become `[]`, and the assertion
   * stays green on an assertion that guards nothing (RECETTE, mode 6). The
   * twenty-three below comes from section 8.4's table, counted there, and two
   * named terms are asserted by hand so that an emptied list is red twice.
   */
  it('banned_style_lexicon attrape les vingt-trois termes de la liste close', () => {
    const caught = BANNED_STYLE_LEXICON.filter(
      (term) => !run('banned_style_lexicon', `Le vent ${term} froid.`).passed,
    );
    expect(caught).toHaveLength(23);
    expect(caught).toStrictEqual([...BANNED_STYLE_LEXICON]);
    expect(run('banned_style_lexicon', 'Le vent semble froid.').passed).toBe(false);
    expect(run('banned_style_lexicon', 'Une atmosphère oppressante.').passed).toBe(false);
  });

  it('et laisse passer une phrase qui n’en porte aucun', () => {
    expect(run('banned_style_lexicon', 'La corniche cède sous ton pied.').passed).toBe(true);
  });

  it('no_named_emotion refuse « tu ressens » et « tu sens monter la peur »', () => {
    expect(run('no_named_emotion', 'Tu ressens le froid.').passed).toBe(false);
    expect(run('no_named_emotion', 'Tu sens monter la peur.').passed).toBe(false);
    expect(run('no_named_emotion', 'Ton cœur se serre.').passed).toBe(false);
    expect(run('no_named_emotion', 'Tu sens la corde glisser.').passed).toBe(true);
  });

  it('no_atmosphere_ending ne regarde que la dernière phrase', () => {
    expect(run('no_atmosphere_ending', 'Un silence pesant. La corde casse.').passed).toBe(true);
    expect(
      run('no_atmosphere_ending', 'La corde casse. Un silence pesant s’installe.').passed,
    ).toBe(false);
  });

  it('adverb_budget tolère un adverbe, pas deux, et ignore les noms en -ment', () => {
    expect(run('adverb_budget', 'Il avance lentement.').passed).toBe(true);
    expect(run('adverb_budget', 'Il avance lentement et parle doucement.').passed).toBe(false);
    expect(run('adverb_budget', 'Le hurlement monte. Un craquement répond.').passed).toBe(true);
  });

  it('no_triads attrape une énumération à trois termes sans verbe', () => {
    expect(run('no_triads', 'Le froid, la faim et la peur.').passed).toBe(false);
    expect(run('no_triads', 'Le froid et la faim.').passed).toBe(true);
  });

  it('no_anonymous_recurrent tombe à la deuxième occurrence, pas à la première', () => {
    expect(run('no_anonymous_recurrent', "L'homme avance.").passed).toBe(true);
    expect(run('no_anonymous_recurrent', "L'homme avance. L'homme s'arrête.").passed).toBe(false);
  });
});

describe('les assertions de cohérence de scène', () => {
  const ctx = assertionContext({ absentNames: ['Keld'] });

  it('no_absent_reappearance refuse la mention nue d’un absent', () => {
    expect(run('no_absent_reappearance', 'Keld avance vers toi.', ctx).passed).toBe(false);
  });

  it('et autorise ce qu’il a laissé derrière lui', () => {
    expect(run('no_absent_reappearance', 'L’abri de Keld est vide.', ctx).passed).toBe(true);
    expect(run('no_absent_reappearance', 'Le sang de Keld marque la neige.', ctx).passed).toBe(
      true,
    );
  });

  it('scene_block_consistent refuse un présent qui figure dans les partis', () => {
    const withBlock = assertionContext({
      absentNames: ['Keld'],
      sceneBlock: {
        lieu: '',
        presents: [{ nom: 'Keld', etat: 'debout' }],
        partis: [],
        refus: null,
      },
    });
    expect(run('scene_block_consistent', '', withBlock).passed).toBe(false);
  });

  it('et un bloc absent ne déclenche rien', () => {
    expect(run('scene_block_consistent', '', ctx).passed).toBe(true);
  });
});

describe('les assertions de refus, au niveau du cas', () => {
  it('no_refusal tombe sur un refus RETENU, jamais sur un refus rejeté', () => {
    expect(
      run(
        'no_refusal',
        '',
        assertionContext({ refusal: { verdict: 'upheld', cause: 'cible_morte', target: 'Keld' } }),
      ).passed,
    ).toBe(false);
    expect(
      run(
        'no_refusal',
        '',
        assertionContext({
          refusal: { verdict: 'rejected', cause: 'cible_morte', target: 'Keld' },
        }),
      ).passed,
    ).toBe(true);
  });

  it('refusal_matches compare verdict, cause et cible', () => {
    const expected = { verdict: 'upheld' as const, cause: 'cible_morte', target: 'Keld' };
    expect(
      run('refusal_matches', '', assertionContext({ refusal: expected, expectedRefusal: expected }))
        .passed,
    ).toBe(true);
    expect(
      run(
        'refusal_matches',
        '',
        assertionContext({
          refusal: { ...expected, cause: 'cible_absente' },
          expectedRefusal: expected,
        }),
      ).passed,
    ).toBe(false);
  });
});

describe('tool_calls, en mode prose seule', () => {
  it('passe quand rien n’a été appelé — ce qui est le cas de M0', () => {
    expect(run('tool_calls', '').passed).toBe(true);
  });

  it('et tombe sur le moindre appel, puisque aucun outil n’est envoyé', () => {
    expect(run('tool_calls', '', assertionContext({ toolCalls: ['get_state'] })).passed).toBe(
      false,
    );
  });
});

describe('ends_concrete, l’optionnelle', () => {
  it('reconnaît une entité de la scène ou un mot sensoriel', () => {
    const ctx = assertionContext({ sceneEntityNames: ['Ulrun'] });
    expect(run('ends_concrete', 'Tu passes. Ulrun se lève.', ctx).passed).toBe(true);
    expect(run('ends_concrete', 'Tu passes. La neige s’affaisse.', ctx).passed).toBe(true);
    expect(run('ends_concrete', 'Tu passes. Il se lève.', ctx).passed).toBe(false);
  });
});

/**
 * SECTION 6, QUESTION 3 — the lists are WALKED, not pinned.
 *
 * Emptying a lexicon must make something fall. `findTerms` is the one walker
 * they all go through, so emptying its input is the cheapest honest probe.
 */
describe('les lexiques sont parcourus, pas épinglés', () => {
  it('vider la liste fait tomber la recherche', () => {
    expect(findTerms('Le vent semble froid.', BANNED_STYLE_LEXICON)).toStrictEqual(['semble']);
    expect(findTerms('Le vent semble froid.', [])).toStrictEqual([]);
  });

  it('chaque lexique porte ce que la spec écrit, et rien de plus', () => {
    expect(RULES_LEXICON).toContain('vigueur');
    expect(OUTCOME_DECISION_LEXICON).toContain('tu parviens à');
    expect(ABSENCE_MARKERS).toContain('plus là');
    expect(ANONYMOUS_TERMS).toContain('la silhouette');
  });

  it('et la recherche est sur frontière de mot, pas sur includes', () => {
    // `n'apparaissent` contains `paraissent` as a substring.
    expect(findTerms("Les traces n'apparaissent pas.", ['paraissent'])).toStrictEqual([]);
    expect(findTerms('Les traces paraissent fraîches.', ['paraissent'])).toStrictEqual([
      'paraissent',
    ]);
  });

  /**
   * A term that ends in an apostrophe has no trailing letter boundary. Written
   * with one, `quelque chose d'` never matched `quelque chose d'étrange` — the
   * term was in the list and the list caught nothing.
   */
  it('y compris pour un terme qui finit par une apostrophe', () => {
    expect(findTerms("Il y a quelque chose d'étrange ici.", ["quelque chose d'"])).toStrictEqual([
      "quelque chose d'",
    ]);
  });
});
