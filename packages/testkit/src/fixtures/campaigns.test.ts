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
});
