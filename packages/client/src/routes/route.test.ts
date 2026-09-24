import { describe, expect, it } from 'vitest';

import { parseRoute, routeHref } from './route.js';

describe('parseRoute', () => {
  it.each([
    ['', { nom: 'campagnes' }],
    ['#/', { nom: 'campagnes' }],
    ['#/campagnes', { nom: 'campagnes' }],
    ['#/campagnes/abc', { nom: 'table', campaignId: 'abc' }],
    ['#/campagnes/abc/personnage', { nom: 'personnage', campaignId: 'abc' }],
  ])('« %s » donne la bonne route', (hash, attendu) => {
    expect(parseRoute(hash)).toEqual(attendu);
  });

  it.each(['#/autre', '#/campagnes/abc/autre', '#/campagnes/abc/personnage/trop'])(
    '« %s » est inconnue plutôt que devinée',
    (hash) => {
      expect(parseRoute(hash).nom).toBe('inconnue');
    },
  );

  it('l’aller-retour hash → route → hash est stable', () => {
    for (const hash of ['#/', '#/campagnes/abc', '#/campagnes/abc/personnage']) {
      expect(routeHref(parseRoute(hash))).toBe(hash);
    }
  });
});
