import { FIXTURE_CHAMPION, anId } from '@for/testkit';
import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import { aTableStateDto, presenceFrame, snapshotFrame, welcomeFrame } from '../test/frames.js';
import { rendreTable, unStore } from '../test/table.js';
import type { TableState } from '../ws/store.js';

/**
 * L'écran de table, côté « ce que le serveur a dit ».
 *
 * CE QUI A CHANGÉ DEPUIS M0-19, et pourquoi ce fichier ne ressemble plus au
 * précédent : la page n'est plus un empilement de coquilles nommées
 * (`Shells.tsx`), c'est la grille du §4 avec ses trois colonnes. Les coquilles
 * ont disparu avec la tâche qui les demandait ; ce qui reste à vérifier ici,
 * c'est que l'écran NE CALCULE RIEN — tout ce qu'il affiche vient du miroir.
 */

let store: StoreApi<TableState>;

beforeEach(() => {
  store = unStore();
  rendreTable({ largeur: 'assise', store });
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

  it('porte les trois colonnes du §4.1, dans l’ordre', () => {
    const colonnes = [...globalThis.document.querySelectorAll('[data-colonne]')].map((cellule) =>
      cellule.getAttribute('data-colonne'),
    );
    expect(colonnes).toEqual(['gauche', 'centre', 'droite']);
  });

  it('dit ce que chaque panneau vide attend, plutôt que de ne rien rendre', () => {
    // Règle 5. Un panneau qui ne rend rien est indiscernable d'un panneau cassé.
    for (const attente of [
      /Aucun personnage ne vous est attaché/u,
      /Aucune horloge ne tourne/u,
      /Aucun serment prêté/u,
      /Réservé\./u,
    ]) {
      expect(screen.getByText(attente)).toBeDefined();
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

  it('l’instantané remplit la fiche, sans que le client ne calcule rien', () => {
    recevoir(welcomeFrame(248, 30), snapshotFrame(aTableStateDto({ seq: 248 }), 248, 30));
    // Le personnage attaché est celui que `s2c.welcome` nomme : l'écran ne
    // choisit pas, il lit.
    expect(screen.getByText(FIXTURE_CHAMPION.displayName)).toBeDefined();
    expect(screen.getAllByText(/\d+ \/ \d+/u).length).toBeGreaterThan(0);
  });

  it('la présence vient du serveur', () => {
    const joueur = anId('player', 4);
    recevoir(presenceFrame([{ playerId: joueur, characterId: null }]));
    expect(screen.getByText(joueur)).toBeDefined();
  });

  it('un instantané sans personnage à soi laisse la fiche vide, il n’en invente pas', () => {
    recevoir(snapshotFrame(aTableStateDto({ seq: 248 }), 248, 30));
    expect(screen.getByText(/Aucun personnage ne vous est attaché/u)).toBeDefined();
  });
});
