/**
 * LES SEPT PROPOSITIONS, une par une.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 * Section 5 bis de `RECETTE.md` : « qu'est-ce que je n'ai pas regardé ? ». Le
 * rapport de couverture, lu du plus bas au plus haut, donnait `proposals.ts` à
 * **55 % de lignes et 45 % de branches** — six des sept constructeurs
 * n'étaient produits par aucun test, et le seul mesuré était celui d'un
 * critère. Un garde-fou posé sur un chemin que rien ne parcourt est un
 * garde-fou qu'on croit avoir.
 *
 * ── ET EN MODE PROSE SEULE, RIEN N'APPELLE CE PUITS ───────────────────────
 * ADR 0011 n'envoie aucune définition d'outil, donc aucun modèle n'atteint ces
 * sept chemins aujourd'hui. C'est précisément la raison de les mesurer
 * maintenant : le jour où la table d'outils revient, la porte du circuit 1 est
 * déjà éprouvée sur les sept, pas écrite après coup.
 */

import { describe, expect, it } from 'vitest';

import { applyProposal, clockAdvanceCap } from '../../src/ai/proposals.js';
import { loadReplay } from '../../src/game/snapshots.js';
import { CAMPAIGN_ID, NPC_PRESENT_ID, PLACE_ID, anAiTable, uuidAt } from './support.test.js';

import type { ProposalToolName } from '@for/contracts';
import type { Outcome } from '@for/engine';
import type { ProposalContext } from '../../src/ai/proposals.js';
import type { Table } from '../game/support.test.js';

const EPOCH = 1_700_000_000_000;

function propose(
  table: Table,
  tool: ProposalToolName,
  input: unknown,
  over: Partial<ProposalContext> = {},
) {
  const state = loadReplay(table.connection, CAMPAIGN_ID).state;
  const before = types(table).length;
  const answer = applyProposal(
    { connection: table.connection, ids: table.ids },
    {
      campaignId: CAMPAIGN_ID,
      correlationId: uuidAt(60),
      state,
      outcome: 'partielle',
      isPresage: false,
      now: EPOCH,
      ...over,
    },
    tool,
    input,
  );
  return { answer, written: types(table).slice(before) };
}

const types = (table: Table): string[] =>
  (
    table.connection
      .prepare(`SELECT type FROM events WHERE campaign_id = ? ORDER BY seq`)
      .all(CAMPAIGN_ID) as { type: string }[]
  ).map((row) => row.type);

describe('chaque proposition produit ses entrées, et rien d’autre', () => {
  it('propose_npc_introduce → entity.introduced, et rien de plus', () => {
    const table = anAiTable();
    try {
      const { answer, written } = propose(table, 'propose_npc_introduce', {
        name: 'Hallvard',
        role: 'batelier',
        one_line: 'Il connaît chaque passe du fleuve gelé.',
        place_id: PLACE_ID,
        disposition: 'neutre',
      });
      expect(answer.status).toBe('applied');
      expect(written).toEqual([
        'narration.gm_proposal',
        'entity.introduced',
        'narration.proposal_accepted',
      ]);
      expect(answer.resultingEventSeqs).toHaveLength(1);
    } finally {
      table.close();
    }
  });

  it('propose_thread_open → entity.introduced, de genre `thread`', () => {
    const table = anAiTable();
    try {
      const { answer, written } = propose(table, 'propose_thread_open', {
        title: 'La dette du batelier',
        summary: 'Quelqu’un du village doit une traversée à quelqu’un d’autre.',
        tied_to_kind: 'none',
        tied_to_id: '',
      });
      expect(answer.status).toBe('applied');
      expect(written).toContain('entity.introduced');
      const introduced = table.connection
        .prepare(
          `SELECT payload_json FROM events WHERE campaign_id = ?
             AND type = 'entity.introduced' ORDER BY seq DESC LIMIT 1`,
        )
        .get(CAMPAIGN_ID) as { payload_json: string };
      expect(JSON.parse(introduced.payload_json)).toMatchObject({ kind: 'thread' });
    } finally {
      table.close();
    }
  });

  it('propose_lore_fact → entity.updated sur une entité qui existe', () => {
    const table = anAiTable();
    try {
      const { answer, written } = propose(table, 'propose_lore_fact', {
        statement: 'Keld a perdu deux doigts au dernier hiver.',
        tied_to_kind: 'npc',
        tied_to_id: NPC_PRESENT_ID,
      });
      expect(answer.status).toBe('applied');
      expect(written).toEqual([
        'narration.gm_proposal',
        'entity.updated',
        'narration.proposal_accepted',
      ]);
    } finally {
      table.close();
    }
  });

  it('et un fait accroché à une entité inconnue est REJETÉ, avec sa trace', () => {
    const table = anAiTable();
    try {
      const { answer, written } = propose(table, 'propose_lore_fact', {
        statement: 'Quelqu’un a perdu quelque chose.',
        tied_to_kind: 'npc',
        tied_to_id: '0000000000000000000000ZZZZ',
      });
      expect(answer.status).toBe('rejected');
      expect(answer.reason).toBe('entité inconnue');
      // UNE PROPOSITION SANS TRACE EST UN BUG (03-donnees.md §0.5).
      expect(written).toEqual(['narration.gm_proposal', 'narration.proposal_rejected']);
    } finally {
      table.close();
    }
  });

  it('propose_clock_create → clock.created, avec les segments demandés', () => {
    const table = anAiTable();
    try {
      const { answer, written } = propose(table, 'propose_clock_create', {
        name: 'La tempête monte',
        segments: 6,
        kind: 'menace',
        rationale: 'Le ciel a changé de couleur.',
      });
      expect(answer.status).toBe('applied');
      expect(written).toContain('clock.created');
      expect(answer.applied).toMatchObject({ segments: 6 });
    } finally {
      table.close();
    }
  });

  it('propose_clock_advance : l’issue BORNE l’avance, elle ne la refuse pas', () => {
    const table = anAiTable();
    try {
      const created = propose(table, 'propose_clock_create', {
        name: 'La tempête monte',
        segments: 6,
        kind: 'menace',
        rationale: 'Le ciel a changé de couleur.',
      });
      const clockId = (created.answer.applied as { clockId: string }).clockId;

      // Le modèle demande TROIS ; l'issue `partielle` en autorise UN.
      const { answer, written } = propose(
        table,
        'propose_clock_advance',
        { clock_id: clockId, segments: 3, rationale: 'La neige tombe plus dru.' },
        { outcome: 'partielle', isPresage: false },
      );
      expect(answer.status).toBe('adjusted');
      expect(answer.reason).toBe("avance ramenée à 1 par l'issue");
      expect(written).toContain('clock.advanced');
      expect(answer.applied).toMatchObject({ from: 0, to: 1 });
    } finally {
      table.close();
    }
  });

  it('et une issue franche n’autorise aucune avance du tout', () => {
    const table = anAiTable();
    try {
      const created = propose(table, 'propose_clock_create', {
        name: 'La tempête monte',
        segments: 4,
        kind: 'menace',
        rationale: 'Le ciel a changé.',
      });
      const clockId = (created.answer.applied as { clockId: string }).clockId;
      const { answer, written } = propose(
        table,
        'propose_clock_advance',
        { clock_id: clockId, segments: 1, rationale: 'Pour voir.' },
        { outcome: 'franche', isPresage: false },
      );
      expect(answer.status).toBe('rejected');
      expect(written).toEqual(['narration.gm_proposal', 'narration.proposal_rejected']);
    } finally {
      table.close();
    }
  });

  it('une horloge inconnue est rejetée', () => {
    const table = anAiTable();
    try {
      const { answer } = propose(table, 'propose_clock_advance', {
        clock_id: '0000000000000000000000ZZZZ',
        segments: 1,
        rationale: 'Rien.',
      });
      expect(answer.status).toBe('rejected');
      expect(answer.reason).toBe('horloge inconnue');
    } finally {
      table.close();
    }
  });

  it('propose_vow_hook n’écrit AUCUNE entrée d’état : l’offre est éphémère', () => {
    const table = anAiTable();
    try {
      const { answer, written } = propose(table, 'propose_vow_hook', {
        title: 'Ramener le batelier chez lui',
        rank: 'dangereux',
        why_now: 'Le fleuve va prendre.',
      });
      expect(answer.status).toBe('applied');
      // SEULE LA TRACE. Seul le joueur peut jurer (`move.swear_a_vow`), et un
      // crochet qui ouvrirait une piste serait le modèle ouvrant une piste.
      expect(written).toEqual(['narration.gm_proposal', 'narration.proposal_accepted']);
      expect(answer.resultingEventSeqs).toEqual([]);
    } finally {
      table.close();
    }
  });

  it('un lieu inconnu fait tomber la transition, avec sa trace', () => {
    const table = anAiTable();
    try {
      const { answer, written } = propose(table, 'propose_scene_transition', {
        to_place_id: '0000000000000000000000ZZZZ',
        new_place_name: '',
      });
      expect(answer.status).toBe('rejected');
      expect(answer.reason).toBe('lieu inconnu');
      expect(written).toEqual(['narration.gm_proposal', 'narration.proposal_rejected']);
    } finally {
      table.close();
    }
  });

  it('et un lieu qui n’est pas un lieu non plus', () => {
    const table = anAiTable();
    try {
      // Keld existe, mais c'est un PNJ. `kind !== 'place'`.
      const { answer } = propose(table, 'propose_scene_transition', {
        to_place_id: NPC_PRESENT_ID,
        new_place_name: '',
      });
      expect(answer.status).toBe('rejected');
      expect(answer.reason).toBe('lieu inconnu');
    } finally {
      table.close();
    }
  });

  it('des arguments hors schéma sont abandonnés, jamais réparés', () => {
    const table = anAiTable();
    try {
      const { answer, written } = propose(table, 'propose_clock_create', {
        name: 'Sans segments valides',
        segments: 7,
        kind: 'menace',
        rationale: 'Sept n’est pas un nombre de segments.',
      });
      expect(answer.status).toBe('rejected');
      expect(answer.reason).toBe('arguments hors schéma');
      expect(written).toEqual(['narration.gm_proposal', 'narration.proposal_rejected']);
    } finally {
      table.close();
    }
  });
});

describe('le plafond d’avance d’horloge', () => {
  it('franche 0, partielle 1, échec 2 — et un présage ajoute un', () => {
    // LES QUATRE VALEURS EN TOUTES LETTRES, du §4.4 de `ARCHITECTURE.md`. Un
    // test qui recalculerait la formule comparerait le chiffre à lui-même.
    const cases: readonly [Outcome | null, boolean, number][] = [
      ['franche', false, 0],
      ['partielle', false, 1],
      ['echec', false, 2],
      ['franche', true, 1],
      ['partielle', true, 2],
      ['echec', true, 3],
      [null, false, 0],
    ];
    for (const [outcome, presage, expected] of cases) {
      expect(clockAdvanceCap(outcome, presage), `${String(outcome)}/${String(presage)}`).toBe(
        expected,
      );
    }
  });
});
