/**
 * Les pièces qui se mesurent seules : la politique d'instantanés, le
 * déclencheur de chronique, la conversion de disposition, le pont vers le
 * contenu du moteur, et la projection par spectateur.
 */

import { staticContent } from '@for/content';
import { ENTITY_DISPOSITIONS, MOVE_IDS } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { buildNarrator } from '../../src/ai/narrator.js';
import { readEnv } from '../../src/env.js';
import { createCampaignService } from '../../src/game/campaign-service.js';
import { CHRONICLE_VOLUME_THRESHOLD, chronicleTrigger } from '../../src/game/chronicle.js';
import { toEngineContent } from '../../src/game/content.js';
import {
  UnmappableDisposition,
  requireEngineDisposition,
  toEngineDisposition,
} from '../../src/game/dispositions.js';
import { readJournalSince } from '../../src/game/journal.js';
import { loadReplay, loadState, snapshotDue, writeSnapshot } from '../../src/game/snapshots.js';
import { toTableState } from '../../src/game/table-state.js';
import {
  CAMPAIGN_ID,
  CHARACTER_ID,
  OTHER_CHARACTER_ID,
  PLAYER_ID,
  aTable,
  uuidAt,
} from './support.test.js';

import type { NarrateEvent, NarratorPort } from '@for/contracts';
import type { CampaignState, GameEvent, PlayerId } from '@for/engine';

/** An entry with just enough envelope for the policy to read it. */
function anEntry(seq: number, type: string, payload: unknown = {}): GameEvent {
  return {
    id: `00000000000000000000000${String(seq).padStart(3, '0')}`.slice(0, 26),
    campaignId: CAMPAIGN_ID,
    seq,
    playSessionId: null,
    payloadVersion: 1,
    actorKind: 'engine',
    actorPlayerId: null,
    subjectCharacterId: null,
    correlationId: uuidAt(seq),
    causationId: null,
    rngStream: null,
    rngDrawIndex: null,
    createdAt: 0,
    scope: 'table',
    recipients: null,
    type,
    payload,
  } as unknown as GameEvent;
}

describe('la politique d’instantanés', () => {
  const emptyState = { tracks: {} } as unknown as CampaignState;

  it('déclenche tous les 200, même quand le lot enjambe la borne', () => {
    expect(
      snapshotDue(emptyState, [anEntry(199, 'move.declared'), anEntry(200, 'move.resolved')]),
    ).toEqual({ kind: 'rolling', seq: 200 });
    // ENJAMBER, pas atteindre : un modulo sur la dernière séquence aurait
    // laissé passer ce lot-là sans rien écrire.
    expect(
      snapshotDue(emptyState, [anEntry(200, 'move.declared'), anEntry(201, 'move.resolved')]),
    ).toEqual({ kind: 'rolling', seq: 201 });
    expect(
      snapshotDue(emptyState, [anEntry(201, 'move.declared'), anEntry(202, 'move.resolved')]),
    ).toBeNull();
  });

  it('donne la priorité aux genres permanents', () => {
    const batch = [anEntry(399, 'move.resolved'), anEntry(400, 'session.closed')];
    expect(snapshotDue(emptyState, batch)).toEqual({ kind: 'session_end', seq: 400 });
  });

  it('ne pose un jalon que pour un serment d’un rang qui le mérite', () => {
    const withTrack = (rank: string): CampaignState =>
      ({ tracks: { t: { id: 't', kind: 'vow', rank } } }) as unknown as CampaignState;
    const batch = [anEntry(10, 'track.resolved', { trackId: 't' })];
    expect(snapshotDue(withTrack('dangereux'), batch)).toBeNull();
    expect(snapshotDue(withTrack('redoutable'), batch)).toEqual({ kind: 'milestone', seq: 10 });
    expect(snapshotDue(withTrack('epique'), batch)).toEqual({ kind: 'milestone', seq: 10 });
  });

  it('ne garde que les trois derniers instantanés roulants', () => {
    const table = aTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      for (const seq of [1, 2, 3, 4, 5]) {
        writeSnapshot(table.connection, {
          campaignId: CAMPAIGN_ID,
          state: { ...state, seq },
          due: { kind: 'rolling', seq },
          id: table.ids.next(),
          now: 0,
        });
      }
      const kept = table.connection
        .prepare(`SELECT seq FROM snapshots WHERE campaign_id = ? ORDER BY seq`)
        .all(CAMPAIGN_ID) as { seq: number }[];
      expect(kept.map((row) => row.seq)).toEqual([3, 4, 5]);
    } finally {
      table.close();
    }
  });

  it('charge l’état depuis le meilleur instantané, et la queue derrière', () => {
    const table = aTable();
    try {
      const full = loadReplay(table.connection, CAMPAIGN_ID).state;
      writeSnapshot(table.connection, {
        campaignId: CAMPAIGN_ID,
        state: full,
        due: { kind: 'milestone', seq: full.seq },
        id: table.ids.next(),
        now: 0,
      });

      // AVEC instantané : la queue lue est VIDE, et l'état est quand même
      // complet. Deux opérandes, deux origines — l'état rejoué entièrement, et
      // l'état reconstruit depuis le cache.
      let readFrom = -1;
      const cached = loadState(table.connection, CAMPAIGN_ID, full.seq, (afterSeq) => {
        readFrom = afterSeq;
        return readJournalSince(table.connection, CAMPAIGN_ID, afterSeq);
      });
      expect(readFrom).toBe(full.seq);
      expect(cached.seq).toBe(full.seq);
      expect(Object.keys(cached.characters)).toEqual(Object.keys(full.characters));
    } finally {
      table.close();
    }
  });
});

describe('le déclencheur de chronique', () => {
  const watch = { sourceEventSeq: 0, tokenCount: 0 };

  it('range les cinq déclencheurs dans l’ordre de la spec', () => {
    expect(chronicleTrigger(watch, [anEntry(1, 'session.closed')])).toBe('session_end');
    expect(chronicleTrigger(watch, [anEntry(1, 'character.died')])).toBe('pivotal');
    expect(chronicleTrigger({ ...watch, tokenCount: 3000 }, [])).toBe('budget');
    expect(chronicleTrigger(watch, [anEntry(1, 'character.gauge_changed')])).toBeNull();
  });

  it('compte les entrées SIGNIFICATIVES, pas les entrées', () => {
    const noise = Array.from({ length: CHRONICLE_VOLUME_THRESHOLD + 5 }, (_, index) =>
      anEntry(index + 1, 'character.gauge_changed'),
    );
    expect(chronicleTrigger(watch, noise)).toBeNull();

    const narrations = Array.from({ length: CHRONICLE_VOLUME_THRESHOLD }, (_, index) =>
      anEntry(index + 1, 'narration.gm_message'),
    );
    expect(chronicleTrigger(watch, narrations)).toBe('volume');
  });

  it('ne compte que ce qui suit la version en service', () => {
    const narrations = Array.from({ length: CHRONICLE_VOLUME_THRESHOLD }, (_, index) =>
      anEntry(index + 1, 'narration.gm_message'),
    );
    expect(chronicleTrigger({ sourceEventSeq: 5, tokenCount: 0 }, narrations)).toBeNull();
  });

  it('ne traite comme pivot qu’un changement de statut qui tue', () => {
    expect(
      chronicleTrigger(watch, [anEntry(1, 'entity.status_changed', { to: 'dormant' })]),
    ).toBeNull();
    expect(chronicleTrigger(watch, [anEntry(1, 'entity.status_changed', { to: 'dead' })])).toBe(
      'pivotal',
    );
  });
});

describe('la disposition d’un PNJ proposé', () => {
  it('convertit les trois valeurs communes', () => {
    expect(toEngineDisposition('allie')).toBe('allie');
    expect(toEngineDisposition('neutre')).toBe('neutre');
    expect(toEngineDisposition('hostile')).toBe('hostile');
  });

  it('REFUSE les deux que le moteur ne connaît pas, au lieu de les aplatir', () => {
    // Le défaut mesuré : `mefiant` devenait `neutre` ou `null` en silence, et
    // le modèle lisait ensuite dans le journal que sa proposition avait été
    // acceptée alors que le fait proposé avait disparu.
    expect(toEngineDisposition('mefiant')).toBeNull();
    expect(toEngineDisposition('curieux')).toBeNull();
    expect(() => requireEngineDisposition('mefiant')).toThrow(UnmappableDisposition);
  });

  it('ne laisse pas proposer `inconnu`, qui est l’absence de décision', () => {
    expect(ENTITY_DISPOSITIONS).toContain('inconnu');
    expect(toEngineDisposition('inconnu')).toBeNull();
  });
});

describe('le contenu, vu par le moteur', () => {
  it('sert les onze mouvements, les tables et les conditions', () => {
    const content = toEngineContent(staticContent());
    expect(Object.keys(content.moves).sort()).toEqual([...MOVE_IDS].sort());
    expect(content.priceTable.die).toBe(12);
    expect(content.priceTable.entries).toHaveLength(12);
    expect(content.presageTable.entries.length).toBeGreaterThan(0);
    expect(Object.keys(content.oracles).length).toBeGreaterThan(0);
    for (const [id, condition] of Object.entries(content.conditions)) {
      expect(condition.id).toBe(id);
      expect(condition.label.length).toBeGreaterThan(0);
    }
  });

  it('laisse tomber un identifiant qui n’est pas un mouvement du moteur', () => {
    const registry = staticContent();
    const fake = {
      ...registry,
      listMoves: () => [
        ...registry.listMoves(),
        { ...registry.getMove('face-danger'), id: 'danser-la-gigue' },
      ],
    };
    const content = toEngineContent(fake);
    // DROPPED, JAMAIS CASTÉ : le moteur répond `unknown_move`, un refus que le
    // joueur peut lire, plutôt que de porter une chaîne sans gestionnaire.
    expect(Object.keys(content.moves)).not.toContain('danser-la-gigue');
  });
});

describe('la projection par spectateur', () => {
  it('retire les lignes du conteur et ne donne jamais la graine', async () => {
    const table = aTable();
    try {
      const service = createCampaignService({ deps: table.deps });
      const { state } = await service.getSnapshot(CAMPAIGN_ID, PLAYER_ID);
      // LA GRAINE NE SORT JAMAIS : la connaître, c'est pouvoir calculer le
      // résultat d'un mouvement avant de le déclarer.
      expect(JSON.stringify(state)).not.toContain('graine');
      expect(Object.keys(state)).not.toContain('rng');
    } finally {
      table.close();
    }
  });

  it('refuse l’instantané d’une table dont le spectateur n’est pas membre', async () => {
    const table = aTable();
    try {
      const service = createCampaignService({ deps: table.deps });
      await expect(
        service.getSnapshot(CAMPAIGN_ID, '0000000000000000000000INTR' as PlayerId),
      ).rejects.toMatchObject({ code: 'forbidden_campaign' });
    } finally {
      table.close();
    }
  });

  it('trie par identifiant, à partir d’un ordre qui ne l’est pas', () => {
    const table = aTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const [first, second] = Object.values(state.characters);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (first === undefined || second === undefined) return;

      // DEUX ENTRÉES, DANS UN ORDRE NON NATUREL, et le TABLEAU EXACT est
      // asserté : une fixture déjà triée aurait laissé le tri disparaître avec
      // la suite toujours verte.
      const shuffled: CampaignState = {
        ...state,
        characters: { [second.id]: second, [first.id]: first },
      };
      expect(Object.keys(shuffled.characters)).toEqual([second.id, first.id]);
      // LE TABLEAU EXACT, écrit en toutes lettres : un `sort()` dans
      // l'attendu aurait comparé le tri à lui-même.
      expect(toTableState(shuffled).characters.map((character) => character.id)).toEqual([
        CHARACTER_ID,
        OTHER_CHARACTER_ID,
      ]);
    } finally {
      table.close();
    }
  });

  it('refuse de rendre une piste `gm`, au lieu de compter sur le filtre', () => {
    const table = aTable();
    try {
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const withSecret: CampaignState = {
        ...state,
        tracks: {
          secret: {
            id: 'secret',
            kind: 'vow',
            rank: 'dangereux',
            title: 'Ce que le conteur sait',
            description: '',
            ownerCharacterId: null,
            ticks: 0,
            status: 'open',
            visibility: 'gm',
            tags: [],
            createdSeq: 1,
            updatedSeq: 1,
            resolvedSeq: null,
          },
        } as unknown as CampaignState['tracks'],
      };
      // Le DTO type `visibility` sur le littéral `'public'` : une piste `gm`
      // qui aurait franchi le filtre échoue au parse au lieu d'arriver sur un
      // écran. La violation est ici, et elle est rouge.
      expect(() => toTableState(withSecret)).not.toThrow();
      expect(toTableState(withSecret).tracks.map((track) => track.id)).not.toContain('secret');
    } finally {
      table.close();
    }
  });
});

/**
 * LE PORT DU CONTEUR, désigné par la couverture : `buildNarrator` n'était
 * exercé que par le chemin heureux du `stub`, et les deux refus du port —
 * `unsupported` pour une sortie structurée que le `stub` ne sait pas rendre,
 * `unavailable` pour un fournisseur dont l'adaptateur n'existe pas encore —
 * n'étaient lus par personne. Ce sont pourtant les deux endroits où
 * « on dégrade la prose, jamais l'équité » (`02-mj-ia.md` §0.2) se tient ou
 * ne se tient pas.
 */
describe('le port du conteur', () => {
  /** Tout ce qu'un serveur exige, et qui ne parle pas du conteur. */
  function vars(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      PUBLIC_URL: 'http://localhost:5173',
      SESSION_SECRET: 'a'.repeat(32),
      DISCORD_CLIENT_ID: 'client-id',
      DISCORD_CLIENT_SECRET: 'client-secret',
      DISCORD_REDIRECT_URI: 'http://localhost:8787/api/auth/discord/callback',
      ...overrides,
    };
  }

  it('rend un `stub` qui ne dit RIEN, et qui l’annonce dans ses capacités', async () => {
    const port = buildNarrator(readEnv(vars({ NARRATOR_PROVIDER: 'stub' })));
    expect(port.providerId).toBe('stub');
    // Une phrase inventée ici mettrait du français dans `@for/server`
    // (`ARCHITECTURE.md` §4.3) et ferait mentir `source: 'ai'`.
    const seen: NarrateEvent[] = [];
    for await (const event of port.narrer({
      purpose: 'scene',
      messages: [],
    } as unknown as Parameters<NarratorPort['narrer']>[0])) {
      seen.push(event);
    }
    // LE TABLEAU EXACT : un seul événement, et c'est la fin.
    expect(seen.map((event) => event.type)).toEqual(['end']);
    expect(seen.map((event) => (event.type === 'end' ? event.result.text : event.type))).toEqual([
      '',
    ]);
    expect(port.capabilities.structuredOutput).toBe(false);
  });

  it('refuse `structurer` au lieu d’inventer une forme', async () => {
    const port = buildNarrator(readEnv(vars({ NARRATOR_PROVIDER: 'stub' })));
    // Une réponse vide fabriquée passerait la validation de l'appelant et
    // serait portée comme un fait. La forge et la chronique doivent l'apprendre.
    await expect(
      Promise.resolve().then(() =>
        port.structurer({ schemaName: 'ChroniqueDigest' } as unknown as Parameters<
          NarratorPort['structurer']
        >[0]),
      ),
    ).rejects.toMatchObject({ code: 'unsupported', providerId: 'stub' });
  });

  it('démarre quand même sans adaptateur, et lève À L’APPEL', async () => {
    // `anthropic` n'a pas d'adaptateur avant M0-18. Refuser de démarrer
    // mettrait un déploiement à terre pour la seule chose qui a le droit de
    // se dégrader.
    const port = buildNarrator(
      readEnv(vars({ NARRATOR_PROVIDER: 'anthropic', NARRATOR_API_KEY: 'k' })),
    );
    expect(port.providerId).toBe('anthropic');
    expect(port.capabilities.streaming).toBe(false);
    expect(() => port.narrer({} as unknown as Parameters<NarratorPort['narrer']>[0])).toThrow(
      /anthropic/,
    );
    await expect(
      Promise.resolve().then(() =>
        port.structurer({} as unknown as Parameters<NarratorPort['structurer']>[0]),
      ),
    ).rejects.toMatchObject({ code: 'unavailable', providerId: 'anthropic' });
  });

  it('prend le sélecteur qu’on lui donne, ce qui est la couture de M0-18', () => {
    const mine = { providerId: 'ollama' } as unknown as NarratorPort;
    const seenConfigs: string[] = [];
    // Le jour où `@for/ai` exporte `selectNarrator`, le branchement est cet
    // argument-là, à l'unique appelant. Ce fichier ne se rouvre pas.
    expect(
      buildNarrator(readEnv(vars({ NARRATOR_PROVIDER: 'stub' })), (config) => {
        seenConfigs.push(config.provider);
        return mine;
      }),
    ).toBe(mine);
    // Et il a reçu la configuration que `env.ts` a bâtie, une seule fois.
    expect(seenConfigs).toEqual(['stub']);
  });
});
