/**
 * `GET /api/me` — who is signed in, and what they may open
 * (01-architecture.md section 6).
 *
 * THE ROUTE RETURNS A PROJECTION, NOT THREE TABLES. `zPlayerProfile` is built
 * by `auth/guards.ts` from the `players` row and deliberately leaves the
 * Discord snowflake, the e-mail column and `last_seen_at` in the database;
 * `zCharacterSummary` is a name and a status, not a sheet. The sheet arrives
 * with the table, over the socket.
 *
 * BOTH LISTS ARE ORDERED, AND THE ORDER IS ASSERTED. Most recently touched
 * first, for the same reason in both cases: this answer draws a home page, and
 * a home page that reshuffles between two reloads is a bug nobody can
 * reproduce. `tests/http/campaigns.test.ts`, `describe('GET /api/me — les
 * deux listes')`, measures it on TWO rows inserted in the wrong order and
 * compares the whole array, because a fixture of one element, or one already
 * sorted, says nothing about an `ORDER BY`.
 */

import { zMeResponse } from '@for/contracts';

import { listCampaignsForPlayer } from './campaigns.routes.js';

import type { CharacterSummary } from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type { FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppPluginOptions } from '../deps.js';

interface CharacterRow {
  readonly id: string;
  readonly campaign_id: string;
  readonly champion_id: string;
  readonly display_name: string;
  readonly sheet_source: string;
  readonly status: string;
}

export function listCharactersForPlayer(
  connection: SqliteConnection,
  playerId: string,
): readonly CharacterSummary[] {
  const rows = connection
    .prepare(
      `SELECT id, campaign_id, champion_id, display_name, sheet_source, status
         FROM characters
        WHERE player_id = ?
        ORDER BY updated_at DESC, id ASC`,
    )
    .all(playerId) as CharacterRow[];

  return rows.map((row) => ({
    id: row.id as CharacterSummary['id'],
    campaignId: row.campaign_id as CharacterSummary['campaignId'],
    championId: row.champion_id,
    displayName: row.display_name,
    sheetSource: row.sheet_source as CharacterSummary['sheetSource'],
    status: row.status as CharacterSummary['status'],
  }));
}

export const characterRoutes: FastifyPluginCallback<AppPluginOptions> = (app, options, done) => {
  const { deps } = options;
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get('/api/me', { schema: { response: { 200: zMeResponse } } }, (request, reply) => {
    const player = app.requirePlayer(request);
    void reply.status(200).send({
      player: player.profile,
      characters: [...listCharactersForPlayer(deps.connection, player.profile.id)],
      campaigns: [...listCampaignsForPlayer(deps.connection, player.profile.id)],
    });
  });

  done();
};
