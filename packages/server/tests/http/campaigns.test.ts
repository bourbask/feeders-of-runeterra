/**
 * Campaigns, membership, and the journal read per spectator.
 *
 * TWO FIXTURES, IN THE WRONG ORDER, EVERY TIME AN `ORDER BY` IS THE CLAIM. A
 * one-row fixture says nothing about sorting, and a fixture already in the
 * expected order says nothing either: both stay green when the clause is
 * deleted. Each list here carries two entries whose identifiers disagree with
 * the order the route promises, and the WHOLE array is compared.
 *
 * THE JOURNAL TEST IS AN ADR 0008 TEST. Two events, one `table` and one
 * `private` addressed to somebody else, and each player reads their own
 * thread. Replaying from one player's point of view must give back exactly
 * what they saw — no more, and no less.
 */

import {
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  zAppErrorPayload,
  zCampaignDetailResponse,
  zCampaignListResponse,
  zCampaignLogResponse,
  zMeResponse,
} from '@for/contracts';
import { appendEvents, upsertCharacter } from '@for/db';
import { afterEach, describe, expect, it } from 'vitest';

import { bench, fabricateSession, signIn } from '../../src/auth/testing.js';
import { slugify } from '../../src/http/campaigns.routes.js';

import type { Bench, SignedIn } from '../../src/auth/testing.js';

const open: Bench[] = [];

async function bed(): Promise<Bench> {
  const created = await bench();
  open.push(created);
  return created;
}

afterEach(async () => {
  for (const one of open.splice(0)) await one.close();
});

const csrf = { [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE };

/** Two valid ULIDs whose lexical order is the OPPOSITE of the expected one. */
const ALPHA = `01${'A'.repeat(24)}`;
const OMEGA = `01${'Z'.repeat(24)}`;

function insertCampaign(b: Bench, id: string, name: string, owner: string, updatedAt: number) {
  b.connection
    .prepare(
      `INSERT INTO campaigns
         (id, slug, name, pitch, owner_player_id, status, content_pack_version,
          content_pack_hash, rules_version, reducer_version, rng_seed, seq,
          created_at, updated_at)
       VALUES (?, ?, ?, '', ?, 'draft', '1.0.0', 'sha256-x', 1, 1, 'graine', 0, ?, ?)`,
    )
    .run(id, slugify(name), name, owner, updatedAt, updatedAt);
  b.connection
    .prepare(
      `INSERT INTO campaign_members
         (id, campaign_id, player_id, role, joined_at, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', ?, ?, ?)`,
    )
    .run(b.deps.ids.next(), id, owner, updatedAt, updatedAt, updatedAt);
}

describe('POST /api/campaigns', () => {
  it('crée la table, en fait le propriétaire, et dérive le slug du nom', async () => {
    const b = await bed();
    const me = await signIn(b);

    const response = await b.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: csrf,
      cookies: { fr_session: me.secret },
      payload: { name: 'Le Pacte de la Griffe' },
    });

    expect(response.statusCode).toBe(201);
    const body = zCampaignDetailResponse.parse(response.json());
    expect(body.slug).toBe('le-pacte-de-la-griffe');
    expect(body.ownerPlayerId).toBe(me.playerId);
    expect(body.status).toBe('draft');
    expect(body.seq).toBe(0);
    expect(body.lastSeq).toBe(0);
    // Frozen on the content the server actually loaded, not on a literal.
    expect(body.contentPackVersion).toBe(b.deps.content.bundle.version);
    expect(body.contentPackHash).toBe(b.deps.content.bundle.hash);

    const member = b.connection
      .prepare(`SELECT role FROM campaign_members WHERE campaign_id = ? AND player_id = ?`)
      .get(body.id, me.playerId) as { role: string } | undefined;
    expect(member?.role).toBe('owner');
  });

  it("n'ouvre pas de second chemin d'écriture : aucun événement n'est journalisé", async () => {
    const b = await bed();
    const me = await signIn(b);

    await b.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: csrf,
      cookies: { fr_session: me.secret },
      payload: { name: 'Une table' },
    });

    // ARCHITECTURE.md section 6: one write path for game state, and it is the
    // intent pipeline. An HTTP handler that appended to `events` would be the
    // second one. This is what makes that statement checkable.
    const events = b.connection.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number };
    expect(events.n).toBe(0);
  });

  it('répond 409 sur un slug déjà pris', async () => {
    const b = await bed();
    const me = await signIn(b);
    const payload = { name: 'Le Pacte de la Griffe' };

    const first = await b.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: csrf,
      cookies: { fr_session: me.secret },
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await b.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: csrf,
      cookies: { fr_session: me.secret },
      payload,
    });
    expect(second.statusCode).toBe(409);
    expect(zAppErrorPayload.parse(second.json()).code).toBe('conflict');

    const count = b.connection.prepare(`SELECT COUNT(*) AS n FROM campaigns`).get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it('répond 401 sans session', async () => {
    const b = await bed();

    const response = await b.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: csrf,
      payload: { name: 'Une table' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('l’adresse dérivée du nom', () => {
  it('plie les accents au lieu de les laisser tomber, et ne rend jamais une adresse vide', () => {
    // « Accents are folded, not dropped » : la différence se voit sur la
    // PREMIÈRE lettre. Une suppression des caractères accentués rendrait
    // `te-a-la-griffe`, ce que l'égalité exacte ci-dessous refuse.
    expect(slugify('Été à la Griffe')).toBe('ete-a-la-griffe');
    // Les séparations s'effondrent, et les tirets de bord disparaissent.
    expect(slugify('  Le  Pacte — 2 !  ')).toBe('le-pacte-2');
    // Et un nom dont il ne reste rien en ASCII a quand même une adresse.
    expect(slugify('⚔ 🜂 ⚔')).toBe('table');
  });
});

describe('GET /api/campaigns', () => {
  it('ne rend que les tables du joueur, la plus récemment touchée en tête', async () => {
    const b = await bed();
    const me = await signIn(b);
    const other = fabricateSession(b, '999', 'quelqun-dautre');

    // ALPHA trie AVANT OMEGA par identifiant, et il est le plus ANCIEN : la
    // fixture est donc dans l'ordre inverse de la réponse attendue.
    insertCampaign(b, ALPHA, 'La vieille', me.playerId, 1_000);
    insertCampaign(b, OMEGA, 'La neuve', me.playerId, 2_000);
    insertCampaign(b, `01${'B'.repeat(24)}`, "D'un autre", other.playerId, 3_000);

    const response = await b.app.inject({
      method: 'GET',
      url: '/api/campaigns',
      cookies: { fr_session: me.secret },
    });

    expect(response.statusCode).toBe(200);
    const body = zCampaignListResponse.parse(response.json());
    // THE WHOLE ARRAY: order and membership in one assertion.
    expect(body.campaigns.map((c) => c.id)).toEqual([OMEGA, ALPHA]);
  });

  it('répond 401 sans session', async () => {
    const b = await bed();

    const response = await b.app.inject({ method: 'GET', url: '/api/campaigns' });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/me — les deux listes', () => {
  it('rend personnages et tables, chacun dans l’ordre annoncé', async () => {
    const b = await bed();
    const me = await signIn(b);
    insertCampaign(b, ALPHA, 'La vieille', me.playerId, 1_000);
    insertCampaign(b, OMEGA, 'La neuve', me.playerId, 2_000);

    const sheet = { nom: 'fiche' };
    const older = `01${'C'.repeat(24)}`;
    const newer = `01${'Y'.repeat(24)}`;
    // One character per (campaign, player) — the DDL says so — so the two rows
    // live in the two campaigns above.
    for (const [id, campaignId, updatedAt, name] of [
      [older, ALPHA, 1_000, 'Braum'],
      [newer, OMEGA, 2_000, 'Ashe'],
    ] as const) {
      upsertCharacter(b.connection, {
        id,
        campaignId,
        playerId: me.playerId,
        championId: name.toLowerCase(),
        displayName: name,
        sheetSource: 'handwritten',
        sheetRef: 'ref',
        sheetSnapshot: sheet,
        attrVif: 1,
        attrCoeur: 1,
        attrFer: 1,
        attrOmbre: 1,
        attrEsprit: 1,
        createdSeq: 1,
        updatedSeq: 1,
        createdAt: updatedAt,
        updatedAt,
      });
    }

    const response = await b.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { fr_session: me.secret },
    });

    const body = zMeResponse.parse(response.json());
    // Both fixtures are two rows whose identifiers sort the other way round.
    expect(body.campaigns.map((c) => c.id)).toEqual([OMEGA, ALPHA]);
    expect(body.characters.map((c) => c.id)).toEqual([newer, older]);
    expect(body.characters.map((c) => c.displayName)).toEqual(['Ashe', 'Braum']);
  });
});

describe('GET /api/campaigns/:id', () => {
  it('rend les métadonnées et lastSeq à un membre', async () => {
    const b = await bed();
    const me = await signIn(b);
    insertCampaign(b, ALPHA, 'La table', me.playerId, 1_000);

    const response = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/${ALPHA}`,
      cookies: { fr_session: me.secret },
    });

    expect(response.statusCode).toBe(200);
    expect(zCampaignDetailResponse.parse(response.json()).lastSeq).toBe(0);
  });

  it('répond 404 sur une table inconnue et 403 sur une table dont on n’est pas', async () => {
    const b = await bed();
    const me = await signIn(b);
    const other = fabricateSession(b, '999', 'quelqun-dautre');
    insertCampaign(b, ALPHA, 'La table', other.playerId, 1_000);

    const unknown = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/01${'D'.repeat(24)}`,
      cookies: { fr_session: me.secret },
    });
    expect(unknown.statusCode).toBe(404);
    expect(zAppErrorPayload.parse(unknown.json()).code).toBe('campaign_not_found');

    const forbidden = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/${ALPHA}`,
      cookies: { fr_session: me.secret },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(zAppErrorPayload.parse(forbidden.json()).code).toBe('forbidden_campaign');

    // And the other direction, so the 403 is about membership and not about
    // the campaign being unreadable by anybody.
    const owner = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/${ALPHA}`,
      cookies: { fr_session: other.secret },
    });
    expect(owner.statusCode).toBe(200);
  });
});

describe('GET /api/campaigns/:id/log', () => {
  /** Three events: table, private to `me`, private to somebody else. */
  function seedJournal(b: Bench, me: SignedIn, other: SignedIn) {
    insertCampaign(b, ALPHA, 'La table', me.playerId, 1_000);
    b.connection
      .prepare(
        `INSERT INTO campaign_members
           (id, campaign_id, player_id, role, joined_at, created_at, updated_at)
         VALUES (?, ?, ?, 'player', 1, 1, 1)`,
      )
      .run(b.deps.ids.next(), ALPHA, other.playerId);

    const note = (text: string) => ({ text, byPlayerId: me.playerId });
    appendEvents(b.connection, {
      campaignId: ALPHA,
      now: b.clock.now(),
      events: [
        {
          id: b.deps.ids.next(),
          type: 'system.note',
          payload: note('pour toute la table'),
          actorKind: 'system',
          scope: 'table',
          createdAt: b.clock.now(),
        },
        {
          id: b.deps.ids.next(),
          type: 'system.note',
          payload: note('pour moi seul'),
          actorKind: 'system',
          scope: 'private',
          recipients: [me.playerId],
          createdAt: b.clock.now(),
        },
        {
          id: b.deps.ids.next(),
          type: 'system.note',
          payload: note("pour l'autre seul"),
          actorKind: 'system',
          scope: 'private',
          recipients: [other.playerId],
          createdAt: b.clock.now(),
        },
      ],
    });
  }

  it('rend à chaque joueur exactement son fil, ni plus ni moins (ADR 0008)', async () => {
    const b = await bed();
    const me = await signIn(b);
    const other = fabricateSession(b, '999', 'quelqun-dautre');
    seedJournal(b, me, other);

    const mine = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/${ALPHA}/log`,
      cookies: { fr_session: me.secret },
    });
    const theirs = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/${ALPHA}/log`,
      cookies: { fr_session: other.secret },
    });

    const minePage = zCampaignLogResponse.parse(mine.json());
    const theirsPage = zCampaignLogResponse.parse(theirs.json());

    // Exact arrays, both ways: each sees the table event plus their own.
    expect(minePage.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(theirsPage.entries.map((e) => e.seq)).toEqual([1, 3]);
    // And what the other player's private line SAID never reaches this one.
    expect(mine.body).not.toContain("pour l'autre seul");
    expect(theirs.body).not.toContain('pour moi seul');
    // The head is the allocator's, which both see identically.
    expect(minePage.lastSeq).toBe(3);
    expect(theirsPage.lastSeq).toBe(3);
  });

  it('pagine sur seq, et rend nextSinceSeq null une fois la tête atteinte', async () => {
    const b = await bed();
    const me = await signIn(b);
    const other = fabricateSession(b, '999', 'quelqun-dautre');
    seedJournal(b, me, other);

    const page = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/${ALPHA}/log?limit=1`,
      cookies: { fr_session: me.secret },
    });
    const first = zCampaignLogResponse.parse(page.json());
    expect(first.entries.map((e) => e.seq)).toEqual([1]);
    expect(first.nextSinceSeq).toBe(1);

    const next = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/${ALPHA}/log?limit=1&sinceSeq=${String(first.nextSinceSeq ?? 0)}`,
      cookies: { fr_session: me.secret },
    });
    const second = zCampaignLogResponse.parse(next.json());
    expect(second.entries.map((e) => e.seq)).toEqual([2]);
    // Seq 3 exists but is not this player's, so the page that follows is empty
    // and the cursor closes. A cursor derived from the player's own last line
    // would have stopped one page too early.
    expect(second.nextSinceSeq).toBe(2);

    const third = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/${ALPHA}/log?limit=1&sinceSeq=2`,
      cookies: { fr_session: me.secret },
    });
    const empty = zCampaignLogResponse.parse(third.json());
    expect(empty.entries).toEqual([]);
    expect(empty.nextSinceSeq).toBeNull();
  });

  it('ferme le curseur quand la page finit SUR la tête, pas seulement quand elle est vide', async () => {
    const b = await bed();
    const me = await signIn(b);
    insertCampaign(b, ALPHA, 'La table', me.playerId, 1_000);

    // Deux événements de table, donc la dernière ligne VISIBLE par ce joueur
    // est aussi la tête de l'allocateur. C'est le seul cas où la condition
    // `last.seq < campaigns.seq` décide quelque chose : avec une page qui
    // s'arrête sous la tête, elle est vraie, et la retirer ne se voit pas.
    const note = (text: string) => ({ text, byPlayerId: me.playerId });
    appendEvents(b.connection, {
      campaignId: ALPHA,
      now: b.clock.now(),
      events: ['première', 'seconde'].map((text) => ({
        id: b.deps.ids.next(),
        type: 'system.note' as const,
        payload: note(text),
        actorKind: 'system' as const,
        scope: 'table' as const,
        createdAt: b.clock.now(),
      })),
    });

    const first = zCampaignLogResponse.parse(
      (
        await b.app.inject({
          method: 'GET',
          url: `/api/campaigns/${ALPHA}/log?limit=1`,
          cookies: { fr_session: me.secret },
        })
      ).json(),
    );
    // Page pleine, sous la tête : il reste à demander.
    expect(first.entries.map((e) => e.seq)).toEqual([1]);
    expect(first.nextSinceSeq).toBe(1);

    const second = zCampaignLogResponse.parse(
      (
        await b.app.inject({
          method: 'GET',
          url: `/api/campaigns/${ALPHA}/log?limit=1&sinceSeq=1`,
          cookies: { fr_session: me.secret },
        })
      ).json(),
    );
    // Page pleine ELLE AUSSI, mais elle finit sur la tête : le curseur ferme,
    // et le client n'a pas de page vide à aller chercher.
    expect(second.entries.map((e) => e.seq)).toEqual([2]);
    expect(second.lastSeq).toBe(2);
    expect(second.nextSinceSeq).toBeNull();
  });

  it('répond 404 sur une table inconnue, avant même de parler d’appartenance', async () => {
    const b = await bed();
    const me = await signIn(b);

    const response = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/01${'E'.repeat(24)}/log`,
      cookies: { fr_session: me.secret },
    });

    // 404 et non 403 : on ne dit pas « tu n'es pas à cette table » d'une table
    // qui n'existe pas, sinon la réponse devient un oracle d'existence inversé.
    expect(response.statusCode).toBe(404);
    expect(zAppErrorPayload.parse(response.json()).code).toBe('campaign_not_found');
  });

  it('répond 403 à quelqu’un qui n’est pas à la table', async () => {
    const b = await bed();
    const me = await signIn(b);
    const stranger = fabricateSession(b, '777', 'un-inconnu');
    insertCampaign(b, ALPHA, 'La table', me.playerId, 1_000);

    const response = await b.app.inject({
      method: 'GET',
      url: `/api/campaigns/${ALPHA}/log`,
      cookies: { fr_session: stranger.secret },
    });

    expect(response.statusCode).toBe(403);
  });
});
