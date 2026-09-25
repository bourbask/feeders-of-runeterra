/**
 * LA DIFFUSION : le bloc ne sort jamais, le tampon rattrape, et la portée
 * s'applique ici comme elle s'applique aux événements.
 */

import { SCENE_CLOSE_TAG, SCENE_OPEN_TAG } from '@for/ai';
import {
  zS2CNarrationDelta,
  zS2CNarrationDone,
  zS2CNarrationError,
  zS2CNarrationSnapshot,
  zS2CNarrationStarted,
} from '@for/contracts';
import { describe, expect, it } from 'vitest';

import {
  NARRATION_BUFFER_TTL_MS,
  NARRATION_COALESCE_MS,
  NarrationDispatcher,
  TABLE_AUDIENCE,
  narrationVisibleTo,
  withheldSuffixLength,
} from '../../src/ai/broadcast.js';
import { movableClock, recordingSink } from './support.test.js';

import type { SinkFrame } from './support.test.js';

const CAMPAIGN = 'campagne-1';
const EPOCH = 1_700_000_000_000;

function aStream(audience = TABLE_AUDIENCE) {
  const dispatcher = new NarrationDispatcher();
  const frames: SinkFrame[] = [];
  const sink = recordingSink('joueur-a', frames);
  dispatcher.attach(CAMPAIGN, sink);
  const broadcast = dispatcher.open({
    campaignId: CAMPAIGN,
    eventSeq: 42,
    actorCharacterId: null,
    audience,
    now: EPOCH,
  });
  return { dispatcher, broadcast, frames, sink };
}

const deltas = (frames: readonly SinkFrame[]): string[] =>
  frames.filter((frame) => frame.t === 's2c.narration_delta').map((frame) => frame.p.text);

describe('la retenue de la balise <scene_apres>', () => {
  const PROSE = 'Le vent te prend de flanc. La corniche cède. Quelque chose bouge en contrebas.';
  const BLOC = `${SCENE_OPEN_TAG}{"presents":[]}${SCENE_CLOSE_TAG}`;

  it('aucun fragment ne porte la balise, même coupée en deux', () => {
    const { broadcast, frames } = aStream();
    const whole = `${PROSE}\n${BLOC}`;
    // UN CARACTÈRE À LA FOIS : c'est la seule découpe qui met la balise à
    // cheval sur tous les fragments possibles. Un test qui pousserait la
    // réponse d'un bloc ne mesurerait que le cas facile.
    const clock = movableClock(EPOCH);
    for (const character of whole) {
      broadcast.push(character);
      clock.advance(NARRATION_COALESCE_MS);
      broadcast.pump(clock.now());
    }
    broadcast.seal(clock.now());

    for (const fragment of deltas(frames)) {
      expect(fragment).not.toContain(SCENE_OPEN_TAG);
      expect(fragment).not.toContain('scene_apres');
    }
    expect(deltas(frames).join('')).toBe(`${PROSE}\n`);
    expect(broadcast.emittedText()).toBe(`${PROSE}\n`);
    // Le BRUT, lui, porte tout : c'est ce que `readNarration` lit.
    expect(broadcast.rawText()).toBe(whole);
  });

  it('et ce qui ressemblait à la balise sans l’être finit par sortir', () => {
    // LA MOITIÉ QU'ON OUBLIE. Une narration qui finit sur « < » retient un
    // caractère qu'aucun fragment suivant ne libérera : c'est `seal` qui le
    // rend. Un diffuseur qui jetterait sa réserve mangerait la fin de chaque
    // scène qui se termine sur un chevron.
    const { broadcast, frames } = aStream();
    broadcast.push('Il reste debout <');
    broadcast.seal(EPOCH + NARRATION_COALESCE_MS);
    expect(deltas(frames).join('')).toBe('Il reste debout <');
  });

  it('retient exactement ce qui peut encore être un préfixe de la balise', () => {
    expect(withheldSuffixLength('rien du tout')).toBe(0);
    expect(withheldSuffixLength('un chevron <')).toBe(1);
    // Le plus long préfixe possible fait un caractère de moins que la balise.
    expect(withheldSuffixLength(`presque ${SCENE_OPEN_TAG.slice(0, -1)}`)).toBe(
      SCENE_OPEN_TAG.length - 1,
    );
    // La balise ENTIÈRE n'est pas un préfixe : elle est la balise, et `push`
    // la traite à part.
    expect(withheldSuffixLength(`déjà ${SCENE_OPEN_TAG}`)).toBe(0);
  });

  it('rien n’est émis après la balise, même si le modèle continue à écrire', () => {
    const { broadcast, frames } = aStream();
    broadcast.push(`${PROSE}${SCENE_OPEN_TAG}{"partis":[]}`);
    broadcast.push(`${SCENE_CLOSE_TAG} et encore de la prose après`);
    broadcast.seal(EPOCH + NARRATION_COALESCE_MS);
    expect(deltas(frames).join('')).toBe(PROSE);
    expect(broadcast.emittedText()).not.toContain('encore de la prose');
  });
});

describe('la coalescence', () => {
  it('coalesce en fenêtres de 50 ms, et n’émet pas un message par jeton', () => {
    const { broadcast, frames } = aStream();
    const clock = movableClock(EPOCH);
    // Dix jetons DANS la même fenêtre : un seul message doit sortir.
    for (let index = 0; index < 10; index += 1) {
      broadcast.push(`jeton${String(index)} `);
      clock.advance(1);
      broadcast.pump(clock.now());
    }
    expect(deltas(frames)).toHaveLength(0);

    clock.advance(NARRATION_COALESCE_MS);
    expect(broadcast.pump(clock.now())).toBe(true);
    expect(deltas(frames)).toHaveLength(1);
    expect(deltas(frames)[0]).toContain('jeton0');
    expect(deltas(frames)[0]).toContain('jeton9');

    // ET DANS L'AUTRE SENS : deux fenêtres, deux messages.
    broadcast.push('encore');
    clock.advance(NARRATION_COALESCE_MS);
    broadcast.pump(clock.now());
    expect(deltas(frames)).toHaveLength(2);
  });

  it('le numéro de fragment croît de un par message écrit, jamais par jeton', () => {
    const { broadcast, frames } = aStream();
    const clock = movableClock(EPOCH);
    for (const piece of ['a', 'b', 'c']) {
      broadcast.push(piece);
      clock.advance(NARRATION_COALESCE_MS);
      broadcast.pump(clock.now());
    }
    const chunks = frames
      .filter((frame) => frame.t === 's2c.narration_delta')
      .map((frame) => frame.p.chunk);
    expect(chunks).toEqual([1, 2, 3]);
    expect(broadcast.currentChunk()).toBe(3);
  });
});

describe('le rattrapage en cours de génération', () => {
  it('un joueur qui arrive reçoit le tampon complet, puis la suite', () => {
    const { dispatcher, broadcast } = aStream();
    const clock = movableClock(EPOCH);
    broadcast.push('Le premier tiers. ');
    clock.advance(NARRATION_COALESCE_MS);
    broadcast.pump(clock.now());

    const late: SinkFrame[] = [];
    dispatcher.attach(CAMPAIGN, recordingSink('joueur-b', late));
    expect(late).toEqual([
      {
        t: 's2c.narration_snapshot',
        p: {
          narrationId: `${CAMPAIGN}:42`,
          chunk: 1,
          text: 'Le premier tiers. ',
          status: 'streaming',
        },
      },
    ]);

    broadcast.push('La suite.');
    clock.advance(NARRATION_COALESCE_MS);
    broadcast.pump(clock.now());
    expect(deltas(late)).toEqual(['La suite.']);
  });

  it('ne relance jamais une génération : `replay` rend le tampon, rien d’autre', async () => {
    const { dispatcher, broadcast } = aStream();
    broadcast.push('déjà écrit');
    broadcast.seal(EPOCH + NARRATION_COALESCE_MS);

    const replayed = await dispatcher.replay({
      campaignId: CAMPAIGN,
      playerId: 'joueur-a',
      narrationId: `${CAMPAIGN}:42`,
      lastChunk: 0,
    });
    expect(replayed?.text).toBe('déjà écrit');
    // Le tampon n'a pas bougé : rien n'a été redemandé au port.
    expect(broadcast.rawText()).toBe('déjà écrit');

    const unknown = await dispatcher.replay({
      campaignId: 'autre-campagne',
      playerId: 'joueur-a',
      narrationId: 'x',
      lastChunk: 0,
    });
    expect(unknown).toBeNull();
  });

  it('une seule génération en vol par campagne : rouvrir le même tour rend le même tampon', () => {
    const { dispatcher, broadcast } = aStream();
    const again = dispatcher.open({
      campaignId: CAMPAIGN,
      eventSeq: 42,
      actorCharacterId: null,
      audience: TABLE_AUDIENCE,
      now: EPOCH,
    });
    expect(again).toBe(broadcast);

    // Un tour SUIVANT, lui, ouvre un autre tampon.
    const next = dispatcher.open({
      campaignId: CAMPAIGN,
      eventSeq: 43,
      actorCharacterId: null,
      audience: TABLE_AUDIENCE,
      now: EPOCH,
    });
    expect(next).not.toBe(broadcast);
  });

  it('une socket qui part cesse de recevoir, et le reste de la table continue', () => {
    const dispatcher = new NarrationDispatcher();
    const a: SinkFrame[] = [];
    const b: SinkFrame[] = [];
    const leaving = recordingSink('joueur-b', b);
    dispatcher.attach(CAMPAIGN, recordingSink('joueur-a', a));
    dispatcher.attach(CAMPAIGN, leaving);
    const broadcast = dispatcher.open({
      campaignId: CAMPAIGN,
      eventSeq: 9,
      actorCharacterId: null,
      audience: TABLE_AUDIENCE,
      now: EPOCH,
    });
    const clock = movableClock(EPOCH);
    broadcast.push('avant');
    clock.advance(NARRATION_COALESCE_MS);
    broadcast.pump(clock.now());
    expect(deltas(b)).toEqual(['avant']);

    dispatcher.detach(CAMPAIGN, leaving);
    broadcast.push('après');
    clock.advance(NARRATION_COALESCE_MS);
    broadcast.pump(clock.now());

    // DEUX ACTEURS : ce qui suit va à A, et pas à B. Un seul destinataire
    // n'aurait rien dit du départ.
    expect(deltas(a)).toEqual(['avant', 'après']);
    expect(deltas(b)).toEqual(['avant']);
    expect(broadcast.currentStatus()).toBe('streaming');
  });

  it('le statut passe à `done` à la fin, et à `failed` sur un échec déclaré', () => {
    const { broadcast } = aStream();
    expect(broadcast.currentStatus()).toBe('streaming');
    broadcast.fail('engine_fallback', EPOCH, 'failed');
    expect(broadcast.currentStatus()).toBe('failed');

    const second = aStream();
    second.broadcast.complete({ eventSeq: 42, text: '', model: 'stub', source: 'engine' }, EPOCH);
    expect(second.broadcast.currentStatus()).toBe('done');
    // Et `action_impossible` ne CLÔT pas le flux : la prose reste valide,
    // c'est le tour qui est annulé (§6.2).
    const third = aStream();
    third.broadcast.fail('action_impossible', EPOCH);
    expect(third.broadcast.currentStatus()).toBe('streaming');
  });

  it('le tampon est libéré cinq minutes après `narration_done`, et pas avant', () => {
    const { dispatcher, broadcast } = aStream();
    broadcast.complete({ eventSeq: 42, text: 'fini', model: 'stub', source: 'engine' }, EPOCH);
    dispatcher.sweep(EPOCH + NARRATION_BUFFER_TTL_MS - 1);
    expect(dispatcher.current(CAMPAIGN)).toBe(broadcast);
    dispatcher.sweep(EPOCH + NARRATION_BUFFER_TTL_MS);
    expect(dispatcher.current(CAMPAIGN)).toBeUndefined();
  });
});

describe('la portée, sur le canal de narration', () => {
  it('une narration `private` ne part qu’aux destinataires, et une liste vide ne part à personne', () => {
    const audience = { scope: 'private' as const, recipients: ['joueur-a'] };
    expect(narrationVisibleTo(audience, 'joueur-a')).toBe(true);
    expect(narrationVisibleTo(audience, 'joueur-b')).toBe(false);
    // LE DÉFAUT EST LE REFUS.
    expect(narrationVisibleTo({ scope: 'subset', recipients: [] }, 'joueur-a')).toBe(false);
    expect(narrationVisibleTo({ scope: 'private', recipients: null }, 'joueur-a')).toBe(false);
    expect(narrationVisibleTo(TABLE_AUDIENCE, 'n’importe qui')).toBe(true);
  });

  it('DEUX DESTINATAIRES : ce qui n’est pas pour B n’atteint pas la socket de B', () => {
    const dispatcher = new NarrationDispatcher();
    const a: SinkFrame[] = [];
    const b: SinkFrame[] = [];
    dispatcher.attach(CAMPAIGN, recordingSink('joueur-a', a));
    dispatcher.attach(CAMPAIGN, recordingSink('joueur-b', b));
    const broadcast = dispatcher.open({
      campaignId: CAMPAIGN,
      eventSeq: 7,
      actorCharacterId: null,
      audience: { scope: 'private', recipients: ['joueur-a'] },
      now: EPOCH,
    });
    broadcast.push('secret');
    broadcast.seal(EPOCH + NARRATION_COALESCE_MS);
    broadcast.complete({ eventSeq: 7, text: 'secret', model: 'stub', source: 'ai' }, EPOCH);

    expect(deltas(a)).toEqual(['secret']);
    // Les OCTETS remis à B, pas les trames que le diffuseur croit avoir
    // envoyées : B n'a rien du tout, pas même un `started`.
    expect(b).toEqual([]);
  });
});

describe('les charges émises sont celles du protocole', () => {
  it('chaque charge émise est acceptée par le schéma du protocole', () => {
    const { broadcast, frames } = aStream();
    const clock = movableClock(EPOCH);
    broadcast.push('de la prose');
    clock.advance(NARRATION_COALESCE_MS);
    broadcast.pump(clock.now());
    broadcast.complete(
      { eventSeq: 42, text: 'de la prose', model: 'stub:narration', source: 'ai' },
      clock.now(),
    );
    broadcast.fail('action_impossible', clock.now());

    const schemas = {
      's2c.narration_started': zS2CNarrationStarted,
      's2c.narration_delta': zS2CNarrationDelta,
      's2c.narration_snapshot': zS2CNarrationSnapshot,
      's2c.narration_done': zS2CNarrationDone,
      's2c.narration_error': zS2CNarrationError,
    } as const;

    // Les CINQ trames sont sorties — l'instantané compris, que le diffuseur
    // écrit à l'abonnement. Un test qui n'en verrait que trois passerait sans
    // rien dire des deux autres.
    expect(new Set(frames.map((frame) => frame.t))).toEqual(
      new Set([
        's2c.narration_snapshot',
        's2c.narration_started',
        's2c.narration_delta',
        's2c.narration_done',
        's2c.narration_error',
      ]),
    );

    for (const frame of frames) {
      const envelope = {
        v: 1,
        t: frame.t,
        id: '00000000-0000-4000-8000-000000000001',
        ts: EPOCH,
        p: frame.p,
      };
      const parsed = schemas[frame.t].safeParse(envelope);
      expect(parsed.success, `${frame.t} : ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });
});
