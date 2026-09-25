/**
 * `proveRefusal` — R1 → R7, and the property the whole mechanism rests on.
 *
 * ── THE ANTI-ABUSE GUARD, AND WHY IT CANNOT BE CHEATED ──────────────────────
 * Section 4.8.5 names the risk out loud: the right of refusal must not become
 * the back door through which the model cancels dice it dislikes. The lock is
 * that the proof reads the state AT THE DECLARATION and never the outcome.
 *
 * The test below plays the SAME case twice — once with `franche`, once with
 * `echec` — and demands the same verdict. That assertion is only worth
 * something because the outcome is actually present on the fixture and is
 * DROPPED by `refusalProofInput`: a probe where the outcome never existed
 * would be green on a function that had no way to read it anyway. So the
 * turn carries it, the conversion drops it, and a second test asserts that
 * `RefusalProofInput` has no field the outcome could travel in.
 */

import { describe, expect, it } from 'vitest';

import {
  REFUSAL_QUOTA_UPHELD,
  TARGETLESS_MOVE_IDS,
  proveRefusal,
  refusalProofInput,
  refusalView,
  type RefusalTurn,
} from '../src/outputs/refusal.js';
import { mergeState, sceneAbsence, scenePresence, sceneState } from './fixtures.js';

const turn = (over: Partial<RefusalTurn> = {}): RefusalTurn => ({
  refusal: { cause: 'cible_morte', cible: 'Keld' },
  declaredCount: 1,
  sceneBefore: sceneState(),
  state: mergeState(),
  actorInventory: ['corde de crin'],
  actorAssets: ['lame d’Avarosa'],
  intention: 'Je secoue Keld pour le réveiller.',
  moveId: 'face-danger',
  upheldRefusalsInWindow: 0,
  outcome: 'franche',
  ...over,
});

const verdictOf = (input: RefusalTurn): string => {
  const result = proveRefusal(refusalProofInput(input));
  return result === 'upheld' ? 'upheld' : result.rejected;
};

// --------------------------------------------------------- outcome blindness

describe('la preuve est aveugle à l’issue du jet', () => {
  /**
   * THE CRITERION, WORD FOR WORD: the same case, played once with `franche`
   * and once with `echec`, produces EXACTLY the same verdict.
   */
  it('le même cas, avec franche puis avec echec, rend le même verdict', () => {
    const cases: readonly RefusalTurn[] = [
      turn(),
      turn({
        refusal: { cause: 'cible_absente', cible: 'Signy' },
        intention: 'Je rattrape Signy.',
      }),
      turn({ refusal: { cause: 'cible_morte', cible: 'Ulrun' }, intention: 'Je secoue Ulrun.' }),
      turn({ refusal: null }),
      turn({ upheldRefusalsInWindow: REFUSAL_QUOTA_UPHELD }),
      turn({ moveId: 'endure-cold' }),
    ];
    const franche = cases.map((one) => verdictOf({ ...one, outcome: 'franche' }));
    const echec = cases.map((one) => verdictOf({ ...one, outcome: 'echec' }));
    expect(franche).toStrictEqual(echec);
    // And the corpus is not all one answer, which would make equality trivial.
    expect(new Set(franche).size).toBeGreaterThan(1);
  });

  /**
   * THE PROBE THE CRITERION NAMES — « le testeur branche l'issue sur la
   * preuve (une ligne) ». It cannot be done without adding a field, and this
   * is what says so: the input the proof is handed carries no outcome, no
   * roll and no dice, by key.
   */
  it('et l’entrée de la preuve ne porte ni issue, ni jet, ni dé', () => {
    const keys = Object.keys(refusalProofInput(turn()));
    expect(keys).toStrictEqual([
      'refusal',
      'declaredCount',
      'sceneBefore',
      'state',
      'actorInventory',
      'actorAssets',
      'intention',
      'moveId',
      'upheldRefusalsInWindow',
    ]);
    for (const forbidden of ['outcome', 'roll', 'dice', 'challengeDice', 'total', 'isPresage']) {
      expect({ forbidden, present: keys.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('alors que le tour, lui, porte bien l’issue — sinon la sonde serait vide', () => {
    expect(turn({ outcome: 'echec' }).outcome).toBe('echec');
  });
});

// ------------------------------------------------------------------ R1 → R7

describe('les sept règles de la preuve', () => {
  it('R1 : aucun refus déclaré — rien à retenir', () => {
    expect(verdictOf(turn({ refusal: null }))).toBe('refusal_unproven');
  });

  it('R2 : deux refus dans le même tour — rejeté', () => {
    expect(verdictOf(turn({ declaredCount: 2 }))).toBe('refusal_multiple');
  });

  it('R3 : une cible que rien n’apparie — rejeté', () => {
    expect(
      verdictOf(
        turn({
          refusal: { cause: 'cible_morte', cible: 'Fjolnir' },
          intention: 'Je secoue Fjolnir.',
        }),
      ),
    ).toBe('refusal_target_unknown');
  });

  /**
   * R3 IS SKIPPED FOR `objet_inexistant`, AND IT IS REPORTED.
   *
   * R3 demands the target match something that exists; `objet_inexistant` is
   * the claim that it matches NOTHING. Applied to that pair, the criterion
   * rejects every refusal of that cause by construction. Signalled in the
   * pull request rather than worked around, and pinned here.
   */
  it('R3 : sauf pour objet_inexistant, que la règle rejetterait par construction', () => {
    expect(
      verdictOf(
        turn({
          refusal: { cause: 'objet_inexistant', cible: 'torche' },
          intention: 'J’allume la torche.',
        }),
      ),
    ).toBe('upheld');
  });

  it('R4 : la cause doit être prouvée par l’état à la déclaration', () => {
    // Ulrun is alive in the projection: `cible_morte` proves nothing.
    expect(
      verdictOf(
        turn({ refusal: { cause: 'cible_morte', cible: 'Ulrun' }, intention: 'Je secoue Ulrun.' }),
      ),
    ).toBe('refusal_unproven');
    // Keld is dead: it does.
    expect(verdictOf(turn())).toBe('upheld');
  });

  it('R4 : cible_absente n’est prouvée que par parti ou hors_de_portee', () => {
    expect(
      verdictOf(
        turn({ refusal: { cause: 'cible_absente', cible: 'Signy' }, intention: 'Je suis Signy.' }),
      ),
    ).toBe('upheld');
    // Keld is absent, but `mort` — the cause to use is `cible_morte`.
    expect(
      verdictOf(
        turn({ refusal: { cause: 'cible_absente', cible: 'Keld' }, intention: 'Je suis Keld.' }),
      ),
    ).toBe('refusal_unproven');
  });

  it('R4 : hors_de_portee se prouve sur le lieu, pas sur la scène', () => {
    expect(
      verdictOf(
        turn({
          refusal: { cause: 'hors_de_portee', cible: 'Signy' },
          intention: 'Je rejoins Signy.',
        }),
      ),
    ).toBe('upheld');
    expect(
      verdictOf(
        turn({
          refusal: { cause: 'hors_de_portee', cible: 'Ulrun' },
          intention: 'Je rejoins Ulrun.',
        }),
      ),
    ).toBe('refusal_unproven');
  });

  it('R4 : objet_inexistant tombe quand l’objet est à l’inventaire ou en atout', () => {
    expect(
      verdictOf(
        turn({
          refusal: { cause: 'objet_inexistant', cible: 'corde de crin' },
          intention: 'Je lance la corde de crin.',
        }),
      ),
    ).toBe('refusal_unproven');
    expect(
      verdictOf(
        turn({
          refusal: { cause: 'objet_inexistant', cible: 'lame d’Avarosa' },
          intention: 'Je tire la lame d’Avarosa.',
        }),
      ),
    ).toBe('refusal_unproven');
  });

  it('R5 : un refus qui ne vise pas ce que le joueur a écrit est rejeté', () => {
    expect(verdictOf(turn({ intention: 'Je traverse la corniche.' }))).toBe('refusal_off_target');
  });

  it('R6 : un mouvement sans cible ne se refuse pas', () => {
    for (const moveId of TARGETLESS_MOVE_IDS) {
      expect({ moveId, verdict: verdictOf(turn({ moveId })) }).toStrictEqual({
        moveId,
        verdict: 'refusal_targetless_move',
      });
    }
  });

  it('R7 : le quota de campagne ferme la porte au-delà de trois', () => {
    expect(verdictOf(turn({ upheldRefusalsInWindow: REFUSAL_QUOTA_UPHELD - 1 }))).toBe('upheld');
    expect(verdictOf(turn({ upheldRefusalsInWindow: REFUSAL_QUOTA_UPHELD }))).toBe('refusal_quota');
  });
});

/**
 * THE OTHER HALF OF THE CRITERION: an absurd but MATERIALLY POSSIBLE proposal
 * produces no upheld refusal, and the turn plays out normally. « Refuser
 * l'absurde est une faute plus grave qu'accepter l'impossible. »
 */
describe('l’absurde mais possible se joue', () => {
  const cases: readonly { readonly what: string; readonly turn: RefusalTurn }[] = [
    {
      what: 'hurler le nom d’un ennemi du haut d’un cairn',
      turn: turn({ refusal: null, intention: 'Je hurle du haut du cairn.' }),
    },
    {
      what: 'offrir sa ration à quelqu’un qui est là',
      turn: turn({
        refusal: { cause: 'cible_absente', cible: 'Ulrun' },
        intention: 'J’offre ma ration à Ulrun.',
      }),
    },
    {
      what: 'planter dans la neige une lame qu’on porte',
      turn: turn({
        refusal: { cause: 'objet_inexistant', cible: 'lame d’Avarosa' },
        intention: 'Je plante la lame d’Avarosa dans la neige.',
      }),
    },
  ];

  it('aucun des trois ne produit un refus retenu', () => {
    const verdicts = cases.map((one) => ({ what: one.what, verdict: verdictOf(one.turn) }));
    expect(verdicts.filter((one) => one.verdict === 'upheld')).toStrictEqual([]);
    expect(verdicts).toStrictEqual([
      { what: 'hurler le nom d’un ennemi du haut d’un cairn', verdict: 'refusal_unproven' },
      { what: 'offrir sa ration à quelqu’un qui est là', verdict: 'refusal_unproven' },
      { what: 'planter dans la neige une lame qu’on porte', verdict: 'refusal_unproven' },
    ]);
  });

  /**
   * ── THE LIMIT OF THE MECHANISM, PINNED RATHER THAN HIDDEN ─────────────────
   * Section 4.8.1 proves `cible_morte` from the projection ALONE: the target
   * carries `status = 'dead'`, so the refusal stands. But braiding a dead
   * man's beard is absurd AND materially possible, and the proof has no way
   * to tell « the action needs the target alive » from « the action needs the
   * target's body ».
   *
   * That is a limit of the four causes, not of this implementation, and
   * widening it would mean letting the model say WHY — which is exactly the
   * decision invariant 1 refuses to hand back. Reported in the pull request;
   * the behaviour is pinned here so nobody rediscovers it in a session.
   */
  it('mais un refus sur un mort tient, même quand l’action reste possible', () => {
    const verdict = verdictOf(
      turn({
        sceneBefore: sceneState({
          present: [scenePresence('ent_keld', 'Keld', 'étendu')],
          absent: [],
        }),
        refusal: { cause: 'cible_morte', cible: 'Keld' },
        intention: 'Je tresse la barbe de Keld.',
      }),
    );
    expect(verdict).toBe('upheld');
  });
});

describe('refusalView, la forme que les assertions comparent', () => {
  it('rend le verdict, la cause, la cible et la raison', () => {
    const input = refusalProofInput(turn());
    expect(refusalView(input.refusal, proveRefusal(input))).toStrictEqual({
      verdict: 'upheld',
      cause: 'cible_morte',
      target: 'Keld',
      reason: null,
    });
  });

  it('et nomme la raison quand le refus tombe', () => {
    const input = refusalProofInput(turn({ declaredCount: 2 }));
    expect(refusalView(input.refusal, proveRefusal(input)).reason).toBe('refusal_multiple');
  });
});

/**
 * TWO INSTANTS RATHER THAN ONE (RECETTE section 5 bis). The proof reads the
 * scene BEFORE the turn. A version that read the scene AFTER would uphold
 * nothing on a target that the same turn had just walked out.
 */
describe('la preuve lit la scène d’avant le tour, pas celle d’après', () => {
  it('une cible partie PENDANT le tour ne prouve pas cible_absente', () => {
    const beforeTurn = sceneState({
      present: [scenePresence('ent_ulrun', 'Ulrun', 'assis')],
      absent: [],
    });
    const afterTurn = sceneState({
      present: [],
      absent: [sceneAbsence('ent_ulrun', 'Ulrun', 'parti')],
    });
    const refusal = { cause: 'cible_absente' as const, cible: 'Ulrun' };
    const intention = 'Je rattrape Ulrun.';
    expect(verdictOf(turn({ sceneBefore: beforeTurn, refusal, intention }))).toBe(
      'refusal_unproven',
    );
    // Handed the AFTER state — which the server must never do — it would be
    // upheld. That is the difference this test exists to show.
    expect(verdictOf(turn({ sceneBefore: afterTurn, refusal, intention }))).toBe('upheld');
  });
});
