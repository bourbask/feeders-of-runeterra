/**
 * `ChronicleDoc` — the two refusals the M0-12 sheet names, and the ceilings.
 *
 * `premise` at 401 characters and a fact without `event_seq` are the two the
 * criteria call out, and they are not arbitrary: the first is the ceiling that
 * keeps the whole document inside the token budget, the second is the
 * provenance without which a compaction can launder an invented fact into
 * campaign canon.
 */
import { describe, expect, it } from 'vitest';

import {
  CHRONICLE_MAX_ARCS,
  CHRONICLE_MAX_FACTS,
  CHRONICLE_PREMISE_MAX,
  ChronicleDoc,
  zChronicleDoc,
} from '../../src/ai/chronicle.js';

const empty = {
  premise: 'Une bande au Freljord.',
  arcs: [],
  characters: [],
  npcs: [],
  places: [],
  facts: [],
  open_threads: [],
  recent_digest: [],
};

const fact = {
  fact_id: 'f1',
  statement: 'Katla garde la passe.',
  entities: ['npc_katla'],
  event_seq: 42,
  superseded_by: null,
};

/** The fixture fact minus one key, to prove that key is required. */
function without(key: keyof typeof fact): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fact).filter(([name]) => name !== key));
}

describe('ChronicleDoc', () => {
  it('accepte un document vide mais complet', () => {
    expect(ChronicleDoc.safeParse(empty).success).toBe(true);
  });

  // LES CHIFFRES SONT ÉCRITS EN TOUTES LETTRES, et c'est délibéré.
  // Mesuré : une première version bornait avec `CHRONICLE_PREMISE_MAX` des
  // deux côtés. Porter la constante de 400 à 401 laissait le test VERT — il
  // prouvait « le schéma applique sa propre constante », ce que personne ne
  // demande. Le critère d'acceptation dit 401 refusé ; il faut donc 401 ici.
  it('les plafonds de la §5.2 valent bien ce que la spec écrit', () => {
    expect(CHRONICLE_PREMISE_MAX).toBe(400);
    expect(CHRONICLE_MAX_ARCS).toBe(8);
    expect(CHRONICLE_MAX_FACTS).toBe(60);
  });

  it('accepte un premise de 400 caractères et refuse celui de 401', () => {
    expect(ChronicleDoc.safeParse({ ...empty, premise: 'a'.repeat(400) }).success).toBe(true);
    expect(ChronicleDoc.safeParse({ ...empty, premise: 'a'.repeat(401) }).success).toBe(false);
  });

  it('refuse un fait sans event_seq : la provenance est obligatoire', () => {
    expect(ChronicleDoc.safeParse({ ...empty, facts: [without('event_seq')] }).success).toBe(false);
    expect(ChronicleDoc.safeParse({ ...empty, facts: [fact] }).success).toBe(true);
  });

  it('refuse un fait sans superseded_by : « rien ne l’a remplacé » se dit tout haut', () => {
    expect(ChronicleDoc.safeParse({ ...empty, facts: [without('superseded_by')] }).success).toBe(
      false,
    );
  });

  it('refuse un statement au-delà de 200 caractères', () => {
    expect(
      ChronicleDoc.safeParse({ ...empty, facts: [{ ...fact, statement: 'a'.repeat(201) }] })
        .success,
    ).toBe(false);
  });

  it('applique les plafonds durs de la §5.2', () => {
    const facts = Array.from({ length: CHRONICLE_MAX_FACTS + 1 }, (_, i) => ({
      ...fact,
      fact_id: `f${String(i)}`,
    }));
    expect(ChronicleDoc.safeParse({ ...empty, facts }).success).toBe(false);
    expect(
      ChronicleDoc.safeParse({ ...empty, facts: facts.slice(0, CHRONICLE_MAX_FACTS) }).success,
    ).toBe(true);

    const arcs = Array.from({ length: CHRONICLE_MAX_ARCS + 1 }, (_, i) => ({
      id: `a${String(i)}`,
      title: 'Un arc',
      status: 'ouvert' as const,
      summary: '',
      last_event_seq: 1,
    }));
    expect(ChronicleDoc.safeParse({ ...empty, arcs }).success).toBe(false);
  });

  it('zChronicleDoc et ChronicleDoc sont le même objet, pas deux déclarations', () => {
    expect(zChronicleDoc).toBe(ChronicleDoc);
  });

  it('ne porte aucune valeur mécanique', () => {
    expect(Object.keys(ChronicleDoc.shape).sort()).toStrictEqual([
      'arcs',
      'characters',
      'facts',
      'npcs',
      'open_threads',
      'places',
      'premise',
      'recent_digest',
    ]);
  });
});
