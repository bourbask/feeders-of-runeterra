/**
 * `pnpm db:reset` — the command of the everyday: file thrown away, migrations
 * applied, demo campaign seeded.
 *
 * IT REFUSES BEFORE IT DELETES. The acceptance criterion is
 * `NODE_ENV=production pnpm db:reset` exiting 1 WITHOUT REMOVING ANYTHING, so
 * both guards run while the file is still untouched. A guard that ran after
 * `rm` would be a guard that reports a loss instead of preventing one.
 */

import process from 'node:process';

import { seedDemoFile } from './demo.js';
import { databasePath, refuseForeignBase, refuseInProduction } from './guard.js';

const flags = new Set(process.argv.slice(2));
const unknown = [...flags].filter((flag) => flag !== '--minimal');
if (unknown.length > 0) {
  console.error(`db:reset — option inconnue : ${unknown.join(' ')}`);
  process.exit(1);
}

const target = databasePath();

try {
  refuseInProduction('db:reset');
  refuseForeignBase(target);
} catch (error) {
  console.error(`db:reset — ${String(error)} ; rien n'a été supprimé.`);
  process.exit(1);
}

try {
  const report = seedDemoFile(target, { force: true, minimal: flags.has('--minimal') });
  console.log(
    `db:reset — ${target} : base remise à zéro, ${String(report.events)} entrées de journal.`,
  );
} catch (error) {
  console.error(`db:reset — ${String(error)}`);
  process.exit(1);
}
