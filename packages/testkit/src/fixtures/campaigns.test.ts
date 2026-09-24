/**
 * La campagne longue est la preuve de l'invariant 2. Elle ne prouve rien si
 * ses entrées ne parsent pas : une fixture de journal invalide rendrait vert
 * tout test de rejeu qui s'appuie dessus, sans rien vérifier.
 *
 * On parse donc les 2 000, pas trois.
 */
import { zGameEvent } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { expectSeqContiguous } from '../assertions.js';
import { stableStringify } from '../golden/stable-stringify.js';
import { JOURNAL_TURN_LENGTH, LONG_CAMPAIGN, LONG_CAMPAIGN_LENGTH, aJournal } from './campaigns.js';
import { anId } from './ids.js';

describe('LONG_CAMPAIGN', () => {
  it('porte au moins 2 000 entrées', () => {
    expect(LONG_CAMPAIGN.length).toBeGreaterThanOrEqual(2000);
    expect(LONG_CAMPAIGN).toHaveLength(LONG_CAMPAIGN_LENGTH);
  });

  it('a des seq contigus à partir de 1', () => {
    expect(LONG_CAMPAIGN[0]?.seq).toBe(1);
    expect(LONG_CAMPAIGN.at(-1)?.seq).toBe(LONG_CAMPAIGN_LENGTH);
    expect(() => {
      expectSeqContiguous(LONG_CAMPAIGN);
    }).not.toThrow();
  });

  it('chacune de ses 2 000 entrées passe zGameEvent.parse', () => {
    const refusees = LONG_CAMPAIGN.filter((evenement) => !zGameEvent.safeParse(evenement).success);

    expect(refusees.map((evenement) => `${String(evenement.seq)} ${evenement.type}`)).toStrictEqual(
      [],
    );
  });

  it('chaque entrée est cohérente avec elle-même : move.resolved cite son propre jet', () => {
    const resolus = LONG_CAMPAIGN.filter((evenement) => evenement.type === 'move.resolved');
    expect(resolus.length).toBeGreaterThan(200);

    const paires = resolus.map((resolu) => {
      const jet = LONG_CAMPAIGN[resolu.payload.rollSeq - 1];
      return {
        seqCite: resolu.payload.rollSeq,
        typeVise: jet?.type,
        seqVise: jet?.seq,
        issueCitee: resolu.payload.outcome,
        issueDuJet: jet?.type === 'roll.action_resolved' ? jet.payload.outcome : undefined,
      };
    });

    expect(paires.filter((paire) => paire.typeVise !== 'roll.action_resolved')).toStrictEqual([]);
    expect(paires.filter((paire) => paire.seqVise !== paire.seqCite)).toStrictEqual([]);
    expect(paires.filter((paire) => paire.issueCitee !== paire.issueDuJet)).toStrictEqual([]);
  });

  /**
   * La docstring de `campaigns.ts` promet TROIS cohérences. Une seule était
   * mesurée — et la seule mesurée l'était mal : le test « move.resolved cite
   * son propre jet » compare deux événements qui lisent la même variable
   * `outcome`, il ne remonte jamais aux dés.
   *
   * La fixture EST cohérente aujourd'hui. Ces tests sont là pour qu'elle ne
   * dérive pas : une fixture dont les nombres se contredisent enseigne au
   * lecteur la mauvaise forme, et `zGameEvent` ne voit rien de tout ça — il
   * vérifie des types, pas de l'arithmétique.
   *
   * LA RÈGLE EST REDITE ICI, PAS IMPORTÉE. Importer `outcomeOf` rendrait le
   * test circulaire : la fixture se comparerait à elle-même et une mutation de
   * `outcomeOf` resterait verte. La règle vient de 01-architecture.md
   * (`rollChallenge`) : le score bat chaque dé de défi qu'il dépasse
   * STRICTEMENT ; deux battus, franche ; un, partielle ; aucun, échec.
   */
  describe('cohérence interne des 2 000 entrées', () => {
    const jets = LONG_CAMPAIGN.filter((evenement) => evenement.type === 'roll.action_resolved');

    /** La règle des deux dés de défi, redite indépendamment de la fixture. */
    function issueAttendue(total: number, des: readonly number[]): string {
      const battus = des.filter((de) => total > de).length;
      if (battus === 2) return 'franche';
      if (battus === 1) return 'partielle';
      return 'echec';
    }

    it('il y a bien des jets à examiner, et les trois issues sont représentées', () => {
      expect(jets.length).toBeGreaterThan(200);
      expect([...new Set(jets.map((jet) => jet.payload.outcome))].sort()).toStrictEqual([
        'echec',
        'franche',
        'partielle',
      ]);
    });

    it('l’issue de chaque jet est celle que ses dés donnent', () => {
      const menteurs = jets
        .filter(
          (jet) =>
            jet.payload.outcome !== issueAttendue(jet.payload.total, jet.payload.challengeDice),
        )
        .map(
          (jet) =>
            `seq ${String(jet.seq)} : ${jet.payload.outcome} annoncé, total ${String(jet.payload.total)} contre ${jet.payload.challengeDice.join('/')}`,
        );

      expect(menteurs).toStrictEqual([]);
    });

    it('le total est le score plafonné à 10, et « cappedAtTen » dit la vérité', () => {
      const menteurs = jets.filter(
        (jet) =>
          jet.payload.total !== Math.min(jet.payload.rawTotal, 10) ||
          jet.payload.cappedAtTen !== jet.payload.rawTotal > 10,
      );

      expect(menteurs).toStrictEqual([]);
      // CE QUE CE TEST NE PROUVE PAS, et qu'il vaut mieux écrire que laisser
      // croire : la fixture n'atteint JAMAIS le plafond — un d6 plus un
      // attribut de 2 culmine à 8. La branche « plafonné » n'est donc pas
      // exercée ici ; elle l'est par le moteur (M0-02), pas par ce journal de
      // volume. Ce que la ligne ci-dessous tient, c'est que la fixture ne
      // prétende pas le contraire.
      expect(jets.filter((jet) => jet.payload.cappedAtTen)).toStrictEqual([]);
      expect(Math.max(...jets.map((jet) => jet.payload.rawTotal))).toBeLessThanOrEqual(10);
    });

    it('« isPresage » est vrai exactement quand les deux dés de défi sont égaux', () => {
      const menteurs = jets.filter(
        (jet) =>
          jet.payload.isPresage !== (jet.payload.challengeDice[0] === jet.payload.challengeDice[1]),
      );

      expect(menteurs).toStrictEqual([]);
      // Les deux branches sont peuplées : sans ça, un `isPresage` figé à false
      // passerait le test ci-dessus.
      expect(jets.filter((jet) => jet.payload.isPresage).length).toBeGreaterThan(0);
      expect(jets.filter((jet) => !jet.payload.isPresage).length).toBeGreaterThan(0);
    });

    it('l’index de tirage de l’enveloppe est celui de la charge utile', () => {
      const desynchronises = jets.filter(
        (jet) =>
          jet.rngDrawIndex !== jet.payload.rngDrawIndex || jet.rngStream !== jet.payload.rngStream,
      );

      expect(desynchronises).toStrictEqual([]);
      expect(jets.every((jet) => jet.rngDrawIndex !== null)).toBe(true);
    });

    it('une jauge qui change annonce un delta égal à to − from', () => {
      const changements = LONG_CAMPAIGN.filter(
        (evenement) => evenement.type === 'character.gauge_changed',
      );

      expect(changements.length).toBeGreaterThan(200);
      expect(
        changements
          .filter((change) => change.payload.to - change.payload.from !== change.payload.delta)
          .map(
            (change) =>
              `seq ${String(change.seq)} : ${String(change.payload.from)} → ${String(change.payload.to)} pour un delta de ${String(change.payload.delta)}`,
          ),
      ).toStrictEqual([]);
    });

    it('une piste qui avance annonce un nombre de crans égal à to − from', () => {
      const avancees = LONG_CAMPAIGN.filter((evenement) => evenement.type === 'track.ticked');

      expect(avancees.length).toBeGreaterThan(200);
      expect(
        avancees.filter(
          (avancee) => avancee.payload.to - avancee.payload.from !== avancee.payload.ticks,
        ),
      ).toStrictEqual([]);
    });

    it('la narration du conteur cite un jet qui existe vraiment', () => {
      const narrations = LONG_CAMPAIGN.filter(
        (evenement) => evenement.type === 'narration.gm_message',
      );
      const seqDesJets = new Set(jets.map((jet) => jet.seq));

      expect(narrations.length).toBeGreaterThan(200);
      expect(
        narrations
          .filter(
            (narration) =>
              !seqDesJets.has(narration.payload.respondsToSeq ?? -1) ||
              narration.payload.citedEventSeqs.length === 0 ||
              narration.payload.citedEventSeqs.some((cite) => !seqDesJets.has(cite)),
          )
          .map((narration) => String(narration.seq)),
      ).toStrictEqual([]);
    });
  });

  it('porte des entrées adressées : un rejeu par destinataire a de quoi mordre', () => {
    const privees = LONG_CAMPAIGN.filter((evenement) => evenement.scope === 'private');

    expect(privees.length).toBeGreaterThan(0);
    for (const privee of privees) {
      expect(privee.recipients).not.toBeNull();
      expect(privee.recipients).toHaveLength(1);
    }
  });

  it('les entrées de table n’ont pas de destinataires', () => {
    const publiques = LONG_CAMPAIGN.filter((evenement) => evenement.scope === 'table');

    expect(publiques.length).toBeGreaterThan(0);
    expect(publiques.every((evenement) => evenement.recipients === null)).toBe(true);
  });

  it('aucun événement réservé au moteur n’est attribué au conteur (invariant 1)', () => {
    const moteurSeul = new Set([
      'roll.action_resolved',
      'move.resolved',
      'character.gauge_changed',
      'track.ticked',
    ]);
    const fautifs = LONG_CAMPAIGN.filter(
      (evenement) => moteurSeul.has(evenement.type) && evenement.actorKind === 'gm_ai',
    );

    expect(fautifs).toStrictEqual([]);
  });
});

describe('aJournal', () => {
  it('deux constructions à la même graine sont identiques octet pour octet', () => {
    expect(stableStringify(aJournal({ count: 120 }))).toBe(
      stableStringify(aJournal({ count: 120 })),
    );
  });

  it('deux graines différentes donnent deux journaux différents', () => {
    expect(stableStringify(aJournal({ count: 120, seed: 'a' }))).not.toBe(
      stableStringify(aJournal({ count: 120, seed: 'b' })),
    );
  });

  it('rend exactement le nombre demandé, même au milieu d’un tour', () => {
    for (const compte of [3, 4, 11, 12, 3 + JOURNAL_TURN_LENGTH + 1]) {
      const journal = aJournal({ count: compte });
      expect(journal).toHaveLength(compte);
      expect(() => {
        expectSeqContiguous(journal);
      }).not.toThrow();
    }
  });

  it('refuse un compte plus petit que son prologue plutôt que de le tronquer', () => {
    expect(() => aJournal({ count: 2 })).toThrow(RangeError);
    expect(() => aJournal({ count: 3.5 })).toThrow(RangeError);
  });

  /**
   * Les options d'identité n'étaient tenues par rien : `options.playerId`,
   * `campaignId` et `characterId` pouvaient chacune être jetées à la poubelle
   * sans qu'un test bronche. Un test aval qui construit un journal « pour ce
   * joueur-ci » lirait alors un journal pour quelqu'un d'autre, et passerait.
   */
  describe('les options d’identité', () => {
    const campaignId = anId('campaign', 7);
    const playerId = anId('player', 7);
    const characterId = anId('character', 7);
    const journal = aJournal({ count: 12, campaignId, playerId, characterId });

    it('« campaignId » est porté par chacune des entrées', () => {
      expect(journal.filter((entree) => entree.campaignId !== campaignId)).toStrictEqual([]);
      // Et ce n'est pas le défaut qu'on vient de relire.
      expect(campaignId).not.toBe(aJournal({ count: 12 })[0]?.campaignId);
    });

    it('« playerId » est celui du prologue et celui des entrées du joueur', () => {
      const arrivee = journal.find((entree) => entree.type === 'party.member_joined');
      const creation = journal.find((entree) => entree.type === 'campaign.created');

      expect(arrivee?.payload.playerId).toBe(playerId);
      expect(creation?.payload.ownerPlayerId).toBe(playerId);
      expect(journal.filter((entree) => entree.actorKind === 'player').length).toBeGreaterThan(0);
      expect(
        journal.filter(
          (entree) => entree.actorKind === 'player' && entree.actorPlayerId !== playerId,
        ),
      ).toStrictEqual([]);
    });

    it('« characterId » est le sujet des entrées de tour', () => {
      const sujets = new Set(
        journal
          .map((entree) => entree.subjectCharacterId)
          .filter((sujet): sujet is typeof characterId => sujet !== null),
      );

      expect(sujets.size).toBeGreaterThan(0);
      expect([...sujets]).toStrictEqual([characterId]);
    });
  });
});
