/**
 * Every guard of `src/checks/`, VIOLATED AND RESTORED.
 *
 * The rule this file exists for: showing that a check exists is worth
 * nothing. Each `describe` below breaks exactly one thing, requires the check
 * to go red, puts it back, and requires green. Where the break is a value the
 * engine owns, the restored direction reads that value rather than a copy.
 */

import { staticContent } from '@for/content';
import {
  GAUGE_MAX,
  MAX_PROGRESS_TICKS,
  MOVE_REGISTRY,
  createInitialCampaignState,
  reduceAll,
} from '@for/engine';
import { describe, expect, it } from 'vitest';

import { checkMoveCoverage } from '../src/checks/coverage.js';
import { checkDrawCounter, checkRerollAfterRevert } from '../src/checks/determinism.js';
import { checkInvariants, stateIssues } from '../src/checks/invariants.js';
import { checkLockout, narrationSeenBy, reservedFor } from '../src/checks/lockout.js';
import { checkReplayEquivalence, deliveredTo } from '../src/checks/replay-equivalence.js';
import { createSimHarness, simSocket } from '../src/harness.js';
import { expandUlid, loadScenarios } from '../src/scenario.js';
import { createScriptedNarrator } from '../src/scripted-narrator.js';

import type { CampaignId, CharacterId, GameEvent, PlayerId } from '@for/engine';
import type { PlayerTape } from '../src/harness.js';
import type { Scenario } from '../src/scenario.js';

function scenario(prefix: string): Scenario {
  const found = loadScenarios().find((entry) => entry.id.startsWith(prefix));
  if (found === undefined) throw new Error(`aucun scénario ${prefix}`);
  return found;
}

async function played(
  prefix: string,
  narrator?: ReturnType<typeof createScriptedNarrator>,
): Promise<ReturnType<typeof createSimHarness>> {
  const harness = createSimHarness({
    scenario: scenario(prefix),
    tmpPrefix: `for-sim-check-${prefix}-`,
    ...(narrator === undefined ? {} : { narrator }),
  });
  await harness.run();
  return harness;
}

// ------------------------------------------------------------- invariants

describe('checks/invariants', () => {
  it('refuse une jauge hors des bornes du moteur, et accepte la même à la borne', async () => {
    const harness = await played('00');
    try {
      const state = harness.state();
      const id = expandUlid('CHRA') as CharacterId;
      const character = state.characters[id];
      expect(character).toBeDefined();
      if (character === undefined) return;

      // AT the bound: the engine's own constant, never a literal.
      const atBound = {
        ...state,
        characters: {
          ...state.characters,
          [id]: { ...character, gauges: { ...character.gauges, vigueur: GAUGE_MAX } },
        },
      };
      expect(stateIssues(atBound)).toEqual([]);

      // One past it.
      const past = {
        ...state,
        characters: {
          ...state.characters,
          [id]: { ...character, gauges: { ...character.gauges, vigueur: GAUGE_MAX + 1 } },
        },
      };
      expect(stateIssues(past).join(' ')).toContain('hors des bornes du moteur');
    } finally {
      harness.close();
    }
  });

  it('laisse passer le préambule d’un journal, et refuse un propriétaire hors de sa table une fois la table peuplée', async () => {
    const harness = await played('00');
    try {
      const journal = harness.journal();
      const initial = createInitialCampaignState({
        campaignId: harness.campaignId,
        ownerPlayerId: expandUlid('PYRA') as PlayerId,
        seed: scenario('00').seed,
      });
      // The preamble — `campaign.created` before anybody joined — must pass.
      expect(checkInvariants(initial, journal)).toEqual([]);

      // Once the table is peopled, an owner outside it must NOT pass.
      const peopled = reduceAll(initial, journal);
      const orphaned = {
        ...peopled,
        party: { ...peopled.party, ownerPlayerId: expandUlid('PYRZ') as PlayerId },
      };
      expect(stateIssues(orphaned).join(' ')).toContain('party.ownerPlayerId');
    } finally {
      harness.close();
    }
  });

  it('refuse une piste, une horloge et une expérience hors de leurs bornes', async () => {
    // THE THREE GUARDS NO SCENARIO REACHES. The coverage report, read from the
    // lowest file up, showed `invariants.ts` at 70 % and these three branches
    // among the missing lines: they were present, and nothing said whether
    // they bit. Each is broken here and restored.
    const harness = await played('02');
    try {
      const state = harness.state();
      expect(stateIssues(state)).toEqual([]);

      const [track] = Object.values(state.tracks);
      expect(track).toBeDefined();
      if (track === undefined) return;
      const overfilled = {
        ...state,
        tracks: { ...state.tracks, [track.id]: { ...track, ticks: MAX_PROGRESS_TICKS + 1 } },
      };
      expect(stateIssues(overfilled).join(' ')).toContain('crans, hors de');

      const clockId = 'CLOCK' as never;
      const withClock = {
        ...state,
        clocks: {
          ...state.clocks,
          [clockId]: {
            id: clockId,
            title: 'la meute approche',
            description: '',
            segments: 6 as never,
            filled: 7,
            status: 'active' as never,
            visibility: 'public' as never,
            consequence: '',
            createdSeq: 1,
            updatedSeq: 1,
          },
        },
      };
      expect(stateIssues(withClock).join(' ')).toContain('segments');

      const [id, character] = Object.entries(state.characters)[0] ?? [];
      expect(character).toBeDefined();
      if (id === undefined || character === undefined) return;
      const overspent = {
        ...state,
        characters: {
          ...state.characters,
          [id]: { ...character, xpEarned: 1, xpSpent: 2 },
        },
      };
      expect(stateIssues(overspent).join(' ')).toContain("d'expérience");
    } finally {
      harness.close();
    }
  });

  it('refuse un journal troué, et accepte le même journal dense', async () => {
    const harness = await played('00');
    try {
      const journal = harness.journal();
      const initial = createInitialCampaignState({
        campaignId: harness.campaignId,
        ownerPlayerId: expandUlid('PYRA') as PlayerId,
      });
      const holed = [...journal.slice(0, 3), ...journal.slice(4)];
      expect(checkInvariants(initial, holed).length).toBeGreaterThan(0);
      expect(checkInvariants(initial, journal)).toEqual([]);
    } finally {
      harness.close();
    }
  });
});

// ------------------------------------------------------- replay equivalence

describe('checks/replay-equivalence', () => {
  it('refuse une trame retirée du fil d’un joueur, et accepte le fil complet', async () => {
    const harness = await played('01');
    try {
      const ownerId = expandUlid('PYRA') as PlayerId;
      const snapshot = await harness.service.getSnapshot(harness.campaignId, ownerId);
      const input = {
        campaignId: harness.campaignId,
        ownerPlayerId: ownerId,
        seed: scenario('01').seed,
        journal: harness.journal(),
        snapshot: snapshot.state,
        tapes: harness.tapes,
        threadOf: harness.threadOf,
      };
      expect(checkReplayEquivalence(input)).toEqual([]);

      // Drop ONE delivered frame from Bruno's tape.
      const tape = harness.tapes.get('PYRB');
      expect(tape).toBeDefined();
      if (tape === undefined) return;
      const at = tape.frames.findIndex((frame) => frame.type === 's2c.event');
      expect(at).toBeGreaterThanOrEqual(0);
      const kept = [...tape.frames];
      const censored: PlayerTape = {
        ...tape,
        frames: kept.filter((_, index) => index !== at),
      };
      const mismatches = checkReplayEquivalence({
        ...input,
        tapes: new Map([...harness.tapes, ['PYRB', censored]]),
      });
      expect(mismatches.some((mismatch) => mismatch.playerSymbol === 'PYRB')).toBe(true);
    } finally {
      harness.close();
    }
  });

  it('refuse une entrée livrée à qui ne la voit pas — la moitié « ni plus »', async () => {
    const harness = await played('05');
    try {
      const ownerId = expandUlid('PYRA') as PlayerId;
      const snapshot = await harness.service.getSnapshot(harness.campaignId, ownerId);
      const alice = harness.tapes.get('PYRA');
      const bruno = harness.tapes.get('PYRB');
      expect(alice).toBeDefined();
      expect(bruno).toBeDefined();
      if (alice === undefined || bruno === undefined) return;

      // The private entry addressed to Alice, handed to Bruno's transport.
      const secret = alice.frames.find(
        (frame) =>
          frame.type === 's2c.event' &&
          (frame.payload['event'] as { type?: string } | undefined)?.type === 'system.note',
      );
      expect(secret).toBeDefined();
      if (secret === undefined) return;

      const leaked: PlayerTape = { ...bruno, frames: [...bruno.frames, secret] };
      const mismatches = checkReplayEquivalence({
        campaignId: harness.campaignId,
        ownerPlayerId: ownerId,
        seed: scenario('05').seed,
        journal: harness.journal(),
        snapshot: snapshot.state,
        tapes: new Map([...harness.tapes, ['PYRB', leaked]]),
        threadOf: harness.threadOf,
      });
      expect(mismatches.some((mismatch) => mismatch.playerSymbol === 'PYRB')).toBe(true);
    } finally {
      harness.close();
    }
  });

  it('refuse deux entrées différentes sous un même numéro de livraison', () => {
    const frame = (id: string, deliverySeq: number) => ({
      raw: '',
      type: 's2c.event',
      seq: deliverySeq,
      deliverySeq,
      payload: { event: { id, seq: deliverySeq, type: 'system.note', scope: 'table' } },
    });
    const tape: PlayerTape = {
      playerId: expandUlid('PYRA') as PlayerId,
      symbol: 'PYRA',
      frames: [frame('A', 1), frame('B', 1)],
      closes: [],
    };
    expect(deliveredTo(tape).issues.join(' ')).toContain('deux entrées différentes');

    const honest: PlayerTape = { ...tape, frames: [frame('A', 1), frame('A', 1)] };
    expect(deliveredTo(honest).issues).toEqual([]);
  });
});

// ----------------------------------------------------------------- lockout

describe('checks/lockout', () => {
  it('mord quand le conteur nomme le champion d’un autre joueur, et se tait sinon', async () => {
    const clean = await played('01');
    try {
      expect(checkLockout(clean.state(), staticContent(), clean.tapes)).toEqual([]);
    } finally {
      clean.close();
    }

    // The same scenario, with a port that names Braum — reserved for Bruno.
    const loose = await played(
      '01',
      createScriptedNarrator({ text: () => 'Braum pose son bouclier.' }),
    );
    try {
      const breaches = checkLockout(loose.state(), staticContent(), loose.tapes);
      expect(breaches.length).toBeGreaterThan(0);
      expect(breaches.some((breach) => breach.playerSymbol === 'PYRA')).toBe(true);
      expect(breaches.map((breach) => breach.issue).join(' ')).toContain('Braum');
    } finally {
      loose.close();
    }
  });

  it('un scénario à un seul joueur ne passe pas le verrou par une liste vide', async () => {
    const harness = await played('00');
    try {
      // `expectNoReservedChampion` THROWS on an empty list, so a check that
      // called it anyway would crash rather than pass. The skip is explicit,
      // and this is what says so.
      expect(reservedFor(harness.state(), staticContent(), expandUlid('PYRA'))).toEqual([]);
      expect(() => checkLockout(harness.state(), staticContent(), harness.tapes)).not.toThrow();
      expect(checkLockout(harness.state(), staticContent(), harness.tapes)).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it('lit la prose reçue par CE joueur, pas le journal', async () => {
    const harness = await played('01');
    try {
      const alice = harness.tapes.get('PYRA');
      expect(alice).toBeDefined();
      if (alice === undefined) return;
      const lines = narrationSeenBy(alice);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).toContain('conteur-scripte');
    } finally {
      harness.close();
    }
  });
});

// ------------------------------------------------------------- determinism

describe('checks/determinism', () => {
  it('refuse un index de tirage qui stagne ou recule, et accepte un index qui avance', () => {
    expect(checkRerollAfterRevert({ seq: 10, index: 2 }, { seq: 20, index: 3 })).toEqual([]);
    expect(checkRerollAfterRevert({ seq: 10, index: 2 }, { seq: 20, index: 2 })).toHaveLength(1);
    expect(
      checkRerollAfterRevert({ seq: 10, index: 2 }, { seq: 20, index: 1 })[0]?.issue,
    ).toContain('machine à relancer');
  });

  it('refuse une absence de jet plutôt que de passer pour vert', () => {
    expect(checkRerollAfterRevert(undefined, { seq: 1, index: 0 })[0]?.issue).toContain(
      'ne prouve rien',
    );
    expect(checkRerollAfterRevert({ seq: 1, index: 0 }, undefined)[0]?.issue).toContain(
      'ne prouve rien',
    );
  });

  it('compte le tirage annulé : le compteur de flux ne rend rien', async () => {
    const harness = await played('04');
    try {
      const journal = harness.journal();
      const draws = harness.state().rng.draws;
      expect(checkDrawCounter(journal, draws)).toEqual([]);
      // The counter, one short: a rewound index.
      const rewound = { ...draws, action: (draws.action ?? 0) - 1 };
      expect(checkDrawCounter(journal, rewound)[0]?.issue).toContain('index a été rendu');
      // And the journal DOES hold a cancelled roll, so the check is not empty.
      expect(journal.some((event: GameEvent) => event.type === 'system.reverted')).toBe(true);
    } finally {
      harness.close();
    }
  });
});

// -------------------------------------------------------------- coverage

describe('checks/coverage', () => {
  it('la liste attendue est parcourue, pas épinglée', () => {
    const all = Object.keys(MOVE_REGISTRY);
    expect(checkMoveCoverage(all).code).toBeNull();
    expect(checkMoveCoverage([]).code).toBe('move_not_covered');
    expect(checkMoveCoverage([]).missing).toEqual(all.sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('un mouvement inconnu du registre est refusé aussi', () => {
    const report = checkMoveCoverage([...Object.keys(MOVE_REGISTRY), 'danser-la-gigue']);
    expect(report.code).toBe('move_not_covered');
    expect(report.unexpected).toEqual(['danser-la-gigue']);
  });
});

// ------------------------------------------------------- the test doubles

describe('les doubles du harnais', () => {
  it('la socket déclare exactement les paramètres de l’interface, jamais un de moins', () => {
    const tape: PlayerTape = {
      playerId: expandUlid('PYRA') as PlayerId,
      symbol: 'PYRA',
      frames: [],
      closes: [],
    };
    const socket = simSocket(tape);
    // MODE 8 OF THE STANDARD PROBE. A double declared `send(data)` compiles
    // without a word, and `onFlushed` then stops existing for the whole
    // suite — the server never decrements `inFlight` and the socket queue
    // collapses at 64 frames, in a scenario nobody wrote.
    expect(socket.send.length).toBe(2);
    expect(socket.close.length).toBe(2);

    let flushed = false;
    socket.send('{"t":"x","p":{}}', () => {
      flushed = true;
    });
    expect(flushed).toBe(true);
    expect(tape.frames).toHaveLength(1);

    socket.close(4001, 'protocol_version');
    expect(tape.closes).toEqual([{ code: 4001, reason: 'protocol_version' }]);
  });

  it('le harnais parle bien au vrai service : `campaignId` est celui du scénario', async () => {
    const harness = await played('00');
    try {
      const id: CampaignId = harness.campaignId;
      expect(id).toBe(expandUlid('CAMP00'));
      const snapshot = await harness.service.getSnapshot(id, expandUlid('PYRA') as PlayerId);
      expect(snapshot.lastSeq).toBe(harness.journal().length);
    } finally {
      harness.close();
    }
  });
});
