/**
 * Character sheet and character state.
 *
 * `CharacterSheet` here is the FROZEN REFERENCE to the champion sheet, not the
 * sheet itself: the full `Champion` shape is a content schema and lives in
 * `@for/contracts` (03-donnees.md section 4.5). The engine only needs to know
 * which sheet a character was created from and that it never moves again, so
 * that a content update cannot retroactively change a running character.
 */

import type { CharacterId, PlayerId } from '../ids.js';
import type { AttributeId } from './attributes.js';
import type { GaugeId, MomentumBounds } from './gauges.js';

export const CHARACTER_STATUSES = ['draft', 'active', 'retired', 'dead'] as const;

export type CharacterStatus = (typeof CHARACTER_STATUSES)[number];

export const SHEET_SOURCES = ['handwritten', 'forged'] as const;

export type SheetSource = (typeof SHEET_SOURCES)[number];

export interface CharacterSheet {
  readonly championId: string;
  readonly source: SheetSource;
  /** `content:champions/braum@1.4.0`, or `forged:<champion_sheets.id>`. */
  readonly ref: string;
}

export interface CharacterCondition {
  readonly conditionId: string;
  /** Content label, copied at the time it was applied. */
  readonly label: string;
  readonly source: string;
  readonly sinceSeq: number;
}

export interface CharacterAsset {
  readonly assetId: string;
  /** Indexes of the unlocked abilities, ascending. */
  readonly unlockedAbilities: readonly number[];
  readonly options: Readonly<Record<string, string>>;
}

export interface CharacterState {
  readonly id: CharacterId;
  readonly playerId: PlayerId;
  readonly championId: string;
  readonly displayName: string;
  readonly sheet: CharacterSheet;
  readonly attributes: Readonly<Record<AttributeId, number>>;
  readonly gauges: Readonly<Record<GaugeId, number>>;
  readonly momentum: number;
  readonly momentumBounds: MomentumBounds;
  readonly xpEarned: number;
  readonly xpSpent: number;
  readonly conditions: readonly CharacterCondition[];
  readonly assets: readonly CharacterAsset[];
  readonly status: CharacterStatus;
  readonly createdSeq: number;
  readonly updatedSeq: number;
}
