import { defineWorkspace } from 'vitest/config';

// La liste des projets, et rien d'autre. `defineWorkspace` prend un tableau de
// configurations de projet : il n'y a pas d'emplacement pour une option de racine.
//
// LES SEUILS DE COUVERTURE NE SONT PAS ICI. Vitest ne les évalue qu'au niveau
// racine : le seuil global de 70 % vit dans vitest.config.ts, et les seuils par
// paquet dans les vitest.config.ts de paquet — ces derniers ne s'appliquent
// qu'aux passes lancées depuis le paquet. Voir ADR 0002.
export default defineWorkspace(['packages/*/vitest.config.ts']);
