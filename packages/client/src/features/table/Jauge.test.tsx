import type { GaugeSet } from '@for/engine';
import { GAUGES, GAUGE_MAX } from '@for/engine';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Elan } from './Elan.js';
import { JAUGES, Jauges } from './Jauge.js';

/**
 * Les trois jauges (05-interface.md §6, §12).
 *
 * CE QUE CE FICHIER TIENT, et ce qu'il ne prétend pas tenir :
 *
 * - « les 3 jauges se distinguent sans la couleur » — la page est rendue, PUIS
 *   tout `class` et tout `style` sont arrachés de l'arbre. Ce qui reste est
 *   exactement ce qu'un joueur lit quand aucune teinte ne lui parvient : des
 *   nœuds de texte. Ce n'est pas une capture d'écran neutralisée, c'est une
 *   propriété du balisage.
 * - « le jeu de la jauge modifiée est une position, pas une couleur » — le rang
 *   est comparé au rang ATTENDU, écrit en toutes lettres ici, et l'ordre des
 *   trois est asserté comme un tableau exact (jamais « contient »).
 * - « le momentum n'est pas une jauge » — et l'interdiction n'est pas satisfaite
 *   par le vide : le test vérifie D'ABORD que les trois jauges sont bien là,
 *   puis que le mot n'y est pas.
 */

const VALEURS: GaugeSet = { vigueur: 4, ame: 2, vivres: 1 };

/** Les noms attendus, EN TOUTES LETTRES. Pas importés du composant : un test
 *  qui lit sa référence dans ce qu'il vérifie ne vérifie rien. */
const NOMS_ATTENDUS = ['Vigueur', 'Âme', 'Vivres'] as const;

/** L'ordre attendu du bloc, §4.3 : « dans l'ordre vigueur / âme / vivres ». */
const ORDRE_ATTENDU = ['vigueur', 'ame', 'vivres'] as const;

/**
 * Arrache toute couleur possible de l'arbre rendu : plus de classe, donc plus
 * de feuille de style qui s'applique, et plus de `style` en ligne.
 */
function neutraliserLesTeintes(): void {
  for (const element of globalThis.document.querySelectorAll('*')) {
    element.removeAttribute('class');
    element.removeAttribute('style');
  }
}

function jauges(): HTMLElement[] {
  return [...globalThis.document.querySelectorAll<HTMLElement>('[data-jauge]')];
}

describe('le bloc des trois jauges', () => {
  it('a exactement les jauges du moteur, ni une de plus ni une de moins', () => {
    // LE MIROIR, À L'EXÉCUTION. `satisfies readonly GaugeId[]` est covariant :
    // il attraperait une jauge INVENTÉE ici, jamais une jauge RETIRÉE du
    // moteur (ADR 0007). Les deux ensembles sont donc comparés membre à membre,
    // et le compte est asserté des deux côtés.
    expect([...JAUGES].sort()).toEqual([...GAUGES].sort());
    expect(JAUGES).toHaveLength(GAUGES.length);
  });

  it('rend les trois dans l’ordre du §4.3, comme un tableau exact', () => {
    render(<Jauges valeurs={VALEURS} />);
    expect(jauges().map((element) => element.dataset['jauge'])).toEqual([...ORDRE_ATTENDU]);
  });

  it('écrit la valeur à côté de chaque jauge, jamais l’aplat seul', () => {
    // §2.3 : « un aplat sans valeur écrite est une forme décorative ».
    render(<Jauges valeurs={VALEURS} />);
    expect(screen.getByText(`4 / ${String(GAUGE_MAX)}`)).toBeDefined();
    expect(screen.getByText(`2 / ${String(GAUGE_MAX)}`)).toBeDefined();
    // Les vivres se COMPTENT : une pastille, un vivres. Pas de dénominateur.
    expect(screen.getByText('1')).toBeDefined();
  });
});

describe('les trois jauges, sans une seule couleur', () => {
  it('gardent un glyphe distinct par jauge', () => {
    render(<Jauges valeurs={VALEURS} />);
    const glyphes = jauges().map(
      (element) => element.querySelector('.fr-jauge__glyphe')?.textContent ?? '',
    );

    neutraliserLesTeintes();

    expect(glyphes).toHaveLength(3);
    for (const glyphe of glyphes) expect(glyphe).not.toBe('');
    // Trois glyphes identiques passeraient un test qui dit « il y a un glyphe ».
    expect(new Set(glyphes).size).toBe(3);
  });

  it('gardent leur nom en toutes lettres, et trois noms différents', () => {
    render(<Jauges valeurs={VALEURS} />);
    neutraliserLesTeintes();

    const textes = jauges().map((element) => element.textContent);
    expect(textes).toHaveLength(NOMS_ATTENDUS.length);
    for (const [index, nom] of NOMS_ATTENDUS.entries()) {
      expect(textes[index]).toContain(nom);
    }
    expect(new Set(NOMS_ATTENDUS).size).toBe(3);
  });

  it('ne confient la teinte qu’à des éléments que personne ne lit', () => {
    // Le tube et les pastilles portent la couleur. S'ils étaient annoncés, un
    // lecteur d'écran entendrait un canal qui, lui, ne dit rien sans la teinte.
    render(<Jauges valeurs={VALEURS} />);
    for (const classe of ['.fr-jauge__tube', '.fr-jauge__pastilles']) {
      const elements = [...globalThis.document.querySelectorAll(classe)];
      expect(elements.length).toBeGreaterThan(0);
      for (const element of elements) {
        expect(element.getAttribute('aria-hidden')).toBe('true');
      }
    }
  });

  it('disent laquelle a changé sans que la couleur soit le seul canal', () => {
    render(<Jauges valeurs={VALEURS} modifiee="ame" />);
    neutraliserLesTeintes();
    expect(screen.getByText('modifiée ce tour')).toBeDefined();
  });
});

describe('la jauge modifiée', () => {
  it('est à l’emplacement attendu, et l’emplacement ne bouge pas', () => {
    // §6.2 : « c'est la POSITION dans le bloc qui le dit ». `ame` est deuxième
    // — un rang choisi au milieu, pas le premier, pour qu'une erreur d'indice
    // de un se voie.
    render(<Jauges valeurs={VALEURS} modifiee="ame" />);

    const marquees = jauges().filter((element) => element.dataset['modifiee'] === 'true');
    expect(marquees).toHaveLength(1);
    expect(marquees[0]?.dataset['jauge']).toBe('ame');
    expect(marquees[0]?.dataset['rang']).toBe('2');
  });

  it('n’en marque aucune quand aucun tour n’a rien touché', () => {
    render(<Jauges valeurs={VALEURS} />);
    expect(jauges().filter((element) => element.dataset['modifiee'] === 'true')).toEqual([]);
  });
});

describe('les états du §9', () => {
  it('vide : le libellé seul, et « — » à la place du chiffre', () => {
    render(<Jauges valeurs={null} />);
    expect(screen.getByText('Vigueur')).toBeDefined();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it('désactivé : la valeur reste lisible, elle ne disparaît pas', () => {
    render(<Jauges valeurs={VALEURS} etat="desactive" />);
    expect(screen.getByText(`4 / ${String(GAUGE_MAX)}`)).toBeDefined();
  });

  it('erreur : la valeur est conservée, et l’écran le dit', () => {
    render(<Jauges valeurs={VALEURS} etat="erreur" />);
    expect(screen.getByText(`4 / ${String(GAUGE_MAX)}`)).toBeDefined();
    expect(screen.getAllByText('valeur peut-être en retard')).toHaveLength(3);
  });
});

describe('le momentum', () => {
  it('n’est rendu par aucun composant de jauge', () => {
    // L'INTERDICTION N'EST PAS SATISFAITE PAR LE VIDE (#94) : on vérifie
    // d'abord que les trois jauges SONT là, sinon « le mot n'y est pas » est
    // vrai d'un écran blanc.
    render(<Jauges valeurs={VALEURS} modifiee="vigueur" etat="pret" />);
    const rendu = globalThis.document.body.textContent;

    for (const nom of NOMS_ATTENDUS) expect(rendu).toContain(nom);
    expect(jauges()).toHaveLength(3);

    for (const interdit of ['momentum', 'élan', 'elan']) {
      expect(rendu.toLowerCase()).not.toContain(interdit);
    }
  });

  it('se rend comme un badge chiffré, et non comme une barre', () => {
    // §6.3 : « une barre invite à être cliquée, et une fenêtre de jet n'a rien
    // à faire d'un clic ». Donc : pas de tube, pas de pastilles, rien de
    // cliquable, et la fenêtre fermée le dit.
    render(<Elan valeur={5} fenetreOuverte={false} />);

    expect(screen.getByText('Élan')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
    expect(screen.getByText(/aucune fenêtre ouverte/u)).toBeDefined();
    expect(globalThis.document.querySelectorAll('.fr-jauge__tube')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('ne dit « aucune fenêtre » que quand il n’y en a pas', () => {
    // Les deux sens. Une phrase affichée en permanence voudrait dire autant
    // qu'une phrase jamais affichée.
    render(<Elan valeur={5} fenetreOuverte />);
    expect(screen.getByText('Élan')).toBeDefined();
    expect(screen.queryByText(/aucune fenêtre ouverte/u)).toBeNull();
  });
});
