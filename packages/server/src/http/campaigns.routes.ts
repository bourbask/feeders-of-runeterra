/**
 * Campaigns and the paginated journal (01-architecture.md section 6).
 *
 * EVERY PROMISE BELOW NAMES THE TEST THAT HOLDS IT (CLAUDE.md, « une promesse
 * nomme le test qui la tient »). The tests live in `tests/http/campaigns.test.ts`.
 *
 * `POST /api/campaigns` WRITES NO EVENT, AND THAT IS THE INVARIANT RATHER THAN
 * A GAP. `ARCHITECTURE.md` section 6 says there is exactly ONE write path for
 * game state — the intent pipeline — and that any pull request opening a
 * second one must be refused. `campaigns` and `campaign_members` are zone A
 * (03-donnees.md section 0.4): platform rows, not replayable state, which
 * `db:rebuild` never touches. So creating a campaign inserts two zone A rows
 * and stops there. Held by « n'ouvre pas de second chemin d'écriture : aucun
 * événement n'est journalisé ». Whether the journal should also open on a
 * `campaign.created` is a question for the pipeline that owns `appendEvents`
 * (M0-24) and for the seed (M0-26); answering it from an HTTP handler would
 * be the second write path. Reported, not worked around.
 *
 * THE JOURNAL IS READ PER SPECTATOR. `readSinceForPlayer` is the ADR 0008
 * read: a `table` event reaches everyone, a `subset` or `private` one reaches
 * exactly the identifiers in `recipients_json`. Invariant 4 says replaying
 * from one player's point of view must return exactly what that player saw —
 * so this route cannot use `readSince`, which returns the table's stream.
 * Held by « rend à chaque joueur exactement son fil, ni plus ni moins (ADR
 * 0008) », which needs TWO ACTORS to say anything: two sessions read the same
 * campaign, each exact array is compared whole, and what the other player's
 * private line SAID is hunted through the body.
 *
 * Browsed by `seq`, never by `deliverySeq` (ADR 0010): the cursor of a socket
 * is not the cursor of the journal, and `@for/contracts` says so at the top of
 * `http/tables.ts`. Held by « pagine sur seq, et rend nextSinceSeq null une
 * fois la tête atteinte », WHOSE FIXTURE PUTS A HOLE IN THIS PLAYER'S STREAM
 * ON PURPOSE: the two numbers only differ once a line the player cannot see
 * sits between two lines they can. On a stream with no hole they coincide, and
 * the test would stay green on a route paginating by delivery rank — measured
 * before the hole existed.
 */

import {
  zCampaignDetailResponse,
  zCampaignListResponse,
  zCampaignLogQuery,
  zCampaignLogResponse,
  zCampaignParams,
  zCreateCampaignBody,
  zGameEvent,
} from '@for/contracts';
import { readSinceForPlayer } from '@for/db';
import { REDUCER_VERSION } from '@for/engine';
import { randomBytes } from 'node:crypto';

import { forbidden } from '../auth/index.js';
import { AppError } from '../errors.js';

import type { CampaignLogEntry, CampaignSummary, GameEventDto } from '@for/contracts';
import type { JournalEvent, SqliteConnection } from '@for/db';
import type { FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppPluginOptions } from '../deps.js';

interface CampaignRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly pitch: string;
  readonly owner_player_id: string;
  readonly status: string;
  readonly content_pack_version: string;
  readonly content_pack_hash: string;
  readonly rules_version: number;
  readonly seq: number;
}

/** 404 — no campaign under that identifier. */
export function campaignNotFound(details?: unknown): AppError {
  return new AppError('campaign_not_found', 404, "Cette table n'existe pas.", details);
}

export function toSummary(row: CampaignRow): CampaignSummary {
  return {
    id: row.id as CampaignSummary['id'],
    slug: row.slug,
    name: row.name,
    pitch: row.pitch,
    status: row.status as CampaignSummary['status'],
    ownerPlayerId: row.owner_player_id as CampaignSummary['ownerPlayerId'],
    contentPackVersion: row.content_pack_version,
    seq: row.seq,
  };
}

/** The columns `zCampaignSummary` and `zCampaignDetailResponse` need, and no others. */
const CAMPAIGN_COLUMNS = `campaigns.id, campaigns.slug, campaigns.name, campaigns.pitch,
  campaigns.owner_player_id, campaigns.status, campaigns.content_pack_version,
  campaigns.content_pack_hash, campaigns.rules_version, campaigns.seq`;

/**
 * The tables one player may open, most recently touched first.
 *
 * ORDER IS PART OF THE ANSWER, so it is written here once and asserted on an
 * out-of-order fixture: `tests/http/campaigns.test.ts`, « rend personnages et
 * tables, chacun dans l'ordre annoncé », inserts two campaigns whose
 * `updated_at` disagrees with their identifiers and compares the WHOLE array;
 * « ne rend que les tables du joueur, la plus récemment touchée en tête » does
 * the same on this route. A single-row fixture, or one already in the right
 * order, would leave this clause unmeasured.
 */
export function listCampaignsForPlayer(
  connection: SqliteConnection,
  playerId: string,
): readonly CampaignSummary[] {
  const rows = connection
    .prepare(
      `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns
         JOIN campaign_members ON campaign_members.campaign_id = campaigns.id
        WHERE campaign_members.player_id = ? AND campaign_members.left_at IS NULL
        ORDER BY campaigns.updated_at DESC, campaigns.id ASC`,
    )
    .all(playerId) as CampaignRow[];
  return rows.map((row) => toSummary(row));
}

function getCampaignRow(connection: SqliteConnection, id: string): CampaignRow | undefined {
  return connection.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE id = ?`).get(id) as
    CampaignRow | undefined;
}

function isMember(connection: SqliteConnection, campaignId: string, playerId: string): boolean {
  const row = connection
    .prepare(
      `SELECT 1 AS ok FROM campaign_members
        WHERE campaign_id = ? AND player_id = ? AND left_at IS NULL`,
    )
    .get(campaignId, playerId) as { ok: number } | undefined;
  return row !== undefined;
}

/**
 * kebab-case, ASCII, as `zSlug` spells it. Accents are folded, not dropped.
 *
 * Held by `tests/http/campaigns.test.ts`, « plie les accents au lieu de les
 * laisser tomber, et ne rend jamais une adresse vide ».
 */
export function slugify(name: string): string {
  const folded = name
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036F]/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '');
  return folded === '' ? 'table' : folded;
}

/**
 * A journal row, as the 71-variant union describes it.
 *
 * `type` and `payload` sit NEXT TO the envelope rather than inside it — that
 * is the shape `zGameEvent` discriminates on.
 *
 * The PROPERTY — a row this server cannot describe never reaches a client as a
 * half-event — is held by `tests/http/campaigns.test.ts`, « refuse de servir
 * une ligne que le contrat ne décrit pas, plutôt qu'un demi-événement », which
 * writes a row with a type outside the union straight into `events`.
 *
 * This `parse` is not what that test pins, and saying otherwise would be the
 * comment promising more than it holds: replacing it with a cast leaves the
 * suite at 126/126 green, because the reply serializer of
 * `zCampaignLogResponse` refuses the row one step later. Two nets, one mesh
 * each — the parse is the one that names the offending row in the log.
 */
function toGameEvent(event: JournalEvent): GameEventDto {
  return zGameEvent.parse({
    id: event.id,
    campaignId: event.campaignId,
    seq: event.seq,
    playSessionId: event.playSessionId,
    payloadVersion: event.payloadVersion,
    actorKind: event.actorKind,
    actorPlayerId: event.actorPlayerId,
    subjectCharacterId: event.subjectCharacterId,
    correlationId: event.correlationId,
    causationId: event.causationId,
    rngStream: event.rngStream,
    rngDrawIndex: event.rngDrawIndex,
    createdAt: event.createdAt,
    scope: event.scope,
    recipients: event.recipients,
    type: event.type,
    payload: event.payload,
  });
}

export const campaignRoutes: FastifyPluginCallback<AppPluginOptions> = (app, options, done) => {
  const { deps } = options;
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/api/campaigns',
    { schema: { response: { 200: zCampaignListResponse } } },
    (request, reply) => {
      const player = app.requirePlayer(request);
      void reply
        .status(200)
        .send({ campaigns: [...listCampaignsForPlayer(deps.connection, player.profile.id)] });
    },
  );

  routes.post(
    '/api/campaigns',
    { schema: { body: zCreateCampaignBody, response: { 201: zCampaignDetailResponse } } },
    (request, reply) => {
      const player = app.requirePlayer(request);
      const now = deps.clock.now();
      const bundle = deps.content.bundle;
      const id = deps.ids.next();
      const slug = request.body.slug ?? slugify(request.body.name);

      try {
        deps.connection.transaction(() => {
          deps.connection
            .prepare(
              `INSERT INTO campaigns
                 (id, slug, name, pitch, owner_player_id, status, content_pack_version,
                  content_pack_hash, rules_version, reducer_version, rng_seed, seq,
                  created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, 0, ?, ?)`,
            )
            .run(
              id,
              slug,
              request.body.name,
              request.body.pitch,
              player.profile.id,
              bundle.version,
              bundle.hash,
              bundle.rulesVersion,
              REDUCER_VERSION,
              randomBytes(32).toString('hex'),
              now,
              now,
            );
          deps.connection
            .prepare(
              `INSERT INTO campaign_members
                 (id, campaign_id, player_id, role, joined_at, created_at, updated_at)
               VALUES (?, ?, ?, 'owner', ?, ?, ?)`,
            )
            .run(deps.ids.next(), id, player.profile.id, now, now, now);
        })();
      } catch (error) {
        // `campaigns_slug_uq`. The slug is either the player's own proposal or
        // one derived from a name somebody else already used; either way the
        // answer is "pick another", not "something went wrong". Held by
        // « répond 409 sur un slug déjà pris ».
        throw new AppError(
          'conflict',
          409,
          'Une table porte déjà cette adresse. Choisis un autre nom.',
          { slug },
          { cause: error },
        );
      }

      const row = getCampaignRow(deps.connection, id);
      if (row === undefined) throw campaignNotFound({ id });
      void reply.status(201).send({
        ...toSummary(row),
        lastSeq: row.seq,
        contentPackHash: row.content_pack_hash,
        rulesVersion: row.rules_version,
      });
    },
  );

  routes.get(
    '/api/campaigns/:id',
    { schema: { params: zCampaignParams, response: { 200: zCampaignDetailResponse } } },
    (request, reply) => {
      const player = app.requirePlayer(request);
      const row = getCampaignRow(deps.connection, request.params.id);
      if (row === undefined) throw campaignNotFound({ id: request.params.id });
      if (!isMember(deps.connection, row.id, player.profile.id)) {
        throw forbidden("Tu n'es pas à cette table.", { campaignId: row.id });
      }
      void reply.status(200).send({
        ...toSummary(row),
        lastSeq: row.seq,
        contentPackHash: row.content_pack_hash,
        rulesVersion: row.rules_version,
      });
    },
  );

  routes.get(
    '/api/campaigns/:id/log',
    {
      schema: {
        params: zCampaignParams,
        querystring: zCampaignLogQuery,
        response: { 200: zCampaignLogResponse },
      },
    },
    (request, reply) => {
      const player = app.requirePlayer(request);
      const row = getCampaignRow(deps.connection, request.params.id);
      if (row === undefined) throw campaignNotFound({ id: request.params.id });
      if (!isMember(deps.connection, row.id, player.profile.id)) {
        throw forbidden("Tu n'es pas à cette table.", { campaignId: row.id });
      }

      const events = readSinceForPlayer(
        deps.connection,
        row.id,
        player.profile.id,
        request.query.sinceSeq,
        request.query.limit,
      );
      const entries: CampaignLogEntry[] = events.map((event) => ({
        seq: event.seq,
        event: toGameEvent(event),
      }));

      // `null` means "the page reached the head", and the head that matters is
      // the ALLOCATOR (`campaigns.seq`), not the last row this player was
      // allowed to see: a full page ending below the head means there is more
      // to ask for, even if the next rows turn out to be invisible to them.
      // Held by « ferme le curseur quand la page finit SUR la tête, pas
      // seulement quand elle est vide ».
      const last = entries.at(-1);
      const nextSinceSeq =
        last !== undefined && entries.length === request.query.limit && last.seq < row.seq
          ? last.seq
          : null;

      void reply.status(200).send({ entries, nextSinceSeq, lastSeq: row.seq });
    },
  );

  done();
};
