/**
 * `campaigns.settings_json` (03-donnees.md section 4.7).
 *
 * ONE DECLARATION, NOT TWO. `zCampaignSettings` was delivered by M0-05 in
 * `src/core/campaign-state.ts`, already `z.strictObject` and already guarded
 * by `satisfies z.ZodType<CampaignSettings>` against the engine's canonical
 * type. Section 4.7 prints the same shape under the name
 * `CampaignSettingsSchema`, so that name is bound to the existing schema
 * instead of restating it — a second declaration would be a second answer to
 * "what is a settings key", and it is exactly the divergence `.strict()` is
 * there to catch.
 *
 * WHAT IS DELIBERATELY NOT COPIED: the `.default(…)` values section 4.7 shows.
 * Defaults belong to the campaign-CREATION input (M0-20/M0-24), where a
 * partial object is legal. `settings_json` as stored is complete, and a stored
 * object missing `gmVerbosity` is a bug worth hearing about, not a field worth
 * filling in silently.
 */

import { zCampaignSettings } from '../core/campaign-state.js';

/** The name section 4.7 uses. Same schema, single owner, `.strict()` included. */
export const CampaignSettingsSchema = zCampaignSettings;
