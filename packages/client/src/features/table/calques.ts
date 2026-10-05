/**
 * What is open on the table screen, and the rule that makes the answer short.
 *
 * RULE 7 OF 05-interface.md, STATED AS A TYPE AND HELD BY A REDUCER: « Jamais
 * deux panneaux l'un sur l'autre. Un seul calque d'interface à la fois, et un
 * seul tiroir à la fois. »
 *
 * The state is ONE drawer slot and ONE layer slot, and every transition empties
 * the other. The state `{ tiroir: 'gauche', calque: { … } }` is REACHABLE as a
 * value and unreachable as a RESULT: `calques.test.ts` drives every action from
 * every state and asserts no outcome ever has both. That is why this is a
 * reducer and not three `useState` in a component — three booleans can hold any
 * combination, and the rule would then live in whoever remembers to call the
 * other two setters.
 *
 * §4.5: « Ouvrir un calque referme le tiroir qui était ouvert. » The converse
 * is not written in the spec but follows from rule 7, and is held here too:
 * opening a drawer closes the layer.
 */

export type CoteTiroir = 'gauche' | 'droite';

/** The layers the centre column may host (§4.5). Nothing is born elsewhere. */
export type Calque =
  { readonly nom: 'destinataires' } | { readonly nom: 'carte'; readonly objet: string };

export interface EtatCalques {
  readonly tiroir: CoteTiroir | null;
  readonly calque: Calque | null;
}

export type ActionCalque =
  | { readonly type: 'basculer-tiroir'; readonly cote: CoteTiroir }
  | { readonly type: 'fermer-tiroir' }
  | { readonly type: 'ouvrir-calque'; readonly calque: Calque }
  | { readonly type: 'fermer-calque' };

export const CALQUES_FERMES: EtatCalques = { tiroir: null, calque: null };

export function reduireCalques(etat: EtatCalques, action: ActionCalque): EtatCalques {
  switch (action.type) {
    case 'basculer-tiroir':
      // Opening the right one closes the left one, because `tiroir` is ONE
      // slot. Clicking the open one closes it: a push-button pushes back.
      return { tiroir: etat.tiroir === action.cote ? null : action.cote, calque: null };
    case 'fermer-tiroir':
      return { ...etat, tiroir: null };
    case 'ouvrir-calque':
      return { tiroir: null, calque: action.calque };
    case 'fermer-calque':
      return { ...etat, calque: null };
  }
}
