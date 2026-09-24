/**
 * The content hash and `CONTENT_VERSION` (01-architecture.md section 2.5,
 * 03-donnees.md section 4.8).
 *
 * The hash goes into `content_packs`, and a campaign whose
 * `campaigns.content_pack_hash` no longer matches gets a
 * `campaign.content_pack_changed` in its journal. So the hash has to be a
 * function of what the content SAYS, never of how it is typed: canonical JSON
 * with sorted keys, so that reformatting a file, reordering two keys or
 * running Prettier over the bundle does NOT invent a content change.
 *
 * NO `node:crypto` HERE. This module is pure; `load.ts` owns every platform
 * call, and the generator embeds the digest it computed at generation time.
 * That is also why `contentHash` takes the digest function as an argument
 * instead of reaching for one.
 */

import type { ContentFiles } from './validate.js';

/** JSON with object keys sorted, recursively. Two equal documents, one string. */
export function canonicalJson(value: unknown): string {
  // `JSON.stringify` of a scalar is never `undefined` here: the parser only
  // ever produces strings, numbers, booleans and `null`.
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',');
  return `{${body}}`;
}

/**
 * The canonical form of a whole content root: every file, by sorted path.
 *
 * Built from the PARSED value of each file, not its text, so whitespace is not
 * content. A file that does not parse is kept as its raw text — it is about to
 * fail pass 1 anyway, and silently dropping it would be one more way to hash
 * an incomplete bundle without noticing.
 */
export function canonicalBundleJson(files: ContentFiles): string {
  const parts: string[] = [];
  for (const file of [...files.keys()].sort()) {
    const raw = files.get(file) ?? '';
    let body: string;
    try {
      body = canonicalJson(JSON.parse(raw));
    } catch {
      body = JSON.stringify(raw);
    }
    parts.push(`${JSON.stringify(file)}:${body}`);
  }
  return `{${parts.join(',')}}`;
}

/** sha256 of the canonical bundle, with the digest function supplied by the caller. */
export function contentHash(files: ContentFiles, sha256: (input: string) => string): string {
  return sha256(canonicalBundleJson(files));
}

/**
 * What a campaign, an `ETag` and `content_packs` compare on: the bundle semver
 * plus the first twelve characters of the hash. The semver alone is not enough
 * — content changes far more often than anyone bumps it.
 */
export function contentVersion(version: string, hash: string): string {
  return `${version}+${hash.slice(0, 12)}`;
}
