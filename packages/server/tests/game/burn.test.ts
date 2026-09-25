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

import { describe, expect, it } from 'vitest';

import { findOpenBurnWindow } from '../../src/game/burn-window.js';
import { runIntent, wouldClose } from '../../src/game/intent-pipeline.js';
import { readJournalSince } from '../../src/game/journal.js';
import { loadReplay } from '../../src/game/snapshots.js';
import {
  CAMPAIGN_ID,
  CHARACTER_ID,
  OTHER_CHARACTER_ID,
  PLAYER_ID,
  aTable,
  journal,
  spyNarrator,
  uuidAt,
} from './support.test.js';

import type { RollId } from '@for/engine';
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
      const rebuilt = findOpenBurnWindow(
        readJournalSince(table.connection, CAMPAIGN_ID, 0),
        () => FACE_DANGER,
      );
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

  it('la fenêtre disparaît dès qu’une entrée du même personnage la suit', async () => {
    const table = aTable();
    try {
      await rollWithWindow(table);
      const before = readJournalSince(table.connection, CAMPAIGN_ID, 0);
      expect(findOpenBurnWindow(before, () => FACE_DANGER)).not.toBeNull();

      // Le prédicat du moteur, et rien d'autre, décide de la fermeture : on
      // ajoute une entrée du MÊME personnage après le jet. La copie prise est
      // le `move.declared` et non le jet, pour que l'entrée ajoutée ne soit
      // pas elle-même une nouvelle fenêtre.
      const declared = before.find((event) => event.type === 'move.declared');
      expect(declared).toBeDefined();
      if (declared === undefined) return;

      const later = [...before, { ...declared, seq: 999, subjectCharacterId: CHARACTER_ID }];
      expect(findOpenBurnWindow(later, () => FACE_DANGER)).toBeNull();

      // Une entrée d'un AUTRE personnage ne la ferme pas.
      const elsewhere = [
        ...before,
        { ...declared, seq: 999, subjectCharacterId: OTHER_CHARACTER_ID },
      ];
      expect(findOpenBurnWindow(elsewhere, () => FACE_DANGER)).not.toBeNull();
    } finally {
      table.close();
    }
  });

  it('sait dire qu’une intention écrirait sur le personnage de la fenêtre', async () => {
    const table = aTable();
    try {
      await rollWithWindow(table);
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const open = findOpenBurnWindow(
        readJournalSince(table.connection, CAMPAIGN_ID, 0),
        () => FACE_DANGER,
      );
      expect(open).not.toBeNull();
      if (open === null) return;

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
