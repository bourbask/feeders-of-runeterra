/**
 * `pnpm db:check` — the twelve oracles, run against `DATABASE_PATH`.
 *
 * SILENT WHEN EVERYTHING IS SOUND. Not "12 contrôles, tout va bien": the
 * acceptance criterion is that a healthy base prints NO line and exits 0, so
 * anything this command prints is a problem, and a CI log that shows nothing
 * here is a CI log that needs no reading.
 *
 * Exits 1 with one line per offending row otherwise.
 */

import process from 'node:process';

import type { CheckFinding } from '../check.js';
import { formatFinding, runIntegrityChecks } from '../check.js';
import { openSqlite } from '../client.js';

const target = process.env['DATABASE_PATH'] ?? './data/app.db';
const connection = openSqlite(target);

let findings: readonly CheckFinding[] = [];
try {
  findings = runIntegrityChecks(connection);
} finally {
  connection.close();
}

for (const found of findings) {
  console.error(formatFinding(found));
}

if (findings.length > 0) {
  process.exit(1);
}
