import type { AttributeId } from '@for/engine';

/**
 * The five attributes, in French, ONE LIST FOR THE WHOLE CLIENT.
 *
 * It lived in `Fiche.tsx` and the character-choice screen needed the same five
 * words. A second copy would be a second place to forget `Cœur`'s ligature,
 * and the two screens would disagree about the same sheet.
 *
 * THE ORDER IS NOT HERE. `ATTRIBUTES` from `@for/engine` is the canonical
 * order and both screens iterate it; this record only says how each one is
 * spelled on screen.
 */
export const ATTRIBUTS: Readonly<Record<AttributeId, string>> = {
  vif: 'Vif',
  coeur: 'Cœur',
  fer: 'Fer',
  ombre: 'Ombre',
  esprit: 'Esprit',
};
