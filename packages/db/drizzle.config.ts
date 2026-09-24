import type { Config } from 'drizzle-kit';

/**
 * `drizzle-kit generate` reads this; `drizzle-kit migrate` and `studio` also
 * need the file to talk to. `DATABASE_PATH` is the name arbitrated in P6 —
 * `DATABASE_URL` no longer exists anywhere.
 */
export default {
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
  dbCredentials: { url: process.env['DATABASE_PATH'] ?? './data/app.db' },
} satisfies Config;
