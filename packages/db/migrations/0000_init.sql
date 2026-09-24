-- M0-11 / 03-donnees.md section 1.
--
-- READ BEFORE EDITING. Everything above the "hand-written" banner at the foot
-- of this file was produced by `drizzle-kit generate` from `src/schema/`, with
-- TWO hand edits that drizzle-kit has no way to express and does not record in
-- its snapshot, so they create no drift:
--
--   1. `) WITHOUT ROWID;` on `scene_state`, `campaign_champion_locks`,
--      `chronicle_jobs` and `ai_turn_renders`;
--   2. the three `events` triggers, at the foot.
--
-- Section 5.2 rule 4: any future migration that touches `events` is written by
-- hand and RECREATES these triggers. SQLite cannot ALTER COLUMN, so drizzle-kit
-- falls back to "temp table + copy + rename", and that ritual DROPS triggers
-- silently. `tests/append-only.test.ts` is what catches it.
CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text,
	`purpose` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`system_hash` text NOT NULL,
	`request_json` text,
	`response_text` text,
	`tool_calls_json` text,
	`finish_reason` text,
	`error_code` text,
	`repair_passes` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`trim_level` integer DEFAULT 0 NOT NULL,
	`context_hash` text,
	`status` text NOT NULL,
	`error_text` text,
	`resulting_event_seq` integer,
	`eval_tags_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_calls_purpose_enum" CHECK("ai_calls"."purpose" IN ('narration','forge','chronicle','judge')),
	CONSTRAINT "ai_calls_provider_enum" CHECK("ai_calls"."provider" IN ('stub','anthropic','openai-compatible','ollama')),
	CONSTRAINT "ai_calls_finish_reason_enum" CHECK("ai_calls"."finish_reason" IS NULL OR "ai_calls"."finish_reason" IN ('complete','truncated','tool_call','refused','aborted')),
	CONSTRAINT "ai_calls_request_json_valid" CHECK("ai_calls"."request_json" IS NULL OR json_valid("ai_calls"."request_json")),
	CONSTRAINT "ai_calls_tool_calls_json_valid" CHECK("ai_calls"."tool_calls_json" IS NULL OR json_valid("ai_calls"."tool_calls_json")),
	CONSTRAINT "ai_calls_trim_level_range" CHECK("ai_calls"."trim_level" BETWEEN 0 AND 8),
	CONSTRAINT "ai_calls_status_enum" CHECK("ai_calls"."status" IN ('ok','refused','invalid_output','error','timeout')),
	CONSTRAINT "ai_calls_eval_tags_json_valid" CHECK(json_valid("ai_calls"."eval_tags_json"))
);
--> statement-breakpoint
CREATE INDEX `ai_calls_campaign_idx` ON `ai_calls` (`campaign_id`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX `ai_calls_purpose_idx` ON `ai_calls` (`purpose`,`status`,"created_at" DESC);--> statement-breakpoint
CREATE TABLE `ai_turn_renders` (
	`campaign_id` text NOT NULL,
	`event_seq` integer NOT NULL,
	`rendered_fact` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `event_seq`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `champion_sheets` (
	`id` text PRIMARY KEY NOT NULL,
	`champion_id` text NOT NULL,
	`campaign_id` text,
	`schema_version` integer NOT NULL,
	`prompt_version` text NOT NULL,
	`sheet_json` text NOT NULL,
	`raw_output_json` text,
	`repairs_json` text DEFAULT '[]' NOT NULL,
	`content_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`forged_by_player_id` text,
	`model` text NOT NULL,
	`ai_call_id` text,
	`review_notes` text,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`forged_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "champion_sheets_sheet_json_valid" CHECK(json_valid("champion_sheets"."sheet_json")),
	CONSTRAINT "champion_sheets_raw_output_json_valid" CHECK("champion_sheets"."raw_output_json" IS NULL OR json_valid("champion_sheets"."raw_output_json")),
	CONSTRAINT "champion_sheets_repairs_json_valid" CHECK(json_valid("champion_sheets"."repairs_json")),
	CONSTRAINT "champion_sheets_status_enum" CHECK("champion_sheets"."status" IN ('draft','active','approved','rejected','superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `champion_sheets_hash_uq` ON `champion_sheets` (`champion_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `champion_sheets_lookup_idx` ON `champion_sheets` (`champion_id`,`status`);--> statement-breakpoint
CREATE TABLE `chronicle_jobs` (
	`campaign_id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`source_event_seq` integer NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`worker_id` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `chronicles` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text DEFAULT 'incremental' NOT NULL,
	`source_event_seq` integer NOT NULL,
	`doc_json` text NOT NULL,
	`rendered_md` text NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`ai_call_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chronicles_kind_enum" CHECK("chronicles"."kind" IN ('incremental','rebuild','handwritten')),
	CONSTRAINT "chronicles_doc_json_valid" CHECK(json_valid("chronicles"."doc_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicles_version_uq` ON `chronicles` (`campaign_id`,`version`);--> statement-breakpoint
CREATE INDEX `chronicles_live_idx` ON `chronicles` (`campaign_id`,"version" DESC);--> statement-breakpoint
CREATE TABLE `campaign_members` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`player_id` text NOT NULL,
	`role` text DEFAULT 'player' NOT NULL,
	`character_id` text,
	`invited_by` text,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invited_by`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "campaign_members_role_enum" CHECK("campaign_members"."role" IN ('owner','player','spectator'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_members_uq` ON `campaign_members` (`campaign_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `campaign_members_player_idx` ON `campaign_members` (`player_id`,`left_at`);--> statement-breakpoint
CREATE INDEX `campaign_members_campaign_idx` ON `campaign_members` (`campaign_id`,`left_at`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`pitch` text DEFAULT '' NOT NULL,
	`owner_player_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content_pack_version` text NOT NULL,
	`content_pack_hash` text NOT NULL,
	`rules_version` integer NOT NULL,
	`reducer_version` integer NOT NULL,
	`rng_seed` text NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`truths_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`owner_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "campaigns_status_enum" CHECK("campaigns"."status" IN ('draft','active','paused','archived')),
	CONSTRAINT "campaigns_settings_json_valid" CHECK(json_valid("campaigns"."settings_json")),
	CONSTRAINT "campaigns_truths_json_valid" CHECK(json_valid("campaigns"."truths_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_slug_uq` ON `campaigns` (`slug`);--> statement-breakpoint
CREATE INDEX `campaigns_owner_idx` ON `campaigns` (`owner_player_id`);--> statement-breakpoint
CREATE INDEX `campaigns_status_idx` ON `campaigns` (`status`,"updated_at" DESC);--> statement-breakpoint
CREATE TABLE `play_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`title` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`discord_channel_id` text,
	`scheduled_for` integer,
	`started_at` integer,
	`ended_at` integer,
	`first_event_seq` integer,
	`last_event_seq` integer,
	`recap_chronicle_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "play_sessions_status_enum" CHECK("play_sessions"."status" IN ('scheduled','live','ended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `play_sessions_ordinal_uq` ON `play_sessions` (`campaign_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `play_sessions_campaign_idx` ON `play_sessions` (`campaign_id`,"started_at" DESC);--> statement-breakpoint
CREATE INDEX `play_sessions_live_idx` ON `play_sessions` (`status`) WHERE "play_sessions"."status" = 'live';--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`seq` integer NOT NULL,
	`play_session_id` text,
	`type` text NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`payload_json` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_player_id` text,
	`subject_character_id` text,
	`correlation_id` text,
	`causation_id` text,
	`rng_stream` text,
	`rng_draw_index` integer,
	`scope` text NOT NULL,
	`recipients_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "events_seq_positive" CHECK("events"."seq" > 0),
	CONSTRAINT "events_payload_json_valid" CHECK(json_valid("events"."payload_json")),
	CONSTRAINT "events_actor_kind_enum" CHECK("events"."actor_kind" IN ('player','engine','gm_ai','system')),
	CONSTRAINT "events_scope_enum" CHECK("events"."scope" IN ('table','subset','private')),
	CONSTRAINT "events_recipients_json_valid" CHECK("events"."recipients_json" IS NULL OR json_valid("events"."recipients_json")),
	CONSTRAINT "events_recipients_match_scope" CHECK(("events"."scope" = 'table') = ("events"."recipients_json" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_campaign_seq_uq` ON `events` (`campaign_id`,`seq`);--> statement-breakpoint
CREATE INDEX `events_campaign_type_idx` ON `events` (`campaign_id`,`type`,`seq`);--> statement-breakpoint
CREATE INDEX `events_session_idx` ON `events` (`play_session_id`,`seq`);--> statement-breakpoint
CREATE INDEX `events_correlation_idx` ON `events` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `events_subject_idx` ON `events` (`campaign_id`,`subject_character_id`,`seq`);--> statement-breakpoint
CREATE INDEX `events_created_idx` ON `events` (`created_at`);--> statement-breakpoint
CREATE TABLE `content_packs` (
	`hash` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`file_count` integer NOT NULL,
	`manifest_json` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	CONSTRAINT "content_packs_manifest_json_valid" CHECK(json_valid("content_packs"."manifest_json"))
);
--> statement-breakpoint
CREATE INDEX `content_packs_version_idx` ON `content_packs` (`version`,"first_seen_at" DESC);--> statement-breakpoint
CREATE TABLE `intents` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`player_id` text NOT NULL,
	`character_id` text,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`rejection_code` text,
	`rejection_detail` text,
	`first_event_seq` integer,
	`last_event_seq` integer,
	`received_at` integer NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "intents_payload_json_valid" CHECK(json_valid("intents"."payload_json")),
	CONSTRAINT "intents_status_enum" CHECK("intents"."status" IN ('received','applied','rejected','superseded'))
);
--> statement-breakpoint
CREATE INDEX `intents_campaign_idx` ON `intents` (`campaign_id`,"received_at" DESC);--> statement-breakpoint
CREATE INDEX `intents_player_idx` ON `intents` (`player_id`,"received_at" DESC);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`user_agent` text,
	`ip_hash` text,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_player_idx` ON `auth_sessions` (`player_id`,"expires_at" DESC);--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_to` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_states_expiry_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_user_id` text NOT NULL,
	`discord_username` text NOT NULL,
	`discord_global_name` text,
	`discord_avatar_hash` text,
	`discord_email` text,
	`locale` text DEFAULT 'fr' NOT NULL,
	`is_admin` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_seen_at` integer,
	`deleted_at` integer,
	CONSTRAINT "players_is_admin_bool" CHECK("players"."is_admin" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_discord_user_id_uq` ON `players` (`discord_user_id`);--> statement-breakpoint
CREATE INDEX `players_last_seen_idx` ON `players` ("last_seen_at" DESC);--> statement-breakpoint
CREATE TABLE `campaign_champion_locks` (
	`campaign_id` text NOT NULL,
	`champion_id` text NOT NULL,
	`lock_kind` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`set_seq` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `champion_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "campaign_champion_locks_kind_enum" CHECK("campaign_champion_locks"."lock_kind" IN ('reserved_pc','allowed_npc','banned'))
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX `champion_locks_kind_idx` ON `campaign_champion_locks` (`campaign_id`,`lock_kind`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`player_id` text NOT NULL,
	`champion_id` text NOT NULL,
	`display_name` text NOT NULL,
	`sheet_source` text NOT NULL,
	`sheet_ref` text NOT NULL,
	`sheet_snapshot_json` text NOT NULL,
	`attr_vif` integer NOT NULL,
	`attr_coeur` integer NOT NULL,
	`attr_fer` integer NOT NULL,
	`attr_ombre` integer NOT NULL,
	`attr_esprit` integer NOT NULL,
	`vigueur` integer DEFAULT 5 NOT NULL,
	`ame` integer DEFAULT 5 NOT NULL,
	`vivres` integer DEFAULT 5 NOT NULL,
	`momentum` integer DEFAULT 2 NOT NULL,
	`momentum_max` integer DEFAULT 10 NOT NULL,
	`momentum_reset` integer DEFAULT 2 NOT NULL,
	`xp_earned` integer DEFAULT 0 NOT NULL,
	`xp_spent` integer DEFAULT 0 NOT NULL,
	`conditions_json` text DEFAULT '[]' NOT NULL,
	`assets_json` text DEFAULT '[]' NOT NULL,
	`bonds_json` text DEFAULT '[]' NOT NULL,
	`notes_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`portrait_url` text,
	`created_seq` integer NOT NULL,
	`updated_seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "characters_sheet_source_enum" CHECK("characters"."sheet_source" IN ('handwritten','forged')),
	CONSTRAINT "characters_sheet_snapshot_json_valid" CHECK(json_valid("characters"."sheet_snapshot_json")),
	CONSTRAINT "characters_attr_vif_range" CHECK("characters"."attr_vif" BETWEEN 1 AND 3),
	CONSTRAINT "characters_attr_coeur_range" CHECK("characters"."attr_coeur" BETWEEN 1 AND 3),
	CONSTRAINT "characters_attr_fer_range" CHECK("characters"."attr_fer" BETWEEN 1 AND 3),
	CONSTRAINT "characters_attr_ombre_range" CHECK("characters"."attr_ombre" BETWEEN 1 AND 3),
	CONSTRAINT "characters_attr_esprit_range" CHECK("characters"."attr_esprit" BETWEEN 1 AND 3),
	CONSTRAINT "characters_vigueur_range" CHECK("characters"."vigueur" BETWEEN 0 AND 5),
	CONSTRAINT "characters_ame_range" CHECK("characters"."ame" BETWEEN 0 AND 5),
	CONSTRAINT "characters_vivres_range" CHECK("characters"."vivres" BETWEEN 0 AND 5),
	CONSTRAINT "characters_momentum_range" CHECK("characters"."momentum" BETWEEN -6 AND 10),
	CONSTRAINT "characters_momentum_max_range" CHECK("characters"."momentum_max" BETWEEN 0 AND 10),
	CONSTRAINT "characters_momentum_reset_range" CHECK("characters"."momentum_reset" BETWEEN 0 AND 2),
	CONSTRAINT "characters_xp_earned_positive" CHECK("characters"."xp_earned" >= 0),
	CONSTRAINT "characters_xp_spent_positive" CHECK("characters"."xp_spent" >= 0),
	CONSTRAINT "characters_conditions_json_valid" CHECK(json_valid("characters"."conditions_json")),
	CONSTRAINT "characters_assets_json_valid" CHECK(json_valid("characters"."assets_json")),
	CONSTRAINT "characters_bonds_json_valid" CHECK(json_valid("characters"."bonds_json")),
	CONSTRAINT "characters_notes_json_valid" CHECK(json_valid("characters"."notes_json")),
	CONSTRAINT "characters_status_enum" CHECK("characters"."status" IN ('draft','active','retired','dead')),
	CONSTRAINT "characters_xp_coherent" CHECK("characters"."xp_spent" <= "characters"."xp_earned"),
	CONSTRAINT "characters_momentum_reset_le_max" CHECK("characters"."momentum_reset" <= "characters"."momentum_max")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `characters_champion_uq` ON `characters` (`campaign_id`,`champion_id`) WHERE "characters"."status" IN ('draft','active');--> statement-breakpoint
CREATE UNIQUE INDEX `characters_active_player_uq` ON `characters` (`campaign_id`,`player_id`) WHERE "characters"."status" IN ('draft','active');--> statement-breakpoint
CREATE INDEX `characters_campaign_idx` ON `characters` (`campaign_id`,`status`);--> statement-breakpoint
CREATE TABLE `clocks` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`segments` integer NOT NULL,
	`filled` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ticking' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`consequence` text DEFAULT '' NOT NULL,
	`created_seq` integer NOT NULL,
	`updated_seq` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "clocks_segments_enum" CHECK("clocks"."segments" IN (4,6,8,10)),
	CONSTRAINT "clocks_filled_positive" CHECK("clocks"."filled" >= 0),
	CONSTRAINT "clocks_status_enum" CHECK("clocks"."status" IN ('ticking','filled','resolved','cancelled')),
	CONSTRAINT "clocks_visibility_enum" CHECK("clocks"."visibility" IN ('public','gm')),
	CONSTRAINT "clocks_filled_le_segments" CHECK("clocks"."filled" <= "clocks"."segments")
);
--> statement-breakpoint
CREATE INDEX `clocks_campaign_idx` ON `clocks` (`campaign_id`,`status`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`champion_id` text,
	`region_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`disposition` text,
	`first_seen_seq` integer NOT NULL,
	`last_seen_seq` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entities_kind_enum" CHECK("entities"."kind" IN ('npc','place','faction','item','beast','thread','presage')),
	CONSTRAINT "entities_details_json_valid" CHECK(json_valid("entities"."details_json")),
	CONSTRAINT "entities_status_enum" CHECK("entities"."status" IN ('active','dormant','dead','destroyed','resolved')),
	CONSTRAINT "entities_disposition_enum" CHECK("entities"."disposition" IS NULL OR "entities"."disposition" IN ('allie','neutre','hostile','inconnu'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entities_slug_uq` ON `entities` (`campaign_id`,`slug`);--> statement-breakpoint
CREATE INDEX `entities_kind_idx` ON `entities` (`campaign_id`,`kind`,`status`);--> statement-breakpoint
CREATE INDEX `entities_recent_idx` ON `entities` (`campaign_id`,"last_seen_seq" DESC);--> statement-breakpoint
CREATE TABLE `progress_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`kind` text NOT NULL,
	`rank` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner_character_id` text,
	`ticks` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`created_seq` integer NOT NULL,
	`updated_seq` integer NOT NULL,
	`resolved_seq` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "progress_tracks_kind_enum" CHECK("progress_tracks"."kind" IN ('vow','combat','journey','scene_challenge','bond')),
	CONSTRAINT "progress_tracks_rank_enum" CHECK("progress_tracks"."rank" IN ('genant','dangereux','redoutable','extreme','epique')),
	CONSTRAINT "progress_tracks_ticks_range" CHECK("progress_tracks"."ticks" BETWEEN 0 AND 40),
	CONSTRAINT "progress_tracks_status_enum" CHECK("progress_tracks"."status" IN ('open','fulfilled','forsaken','failed','abandoned')),
	CONSTRAINT "progress_tracks_visibility_enum" CHECK("progress_tracks"."visibility" IN ('public','gm')),
	CONSTRAINT "progress_tracks_tags_json_valid" CHECK(json_valid("progress_tracks"."tags_json"))
);
--> statement-breakpoint
CREATE INDEX `progress_tracks_campaign_idx` ON `progress_tracks` (`campaign_id`,`status`,`kind`);--> statement-breakpoint
CREATE INDEX `progress_tracks_owner_idx` ON `progress_tracks` (`owner_character_id`,`status`);--> statement-breakpoint
CREATE TABLE `scene_state` (
	`campaign_id` text PRIMARY KEY NOT NULL,
	`scene_id` text NOT NULL,
	`place_id` text DEFAULT '' NOT NULL,
	`place_name` text DEFAULT '' NOT NULL,
	`time_of_day` text DEFAULT '' NOT NULL,
	`present_json` text DEFAULT '[]' NOT NULL,
	`absent_json` text DEFAULT '[]' NOT NULL,
	`updated_seq` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "scene_state_present_json_valid" CHECK(json_valid("scene_state"."present_json")),
	CONSTRAINT "scene_state_absent_json_valid" CHECK(json_valid("scene_state"."absent_json")),
	CONSTRAINT "scene_state_present_bounded" CHECK(json_array_length("scene_state"."present_json") <= 8),
	CONSTRAINT "scene_state_absent_bounded" CHECK(json_array_length("scene_state"."absent_json") <= 8)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`seq` integer NOT NULL,
	`reducer_version` integer NOT NULL,
	`state_json` text NOT NULL,
	`state_hash` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`kind` text DEFAULT 'rolling' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "snapshots_kind_enum" CHECK("snapshots"."kind" IN ('rolling','milestone','session_end')),
	CONSTRAINT "snapshots_state_json_valid" CHECK(json_valid("snapshots"."state_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_uq` ON `snapshots` (`campaign_id`,`reducer_version`,`seq`);--> statement-breakpoint
CREATE INDEX `snapshots_lookup_idx` ON `snapshots` (`campaign_id`,`reducer_version`,"seq" DESC);
--> statement-breakpoint
-- ------------------------------------------------------------ hand-written
-- Append-only, materialised. Not discipline: a constraint.
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only: use a compensating event'); END;--> statement-breakpoint
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only: use system.reverted or the purge script'); END;--> statement-breakpoint
-- Sequence density: seq must equal campaigns.seq at insert time. An event
-- inserted outside the allocator would leave a silent hole in the replay.
CREATE TRIGGER events_seq_dense BEFORE INSERT ON events
WHEN NEW.seq <> (SELECT seq FROM campaigns WHERE id = NEW.campaign_id)
BEGIN SELECT RAISE(ABORT, 'events.seq must be allocated via campaigns.seq'); END;
