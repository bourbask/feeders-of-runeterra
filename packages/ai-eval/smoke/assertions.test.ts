/**
 * Every check is exercised TWICE: once on an output that violates it and must
 * redden, once on an output that respects it and must stay green. Showing that
 * a check exists proves nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  SMOKE_ASSERTIONS,
  SMOKE_ASSERTIONS_MAX,
  SMOKE_ASSERTIONS_MIN,
  fold,
  prose,
  sceneBlockBody,
  sentences,
  stripQuoted,
  type SmokeCheck,
} from './assertions.js';
import type { SmokeCase } from './cases.js';

const BLOC =
  '<scene_apres>{"lieu":"col_des_hurleurs","presents":[{"nom":"Sejuani","etat":"debout"}],"partis":[{"nom":"Keld","cause":"mort"}],"refus":null}</scene_apres>';

const CAS: SmokeCase = {
  id: 'test',
  title: 'cas de test',
  actor: 'Sejuani',
  imposedPrice: false,
  fact: 'Issue : RÉUSSITE FRANCHE.',
  intent: 'Sejuani : « Je traverse. »',
  sceneIn: {
    place: 'col_des_hurleurs',
    time: 'fin d’après-midi',
    present: [{ name: 'Sejuani', detail: 'debout' }],
    absent: [{ name: 'Keld', detail: 'mort' }],
  },
  lockedChampions: [
    { name: 'Ashe', aliases: ['la Reine des Neiges', 'l’Archère du Givre'] },
    { name: 'Lissandra', aliases: ['la Sorcière de Glace'] },
  ],
};

/** Four sentences, second person, no figure, no question, block well formed. */
const CONFORME = `Tu passes. La corniche cède sous ton pied gauche et la glace t’ouvre la paume. Ulrun ne bouge pas. En contrebas, la neige s’affaisse d’un coup et s’arrête.\n${BLOC}`;

const check = (id: string): SmokeCheck => {
  const found = SMOKE_ASSERTIONS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`assertion « ${id} » absente de la table`);
  return found;
};

const run = (id: string, output: string): boolean => check(id).run(output, CAS).passed;

describe('la table gelée', () => {
  it('porte sept règles, dans cet ordre exact', () => {
    expect(SMOKE_ASSERTIONS.map((c) => c.id)).toEqual([
      'length_in_range',
      'second_person_singular',
      'no_outcome_decision',
      'no_locked_champion',
      'no_final_question',
      'scene_block_present',
      'scene_block_wellformed',
    ]);
  });

  it('reste dans l’intervalle six–huit de la fiche M0-32', () => {
    expect(SMOKE_ASSERTIONS_MIN).toBe(6);
    expect(SMOKE_ASSERTIONS_MAX).toBe(8);
    expect(SMOKE_ASSERTIONS.length).toBeGreaterThanOrEqual(SMOKE_ASSERTIONS_MIN);
    expect(SMOKE_ASSERTIONS.length).toBeLessThanOrEqual(SMOKE_ASSERTIONS_MAX);
  });

  it('passe entièrement sur une sortie conforme', () => {
    const tombees = SMOKE_ASSERTIONS.filter((c) => !c.run(CONFORME, CAS).passed).map((c) => c.id);
    expect(tombees).toEqual([]);
  });
});

describe('length_in_range', () => {
  it('rougit sous trois phrases', () => {
    expect(run('length_in_range', `Tu passes. La glace cède.\n${BLOC}`)).toBe(false);
  });

  it('rougit au-delà de cinq phrases', () => {
    const six = 'Tu passes. Tu tiens. Tu montes. Tu descends. Tu respires. Tu attends.';
    expect(run('length_in_range', `${six}\n${BLOC}`)).toBe(false);
  });

  it('accepte entre trois et cinq', () => {
    expect(run('length_in_range', CONFORME)).toBe(true);
  });

  it('ne compte pas le bloc de fin comme des phrases', () => {
    // Sans le retrait du bloc, le JSON ajouterait des terminaisons et ferait
    // sortir un texte conforme de l'intervalle.
    expect(sentences(prose(CONFORME))).toHaveLength(4);
  });
});

describe('second_person_singular', () => {
  it('rougit sur un « vous » hors guillemets', () => {
    const texte = `Vous passez. La corniche cède sous votre pied. Ulrun ne bouge pas. La neige s’arrête.\n${BLOC}`;
    expect(run('second_person_singular', texte)).toBe(false);
  });

  it('rougit quand aucun « tu » n’apparaît', () => {
    const texte = `Sejuani passe. La corniche cède. Ulrun ne bouge pas. La neige s’arrête.\n${BLOC}`;
    expect(run('second_person_singular', texte)).toBe(false);
  });

  it('accepte un « vous » DANS une réplique de personnage non joueur', () => {
    const texte = `Tu passes. Ulrun lève la main. « Vous n’irez pas plus loin », dit-il. La neige s’arrête.\n${BLOC}`;
    expect(run('second_person_singular', texte)).toBe(true);
  });

  it('accepte la sortie conforme', () => {
    expect(run('second_person_singular', CONFORME)).toBe(true);
  });
});

describe('no_outcome_decision', () => {
  it('rougit sur un chiffre', () => {
    const texte = `Tu passes. La corniche cède de 2 pas. Ulrun ne bouge pas. La neige s’arrête.\n${BLOC}`;
    expect(run('no_outcome_decision', texte)).toBe(false);
  });

  it('rougit sur le vocabulaire de jet', () => {
    const texte = `Tu passes. Ton jet a suffi. Ulrun ne bouge pas. La neige s’arrête.\n${BLOC}`;
    expect(run('no_outcome_decision', texte)).toBe(false);
  });

  it('rougit sur « dé », que `\\b` ne sait pas attraper', () => {
    const texte = `Tu passes. Le dé est tombé. Ulrun ne bouge pas. La neige s’arrête.\n${BLOC}`;
    expect(run('no_outcome_decision', texte)).toBe(false);
  });

  it('ne confond pas « dé » avec « de », ni « décide » avec « dé »', () => {
    const texte = `Tu passes. La corde de chanvre tient. Ulrun décide de rester. La neige s’arrête.\n${BLOC}`;
    expect(run('no_outcome_decision', texte)).toBe(true);
  });

  it('laisse passer les chiffres du bloc de fin', () => {
    // Le bloc n'est jamais montré aux joueurs : la règle porte sur la prose.
    const avecChiffre = CONFORME.replace('"debout"', '"debout, 2 doigts gelés"');
    expect(run('no_outcome_decision', avecChiffre)).toBe(true);
  });
});

describe('no_locked_champion', () => {
  it('rougit sur un nom verrouillé', () => {
    const texte = `Tu passes. Ashe attend plus bas. Ulrun ne bouge pas. La neige s’arrête.\n${BLOC}`;
    expect(run('no_locked_champion', texte)).toBe(false);
  });

  it('rougit sur un SURNOM, accents et apostrophe compris', () => {
    const texte = `Tu passes. L’Archere du Givre attend plus bas. Ulrun ne bouge pas. La neige s’arrête.\n${BLOC}`;
    expect(run('no_locked_champion', texte)).toBe(false);
  });

  it('rougit sur un nom caché dans le bloc de fin', () => {
    expect(run('no_locked_champion', CONFORME.replace('Sejuani', 'Lissandra'))).toBe(false);
  });

  it('n’attrape pas un nom qui n’est qu’une sous-chaîne d’un autre mot', () => {
    const texte = `Tu passes. Ashen reste au cairn. Ulrun ne bouge pas. La neige s’arrête.\n${BLOC}`;
    expect(run('no_locked_champion', texte)).toBe(true);
  });
});

describe('no_final_question', () => {
  it('rougit sur une question finale', () => {
    const texte = `Tu passes. La corniche cède. Ulrun ne bouge pas. Que fais-tu ?\n${BLOC}`;
    expect(run('no_final_question', texte)).toBe(false);
  });

  it('rougit sur une relance sans point d’interrogation', () => {
    const texte = `Tu passes. La corniche cède. Ulrun ne bouge pas. À toi de jouer.\n${BLOC}`;
    expect(run('no_final_question', texte)).toBe(false);
  });

  it('accepte une question posée par un personnage non joueur', () => {
    const texte = `Tu passes. La corniche cède. Ulrun se lève. « Tu comptes redescendre ? » demande-t-il.\n${BLOC}`;
    expect(run('no_final_question', texte)).toBe(true);
  });
});

describe('scene_block_present', () => {
  it('rougit quand le bloc manque', () => {
    expect(run('scene_block_present', 'Tu passes. La corniche cède. Ulrun ne bouge pas.')).toBe(
      false,
    );
  });

  it('rougit quand le bloc n’est pas fermé', () => {
    expect(run('scene_block_present', `Tu passes.\n<scene_apres>{"lieu":""}`)).toBe(false);
  });

  it('rougit quand le bloc est écrit deux fois', () => {
    expect(run('scene_block_present', `Tu passes.\n${BLOC}\n${BLOC}`)).toBe(false);
  });

  it('accepte un bloc unique et fermé', () => {
    expect(run('scene_block_present', CONFORME)).toBe(true);
  });
});

describe('scene_block_wellformed', () => {
  it('rougit sur un JSON illisible', () => {
    const texte = `Tu passes.\n<scene_apres>{"lieu":"col",</scene_apres>`;
    expect(run('scene_block_wellformed', texte)).toBe(false);
  });

  it('rougit sur une cause de départ inventée', () => {
    const texte = CONFORME.replace('"cause":"mort"', '"cause":"enfui"');
    expect(run('scene_block_wellformed', texte)).toBe(false);
  });

  it('rougit sur un champ que le schéma n’autorise pas', () => {
    const texte = CONFORME.replace('"refus":null', '"refus":null,"pv":3');
    expect(run('scene_block_wellformed', texte)).toBe(false);
  });

  it('accepte un bloc minimal : rien à signaler n’est pas une erreur', () => {
    expect(run('scene_block_wellformed', `Tu passes.\n<scene_apres>{}</scene_apres>`)).toBe(true);
  });
});

describe('les outils de préparation', () => {
  it('stripQuoted retire la parole entre guillemets français', () => {
    expect(stripQuoted('Il dit « pas plus loin » et se rassoit.').includes('plus loin')).toBe(
      false,
    );
  });

  it('sentences protège les abréviations', () => {
    expect(sentences('M. Ulrun ne bouge pas. Il regarde le nord.')).toEqual([
      'M. Ulrun ne bouge pas.',
      'Il regarde le nord.',
    ]);
  });

  it('fold enlève les diacritics et unifie l’apostrophe', () => {
    expect(fold('L’Archère du Givre')).toBe("l'archere du givre");
  });

  it('sceneBlockBody rend null sans paire fermée', () => {
    expect(sceneBlockBody('Tu passes.')).toBeNull();
    expect(sceneBlockBody('Tu passes.<scene_apres>{}')).toBeNull();
    expect(sceneBlockBody('x<scene_apres>{}</scene_apres>y')).toBe('{}');
  });

  it('l’extrait du rapport est tronqué et tient sur une ligne', () => {
    const longue = `Tu passes. La corniche cède. ${'la neige tombe sans bruit sur le cairn effondré et '.repeat(4)}que fais-tu ?\n${BLOC}`;
    const detail = check('no_final_question').run(longue, CAS).detail;
    expect(detail.endsWith('…')).toBe(true);
    expect(detail).not.toContain('\n');
  });

  it('no_final_question ne tombe pas quand tout est entre guillemets', () => {
    // stripQuoted ne laisse alors aucune phrase : il n'y a pas de dernière
    // phrase adressée au joueur, donc rien à reprocher.
    expect(run('no_final_question', `« Que fais-tu ? »\n${BLOC}`)).toBe(true);
  });
});
