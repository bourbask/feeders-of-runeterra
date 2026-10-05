import type { C2SMessage } from '@for/contracts';
import type { EventScope, GameEventType } from '@for/engine';
import { EVENT_SCOPES, GAME_EVENT_TYPES } from '@for/engine';
import { aCorrelationId, anEvent, anId } from '@for/testkit';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import { aTurnProof, eventFrame, turnProofFrame } from '../../test/frames.js';
import { TableStoreProvider } from '../../ws/context.js';
import { ROLL_EVENT_TYPES } from '../../ws/journal.js';
import type { TableState } from '../../ws/store.js';
import { createTableStore } from '../../ws/store.js';
import { Journal } from './Journal.js';
import { PORTEES } from './portee.js';

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

const prose = (seq: number, texte: string, scope: EventScope = 'table', tour = TOUR) =>
  anEvent({
    seq,
    correlationId: tour,
    scope,
    recipients: scope === 'table' ? null : [anId('player', 1), anId('player', 2)],
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
const jet = (seq: number, tour = TOUR) =>
  anEvent({
    seq,
    correlationId: tour,
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

function blocs(): HTMLElement[] {
  return [...globalThis.document.querySelectorAll<HTMLElement>('.fr-journal__ligne')];
}

// ------------------------------------------------- les trois rails (§5)

/**
 * §12 : « La portée ne se lit pas à la couleur seule — `Journal.test.tsx` :
 * chaque portée a un glyphe et un libellé en texte. »
 *
 * §5.3 dit pourquoi c'est un critère et pas un goût : « si la portée ne se lit
 * qu'à la teinte, il ne sait plus qui lit son message, et il peut faire un
 * incident qu'aucune annulation ne répare ».
 */
describe('le fil à trois rails', () => {
  it('connaît exactement les portées du moteur', () => {
    // Le `satisfies Record<EventScope, …>` de `portee.ts` tient la compilation ;
    // il ne tient pas un rétrécissement du tuple du moteur (ADR 0007).
    expect(Object.keys(PORTEES).sort()).toEqual([...EVENT_SCOPES].sort());
  });

  it('donne à chaque portée un glyphe ET un libellé, tous les deux non vides', () => {
    // La source de la boucle est la liste du MOTEUR, pas celle de `portee.ts` :
    // vider `PORTEES` ferait tomber ce test au lieu de le rendre vert sur rien.
    for (const scope of EVENT_SCOPES) {
      const vue = PORTEES[scope];
      expect(vue.glyphe).not.toBe('');
      expect(vue.libelle).not.toBe('');
    }
    // Et les trois libellés sont DIFFÉRENTS : trois fois le même libellé
    // passerait un test qui dit seulement « il y en a un ».
    expect(new Set(EVENT_SCOPES.map((scope) => PORTEES[scope].libelle)).size).toBe(
      EVENT_SCOPES.length,
    );
  });

  it('porte les glyphes du §5.2, transcrits ici en toutes lettres', () => {
    // SONDE QUI A SERVI. La première version de ce fichier n'affirmait que
    // « chaque portée a un glyphe non vide ». Donner au personnel le glyphe du
    // public laissait la suite VERTE : le garde-fou existait et ne mordait pas.
    //
    // Et le critère n'est pas « trois glyphes différents » : le tableau du §5.2
    // donne ┃ ┃ ╏ — le public et le groupe PARTAGENT leur glyphe, et ce sont
    // l'indentation et le libellé qui les séparent. Ce qui doit tenir, c'est
    // que le PERSONNEL se distingue des deux autres sans la couleur.
    expect(PORTEES.table.glyphe).toBe('┃');
    expect(PORTEES.subset.glyphe).toBe('┃');
    expect(PORTEES.private.glyphe).toBe('╏');
    expect(PORTEES.private.glyphe).not.toBe(PORTEES.table.glyphe);
  });

  it('écrit le libellé de chaque bloc en texte, y compris pour le public', () => {
    // LA RANGÉE QUI COMPTE. Un bloc public n'est pas « celui qui n'a pas de
    // bandeau » : l'absence d'un signe ne porte pas de sens (§5.2).
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.', 'table')),
      eventFrame(413, 2, prose(413, 'Katla vous attend.', 'subset')),
      eventFrame(414, 3, prose(414, 'Tu vois la trappe.', 'private')),
    );

    const textes = blocs().map((bloc) => bloc.textContent);
    expect(textes).toHaveLength(3);
    expect(textes[0]).toContain('à toute la table');
    expect(textes[1]).toContain('à ce groupe');
    expect(textes[2]).toContain('à toi seul');
  });

  it('garde ces libellés quand toute couleur disparaît de l’arbre', () => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.', 'table')),
      eventFrame(414, 2, prose(414, 'Tu vois la trappe.', 'private')),
    );

    for (const element of globalThis.document.querySelectorAll('*')) {
      element.removeAttribute('class');
      element.removeAttribute('style');
    }

    expect(screen.getByText('à toute la table')).toBeDefined();
    expect(screen.getByText('à toi seul')).toBeDefined();
  });

  it('indente les trois niveaux comme le §5.2 le dit, dans l’ordre exact', () => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.', 'table')),
      eventFrame(413, 2, prose(413, 'Katla vous attend.', 'subset')),
      eventFrame(414, 3, prose(414, 'Tu vois la trappe.', 'private')),
    );

    expect(blocs().map((bloc) => bloc.dataset['niveau'])).toEqual(['0', '1', '2']);
    expect(blocs().map((bloc) => bloc.dataset['portee'])).toEqual(['table', 'subset', 'private']);
  });

  it('compte les destinataires d’un groupe plutôt que d’inventer leurs noms', () => {
    // `s2c.presence` ne porte aucun nom affichable : le client dit combien, il
    // n'écrit pas qui.
    afficher();
    recevoir(eventFrame(413, 1, prose(413, 'Katla vous attend.', 'subset')));
    expect(screen.getByText(/2 destinataire\(s\)/u)).toBeDefined();
  });
});

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

// ------------------------------------------- « Pourquoi ? » est sur les jets

/**
 * §10 : « Chaque JET est consultable via "Pourquoi ?", replié par défaut. »
 * M0-19 en mettait un sur chaque ligne de prose, ce qui faisait dire à la
 * commande « cette ligne existe » plutôt que « on a lancé les dés ici ».
 */
describe('la commande « Pourquoi ? »', () => {
  it('n’apparaît pas sur un tour qui n’a lancé aucun dé', () => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'Le vent tombe d’un coup.')),
      eventFrame(413, 2, prose(413, 'Personne ne parle.')),
    );

    // La prose EST à l'écran : l'absence du bouton n'est pas l'absence de tout.
    expect(screen.getByText('Le vent tombe d’un coup.')).toBeDefined();
    expect(screen.queryAllByRole('button', { name: 'Pourquoi ?' })).toEqual([]);
  });

  it('apparaît UNE fois sur un tour qui a lancé, même s’il porte trois proses', () => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(413, 2, jet(413)),
      eventFrame(414, 3, prose(414, 'Katla ne se lève pas.')),
      eventFrame(415, 4, prose(415, 'Le vent tombe.')),
    );

    expect(blocs()).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Pourquoi ?' })).toHaveLength(1);
  });

  it('en met un par tour qui a lancé, et aucun pour le tour sans jet', () => {
    const autre = aCorrelationId(8);
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(413, 2, jet(413)),
      eventFrame(414, 3, prose(414, 'Tu respires.', 'table', autre)),
      eventFrame(415, 4, prose(415, 'Rien ne bouge.', 'table', autre)),
    );

    expect(screen.getAllByRole('button', { name: 'Pourquoi ?' })).toHaveLength(1);
  });

  it('couvre les huit types de jet du moteur, nommés en toutes lettres', () => {
    // DEUX CHEMINS. À gauche la dérivation de `ws/journal.ts`, à droite la
    // liste écrite ici. Un type de jet renommé sans son préfixe fait tomber ce
    // test au lieu de perdre silencieusement son « Pourquoi ? ».
    const attendus: readonly GameEventType[] = [
      'roll.action_resolved',
      'roll.action_revised',
      'roll.progress_resolved',
      'roll.oracle_resolved',
      'roll.yes_no_resolved',
      'roll.price_paid',
      'roll.presage_drawn',
      'roll.raw',
    ];
    expect([...ROLL_EVENT_TYPES].sort()).toEqual([...attendus].sort());
    for (const type of attendus) expect(GAME_EVENT_TYPES).toContain(type);
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
    recevoir(eventFrame(412, 1, prose(412, 'La corde tient.')), eventFrame(413, 2, jet(413)));

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
    seq: 416,
    correlationId: TOUR,
    type: 'system.reverted',
    payload: {
      targetSeqs: [412, 413, 414, 415],
      reason: 'gm_refusal:cible_absente',
      byPlayerId: null,
    },
  });

  beforeEach(() => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(413, 2, jet(413)),
      eventFrame(414, 3, prose(414, 'Katla ne se lève pas.')),
      eventFrame(415, 4, prose(415, 'Le vent tombe d’un coup.')),
      eventFrame(416, 5, annulation),
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

  it('la preuve d’un tour annulé reste consultable', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Pourquoi ?' }));
    recevoir(
      turnProofFrame(
        aTurnProof({
          correlationId: TOUR,
          status: 'reverted',
          revertedBy: { seq: 416, reason: 'gm_refusal:cible_absente' },
        }),
      ),
    );

    expect(screen.getByText(/Tour annulé/u)).toBeDefined();
    expect(screen.getByText('Jet')).toBeDefined();
  });
});
