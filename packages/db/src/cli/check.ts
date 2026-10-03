/**
 * `pnpm db:check` — the twelve oracles, run against `DATABASE_PATH`.
 *
 * IT NAMES WHAT IT RAN. Until M0-30 it printed NOTHING on a healthy base and
 * exited 0, on the grounds that a silent log is a log nobody has to read. The
 * acceptance review answered it in one line: a mute green is indistinguishable
 * from a green that did nothing — and the criterion of M0-30 says "the twelve
 * oracles", a number no reader could see. So the roster is printed, one line,
 * on STANDARD OUTPUT; findings still go to standard error, one per offending
 * row, and still exit 1.
 *
 * The count comes from `CONTROL_ROSTER`, which `check.ts` derives from the
 * list it actually runs. Writing `12` here would be a number that agrees with
 * itself and would stay green the day a control disappears.
 */

import process from 'node:process';

import type { CheckFinding } from '../check.js';
import { CONTROL_ROSTER, formatFinding, runIntegrityChecks } from '../check.js';
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

console.log(
  `db:check — ${String(CONTROL_ROSTER.length)} oracles sur ${target} : ` +
    `${CONTROL_ROSTER.map((control) => String(control.number)).join(', ')}. Aucun défaut.`,
);
