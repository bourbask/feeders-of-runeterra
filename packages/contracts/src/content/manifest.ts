/**
 * `content/manifest.json` (03-donnees.md section 4.7).
 *
 * `expectedCounts` catches the dumb-but-real bug: a file left in a
 * `.gitignore`, a Docker volume mounted wrong, an incomplete `COPY`. The
 * server counts what it loaded and compares; a mismatch fails the start.
 *
 * It is also where the CHAMPION THRESHOLD lives — 3 in M0, 20 in V1 (P1). The
 * number is never written into the code, so raising it is a content change,
 * not a release.
 */

import { z } from 'zod';

export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  /** Semver of the bundle. */
  version: z.string().regex(SEMVER_PATTERN),
  rulesVersion: z.number().int().positive(),
  generatedAt: z.iso.datetime().optional(),
  expectedCounts: z.object({
    moves: z.number().int().positive(),
    champions: z.number().int().positive(),
    regions: z.number().int().positive(),
    /** 9 in V1, yes-no included. */
    oracles: z.number().int().positive(),
    tables: z.number().int().positive(),
    assets: z.number().int().positive(),
    /**
     * NOT IN SECTION 4.7 — added, and declared in the PR as a proposed ADR.
     *
     * `champions-index.json` was counted by nothing. Measured on the previous
     * version: cutting the directory from 3 entries down to the 2 that have a
     * sheet left `pnpm content:check` at 0. That file carries the casting lock
     * and the character-choice screen (~170 entries in V1), so it is exactly
     * the truncated-file bug `expectedCounts` exists to catch.
     */
    championIndex: z.number().int().positive(),
  }),
});

export type ManifestContent = z.output<typeof ManifestSchema>;
