/**
 * `/healthz`, `/readyz`, `/api/admin/health` (01-architecture.md section 6,
 * 03-donnees.md section 6.7).
 *
 * THE SPLIT IS THE POINT, and it is an operational rule before it is a schema.
 * `/healthz` and `/readyz` NEVER do a deep check: a fat WAL or an ageing backup
 * must not take the container out of rotation, because a late backup would then
 * be enough to cut the service. Everything expensive lives on
 * `/api/admin/health`, and that route alone.
 *
 * The three thresholds below are exported rather than inlined in the server so
 * that the runbook, the probe and the test read the same numbers.
 */

import { z } from 'zod';

/** Liveness. Answers 200 as long as the process answers at all, without the database. */
export const zHealthzResponse = z.strictObject({
  status: z.literal('ok'),
  version: z.string().min(1),
  uptimeMs: z.number().int().nonnegative(),
});

/** Readiness. SQLite ping plus migrations up to date; 503 otherwise. */
export const zReadyzResponse = z.strictObject({
  status: z.enum(['ready', 'not_ready']),
  database: z.boolean(),
  migrations: z.boolean(),
});

/** 03-donnees.md section 6.7: past this, a checkpoint is blocked by a long reader. */
export const ADMIN_HEALTH_WAL_MAX_BYTES = 64 * 1024 * 1024;
/** Past this, the last backup is too old to be trusted. */
export const ADMIN_HEALTH_BACKUP_MAX_AGE_MS = 8 * 60 * 60 * 1000;
/** Below this share of free space on `/srv`, the disk is a problem. */
export const ADMIN_HEALTH_MIN_FREE_DISK_RATIO = 0.2;

/**
 * Admin only. The five lines of 03-donnees.md section 6.7, and nothing else.
 * `healthy` is the server's verdict over the five, so a human reading the
 * route does not have to re-apply the thresholds by hand.
 */
export const zAdminHealthResponse = z.strictObject({
  /** `PRAGMA quick_check`. `'ok'`, or SQLite's complaint, verbatim. */
  quickCheck: z.string().min(1),
  walBytes: z.number().int().nonnegative(),
  /** `null` when no backup has ever run — which is not the same as a fresh one. */
  lastBackupAgeMs: z.number().int().nonnegative().nullable(),
  freeDiskRatio: z.number().min(0).max(1),
  contentHash: z.string().min(1),
  contentHashExpected: z.string().min(1),
  healthy: z.boolean(),
});

export type HealthzResponse = z.output<typeof zHealthzResponse>;
export type ReadyzResponse = z.output<typeof zReadyzResponse>;
export type AdminHealthResponse = z.output<typeof zAdminHealthResponse>;
