/**
 * LA CONVERSATION DE LA SONDE DE FUMÉE — ce que `scripts/smoke-m0.sh` fait
 * dire à un vrai navigateur, sans navigateur.
 *
 * Elle ouvre une VRAIE socket sur le serveur qui tourne, avec un VRAI cookie
 * de session, et vérifie les quatre choses que le critère d'acceptation de
 * M0-30 nomme :
 *
 *   1. `s2c.welcome`, `s2c.snapshot` et `s2c.presence` à l'ouverture ;
 *   2. des `s2c.event` livrés — ici par la reprise, puisque le seed est déjà
 *      écrit quand la socket arrive ;
 *   3. `c2s.why { correlationId }` répond `s2c.turn_proof` ;
 *   4. CHAQUE entrée de la preuve porte un `eventSeq` DU TOUR, et la trame
 *      pèse moins de 8 Kio.
 *
 * ── LE CLIENT EST CELUI DE NODE ──────────────────────────────────────────
 * `WebSocket` est global depuis Node 22.4 et accepte un en-tête, donc la
 * sonde n'ajoute aucune dépendance au dépôt. Le `.nvmrc` épingle 24.
 *
 * ── LA SESSION EST POSÉE PAR LE CODE DU SERVEUR, JAMAIS À LA MAIN ────────
 * `createSession` hache le secret comme la production le hache ; une
 * insertion écrite ici serait un second chemin d'authentification, dans un
 * dépôt public, pour une sonde. Elle est appelée par son module source, comme
 * `scripts/content-check.ts` appelle le chargeur de contenu.
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';

import { openSqlite } from '../packages/db/src/client.js';
import { createSession } from '../packages/server/src/auth/session.js';

/** Le critère d'acceptation, en toutes lettres : la preuve tient sous 8 Kio. */
const PROOF_MAX_BYTES = 8 * 1024;

/** Les trois trames que l'ouverture doit rendre, dans cet ordre. */
const AT_OPEN = ['s2c.welcome', 's2c.snapshot', 's2c.presence'] as const;

/** Combien d'entrées la reprise redemande. Assez pour tomber sur un tour entier. */
const RESUME_WINDOW = 40;

const PROTOCOL_VERSION = 1;

interface Frame {
  readonly t: string;
  readonly p: Record<string, unknown>;
  readonly seq?: number;
  readonly deliverySeq?: number;
}

function fail(message: string): never {
  process.stderr.write(`sonde : ${message}\n`);
  process.exit(1);
}

function uuid(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

async function main(): Promise<void> {
  const port = process.env['SMOKE_PORT'];
  const dbPath = process.env['DATABASE_PATH'];
  const slug = process.env['SMOKE_CAMPAIGN_SLUG'];
  if (port === undefined || dbPath === undefined || slug === undefined) {
    fail('SMOKE_PORT, DATABASE_PATH et SMOKE_CAMPAIGN_SLUG sont obligatoires.');
  }

  // ---------------------------------------------------- qui, et à quelle table
  const connection = openSqlite(dbPath);
  const campaign = connection.prepare(`SELECT id FROM campaigns WHERE slug = ?`).get(slug) as
    { id: string } | undefined;
  if (campaign === undefined) fail(`aucune campagne « ${slug} » dans ${dbPath}.`);

  const member = connection
    .prepare(
      `SELECT player_id FROM campaign_members
        WHERE campaign_id = ? AND left_at IS NULL ORDER BY player_id LIMIT 1`,
    )
    .get(campaign.id) as { player_id: string } | undefined;
  if (member === undefined) fail(`la campagne « ${slug} » n'a aucun membre.`);

  const session = createSession(connection, { playerId: member.player_id, now: Date.now() });
  connection.close();

  // --------------------------------------------------------------- la socket
  const open = WebSocket as unknown as new (url: string, options: unknown) => WebSocket;
  const socket = new open(`ws://127.0.0.1:${port}/ws?campaignId=${campaign.id}`, {
    headers: { cookie: `fr_session=${session.secret}` },
  });

  const frames: Frame[] = [];
  const raw: string[] = [];
  let closed: number | null = null;
  socket.addEventListener('message', (event) => {
    const line = String((event as MessageEvent).data);
    raw.push(line);
    frames.push(JSON.parse(line) as Frame);
  });
  socket.addEventListener('close', (event) => {
    closed = event.code;
  });

  const waitFor = async (type: string, what: string): Promise<Frame> => {
    const until = Date.now() + 10_000;
    for (;;) {
      const found = frames.find((frame) => frame.t === type);
      if (found !== undefined) return found;
      if (closed !== null) fail(`socket fermée (${String(closed)}) avant ${what}.`);
      if (Date.now() > until) fail(`rien n'est arrivé : ${what}.`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  const send = (type: string, payload: unknown, id: number): void => {
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, t: type, id: uuid(id), p: payload }));
  };

  await new Promise<void>((resolve) => {
    socket.addEventListener('open', () => {
      resolve();
    });
    socket.addEventListener('error', () => {
      fail("la socket n'a pas pu s'ouvrir.");
    });
  });

  // ------------------------------------------- 1. accueil, instantané, présence
  send('c2s.hello', { clientVersion: 'smoke-m0/0.0.0', lastDeliverySeq: null }, 1);
  const welcome = await waitFor('s2c.welcome', 's2c.welcome');
  await waitFor('s2c.snapshot', 's2c.snapshot');
  await waitFor('s2c.presence', 's2c.presence');

  const opened = frames.map((frame) => frame.t);
  if (JSON.stringify(opened) !== JSON.stringify([...AT_OPEN])) {
    fail(`l'ouverture a rendu ${JSON.stringify(opened)}, attendu ${JSON.stringify([...AT_OPEN])}.`);
  }
  const head = Number(welcome.p['lastDeliverySeq']);
  process.stdout.write(
    `  accueil      : s2c.welcome + s2c.snapshot + s2c.presence (curseur ${String(head)})\n`,
  );

  // ----------------------------------------------- 2. des événements du journal
  const since = Math.max(0, head - RESUME_WINDOW);
  send('c2s.resume', { sinceDeliverySeq: since }, 2);
  const batch = await waitFor('s2c.events_batch', 's2c.events_batch');
  const entries = batch.p['events'] as {
    seq: number;
    deliverySeq: number;
    event: { seq: number; correlationId: string | null; type: string };
  }[];
  if (entries.length === 0) fail('la reprise a rendu un lot vide : aucun tour à interroger.');
  process.stdout.write(`  reprise      : ${String(entries.length)} entrées livrées\n`);

  // -------------------------------------------------- 3. « Pourquoi ? » sur un tour
  // LE TOUR LE PLUS COMPLET du lot : celui dont le groupe porte un
  // `move.declared`. Prendre le premier `correlationId` venu rendrait une
  // preuve vide, qui ne prouverait rien du chemin.
  const groups = new Map<string, Set<string>>();
  for (const entry of entries) {
    const group = entry.event.correlationId;
    if (group === null) continue;
    const types = groups.get(group) ?? new Set<string>();
    types.add(entry.event.type);
    groups.set(group, types);
  }
  const turn = [...groups.entries()].find(([, types]) => types.has('move.declared'))?.[0];
  if (turn === undefined) fail('aucun tour avec un `move.declared` dans la fenêtre reprise.');

  const before = raw.length;
  send('c2s.why', { correlationId: turn }, 3);
  const proofFrame = await waitFor('s2c.turn_proof', 's2c.turn_proof');
  const proofBytes = Buffer.byteLength(raw.slice(before).join(''), 'utf8');

  const proof = proofFrame.p['proof'] as {
    correlationId: string;
    firstSeq: number;
    lastSeq: number;
    move: { eventSeq: number } | null;
    roll: { eventSeq: number } | null;
    revision: { eventSeq: number } | null;
    effects: { eventSeq: number }[];
    price: { eventSeq: number } | null;
    presage: { eventSeq: number } | null;
    narration: { eventSeq: number } | null;
  };

  if (proof.correlationId !== turn) {
    fail(`la preuve porte ${proof.correlationId}, demandée ${turn}.`);
  }

  // ------------------------- 4. chaque entrée porte un `eventSeq` DU TOUR, et 8 Kio
  const seqs: number[] = [
    ...(proof.move === null ? [] : [proof.move.eventSeq]),
    ...(proof.roll === null ? [] : [proof.roll.eventSeq]),
    ...(proof.revision === null ? [] : [proof.revision.eventSeq]),
    ...proof.effects.map((effect) => effect.eventSeq),
    ...(proof.price === null ? [] : [proof.price.eventSeq]),
    ...(proof.presage === null ? [] : [proof.presage.eventSeq]),
    ...(proof.narration === null ? [] : [proof.narration.eventSeq]),
  ];
  if (seqs.length === 0) fail('la preuve ne porte aucune entrée : elle ne prouve rien.');

  // LES DEUX BORNES VIENNENT DE LA PREUVE ELLE-MÊME, mais `firstSeq` et
  // `lastSeq` viennent du GROUPE du journal, pas de la liste ci-dessus : une
  // entrée hors du tour sortirait de l'intervalle.
  const outside = seqs.filter((seq) => seq < proof.firstSeq || seq > proof.lastSeq);
  if (outside.length > 0) {
    fail(
      `${String(outside.length)} entrée(s) hors du tour [${String(proof.firstSeq)}, ` +
        `${String(proof.lastSeq)}] : ${outside.join(', ')}.`,
    );
  }
  if (proofBytes >= PROOF_MAX_BYTES) {
    fail(`la trame de preuve pèse ${String(proofBytes)} octets, borne ${String(PROOF_MAX_BYTES)}.`);
  }

  process.stdout.write(
    `  « Pourquoi ? » : tour ${turn.slice(0, 8)}… · ${String(seqs.length)} entrées, ` +
      `toutes dans [${String(proof.firstSeq)}, ${String(proof.lastSeq)}] · ` +
      `${String(proofBytes)} octets (< ${String(PROOF_MAX_BYTES)})\n`,
  );

  socket.close();
  process.stdout.write('  fermeture    : propre\n');
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
