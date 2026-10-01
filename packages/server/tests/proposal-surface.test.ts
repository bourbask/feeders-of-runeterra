/**
 * LES TROIS LISTES CLOSES DE L'INVARIANT 1, CÔTÉ SERVEUR.
 *
 * ── LES ONZE VALEURS SONT ÉCRITES ICI, EN TOUTES LETTRES ───────────────────
 * Recopiées du tableau de `docs/design/03-donnees.md` §0.5, jamais importées
 * du code qu'elles gardent. C'est la seule forme qui mord : mesuré sur M0-12,
 * une liste close gardée par son NOMBRE et son PRÉFIXE laissait passer trois
 * substitutions avec 113 tests verts. Un test qui écrit
 * `expect(LISTE.length).toBe(8)` ne prouve rien ; un test qui écrit les huit
 * chaînes prouve les huit chaînes.
 *
 * ── ET ELLES RESTENT SÉPARÉES ──────────────────────────────────────────────
 * Trois listes, trois portes, neuf croisements vérifiés. Fondues, on
 * élargirait l'une en croyant toucher l'autre : `roll.oracle_resolved` par le
 * circuit des propositions, ou `system.reverted` par celui de l'oracle,
 * seraient des écritures que le garde-fou ne regarde plus.
 *
 * ── LES TROIS PATCHS QUE LE TESTEUR APPLIQUE, UN PAR UN ────────────────────
 * Élargir `AI_PROPOSABLE_EVENT_TYPES`, `AI_TOOL_EVENT_TYPES` ou
 * `AI_REFUSAL_EVENT_TYPES` dans `packages/engine/src/invariants.ts` fait
 * tomber, respectivement, « le circuit 1 atteint ces huit types, et pas un de
 * plus », « le circuit 2 … » et « le circuit 3 … ». Chacune compare un tableau
 * EXACT, pas une inclusion : un membre en plus tombe autant qu'un membre en
 * moins.
 */

import { AiCannotMutateState, assertNotAiAuthored } from '@for/engine';
import { describe, expect, it } from 'vitest';

import {
  AiSurfaceViolation,
  ORACLE_CIRCUIT,
  PROPOSAL_CIRCUIT,
  REFUSAL_CIRCUIT,
  assertOracleWritable,
  assertProposalWritable,
  assertRefusalWritable,
  gateEvents,
} from '../src/ai/proposal-surface.js';
import { applyProposal } from '../src/ai/proposals.js';
import { loadReplay } from '../src/game/snapshots.js';
import {
  CAMPAIGN_ID,
  CHARACTER_ID,
  PLACE_ID,
  SCENE_ID,
  anAiTable,
  uuidAt,
} from './ai/support.test.js';

import type { GameEvent } from '@for/engine';

// ══════════════════════════════════════════════════════════════════════════
// LES TROIS LISTES, DU TABLEAU DE 03-donnees.md §0.5. RECOPIÉES, PAS IMPORTÉES.
// ══════════════════════════════════════════════════════════════════════════

/** Circuit 1 — un outil `propose_*` **ou** le bloc `<scene_apres>`. */
const CIRCUIT_1_PROPOSITION: readonly string[] = [
  'entity.introduced',
  'entity.updated',
  'entity.status_changed',
  'clock.created',
  'clock.advanced',
  'scene.started',
  'scene.ended',
  'scene.facts_updated',
];

/** Circuit 2 — `roll_oracle`, seul outil de **lecture** qui écrive. */
const CIRCUIT_2_ORACLE: readonly string[] = ['roll.oracle_resolved', 'roll.yes_no_resolved'];

/** Circuit 3 — le **droit de refus** du conteur. */
const CIRCUIT_3_REFUS: readonly string[] = ['system.reverted'];

/** Ce qu'aucun des trois ne doit jamais atteindre. Une jauge, un jet, un cran. */
const JAMAIS: readonly string[] = [
  'character.gauge_changed',
  'character.momentum_changed',
  'character.momentum_burned',
  'character.condition_added',
  'character.died',
  'roll.action_resolved',
  'roll.action_revised',
  'roll.price_paid',
  'roll.presage_drawn',
  'track.ticked',
  'move.resolved',
];

const throwsSurface = (run: () => void): AiSurfaceViolation => {
  expect(run).toThrow(AiSurfaceViolation);
  try {
    run();
  } catch (error) {
    return error as AiSurfaceViolation;
  }
  throw new Error('inatteignable');
};

describe('les trois listes closes, tenues séparément', () => {
  it('le circuit 1 atteint ces huit types, et pas un de plus', () => {
    expect([...PROPOSAL_CIRCUIT.types]).toEqual(CIRCUIT_1_PROPOSITION);
    for (const type of CIRCUIT_1_PROPOSITION) {
      expect(() => {
        assertProposalWritable(type);
      }).not.toThrow();
    }
  });

  it('le circuit 2 atteint ces deux types, et pas un de plus', () => {
    expect([...ORACLE_CIRCUIT.types]).toEqual(CIRCUIT_2_ORACLE);
    for (const type of CIRCUIT_2_ORACLE) {
      expect(() => {
        assertOracleWritable(type);
      }).not.toThrow();
    }
  });

  it('le circuit 3 atteint ce seul type, et pas un de plus', () => {
    expect([...REFUSAL_CIRCUIT.types]).toEqual(CIRCUIT_3_REFUS);
    expect(() => {
      assertRefusalWritable('system.reverted');
    }).not.toThrow();
  });

  it('onze valeurs au total, et les trois listes sont disjointes', () => {
    const all = [...CIRCUIT_1_PROPOSITION, ...CIRCUIT_2_ORACLE, ...CIRCUIT_3_REFUS];
    expect(all).toHaveLength(11);
    expect(new Set(all).size).toBe(11);
  });

  it('aucun circuit n’accepte le type d’un autre', () => {
    // NEUF CROISEMENTS. C'est ce qui tombe le jour où quelqu'un fond les trois
    // listes en une : la fusion rendrait ces neuf appels silencieux.
    const cases: readonly [string, (type: string) => void, readonly string[]][] = [
      ['proposal', assertProposalWritable, [...CIRCUIT_2_ORACLE, ...CIRCUIT_3_REFUS]],
      ['oracle', assertOracleWritable, [...CIRCUIT_1_PROPOSITION, ...CIRCUIT_3_REFUS]],
      ['refusal', assertRefusalWritable, [...CIRCUIT_1_PROPOSITION, ...CIRCUIT_2_ORACLE]],
    ];
    for (const [circuit, gate, foreign] of cases) {
      for (const type of foreign) {
        const error = throwsSurface(() => {
          gate(type);
        });
        expect(error.circuit).toBe(circuit);
        expect(error.eventType).toBe(type);
      }
    }
  });

  it('et aucun des trois n’accepte une jauge, un jet ou un cran', () => {
    for (const type of JAMAIS) {
      for (const gate of [assertProposalWritable, assertOracleWritable, assertRefusalWritable]) {
        expect(() => {
          gate(type);
        }).toThrow(AiSurfaceViolation);
      }
    }
  });
});

describe('la porte des propositions', () => {
  const anEvent = (type: string, actorKind: GameEvent['actorKind']): GameEvent =>
    ({
      id: '00000000000000000000000001',
      campaignId: CAMPAIGN_ID,
      seq: 1,
      playSessionId: null,
      payloadVersion: 1,
      actorKind,
      actorPlayerId: null,
      subjectCharacterId: null,
      correlationId: uuidAt(1),
      causationId: null,
      rngStream: null,
      rngDrawIndex: null,
      createdAt: 0,
      scope: 'table',
      recipients: null,
      type,
      payload: {},
    }) as unknown as GameEvent;

  it('refuse aussi une entrée signée gm_ai — la dette de M0-13, branchée ici', () => {
    // `assertNotAiAuthored` était exporté, testé dans les deux sens, et appelé
    // par le seul chemin d'intention. Le chemin des propositions est celui
    // pour lequel il a été écrit, et `gateEvents` l'appelle.
    //
    // ── LE TYPE CHOISI EST LE SEUL QUI MESURE QUELQUE CHOSE ─────────────────
    // `clock.advanced` est DANS la liste 1 ET dans `ENGINE_ONLY_EVENT_TYPES` :
    // le modèle PROPOSE une avance, le MOTEUR l'écrit, donc l'entrée qui
    // atterrit porte `actorKind: 'engine'`. Une entrée de ce type signée
    // `gm_ai` est une proposition qui a sauté le serveur, et c'est exactement
    // ce que le prédicat nomme.
    //
    // Un `character.gauge_changed` signé `gm_ai` aurait été REFUSÉ PAR LA
    // PORTE DU CIRCUIT avant d'arriver au prédicat — mesuré : en retirant
    // l'appel à `assertNotAiAuthored` de `gateEvents`, ce fichier restait vert
    // avec ce type-là. Deux gardes, deux sondes.
    const proposed = anEvent('clock.advanced', 'gm_ai');
    expect(() => {
      assertProposalWritable(proposed.type);
    }).not.toThrow();
    expect(() => {
      assertNotAiAuthored(proposed);
    }).toThrow();
    expect(() => {
      gateEvents(PROPOSAL_CIRCUIT, [proposed]);
    }).toThrow(AiCannotMutateState);

    // ET DANS L'AUTRE SENS : le même type, signé par le moteur, passe.
    expect(() => {
      gateEvents(PROPOSAL_CIRCUIT, [anEvent('clock.advanced', 'engine')]);
    }).not.toThrow();
    expect(() => {
      gateEvents(PROPOSAL_CIRCUIT, [anEvent('scene.facts_updated', 'engine')]);
    }).not.toThrow();
  });

  it('attrape la première entrée fautive d’un lot, pas la dernière', () => {
    const events = [
      anEvent('scene.ended', 'engine'),
      anEvent('character.gauge_changed', 'engine'),
      anEvent('scene.started', 'engine'),
    ];
    const error = throwsSurface(() => {
      gateEvents(PROPOSAL_CIRCUIT, events);
    });
    expect(error.eventType).toBe('character.gauge_changed');
  });
});

describe('propose_scene_transition ne fait pas passer le temps (P11)', () => {
  it('n’écrit que scene.ended puis scene.started, et aucune jauge', () => {
    const table = anAiTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const before = types(table);

      const answer = applyProposal(
        { connection: table.connection, ids: table.ids },
        {
          campaignId: CAMPAIGN_ID,
          correlationId: uuidAt(50),
          state,
          outcome: 'partielle',
          isPresage: false,
          now: 1_700_000_000_000,
        },
        'propose_scene_transition',
        { to_place_id: PLACE_ID, new_place_name: '' },
      );

      expect(answer.status).toBe('applied');
      const written = types(table).slice(before.length);
      expect(written).toEqual([
        'narration.gm_proposal',
        'scene.ended',
        'scene.started',
        'narration.proposal_accepted',
      ]);
      // LE CRITÈRE, en toutes lettres : aucune jauge n'a bougé.
      expect(written).not.toContain('character.gauge_changed');
      expect(written.filter((type) => type.startsWith('character.'))).toEqual([]);

      // La scène fermée est bien celle qui était ouverte.
      const ended = rows(table).find((row) => row.type === 'scene.ended');
      expect(JSON.parse(ended?.payload_json ?? '{}')).toMatchObject({ sceneId: SCENE_ID });
    } finally {
      table.close();
    }
  });

  it('un coût ajouté au transfert de scène tombe sur la première liste close', () => {
    // LA SONDE : ce que produirait un handler qui aurait grandi d'un coût. On
    // ne patche pas le fichier — on lui donne exactement la sortie qu'il
    // produirait, et on exige que la porte la refuse.
    const cost = {
      id: '00000000000000000000000002',
      campaignId: CAMPAIGN_ID,
      seq: 2,
      playSessionId: null,
      payloadVersion: 1,
      actorKind: 'engine',
      actorPlayerId: null,
      subjectCharacterId: CHARACTER_ID,
      correlationId: uuidAt(51),
      causationId: null,
      rngStream: null,
      rngDrawIndex: null,
      createdAt: 0,
      scope: 'table',
      recipients: null,
      type: 'character.gauge_changed',
      payload: { characterId: CHARACTER_ID, gauge: 'vivres', from: 5, to: 4, delta: -1 },
    } as unknown as GameEvent;

    const error = throwsSurface(() => {
      gateEvents(PROPOSAL_CIRCUIT, [cost]);
    });
    expect(error.circuit).toBe('proposal');
    expect(error.eventType).toBe('character.gauge_changed');
  });
});

function rows(table: ReturnType<typeof anAiTable>): { type: string; payload_json: string }[] {
  return table.connection
    .prepare(`SELECT type, payload_json FROM events WHERE campaign_id = ? ORDER BY seq`)
    .all(CAMPAIGN_ID) as { type: string; payload_json: string }[];
}

function types(table: ReturnType<typeof anAiTable>): string[] {
  return rows(table).map((row) => row.type);
}
