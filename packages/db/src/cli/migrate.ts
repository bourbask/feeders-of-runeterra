/**
 * `pnpm db:migrate` — applies the committed migrations to `DATABASE_PATH`.
 *
 * Forward only. No `down`, ever (section 5.2, rule 2): on a single production
 * file, rolling a schema back is riskier than the correction it claims to
 * undo.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { MIGRATIONS_FOLDER, migrateFile } from '../migrate.js';

const target = resolve(process.env['DATABASE_PATH'] ?? './data/app.db');
mkdirSync(dirname(target), { recursive: true });

const connection = migrateFile(target);
const tables = connection
  .prepare(
    `SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  )
  .get() as { n: number };
connection.close();

console.log(`db:migrate — ${target} : ${String(tables.n)} tables (source ${MIGRATIONS_FOLDER}).`);
