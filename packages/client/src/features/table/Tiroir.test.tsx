import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import { anId } from '@for/testkit';

import { aTableStateDto, presenceFrame, snapshotFrame } from '../../test/frames.js';
import { rendreTable, unStore } from '../../test/table.js';
import type { TableState } from '../../ws/store.js';
import type { ActionCalque, EtatCalques } from './calques.js';
import { CALQUES_FERMES, reduireCalques } from './calques.js';

/**
 * Les tiroirs (05-interface.md §4.4, §9, §12).
 *
 * DEUX NIVEAUX, ET C'EST VOULU. La règle « un seul tiroir à la fois » est
 * d'abord une propriété du RÉDUCTEUR — vérifiée en traversant TOUTES les
 * actions depuis TOUS les états atteignables, pas en cliquant sur deux boutons
 * et en espérant. Puis c'est une propriété de l'ÉCRAN, vérifiée en cliquant,
 * parce qu'un réducteur juste câblé de travers donne le même écran cassé.
 */

const ACTIONS: readonly ActionCalque[] = [
  { type: 'basculer-tiroir', cote: 'gauche' },
  { type: 'basculer-tiroir', cote: 'droite' },
  { type: 'fermer-tiroir' },
  { type: 'ouvrir-calque', calque: { nom: 'destinataires' } },
  { type: 'ouvrir-calque', calque: { nom: 'carte', objet: 'fiole-de-soin' } },
  { type: 'fermer-calque' },
];

/** Tous les états qu'une suite d'actions peut produire, calculés, pas listés. */
function etatsAtteignables(): readonly EtatCalques[] {
  const vus = new Map<string, EtatCalques>();
  let bord: EtatCalques[] = [CALQUES_FERMES];
  vus.set(JSON.stringify(CALQUES_FERMES), CALQUES_FERMES);

  while (bord.length > 0) {
    const suivant: EtatCalques[] = [];
    for (const etat of bord) {
      for (const action of ACTIONS) {
        const apres = reduireCalques(etat, action);
        const cle = JSON.stringify(apres);
        if (vus.has(cle)) continue;
        vus.set(cle, apres);
        suivant.push(apres);
      }
    }
    bord = suivant;
  }
  return [...vus.values()];
}

describe('ce qui peut être ouvert à la fois', () => {
  it('explore plus d’un état : sinon la traversée ne prouve rien', () => {
    // Une traversée qui ne trouve qu'un état passerait toutes les assertions
    // suivantes sans jamais les mettre à l'épreuve (mode 6 de la recette).
    expect(etatsAtteignables().length).toBeGreaterThan(3);
  });

  it('n’atteint jamais un état qui porte un tiroir ET un calque', () => {
    const fautifs = etatsAtteignables().filter(
      (etat) => etat.tiroir !== null && etat.calque !== null,
    );
    expect(fautifs).toEqual([]);
  });

  it('n’atteint jamais deux tiroirs : il n’y a qu’une place', () => {
    // Le type le dit déjà, et c'est le point : la règle 7 est tenue par une
    // FORME, pas par trois booléens que quelqu'un doit penser à remettre à
    // faux. Ce test fige la forme.
    for (const etat of etatsAtteignables()) {
      expect(['gauche', 'droite', null]).toContain(etat.tiroir);
    }
  });

  it('ouvrir le droit ferme le gauche', () => {
    const gauche = reduireCalques(CALQUES_FERMES, { type: 'basculer-tiroir', cote: 'gauche' });
    expect(gauche.tiroir).toBe('gauche');
    const droite = reduireCalques(gauche, { type: 'basculer-tiroir', cote: 'droite' });
    expect(droite.tiroir).toBe('droite');
  });

  it('ouvrir un calque referme le tiroir', () => {
    const gauche = reduireCalques(CALQUES_FERMES, { type: 'basculer-tiroir', cote: 'gauche' });
    const calque = reduireCalques(gauche, {
      type: 'ouvrir-calque',
      calque: { nom: 'destinataires' },
    });
    expect(calque).toEqual({ tiroir: null, calque: { nom: 'destinataires' } });
  });

  it('rappuyer sur le bouton-poussoir referme son propre tiroir', () => {
    const ouvert = reduireCalques(CALQUES_FERMES, { type: 'basculer-tiroir', cote: 'droite' });
    expect(reduireCalques(ouvert, { type: 'basculer-tiroir', cote: 'droite' }).tiroir).toBeNull();
  });
});

// --------------------------------------------------------------- à l'écran

function garnir(store: StoreApi<TableState>): void {
  act(() => {
    store.getState().receive(snapshotFrame(aTableStateDto({ seq: 12 }), 12, 3));
    store.getState().receive(
      presenceFrame([
        { playerId: anId('player', 1), characterId: null },
        { playerId: anId('player', 2), characterId: null },
      ]),
    );
  });
}

describe('les tiroirs de l’écran étroit', () => {
  it('le bouton-poussoir fermé porte le compte de ce qu’il contient', async () => {
    // §9 : « un bouton-poussoir nu est un bouton dont on ne devine pas
    // l'usage ; il porte le nombre d'objets qu'il contient ». Deux membres de
    // présence, pas un : à un seul, un compte faux de un passerait.
    const store = unStore();
    rendreTable({ largeur: 'tiroirs', store });
    garnir(store);

    const bouton = await screen.findByRole('button', { name: /La table/u });
    expect(bouton.getAttribute('aria-expanded')).toBe('false');
    expect(bouton.textContent).toContain('2');
  });

  it('n’ouvre jamais deux tiroirs : ouvrir le droit ferme le gauche', async () => {
    const store = unStore();
    rendreTable({ largeur: 'tiroirs', store });
    garnir(store);

    await userEvent.click(screen.getByRole('button', { name: /Fiche/u }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Fiche');

    await userEvent.click(screen.getByRole('button', { name: /La table/u }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('La table');
  });

  it('`Échap` referme le tiroir ouvert', async () => {
    const store = unStore();
    rendreTable({ largeur: 'tiroirs', store });
    garnir(store);

    await userEvent.click(screen.getByRole('button', { name: /Fiche/u }));
    expect(screen.queryAllByRole('dialog')).toHaveLength(1);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryAllByRole('dialog')).toEqual([]);
  });

  it('sur écran large, il n’y a pas de bouton-poussoir du tout', () => {
    // Un tiroir prend la place d'une colonne QUI N'A PLUS DE PLACE (§4.4). À
    // pleine largeur les deux colonnes sont là, donc il n'y a rien à ouvrir.
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnir(store);

    expect(screen.queryByRole('button', { name: /Fiche/u })).toBeNull();
    expect(screen.queryAllByRole('dialog')).toEqual([]);
  });
});
