/**
 * EVERY TEST TITLE QUOTED IN A COMMENT OF `smoke/` NAMES A TEST THAT EXISTS.
 *
 * Why this file exists. Four citations of this package were written from
 * memory and named tests that did not exist — one of them pointed at the wrong
 * file and credited it with the OPPOSITE of what it asserts. A citation is
 * read as a proof by the next person; `CLAUDE.md` says a promise names the
 * test that holds it, and a name nobody can follow is worse than no name.
 *
 * What it walks, and why that matters. The list of citations is READ FROM THE
 * SOURCES, never pinned here: deleting a citation removes a case instead of
 * breaking one, and adding one adds a case. That is also why the count is
 * asserted — an extractor that suddenly matches nothing would otherwise pass
 * on an empty list.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DOSSIER = import.meta.dirname;

/** Both apostrophes are the same character here: sources type `'`, titles `’`. */
const normaliser = (texte: string): string => texte.replaceAll('’', "'").replaceAll(/\s+/gu, ' ');

const fichiers = (suffixe: string, exclure = false): string[] =>
  readdirSync(DOSSIER).filter((nom) =>
    exclure ? nom.endsWith('.ts') && !nom.endsWith('.test.ts') : nom.endsWith(suffixe),
  );

/** Only the body of comments: a `«` inside a template literal is a message, not a citation. */
const commentaires = (source: string): string =>
  normaliser(
    source
      .split('\n')
      .filter((ligne) => /^\s*(\*|\/\/)/u.test(ligne))
      .map((ligne) => ligne.replace(/^\s*(\*\/?|\/\/)/u, ''))
      .join(' '),
  );

const TITRES = normaliser(
  fichiers('.test.ts')
    .map((nom) => readFileSync(join(DOSSIER, nom), 'utf8'))
    .join('\n'),
);

interface Citation {
  readonly fichier: string;
  readonly titre: string;
}

const CITATIONS: Citation[] = fichiers('.ts', true).flatMap((fichier) =>
  [...commentaires(readFileSync(join(DOSSIER, fichier), 'utf8')).matchAll(/«([^»]+)»/gu)].map(
    (trouve) => ({ fichier, titre: (trouve[1] ?? '').trim() }),
  ),
);

describe('les titres de tests cités dans les commentaires', () => {
  it('sont nombreux : l’extracteur trouve bien quelque chose', () => {
    // Mode 6 : si l'extraction cassait, la boucle ci-dessous tournerait à vide
    // et ce fichier deviendrait vert en ne gardant plus rien.
    expect(CITATIONS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(CITATIONS.map((c) => c.fichier)).size).toBeGreaterThanOrEqual(4);
  });

  it.each(CITATIONS)('$fichier cite un test qui existe : « $titre »', ({ titre }) => {
    expect(TITRES).toContain(`'${titre}'`);
  });
});
