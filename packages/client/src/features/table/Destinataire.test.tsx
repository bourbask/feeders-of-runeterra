import type { EventScope } from '@for/engine';
import { EVENT_SCOPES } from '@for/engine';
import { anId } from '@for/testkit';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { aCharacter } from '@for/testkit';

import { aTableStateDto } from '../../test/frames.js';
import type { PresenceMember } from '../../ws/store.js';
import { Compositeur } from './Compositeur.js';
import { Destinataire, ListeDestinataires, avertissementDeclassification } from './Destinataire.js';

/**
 * Le sélecteur de destinataire (05-interface.md §7, §12).
 *
 * LA LIGNE DU §12 QUI COMPTE : « On ne déclassifie pas sans prévenir —
 * `Destinataire.test.tsx` : réponse publique à un bloc privé ⇒ avertissement
 * bloquant. »
 *
 * LES NEUF PAIRES, PAS UNE. L'avertissement est une fonction pure de deux
 * portées, donc les neuf combinaisons sont ÉNUMÉRÉES — trois clics auraient
 * couvert trois cas et laissé « groupe → public » passer en silence, qui est
 * exactement la déclassification que l'ADR 0008 décrit aussi.
 */

const PRESENTS: readonly PresenceMember[] = [
  { playerId: anId('player', 1), characterId: anId('character', 1), online: true, typing: false },
  { playerId: anId('player', 2), characterId: null, online: false, typing: false },
];

/** Un instantané où le personnage de PRESENTS[0] porte un nom affichable. */
const INSTANTANE = aTableStateDto({
  characters: [aCharacter({ id: anId('character', 1), displayName: 'Kevin' })],
});

function rendre(options: {
  readonly portee?: EventScope;
  readonly porteeDuBloc?: EventScope | null;
  readonly acceptee?: boolean;
  readonly onPortee?: (portee: EventScope) => void;
  readonly onOuvrirListe?: () => void;
  readonly choisis?: readonly string[];
  readonly table?: ReturnType<typeof aTableStateDto> | null;
}): void {
  render(
    <Destinataire
      portee={options.portee ?? 'table'}
      onPortee={options.onPortee ?? (() => undefined)}
      presents={PRESENTS}
      choisis={options.choisis ?? []}
      onOuvrirListe={options.onOuvrirListe ?? (() => undefined)}
      porteeDuBloc={options.porteeDuBloc ?? null}
      declassificationAcceptee={options.acceptee ?? false}
      onAccepterDeclassification={() => undefined}
      table={options.table ?? null}
    />,
  );
}

describe('le segmenté à trois positions', () => {
  it('a une position par portée du moteur, et aucune de plus', () => {
    // LE MIROIR À L'EXÉCUTION. Le `satisfies Record<EventScope, …>` de
    // `portee.ts` attrape une portée manquante à la compilation, pas une portée
    // que le moteur RETIRE (ADR 0007). Les deux listes sont donc comparées ici.
    rendre({});
    const positions = screen.getAllByRole('radio');
    expect(positions).toHaveLength(EVENT_SCOPES.length);
    expect(positions.map((radio) => radio.getAttribute('value')).sort()).toEqual(
      [...EVENT_SCOPES].sort(),
    );
  });

  it('est toujours rendu : il n’y a ni bouton pour l’ouvrir ni menu', () => {
    // §7.1 : « toujours visible, jamais replié, jamais dans un ⋯ ». Un
    // sélecteur qu'il faut ouvrir est un mode caché, et règle 4 l'interdit.
    rendre({});
    expect(screen.getByRole('radiogroup', { name: 'Destinataires' })).toBeDefined();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('⋯')).toBeNull();
  });

  it('écrit le libellé de chaque portée en toutes lettres', () => {
    // Les libellés sont écrits ICI, pas importés de `portee.ts` : un test qui
    // lit sa référence dans ce qu'il vérifie passerait sur trois chaînes vides.
    rendre({});
    for (const libelle of ['à toute la table', 'à ce groupe', 'à toi seul']) {
      expect(screen.getByText(libelle)).toBeDefined();
    }
  });
});

describe('l’avertissement de déclassification', () => {
  // Les neuf paires, calculées, pas listées : vider `EVENT_SCOPES` ferait
  // tomber la boucle entière plutôt que de la rendre verte sur rien.
  const paires = EVENT_SCOPES.flatMap((bloc) => EVENT_SCOPES.map((choisie) => ({ bloc, choisie })));

  it('couvre bien neuf paires', () => {
    expect(paires).toHaveLength(9);
  });

  it.each(paires)('bloc $bloc → envoi $choisie', ({ bloc, choisie }) => {
    const attendu = choisie === 'table' && bloc !== 'table';
    const avertissement = avertissementDeclassification(bloc, choisie);
    expect(avertissement === null).toBe(!attendu);
  });

  it('ne prévient de rien hors d’une réponse', () => {
    for (const choisie of EVENT_SCOPES) {
      expect(avertissementDeclassification(null, choisie)).toBeNull();
    }
  });

  it('s’affiche AVANT l’envoi, et nomme ce qui va se passer', () => {
    rendre({ portee: 'table', porteeDuBloc: 'private' });
    const alerte = screen.getByRole('alert');
    expect(alerte.textContent).toContain('Tu réponds en public');
    expect(alerte.textContent).toContain('toi seul');
  });

  it('ne s’affiche pas quand on répond en privé à du privé', () => {
    rendre({ portee: 'private', porteeDuBloc: 'private' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dit à quel bloc on répond, même sans avertissement', () => {
    rendre({ portee: 'private', porteeDuBloc: 'private' });
    expect(screen.getByText(/Tu réponds à un bloc dit à toi seul/u)).toBeDefined();
  });
});

describe('la liste des destinataires', () => {
  it('se coche, et ne se tape pas', () => {
    // §7.1 et §10 : « un champ libre pour désigner un destinataire » est
    // interdit. On compte les cases ET l'absence de champ texte : compter
    // seulement l'absence serait vrai d'une liste vide.
    render(<ListeDestinataires presents={PRESENTS} choisis={[]} onChoisis={() => undefined} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(PRESENTS.length);
    expect(screen.queryAllByRole('textbox')).toEqual([]);
  });

  it('rend chaque coche, et une coche change la sélection', async () => {
    const vus: (readonly string[])[] = [];
    render(
      <ListeDestinataires
        presents={PRESENTS}
        choisis={[]}
        onChoisis={(choisis) => vus.push(choisis)}
      />,
    );

    await userEvent.click(screen.getAllByRole('checkbox')[1]!);
    expect(vus).toEqual([[PRESENTS[1]!.playerId]]);
  });

  it('dit que le protocole ne porte pas de nom affichable', () => {
    // Signalé, pas contourné : le client n'invente pas un nom que
    // `s2c.presence` ne transporte pas.
    render(<ListeDestinataires presents={PRESENTS} choisis={[]} onChoisis={() => undefined} />);
    expect(screen.getByText(/pas encore de nom affichable/u)).toBeDefined();
  });

  it('dit ce qu’elle attend quand personne n’est là', () => {
    render(<ListeDestinataires presents={[]} choisis={[]} onChoisis={() => undefined} />);
    expect(screen.getByText(/il n’y a pas de groupe à viser/u)).toBeDefined();
  });
});

/**
 * CORRECTION 8 : « Et sous la saisie, avant d'envoyer : "Lu par Kevin, Théo".
 * Un joueur doit TOUJOURS savoir qui lit. »
 *
 * TOUJOURS, donc pour les trois positions et pas seulement pour le groupe : une
 * phrase qui n'apparaîtrait qu'en position 2 obligerait le joueur à déduire le
 * reste de la couleur du bouton allumé, ce qui est exactement ce que le §5.3
 * refuse.
 */
describe('« Lu par … », sous la saisie', () => {
  function composer(portee: EventScope, choisis: readonly string[] = []): void {
    // Rendu par le COMPOSITEUR, et pas par `Destinataire` seul : la correction
    // 8 dit « sous la saisie », donc la position relative au champ FAIT PARTIE
    // du critère et ne se mesure pas sur un composant isolé.
    render(
      <Compositeur
        texte=""
        onTexte={() => undefined}
        portee={portee}
        onPortee={() => undefined}
        presents={PRESENTS}
        choisis={choisis}
        onOuvrirListe={() => undefined}
        porteeDuBloc={null}
        declassificationAcceptee={false}
        onAccepterDeclassification={() => undefined}
        erreur={null}
        table={INSTANTANE}
      />,
    );
  }

  it('se lit SOUS le champ, et pas au-dessus', () => {
    composer('table');
    const champ = screen.getByRole('textbox');
    const phrase = screen.getByText(/^Lu par/u);
    // « suit », pas « existe » : remonter la phrase au-dessus du champ ferait
    // tomber ce test, ce qu'une simple présence ne ferait pas.
    expect(
      champ.compareDocumentPosition(phrase) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it('répond pour les trois positions, et jamais la même chose', () => {
    const phrases: (string | null)[] = [];
    for (const portee of ['table', 'private'] as const) {
      composer(portee);
      phrases.push(screen.getByText(/^Lu par/u).textContent);
      cleanup();
    }
    expect(phrases).toEqual(['Lu par toute la table.', 'Lu par toi seul.']);
  });

  it('nomme les cochés, avec l’identifiant mécanique du groupe', () => {
    composer('subset', [PRESENTS[0]!.playerId]);
    const phrase = screen.getByText(/Lu par/u).textContent;
    expect(phrase).toContain('Kevin');
    expect(phrase).toMatch(/\(g-[\da-z]{6}\)/u);
    // L'identifiant du joueur n'est PAS écrit dans la phrase : on lit un nom ou
    // on lit qu'il manque, jamais une clé de base.
    expect(phrase).not.toContain(PRESENTS[0]!.playerId);
  });

  it('dit ce qui manque plutôt que d’écrire un identifiant', () => {
    // PRESENTS[1] n'a pas de personnage : son nom n'existe nulle part sur le
    // fil, et la phrase le dit au lieu de le fabriquer.
    composer('subset', [PRESENTS[0]!.playerId, PRESENTS[1]!.playerId]);
    const phrase = screen.getByText(/Lu par/u).textContent;
    expect(phrase).toContain('Kevin');
    expect(phrase).toMatch(/le nom d’un destinataire manque/u);
    expect(phrase).not.toContain(PRESENTS[1]!.playerId);
  });

  it('dit qu’un groupe vide n’a aucun lecteur, au lieu de se taire', () => {
    composer('subset', []);
    expect(screen.getByText(/ce message n’a aucun lecteur/u)).toBeDefined();
  });
});
