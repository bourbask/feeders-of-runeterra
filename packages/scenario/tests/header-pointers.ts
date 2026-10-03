/**
 * « Une promesse nomme le test qui la tient » — RENDUE EXÉCUTABLE.
 *
 * `CLAUDE.md` demande qu'un en-tête qui affirme une propriété nomme le test
 * qui la tient. Rien ne vérifiait que ce nom existe encore : un fichier de
 * test renommé, un titre reformulé, et le pointeur envoie dans le vide sans
 * qu'aucune commande ne s'en aperçoive. Un pointeur faux est pire qu'une
 * absence — le lecteur suivant fait confiance et ne vérifie pas.
 *
 * ── LA CONVENTION QUE CE MODULE LIT ──────────────────────────────────────
 * Dans UN MÊME BLOC DE COMMENTAIRE :
 *   1. le fichier de test se cite entre accents graves, chemin compris —
 *      `tests/steps.test.ts`, ou `packages/contracts/tests/x.test.ts` pour un
 *      autre paquet ;
 *   2. les titres se citent entre guillemets français APRÈS lui.
 * Chaque titre doit se retrouver, mot pour mot, dans l'un des fichiers cités
 * par son bloc.
 *
 * ── CE QUE CE MODULE NE VÉRIFIE PAS, ET POURQUOI ─────────────────────────
 * Un bloc qui ne cite AUCUN fichier de test n'est pas vérifié : ses
 * guillemets ne désignent alors pas un titre mais un exemple — `labels.ts`
 * écrit « horloge à 6 segments », qui n'est le nom d'aucun test. Le bloc est
 * donc l'unité, et la règle se dit en une ligne : cite le fichier dans le
 * bloc où tu cites le titre.
 *
 * Un guillemet de moins de douze signes est un mot à l'intérieur d'un titre
 * — « figure », « situation » —, pas un titre : il est compté à part et
 * ignoré.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Titles shorter than this are words inside a title, not titles. */
const MIN_TITLE_LENGTH = 12;

/**
 * Apostrophes, guillemets and line breaks normalised away.
 *
 * A comment wraps a title over three lines with ` * ` in front of each; the
 * test file writes it on one. Without this, every long title would be
 * reported missing and the check would be useless rather than wrong.
 */
export function normalise(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/[«»]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The comment blocks of a source file: each `/* … *\/`, and each run of
 * consecutive `//` lines.
 *
 * Returned as plain text, one string per block, so a title wrapped over
 * several lines is found and a quote in the NEXT block is not attributed to
 * this one.
 */
export function commentBlocks(source: string): readonly string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inBlock = false;
  const flush = (): void => {
    if (current.length > 0) blocks.push(current.join(' '));
    current = [];
  };
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!inBlock && line.startsWith('/*')) {
      flush();
      inBlock = true;
    }
    if (inBlock) {
      current.push(
        line
          .replace(/^\/\*+/, '')
          .replace(/\*+\/$/, '')
          .replace(/^\*+/, '')
          .trim(),
      );
      if (line.includes('*/')) {
        inBlock = false;
        flush();
      }
      continue;
    }
    if (line.startsWith('//')) {
      current.push(line.replace(/^\/\/+/, '').trim());
      continue;
    }
    flush();
  }
  flush();
  return blocks;
}

export interface PointerReport {
  /** Comment blocks that cite at least one `*.test.ts`. */
  readonly blocks: number;
  readonly fileRefs: number;
  readonly titles: number;
  /** Quotes too short to be a title, counted and not checked. */
  readonly skippedQuotes: number;
  readonly issues: readonly string[];
}

/** How a reference resolves to the text of the file it names, or `undefined`. */
export type ReadRef = (ref: string) => string | undefined;

/** One source file against one resolver. The whole rule lives here. */
export function checkSource(label: string, source: string, read: ReadRef): PointerReport {
  let blocks = 0;
  let fileRefs = 0;
  let titles = 0;
  let skippedQuotes = 0;
  const issues: string[] = [];

  for (const block of commentBlocks(source)) {
    const refs = [...block.matchAll(/`([^`]*?\.test\.ts)`/g)].map((match) => match[1] ?? '');
    if (refs.length === 0) continue;
    blocks += 1;
    fileRefs += refs.length;

    const bodies: { readonly ref: string; readonly body: string }[] = [];
    for (const ref of refs) {
      const body = read(ref);
      if (body === undefined) {
        issues.push(`${label} : fichier introuvable — \`${ref}\``);
        continue;
      }
      bodies.push({ ref, body: normalise(body) });
    }
    // Aucun fichier cité n'a pu être lu : le signaler une fois suffit, et
    // chercher les titres dans rien les signalerait tous une seconde fois.
    if (bodies.length === 0) continue;

    // Only the quotes that come AFTER the first reference of the block: a
    // sentence written before it is prose, not a pointer.
    const firstRef = block.indexOf('`');
    for (const match of block.slice(firstRef).matchAll(/«([^»]*)»/g)) {
      const quote = normalise(match[1] ?? '');
      if (quote.length < MIN_TITLE_LENGTH) {
        skippedQuotes += 1;
        continue;
      }
      titles += 1;
      // `%s` marks a parameterised title: only the tail is literal.
      const probe = quote.includes('%s') ? normalise(quote.split('%s').slice(-1).join('')) : quote;
      if (bodies.some((candidate) => candidate.body.includes(probe))) continue;
      issues.push(`${label} : titre introuvable dans [${refs.join(', ')}] — « ${quote} »`);
    }
  }

  return { blocks, fileRefs, titles, skippedQuotes, issues };
}

/**
 * Every non-test `*.ts` of a package's `src/`, against the real file system.
 *
 * `repoRoot` is what a `packages/…` reference resolves against; anything else
 * resolves inside `packageDir`.
 */
export function checkPackageHeaders(repoRoot: string, packageDir: string): PointerReport {
  const srcDir = join(packageDir, 'src');
  const read: ReadRef = (ref) => {
    const path = ref.startsWith('packages/') ? join(repoRoot, ref) : join(packageDir, ref);
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  };

  let total: PointerReport = { blocks: 0, fileRefs: 0, titles: 0, skippedQuotes: 0, issues: [] };
  const files = readdirSync(srcDir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
  for (const name of files) {
    const one = checkSource(`src/${name}`, readFileSync(join(srcDir, name), 'utf8'), read);
    total = {
      blocks: total.blocks + one.blocks,
      fileRefs: total.fileRefs + one.fileRefs,
      titles: total.titles + one.titles,
      skippedQuotes: total.skippedQuotes + one.skippedQuotes,
      issues: [...total.issues, ...one.issues],
    };
  }
  return total;
}
