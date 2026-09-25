/**
 * Les huit trames, et le fait que le hub ne décide rien.
 *
 * LA LISTE EST PARCOURUE, PAS ÉPINGLÉE. `ROUTES` est comparée à
 * `c2sMessageTypesOfSchema()`, dérivée du schéma gelé : vider l'union de
 * `@for/contracts` fait tomber cette suite au lieu de la rendre vide. Le
 * nombre huit, lui, est écrit en toutes lettres parce qu'il vient de la fiche
 * M0-25 (« routage des 8 messages `c2s.*` ») et de nulle part ailleurs.
 *
 * LE GREP DU CRITÈRE EST REJOUÉ ICI, en lisant les fichiers. Une commande
 * lancée une fois en recette prouve l'état d'un jour ; ce test le prouve à
 * chaque exécution — et il cherche AUSSI `.reduce(`, qui est la façon la plus
 * facile de faire réapparaître la chaîne interdite sans y penser.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { c2sMessageTypesOfSchema } from '@for/contracts';
import type { Intent } from '@for/engine';
import { describe, expect, it } from 'vitest';

import { ROUTES } from '../../src/ws/handlers.js';
import { ALICE, BOB, CAMPAIGN, Table, c2s } from './support/harness.test.js';

/** Le chiffre de la fiche, en toutes lettres. */
const FRAME_COUNT = 8;

const WS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'src', 'ws');

function wsSources(): { file: string; text: string }[] {
  return readdirSync(WS_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ file: name, text: readFileSync(join(WS_DIR, name), 'utf8') }));
}

describe('le routage', () => {
  it('route exactement les huit trames que le protocole déclare', () => {
    const declared = [...c2sMessageTypesOfSchema()].sort();
    const routed = Object.keys(ROUTES).sort();

    expect(routed).toStrictEqual(declared);
    expect(routed).toHaveLength(FRAME_COUNT);
  });

  it('répond à chacune des huit sans jamais fermer la socket', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);

    const frames: [string, unknown][] = [
      ['c2s.hello', { clientVersion: '0.0.0-test', lastDeliverySeq: null }],
      ['c2s.intent', { intent: { type: 'play_session.begin' } }],
      ['c2s.speak', { channel: 'ic', text: 'Le vent tombe.' }],
      ['c2s.typing', { typing: true }],
      ['c2s.resume', { sinceDeliverySeq: 0 }],
      ['c2s.pong', {}],
      ['c2s.resume_narration', { narrationId: 'n-1', lastChunk: 0 }],
      ['c2s.why', { correlationId: table.nextFrameId() }],
    ];
    expect(frames).toHaveLength(FRAME_COUNT);

    alice.socket.clear();
    for (const [type, payload] of frames) {
      await alice.connection.receive(c2s(type, payload, table.nextFrameId()));
    }

    expect(alice.socket.closes).toStrictEqual([]);
    expect(alice.connection.isOpen).toBe(true);

    // Chacune des huit a produit sa réponse propre : l'accueil et l'instantané
    // viennent de `c2s.hello` (curseur absent), l'événement de `c2s.intent` et
    // de `c2s.speak`, la présence de `c2s.typing`, le lot de `c2s.resume`,
    // l'erreur de `c2s.why` sur un tour inconnu et de `c2s.resume_narration`
    // sans tampon. `c2s.pong` n'écrit rien, par construction.
    const answered = new Set(alice.socket.types());
    expect([...answered].sort()).toStrictEqual([
      's2c.error',
      's2c.event',
      's2c.events_batch',
      's2c.presence',
      's2c.snapshot',
      's2c.welcome',
    ]);
  });

  it("refuse toute trame autre que l'accueil tant que `c2s.hello` n'a pas répondu", async () => {
    const table = new Table();
    const opened = await table.connect(ALICE);
    const connection = opened.connection;
    expect(connection).not.toBeNull();
    if (connection === null) return;

    await connection.receive(
      c2s('c2s.intent', { intent: { type: 'play_session.begin' } }, table.nextFrameId()),
    );

    // Sans ce refus, l'intention serait résolue et journalisée alors que la
    // socket n'est pas encore dans l'ensemble de diffusion : la table verrait
    // les événements, et leur auteur non.
    expect(table.service.submitCalls).toBe(0);
    expect(opened.socket.of('s2c.error')[0]?.p['code']).toBe('validation_failed');
    expect(opened.socket.of('s2c.event')).toHaveLength(0);
  });

  it('`c2s.speak` devient une intention `speech.say`, jamais un chemin d’écriture à part', async () => {
    const table = new Table();
    const seen: Intent[] = [];
    const original = table.service.submitIntent.bind(table.service);
    table.service.submitIntent = (input) => {
      seen.push(input.intent);
      return original(input);
    };

    const alice = await table.join(ALICE);
    // DEUX TRAMES, ET LE HORS-JEU D'ABORD. Une seule, ou l'en-jeu en premier,
    // et un serveur qui écrirait `channel: 'ic'` en dur passerait la moitié du
    // temps — c'est exactement ce que le canal transporte : ce qui est dit à
    // la table plutôt que dans la fiction.
    await alice.connection.receive(
      c2s('c2s.speak', { channel: 'ooc', text: 'On fait une pause ?' }, table.nextFrameId()),
    );
    await alice.connection.receive(
      c2s('c2s.speak', { channel: 'ic', text: 'Le vent tombe.' }, table.nextFrameId()),
    );

    // Les trois champs, sur les deux trames : rien n'est traduit au passage.
    expect(seen).toStrictEqual([
      { type: 'speech.say', channel: 'ooc', text: 'On fait une pause ?' },
      { type: 'speech.say', channel: 'ic', text: 'Le vent tombe.' },
    ]);
  });

  it('un refus du service devient `s2c.rejected`, jamais un événement', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    await alice.connection.receive(
      c2s('c2s.intent', { intent: { type: 'campaign.leave' } }, table.nextFrameId()),
    );

    const rejected = alice.socket.of('s2c.rejected')[0];
    expect(rejected?.p['code']).toBe('forbidden_campaign');
    expect(alice.socket.of('s2c.event')).toHaveLength(0);
  });
});

describe("ce que le serveur attribue à l'écriture (invariant 3)", () => {
  /**
   * ═══ LE SERVEUR EST L'AUTORITÉ : C'EST *LUI* QUI SIGNE L'ÉCRITURE ═════════
   *
   * `SubmitIntentInput` porte quatre champs, et trois d'entre eux ne viennent
   * PAS du client :
   *
   *   - `campaignId` et `playerId` viennent de la SESSION DE LA SOCKET, jamais
   *     de la trame — aucune des huit trames `c2s.*` ne porte de joueur, et
   *     c'est l'invariant 3 lui-même : « le serveur attribue une écriture au
   *     joueur authentifié de la socket, jamais le client » ;
   *   - `intentId` vient de l'`id` de la trame reçue. `src/game/types.ts`
   *     l'écrit : « Idempotence key, minted by the client. Replaying it must
   *     not reroll. » Un serveur qui la remplacerait ferait REJOUER TOUS LES
   *     TOURS — les dés seraient retirés à chaque reprise.
   *
   * DEUX APPELANTS POUR UN SEUL `submit` : `c2s.intent` et `c2s.speak`. Et
   * DEUX ACTEURS : à un seul joueur, une constante passerait.
   */
  it("signe l'écriture avec la campagne, le joueur de la socket et l'`id` de la trame — `c2s.intent`", async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    const bob = await table.join(BOB);

    const aliceFrame = table.nextFrameId();
    const bobFrame = table.nextFrameId();
    await alice.connection.receive(
      c2s('c2s.intent', { intent: { type: 'play_session.begin' } }, aliceFrame),
    );
    await bob.connection.receive(
      c2s('c2s.intent', { intent: { type: 'play_session.begin' } }, bobFrame),
    );

    expect(table.service.submits).toStrictEqual([
      {
        campaignId: CAMPAIGN,
        playerId: ALICE,
        intentId: aliceFrame,
        intent: { type: 'play_session.begin' },
      },
      {
        campaignId: CAMPAIGN,
        playerId: BOB,
        intentId: bobFrame,
        intent: { type: 'play_session.begin' },
      },
    ]);
  });

  it('et la signe de la même façon quand la parole passe par `c2s.speak`', async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    const bob = await table.join(BOB);

    const aliceFrame = table.nextFrameId();
    const bobFrame = table.nextFrameId();
    await alice.connection.receive(
      c2s('c2s.speak', { channel: 'ic', text: 'Le vent tombe.' }, aliceFrame),
    );
    await bob.connection.receive(
      c2s('c2s.speak', { channel: 'ooc', text: 'Une pause ?' }, bobFrame),
    );

    expect(table.service.submits).toStrictEqual([
      {
        campaignId: CAMPAIGN,
        playerId: ALICE,
        intentId: aliceFrame,
        intent: { type: 'speech.say', channel: 'ic', text: 'Le vent tombe.' },
      },
      {
        campaignId: CAMPAIGN,
        playerId: BOB,
        intentId: bobFrame,
        intent: { type: 'speech.say', channel: 'ooc', text: 'Une pause ?' },
      },
    ]);
  });

  it("la clé d'idempotence change à chaque trame : deux gestes ne sont jamais le même tour", async () => {
    const table = new Table();
    const alice = await table.join(ALICE);

    const first = table.nextFrameId();
    const second = table.nextFrameId();
    await alice.connection.receive(
      c2s('c2s.intent', { intent: { type: 'play_session.begin' } }, first),
    );
    await alice.connection.receive(
      c2s('c2s.intent', { intent: { type: 'play_session.begin' } }, second),
    );

    // Sans cette ligne, un serveur qui figerait `intentId` à une constante
    // rendrait les deux tours identiques aux yeux du service : le second
    // serait pris pour une reprise du premier, et jamais joué.
    expect(first).not.toBe(second);
    expect(table.service.submits.map((input) => input.intentId)).toStrictEqual([first, second]);
  });
});

describe('`c2s.resume_narration`, la couture de M0-29', () => {
  it("répond une erreur nommée tant que le tampon de narration n'est pas branché", async () => {
    const table = new Table();
    const alice = await table.join(ALICE);
    alice.socket.clear();

    await alice.connection.receive(
      c2s('c2s.resume_narration', { narrationId: 'n-1', lastChunk: 0 }, table.nextFrameId()),
    );

    expect(alice.socket.of('s2c.error')[0]?.p['code']).toBe('ai_unavailable');
  });

  it('rejoue le tampon quand il existe, et ne relance jamais une génération', async () => {
    let calls = 0;
    const asked: unknown[] = [];
    const table = new Table({
      replay: (input) => {
        calls += 1;
        asked.push(input);
        return Promise.resolve({
          narrationId: input.narrationId,
          chunk: input.lastChunk + 3,
          text: 'La corde tient.',
          status: 'done' as const,
        });
      },
    });
    const alice = await table.join(ALICE);
    alice.socket.clear();

    await alice.connection.receive(
      c2s('c2s.resume_narration', { narrationId: 'n-1', lastChunk: 2 }, table.nextFrameId()),
    );

    const frame = alice.socket.of('s2c.narration_snapshot')[0];
    expect(frame?.p['chunk']).toBe(5);
    expect(frame?.p['status']).toBe('done');
    expect(calls).toBe(1);
    // Rien n'a été soumis au service : une reprise est une lecture.
    expect(table.service.submitCalls).toBe(0);

    // LA QUATRIÈME LECTURE QUI PORTE L'IDENTITÉ DE LA SOCKET. Le tampon de
    // narration est adressé comme le reste : la campagne et le joueur viennent
    // de la session, jamais de la trame, qui ne porte que `narrationId` et
    // `lastChunk`. Sans cette ligne, un serveur qui rejouerait à Alice le
    // tampon de Bob passerait — c'est le même défaut que sur `getSnapshot`.
    expect(asked).toStrictEqual([
      { campaignId: CAMPAIGN, playerId: ALICE, narrationId: 'n-1', lastChunk: 2 },
    ]);
  });

  it("annonce `aborted` quand le tampon n'a plus rien", async () => {
    const table = new Table({ replay: () => Promise.resolve(null) });
    const alice = await table.join(ALICE);
    alice.socket.clear();

    await alice.connection.receive(
      c2s('c2s.resume_narration', { narrationId: 'n-1', lastChunk: 0 }, table.nextFrameId()),
    );

    expect(alice.socket.of('s2c.narration_error')[0]?.p['code']).toBe('aborted');
  });
});

describe('le hub ne décide rien (invariant 1)', () => {
  it('ne contient ni `decide(`, ni `reduce(`, ni `buildTurnProof(`', () => {
    const forbidden = ['decide(', 'reduce(', 'buildTurnProof('];
    const hits: string[] = [];

    for (const { file, text } of wsSources()) {
      for (const needle of forbidden) {
        if (text.includes(needle)) hits.push(`${file} : ${needle}`);
      }
    }

    expect(hits).toStrictEqual([]);
  });

  it('lit bien des fichiers : la sonde tombe sur une chaîne qui y est', () => {
    // Sans cette ligne, le test précédent serait vert sur un dossier vide ou
    // un chemin faux — le sixième mode de la batterie.
    const sources = wsSources();
    expect(sources.map((source) => source.file).sort()).toStrictEqual([
      'connection.ts',
      'handlers.ts',
      'hub.ts',
      'index.ts',
    ]);
    expect(sources.some((source) => source.text.includes('isVisibleTo'))).toBe(true);
  });

  it("n'importe du moteur que des types, et un seul tuple de valeurs", () => {
    const valueImports: string[] = [];

    for (const { file, text } of wsSources()) {
      for (const line of text.split('\n')) {
        if (!line.includes("from '@for/engine'")) continue;
        if (line.startsWith('import type')) continue;
        valueImports.push(`${file} : ${line.trim()}`);
      }
    }

    // UNE seule arête de VALEUR vers le moteur, et c'est le tuple des portées
    // de l'ADR 0008 — comparé au moteur, jamais recopié. Tout le reste arrive
    // en `import type`, donc rien de ce que le moteur DÉCIDE n'est joignable
    // d'ici.
    expect(valueImports).toStrictEqual(["hub.ts : import { EVENT_SCOPES } from '@for/engine';"]);
  });
});
