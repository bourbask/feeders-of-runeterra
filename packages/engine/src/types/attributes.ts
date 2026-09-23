/**
 * The five attributes.
 *
 * Enumeration VALUES stay in French because they travel into SQL columns,
 * event payloads and content JSON (ARCHITECTURE.md section 4.2). They carry no
 * accent by construction, which is what keeps the engine free of any French
 * string literal that a human would ever read.
 */

export const ATTRIBUTES = ['vif', 'coeur', 'fer', 'ombre', 'esprit'] as const;

export type AttributeId = (typeof ATTRIBUTES)[number];

export const ATTRIBUTE_MIN = 1;
export const ATTRIBUTE_MAX = 3;

/**
 * The only legal spread at creation, sorted descending: 3/2/2/1/1.
 * The check itself lives in the Zod mirror (`AttributeSpreadSchema`); this
 * constant is the single place that states the shape.
 */
export const ATTRIBUTE_SPREAD = [3, 2, 2, 1, 1] as const;

/** One value per attribute. Values are constrained to [1, 3]. */
export type AttributeSpread = Readonly<Record<AttributeId, number>>;
