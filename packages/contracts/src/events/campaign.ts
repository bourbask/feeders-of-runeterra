/** `campaign.*` and `party.*` payloads (03-donnees.md section 3.4). */

import { z } from 'zod';

import type {
  CampaignContentPackChangedPayload,
  CampaignCreatedPayload,
  CampaignSettingsUpdatedPayload,
  CampaignStatusChangedPayload,
  CampaignTruthSetPayload,
  PartyChampionLockedPayload,
  PartyChampionUnlockedPayload,
  PartyMemberJoinedPayload,
  PartyMemberLeftPayload,
  PartyMemberRoleChangedPayload,
} from '@for/engine';

import { zCampaignSettings } from '../core/campaign-state.js';
import { zCampaignStatus, zChampionLockKind, zPartyRole } from '../core/enums.js';
import { zPlayerId, zSeed, zSlug } from '../primitives.js';

export const zCampaignCreatedPayload = z.object({
  name: z.string().min(1),
  slug: zSlug,
  pitch: z.string(),
  ownerPlayerId: zPlayerId,
  contentPackVersion: z.string().min(1),
  contentPackHash: z.string().min(1),
  rulesVersion: z.number().int().positive(),
  rngSeed: zSeed,
}) satisfies z.ZodType<CampaignCreatedPayload>;

export const zCampaignTruthSetPayload = z.object({
  truthId: zSlug,
  optionId: zSlug,
  customText: z.string().optional(),
}) satisfies z.ZodType<CampaignTruthSetPayload>;

/**
 * `before` is carried next to `patch` so the journal reads without replaying:
 * a settings change is auditable from its own line (03-donnees.md section 3.4).
 */
export const zCampaignSettingsUpdatedPayload = z.object({
  patch: zCampaignSettings.partial(),
  before: zCampaignSettings.partial(),
}) satisfies z.ZodType<CampaignSettingsUpdatedPayload>;

export const zCampaignStatusChangedPayload = z.object({
  from: zCampaignStatus,
  to: zCampaignStatus,
  reason: z.string().optional(),
}) satisfies z.ZodType<CampaignStatusChangedPayload>;

export const zCampaignContentPackChangedPayload = z.object({
  fromVersion: z.string(),
  fromHash: z.string(),
  toVersion: z.string(),
  toHash: z.string(),
  note: z.string(),
}) satisfies z.ZodType<CampaignContentPackChangedPayload>;

export const zPartyMemberJoinedPayload = z.object({
  playerId: zPlayerId,
  role: zPartyRole,
  displayName: z.string().min(1),
}) satisfies z.ZodType<PartyMemberJoinedPayload>;

export const zPartyMemberLeftPayload = z.object({
  playerId: zPlayerId,
  reason: z.enum(['left', 'kicked', 'inactive']),
}) satisfies z.ZodType<PartyMemberLeftPayload>;

export const zPartyMemberRoleChangedPayload = z.object({
  playerId: zPlayerId,
  from: zPartyRole,
  to: zPartyRole,
}) satisfies z.ZodType<PartyMemberRoleChangedPayload>;

export const zPartyChampionLockedPayload = z.object({
  championId: zSlug,
  lockKind: zChampionLockKind,
  reason: z.string(),
}) satisfies z.ZodType<PartyChampionLockedPayload>;

export const zPartyChampionUnlockedPayload = z.object({
  championId: zSlug,
  reason: z.string(),
}) satisfies z.ZodType<PartyChampionUnlockedPayload>;
