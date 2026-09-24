/**
 * The ONLY module of `@for/content` that touches the disk.
 *
 * M0-14 asks for it in a command:
 *
 *     grep -rn "readFileSync\|fs\." packages/content/src --include=*.ts \
 *       | grep -v load.ts        # returns nothing
 *
 * At RUNTIME the server never comes here: it imports `generated/index.ts`,
 * which carries the content as static data (01-architecture.md section 2.5).
 * This path serves `pnpm content:check`, `pnpm content:index` and the tests.
 *
 * ── AN ABSENT ROOT IS AN ERROR, NEVER AN EMPTY BUNDLE ────────────────────
 * A loader that answers "zero files, nothing to complain about" makes every
 * downstream check green against nothing. `content-fixtures` with a typo in
 * its name would then PASS. So a missing root, a root that is not a directory
 * and a root with no file each raise `ContentError`, and the tests prove all
 * three by doing them.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import { contentHash } from './manifest.js';
import type { ContentBundle, ContentFiles } from './validate.js';
import { ContentError, validateContent } from './validate.js';

const sha256 = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

const toPosix = (path: string): string => path.split(sep).join(posix.sep);

/**
 * Every file under `root`, keyed by its root-relative path.
 *
 * EVERY file, not every `.json`: a stray `.yaml` or a leftover `.md` under
 * `moves/` is reported by pass 1 rather than skipped in silence.
 */
export function readContentFiles(root: string): ContentFiles {
  const files = new Map<string, string>();

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.set(toPosix(relative(root, full)), readFileSync(full, 'utf8'));
    }
  };

  walk(root);
  return files;
}

/** 03-donnees.md section 4.8. Throws `ContentError`; the caller prints and exits 1. */
export function loadContent(root = 'content'): ContentBundle {
  let stats;
  try {
    stats = statSync(root);
  } catch {
    throw new ContentError(
      [
        {
          file: '.',
          path: '',
          message: `racine de contenu introuvable : aucun répertoire « ${root} »`,
          pass: 1,
        },
      ],
      root,
    );
  }

  if (!stats.isDirectory()) {
    throw new ContentError(
      [{ file: '.', path: '', message: `« ${root} » n'est pas un répertoire`, pass: 1 }],
      root,
    );
  }

  const files = readContentFiles(root);
  if (files.size === 0) {
    throw new ContentError(
      [
        {
          file: '.',
          path: '',
          message: `racine de contenu vide : « ${root} » ne contient aucun fichier`,
          pass: 1,
        },
      ],
      root,
    );
  }

  return validateContent(files, { root, hash: contentHash(files, sha256) });
}
