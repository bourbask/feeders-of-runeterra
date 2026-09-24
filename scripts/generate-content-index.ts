/**
 * `pnpm content:index` — regenerates `packages/content/src/generated/`.
 *
 * The content is never read from disk at runtime (01-architecture.md section
 * 2.5). This script turns a content root into a TypeScript module the package
 * imports statically, and CI replays it followed by `git diff --exit-code`.
 *
 * ── WHY THE DATA IS EMBEDDED RATHER THAN `import … with { type: 'json' }` ──
 * Section 2.5 shows JSON import attributes. They cannot work here: the content
 * root lives at the REPOSITORY root, outside `packages/content`, and a
 * composite `tsc -b` project refuses a file outside its `rootDir` (TS6059).
 * Embedding the documents as canonical JSON strings keeps the same property
 * that mattered — nothing is read from disk, ever — and costs one indirection.
 * Reported in the PR as a divergence from the spec, not patched into it.
 *
 * ── WHY CANONICAL JSON AND NOT THE FILE TEXT ─────────────────────────────
 * So that running Prettier over the content root does not change this file.
 * The bundle hash already ignores formatting (`manifest.ts`); the generated
 * module now ignores it too, and `content:index && git diff --exit-code` stops
 * depending on the order of two commands.
 *
 * Exit codes: 0 when the files are written, 1 on invalid content or invalid
 * labels. It VALIDATES BEFORE EMITTING — a generator that happily writes a
 * broken bundle is a green that means nothing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { format, resolveConfig } from 'prettier';

import { loadContent, readContentFiles } from '../packages/content/src/load.js';
import { canonicalJson } from '../packages/content/src/manifest.js';
import type { LabelFile, LabelFileName } from '../packages/content/src/validate.js';
import { ContentError, validateLabels } from '../packages/content/src/validate.js';

const LABEL_FILES: readonly LabelFileName[] = ['attributes', 'gauges', 'outcomes', 'ui'];

interface Options {
  readonly root: string;
  readonly out: string;
  readonly labels: string;
  readonly labelsOut: string;
}

function parseArgs(argv: readonly string[]): Options {
  const flag = (name: string, fallback: string): string => {
    const index = argv.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      console.error(`  --${name} attend une valeur`);
      process.exit(1);
    }
    return value;
  };
  return {
    root: flag('root', 'content'),
    out: flag('out', 'packages/content/src/generated/index.ts'),
    labels: flag('labels', 'packages/content/data/labels'),
    labelsOut: flag('labels-out', 'packages/content/src/generated/labels.ts'),
  };
}

const BANNER = (root: string) =>
  [
    '/* GÉNÉRÉ PAR `pnpm content:index` — NE PAS ÉDITER À LA MAIN.',
    ` * Source : ${root}/ · régénérez avec : pnpm content:index --root ${root}`,
    ' * La CI rejoue le script puis `git diff --exit-code` : une édition manuelle la rougit.',
    ' */',
  ].join('\n');

async function writePretty(path: string, source: string): Promise<void> {
  const config = await resolveConfig(path);
  const pretty = await format(source, { ...config, filepath: path });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, pretty, 'utf8');
}

function readLabels(directory: string): Record<LabelFileName, LabelFile> {
  const labels = {} as Record<LabelFileName, LabelFile>;
  const problems: string[] = [];

  for (const name of LABEL_FILES) {
    const path = join(directory, `${name}.json`);
    if (!existsSync(path)) {
      problems.push(`  → ${path} : fichier de libellés absent`);
      continue;
    }
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      problems.push(`  → ${path} : un fichier de libellés est un objet « clé : texte »`);
      continue;
    }
    const table: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        problems.push(`  → ${path} : « ${key} » n'est pas un texte`);
        continue;
      }
      table[key] = value;
    }
    labels[name] = table;
    for (const problem of validateLabels(name, table)) {
      problems.push(`  → ${problem.file} : ${problem.key} — ${problem.message}`);
    }
  }

  if (problems.length > 0) {
    console.error('\n✖ Libellés d’interface invalides\n');
    for (const problem of problems) console.error(problem);
    console.error('');
    process.exit(1);
  }
  return labels;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  let hash: string;
  try {
    hash = loadContent(options.root).hash;
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    console.error(`\n${error.format()}\n`);
    process.exit(1);
  }

  const files = readContentFiles(options.root);
  const documents = [...files.keys()]
    .sort()
    .map((file) => [file, canonicalJson(JSON.parse(files.get(file) ?? 'null'))] as const);

  const indexSource = [
    BANNER(options.root),
    '',
    `export const GENERATED_FROM = ${JSON.stringify(options.root)};`,
    '',
    `export const GENERATED_HASH = ${JSON.stringify(hash)};`,
    '',
    'export const GENERATED_FILES: Readonly<Record<string, string>> = {',
    ...documents.map(([file, body]) => `  ${JSON.stringify(file)}: ${JSON.stringify(body)},`),
    '};',
    '',
  ].join('\n');

  const labels = readLabels(options.labels);
  const labelsSource = [
    BANNER(options.labels),
    '',
    'export const LABELS = {',
    ...LABEL_FILES.flatMap((name) => [
      `  ${name}: {`,
      ...Object.keys(labels[name])
        .sort()
        .map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(labels[name][key])},`),
      '  },',
    ]),
    '} as const;',
    '',
  ].join('\n');

  await writePretty(options.out, indexSource);
  await writePretty(options.labelsOut, labelsSource);

  console.log(
    `content:index — ${String(documents.length)} fichiers depuis « ${options.root} » ` +
      `(hash ${hash.slice(0, 12)}) → ${options.out}`,
  );
}

await main();
