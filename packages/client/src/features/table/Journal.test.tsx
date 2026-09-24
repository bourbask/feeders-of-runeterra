import type { C2SMessage } from '@for/contracts';
import { aCorrelationId, anEvent, anId } from '@for/testkit';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import { aTurnProof, eventFrame, turnProofFrame } from '../../test/frames.js';
import { TableStoreProvider } from '../../ws/context.js';
import type { TableState } from '../../ws/store.js';
import { createTableStore } from '../../ws/store.js';
import { Journal } from './Journal.js';

const TOUR = aCorrelationId(7);

let envoyes: C2SMessage[];
let store: StoreApi<TableState>;
let compteur: number;

beforeEach(() => {
  envoyes = [];
  compteur = 0;
  store = createTableStore({
    send: (frame) => envoyes.push(frame),
    newId: () => {
      compteur += 1;
      return `00000000-0000-4000-8000-${compteur.toString(16).padStart(12, '0')}`;
    },
    clientVersion: 'test',
  });
});

const prose = (seq: number, texte: string) =>
  anEvent({
    seq,
    correlationId: TOUR,
    type: 'narration.gm_message',
    payload: {
      text: texte,
      aiCallId: anId('aicall'),
      model: 'stub',
      promptVersion: 'conteur/2.0.0',
      source: 'ai',
      citedEventSeqs: [],
    },
  });

/** Le jet du tour, avec ses dés : il EST dans l'état local du client. */
const jet = (seq: number) =>
  anEvent({
    seq,
    correlationId: TOUR,
    type: 'roll.action_resolved',
    payload: {
      rollId: anId('roll'),
      characterId: anId('character'),
      moveId: 'face-danger',
      attribute: 'fer',
      attributeValue: 2,
      actionDie: 5,
      adds: [],
      rawTotal: 7,
      total: 7,
      cappedAtTen: false,
      challengeDice: [3, 9],
      outcome: 'partielle',
      isPresage: false,
      momentumBefore: 2,
      momentumNegated: false,
      burnWindow: true,
      rngStream: 'action',
      rngDrawIndex: 118,
    },
  });

const effet = (seq: number) =>
  anEvent({
    seq,
    correlationId: TOUR,
    type: 'character.gauge_changed',
    payload: {
      characterId: anId('character'),
      gauge: 'vigueur',
      delta: -1,
      from: 5,
      to: 4,
      clamped: false,
      cause: 'prix',
    },
  });

function recevoir(...trames: unknown[]): void {
  act(() => {
    for (const trame of trames) store.getState().receive(trame);
  });
}

function afficher(): void {
  render(
    <TableStoreProvider store={store}>
      <Journal />
    </TableStoreProvider>,
  );
}

// ----------------------------------------------------------- replié

describe('une scène non dépliée', () => {
  beforeEach(() => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient. En bas, les chiens ont cessé de japper.')),
      eventFrame(413, 2, jet(413)),
      eventFrame(414, 3, effet(414)),
    );
  });

  it('montre la prose', () => {
    expect(screen.getByText(/La corde tient/u)).toBeDefined();
  });

  it('n’affiche aucun dé, aucun total, aucun nom d’effet, aucun libellé de prix', () => {
    const ecran = document.body.textContent;
    for (const interdit of [
      '7', // le dé d'action et le total
      '3', // le premier dé de défi
      '9', // le second
      '118', // l'index de tirage
      'partielle', // l'issue
      'face-danger', // le mouvement joué
      'vigueur', // l'effet appliqué
      'prix', // le libellé de prix
      'action', // le flux RNG
    ]) {
      expect(ecran.toLowerCase()).not.toContain(interdit.toLowerCase());
    }
  });

  it('porte une commande « Pourquoi ? » repliée', () => {
    const bouton = screen.getByRole('button', { name: 'Pourquoi ?' });
    expect(bouton.getAttribute('aria-expanded')).toBe('false');
  });

  it('n’a demandé aucune preuve au serveur', () => {
    expect(envoyes).toEqual([]);
  });
});

// ------------------------------------------------------------- le clic

describe('un clic sur « Pourquoi ? »', () => {
  it('émet exactement un c2s.why, et jamais un c2s.intent', async () => {
    afficher();
    recevoir(eventFrame(412, 1, prose(412, 'La corde tient.')), eventFrame(413, 2, jet(413)));

    await userEvent.click(screen.getByRole('button', { name: 'Pourquoi ?' }));

    expect(envoyes).toHaveLength(1);
    expect(envoyes[0]).toMatchObject({ t: 'c2s.why', p: { correlationId: TOUR } });
    expect(envoyes.filter((frame) => frame.t === 'c2s.intent')).toEqual([]);
  });

  it('deux clics replient et déplient sans redemander la preuve', async () => {
    afficher();
    recevoir(eventFrame(412, 1, prose(412, 'La corde tient.')));

    const bouton = screen.getByRole('button', { name: 'Pourquoi ?' });
    await userEvent.click(bouton);
    recevoir(turnProofFrame(aTurnProof({ correlationId: TOUR })));
    await userEvent.click(screen.getByRole('button', { name: 'Masquer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pourquoi ?' }));

    expect(envoyes.filter((frame) => frame.t === 'c2s.why')).toHaveLength(1);
  });
});

// ------------------------------------------------- le panneau de preuve

describe('le panneau de preuve', () => {
  async function deplier(): Promise<void> {
    afficher();
    recevoir(eventFrame(412, 1, prose(412, 'La corde tient.')), eventFrame(413, 2, jet(413)));
    await userEvent.click(screen.getByRole('button', { name: 'Pourquoi ?' }));
  }

  it('affiche le jet quand `s2c.turn_proof` le porte', async () => {
    await deplier();
    recevoir(turnProofFrame(aTurnProof({ correlationId: TOUR })));

    expect(screen.getByText('Jet')).toBeDefined();
    const ecran = document.body.textContent;
    expect(ecran).toContain('118');
    expect(ecran).toContain('partielle');
  });

  it('sans `roll` dans la charge utile, la ligne « jet » disparaît au lieu d’être reconstruite', async () => {
    await deplier();
    // Le client A le `roll.action_resolved` dans son journal, dés compris.
    recevoir(turnProofFrame(aTurnProof({ correlationId: TOUR, roll: null })));

    expect(screen.queryByText('Jet')).toBeNull();
    expect(screen.queryByText('Tirage')).toBeNull();
    const ecran = document.body.textContent;
    expect(ecran).not.toContain('118');
    expect(ecran).not.toContain('partielle');
    // Ce que la preuve porte, lui, est bien là.
    expect(screen.getByText('Mouvement')).toBeDefined();
  });

  it('renvoie au journal complet quand la preuve est tronquée', async () => {
    await deplier();
    recevoir(turnProofFrame(aTurnProof({ correlationId: TOUR }), true));

    expect(screen.getByText(/journal complet/u)).toBeDefined();
  });
});

// ------------------------------------------------------ le tour annulé

describe('un tour annulé', () => {
  const annulation = anEvent({
    seq: 415,
    correlationId: TOUR,
    type: 'system.reverted',
    payload: {
      targetSeqs: [412, 413, 414],
      reason: 'gm_refusal:cible_absente',
      byPlayerId: null,
    },
  });

  beforeEach(() => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(413, 2, prose(413, 'Katla ne se lève pas.')),
      eventFrame(414, 3, prose(414, 'Le vent tombe d’un coup.')),
      eventFrame(415, 4, annulation),
    );
  });

  it('garde les trois lignes à l’écran, barrées', () => {
    const annulees = document.querySelectorAll('[data-annulee="true"]');
    expect(annulees).toHaveLength(3);
    expect(screen.getByText('La corde tient.')).toBeDefined();
    expect(screen.getByText('Katla ne se lève pas.')).toBeDefined();
    expect(screen.getByText('Le vent tombe d’un coup.')).toBeDefined();
  });

  it('affiche la cause, lisible', () => {
    expect(screen.getAllByText(/annulé : gm_refusal:cible_absente/u)).toHaveLength(3);
  });

  it('conserve la commande « Pourquoi ? » sur chaque ligne annulée', () => {
    expect(screen.getAllByRole('button', { name: 'Pourquoi ?' })).toHaveLength(3);
  });

  it('la preuve d’un tour annulé reste consultable', async () => {
    await userEvent.click(screen.getAllByRole('button', { name: 'Pourquoi ?' })[0]!);
    recevoir(
      turnProofFrame(
        aTurnProof({
          correlationId: TOUR,
          status: 'reverted',
          revertedBy: { seq: 415, reason: 'gm_refusal:cible_absente' },
        }),
      ),
    );

    // Les trois lignes appartiennent au MÊME tour : déplier le tour les déplie
    // toutes les trois, et chacune montre la même preuve — celle du serveur.
    expect(screen.getAllByText(/Tour annulé/u)).toHaveLength(3);
    expect(screen.getAllByText('Jet')).toHaveLength(3);
  });
});
