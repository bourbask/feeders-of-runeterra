import type { C2SMessage } from '@for/contracts';
import type { CharacterId, EventScope, GameEventType } from '@for/engine';
import { EVENT_SCOPES, GAME_EVENT_TYPES } from '@for/engine';
import { aCharacter, aCorrelationId, anEvent, anId } from '@for/testkit';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import {
  aTableStateDto,
  aTurnProof,
  eventFrame,
  presenceFrame,
  snapshotFrame,
  turnProofFrame,
} from '../../test/frames.js';
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

/** La scène SUIVANTE : c'est à elle que les dés sont rattachés (correction 11). */
const scene = (seq: number, titre: string, tour = TOUR) =>
  anEvent({
    seq,
    correlationId: tour,
    type: 'scene.started',
    payload: { sceneId: anId('scene'), title: titre, entityIds: [], presentCharacterIds: [] },
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
 * §12 : « La portée ne se lit pas à la couleur seule. »
 *
 * CE QUE L'ARBITRAGE DU 5 OCTOBRE A CHANGÉ À CETTE PROMESSE, ET CE QU'IL NE
 * CHANGE PAS. La promesse tient toujours ; le MÉCANISME n'est plus le même. Le
 * public ne porte plus d'étiquette du tout (correction 3) : il est le défaut, et
 * un défaut ne s'annonce pas. Ce qui porte la portée est donc :
 *
 *   - pour le public : RIEN. Et l'absence est lue à l'identique par tout le
 *     monde — c'est justement ce qu'un daltonien ne pouvait PAS faire quand
 *     l'information était « ce bloc n'est pas coloré ».
 *   - pour le groupe et le personnel : le bandeau EN TOUTES LETTRES avec les
 *     NOMS, le glyphe, l'indentation, et un trait plein ou pointillé
 *     (arbitrage B). Quatre canaux, dont aucun n'est une couleur.
 *
 * Le critère du §5.3 — « il sait toujours qui lit son message » — est donc
 * mesuré par la différence ENTRE les trois, teintes arrachées, et pas par la
 * présence d'une étiquette sur chacun.
 */
describe('le fil à trois rails', () => {
  it('connaît exactement les portées du moteur', () => {
    // Le `satisfies Record<EventScope, …>` de `portee.ts` tient la compilation ;
    // il ne tient pas un rétrécissement du tuple du moteur (ADR 0007).
    expect(Object.keys(PORTEES).sort()).toEqual([...EVENT_SCOPES].sort());
  });

  it('marque les portées restreintes, et seulement elles', () => {
    // La source de la boucle est la liste du MOTEUR, pas celle de `portee.ts` :
    // vider `PORTEES` ferait tomber ce test au lieu de le rendre vert sur rien.
    const marquees = EVENT_SCOPES.filter((scope) => PORTEES[scope].marque);
    expect([...marquees].sort()).toEqual(['private', 'subset']);

    for (const scope of marquees) {
      // Une portée marquée porte TOUT : glyphe, libellé, indentation, trait.
      expect(PORTEES[scope].glyphe).not.toBe('');
      expect(PORTEES[scope].libelle).not.toBe('');
      expect(PORTEES[scope].niveau).toBeGreaterThan(0);
      expect(PORTEES[scope].trait).not.toBe('aucun');
    }

    // Et le public ne porte rien : c'est l'arbitrage, écrit comme une assertion.
    expect(PORTEES.table.glyphe).toBe('');
    expect(PORTEES.table.niveau).toBe(0);
    expect(PORTEES.table.trait).toBe('aucun');

    // Les trois libellés restent DIFFÉRENTS : le compositeur, lui, les affiche
    // tous les trois, et trois fois le même libellé y serait injouable.
    expect(new Set(EVENT_SCOPES.map((scope) => PORTEES[scope].libelle)).size).toBe(
      EVENT_SCOPES.length,
    );
  });

  it('porte les glyphes du §5.2 et l’arbitrage B, transcrits ici en toutes lettres', () => {
    // SONDE QUI A SERVI. La première version de ce fichier n'affirmait que
    // « chaque portée a un glyphe non vide ». Donner au personnel le glyphe du
    // groupe laissait la suite VERTE : le garde-fou existait et ne mordait pas.
    expect(PORTEES.subset.glyphe).toBe('┃');
    expect(PORTEES.private.glyphe).toBe('╏');
    expect(PORTEES.private.glyphe).not.toBe(PORTEES.subset.glyphe);

    // ARBITRAGE B : le trait du privé est pointillé, celui du groupe est plein.
    // C'est le quatrième canal, et il n'est pas coloré.
    expect(PORTEES.subset.trait).toBe('plein');
    expect(PORTEES.private.trait).toBe('pointille');
  });

  it('laisse le bloc public NU, et marque les deux autres', () => {
    // CORRECTION 3, dans les deux sens. Le bloc public n'a ni bandeau, ni
    // glyphe, ni indentation ; les deux autres ont les trois. Relevé bloc par
    // bloc : une assertion sur la page entière resterait verte si le bandeau du
    // groupe atterrissait sur le bloc public.
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.', 'table')),
      eventFrame(413, 2, prose(413, 'Katla vous attend.', 'subset')),
      eventFrame(414, 3, prose(414, 'Tu vois la trappe.', 'private')),
    );

    const textes = blocs().map((bloc) => bloc.textContent);
    expect(textes).toHaveLength(3);
    expect(textes[0]).not.toContain('à toute la table');
    expect(textes[0]).not.toContain('┃');
    expect(textes[1]).toContain('à ce groupe');
    expect(textes[2]).toContain('à toi seul');

    expect(blocs().map((bloc) => bloc.dataset['niveau'])).toEqual(['0', '1', '2']);
    expect(blocs().map((bloc) => bloc.dataset['trait'])).toEqual(['aucun', 'plein', 'pointille']);
  });

  it('distingue encore les trois quand toute couleur disparaît de l’arbre', () => {
    // LA SONDE QUI DÉCIDE, en miniature. On arrache `class` et `style`, donc
    // aucune feuille ne s'applique, et on redemande à l'écran de séparer les
    // trois portées. `[data-niveau]` et non `.fr-journal__ligne` : dépouiller
    // ARRACHE les classes, et un sélecteur de classe trouverait zéro bloc —
    // c'est-à-dire vert sur rien.
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.', 'table')),
      eventFrame(413, 2, prose(413, 'Katla vous attend.', 'subset')),
      eventFrame(414, 3, prose(414, 'Tu vois la trappe.', 'private')),
    );

    for (const element of globalThis.document.querySelectorAll('*')) {
      element.removeAttribute('class');
      element.removeAttribute('style');
    }

    const vus = [...globalThis.document.querySelectorAll('[data-niveau]')].map((bloc) => ({
      libelle: ['à toute la table', 'à ce groupe', 'à toi seul'].find((mot) =>
        bloc.textContent.includes(mot),
      ),
      trait: bloc.getAttribute('data-trait'),
    }));

    expect(vus).toEqual([
      { libelle: undefined, trait: 'aucun' },
      { libelle: 'à ce groupe', trait: 'plein' },
      { libelle: 'à toi seul', trait: 'pointille' },
    ]);
  });

  it('nomme les destinataires d’un groupe, et dit ce qui manque quand il manque', () => {
    // CORRECTION 8. Le protocole ne porte pas de nom : le client JOINT la
    // présence et l'instantané. Ici, personne n'est présent, donc aucun nom
    // n'est trouvable — et l'écran le DIT au lieu d'écrire un identifiant dans
    // une phrase. Le compte, lui, vient de l'enveloppe et reste juste.
    afficher();
    recevoir(eventFrame(413, 1, prose(413, 'Katla vous attend.', 'subset')));

    const texte = blocs()[0]?.textContent;
    expect(texte).toContain('vous 2');
    expect(texte).toMatch(/le nom de 2 destinataires manque/u);
  });

  it('donne au groupe un identifiant mécanique, le même d’un bloc à l’autre', () => {
    // CE QUE L'IDENTIFIANT SERT À FAIRE. Deux blocs au même groupe portent la
    // MÊME clé ; un troisième bloc à un groupe différent en porte une AUTRE.
    // Sans lui, « à ce groupe » deux fois de suite ne dit pas si c'est le même
    // groupe — et c'est précisément ce qu'un joueur a besoin de savoir.
    afficher();
    recevoir(
      eventFrame(413, 1, prose(413, 'Katla vous attend.', 'subset')),
      eventFrame(414, 2, prose(414, 'La table reprend.', 'table')),
      eventFrame(415, 3, prose(415, 'Elle ne se lève pas.', 'subset')),
      eventFrame(
        416,
        4,
        anEvent({
          seq: 416,
          correlationId: TOUR,
          scope: 'subset',
          recipients: [anId('player', 3)],
          type: 'narration.gm_message',
          payload: {
            text: 'Toi, tu entends autre chose.',
            aiCallId: anId('aicall'),
            model: 'stub',
            promptVersion: 'conteur/2.0.0',
            source: 'ai',
            citedEventSeqs: [],
          },
        }),
      ),
    );

    const cles = blocs()
      .map((bloc) => /\(g-[\da-z]{6}\)/u.exec(bloc.textContent)?.[0] ?? null)
      .filter((cle): cle is string => cle !== null);

    // Trois bandeaux de groupe, pas un de plus : le bloc public n'en a pas.
    expect(cles).toHaveLength(3);
    expect(cles[0]).toBe(cles[1]);
    expect(cles[2]).not.toBe(cles[0]);
  });
});

// ------------------------------------- l'étiquette ne se réécrit pas (§2)

describe('l’étiquette de portée', () => {
  it('s’écrit au premier bloc d’une suite, et pas aux suivants', () => {
    // CORRECTION 2. Trois blocs de suite au même groupe : UN bandeau. La
    // fixture a trois éléments et non un, parce qu'un critère qui parle de
    // RÉPÉTITION ne se mesure pas sur une seule occurrence.
    afficher();
    recevoir(
      eventFrame(413, 1, prose(413, 'Katla vous attend.', 'subset')),
      eventFrame(414, 2, prose(414, 'Elle ne se lève pas.', 'subset')),
      eventFrame(415, 3, prose(415, 'Le feu est mort.', 'subset')),
    );

    expect(blocs()).toHaveLength(3);
    expect(blocs().map((bloc) => bloc.textContent.includes('à ce groupe'))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('se réécrit dès que la portée change, et pas avant', () => {
    afficher();
    recevoir(
      eventFrame(413, 1, prose(413, 'Katla vous attend.', 'subset')),
      eventFrame(414, 2, prose(414, 'Elle ne se lève pas.', 'subset')),
      eventFrame(415, 3, prose(415, 'Tu vois la trappe.', 'private')),
      eventFrame(416, 4, prose(416, 'Toi seul le sais encore.', 'private')),
    );

    expect(
      blocs().map((bloc) => {
        const texte = bloc.textContent;
        if (texte.includes('à ce groupe')) return 'groupe';
        if (texte.includes('à toi seul')) return 'seul';
        return null;
      }),
    ).toEqual(['groupe', null, 'seul', null]);
  });
});

// --------------------------------------------------- la rupture (§9)

describe('la rupture', () => {
  it('traverse le fil quand la bande se sépare, et une seule fois', () => {
    // CORRECTION 9 : c'est l'événement qui CRÉE les rails. Sans lui, les rails
    // apparaissent sans explication.
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.', 'table')),
      eventFrame(413, 2, prose(413, 'Katla vous attend.', 'subset')),
      eventFrame(414, 3, prose(414, 'Elle ne se lève pas.', 'subset')),
    );

    const ruptures = globalThis.document.querySelectorAll('[data-rupture]');
    expect(ruptures).toHaveLength(1);
    expect(ruptures[0]?.textContent).toContain('le groupe s’est séparé');
  });

  it('n’apparaît pas tant que tout le monde lit tout', () => {
    // L'autre sens. Un fil entièrement public n'a aucune bande à séparer, et
    // une rupture qui s'afficherait là serait un mensonge sur ce qui s'est
    // passé. La prose EST à l'écran : l'absence n'est pas l'absence de tout.
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.', 'table')),
      eventFrame(413, 2, prose(413, 'Le vent tombe.', 'table')),
    );

    expect(blocs()).toHaveLength(2);
    expect(globalThis.document.querySelectorAll('[data-rupture]')).toHaveLength(0);
  });
});

// --------------------------------------------- la parole et le récit (§12)

describe('la parole et le récit', () => {
  it('met la parole dans un `em` et le récit hors de tout `em`', () => {
    // CORRECTION 12, ET C'EST LE BALISAGE QUI EST MESURÉ, pas une classe : « le
    // jour où une voix de synthèse lira la table, elle lira LE RÉCIT et rien
    // d'autre ». Une voix lit des éléments, pas des feuilles de style — donc on
    // arrache les classes AVANT de regarder, et ce qui reste doit suffire.
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(
        413,
        2,
        anEvent({
          seq: 413,
          correlationId: TOUR,
          type: 'narration.player_message',
          payload: { text: 'Je descends en rappel.', kind: 'ic' },
        }),
      ),
    );

    for (const element of globalThis.document.querySelectorAll('*')) {
      element.removeAttribute('class');
      element.removeAttribute('style');
    }

    const paroles = [...globalThis.document.querySelectorAll('em')].map((em) => em.textContent);
    expect(paroles).toEqual(['Je descends en rappel.']);

    // Et le récit n'est dans AUCUN `em` : sans cette moitié, mettre tout le fil
    // en italique passerait la première.
    const recit = screen.getByText('La corde tient.');
    expect(recit.closest('em')).toBeNull();

    // La voix, elle, se lit sur l'attribut, qui survit au dépouillement.
    expect(
      [...globalThis.document.querySelectorAll('[data-voix]')].map((bloc) =>
        bloc.getAttribute('data-voix'),
      ),
    ).toEqual(['recit', 'parole']);
  });
});

// ----------------------------------------------------- le bloc promu (§10)

/**
 * LE MÊME ÉCRAN, À DEUX JOUEURS. `fil.test.ts` tient la règle sans rendre une
 * page ; ce fichier-ci tient le CÂBLAGE — que la présence arrive bien jusqu'à
 * `composerLeFil`, et que la phrase ne s'affiche que sous le bon nom.
 *
 * Les deux moitiés sont nécessaires : la règle peut être juste et le composant
 * ne jamais lui passer la présence, auquel cas plus personne n'est jamais
 * marqué et la correction 10 disparaît en silence. Le cas « Kevin » et le cas
 * « Théo » sont donc rendus tous les deux, depuis le même magasin.
 */
describe('le bloc promu', () => {
  const KEVIN = anId('player', 1);
  const THEO = anId('player', 2);
  const PERSONNAGE_DE_KEVIN = anId('character', 1);
  const PERSONNAGE_DE_THEO = anId('character', 2);

  /** Le conteur parle à Kevin, et à lui seul. */
  const secret = anEvent({
    seq: 413,
    correlationId: TOUR,
    scope: 'private',
    recipients: [KEVIN],
    type: 'narration.gm_message',
    payload: {
      text: 'Tu vois la trappe.',
      aiCallId: anId('aicall'),
      model: 'stub',
      promptVersion: 'conteur/2.0.0',
      source: 'ai',
      citedEventSeqs: [],
    },
  });

  const parole = (personnage: CharacterId, texte: string) =>
    anEvent({
      seq: 414,
      correlationId: TOUR,
      scope: 'table',
      recipients: null,
      actorKind: 'player',
      subjectCharacterId: personnage,
      type: 'narration.player_message',
      payload: { text: texte, kind: 'ic', characterId: personnage },
    });

  const laTable = () =>
    presenceFrame([
      { playerId: KEVIN, characterId: PERSONNAGE_DE_KEVIN },
      { playerId: THEO, characterId: PERSONNAGE_DE_THEO },
    ]);

  it('surligne la réponse publique du joueur QUI avait reçu', () => {
    afficher();
    recevoir(
      laTable(),
      eventFrame(413, 1, secret),
      eventFrame(414, 2, parole(PERSONNAGE_DE_KEVIN, 'Il y a une trappe sous la neige.')),
    );

    const promus = globalThis.document.querySelectorAll('[data-promu]');
    expect(promus.length).toBeGreaterThan(0);
    expect(blocs()[1]?.getAttribute('data-promu')).toBe('true');
    // Et la note dit QUI déclassifie : lui, pas le système.
    expect(screen.getByText(/il l’a rendu public, personne d’autre/u)).toBeDefined();
  });

  it('n’accuse PAS l’autre joueur, qui n’avait rien reçu', () => {
    // LE DÉFAUT CORRIGÉ, rendu. Même fil, même portée, même bloc privé
    // au-dessus : seul le locuteur change. Théo n'a jamais vu la trappe, et
    // écrire sous son nom qu'il l'a rendue publique est une accusation
    // nominative fausse, affichée à toute la table.
    afficher();
    recevoir(
      laTable(),
      eventFrame(413, 1, secret),
      eventFrame(414, 2, parole(PERSONNAGE_DE_THEO, 'J’ai froid.')),
    );

    expect(blocs()).toHaveLength(2);
    expect(globalThis.document.querySelectorAll('[data-promu]')).toHaveLength(0);
    expect(screen.queryByText(/il l’a rendu public, personne d’autre/u)).toBeNull();
  });

  it('ne surligne pas une réponse publique à du public', () => {
    // L'autre sens, et il mord : sans lui, « tout bloc de joueur est promu »
    // passerait le premier test.
    afficher();
    recevoir(
      laTable(),
      eventFrame(413, 1, prose(413, 'La corde tient.', 'table')),
      eventFrame(414, 2, parole(PERSONNAGE_DE_KEVIN, 'Il y a une trappe sous la neige.')),
    );

    expect(blocs()).toHaveLength(2);
    expect(globalThis.document.querySelectorAll('[data-promu]')).toHaveLength(0);
  });
});

// ------------------------------------------------- le nom de qui parle (M1)

describe('le locuteur d’une parole', () => {
  it('porte son NOM, joint à l’instantané, et jamais un identifiant brut', () => {
    // LE DÉFAUT : le bandeau du fil disait « vous 2 — Kevin et Théo » pendant
    // que la ligne juste en dessous écrivait `0CHARACTER…0002` au-dessus de la
    // parole. Le même écran, le même instant, deux façons de nommer les mêmes
    // gens. La jointure est celle de `destinataires.ts` : personnage →
    // `displayName` de l'instantané.
    const personnage = anId('character', 1);
    const etat = aTableStateDto({
      characters: [aCharacter({ id: personnage, displayName: 'Théo' })],
    });

    afficher();
    recevoir(
      snapshotFrame(etat, 0, 0),
      eventFrame(
        414,
        1,
        anEvent({
          seq: 414,
          correlationId: TOUR,
          scope: 'table',
          recipients: null,
          actorKind: 'player',
          subjectCharacterId: personnage,
          type: 'narration.player_message',
          payload: { text: 'Il y a une trappe.', kind: 'ic', characterId: personnage },
        }),
      ),
    );

    const qui = globalThis.document.querySelector('.fr-journal__qui');
    expect(qui?.textContent).toBe('Théo');
    // Et l'identifiant n'est plus nulle part dans le bloc : c'est l'assertion
    // qui mord, « contient le nom » resterait vraie à côté de l'identifiant.
    expect(blocs()[0]?.textContent).not.toContain(personnage);
  });

  it('retombe sur l’identifiant quand l’instantané ne porte pas le personnage', () => {
    // Le miroir JOINT, il n'invente pas. Sans personnage dans l'instantané, il
    // n'y a pas de nom à écrire — et un nom fabriqué serait pire.
    const personnage = anId('character', 9);

    afficher();
    recevoir(
      snapshotFrame(aTableStateDto(), 0, 0),
      eventFrame(
        414,
        1,
        anEvent({
          seq: 414,
          correlationId: TOUR,
          scope: 'table',
          recipients: null,
          actorKind: 'player',
          subjectCharacterId: personnage,
          type: 'narration.player_message',
          payload: { text: 'Il y a une trappe.', kind: 'ic', characterId: personnage },
        }),
      ),
    );

    expect(globalThis.document.querySelector('.fr-journal__qui')?.textContent).toBe(personnage);
  });
});

// ---------------------------------------------------------- l'oracle (§13)

describe('un résultat d’oracle', () => {
  it('se lit « question — RÉPONSE », dans son propre rail', () => {
    afficher();
    recevoir(
      eventFrame(
        412,
        1,
        anEvent({
          seq: 412,
          correlationId: TOUR,
          type: 'roll.yes_no_resolved',
          payload: {
            rollId: anId('roll'),
            question: 'La porte est-elle gardée ?',
            likelihood: 'probable',
            threshold: 75,
            value: 42,
            answer: 'oui',
            isExtreme: false,
          },
        }),
      ),
    );

    expect(blocs()).toHaveLength(1);
    expect(blocs()[0]?.getAttribute('data-voix')).toBe('oracle');
    expect(screen.getByText('La porte est-elle gardée ?')).toBeDefined();
    expect(screen.getByText('OUI')).toBeDefined();

    // Ni récit, ni parole : il n'emprunte l'étiquette d'aucun des deux.
    expect(blocs()[0]?.textContent).not.toContain('Le conteur');
    expect(blocs()[0]?.querySelector('em')).toBeNull();
    // Et aucun des nombres du tirage n'est passé.
    for (const interdit of ['75', '42', 'probable']) {
      expect(blocs()[0]?.textContent).not.toContain(interdit);
    }
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
      // La scène SUIVANTE : c'est elle qui porte « Pourquoi ? » depuis la
      // correction 11. Sans elle, les dés sont encore mis de côté.
      eventFrame(415, 4, scene(415, 'Le campement')),
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

// ------------------------------------- le détail mécanique est différé (§11)

/**
 * CORRECTION 11 : « Les dés ne s'affichent pas au moment du jet : ils sont mis
 * de côté et rattachés à la scène SUIVANTE, repliés derrière "Pourquoi ?". »
 *
 * C'est une décision de RYTHME, et elle se mesure en deux temps : au moment du
 * jet il n'y a rien, et à la scène d'après il y a exactement un bouton.
 */
describe('les dés mis de côté', () => {
  it('ne donne aucun « Pourquoi ? » tant que rien n’a suivi le jet', () => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(413, 2, jet(413)),
      eventFrame(414, 3, effet(414)),
    );

    // Le fil EST peuplé : l'absence du bouton n'est pas l'absence de tout.
    expect(blocs()).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: 'Pourquoi ?' })).toEqual([]);
  });

  it('le rattache à la scène suivante, et pas au bloc d’où il vient', () => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(413, 2, jet(413)),
      eventFrame(414, 3, scene(414, 'Le campement')),
    );

    const boutons = screen.getAllByRole('button', { name: 'Pourquoi ?' });
    expect(boutons).toHaveLength(1);

    // LE BLOC EXACT, pas « il y en a un quelque part ». Deux blocs à l'écran,
    // dans un ordre où le mauvais est le PREMIER : une assertion qui dirait
    // seulement « un bouton existe » resterait verte si rien n'avait changé.
    const porteurs = blocs().map((bloc) => bloc.querySelector('button') !== null);
    expect(porteurs).toEqual([false, true]);
  });

  it('en garde exactement un par tour qui a lancé, même à deux tours', () => {
    const autre = aCorrelationId(8);
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(413, 2, jet(413)),
      eventFrame(414, 3, scene(414, 'Le campement')),
      eventFrame(415, 4, jet(415, autre)),
      eventFrame(416, 5, scene(416, 'La crevasse')),
    );

    expect(screen.getAllByRole('button', { name: 'Pourquoi ?' })).toHaveLength(2);
    // Un bouton par bloc porteur, jamais deux sur le même : deux « Pourquoi ? »
    // côte à côte nomment deux tours et ressemblent à un.
    expect(blocs().map((bloc) => bloc.querySelectorAll('button').length)).toEqual([0, 1, 1]);
  });
});

// ------------------------------------------------------------- le clic

describe('un clic sur « Pourquoi ? »', () => {
  it('émet exactement un c2s.why, et jamais un c2s.intent', async () => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(413, 2, jet(413)),
      eventFrame(414, 3, scene(414, 'Le campement')),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Pourquoi ?' }));

    expect(envoyes).toHaveLength(1);
    expect(envoyes[0]).toMatchObject({ t: 'c2s.why', p: { correlationId: TOUR } });
    expect(envoyes.filter((frame) => frame.t === 'c2s.intent')).toEqual([]);
  });

  it('deux clics replient et déplient sans redemander la preuve', async () => {
    afficher();
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(413, 2, jet(413)),
      eventFrame(414, 3, scene(414, 'Le campement')),
    );

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
    recevoir(
      eventFrame(412, 1, prose(412, 'La corde tient.')),
      eventFrame(413, 2, jet(413)),
      eventFrame(414, 3, scene(414, 'Le campement')),
    );
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
