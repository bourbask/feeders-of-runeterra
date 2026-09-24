import { describe, expect, it } from 'vitest';

import { zGameEvent } from './index.js';

const ulid = (n: number): string => `0${String(n).padStart(25, '0')}`;
const CORRELATION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CHARACTER_ID = ulid(1);

const envelope = (over: Record<string, unknown> = {}) => ({
  id: ulid(20),
  campaignId: ulid(6),
  seq: 12,
  playSessionId: null,
  actorKind: 'engine',
  actorPlayerId: null,
  subjectCharacterId: CHARACTER_ID,
  correlationId: CORRELATION_ID,
  causationId: null,
  rngStream: null,
  rngDrawIndex: null,
  createdAt: 1_758_000_000_000,
  scope: 'table',
  recipients: null,
  ...over,
});

const presence = (n: number) => ({
  ref: { kind: 'character' as const, id: ulid(n) },
  name: `Personnage ${String(n)}`,
  state: 'debout',
  sinceSeq: 1,
});

const factsUpdated = (payload: Record<string, unknown>) =>
  zGameEvent.safeParse({
    ...envelope({ actorKind: 'gm_ai' }),
    type: 'scene.facts_updated',
    payload: {
      sceneId: ulid(2),
      present: [],
      absent: [],
      source: 'gm_ai',
      ...payload,
    },
  });

describe('enveloppe d’événement', () => {
  it('applique payloadVersion = 1 par défaut', () => {
    const parsed = zGameEvent.parse({
      ...envelope(),
      type: 'entity.mentioned',
      payload: { entityId: ulid(3) },
    });
    expect(parsed.payloadVersion).toBe(1);
  });

  it('refuse un seq de zéro : la densité commence à 1', () => {
    const result = zGameEvent.safeParse({
      ...envelope({ seq: 0 }),
      type: 'entity.mentioned',
      payload: { entityId: ulid(3) },
    });
    expect(result.success).toBe(false);
  });

  it('refuse un actorKind hors des quatre', () => {
    const result = zGameEvent.safeParse({
      ...envelope({ actorKind: 'admin' }),
      type: 'entity.mentioned',
      payload: { entityId: ulid(3) },
    });
    expect(result.success).toBe(false);
  });

  it('refuse un type d’événement inconnu', () => {
    const result = zGameEvent.safeParse({
      ...envelope(),
      type: 'price.chosen',
      payload: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('scene.facts_updated — l’instantané borné', () => {
  it('accepte huit présents', () => {
    const present = Array.from({ length: 8 }, (_, i) => presence(i + 10));
    expect(factsUpdated({ present }).success).toBe(true);
  });

  it('refuse neuf présents', () => {
    const present = Array.from({ length: 9 }, (_, i) => presence(i + 10));
    expect(factsUpdated({ present }).success).toBe(false);
  });

  it('refuse une cause d’absence hors de parti | mort | hors_de_portee', () => {
    const absent = [
      { ref: { kind: 'entity', id: ulid(4) }, name: 'Keld', cause: 'endormi', sinceSeq: 3 },
    ];
    expect(factsUpdated({ absent }).success).toBe(false);
  });

  it('accepte les trois causes d’absence de la spécification', () => {
    for (const cause of ['parti', 'mort', 'hors_de_portee']) {
      const absent = [{ ref: { kind: 'entity', id: ulid(4) }, name: 'Keld', cause, sinceSeq: 3 }];
      expect(factsUpdated({ absent }).success, `cause « ${cause} »`).toBe(true);
    }
  });
});

describe('roll.price_paid — ADR 0006 dans le journal', () => {
  const pricePaid = (payload: Record<string, unknown>) =>
    zGameEvent.safeParse({
      ...envelope({ rngStream: 'price', rngDrawIndex: 3 }),
      type: 'roll.price_paid',
      payload: {
        rollId: ulid(5),
        value: 7,
        entryId: 'perte-de-vivres',
        text: 'Le sac se déchire.',
        severity: 'moyenne',
        effectIndex: 0,
        ...payload,
      },
    });

  it('accepte un prix tiré par le moteur', () => {
    expect(pricePaid({}).success).toBe(true);
  });

  it('ne conserve aucun champ de choix', () => {
    const parsed = zGameEvent.parse({
      ...envelope({ rngStream: 'price', rngDrawIndex: 3 }),
      type: 'roll.price_paid',
      payload: {
        rollId: ulid(5),
        value: 7,
        entryId: 'perte-de-vivres',
        text: 'Le sac se déchire.',
        severity: 'moyenne',
        effectIndex: 0,
        optionId: 'la-porte-de-derriere',
        playerChoices: ['vivres'],
      },
    });
    const keys = Object.keys(parsed.payload);
    expect(keys).not.toContain('optionId');
    expect(keys).not.toContain('playerChoices');
  });

  it('refuse une valeur de d12 hors de 1..12', () => {
    expect(pricePaid({ value: 13 }).success).toBe(false);
    expect(pricePaid({ value: 0 }).success).toBe(false);
  });
});

describe('move.resolved — les effets déjà exécutés', () => {
  it('accepte une liste d’effets moteur', () => {
    const result = zGameEvent.safeParse({
      ...envelope(),
      type: 'move.resolved',
      payload: {
        moveId: 'strike',
        characterId: CHARACTER_ID,
        rollSeq: 11,
        outcome: 'partielle',
        effectsApplied: [{ op: 'gauge', gauge: 'vigueur', delta: -1, target: 'self' }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('refuse un mouvement qui n’est pas de la liste V1', () => {
    const result = zGameEvent.safeParse({
      ...envelope(),
      type: 'move.resolved',
      payload: {
        moveId: 'parler-au-loup',
        characterId: CHARACTER_ID,
        rollSeq: 11,
        outcome: 'partielle',
        effectsApplied: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('campaign.settings_updated — patch et before', () => {
  it('accepte un patch partiel', () => {
    const result = zGameEvent.safeParse({
      ...envelope({ actorKind: 'player', actorPlayerId: ulid(2) }),
      type: 'campaign.settings_updated',
      payload: { patch: { gmVerbosity: 'ample' }, before: { gmVerbosity: 'standard' } },
    });
    expect(result.success).toBe(true);
  });

  it('refuse un patch portant une clé inconnue', () => {
    const result = zGameEvent.safeParse({
      ...envelope({ actorKind: 'player', actorPlayerId: ulid(2) }),
      type: 'campaign.settings_updated',
      payload: { patch: { verbosite: 'ample' }, before: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe('system.reverted — l’annulation', () => {
  it('accepte byPlayerId à null : le refus du conteur n’est pas humain', () => {
    const result = zGameEvent.safeParse({
      ...envelope({ actorKind: 'system' }),
      type: 'system.reverted',
      payload: { targetSeqs: [410, 411], reason: 'gm_refusal:target_gone', byPlayerId: null },
    });
    expect(result.success).toBe(true);
  });

  it('refuse une annulation qui ne vise aucune séquence', () => {
    const result = zGameEvent.safeParse({
      ...envelope({ actorKind: 'system' }),
      type: 'system.reverted',
      payload: { targetSeqs: [], reason: 'erreur', byPlayerId: null },
    });
    expect(result.success).toBe(false);
  });
});
