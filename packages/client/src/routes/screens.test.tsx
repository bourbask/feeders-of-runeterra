import type { TableStateDto } from '@for/contracts';
import type { EventScope, GameEvent } from '@for/engine';
import { aCharacter, aClock, aCorrelationId, aVow, anEvent, anId } from '@for/testkit';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import type { ReactNode } from 'react';
import { useState } from 'react';

import { Compositeur, LIMITE_TEXTE } from '../features/table/Compositeur.js';
import { JETONS_DES_SEUILS, SEUILS_REM, largeurDe } from '../features/table/largeur.js';
import { jetonsDe } from '../styles/contraste.js';
import {
  aTableStateDto,
  eventFrame,
  presenceFrame,
  rejectedFrame,
  snapshotFrame,
  welcomeFrame,
} from '../test/frames.js';
import { rendreTable, unStore } from '../test/table.js';
import type { TableState } from '../ws/store.js';
import { CampaignList } from './CampaignList.js';
import { CharacterPicker } from './CharacterPicker.js';
import { Login } from './Login.js';

const campagne = {
  id: anId('campaign'),
  slug: 'le-col',
  name: 'Le col de Rakelstake',
  pitch: 'Une passe que personne ne franchit deux fois.',
  status: 'active' as const,
  ownerPlayerId: anId('player'),
  contentPackVersion: '1.0.0',
  seq: 12,
};

describe('l’écran de connexion', () => {
  it('propose un LIEN vers Discord, pas un bouton qui appellerait fetch', () => {
    render(<Login apiBaseUrl="https://api.test" />);
    const lien = screen.getByRole('link', { name: /Discord/u });
    expect(lien.getAttribute('href')).toBe('https://api.test/api/auth/discord/start');
  });
});

describe('la liste des tables', () => {
  it('dit qu’il n’y en a aucune plutôt que de ne rien afficher', () => {
    render(<CampaignList campagnes={[]} />);
    expect(screen.getByText(/Aucune table/u)).toBeDefined();
  });

  it('renvoie vers la table par son identifiant', () => {
    render(<CampaignList campagnes={[campagne]} />);
    const lien = screen.getByRole('link', { name: 'Le col de Rakelstake' });
    expect(lien.getAttribute('href')).toBe(`#/campagnes/${campagne.id}`);
  });
});

describe('le choix du champion', () => {
  const personnage = {
    id: anId('character'),
    campaignId: campagne.id,
    championId: 'braum',
    displayName: 'Braum',
    sheetSource: 'handwritten' as const,
    status: 'active' as const,
  };

  it('ne montre que les personnages de CETTE table', () => {
    render(
      <CharacterPicker
        campaignId={campagne.id}
        personnages={[personnage, { ...personnage, campaignId: anId('campaign', 2) }]}
      />,
    );
    expect(screen.getAllByText(/Braum/u)).toHaveLength(1);
  });

  it('annonce la tâche qui remplira l’écran quand il est vide', () => {
    render(<CharacterPicker campaignId={campagne.id} personnages={[]} />);
    expect(screen.getByText(/M0-24/u)).toBeDefined();
  });
});

// ===========================================================================
// L'ÉCRAN DE TABLE (05-interface.md §4, §5, §6, §12)
// ===========================================================================

/**
 * Ce bloc tient quatre lignes du §12 que personne d'autre ne tient :
 *
 * - « Le sélecteur de destinataire est toujours rendu — présent sur toute la
 *   table, jamais dans un menu » ;
 * - « La colonne de droite est réservée et étiquetée en M1 — la colonne
 *   existe, vide, avec son EmptyState » ;
 * - « Le tiroir gauche est moins accessible que le droit — sur écran étroit,
 *   le bouton de l'inventaire est AVANT celui de la fiche dans l'ordre de
 *   lecture » ;
 * - « Un brouillon n'est jamais perdu — erreur réseau puis retour : le champ
 *   est intact ».
 *
 * Plus la sonde qui ne figure pas au tableau et qui est le critère central des
 * §5 et §6 : L'ÉCRAN RENDU SANS AUCUNE COULEUR. Pas une capture d'écran
 * neutralisée — l'arbre est dépouillé de tout `class` et de tout `style`, donc
 * aucune feuille ne s'applique plus, et on redemande à l'écran qui lit le
 * message et quelle jauge on regarde.
 */

function garnirLaTable(store: StoreApi<TableState>): void {
  act(() => {
    store.getState().receive(welcomeFrame(412, 4));
    store.getState().receive(snapshotFrame(aTableStateDto({ seq: 412 }), 412, 4));
    store.getState().receive(
      presenceFrame([
        { playerId: anId('player', 2), characterId: null },
        { playerId: anId('player', 3), characterId: null },
      ]),
    );
  });
}

function uneProse(seq: number, texte: string, scope: EventScope): GameEvent {
  return anEvent({
    seq,
    correlationId: aCorrelationId(7),
    scope,
    recipients: scope === 'table' ? null : [anId('player', 2)],
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
}

function depouillerLesTeintes(): void {
  for (const element of globalThis.document.querySelectorAll('*')) {
    element.removeAttribute('class');
    element.removeAttribute('style');
  }
}

describe('les seuils de largeur', () => {
  it('sont ceux de `tokens.css`, et non une seconde source', () => {
    // DEUX CHEMINS. À gauche le jeton, lu dans la feuille ; à droite le nombre
    // de `largeur.ts`. Une media query ne sait pas lire un jeton CSS, donc la
    // duplication est forcée — ce test est ce qui l'empêche de dériver.
    const chemin = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'tokens.css');
    const jetons = jetonsDe(readFileSync(chemin, 'utf8'));

    const paires = Object.entries(JETONS_DES_SEUILS);
    expect(paires).toHaveLength(Object.keys(SEUILS_REM).length);

    for (const [cle, jeton] of paires) {
      const valeur = jetons.get(jeton);
      expect(valeur, `${jeton} manque dans tokens.css`).toMatch(/^[\d.]+rem$/u);
      expect(Number.parseFloat((valeur ?? '').replace('rem', ''))).toBe(
        SEUILS_REM[cle as keyof typeof SEUILS_REM],
      );
    }
  });

  it('classent chaque largeur dans la forme que le §4.2 lui donne', () => {
    // Les bornes, et UN CRAN DE CHAQUE CÔTÉ de chacune : une comparaison
    // écrite `>` au lieu de `>=` ne se voit que là.
    expect(largeurDe(SEUILS_REM.ficheEnTiroir)).toBe('assise');
    expect(largeurDe(SEUILS_REM.ficheEnTiroir - 0.01)).toBe('tiroir-fiche');
    expect(largeurDe(SEUILS_REM.carnetEnTiroir)).toBe('tiroir-fiche');
    expect(largeurDe(SEUILS_REM.carnetEnTiroir - 0.01)).toBe('tiroirs');
    expect(largeurDe(SEUILS_REM.toutEnTiroir)).toBe('tiroirs');
    expect(largeurDe(SEUILS_REM.toutEnTiroir - 0.01)).toBe('portable');
  });
});

describe('l’écran de table, à pleine largeur', () => {
  it('rend les trois colonnes, et la droite est réservée avec son EmptyState', () => {
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnirLaTable(store);

    const droite = globalThis.document.querySelector('[data-colonne="droite"]');
    expect(droite).not.toBeNull();

    const carnet = droite?.querySelector('[data-reserve="v2"]');
    expect(carnet, 'la place du carnet est tenue dans la colonne de droite').not.toBeNull();
    // Vide, et qui dit ce qu'elle attend (règle 5).
    expect(carnet?.querySelector('.fr-vide')?.textContent ?? '').toContain('Réservé');
    expect(carnet?.querySelectorAll('li')).toHaveLength(0);
  });

  it('rend le sélecteur de destinataire, toujours, et jamais dans un menu', () => {
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnirLaTable(store);

    expect(screen.getByRole('radiogroup', { name: 'Destinataires' })).toBeDefined();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('n’a aucun bouton-poussoir : les deux colonnes sont là', () => {
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnirLaTable(store);
    expect(globalThis.document.querySelectorAll('.fr-bouton-tiroir')).toHaveLength(0);
  });
});

describe('l’écran de table, étroit', () => {
  it('met le bouton de la table AVANT celui de la fiche dans l’ordre de lecture', () => {
    // §4.4 : « Le tiroir gauche est volontairement moins accessible que le
    // droit, et c'est un choix de game design autant que d'interface. »
    // L'ordre est celui du DOM, donc celui du clavier et du lecteur d'écran —
    // pas un `order` de CSS, qui les laisserait tous les deux derrière.
    const store = unStore();
    rendreTable({ largeur: 'tiroirs', store });
    garnirLaTable(store);

    const poussoirs = [...globalThis.document.querySelectorAll('.fr-bouton-tiroir')];
    expect(poussoirs).toHaveLength(2);
    expect(poussoirs.map((bouton) => bouton.getAttribute('data-cote'))).toEqual([
      'droite',
      'gauche',
    ]);
  });

  it('sort les trois jauges du tiroir sur portable, et elles seules', () => {
    // §4.4 : « les trois seules choses qui doivent être visibles sans rien
    // ouvrir sont les trois jauges ».
    const store = unStore();
    rendreTable({ largeur: 'portable', store });
    garnirLaTable(store);

    const bandeau = globalThis.document.querySelector('[data-disposition="horizontale"]');
    expect(bandeau).not.toBeNull();
    expect(bandeau?.querySelectorAll('[data-jauge]')).toHaveLength(3);
    // Et rien d'autre n'est sorti : la fiche n'est pas à l'écran tant que son
    // tiroir est fermé.
    expect(screen.queryByText('Vos atouts')).toBeNull();
  });
});

describe('le brouillon', () => {
  it('survit à une erreur réseau et au retour du serveur', async () => {
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnirLaTable(store);

    const champ = screen.getByRole<HTMLTextAreaElement>('textbox');
    await userEvent.type(champ, 'Je descends en rappel');
    expect(champ.value).toBe('Je descends en rappel');

    // Une trame illisible, un refus du serveur, puis un instantané complet :
    // trois façons de faire re-rendre l'écran sous le champ.
    act(() => {
      store.getState().receive({ pas: 'une trame' });
      store.getState().receive(snapshotFrame(aTableStateDto({ seq: 420 }), 420, 9));
      store.getState().receive(
        rejectedFrame({
          intentId: '00000000-0000-4000-8000-000000000001',
          code: 'move_in_progress',
        }),
      );
    });

    expect(screen.getByRole('alert').textContent).toContain('mouvement');
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('Je descends en rappel');
  });
});

describe('l’écran rendu sans une seule couleur', () => {
  it('dit toujours qui lit chaque message, et quelle jauge on regarde', () => {
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnirLaTable(store);

    act(() => {
      store.getState().receive(eventFrame(413, 5, uneProse(413, 'La corde tient.', 'table')));
      store.getState().receive(eventFrame(414, 6, uneProse(414, 'Katla t’attend.', 'subset')));
      store.getState().receive(eventFrame(415, 7, uneProse(415, 'Tu vois la trappe.', 'private')));
    });

    // L'écran EST peuplé avant qu'on lui retire ses teintes : une interdiction
    // vérifiée sur un écran vide est vraie et ne prouve rien (#94).
    expect(globalThis.document.querySelectorAll('.fr-journal__ligne')).toHaveLength(3);
    expect(globalThis.document.querySelectorAll('[data-jauge]').length).toBeGreaterThan(0);

    depouillerLesTeintes();

    // QUI LIT MON MESSAGE. Relevé BLOC PAR BLOC, et pas sur le texte de la
    // page : le compositeur affiche lui aussi les trois libellés, donc une
    // assertion sur `body.textContent` reste verte quand le FIL perd les
    // siens. Sonde 21 : mesuré, la première version de ce test ne mordait pas.
    // `[data-niveau]` et non `.fr-journal__ligne` : dépouiller les teintes
    // ARRACHE les classes, donc un sélecteur de classe ne trouve plus rien et
    // la boucle devient vide — c'est-à-dire verte sur rien.
    const porteesDuFil = [...globalThis.document.querySelectorAll('[data-niveau]')].map((bloc) =>
      ['à toute la table', 'à ce groupe', 'à toi seul'].find((libelle) =>
        bloc.textContent.includes(libelle),
      ),
    );
    expect(porteesDuFil).toEqual(['à toute la table', 'à ce groupe', 'à toi seul']);

    // QUELLE JAUGE JE REGARDE : relevé jauge par jauge, pour la même raison.
    const nomsDesJauges = [...globalThis.document.querySelectorAll('[data-jauge]')].map((jauge) =>
      ['Vigueur', 'Âme', 'Vivres'].find((nom) => jauge.textContent.includes(nom)),
    );
    expect(nomsDesJauges).toEqual(['Vigueur', 'Âme', 'Vivres']);

    // Et la valeur de chacune est écrite : un aplat sans chiffre est du décor.
    expect(globalThis.document.body.textContent).toMatch(/\d+ \/ \d+/u);
  });
});

/**
 * CE QUE LE RAPPORT DE COUVERTURE A TROUVÉ, et que les sondes ne cherchaient
 * pas (RECETTE §5 bis). Ouvert du plus bas au plus haut : `LaTable.tsx` à 71 %
 * et `Fiche.tsx` à 86 % — toutes les branches NON VIDES de la colonne de
 * droite et de la fiche n'étaient jouées par aucun test. Un écran dont on n'a
 * jamais vu le cas « il y a quelque chose » est un écran dont on ne sait rien.
 */
describe('les panneaux remplis', () => {
  function unePartieEnCours(): TableStateDto {
    return aTableStateDto({
      characters: [
        aCharacter({
          conditions: [
            { conditionId: 'gelures', label: 'Gelures', source: 'content', sinceSeq: 3 },
          ],
          assets: [{ assetId: 'oeil-de-lynx', unlockedAbilities: [0], options: {} }],
        }),
      ],
      clocks: [aClock({ filled: 2 })],
      tracks: [aVow({ rank: 'redoutable' })],
    });
  }

  it('la colonne de droite montre les horloges et les serments du serveur', () => {
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    act(() => {
      store.getState().receive(snapshotFrame(unePartieEnCours(), 412, 4));
    });

    expect(screen.getByText(/La tempête se lève — 2 \/ 6/u)).toBeDefined();
    expect(screen.getByText(/Ramener la corne de Volibear — redoutable/u)).toBeDefined();
    // Et la place du carnet reste tenue, remplie ou non.
    expect(screen.getByText(/Réservé\./u)).toBeDefined();
  });

  it('la fiche montre les traits, les états et les atouts, sans en inventer le texte', () => {
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    act(() => {
      store.getState().receive(welcomeFrame(412, 4));
      store.getState().receive(snapshotFrame(unePartieEnCours(), 412, 4));
    });

    expect(screen.getByText('Gelures')).toBeDefined();
    expect(screen.getByText('oeil-de-lynx')).toBeDefined();
    // Le déclencheur n'est PAS inventé : l'écran dit où il vit.
    expect(screen.getByText(/vit dans le paquet de contenu/u)).toBeDefined();
  });
});

describe('le compositeur', () => {
  it('compte jusqu’à la borne du contrat, qui est celle du §7', () => {
    // 2000 vient du CRITÈRE D'ACCEPTATION — la maquette du §7 écrit
    // « 4 / 2000 ». Il est donc écrit ici en toutes lettres, et le composant
    // le lit sur `zSpeechSayIntent` : deux chemins, pas un chiffre comparé à
    // lui-même.
    expect(LIMITE_TEXTE).toBe(2000);
  });

  it('rend le bouton d’envoi désactivé, et dit pourquoi, plutôt que de le cacher', () => {
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnirLaTable(store);

    const bouton = screen.getByRole('button', { name: /envoyer/u });
    expect(bouton.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/n’est pas encore câblé/u)).toBeDefined();
  });

  it('bloque l’envoi tant que la déclassification n’est pas acceptée, puis le laisse passer', async () => {
    const envois: string[] = [];
    function Essai(): ReactNode {
      const [texte, setTexte] = useState('je réponds');
      const [acceptee, setAcceptee] = useState(false);
      return (
        <Compositeur
          texte={texte}
          onTexte={setTexte}
          portee="table"
          onPortee={() => undefined}
          presents={[]}
          choisis={[]}
          onOuvrirListe={() => undefined}
          porteeDuBloc="private"
          declassificationAcceptee={acceptee}
          onAccepterDeclassification={setAcceptee}
          erreur={null}
          onEnvoyer={() => envois.push(texte)}
        />
      );
    }

    render(<Essai />);
    const bouton = screen.getByRole('button', { name: /envoyer/u });
    expect(bouton.hasAttribute('disabled')).toBe(true);

    await userEvent.click(screen.getByRole('checkbox'));
    expect(bouton.hasAttribute('disabled')).toBe(false);

    await userEvent.click(bouton);
    expect(envois).toEqual(['je réponds']);
  });

  it('garde le bouton désactivé sur un brouillon vide, même sans avertissement', () => {
    render(
      <Compositeur
        texte="   "
        onTexte={() => undefined}
        portee="table"
        onPortee={() => undefined}
        presents={[]}
        choisis={[]}
        onOuvrirListe={() => undefined}
        porteeDuBloc={null}
        declassificationAcceptee={false}
        onAccepterDeclassification={() => undefined}
        erreur={null}
        onEnvoyer={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /envoyer/u }).hasAttribute('disabled')).toBe(true);
  });
});
