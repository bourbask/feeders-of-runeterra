/**
 * `pnpm content:check` — the four passes of 03-donnees.md section 4.8, as a
 * command. Exit 0 when the bundle is loadable, exit 1 on the first run that
 * finds anything, with every error reported at once.
 *
 * WHY IT LIVES IN `scripts/` AND NOT IN `packages/content/src/`. The shared
 * ESLint configuration makes `no-console` an error over
 * `packages/content/**` — the content package serves data, it does not write
 * to a terminal. So the loader BUILDS the report as a string (`ContentError`)
 * and this script is what prints it. Declared in the PR: `scripts/` is beyond
 * M0-14's "Fichiers touchés" list, which names only the generator.
 *
 * `--root <dir>`  the content root (default `content`)
 * `--verbose`     adds the pass number that found each error
 */

import process from 'node:process';

import { loadContent } from '../packages/content/src/load.js';
import { ContentError } from '../packages/content/src/validate.js';

const argv = process.argv.slice(2);
const rootIndex = argv.indexOf('--root');
const root = rootIndex === -1 ? 'content' : (argv[rootIndex + 1] ?? 'content');
const verbose = argv.includes('--verbose');

try {
  const bundle = loadContent(root);
  const counted = [
    `${String(bundle.moves.size)} mouvements`,
    `${String(bundle.champions.size)} fiches`,
    `${String(bundle.championIndex.size)} entrées d'annuaire`,
    `${String(bundle.regions.size)} régions`,
    `${String(bundle.oracles.size + 1)} oracles`,
    `${String(bundle.assets.size)} atouts`,
    `${String(bundle.conditions.size)} conditions`,
    `${String(bundle.truths.length)} vérités`,
  ].join(' · ');

  console.log(
    `content:check — « ${root} » valide en quatre passes : ${counted}\n` +
      `  version ${bundle.version} · règles v${String(bundle.rulesVersion)} · hash ${bundle.hash.slice(0, 12)}`,
  );

  // Said out loud rather than implied: these paths exist under the root and NO
  // schema validates them. `fallbacks/narration.json` has no shape in
  // `@for/contracts` and no field in `ContentBundle` (section 4.8).
  if (bundle.unvalidated.length > 0) {
    console.log(`  non validé (aucun schéma, voir la PR) : ${bundle.unvalidated.join(', ')}`);
  }
} catch (error) {
  if (!(error instanceof ContentError)) throw error;
  console.error(`\n${error.format(verbose)}\n`);
  process.exit(1);
}
