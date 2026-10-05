import { anId } from '@for/testkit';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import { aTableStateDto, presenceFrame, snapshotFrame } from '../../test/frames.js';
import { panneauxOuverts, rendreTable, unStore } from '../../test/table.js';
import type { TableState } from '../../ws/store.js';

/**
 * Règle 7 et règle 8 de `docs/design/05-interface.md`, mesurées À TOUT INSTANT.
 *
 * « Jamais deux panneaux l'un sur l'autre. Un seul calque d'interface à la
 * fois, et un seul tiroir à la fois. » — et « toute modale naît au centre ».
 *
 * CE QUI REND CE FICHIER UTILE, et qui n'est pas évident : l'assertion n'est
 * pas prise à la FIN d'un parcours, elle est prise APRÈS CHAQUE GESTE. Un
 * écran qui ouvre le second panneau puis referme le premier à la frame d'après
 * passerait un test qui ne regarde que l'état final — et un joueur, lui, aurait
 * vu les deux. Le compte est donc relevé à chaque pas, et le nom du geste est
 * dans le message d'échec.
 *
 * `panneauxOuverts()` dédoublonne `[role="dialog"]` et `[aria-modal]` : un même
 * élément portant les deux ne compte qu'une fois, sinon la modale ferait deux à
 * elle seule et le test serait rouge pour rien.
 */

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

/** Un panneau dans un panneau : la modale dans la modale que §10 interdit. */
function panneauxEmboites(): readonly string[] {
  const ouverts = panneauxOuverts();
  return ouverts
    .filter((panneau) => ouverts.some((autre) => autre !== panneau && autre.contains(panneau)))
    .map((panneau) => panneau.getAttribute('aria-label') ?? '(sans nom)');
}

describe('jamais deux panneaux superposés, tiroirs compris', () => {
  it('tient à chaque geste d’un parcours qui ouvre tout ce qui s’ouvre', async () => {
    const store = unStore();
    rendreTable({ largeur: 'tiroirs', store });
    garnir(store);

    const gestes: readonly { readonly quoi: string; readonly faire: () => Promise<void> }[] = [
      {
        quoi: 'ouvrir le tiroir de droite',
        faire: async () => userEvent.click(screen.getByRole('button', { name: /La table/u })),
      },
      {
        quoi: 'ouvrir le tiroir de gauche par-dessus',
        faire: async () => userEvent.click(screen.getByRole('button', { name: /Fiche/u })),
      },
      {
        quoi: 'ouvrir le calque des destinataires depuis un tiroir ouvert',
        faire: async () => userEvent.click(screen.getByRole('radio', { name: /à ce groupe/u })),
      },
      {
        quoi: 'rouvrir un tiroir alors que le calque est ouvert',
        faire: async () => userEvent.click(screen.getByRole('button', { name: /La table/u })),
      },
      {
        quoi: 'refermer le tiroir',
        faire: async () => userEvent.click(screen.getByRole('button', { name: 'Fermer' })),
      },
    ];

    // Le parcours doit VRAIMENT ouvrir quelque chose : un parcours qui n'ouvre
    // rien satisfait « au plus un » sans rien prouver (mode 9).
    let maximum = 0;

    for (const geste of gestes) {
      await geste.faire();
      const ouverts = panneauxOuverts();
      const noms = ouverts.map((panneau) => panneau.getAttribute('aria-label') ?? '(sans nom)');
      maximum = Math.max(maximum, ouverts.length);
      expect(
        ouverts.length,
        `après « ${geste.quoi} » — ouverts : ${noms.join(' + ')}`,
      ).toBeLessThanOrEqual(1);
      expect(panneauxEmboites(), `après « ${geste.quoi} »`).toEqual([]);
    }

    expect(maximum).toBe(1);
  });

  it('ouvrir un calque depuis un tiroir ouvert laisse 0 tiroir et 1 modale', async () => {
    const store = unStore();
    rendreTable({ largeur: 'tiroirs', store });
    garnir(store);

    await userEvent.click(screen.getByRole('button', { name: /Fiche/u }));
    expect(globalThis.document.querySelectorAll('.fr-tiroir')).toHaveLength(1);

    await userEvent.click(screen.getByRole('radio', { name: /à ce groupe/u }));

    expect(globalThis.document.querySelectorAll('.fr-tiroir')).toHaveLength(0);
    const modales = screen.getAllByRole('dialog');
    expect(modales).toHaveLength(1);
    expect(modales[0]?.getAttribute('aria-modal')).toBe('true');
  });
});

describe('une modale naît au centre', () => {
  it('et jamais à l’intérieur d’une colonne latérale', async () => {
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnir(store);

    await userEvent.click(screen.getByRole('radio', { name: /à ce groupe/u }));

    const modale = screen.getByRole('dialog');
    // LA COLONNE EST CELLE DU DOM, pas celle d'une capture : sans portail, la
    // modale a un parent, et ce parent est une cellule nommée.
    expect(modale.closest('[data-colonne]')?.getAttribute('data-colonne')).toBe('centre');
    expect(modale.closest('[data-colonne="gauche"]')).toBeNull();
    expect(modale.closest('[data-colonne="droite"]')).toBeNull();
  });

  it('`Échap` referme le calque et rend le focus', async () => {
    // §9 : « piégeage du focus à l'entrée, restitution à la sortie ». Le
    // piégeage n'est pas écrit — un demi-piège est pire que pas de piège — mais
    // le DÉPLACEMENT et la RESTITUTION le sont, et c'est ce qui est mesuré ici.
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnir(store);

    const position = screen.getByRole('radio', { name: /à ce groupe/u });
    position.focus();
    await userEvent.click(position);

    const modale = screen.getByRole('dialog');
    expect(modale.contains(globalThis.document.activeElement)).toBe(true);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryAllByRole('dialog')).toEqual([]);
    expect(globalThis.document.activeElement).toBe(position);
  });

  it('les trois colonnes existent, donc « au centre » veut dire quelque chose', () => {
    // Sans ce test, « la modale n'est pas dans la colonne de gauche » serait
    // vrai d'un écran qui n'a pas de colonne de gauche.
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnir(store);

    const colonnes = [...globalThis.document.querySelectorAll('[data-colonne]')].map((cellule) =>
      cellule.getAttribute('data-colonne'),
    );
    expect(colonnes).toEqual(['gauche', 'centre', 'droite']);
  });
});
