/**
 * `pnpm db:seed` — the demo campaign, on `DATABASE_PATH`.
 *
 * Three flags and no more: `--force` recreates the file (the journal is
 * append-only, so there is no such thing as re-seeding one), `--minimal` stops
 * at the end of the first scene, and nothing else is accepted — an unknown
 * flag exits 1 rather than being ignored, because a typo in `--minimal` that
 * silently seeded the whole campaign would be found much later.
 *
 * THE PRODUCTION GUARD IS HERE AND IN `cli-reset.ts`, not in `seedDemo()`:
 * the demo campaign is legitimate in a test, and the test has no environment.
 * What must never happen is a COMMAND that writes it on a production file.
 */

import process from 'node:process';

import { AlreadySeededError, DEMO_CAMPAIGN_SLUG, seedDemoFile } from './demo.js';
import { databasePath, refuseForeignBase, refuseInProduction } from './guard.js';

const flags = new Set(process.argv.slice(2));
const unknown = [...flags].filter((flag) => flag !== '--force' && flag !== '--minimal');
if (unknown.length > 0) {
  console.error(`db:seed — option inconnue : ${unknown.join(' ')}`);
  process.exit(1);
}

const target = databasePath();

try {
  refuseInProduction('db:seed');
  // `--force` removes the file: the same two guards `db:reset` runs, and for
  // the same reason — they must answer before anything is deleted.
  if (flags.has('--force')) refuseForeignBase(target);
} catch (error) {
  console.error(`db:seed — ${String(error)} ; rien n'a été supprimé.`);
  process.exit(1);
}

try {
  const report = seedDemoFile(target, {
    force: flags.has('--force'),
    minimal: flags.has('--minimal'),
  });
  console.log(
    `db:seed — ${DEMO_CAMPAIGN_SLUG} : ${String(report.events)} entrées, ` +
      `${String(report.types)} types, ${String(report.characters)} personnages, ` +
      `${String(report.sessions)} séance(s), ${String(report.chronicles)} chronique(s), ` +
      `${String(report.snapshots)} instantané(s)${report.minimal ? ' — base minimale' : ''}.`,
  );
} catch (error) {
  // IDEMPOTENT BY NO-OP, as 03-donnees.md section 7.2 spells it: « db:seed
  // (idempotent : no-op si déjà semée) ». The journal is append-only, so
  // seeding twice is not something one can do to a base — but running the
  // command twice must not fail a script that just wanted a seeded base.
  if (error instanceof AlreadySeededError) {
    console.log(
      `db:seed — ${DEMO_CAMPAIGN_SLUG} déjà en base (${error.campaignId}) : rien à faire.`,
    );
  } else {
    console.error(`db:seed — ${String(error)}`);
    process.exit(1);
  }
}
