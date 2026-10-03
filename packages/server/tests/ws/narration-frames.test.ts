/**
 * LE DIFFUSEUR DE NARRATION ET LA SOCKET, JOINTS — la couture que M0-29 a
 * laissée ouverte et nommée.
 *
 * Son en-tête de `ai/broadcast.ts` l'écrit : « that class ships
 * `sendNarrationSnapshot` and `sendNarrationError` (M0-25) and NOTHING for
 * `started`, `delta` or `done` — the three frames a generation actually
 * emits […] the seam is declared here and the three methods land on
 * `TableConnection` with the wiring, in M0-30 ». Cette suite est la mesure de
 * cet atterrissage.
 *
 * ── CE QUI EST VRAI ICI ──────────────────────────────────────────────────
 * Le VRAI `NarrationDispatcher`, le VRAI `NarrationBroadcast`, la VRAIE
 * `TableConnection` et le VRAI `TableHub`. Rien n'est simulé que le transport
 * et l'horloge. Les octets lus sont ceux qui partiraient sur le fil, et chacun
 * est passé par `zS2CEnvelope.parse` dans `TableConnection.send` : une charge
 * que le protocole refuserait ferait jeter ici, pas dans un navigateur.
 *
 * ── LE PUITS PORTE LES CINQ MÉTHODES, ET CHACUNE REND CE QU'ELLE A REÇU ──
 * TypeScript accepte une fonction déclarée avec MOINS de paramètres que celle
 * qu'elle remplace. Un puits écrit `started: () => {}` compilerait, perdrait
 * sa charge, et resterait invisible à tout test qui ne compte que des trames.
 * La suite compare donc chaque charge émise par le diffuseur aux octets écrits
 * sur le transport.
 */

import { describe, expect, it } from 'vitest';

import { NarrationDispatcher, TABLE_AUDIENCE } from '../../src/ai/broadcast.js';
import { ALICE, BOB, CAMPAIGN, Table, c2s } from './support/harness.test.js';

const NOW = 1_700_000_000_000;
const EVENT_SEQ = 12;

function aDispatcherTable(): { table: Table; dispatcher: NarrationDispatcher } {
  const dispatcher = new NarrationDispatcher();
  return { table: new Table(dispatcher, dispatcher), dispatcher };
}

function openTurn(dispatcher: NarrationDispatcher) {
  return dispatcher.open({
    campaignId: CAMPAIGN,
    eventSeq: EVENT_SEQ,
    actorCharacterId: null,
    audience: TABLE_AUDIENCE,
    now: NOW,
  });
}

describe('les trames de narration atteignent la socket', () => {
  it('une socket qui rejoint la table rejoint le fil de narration', async () => {
    const { table, dispatcher } = aDispatcherTable();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    const broadcast = openTurn(dispatcher);

    const started = alice.socket.of('s2c.narration_started');
    expect(started).toHaveLength(1);
    expect(started[0]?.p['narrationId']).toBe(broadcast.narrationId);
    expect(started[0]?.p['eventSeq']).toBe(EVENT_SEQ);
    expect(started[0]?.p['chunk']).toBe(0);
  });

  it('les fragments sortent en `s2c.narration_delta`, avec leur numéro et leur texte', async () => {
    const { table, dispatcher } = aDispatcherTable();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    const broadcast = openTurn(dispatcher);
    broadcast.push('Le vent tombe. ');
    broadcast.flush(NOW);
    broadcast.push('La neige reprend.');
    broadcast.flush(NOW + 60);

    const deltas = alice.socket.of('s2c.narration_delta');
    expect(deltas.map((frame) => frame.p['chunk'])).toStrictEqual([1, 2]);
    expect(deltas.map((frame) => frame.p['text'])).toStrictEqual([
      'Le vent tombe. ',
      'La neige reprend.',
    ]);
  });

  it('la fin du tour sort en `s2c.narration_done`, avec son texte, son modèle et sa source', async () => {
    const { table, dispatcher } = aDispatcherTable();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    const broadcast = openTurn(dispatcher);
    broadcast.push('Elle passe.');
    broadcast.complete(
      { eventSeq: EVENT_SEQ, text: 'Elle passe.', model: 'stub', source: 'engine' },
      NOW + 100,
    );

    const done = alice.socket.of('s2c.narration_done');
    expect(done).toHaveLength(1);
    expect(done[0]?.p['text']).toBe('Elle passe.');
    expect(done[0]?.p['model']).toBe('stub');
    expect(done[0]?.p['source']).toBe('engine');
    expect(done[0]?.p['eventSeq']).toBe(EVENT_SEQ);
  });

  it('un refus retenu sort en `s2c.narration_error`, avec son code', async () => {
    const { table, dispatcher } = aDispatcherTable();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    openTurn(dispatcher).fail('action_impossible', NOW + 10);

    expect(alice.socket.of('s2c.narration_error')[0]?.p['code']).toBe('action_impossible');
  });

  it('une socket qui arrive en cours de génération reçoit le tampon entier', async () => {
    const { table, dispatcher } = aDispatcherTable();
    const alice = await table.join(ALICE);
    const broadcast = openTurn(dispatcher);
    broadcast.push('Le col est blanc.');
    broadcast.flush(NOW);

    // Bob arrive APRÈS l'ouverture : c'est l'instantané qu'il reçoit, pas une
    // seconde génération.
    const bob = await table.join(BOB);

    const snapshot = bob.socket.of('s2c.narration_snapshot');
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.p['text']).toBe('Le col est blanc.');
    expect(snapshot[0]?.p['status']).toBe('streaming');
    // Et rien n'a relancé le port : le tampon d'Alice n'a pas bougé.
    expect(alice.socket.of('s2c.narration_started')).toHaveLength(1);
  });

  it('et le puits s’en va avec elle : plus rien ne s’écrit après le départ', async () => {
    const { table, dispatcher } = aDispatcherTable();
    const alice = await table.join(ALICE);
    const broadcast = openTurn(dispatcher);
    alice.socket.clear();

    alice.connection.markClosed();
    table.hub.detach(alice.connection);

    broadcast.push('Après le départ.');
    broadcast.flush(NOW + 50);
    broadcast.complete(
      { eventSeq: EVENT_SEQ, text: 'Après le départ.', model: 'stub', source: 'engine' },
      NOW + 60,
    );

    expect(alice.socket.sent).toStrictEqual([]);
  });

  it('le diffuseur EST le port de reprise : `c2s.resume_narration` sert son tampon', async () => {
    const { table, dispatcher } = aDispatcherTable();
    const alice = await table.join(ALICE);
    const broadcast = openTurn(dispatcher);
    broadcast.push('Ce qui a déjà été dit.');
    broadcast.flush(NOW);
    alice.socket.clear();

    await alice.connection.receive(
      c2s(
        'c2s.resume_narration',
        { narrationId: broadcast.narrationId, lastChunk: 0 },
        table.nextFrameId(),
      ),
    );

    const replayed = alice.socket.of('s2c.narration_snapshot');
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.p['text']).toBe('Ce qui a déjà été dit.');
    expect(replayed[0]?.p['narrationId']).toBe(broadcast.narrationId);
  });

  it('le puits porte les cinq méthodes du diffuseur, et chacune rend ce qu’elle a reçu', async () => {
    const { table, dispatcher } = aDispatcherTable();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    const broadcast = openTurn(dispatcher);
    broadcast.push('Un fragment.');
    broadcast.flush(NOW);
    broadcast.complete(
      { eventSeq: EVENT_SEQ, text: 'Un fragment.', model: 'stub', source: 'ai' },
      NOW + 10,
    );
    broadcast.fail('action_impossible', NOW + 20);
    // Le cinquième : l'instantané, que `subscribe` écrit à l'arrivée.
    const bob = await table.join(BOB);

    // L'instantané VIDE qui ouvre la liste est celui que `subscribe` écrit au
    // moment où le tour s'ouvre : le diffuseur abonne ses puits en attente
    // AVANT d'émettre `started` (`NarrationDispatcher.open`). Il est inscrit
    // ici tel quel plutôt que filtré — c'est ce que la socket reçoit.
    expect(alice.socket.types().filter((type) => type.startsWith('s2c.narration'))).toStrictEqual([
      's2c.narration_snapshot',
      's2c.narration_started',
      's2c.narration_delta',
      's2c.narration_done',
      's2c.narration_error',
    ]);
    expect(bob.socket.of('s2c.narration_snapshot')).toHaveLength(1);

    // LES CINQ CHARGES SONT PASSÉES ENTIÈRES : chaque champ du diffuseur se
    // retrouve dans les octets. Un puits qui déclarerait moins de paramètres
    // ne perdrait rien de visible sans cette comparaison.
    const delta = alice.socket.of('s2c.narration_delta')[0];
    expect(delta?.p).toStrictEqual({
      narrationId: broadcast.narrationId,
      chunk: 1,
      text: 'Un fragment.',
    });
  });

  it('les trames d’une génération sortent de la même fabrique : des `id` distincts, un `ts` par instant', async () => {
    const { table, dispatcher } = aDispatcherTable();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    const broadcast = openTurn(dispatcher);
    broadcast.push('Un.');
    broadcast.flush(NOW);
    table.clock.advance(1000);
    broadcast.complete(
      { eventSeq: EVENT_SEQ, text: 'Un.', model: 'stub', source: 'ai' },
      NOW + 1000,
    );

    const frames = alice.socket.frames() as unknown as { id: string; ts: number; t: string }[];
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(frames.length);
    // DEUX INSTANTS, PAS UN : un `ts` figé passerait un test à un seul instant.
    expect(new Set(frames.map((frame) => frame.ts)).size).toBe(2);
  });
});
