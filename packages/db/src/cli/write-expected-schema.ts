/**
 * Regenerates `schema.expected.sql` from a freshly migrated empty file.
 *
 * Run by hand after a reviewed migration, never in CI: in CI the file is the
 * REFERENCE that `db:check-schema` compares against, and a reference a machine
 * rewrites on its own proves nothing.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrateFile } from '../migrate.js';
import { dumpNormalizedSchema } from '../schema-dump.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scratch = mkdtempSync(join(tmpdir(), 'for-db-expected-'));

try {
  const connection = migrateFile(join(scratch, 'probe.db'));
  const dump = dumpNormalizedSchema(connection);
  connection.close();
  writeFileSync(join(packageRoot, 'schema.expected.sql'), dump, 'utf8');
  console.log(`schema.expected.sql — ${String(dump.split('\n').length - 1)} instructions.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
