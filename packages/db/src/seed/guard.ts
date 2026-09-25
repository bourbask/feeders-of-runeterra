/**
 * The five lines section 7.2 asks for: `db:reset` and `db:seed` refuse to run
 * on a base that is not a development one.
 *
 * TWO REFUSALS, NOT ONE, because they catch different accidents:
 *
 *   1. `NODE_ENV=production` — the deliberate one. The acceptance criterion
 *      says the command exits 1 WITHOUT DELETING ANYTHING, so the check comes
 *      before the file is touched, not inside the seeding;
 *   2. a campaign whose owner is not a demo player — the accident nobody
 *      plans: a developer pointing `DATABASE_PATH` at a copy of a real base.
 *      `NODE_ENV` says nothing about which FILE is in front of you.
 */

import { existsSync } from 'node:fs';
import process from 'node:process';

import { openSqlite } from '../client.js';
import { DEMO_PLAYERS } from './cast.js';

/** Exit code the two commands use when they refuse. */
export const REFUSED = 1;

export class ProductionRefusal extends Error {
  constructor(command: string) {
    super(`${command} refuse de s'exécuter sous NODE_ENV=production`);
    this.name = 'ProductionRefusal';
  }
}

export class NotADemoBase extends Error {
  constructor(
    readonly campaignId: string,
    readonly slug: string,
  ) {
    super(
      `la base contient la campagne « ${slug} » (${campaignId}), dont le propriétaire ` +
        `n'est pas un joueur de démonstration`,
    );
    this.name = 'NotADemoBase';
  }
}

/** `DATABASE_PATH`, or the local default of 03-donnees.md section 6.1. */
export function databasePath(): string {
  return process.env['DATABASE_PATH'] ?? './data/app.db';
}

/** Throws before anything is read or written. */
export function refuseInProduction(command: string): void {
  if (process.env['NODE_ENV'] === 'production') throw new ProductionRefusal(command);
}

/**
 * Throws when the file holds a campaign no demo player owns.
 *
 * Reads only: a base that cannot be opened, or that has no `campaigns` table
 * yet, is not a production base and is left alone.
 *
 * THAT FIRST HALF WAS A COMMENT AND NOTHING ELSE until this version. `openSqlite`
 * and `prepare` throw on a file that is not a SQLite base, and the throw walked
 * straight out of here: `DATABASE_PATH` pointing at a text file made
 * `pnpm db:reset` exit 1 with a `SqliteError` and the message « rien n'a été
 * supprimé », instead of resetting a file that is not a base. Found by reading
 * the coverage report — this file was at 0 % of lines.
 */
export function refuseForeignBase(target: string): void {
  if (!existsSync(target)) return;
  const foreign = readForeignCampaign(target);
  if (foreign !== undefined) throw new NotADemoBase(foreign.id, foreign.slug);
}

/** `undefined` for anything this guard has no opinion about. Reads only. */
function readForeignCampaign(target: string): { id: string; slug: string } | undefined {
  let connection;
  try {
    connection = openSqlite(target, { readonly: true });
  } catch {
    return undefined;
  }
  try {
    const table = connection
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'`)
      .get() as { name: string } | undefined;
    if (table === undefined) return undefined;
    const handles = DEMO_PLAYERS.map((player) => player.handle);
    const placeholders = handles.map(() => '?').join(', ');
    return connection
      .prepare(
        `SELECT c.id AS id, c.slug AS slug FROM campaigns c
           JOIN players p ON p.id = c.owner_player_id
          WHERE p.discord_username NOT IN (${placeholders})
          ORDER BY c.id LIMIT 1`,
      )
      .get(...handles) as { id: string; slug: string } | undefined;
  } catch {
    // Not a readable base. `db:reset` may have it.
    return undefined;
  } finally {
    connection.close();
  }
}
