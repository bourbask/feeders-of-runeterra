import { describe, expect, it } from 'vitest';

import { zTableState, zVisibleClock, zVisibleTrack } from './table-state.js';

const ulid = (n: number): string => `0${String(n).padStart(25, '0')}`;

const track = (visibility: string) => ({
  id: ulid(3),
  kind: 'vow',
  rank: 'dangereux',
  title: 'Retrouver la caravane',
  description: '',
  ownerCharacterId: null,
  ticks: 8,
  status: 'open',
  visibility,
  tags: [],
  createdSeq: 5,
  updatedSeq: 9,
  resolvedSeq: null,
});

const clock = (visibility: string) => ({
  id: ulid(4),
  title: 'La tempête monte',
  description: '',
  segments: 6,
  filled: 2,
  status: 'ticking',
  visibility,
  consequence: 'Le col se ferme.',
  createdSeq: 6,
  updatedSeq: 10,
});

const tableState = (over: Record<string, unknown> = {}) => ({
  campaignId: ulid(6),
  seq: 12,
  status: 'active',
  contentPackHash: 'sha256:0000',
  settings: {
    schemaVersion: 1,
    models: { narration: null, structured: null },
    gmVerbosity: 'standard',
    oracleBias: 'neutre',
    safety: { lines: [], veils: [] },
    allowForgedChampions: true,
    requireForgeReview: false,
  },
  truths: [],
  characters: [],
  tracks: [track('public')],
  clocks: [clock('public')],
  entities: [],
  championLocks: [],
  scene: null,
  party: { memberPlayerIds: [ulid(2)], ownerPlayerId: ulid(2) },
  ...over,
});

describe('zTableState — la projection vue par un joueur', () => {
  it('accepte une projection ne portant que des lignes publiques', () => {
    expect(zTableState.safeParse(tableState()).success).toBe(true);
  });

  it('refuse une piste de visibilité gm', () => {
    // La règle « la projection retire les lignes visibility: gm » est portée
    // par le type, pas par la mémoire du projecteur.
    expect(zTableState.safeParse(tableState({ tracks: [track('gm')] })).success).toBe(false);
    expect(zVisibleTrack.safeParse(track('gm')).success).toBe(false);
  });

  it('refuse une horloge de visibilité gm', () => {
    expect(zTableState.safeParse(tableState({ clocks: [clock('gm')] })).success).toBe(false);
    expect(zVisibleClock.safeParse(clock('gm')).success).toBe(false);
  });

  it('ne transporte pas la graine du générateur', () => {
    // `rng.seed` plus un index de flux, c'est tout l'avenir des dés. Une clé
    // `rng` fournie est écartée : elle ne ressort pas du parse.
    const parsed = zTableState.parse(tableState({ rng: { seed: 'graine', draws: {} } }));
    expect(Object.keys(parsed)).not.toContain('rng');
  });
});
