import { anId } from '@for/testkit';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import { aTableStateDto, presenceFrame, snapshotFrame, welcomeFrame } from '../test/frames.js';
import { TableStoreProvider } from '../ws/context.js';
import type { TableState } from '../ws/store.js';
import { createTableStore } from '../ws/store.js';
import { TableRoom } from './TableRoom.js';

let store: StoreApi<TableState>;
let compteur: number;

beforeEach(() => {
  compteur = 0;
  store = createTableStore({
    send: () => undefined,
    newId: () => {
      compteur += 1;
      return `00000000-0000-4000-8000-${compteur.toString(16).padStart(12, '0')}`;
    },
    clientVersion: 'test',
  });
  render(
    <TableStoreProvider store={store}>
      <TableRoom />
    </TableStoreProvider>,
  );
});

function recevoir(...trames: unknown[]): void {
  act(() => {
    for (const trame of trames) store.getState().receive(trame);
  });
}

describe('la page « table » vide', () => {
  it('s’affiche avant le moindre message, et dit ce qui manque', () => {
    expect(screen.getByText(/Rien ne s’est encore passé/u)).toBeDefined();
    expect(screen.getByText(/instantané de la table n’est pas encore arrivé/u)).toBeDefined();
    expect(screen.getByText(/Personne d’autre n’est connecté/u)).toBeDefined();
  });

  it('porte ses coquilles vides, nommées', () => {
    for (const titre of [
      'Le fil',
      'À la table',
      'Fiche',
      'Jauges',
      'Horloges',
      'Serments',
      'Mouvements',
    ]) {
      expect(screen.getByRole('region', { name: titre })).toBeDefined();
    }
  });

  it('annonce l’état de la liaison', () => {
    expect(screen.getByText(/Liaison : en attente/u)).toBeDefined();
    act(() => {
      store.getState().setStatus('open');
    });
    expect(screen.getByText(/Liaison : connectée/u)).toBeDefined();
  });
});

describe('ce que le serveur envoie', () => {
  it('l’accueil donne la version de contenu et la tête de journal', () => {
    recevoir(welcomeFrame(248, 30));
    expect(screen.getByText(/contenu 1\.0\.0 · journal n° 248/u)).toBeDefined();
  });

  it('l’instantané remplit les coquilles, sans que le client ne compte rien', () => {
    recevoir(snapshotFrame(aTableStateDto({ seq: 248 }), 248, 30));
    expect(screen.getByText(/1 personnage\(s\)/u)).toBeDefined();
    expect(screen.getByText(/Aucune horloge/u)).toBeDefined();
    expect(screen.getByText(/Aucun serment/u)).toBeDefined();
  });

  it('la présence vient du serveur', () => {
    const joueur = anId('player');
    recevoir(presenceFrame([{ playerId: joueur, characterId: null }]));
    expect(screen.getByText(joueur)).toBeDefined();
  });
});
