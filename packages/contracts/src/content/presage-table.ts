/**
 * `content/tables/presages.json` (03-donnees.md section 4.6).
 *
 * The presage table IS an oracle table with a pinned id — an extension rather
 * than a second declaration, so `coversDie` keeps applying and a change to the
 * oracle shape cannot drift here.
 *
 * `.safeExtend()` AND NOT `.extend()`: zod 4 throws at MODULE LOAD —
 * "Cannot overwrite keys on object schemas containing refinements" — when
 * `.extend()` replaces a key on a schema that carries a refinement, and
 * `OracleTableSchema` carries `coversDie`. The failure is a thrown Error at
 * import time, not a type error, so `tsc` says nothing about it.
 */

import { z } from 'zod';

import { OracleTableSchema } from './oracle.js';

export const PresageTableSchema = OracleTableSchema.safeExtend({
  id: z.literal('presages'),
});

export type PresageTableContent = z.output<typeof PresageTableSchema>;
