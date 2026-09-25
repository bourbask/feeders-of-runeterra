import { describe, expect, it } from 'vitest';

import { intentTypesOfSchema, zIntent } from './index.js';

const ulid = (n: number): string => `0${String(n).padStart(25, '0')}`;

describe('zIntent — le client n’envoie que des intentions (invariant 3)', () => {
  it('accepte un mouvement déclaré avec son attribut et sa description', () => {
    const result = zIntent.safeParse({
      type: 'move.face_danger',
      attribute: 'vif',
      description: 'Je saute la crevasse.',
    });
    expect(result.success).toBe(true);
  });

  it('refuse une intention portant un résultat de dé', () => {
    // Le test que 01-architecture.md §5.3 exige : une intention qui
    // transporterait une issue est refusée. Ici, elle est simplement écartée
    // du parse — le serveur ne la verra jamais.
    const parsed = zIntent.parse({
      type: 'move.face_danger',
      attribute: 'vif',
      description: 'Je saute.',
      actionDie: 6,
      outcome: 'franche',
    });
    const keys = Object.keys(parsed);
    expect(keys).not.toContain('actionDie');
    expect(keys).not.toContain('outcome');
  });

  it('aucune intention ne nomme une jauge, un dé ou un événement', () => {
    const forbidden = ['gauge', 'clock', 'price', 'narration', 'event', 'reduce'];
    for (const type of intentTypesOfSchema()) {
      for (const word of forbidden) {
        expect(type.startsWith(`${word}.`), `${type} ressemble à une mutation`).toBe(false);
      }
    }
  });

  it('momentum.burn ne porte que le jet visé', () => {
    const parsed = zIntent.parse({
      type: 'momentum.burn',
      rollId: ulid(5),
      total: 10,
      outcome: 'franche',
    });
    expect(Object.keys(parsed).sort()).toStrictEqual(['rollId', 'type']);
  });

  it('momentum.keep ne porte que le jet visé, comme la brûlure', () => {
    // La contrepartie de `momentum.burn` : dire non est une décision, donc une
    // intention. Elle ne transporte pas plus de résultat que le oui.
    const parsed = zIntent.parse({
      type: 'momentum.keep',
      rollId: ulid(5),
      outcome: 'echec',
      effectsApplied: [],
    });
    expect(Object.keys(parsed).sort()).toStrictEqual(['rollId', 'type']);
  });

  it('la famille momentum tient en deux membres, et ils visent le même jet', () => {
    const rollId = ulid(6);
    const family = intentTypesOfSchema().filter((type) => type.startsWith('momentum.'));
    expect([...family].sort()).toStrictEqual(['momentum.burn', 'momentum.keep']);
    for (const type of family) {
      expect(zIntent.safeParse({ type, rollId }).success).toBe(true);
      expect(zIntent.safeParse({ type }).success).toBe(false);
    }
  });

  it('refuse un type d’intention inconnu', () => {
    expect(zIntent.safeParse({ type: 'gauge.set', gauge: 'vigueur', value: 5 }).success).toBe(
      false,
    );
  });

  it('move.strike n’accepte que fer ou vif', () => {
    const base = { type: 'move.strike', targetId: ulid(4) };
    expect(zIntent.safeParse({ ...base, attribute: 'fer' }).success).toBe(true);
    expect(zIntent.safeParse({ ...base, attribute: 'vif' }).success).toBe(true);
    expect(zIntent.safeParse({ ...base, attribute: 'esprit' }).success).toBe(false);
  });

  it('character.create_draft exige une répartition légale', () => {
    const base = { type: 'character.create_draft', championSlug: 'braum', background: 'Berger.' };
    expect(
      zIntent.safeParse({ ...base, spread: { vif: 3, coeur: 2, fer: 2, ombre: 1, esprit: 1 } })
        .success,
    ).toBe(true);
    expect(
      zIntent.safeParse({ ...base, spread: { vif: 3, coeur: 3, fer: 2, ombre: 1, esprit: 1 } })
        .success,
    ).toBe(false);
  });

  it('probe_a_soul vise une entité connue ou une description', () => {
    expect(
      zIntent.safeParse({
        type: 'move.probe_a_soul',
        target: { kind: 'entity', entityId: ulid(7) },
      }).success,
    ).toBe(true);
    expect(
      zIntent.safeParse({
        type: 'move.probe_a_soul',
        target: { kind: 'description', text: 'la femme au capuchon' },
      }).success,
    ).toBe(true);
    expect(
      zIntent.safeParse({ type: 'move.probe_a_soul', target: { kind: 'character', id: ulid(7) } })
        .success,
    ).toBe(false);
  });

  it('borne la parole à 2000 caractères', () => {
    const say = (text: string) => zIntent.safeParse({ type: 'speech.say', channel: 'ic', text });
    expect(say('a'.repeat(2000)).success).toBe(true);
    expect(say('a'.repeat(2001)).success).toBe(false);
    expect(say('').success).toBe(false);
  });

  it('oracle.ask porte une question et une vraisemblance, jamais une réponse', () => {
    const parsed = zIntent.parse({
      type: 'oracle.ask',
      question: 'La tempête se lève-t-elle ?',
      likelihood: 'probable',
      answer: 'oui',
      threshold: 75,
    });
    const keys = Object.keys(parsed).sort();
    expect(keys).toStrictEqual(['likelihood', 'question', 'type']);
  });
});
