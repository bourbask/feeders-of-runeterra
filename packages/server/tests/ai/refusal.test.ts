/**
 * LE DROIT DE REFUS : prouvé ou sans effet, et jamais un second mécanisme
 * d'annulation.
 *
 * Trois mesures qui vont ensemble, et c'est leur COMBINAISON qui compte :
 *
 *   - le monde revient à l'octet près à l'état d'avant la déclaration ;
 *   - l'index de tirage du flux `action`, lui, NE RECULE PAS — sinon rejouer
 *     la même intention redonnerait les mêmes dés, et le refus deviendrait une
 *     machine à relancer jusqu'au bon résultat ;
 *   - le journal a GRANDI : rien n'est effacé, un tour annulé s'affiche barré.
 */

import { readFileSync } from 'node:fs';

import { canonicalJson } from '@for/db';
import { describe, expect, it } from 'vitest';

import {
  GM_REFUSAL_RATE_HIGH,
  applyRefusal,
  upheldRefusalsInWindow,
} from '../../src/ai/refusal.js';
import { sceneBefore } from '../../src/ai/scene-state.js';
import { runIntent } from '../../src/game/intent-pipeline.js';
import { readCorrelationGroup, readJournalSince } from '../../src/game/journal.js';
import { loadReplay } from '../../src/game/snapshots.js';
import {
  CAMPAIGN_ID,
  CHARACTER_ID,
  NPC_DEAD_NAME,
  NPC_GONE_NAME,
  NPC_PRESENT_NAME,
  PLAYER_ID,
  anAiTable,
  capturingLogger,
  uuidAt,
} from './support.test.js';

import type { SceneBlockRefusal } from '@for/contracts';
import type { CampaignState, Intent } from '@for/engine';
import type { RefusalDeps } from '../../src/ai/refusal.js';
import type { Table } from '../game/support.test.js';

const EPOCH = 1_700_000_000_000;

/**
 * Le hash de l'ÉTAT DE JEU, `seq` et `rng` exclus — et l'exclusion est le
 * sujet, pas une commodité, exactement comme en `tests/game/revert.test.ts`.
 * Le critère demande que les jauges reviennent ET que l'index de tirage ne
 * recule pas : un hash qui porterait sur `rng` ne pourrait jamais être égal,
 * et le critère serait faux par construction. Les deux sont mesurés
 * séparément, l'un contre l'autre.
 */
const NOT_THE_WORLD: readonly string[] = ['seq', 'rng'];

function worldHash(state: CampaignState): string {
  return canonicalJson(
    Object.fromEntries(Object.entries(state).filter(([key]) => !NOT_THE_WORLD.includes(key))),
  );
}

/** Une intention qui NOMME sa cible : R5 exige que les mots du joueur la désignent. */
const facingDanger = (target: string): Intent => ({
  type: 'move.face_danger',
  attribute: 'vif',
  description: `Frapper ${target} avant qu'il ne bouge.`,
});

/** Un jet propre : 7 contre 1 et 2. Ni prix, ni présage, ni fenêtre ouverte. */
const CLEAN = [6, 1, 2];

async function aTurn(table: Table, intentId: string, target: string): Promise<void> {
  table.rng.script('action', CLEAN);
  const outcome = await runIntent(table.deps, {
    campaignId: CAMPAIGN_ID,
    playerId: PLAYER_ID,
    intentId,
    intent: facingDanger(target),
  });
  expect(outcome.kind).toBe('accepted');
}

function refusalDeps(table: Table, over: Partial<RefusalDeps> = {}): RefusalDeps {
  return {
    connection: table.connection,
    ids: table.ids,
    logger: capturingLogger(),
    ...over,
  };
}

function refuse(
  table: Table,
  deps: RefusalDeps,
  correlationId: string,
  refusal: SceneBlockRefusal,
  target: string,
) {
  const state = loadReplay(table.connection, CAMPAIGN_ID).state;
  return applyRefusal(deps, {
    campaignId: CAMPAIGN_ID,
    correlationId,
    refusal,
    declaredCount: 1,
    state,
    sceneAtDeclaration: sceneBefore(state),
    actorCharacterId: CHARACTER_ID,
    intention:
      facingDanger(target).type === 'move.face_danger'
        ? `Frapper ${target} avant qu'il ne bouge.`
        : '',
    moveId: 'face-danger',
    actorAssets: [],
    aiCallId: '00000000000000000000000AAA',
    now: EPOCH,
  });
}

const types = (table: Table): string[] =>
  (
    table.connection
      .prepare(`SELECT type FROM events WHERE campaign_id = ? ORDER BY seq`)
      .all(CAMPAIGN_ID) as { type: string }[]
  ).map((row) => row.type);

describe('un refus non prouvé n’annule rien', () => {
  it('un prouveur qui rend `upheld` sur une cause que l’état ne prouve pas n’annule rien, et journalise `refusal_unproven`', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      await aTurn(table, uuidAt(1), NPC_PRESENT_NAME);
      const before = types(table);

      // LA SONDE DU CRITÈRE : on fait rendre `upheld` à un prouveur injecté,
      // sur une cause que l'état ne prouve PAS — Keld est présent et vivant.
      const outcome = refuse(
        table,
        refusalDeps(table, { prove: () => 'upheld' }),
        uuidAt(1),
        { cause: 'cible_absente', cible: NPC_PRESENT_NAME },
        NPC_PRESENT_NAME,
      );

      expect(outcome.kind).toBe('rejected');
      if (outcome.kind !== 'rejected') return;
      expect(outcome.reason).toBe('refusal_unproven');

      // AUCUN `system.reverted`.
      const after = types(table);
      expect(after).not.toContain('system.reverted');
      // Et la trace attendue, avec son `reasonCode`.
      expect(after.slice(before.length)).toEqual([
        'narration.gm_proposal',
        'narration.proposal_rejected',
      ]);
      const rejected = table.connection
        .prepare(
          `SELECT payload_json FROM events WHERE campaign_id = ?
             AND type = 'narration.proposal_rejected' ORDER BY seq DESC LIMIT 1`,
        )
        .get(CAMPAIGN_ID) as { payload_json: string };
      expect(JSON.parse(rejected.payload_json)).toMatchObject({
        reasonCode: 'refusal_unproven',
      });
    } finally {
      table.close();
    }
  });

  it('et le prouveur injecté peut RESTREINDRE : il ne peut jamais accorder', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      await aTurn(table, uuidAt(1), NPC_GONE_NAME);
      // Sigrid est PARTIE : `cible_absente` est prouvée par l'état. Un
      // prouveur injecté qui refuse doit l'emporter.
      const outcome = refuse(
        table,
        refusalDeps(table, { prove: () => ({ rejected: 'refusal_off_target' }) }),
        uuidAt(1),
        { cause: 'cible_absente', cible: NPC_GONE_NAME },
        NPC_GONE_NAME,
      );
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind !== 'rejected') return;
      expect(outcome.reason).toBe('refusal_off_target');
      expect(types(table)).not.toContain('system.reverted');
    } finally {
      table.close();
    }
  });

  it('R6 : un mouvement sans cible ne se refuse pas', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      await aTurn(table, uuidAt(1), NPC_GONE_NAME);
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const outcome = applyRefusal(refusalDeps(table), {
        campaignId: CAMPAIGN_ID,
        correlationId: uuidAt(1),
        refusal: { cause: 'cible_absente', cible: NPC_GONE_NAME },
        declaredCount: 1,
        state,
        sceneAtDeclaration: sceneBefore(state),
        actorCharacterId: CHARACTER_ID,
        intention: `Endurer le froid près de ${NPC_GONE_NAME}.`,
        moveId: 'endure-cold',
        actorAssets: [],
        aiCallId: '00000000000000000000000AAB',
        now: EPOCH,
      });
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind !== 'rejected') return;
      expect(outcome.reason).toBe('refusal_targetless_move');
    } finally {
      table.close();
    }
  });
});

describe('un refus retenu annule le groupe entier', () => {
  it('le hash de l’état de JEU revient, l’index de tirage ne recule pas', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const before = loadReplay(table.connection, CAMPAIGN_ID).state;
      const worldBefore = worldHash(before);
      const drawsBefore = before.rng.draws.action ?? 0;
      const linesBefore = types(table).length;

      await aTurn(table, uuidAt(1), NPC_GONE_NAME);
      const moved = loadReplay(table.connection, CAMPAIGN_ID).state;
      expect(worldHash(moved)).not.toBe(worldBefore);

      const outcome = refuse(
        table,
        refusalDeps(table),
        uuidAt(1),
        { cause: 'cible_absente', cible: NPC_GONE_NAME },
        NPC_GONE_NAME,
      );
      expect(outcome.kind).toBe('upheld');
      if (outcome.kind !== 'upheld') return;

      const after = loadReplay(table.connection, CAMPAIGN_ID).state;

      // (1) LE MONDE EST REVENU, à l'octet.
      expect(worldHash(after)).toBe(worldBefore);

      // (2) L'INDEX DE TIRAGE N'A PAS RECULÉ. Deux opérandes, deux origines :
      // l'index d'AVANT le tour, lu sur l'état d'avant, et celui d'APRÈS
      // l'annulation, lu sur l'état d'après.
      expect(after.rng.draws.action ?? 0).toBeGreaterThan(drawsBefore);

      // (3) RIEN N'EST EFFACÉ : le journal a grandi, et le jet est toujours là.
      const written = types(table);
      expect(written.length).toBeGreaterThan(linesBefore);
      expect(written).toContain('roll.action_resolved');
      expect(written).toContain('system.reverted');
    } finally {
      table.close();
    }
  });

  it('annule le GROUPE complet — le jet ET la jauge qu’il a fait bouger', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      await aTurn(table, uuidAt(1), NPC_GONE_NAME);
      const group = readCorrelationGroup(table.connection, CAMPAIGN_ID, uuidAt(1));
      const outcome = refuse(
        table,
        refusalDeps(table),
        uuidAt(1),
        { cause: 'cible_absente', cible: NPC_GONE_NAME },
        NPC_GONE_NAME,
      );
      expect(outcome.kind).toBe('upheld');
      if (outcome.kind !== 'upheld') return;

      expect([...outcome.targetSeqs]).toEqual(group.map((event) => event.seq));
      const cancelledTypes = group
        .filter((event) => outcome.targetSeqs.includes(event.seq))
        .map((event) => event.type);
      expect(cancelledTypes).toContain('roll.action_resolved');
      expect(cancelledTypes).toContain('character.momentum_changed');
      expect(cancelledTypes).toContain('move.declared');
    } finally {
      table.close();
    }
  });

  it('la trace du refus reste HORS des lignes barrées', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      await aTurn(table, uuidAt(1), NPC_GONE_NAME);
      const outcome = refuse(
        table,
        refusalDeps(table),
        uuidAt(1),
        { cause: 'cible_absente', cible: NPC_GONE_NAME },
        NPC_GONE_NAME,
      );
      expect(outcome.kind).toBe('upheld');
      if (outcome.kind !== 'upheld') return;

      const group = readCorrelationGroup(table.connection, CAMPAIGN_ID, uuidAt(1));
      const trace = group.filter(
        (event) =>
          event.type === 'narration.gm_proposal' || event.type === 'narration.proposal_accepted',
      );
      // Elle est DANS le groupe — un tour, un groupe, « Pourquoi ? » reste
      // adressable — et PAS dans `targetSeqs` : on ne peut pas mesurer ce
      // qu'on efface (§4.8.5).
      expect(trace).toHaveLength(2);
      for (const event of trace) expect(outcome.targetSeqs).not.toContain(event.seq);
    } finally {
      table.close();
    }
  });

  it('`system.reverted` porte `targetSeqs` et la cause, préfixée', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      await aTurn(table, uuidAt(1), NPC_DEAD_NAME);
      const outcome = refuse(
        table,
        refusalDeps(table),
        uuidAt(1),
        { cause: 'cible_morte', cible: NPC_DEAD_NAME },
        NPC_DEAD_NAME,
      );
      expect(outcome.kind).toBe('upheld');

      const reverted = readJournalSince(table.connection, CAMPAIGN_ID, 0).find(
        (event) => event.type === 'system.reverted',
      );
      expect(reverted?.payload).toMatchObject({ reason: 'gm_refusal:cible_morte' });
      expect(
        (reverted?.payload as { readonly targetSeqs: readonly number[] }).targetSeqs.length,
      ).toBeGreaterThan(1);
      // C'est le SYSTÈME qui écrit, pas le modèle.
      expect(reverted?.actorKind).toBe('system');
    } finally {
      table.close();
    }
  });

  it('annuler deux fois est refusé, jamais répété', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      await aTurn(table, uuidAt(1), NPC_GONE_NAME);
      const first = refuse(
        table,
        refusalDeps(table),
        uuidAt(1),
        { cause: 'cible_absente', cible: NPC_GONE_NAME },
        NPC_GONE_NAME,
      );
      expect(first.kind).toBe('upheld');
      const second = refuse(
        table,
        refusalDeps(table),
        uuidAt(1),
        { cause: 'cible_absente', cible: NPC_GONE_NAME },
        NPC_GONE_NAME,
      );
      expect(second.kind).toBe('rejected');
      expect(types(table).filter((type) => type === 'system.reverted')).toHaveLength(1);
    } finally {
      table.close();
    }
  });
});

describe('le quota', () => {
  it('au quatrième refus retenu, `refusal_quota` et une ligne `warn` portant `gm_refusal_rate_high`', async () => {
    const table = anAiTable({ momentum: 2 });
    const logger = capturingLogger();
    try {
      // TROIS refus retenus, sur trois tours différents.
      for (let index = 1; index <= 3; index += 1) {
        await aTurn(table, uuidAt(index), NPC_GONE_NAME);
        const outcome = refuse(
          table,
          refusalDeps(table, { logger }),
          uuidAt(index),
          { cause: 'cible_absente', cible: NPC_GONE_NAME },
          NPC_GONE_NAME,
        );
        expect(outcome.kind, `refus ${String(index)}`).toBe('upheld');
      }
      expect(upheldRefusalsInWindow(table.connection, CAMPAIGN_ID)).toBe(3);
      expect(logger.lines).toEqual([]);

      // LE QUATRIÈME est rejeté.
      await aTurn(table, uuidAt(4), NPC_GONE_NAME);
      const fourth = refuse(
        table,
        refusalDeps(table, { logger }),
        uuidAt(4),
        { cause: 'cible_absente', cible: NPC_GONE_NAME },
        NPC_GONE_NAME,
      );
      expect(fourth.kind).toBe('rejected');
      if (fourth.kind !== 'rejected') return;
      expect(fourth.reason).toBe('refusal_quota');

      // LA LIGNE DE JOURNAL, par ses CHAMPS : « une alerte journalisée » n'est
      // pas vérifiable, un champ l'est.
      expect(logger.lines).toHaveLength(1);
      expect(logger.lines[0]?.level).toBe('warn');
      expect(logger.lines[0]?.fields).toMatchObject({
        event: GM_REFUSAL_RATE_HIGH,
        campaignId: CAMPAIGN_ID,
      });

      // Et le tour n'a PAS été annulé.
      expect(types(table).filter((type) => type === 'system.reverted')).toHaveLength(3);
    } finally {
      table.close();
    }
  });

  it('le quota se compte depuis le JOURNAL, pas depuis un compteur de ce process', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      expect(upheldRefusalsInWindow(table.connection, CAMPAIGN_ID)).toBe(0);
      await aTurn(table, uuidAt(1), NPC_GONE_NAME);
      refuse(
        table,
        refusalDeps(table),
        uuidAt(1),
        { cause: 'cible_absente', cible: NPC_GONE_NAME },
        NPC_GONE_NAME,
      );
      // Un compteur en mémoire disparaîtrait ici ; celui-ci relit la base.
      expect(upheldRefusalsInWindow(table.connection, CAMPAIGN_ID)).toBe(1);
      // Et une fenêtre plus courte que le nombre de tours ne voit que la fin.
      expect(upheldRefusalsInWindow(table.connection, CAMPAIGN_ID, 1)).toBe(1);
    } finally {
      table.close();
    }
  });
});

describe('il n’existe aucun second mécanisme d’annulation', () => {
  it('aucun mécanisme d’effacement n’existe dans ce fichier', () => {
    // LE GREP DU CRITÈRE, rejoué à chaque exécution :
    //   grep -rn "delete\\|remove_event\\|purge" src/ai/refusal.ts | wc -l → 0
    const source = readFileSync(new URL('../../src/ai/refusal.ts', import.meta.url), 'utf8');
    const hits = source.split('\n').filter((line) => /delete|remove_event|purge/u.test(line));
    expect(hits).toEqual([]);
  });

  it('et il n’écrit aucun `system.reverted` lui-même : il appelle `revertTurn`', () => {
    const source = readFileSync(new URL('../../src/ai/refusal.ts', import.meta.url), 'utf8');
    // Le seul endroit où le type apparaît est la porte du circuit 3, et
    // l'annulation passe par `revertTurn`. Une seconde écriture se verrait ici.
    expect(source).toContain('revertTurn(deps.connection');
    expect(source.match(/appendEvents\(/gu) ?? []).toHaveLength(1);
  });
});
