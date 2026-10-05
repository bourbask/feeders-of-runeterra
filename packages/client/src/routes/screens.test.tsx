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

/**
 * LA DISPOSITION DES MAQUETTES (corrections 1, 6 et 7).
 *
 * CE QUI SE MESURE ICI ET CE QUI NE SE MESURE PAS. jsdom ne fait aucune mise en
 * page : personne ne peut lui demander si deux colonnes se touchent. Ce qui est
 * vérifiable, et ce qui casse en vrai quand on se trompe, c'est la STRUCTURE —
 * qui contient quoi, et dans quel ordre — plus le fait que la règle CSS qui
 * plafonne le fil existe, vise la bonne forme d'écran, et cite un jeton qui
 * existe. Le reste est un jugement à l'œil, et il est dit comme tel dans le
 * compte rendu.
 */
describe('la disposition de l’écran de table', () => {
  const TABLE_CSS = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'table.css'),
    'utf8',
  );

  it('pose les trois colonnes DANS la surface de jeu, et pas à côté', () => {
    // CORRECTION 7. La surface est sous les colonnes : si elle était leur
    // voisine au lieu d'être leur parent, elle serait un rectangle vide
    // au-dessus de l'écran, ce qui est très exactement à quoi ressemble ce
    // défaut-là quand on l'écrit de travers.
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnirLaTable(store);

    const jeu = globalThis.document.querySelector('.fr-table__jeu');
    expect(jeu).not.toBeNull();

    const colonnes = [...(jeu?.querySelectorAll('[data-colonne]') ?? [])].map((cellule) =>
      cellule.getAttribute('data-colonne'),
    );
    expect(colonnes).toEqual(['gauche', 'centre', 'droite']);

    // Et aucune colonne n'est restée dehors : le compte dans la surface est le
    // compte total. Sans cette moitié, une quatrième colonne orpheline
    // passerait.
    expect(globalThis.document.querySelectorAll('[data-colonne]')).toHaveLength(3);
  });

  it('ne titre plus la colonne de droite « La table », et la nomme quand même', () => {
    // CORRECTION 5. Le titre visible disparaît ; le NOM ACCESSIBLE reste, parce
    // qu'un panneau est identifié par son nom (§2.2) et qu'un lecteur d'écran
    // ne lit pas une barre du haut pour savoir dans quel panneau il est.
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    act(() => {
      store.getState().receive(snapshotFrame(aTableStateDto({ seq: 412 }), 412, 4));
    });

    const droite = globalThis.document.querySelector('[data-colonne="droite"]');
    expect(droite).not.toBeNull();
    // La colonne EST peuplée : une interdiction vérifiée sur une colonne vide
    // est vraie et ne prouve rien (sonde 94).
    expect(droite?.textContent ?? '').toContain('Horloges');

    const titres = [...(droite?.querySelectorAll('h1, h2, h3') ?? [])].map(
      (titre) => titre.textContent,
    );
    expect(titres.length).toBeGreaterThan(0);
    expect(titres).not.toContain('La table');

    expect(droite?.querySelector('section')?.getAttribute('aria-label')).toBe('La table');
  });

  it('met le fil et la saisie dans la MÊME carte, la saisie dessous', () => {
    // CORRECTION 1. L'ordre est celui du DOM — donc celui du clavier et du
    // lecteur d'écran — et pas un `order` de CSS qui les laisserait tous les
    // deux là où ils étaient.
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnirLaTable(store);

    const carte = globalThis.document.querySelector('.fr-table__carte');
    expect(carte).not.toBeNull();

    const fil = carte?.querySelector('.fr-fil') ?? null;
    const saisie = carte?.querySelector('.fr-compositeur') ?? null;
    expect(fil).not.toBeNull();
    expect(saisie).not.toBeNull();
    // `compareDocumentPosition` dit « suit », pas « est quelque part » :
    // intervertir les deux ferait tomber ce test.
    expect(
      (fil?.compareDocumentPosition(saisie as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it('plafonne le fil à pleine largeur, par un jeton qui existe', () => {
    // DEUX CHEMINS. À gauche la règle, lue dans la feuille ; à droite le jeton,
    // lu dans `tokens.css`. Une règle qui citerait un jeton inexistant ne lève
    // rien du tout : la propriété retombe sur sa valeur initiale et le fil
    // repousse la page comme avant.
    const regle =
      /\.fr-table\[data-largeur='assise'\]\s+\.fr-fil\s*\{[^}]*max-height:\s*var\((--[\w-]+)\)/u.exec(
        TABLE_CSS,
      );
    expect(regle, 'le plafond du fil n’est plus dans `table.css`').not.toBeNull();

    const chemin = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'tokens.css');
    const jetonsDuFichier = jetonsDe(readFileSync(chemin, 'utf8'));
    expect(jetonsDuFichier.has(regle?.[1] ?? '')).toBe(true);

    // Et la contrainte NE VISE QUE `assise` : en dessous il n'y a plus de place
    // à économiser, et un plafond y mangerait le peu qui reste.
    for (const etroite of ['tiroir-fiche', 'tiroirs', 'portable']) {
      expect(TABLE_CSS).not.toContain(`.fr-table[data-largeur='${etroite}'] .fr-fil`);
    }
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
  /**
   * LA SONDE QUI DÉCIDE. L'arbitrage A vient d'ajouter une TROISIÈME teinte de
   * portée ; elle ne doit rien porter à elle seule. On arrache donc `class` et
   * `style` de tout l'arbre — aucune feuille ne s'applique plus, pas une
   * couleur ne subsiste — et on redemande à l'écran, pour chaque bloc, QUI LE
   * LIT.
   *
   * CE QUI A CHANGÉ DEPUIS UI-01, et pourquoi la forme du test change avec.
   * Le bloc public ne porte plus d'étiquette (correction 3). La propriété à
   * tenir n'est donc plus « chaque bloc dit sa portée » mais « les trois
   * portées restent DISCERNABLES sans couleur » — ce qui est ce que le §5.3
   * protégeait, et ce que l'ancienne formulation atteignait par un moyen parmi
   * d'autres. On relève donc le TRIPLET exact par bloc, et on exige trois
   * valeurs distinctes.
   */
  function sansCouleurs(): readonly {
    readonly libelle: string | undefined;
    readonly niveau: string | null;
    readonly trait: string | null;
  }[] {
    // `[data-niveau]` et non `.fr-journal__ligne` : dépouiller ARRACHE les
    // classes, donc un sélecteur de classe ne trouverait plus rien et la boucle
    // deviendrait vide — c'est-à-dire verte sur rien.
    return [...globalThis.document.querySelectorAll('[data-niveau]')].map((bloc) => ({
      libelle: ['à toute la table', 'à ce groupe', 'à toi seul'].find((mot) =>
        bloc.textContent.includes(mot),
      ),
      niveau: bloc.getAttribute('data-niveau'),
      trait: bloc.getAttribute('data-trait'),
    }));
  }

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
    // vérifiée sur un écran vide est vraie et ne prouve rien (sonde 94).
    expect(globalThis.document.querySelectorAll('.fr-journal__ligne')).toHaveLength(3);
    expect(globalThis.document.querySelectorAll('[data-jauge]').length).toBeGreaterThan(0);

    depouillerLesTeintes();

    // QUI LIT MON MESSAGE. Relevé BLOC PAR BLOC, et pas sur le texte de la
    // page : le compositeur affiche lui aussi les trois libellés, donc une
    // assertion sur `body.textContent` reste verte quand le FIL perd les
    // siens. Sonde 21 : mesuré, la première version de ce test ne mordait pas.
    //
    // LE TABLEAU EXACT, et dans cet ordre. Le public est NU — c'est
    // l'arbitrage, et c'est la ligne la plus facile à casser sans s'en rendre
    // compte : lui remettre un bandeau ferait tomber ce test.
    expect(sansCouleurs()).toEqual([
      { libelle: undefined, niveau: '0', trait: 'aucun' },
      { libelle: 'à ce groupe', niveau: '1', trait: 'plein' },
      { libelle: 'à toi seul', niveau: '2', trait: 'pointille' },
    ]);

    // ET LA PROPRIÉTÉ ELLE-MÊME, écrite comme une propriété : trois portées,
    // trois signatures DISTINCTES, sans une couleur. C'est ce qu'un joueur
    // daltonien lit, et c'est tout ce qu'il a.
    expect(new Set(sansCouleurs().map((bloc) => JSON.stringify(bloc))).size).toBe(3);

    // QUELLE JAUGE JE REGARDE : relevé jauge par jauge, pour la même raison.
    const nomsDesJauges = [...globalThis.document.querySelectorAll('[data-jauge]')].map((jauge) =>
      ['Vigueur', 'Âme', 'Vivres'].find((nom) => jauge.textContent.includes(nom)),
    );
    expect(nomsDesJauges).toEqual(['Vigueur', 'Âme', 'Vivres']);

    // Et la valeur de chacune est écrite : un aplat sans chiffre est du décor.
    expect(globalThis.document.body.textContent).toMatch(/\d+ \/ \d+/u);
  });

  it('dit aussi, sans couleur, QUI sont les destinataires d’un groupe', () => {
    // CORRECTION 8 sous la même sonde. « vous 2 » et l'identifiant mécanique du
    // groupe sont du TEXTE : ils survivent au dépouillement, et c'est pour ça
    // qu'ils ont été écrits comme du texte et non comme un attribut de style.
    const store = unStore();
    rendreTable({ largeur: 'assise', store });
    garnirLaTable(store);

    act(() => {
      store.getState().receive(eventFrame(414, 6, uneProse(414, 'Katla t’attend.', 'subset')));
    });
    depouillerLesTeintes();

    const bloc = globalThis.document.querySelector('[data-niveau="1"]');
    expect(bloc).not.toBeNull();
    expect(bloc?.textContent ?? '').toContain('vous 1');
    expect(bloc?.textContent ?? '').toMatch(/\(g-[\da-z]{6}\)/u);
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
