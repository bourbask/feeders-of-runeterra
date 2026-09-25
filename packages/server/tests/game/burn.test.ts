/**
 * LA BRÛLURE DU SOUFFLE EN DEUX TEMPS, côté serveur.
 *
 * Le moteur en livre la mécanique (M0-34). Ce qui se mesure ici est la part du
 * serveur, et elle tient en quatre promesses :
 *
 *   1. un jet qui ouvre la fenêtre NE TERMINE PAS LE TOUR : ni effet, ni
 *      `move.resolved`, et `Decision.pending` remonte jusqu'à l'appelant ;
 *   2. LE CONTEUR N'EST PAS APPELÉ tant qu'elle est ouverte ;
 *   3. la fenêtre est RENDUE en `ctx.burnWindow` sur l'intention de
 *      fermeture — et elle est relue du journal, jamais gardée en mémoire ;
 *   4. le tour reste UN SEUL GROUPE `correlation_id`, des dés à `move.resolved`.
 *
 * Plus les deux refus, qui ne sont pas le même refus : `move_in_progress` pour
 * l'acteur qui veut relancer, le filet pour ce qui écrirait sur son personnage.
 *
 * LE SCRIPT DE DÉS EST LA SONDE. Le flux `action` reçoit exactement trois
 * valeurs — dé d'action, deux dés de défi — et rien d'autre. Tout tirage
 * supplémentaire, sur n'importe quel flux qui touche la fiction, lève
 * `ScriptExhausted` au lieu de dériver une valeur. C'est ce qui rend « la
 * révision ne tire rien » et « le prix de l'échec n'est jamais tiré »
 * mesurables plutôt qu'affirmés.
 */

import { appendEvents } from '@for/db';
import { describe, expect, it } from 'vitest';

import { BurnWindowUnreadable, findOpenBurnWindows } from '../../src/game/burn-window.js';
import {
  closeAllBurnWindows,
  openBurnWindows,
  runIntent,
  wouldClose,
} from '../../src/game/intent-pipeline.js';
import { readJournalSince } from '../../src/game/journal.js';
import { loadReplay } from '../../src/game/snapshots.js';
import {
  CAMPAIGN_ID,
  CHARACTER_ID,
  OTHER_CHARACTER_ID,
  OTHER_PLAYER_ID,
  PLAYER_ID,
  aTable,
  journal,
  spyNarrator,
  uuidAt,
} from './support.test.js';

import type { GameEvent, Intent, PlayerId, RollId } from '@for/engine';
import type { BurnWindowSources } from '../../src/game/burn-window.js';
import type { Table } from './support.test.js';

/**
 * Dé d'action 1, attribut `vif` à 1 : score 2, contre des dés de défi 3 et 4.
 * Échec. Souffle 9 > 2 : la fenêtre s'ouvre. Brûlé, le score devient 9, qui
 * bat 3 et 4 : réussite FRANCHE. Un échec devenu réussite franche, ce qui est
 * exactement la mécanique que la spec décrit et que le code ne faisait pas.
 */
const OPENS_A_WINDOW: readonly number[] = [1, 3, 4];

const FACE_DANGER = {
  type: 'move.face_danger',
  attribute: 'vif',
  description: 'Traverser la crevasse.',
} as const;

async function rollWithWindow(table: Table): Promise<RollId> {
  table.rng.script('action', OPENS_A_WINDOW);
  const outcome = await runIntent(table.deps, {
    campaignId: CAMPAIGN_ID,
    playerId: PLAYER_ID,
    intentId: uuidAt(1),
    intent: FACE_DANGER,
  });
  if (outcome.kind !== 'accepted' || outcome.pending === null) {
    throw new Error(`la fenêtre ne s'est pas ouverte : ${JSON.stringify(outcome)}`);
  }
  return outcome.pending.roll.rollId;
}

describe('le premier temps : le tour reste ouvert', () => {
  it('écrit les dés, et rien d’autre', async () => {
    const table = aTable();
    try {
      table.rng.script('action', OPENS_A_WINDOW);
      const outcome = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });

      expect(outcome.kind).toBe('accepted');
      if (outcome.kind !== 'accepted') return;
      expect(outcome.events.map((event) => event.type)).toEqual([
        'move.declared',
        'roll.action_resolved',
      ]);
      expect(outcome.pending).not.toBeNull();
      expect(outcome.pending?.characterId).toBe(CHARACTER_ID);
      expect(outcome.pending?.outcome).toBe('echec');

      // NI EFFET, NI PRIX. `face-danger` sur un échec tire le prix ; il n'est
      // pas tiré, et le script du flux `price` — vide — le prouverait en
      // levant si quelque chose l'avait touché.
      expect(journal(table.connection).map((row) => row.type)).not.toContain('roll.price_paid');
      expect(journal(table.connection).map((row) => row.type)).not.toContain('move.resolved');

      // LA JAUGE N'A PAS BOUGÉ : le tour n'a appliqué aucune conséquence.
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect(state.characters[CHARACTER_ID]?.momentum).toBe(9);
    } finally {
      table.close();
    }
  });

  it('ne fait pas parler le conteur', async () => {
    const table = aTable();
    try {
      let spoke = 0;
      const spy = spyNarrator(table.deps.narrator, () => {
        spoke += 1;
      });

      table.rng.script('action', OPENS_A_WINDOW);
      await runIntent(
        { ...table.deps, narrator: spy },
        {
          campaignId: CAMPAIGN_ID,
          playerId: PLAYER_ID,
          intentId: uuidAt(1),
          intent: FACE_DANGER,
        },
      );

      // Raconter une issue que le joueur va réviser, c'est raconter le tour
      // deux fois.
      expect(spoke).toBe(0);
      expect(journal(table.connection).map((row) => row.type)).not.toContain(
        'narration.gm_message',
      );
    } finally {
      table.close();
    }
  });

  it('relit la fenêtre du journal, sans rien avoir gardé en mémoire', async () => {
    const table = aTable();
    try {
      await rollWithWindow(table);
      // Aucun état de processus n'est consulté : le journal et la table des
      // intentions suffisent à rebâtir la fenêtre, champ par champ.
      const rebuilt = openBurnWindows(
        table.deps,
        CAMPAIGN_ID,
        readJournalSince(table.connection, CAMPAIGN_ID, 0),
      )[0];
      expect(rebuilt?.characterId).toBe(CHARACTER_ID);
      expect(rebuilt?.roll.total).toBe(2);
      expect(rebuilt?.roll.challengeDice).toEqual([3, 4]);
      expect(rebuilt?.roll.burned).toBe(false);
    } finally {
      table.close();
    }
  });
});

describe('le second temps : la brûlure réécrit l’issue', () => {
  it('transforme l’échec en réussite franche, sans tirer un seul dé', async () => {
    const table = aTable();
    try {
      const rollId = await rollWithWindow(table);
      // LE SCRIPT EST VIDE À PARTIR D'ICI. Un tirage, sur n'importe quel flux
      // qui touche la fiction, lève au lieu de produire une valeur.
      expect(table.rng.left('action')).toBe(0);

      const closed = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: { type: 'momentum.burn', rollId },
      });

      expect(closed.kind).toBe('accepted');
      if (closed.kind !== 'accepted') return;
      expect(closed.events.map((event) => event.type)).toEqual([
        'character.momentum_burned',
        'roll.action_revised',
        'character.momentum_changed',
        'move.resolved',
      ]);
      expect(closed.pending).toBeNull();

      const revised = closed.events.find((event) => event.type === 'roll.action_revised');
      expect(revised?.payload).toMatchObject({ total: 9, outcome: 'franche' });

      const resolved = closed.events.find((event) => event.type === 'move.resolved');
      expect(resolved?.payload).toMatchObject({ outcome: 'franche' });

      // LE PRIX DE L'ÉCHEC N'EST JAMAIS PAYÉ.
      expect(journal(table.connection).map((row) => row.type)).not.toContain('roll.price_paid');

      // LE SOUFFLE EST DÉPENSÉ AVANT L'EFFET DE L'ISSUE RÉVISÉE : retombe à 2,
      // puis +1 de la réussite franche.
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect(state.characters[CHARACTER_ID]?.momentum).toBe(3);
    } finally {
      table.close();
    }
  });

  it('n’a réécrit ni le premier jet, ni son groupe', async () => {
    const table = aTable();
    try {
      const rollId = await rollWithWindow(table);
      const rolled = readJournalSince(table.connection, CAMPAIGN_ID, 0).find(
        (event) => event.type === 'roll.action_resolved',
      );

      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: { type: 'momentum.burn', rollId },
      });

      const after = readJournalSince(table.connection, CAMPAIGN_ID, 0);
      const stillThere = after.find((event) => event.type === 'roll.action_resolved');
      // LE JOURNAL EST EN AJOUT SEUL : on ajoute la révision, on ne réécrit pas
      // le jet. Comparé champ à champ plutôt que par identité d'objet — les
      // deux lectures sont deux objets différents.
      expect(JSON.stringify(stillThere)).toBe(JSON.stringify(rolled));

      const revised = after.find((event) => event.type === 'roll.action_revised');
      expect(revised?.payload).toMatchObject({ revisedFromSeq: rolled?.seq });
      const resolved = after.find((event) => event.type === 'move.resolved');
      // `move.resolved.rollSeq` pointe sur LE JET, pas sur la révision : la
      // preuve « Pourquoi ? » garde les dés.
      expect(resolved?.payload).toMatchObject({ rollSeq: rolled?.seq });

      // UN SEUL TOUR, UN SEUL GROUPE — des dés jusqu'à `move.resolved`.
      const group = new Set(
        after
          .filter((event) => event.seq >= (rolled?.seq ?? 0))
          .map((event) => event.correlationId),
      );
      expect(group).toEqual(new Set([uuidAt(1)]));
    } finally {
      table.close();
    }
  });

  it('refuse un `momentum.burn` qui vise un autre jet', async () => {
    const table = aTable();
    try {
      await rollWithWindow(table);
      const stale = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: { type: 'momentum.burn', rollId: OTHER_CHARACTER_ID as unknown as RollId },
      });
      expect(stale.kind).toBe('rejected');
      if (stale.kind !== 'rejected') return;
      expect(stale.violation.code).toBe('no_burn_window');
    } finally {
      table.close();
    }
  });
});

describe('les deux refus, qui ne sont pas le même refus', () => {
  it('refuse `move_in_progress` à l’acteur qui veut relancer', async () => {
    const table = aTable();
    try {
      await rollWithWindow(table);
      // Rien n'est remis dans le script : le refus doit tomber AVANT les dés.
      const refused = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: FACE_DANGER,
      });

      expect(refused.kind).toBe('rejected');
      if (refused.kind !== 'rejected') return;
      expect(refused.violation.code).toBe('move_in_progress');
      // ET SURTOUT PAS `not_your_turn`, qui n'existe dans aucune union de ce
      // dépôt : la table reste libre, c'est ce joueur-là qui a une décision en
      // attente.
      expect(JSON.stringify(refused.violation)).not.toContain('not_your_turn');
    } finally {
      table.close();
    }
  });

  it('ferme la fenêtre comme un `momentum.keep` avant de traiter autre chose', async () => {
    const table = aTable();
    try {
      await rollWithWindow(table);
      // Le filet ferme comme un `momentum.keep` : les effets de l'issue
      // INITIALE s'appliquent, et l'échec de `face-danger` tire le prix. Le
      // d12 est scripté ici, et lui seul : c'est la seule chose que cette
      // fermeture a le droit de tirer. Deux valeurs, parce que l'entrée tirée
      // propose plusieurs effets et que c'est ENCORE le moteur qui départage,
      // par un second tirage sur le même flux (ADR 0006).
      table.rng.script('price', [1, 1]);
      const said = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: { type: 'speech.say', channel: 'ic', text: 'On continue.' },
      });

      expect(said.kind).toBe('accepted');
      const types = journal(table.connection).map((row) => row.type);
      // Le filet a fermé D'ABORD : le prix de l'issue INITIALE, puis
      // `move.resolved`, puis seulement la parole — et la narration de CE
      // tour-là, qui n'avait pas le droit de partir avant.
      expect(types.slice(-5)).toEqual([
        'roll.price_paid',
        'character.gauge_changed',
        'move.resolved',
        'narration.player_message',
        'narration.gm_message',
      ]);
      // Le souffle n'a pas été dépensé : `momentum.keep` ne coûte rien.
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect(state.characters[CHARACTER_ID]?.momentum).toBe(9);
    } finally {
      table.close();
    }
  });

  it('la fenêtre disparaît dès qu’une entrée d’un AUTRE tour du même personnage la suit', async () => {
    const table = aTable();
    try {
      await rollWithWindow(table);
      const before = readJournalSince(table.connection, CAMPAIGN_ID, 0);
      expect(openBurnWindows(table.deps, CAMPAIGN_ID, before)).toHaveLength(1);

      // Le prédicat du moteur, et rien d'autre, décide de la fermeture : on
      // ajoute une entrée du MÊME personnage après le jet. La copie prise est
      // le `move.declared` et non le jet, pour que l'entrée ajoutée ne soit
      // pas elle-même une nouvelle fenêtre.
      const declared = before.find((event) => event.type === 'move.declared');
      expect(declared).toBeDefined();
      if (declared === undefined) return;

      const later = [
        ...before,
        { ...declared, seq: 999, subjectCharacterId: CHARACTER_ID, correlationId: uuidAt(9) },
      ];
      expect(openBurnWindows(table.deps, CAMPAIGN_ID, later)).toEqual([]);

      // Une entrée d'un AUTRE personnage ne la ferme pas.
      const elsewhere = [
        ...before,
        { ...declared, seq: 999, subjectCharacterId: OTHER_CHARACTER_ID, correlationId: uuidAt(9) },
      ];
      expect(openBurnWindows(table.deps, CAMPAIGN_ID, elsewhere)).toHaveLength(1);

      // ET UNE ENTRÉE DU TOUR LUI-MÊME NE LA FERME PAS. Le tour qui ouvre la
      // fenêtre continue d'écrire sur son propre personnage après les dés —
      // c'est le groupe, et non le sujet, qui dit « c'est le même tour ».
      const ownTurn = [...before, { ...declared, seq: 999, subjectCharacterId: CHARACTER_ID }];
      expect(openBurnWindows(table.deps, CAMPAIGN_ID, ownTurn)).toHaveLength(1);
    } finally {
      table.close();
    }
  });

  /**
   * DES DÉS JUMEAUX TIRENT UN PRÉSAGE, et ce présage porte le personnage du
   * jet, à un `seq` plus haut. Demander « la fenêtre est-elle fermée ? » à
   * `burnWindowClosedBy` sur TOUTE la suite du journal la refermait donc À
   * L'INSTANT OÙ ELLE S'OUVRAIT : les deux fermetures refusées
   * `no_burn_window`, aucun `move.resolved`, aucun effet, aucun prix. Un jet
   * brûlable sur dix environ, puisqu'un présage est une paire de dés de défi
   * identiques. Même cause pour `character.momentum_negated`, sur un dé
   * d'action annulé.
   */
  it('survit à son propre présage, et se brûle quand même', async () => {
    const table = aTable();
    try {
      // Dé d'action 1 + `vif` 1 = 2 contre 4 et 4 : échec, et dés jumeaux.
      table.rng.script('action', [1, 4, 4]);
      table.rng.script('presage', [1]);
      const opened = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      expect(opened.kind).toBe('accepted');
      if (opened.kind !== 'accepted' || opened.pending === null) return;

      // Le présage est bien écrit, sur le personnage du jet et APRÈS lui.
      const written = readJournalSince(table.connection, CAMPAIGN_ID, 0);
      const presage = written.find((event) => event.type === 'roll.presage_drawn');
      expect(presage?.subjectCharacterId).toBe(CHARACTER_ID);
      expect(presage?.seq).toBeGreaterThan(opened.pending.rollSeq);

      // Et la fenêtre est toujours là.
      expect(openBurnWindows(table.deps, CAMPAIGN_ID, written)).toHaveLength(1);

      const burned = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: { type: 'momentum.burn', rollId: opened.pending.roll.rollId },
      });
      expect(burned.kind).toBe('accepted');
      if (burned.kind !== 'accepted') return;
      expect(burned.events.map((event) => event.type)).toContain('move.resolved');
    } finally {
      table.close();
    }
  });

  it('sait dire qu’une intention écrirait sur le personnage de la fenêtre', async () => {
    const table = aTable();
    try {
      await rollWithWindow(table);
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const open = openBurnWindows(
        table.deps,
        CAMPAIGN_ID,
        readJournalSince(table.connection, CAMPAIGN_ID, 0),
      )[0];
      expect(open).toBeDefined();
      if (open === undefined) return;

      // AUCUNE INTENTION DE M0 N'ATTEINT CETTE BRANCHE depuis le pipeline —
      // les onze mouvements, les oracles et la parole écrivent tous sur LEUR
      // acteur, que `sameCharacter` attrape d'abord. Elle est donc mesurée
      // directement, pour qu'elle marche le jour où M0-29 lui donne un
      // producteur.
      expect(
        wouldClose(
          table.deps,
          state,
          CHARACTER_ID,
          { type: 'speech.say', channel: 'ic', text: 'x' },
          open,
        ),
      ).toBe(true);
      expect(
        wouldClose(
          table.deps,
          state,
          OTHER_CHARACTER_ID,
          { type: 'speech.say', channel: 'ic', text: 'x' },
          open,
        ),
      ).toBe(false);
    } finally {
      table.close();
    }
  });
});

/**
 * DEUX FENÊTRES OUVERTES EN MÊME TEMPS, qui est l'état NORMAL d'une table
 * libre et non un cas limite.
 *
 * `ARCHITECTURE.md` §4.4 : « Ordre du tour : aucun. » La fenêtre s'ouvre dès
 * que le souffle dépasse le score, donc deux joueurs l'ont ouverte ensemble à
 * la première occasion venue. Chercher « la dernière fenêtre du journal »
 * faisait alors répondre le jet de B à la place de celui de A : les DEUX
 * fermetures de A refusées `no_burn_window`, son `move.resolved` jamais écrit,
 * ses effets et son prix jamais appliqués, et `move_in_progress` qui ne le
 * refusait plus. Un tour perdu en silence.
 */
describe('deux fenêtres ouvertes à la fois', () => {
  /** Ouvre une fenêtre pour un joueur donné et rend l'identifiant de son jet. */
  async function windowFor(table: Table, playerId: PlayerId, n: number): Promise<RollId> {
    const outcome = await runIntent(table.deps, {
      campaignId: CAMPAIGN_ID,
      playerId,
      intentId: uuidAt(n),
      intent: FACE_DANGER,
    });
    if (outcome.kind !== 'accepted' || outcome.pending === null) {
      throw new Error(`la fenêtre ne s'est pas ouverte : ${JSON.stringify(outcome)}`);
    }
    return outcome.pending.roll.rollId;
  }

  it('A et B ouvrent chacun la leur, chacun ferme la sienne, aucun tour n’est orphelin', async () => {
    const table = aTable();
    try {
      // Deux jets, dans cet ordre : A d'abord, B ensuite. La fenêtre de B est
      // donc LA DERNIÈRE du journal quand A répond.
      //
      // TROIS SCRIPTS ET NON DEUX : quand B déclare, le filet demande au
      // moteur ce que ce mouvement écrirait — une décision à blanc, jetée
      // aussitôt. Jetée ou non, elle LIT le script. Le troisième lot est le
      // prix de cette question, et il est écrit ici plutôt que caché.
      table.rng.script('action', [...OPENS_A_WINDOW, ...OPENS_A_WINDOW, ...OPENS_A_WINDOW]);
      // Les identifiants d'intention sont VOLONTAIREMENT à contre-sens de
      // l'ordre des jets : A joue le premier avec `uuidAt(2)`, B le second
      // avec `uuidAt(1)`. Le tableau attendu plus bas n'est donc trié par
      // rien, et un test qui le rendrait dans l'ordre alphabétique se
      // trahirait.
      const rollA = await windowFor(table, PLAYER_ID, 2);
      const rollB = await windowFor(table, OTHER_PLAYER_ID, 1);
      expect(rollA).not.toBe(rollB);
      expect(
        openBurnWindows(table.deps, CAMPAIGN_ID, readJournalSince(table.connection, CAMPAIGN_ID, 0))
          .map((window) => window.characterId)
          .sort(),
      ).toEqual([CHARACTER_ID, OTHER_CHARACTER_ID].sort());

      // A RÉPOND LE PREMIER, ALORS QUE LA FENÊTRE DE B EST LA DERNIÈRE DU
      // JOURNAL. C'est la mesure : chercher « la dernière » rend ici celle de
      // B, et les deux fermetures de A tombent en `no_burn_window`.
      const burned = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(3),
        intent: { type: 'momentum.burn', rollId: rollA },
      });
      expect(burned.kind).toBe('accepted');

      table.rng.script('price', [1, 1]);
      const kept = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: OTHER_PLAYER_ID,
        intentId: uuidAt(4),
        intent: { type: 'momentum.keep', rollId: rollB },
      });
      expect(kept.kind).toBe('accepted');

      // AUCUN TOUR ORPHELIN : chaque groupe porte son `move.resolved`, dans
      // l'ordre où les joueurs ont répondu — celui de A (`uuidAt(2)`) avant
      // celui de B (`uuidAt(1)`). Le tableau EXACT, pas un `arrayContaining` :
      // deux entrées, dans un ordre qui n'est ni celui des identifiants ni
      // celui d'un tri.
      const after = readJournalSince(table.connection, CAMPAIGN_ID, 0);
      expect(
        after.filter((event) => event.type === 'move.resolved').map((event) => event.correlationId),
      ).toEqual([uuidAt(2), uuidAt(1)]);
      expect(openBurnWindows(table.deps, CAMPAIGN_ID, after)).toEqual([]);

      // ET CHACUN A EU SON ISSUE À LUI. A a brûlé : l'échec est devenu une
      // réussite franche, l'âme reste à 5 et le souffle retombe. B a gardé :
      // il prend les dégâts de l'échec et n'a rien dépensé.
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect(state.characters[CHARACTER_ID]?.gauges.ame).toBe(5);
      expect(state.characters[OTHER_CHARACTER_ID]?.gauges.ame).toBe(4);
      expect(state.characters[OTHER_CHARACTER_ID]?.momentum).toBe(9);
      expect(state.characters[CHARACTER_ID]?.momentum).toBeLessThan(9);
    } finally {
      table.close();
    }
  });

  it('refuse encore `move_in_progress` à A quand la fenêtre de B est la dernière', async () => {
    const table = aTable();
    try {
      table.rng.script('action', [...OPENS_A_WINDOW, ...OPENS_A_WINDOW, ...OPENS_A_WINDOW]);
      await windowFor(table, PLAYER_ID, 1);
      await windowFor(table, OTHER_PLAYER_ID, 2);

      // Rien n'est remis dans le script : le refus doit tomber AVANT les dés.
      const refused = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(3),
        intent: FACE_DANGER,
      });
      expect(refused.kind).toBe('rejected');
      if (refused.kind !== 'rejected') return;
      expect(refused.violation.code).toBe('move_in_progress');
    } finally {
      table.close();
    }
  });

  it('le filet ferme la fenêtre du personnage concerné, pas la dernière', async () => {
    const table = aTable();
    try {
      table.rng.script('action', [...OPENS_A_WINDOW, ...OPENS_A_WINDOW, ...OPENS_A_WINDOW]);
      const rollA = await windowFor(table, PLAYER_ID, 1);
      await windowFor(table, OTHER_PLAYER_ID, 2);

      // A parle : le filet doit fermer LA SIENNE, pas celle de B, qui est la
      // dernière du journal.
      table.rng.script('price', [1, 1]);
      const said = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(3),
        intent: { type: 'speech.say', channel: 'ic', text: 'On continue.' },
      });
      expect(said.kind).toBe('accepted');

      const after = readJournalSince(table.connection, CAMPAIGN_ID, 0);
      expect(
        after.filter((event) => event.type === 'move.resolved').map((event) => event.correlationId),
      ).toEqual([uuidAt(1)]);
      // Celle de B est intacte, et elle est toujours fermable par son jet.
      expect(
        openBurnWindows(table.deps, CAMPAIGN_ID, after).map((window) => window.characterId),
      ).toEqual([OTHER_CHARACTER_ID]);
      expect(rollA).not.toBe('');
    } finally {
      table.close();
    }
  });
});

/**
 * LE PLAN DU MOUVEMENT EST CELUI DE LA DÉCLARATION, et le serveur le rebâtit
 * du journal plutôt que de le stocker.
 *
 * `03-donnees.md` §3.4 : « le plan du mouvement est porté par la fenêtre,
 * jamais recalculé à la fermeture ». La fenêtre de ce serveur est DÉRIVÉE —
 * rien n'est écrit nulle part —, donc « porté » s'y écrit « rejoué depuis le
 * préfixe qui l'a produit » : le journal jusqu'au `move.declared`, réduit, et
 * le plan calculé contre CET état-là. La différence se voit quand l'état a
 * bougé depuis, et `scene.ended` est le cas que le moteur nomme : il ne porte
 * aucun personnage en sujet, donc le filet ne le voit pas passer.
 */
describe('la scène se ferme entre les dés et la décision', () => {
  const FOE = '0000000000000000000000FOEE';

  /** Une entrée d'ambiance écrite à la main, hors de tout tour de jeu. */
  function ambient(table: Table, type: string, payload: unknown): void {
    appendEvents(table.connection, {
      campaignId: CAMPAIGN_ID,
      now: table.clock.now(),
      events: [
        {
          id: table.ids.next(),
          type,
          payload,
          payloadVersion: 1,
          actorKind: 'system' as const,
          subjectCharacterId: null,
          correlationId: uuidAt(9),
          scope: 'table' as const,
          recipients: null,
          createdAt: table.clock.now(),
        },
      ],
    });
  }

  it('ferme quand même : le plan vient de la déclaration, pas de l’état d’après', async () => {
    const table = aTable();
    try {
      const sceneId = table.ids.next();
      ambient(table, 'scene.started', {
        sceneId,
        title: 'La crête',
        entityIds: [FOE],
        presentCharacterIds: [CHARACTER_ID],
      });

      // `fer` vaut 2, dé d'action 1 : score 3 contre 4 et 5, échec. Souffle 9
      // au-dessus de 3 : la fenêtre s'ouvre.
      table.rng.script('action', [1, 4, 5]);
      const opened = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: { type: 'move.strike', targetId: FOE, attribute: 'fer' },
      });
      expect(opened.kind).toBe('accepted');
      if (opened.kind !== 'accepted' || opened.pending === null) return;
      const rollId = opened.pending.roll.rollId;

      // LA SCÈNE SE FERME. `scene.ended` ne porte aucun sujet, donc le filet
      // ne la voit pas et la fenêtre reste ouverte — c'est exactement l'état
      // que le moteur refusait de fermer quand il replanifiait.
      ambient(table, 'scene.ended', { sceneId });
      expect(loadReplay(table.connection, CAMPAIGN_ID).state.scene).toBeNull();
      expect(
        openBurnWindows(
          table.deps,
          CAMPAIGN_ID,
          readJournalSince(table.connection, CAMPAIGN_ID, 0),
        ).map((window) => window.characterId),
      ).toEqual([CHARACTER_ID]);

      const closed = await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(2),
        intent: { type: 'momentum.burn', rollId },
      });

      // NI `no_active_scene`, NI `target_not_present` : le plan a été rejoué
      // contre l'état d'AVANT la déclaration, où la scène tenait encore.
      expect(closed.kind).toBe('accepted');
      if (closed.kind !== 'accepted') return;
      expect(closed.events.map((event) => event.type)).toContain('move.resolved');
    } finally {
      table.close();
    }
  });
});

/**
 * UNE FENÊTRE OUVERTE QU'ON NE SAIT PAS RELIRE EST UNE INSTALLATION CASSÉE,
 * et elle se refuse bruyamment.
 *
 * Répondre « pas de fenêtre » laisserait un tour dont les conséquences ne
 * seront jamais appliquées et dont le joueur n'apprend rien : exactement le
 * symptôme de B1, pris par l'autre bout. Les quatre pièces — le groupe, la
 * déclaration, l'intention, le plan — sont écrites dans la MÊME transaction
 * que les entrées : elles existent ensemble ou pas du tout.
 *
 * La couverture a désigné ce bloc : les quatre levées, et la classe
 * elle-même, n'étaient construites par aucun test.
 */
describe('la fenêtre illisible', () => {
  /** Ce que `body` a levé, ou `null` — pour asserter hors de tout `catch`. */
  function thrownBy(body: () => unknown): unknown {
    try {
      body();
    } catch (error) {
      return error;
    }
    return null;
  }

  /** Un journal réel, avec sa fenêtre ouverte, et de quoi la relire. */
  async function opened(table: Table): Promise<{
    events: GameEvent[];
    sources: BurnWindowSources;
    rollSeq: number;
  }> {
    await rollWithWindow(table);
    const events = [...readJournalSince(table.connection, CAMPAIGN_ID, 0)];
    const roll = events.find((event) => event.type === 'roll.action_resolved');
    if (roll === undefined) throw new Error('pas de jet');
    const real = openBurnWindows(table.deps, CAMPAIGN_ID, events)[0];
    if (real === undefined) throw new Error('pas de fenêtre');
    return {
      events,
      sources: { intentFor: () => real.intent, planFor: () => real.plan },
      rollSeq: roll.seq,
    };
  }

  it('refuse les quatre pièces manquantes, et les nomme — et lit tout quand elles sont là', async () => {
    const table = aTable();
    try {
      const { events, sources, rollSeq } = await opened(table);

      // LE SENS VERT D'ABORD : les quatre pièces présentes, une fenêtre lue.
      expect(findOpenBurnWindows(events, sources)).toHaveLength(1);

      // 1. LE GROUPE. Une entrée de jet sans `correlation_id` : rien de ce que
      //    ce pipeline écrit n'a cette forme.
      const noGroup = events.map((event) =>
        event.seq === rollSeq ? { ...event, correlationId: null } : event,
      );
      expect(() => findOpenBurnWindows(noGroup, sources)).toThrow(/groupe|group/);

      // 2. LA DÉCLARATION. Le groupe est là, le `move.declared` n'y est plus.
      const noDeclaration = events.filter((event) => event.type !== 'move.declared');
      expect(() => findOpenBurnWindows(noDeclaration, sources)).toThrow(/declaration/);

      // 3. L'INTENTION. La ligne de la table `intents` a disparu.
      expect(() => findOpenBurnWindows(events, { ...sources, intentFor: () => null })).toThrow(
        /intent/,
      );

      // 3 bis. Ou elle est là mais ne roule pas : une intention qui n'est pas
      //        un mouvement n'a jamais pu ouvrir de fenêtre.
      expect(() =>
        findOpenBurnWindows(events, {
          ...sources,
          intentFor: (): Intent => ({ type: 'speech.say', channel: 'ic', text: 'x' }),
        }),
      ).toThrow(/intent/);

      // 4. LE PLAN. Le rejeu jusqu'à la déclaration ne rend rien.
      expect(() => findOpenBurnWindows(events, { ...sources, planFor: () => null })).toThrow(
        /plan/,
      );

      // La levée porte de quoi retrouver la ligne : la campagne et le `seq`.
      const raised = thrownBy(() =>
        findOpenBurnWindows(events, { ...sources, planFor: () => null }),
      );
      expect(raised).toBeInstanceOf(BurnWindowUnreadable);
      expect(raised).toMatchObject({ campaignId: CAMPAIGN_ID, rollSeq, reason: 'plan' });
    } finally {
      table.close();
    }
  });
});

/**
 * CE QUE LE MOTEUR NE PEUT PAS TENIR SEUL : une campagne en pause.
 *
 * `requireActiveCampaign` est la toute première question de `decide()`, avant
 * tout aiguillage : une table qui n'est plus `active` refuse TOUT, y compris
 * une fermeture. Mettre une table en pause avec une fenêtre ouverte laisse
 * donc un tour dont les dés sont lus, dont les conséquences ne seront jamais
 * appliquées, et que plus rien ne peut finir. C'est la clause écrite dans
 * `03-donnees.md` §3.4 sous le nom « contrat de M0-24 », et elle se mesure
 * dans les deux sens.
 */
describe('la clause du statut de campagne', () => {
  /** Écrit le changement de statut, comme le fera le chemin d'administration. */
  function pause(table: Table): void {
    appendEvents(table.connection, {
      campaignId: CAMPAIGN_ID,
      now: table.clock.now(),
      events: [
        {
          id: table.ids.next(),
          type: 'campaign.status_changed',
          payload: { from: 'active', to: 'paused', reason: 'pause' },
          payloadVersion: 1,
          actorKind: 'player' as const,
          subjectCharacterId: null,
          correlationId: uuidAt(8),
          scope: 'table' as const,
          recipients: null,
          createdAt: table.clock.now(),
        },
      ],
    });
  }

  it('ferme AVANT la pause ; après, plus rien ne ferme', async () => {
    const table = aTable();
    try {
      table.rng.script('action', [...OPENS_A_WINDOW, ...OPENS_A_WINDOW, ...OPENS_A_WINDOW]);
      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: OTHER_PLAYER_ID,
        intentId: uuidAt(2),
        intent: FACE_DANGER,
      });
      expect(
        openBurnWindows(
          table.deps,
          CAMPAIGN_ID,
          readJournalSince(table.connection, CAMPAIGN_ID, 0),
        ),
      ).toHaveLength(2);

      // LE SENS ROUGE D'ABORD : la pause écrite la première, les deux tours
      // sont perdus pour de bon.
      pause(table);
      expect(
        closeAllBurnWindows(table.deps, CAMPAIGN_ID).map((violation) => violation.code),
      ).toEqual(['campaign_not_active', 'campaign_not_active']);
      expect(
        readJournalSince(table.connection, CAMPAIGN_ID, 0).filter(
          (event) => event.type === 'move.resolved',
        ),
      ).toHaveLength(0);
    } finally {
      table.close();
    }
  });

  it('les deux se ferment quand l’appel précède l’écriture du statut', async () => {
    const table = aTable();
    try {
      table.rng.script('action', [...OPENS_A_WINDOW, ...OPENS_A_WINDOW, ...OPENS_A_WINDOW]);
      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: PLAYER_ID,
        intentId: uuidAt(1),
        intent: FACE_DANGER,
      });
      await runIntent(table.deps, {
        campaignId: CAMPAIGN_ID,
        playerId: OTHER_PLAYER_ID,
        intentId: uuidAt(2),
        intent: FACE_DANGER,
      });

      // Le prix de l'échec est tiré deux fois — un par tour fermé en
      // `momentum.keep` —, et rien de plus : le script est exact.
      table.rng.script('price', [1, 1, 1, 1]);
      expect(closeAllBurnWindows(table.deps, CAMPAIGN_ID)).toEqual([]);
      pause(table);

      // CHAQUE TOUR A SON `move.resolved`, DANS SON PROPRE GROUPE, et dans
      // l'ordre où les fenêtres s'étaient ouvertes.
      const after = readJournalSince(table.connection, CAMPAIGN_ID, 0);
      expect(
        after.filter((event) => event.type === 'move.resolved').map((event) => event.correlationId),
      ).toEqual([uuidAt(1), uuidAt(2)]);
      expect(openBurnWindows(table.deps, CAMPAIGN_ID, after)).toEqual([]);
      // Et les deux ont payé l'issue INITIALE : l'échec, jamais révisé.
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect([
        state.characters[CHARACTER_ID]?.gauges.ame,
        state.characters[OTHER_CHARACTER_ID]?.gauges.ame,
      ]).toEqual([4, 4]);
    } finally {
      table.close();
    }
  });
});
