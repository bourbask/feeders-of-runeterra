/**
 * `pnpm db:check-schema` — two questions, one command (section 5.4).
 *
 *   1. IS A MIGRATION PENDING? `drizzle-kit generate` runs against a COPY of
 *      `migrations/`. If it writes a new `.sql` file, somebody edited
 *      `src/schema/` without generating the migration, and we exit 1. Working
 *      on a copy is what keeps this read-only for the repository.
 *   2. DOES THE MIGRATED SCHEMA STILL MATCH `schema.expected.sql`? A fresh
 *      empty file is migrated, dumped, normalised, and compared byte for byte.
 *
 * `drizzle-kit generate` has no `--check` flag — the command the spec quoted
 * before this task did not exist. This is the closest honest equivalent.
 *
 * TWO THINGS MEASURED THE HARD WAY, both of which made this check silently
 * INERT on its first run:
 *
 *   - `--out` must be RELATIVE to the working directory. Given an absolute
 *     path, drizzle-kit 0.31 prefixes it with `./` and then cannot find the
 *     snapshot it just copied. Hence `mkdtempSync` inside the package and a
 *     relative path out of it.
 *   - drizzle-kit EXITS 0 on that crash. `execFileSync` therefore throws
 *     nothing, no file appears, and the check congratulates itself. So the
 *     output is read back: anything that is neither "no changes" nor a written
 *     file is treated as a failure, not as success.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { migrateFile } from '../migrate.js';
import { dumpNormalizedSchema } from '../schema-dump.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXPECTED = join(PACKAGE_ROOT, 'schema.expected.sql');
/** What drizzle-kit prints when the schema and the migrations agree. */
const NO_CHANGES = 'No schema changes';

const problems: string[] = [];
const scratch = mkdtempSync(join(PACKAGE_ROOT, '.check-schema-'));

try {
  // 1. Pending migration?
  const out = join(scratch, 'migrations');
  cpSync(join(PACKAGE_ROOT, 'migrations'), out, { recursive: true });
  const before = new Set(readdirSync(out).filter((f) => f.endsWith('.sql')));

  // Resolved by path, not by PATH: this also runs from the repository root,
  // where `node_modules/.bin` does not carry the package's own binaries.
  const output = execFileSync(
    join(PACKAGE_ROOT, 'node_modules', '.bin', 'drizzle-kit'),
    [
      'generate',
      '--dialect',
      'sqlite',
      '--schema',
      './src/schema/index.ts',
      '--out',
      `./${relative(PACKAGE_ROOT, out)}`,
    ],
    { cwd: PACKAGE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const added = readdirSync(out)
    .filter((f) => f.endsWith('.sql') && !before.has(f))
    .sort();

  if (added.length > 0) {
    problems.push(
      `migration en attente : src/schema/ a changé sans « pnpm db:generate » (${added.join(', ')})`,
    );
  } else if (!output.includes(NO_CHANGES)) {
    problems.push(
      `drizzle-kit generate n'a rien conclu (ni fichier écrit, ni « ${NO_CHANGES} ») :\n${output.trim()}`,
    );
  }

  // 2. Migrated schema == schema.expected.sql, byte for byte.
  const connection = migrateFile(join(scratch, 'probe.db'));
  const dumped = dumpNormalizedSchema(connection);
  connection.close();

  const expected = readFileSync(EXPECTED, 'utf8');
  if (dumped !== expected) {
    problems.push(`le dump normalisé diffère de schema.expected.sql${firstDiff(expected, dumped)}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function firstDiff(expected: string, actual: string): string {
  const a = expected.split('\n');
  const b = actual.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return `\n    attendu ligne ${String(i + 1)} : ${a[i] ?? '(rien)'}\n    obtenu  ligne ${String(i + 1)} : ${b[i] ?? '(rien)'}`;
    }
  }
  return '';
}

if (problems.length > 0) {
  console.error(`\ndb:check-schema — ${String(problems.length)} problème(s)\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}

console.log('db:check-schema — aucune migration en attente, dump conforme à schema.expected.sql.');
