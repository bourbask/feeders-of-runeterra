/**
 * `anEvent()` doit rendre une entrée de journal COMPLÈTE : seize champs
 * d'enveloppe plus une charge utile, et elle doit passer `zGameEvent`.
 */
import { zGameEvent } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { FIXTURE_TICK_MS, anEvent, fixtureCreatedAt } from './events.js';
import { aCorrelationId, anId } from './ids.js';

describe('anEvent', () => {
  it('sans argument, passe zGameEvent.parse', () => {
    expect(() => zGameEvent.parse(anEvent())).not.toThrow();
  });

  it('sans argument, rend une note système : l’entrée la plus neutre du catalogue', () => {
    expect(anEvent().type).toBe('system.note');
  });

  it('remplit les seize champs de l’enveloppe, y compris ceux d’ADR 0008', () => {
    const evenement = anEvent();

    expect(Object.keys(evenement).sort()).toStrictEqual([
      'actorKind',
      'actorPlayerId',
      'campaignId',
      'causationId',
      'correlationId',
      'createdAt',
      'id',
      'payload',
      'payloadVersion',
      'playSessionId',
      'recipients',
      'rngDrawIndex',
      'rngStream',
      'scope',
      'seq',
      'subjectCharacterId',
      'type',
    ]);
    expect(evenement.scope).toBe('table');
    expect(evenement.recipients).toBeNull();
  });

  it('l’identifiant, l’instant et la corrélation se déduisent du seq', () => {
    const evenement = anEvent({ seq: 12 });

    expect(evenement.seq).toBe(12);
    expect(evenement.id).toBe(anId('event', 12));
    expect(evenement.correlationId).toBe(aCorrelationId(12));
    expect(evenement.createdAt).toBe(fixtureCreatedAt(12));
    expect(fixtureCreatedAt(12) - fixtureCreatedAt(11)).toBe(FIXTURE_TICK_MS);
  });

  it('l’instant ne bouge pas d’un appel à l’autre : aucune horloge murale', () => {
    expect(anEvent().createdAt).toBe(anEvent().createdAt);
  });

  it('nommer un type impose sa charge utile, et l’entrée parse', () => {
    const evenement = anEvent({
      type: 'move.declared',
      seq: 4,
      actorKind: 'player',
      payload: {
        moveId: 'strike',
        characterId: anId('character'),
        narrativeInput: 'Je frappe.',
      },
    });

    expect(evenement.type).toBe('move.declared');
    expect(evenement.payload.moveId).toBe('strike');
    expect(() => zGameEvent.parse(evenement)).not.toThrow();
  });

  it('une portée adressée passe aussi', () => {
    const evenement = anEvent({ scope: 'private', recipients: [anId('player', 2)] });

    expect(() => zGameEvent.parse(evenement)).not.toThrow();
    expect(evenement.recipients).toStrictEqual([anId('player', 2)]);
  });
});
