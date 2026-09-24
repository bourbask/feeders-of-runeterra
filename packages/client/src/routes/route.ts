/**
 * The router: a pure function from a hash to a route, and a hook around
 * `hashchange`.
 *
 * NO ROUTING LIBRARY IN M0. Four screens, three shapes of URL, and a hash that
 * needs no server rewrite rule — a router would be a dependency in the bundle
 * and a second place where a path is spelled. When the product grows a real
 * navigation, this file is what gets replaced, and nothing else.
 */

export type Route =
  | { readonly nom: 'campagnes' }
  | { readonly nom: 'table'; readonly campaignId: string }
  | { readonly nom: 'personnage'; readonly campaignId: string }
  | { readonly nom: 'inconnue'; readonly hash: string };

/** `#/campagnes/<id>` and `#/campagnes/<id>/personnage`; anything else is unknown. */
export function parseRoute(hash: string): Route {
  const chemin = hash.replace(/^#/u, '');
  const morceaux = chemin.split('/').filter((morceau) => morceau !== '');

  if (morceaux.length === 0) return { nom: 'campagnes' };
  if (morceaux[0] !== 'campagnes') return { nom: 'inconnue', hash };

  const campaignId = morceaux[1];
  if (campaignId === undefined) return { nom: 'campagnes' };
  if (morceaux.length === 2) return { nom: 'table', campaignId };
  if (morceaux.length === 3 && morceaux[2] === 'personnage') {
    return { nom: 'personnage', campaignId };
  }
  return { nom: 'inconnue', hash };
}

export function routeHref(route: Route): string {
  switch (route.nom) {
    case 'campagnes':
      return '#/';
    case 'table':
      return `#/campagnes/${route.campaignId}`;
    case 'personnage':
      return `#/campagnes/${route.campaignId}/personnage`;
    case 'inconnue':
      return route.hash;
  }
}
