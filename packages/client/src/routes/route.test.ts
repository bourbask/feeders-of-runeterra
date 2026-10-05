import { describe, expect, it } from 'vitest';

import { parseRoute, routeHref } from './route.js';

describe('parseRoute', () => {
  it.each([
    ['', { nom: 'campagnes' }],
    ['#/', { nom: 'campagnes' }],
    ['#/campagnes', { nom: 'campagnes' }],
    ['#/campagnes/abc', { nom: 'table', campaignId: 'abc' }],
    ['#/campagnes/abc/personnage', { nom: 'personnage', campaignId: 'abc' }],
    ['#/design', { nom: 'design' }],
  ])('« %s » donne la bonne route', (hash, attendu) => {
    expect(parseRoute(hash)).toEqual(attendu);
  });

  it.each(['#/autre', '#/campagnes/abc/autre', '#/campagnes/abc/personnage/trop'])(
    '« %s » est inconnue plutôt que devinée',
    (hash) => {
      expect(parseRoute(hash).nom).toBe('inconnue');
    },
  );

  it('« #/design » est la vitrine, même avec une barre finale', () => {
    expect(parseRoute('#/design/').nom).toBe('design');
  });

  it('« #/design/abc » n’est pas la vitrine : un chemin ne se devine pas', () => {
    // Le routeur est strict par choix. `#/design/abc` ressemblant à
    // `#/campagnes/abc`, un routeur qui « devinerait » enverrait la vitrine
    // masquer une table réelle.
    expect(parseRoute('#/design/abc').nom).toBe('inconnue');
  });

  it('l’aller-retour hash → route → hash est stable', () => {
    for (const hash of ['#/', '#/campagnes/abc', '#/campagnes/abc/personnage', '#/design']) {
      expect(routeHref(parseRoute(hash))).toBe(hash);
    }
  });
});
