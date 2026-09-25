/**
 * `pnpm db:rebuild` — zone C of every campaign, thrown away and replayed.
 *
 * Takes no argument on purpose: rebuilding ONE campaign is an API call
 * (`rebuildCampaign`), and a flag that silently rebuilds a subset is how a
 * base ends up half replayed. One campaign per transaction all the same, so a
 * failure on the third leaves the first two rebuilt and the third untouched.
 */

import process from 'node:process';

import { openSqlite } from '../client.js';
import { rebuildAll } from '../rebuild.js';

const target = process.env['DATABASE_PATH'] ?? './data/app.db';
const connection = openSqlite(target);

try {
  for (const report of rebuildAll(connection)) {
    console.log(
      `db:rebuild — ${report.campaignId} : ${String(report.applied)} entrées appliquées ` +
        `sur ${String(report.events)} (réducteur v${String(report.reducerVersion)}).`,
    );
  }
} finally {
  connection.close();
}
