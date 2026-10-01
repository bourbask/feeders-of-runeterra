/**
 * Les trois listes fermées que le MOTEUR possède, et leurs libellés français.
 *
 * Ces tests PARCOURENT le miroir (`.options`, `.def.values`) au lieu d'épingler
 * une liste à eux : vider `DISPOSITION_LABELS` fait tomber la première ligne,
 * et une cinquième disposition côté moteur fait tomber la compilation avant.
 * C'est la question 3 de la recette — une liste qui est sa propre source de
 * boucle ne garde rien.
 */

import { DispositionSchema, RankSchema, SegmentCountSchema } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { DISPOSITION_LABELS, RANK_LABELS, segmentsLabel } from './labels.js';

describe('les libellés couvrent le miroir moteur, membre à membre', () => {
  it('une disposition du moteur a son libellé, et il n’y en a pas d’autre', () => {
    expect(Object.keys(DISPOSITION_LABELS).sort()).toEqual([...DispositionSchema.options].sort());
    for (const disposition of DispositionSchema.options) {
      expect(DISPOSITION_LABELS[disposition].trim()).not.toBe('');
    }
  });

  it('un rang du moteur a son libellé, et il n’y en a pas d’autre', () => {
    expect(Object.keys(RANK_LABELS).sort()).toEqual([...RankSchema.options].sort());
    for (const rank of RankSchema.options) {
      expect(RANK_LABELS[rank].trim()).not.toBe('');
    }
  });

  it('chaque compte de segments du moteur se rend en français', () => {
    const counts = SegmentCountSchema.def.values;
    expect(counts.length).toBeGreaterThan(0);
    for (const count of counts) {
      expect(segmentsLabel(count)).toBe(`horloge à ${String(count)} segments`);
    }
  });
});
