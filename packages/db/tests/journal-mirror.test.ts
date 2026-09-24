/**
 * LE MIROIR `JournalEvent` ↔ `EventEnvelopeDto`, MESURÉ ET NON PLUS DÉCLARÉ.
 *
 * `rows.ts` annonce que `JournalEvent` reprend l'enveloppe canonique champ
 * pour champ. Tant que rien ne l'exécutait, la phrase valait promesse : un
 * champ ajouté à `eventEnvelopeShape` laissait @for/db entièrement vert alors
 * que le seul chemin d'écriture du journal le perdait en silence. L'ADR 0007
 * nomme exactement ce cas — « un miroir n'est garanti que par un test
 * d'EXÉCUTION ».
 *
 * Les deux mesures d'ici viennent de DEUX SOURCES DIFFÉRENTES et ne se
 * comparent jamais à elles-mêmes :
 *
 *   - la liste des champs attendus vient de @for/contracts
 *     (`eventEnvelopeShape`), celle des champs obtenus vient d'un aller-retour
 *     SQL complet (`appendEvents` puis `readSince`) ;
 *   - les VALEURS attendues sont épinglées en toutes lettres dans ce fichier,
 *     jamais relues depuis l'objet écrit : un champ que `appendEvents`
 *     oublierait de porter rendrait `null` au lieu du littéral.
 *
 * `type` et `payload` sont les deux seuls champs que `JournalEvent` a en plus,
 * et ce n'est pas un écart : l'enveloppe les laisse à chacune des 71 variantes.
 * Ils sont donc écrits en toutes lettres ci-dessous.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { eventEnvelopeShape, zEventEnvelope } from '@for/contracts';

import type { SqliteConnection } from '../src/client.js';
import { appendEvents, readSince } from '../src/repositories/events.js';
import type { TempDb } from '../src/testing.js';
import { migratedTempDb, seedCampaign } from '../src/testing.js';

/** Des ULID véritables : les identifiants de l'enveloppe sont contraints. */
const CAMPAIGN_ID = '01J9ZK3Q7B8YN4V2M6T5R0W1XA';
const PLAYER_ID = '01J9ZK3Q7B8YN4V2M6T5R0W1XB';
const EVENT_ID = '01J9ZK3Q7B8YN4V2M6T5R0W1XC';
const CAUSATION_ID = '01J9ZK3Q7B8YN4V2M6T5R0W1XD';
const SESSION_ID = '01J9ZK3Q7B8YN4V2M6T5R0W1XE';
const CHARACTER_ID = '01J9ZK3Q7B8YN4V2M6T5R0W1XF';
const CORRELATION_ID = '0a4c1e7e-8f2b-4a5d-9c3e-1b2d4f6a8c0e';
const NOW = 1_700_000_000_000;

const PAYLOAD = { texte: 'Le givre mord', degats: { valeur: 3, source: 'griffe' } };

let open: TempDb | undefined;
afterEach(() => {
  open?.close();
  open = undefined;
});

/** Un journal d'un seul événement, dont CHAQUE champ d'enveloppe est rempli. */
function journalWithOneFullEvent(): SqliteConnection {
  const db = migratedTempDb();
  open = db;
  seedCampaign(db.connection, { playerId: PLAYER_ID, campaignId: CAMPAIGN_ID });
  appendEvents(db.connection, {
    campaignId: CAMPAIGN_ID,
    events: [
      {
        id: EVENT_ID,
        type: 'narration.gm_message',
        payload: PAYLOAD,
        payloadVersion: 3,
        actorKind: 'player',
        actorPlayerId: PLAYER_ID,
        subjectCharacterId: CHARACTER_ID,
        playSessionId: SESSION_ID,
        correlationId: CORRELATION_ID,
        causationId: CAUSATION_ID,
        rngStream: 'price',
        rngDrawIndex: 7,
        scope: 'private',
        recipients: [PLAYER_ID],
        createdAt: NOW,
      },
    ],
    now: NOW,
  });
  return db.connection;
}

describe('ADR 0007 : le miroir du journal est exécuté, pas affirmé', () => {
  it('relu depuis SQLite, un événement porte exactement les champs de l’enveloppe, plus type et payload', () => {
    const connection = journalWithOneFullEvent();
    const [relu] = readSince(connection, CAMPAIGN_ID, 0);
    expect(relu).toBeDefined();

    // Source A : le contrat canonique. Source B : l'aller-retour SQL.
    const attendus = [...Object.keys(eventEnvelopeShape), 'type', 'payload'].sort();
    expect(Object.keys(relu!).sort()).toEqual(attendus);
  });

  it('l’événement relu passe zEventEnvelope, valeur par valeur, littéraux épinglés', () => {
    const connection = journalWithOneFullEvent();
    const [relu] = readSince(connection, CAMPAIGN_ID, 0);

    // Exécution : les types de l'enveloppe (ULID, seq positif, énumérations)
    // sont vérifiés sur la ligne qui est REVENUE de SQLite.
    const enveloppe = zEventEnvelope.parse(relu);

    expect(enveloppe).toEqual({
      id: EVENT_ID,
      campaignId: CAMPAIGN_ID,
      seq: 1,
      playSessionId: SESSION_ID,
      payloadVersion: 3,
      actorKind: 'player',
      actorPlayerId: PLAYER_ID,
      subjectCharacterId: CHARACTER_ID,
      correlationId: CORRELATION_ID,
      causationId: CAUSATION_ID,
      rngStream: 'price',
      rngDrawIndex: 7,
      scope: 'private',
      recipients: [PLAYER_ID],
      createdAt: NOW,
    });

    // Les deux champs hors enveloppe, eux aussi épinglés : l'aller-retour JSON
    // rend la charge imbriquée, pas sa chaîne.
    expect(relu!.type).toBe('narration.gm_message');
    expect(relu!.payload).toEqual(PAYLOAD);
  });

  /**
   * ROUGE AVEC / VERT SANS, sur le miroir lui-même.
   *
   * Un champ que l'enveloppe porte et que le chemin d'écriture perdrait rend
   * `null` ici, et non le littéral attendu. La mesure est faite sur la LIGNE
   * SQL brute pour que le test ne dépende pas de `toJournalEvent`, qui est
   * justement la fonction dont on mesure la fidélité.
   */
  it('chaque colonne d’enveloppe est réellement écrite, aucune ne reste nulle', () => {
    const connection = journalWithOneFullEvent();
    const brut = connection.prepare(`SELECT * FROM events WHERE id = ?`).get(EVENT_ID) as Record<
      string,
      unknown
    >;
    const nulles = Object.entries(brut)
      .filter(([, valeur]) => valeur === null)
      .map(([colonne]) => colonne);
    expect(nulles).toEqual([]);
  });
});
