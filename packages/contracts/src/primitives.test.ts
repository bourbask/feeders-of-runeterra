import { describe, expect, it } from 'vitest';

import {
  zBrandedId,
  zCampaignId,
  zCorrelationId,
  zEventCause,
  zId,
  zIsoDate,
  zJsonObject,
  zNonEmptyText,
  zSeed,
  zSeq,
  zSlug,
  zTableId,
} from './primitives.js';

const VALID_ULID = '01JQ8Z9K0ZABCDEFGHJKMNPQRS';

describe('primitives — identifiants', () => {
  it('accepte un ULID en base32 de Crockford', () => {
    expect(zId.safeParse(VALID_ULID).success).toBe(true);
    expect(zCampaignId.safeParse(VALID_ULID).success).toBe(true);
  });

  it.each([
    ['trop court', '01JQ8Z9K0ZABCDEFGHJKMNPQR'],
    ['trop long', '01JQ8Z9K0ZABCDEFGHJKMNPQRST'],
    ['premier caractère hors [0-7]', '81JQ8Z9K0ZABCDEFGHJKMNPQRS'],
    ['lettre exclue (I)', '01JQ8Z9K0ZABCDEFGHIKMNPQRS'],
    ['minuscules', '01jq8z9k0zabcdefghjkmnpqrs'],
    ['vide', ''],
  ])('refuse un ULID %s', (_label, value) => {
    expect(zId.safeParse(value).success).toBe(false);
    expect(zCampaignId.safeParse(value).success).toBe(false);
  });

  it('refuse un identifiant qui n’est pas une chaîne', () => {
    expect(zCampaignId.safeParse(42).success).toBe(false);
    expect(zCampaignId.safeParse(null).success).toBe(false);
  });

  it('zBrandedId nomme la marque dans son message', () => {
    const result = zBrandedId('TrackId').safeParse('non');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('TrackId');
  });

  it('une table EST une campagne', () => {
    expect(zTableId).toBe(zCampaignId);
  });
});

describe('primitives — le reste', () => {
  it('zSeq n’accepte que des entiers strictement positifs', () => {
    expect(zSeq.safeParse(1).success).toBe(true);
    expect(zSeq.safeParse(0).success).toBe(false);
    expect(zSeq.safeParse(-1).success).toBe(false);
    expect(zSeq.safeParse(1.5).success).toBe(false);
  });

  it.each(['griffe-de-givre', 'braum', 'a1-b2'])('accepte le slug « %s »', (slug) => {
    expect(zSlug.safeParse(slug).success).toBe(true);
  });

  it.each(['Griffe', 'griffe_de_givre', '-griffe', 'griffe-', 'griffe--de', 'gri ffe', ''])(
    'refuse le slug « %s »',
    (slug) => {
      expect(zSlug.safeParse(slug).success).toBe(false);
    },
  );

  it('zNonEmptyText rogne les blancs et refuse le vide', () => {
    expect(zNonEmptyText.parse('  du texte  ')).toBe('du texte');
    expect(zNonEmptyText.safeParse('   ').success).toBe(false);
  });

  it('zCorrelationId veut un UUID', () => {
    expect(zCorrelationId.safeParse('0f8fad5b-d9cb-469f-a165-70867728950e').success).toBe(true);
    expect(zCorrelationId.safeParse('tour-412').success).toBe(false);
  });

  it('zIsoDate veut une date ISO 8601', () => {
    expect(zIsoDate.safeParse('2026-09-21T10:00:00Z').success).toBe(true);
    expect(zIsoDate.safeParse('21/09/2026').success).toBe(false);
  });

  it('zSeed veut une graine non vide et bornée', () => {
    expect(zSeed.safeParse('graine').success).toBe(true);
    expect(zSeed.safeParse('').success).toBe(false);
    expect(zSeed.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('zEventCause reste une chaîne machine courte', () => {
    expect(zEventCause.safeParse('price:d12=7').success).toBe(true);
    expect(zEventCause.safeParse('').success).toBe(false);
    expect(zEventCause.safeParse('a'.repeat(121)).success).toBe(false);
  });

  it('zJsonObject accepte un objet quelconque et refuse un tableau', () => {
    expect(zJsonObject.safeParse({ arme: 'hache', poids: 3 }).success).toBe(true);
    expect(zJsonObject.safeParse(['hache']).success).toBe(false);
  });
});
