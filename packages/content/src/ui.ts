/**
 * `@for/content/ui` — the French interface labels, and NOTHING else.
 *
 * A separate entry point because the client is allowed to import this one and
 * only this one (01-architecture.md section 2.5): game content reaches the
 * browser through `GET /api/content/*`, never through the bundle. So this file
 * imports `generated/labels.js` and never `generated/index.js` — pulling the
 * whole content in here would quietly make the light entry heavy.
 *
 * ── WHY THE TYPES BELOW ARE NOT THE GUARANTEE (ADR 0007) ─────────────────
 * `Readonly<Record<AttributeKey, string>>` catches a MISSING attribute and
 * nothing else: an extra key survives, because the generated object is not a
 * fresh literal at this assignment. The member-by-member comparison in
 * `tests/generated-index.test.ts`, through `validateLabels`, is what holds
 * both directions — and it is proven by breaking it in both.
 */

import type { AttributeKey, GaugeKeySchema, zOutcome } from '@for/contracts';

import { LABELS } from './generated/labels.js';
import type { LabelFile } from './validate.js';

export type GaugeKey = ReturnType<typeof GaugeKeySchema.parse>;
export type OutcomeKey = ReturnType<typeof zOutcome.parse>;
export type { AttributeKey };

/** « Vif », « Cœur », « Fer », « Ombre », « Esprit ». */
export const attributeLabels: Readonly<Record<AttributeKey, string>> = LABELS.attributes;

/** « Vigueur », « Âme », « Vivres ». */
export const gaugeLabels: Readonly<Record<GaugeKey, string>> = LABELS.gauges;

/** « Réussite franche », « Réussite partielle », « Échec ». */
export const outcomeLabels: Readonly<Record<OutcomeKey, string>> = LABELS.outcomes;

/** Free-form interface strings. No closed list to mirror — see `validateLabels`. */
export const uiLabels: LabelFile = LABELS.ui;

/** Never `undefined`: an interface that renders "undefined" is a bug nobody reports. */
export function uiLabel(key: string): string {
  const label = uiLabels[key];
  if (label === undefined) throw new Error(`libellé d'interface « ${key} » absent de ui.json`);
  return label;
}
