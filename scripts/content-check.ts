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

  // ADR 0012 — the six scenario families. S-01 left this line to S-03 on
  // purpose: printing « 0 périodes · 0 fronts » while the directories did not
  // exist would have been six numbers nobody could act on. They are printed on
  // a line of their own, and only once at least one of them is loaded, so the
  // summary of a bundle without scenario content stays exactly what it was.
  const scenario = [
    `${String(bundle.periods.size)} périodes`,
    `${String(bundle.fronts.size)} fronts`,
    `${String(bundle.nodes.size)} nœuds`,
    `${String(bundle.figures.size)} figures`,
    `${String(bundle.hooks.size)} ressorts`,
    `${String(bundle.encounters.size)} rencontres`,
  ].join(' · ');
  const scenarioLoaded =
    bundle.periods.size +
      bundle.fronts.size +
      bundle.nodes.size +
      bundle.figures.size +
      bundle.hooks.size +
      bundle.encounters.size >
    0;

  console.log(
    `content:check — « ${root} » valide en quatre passes : ${counted}` +
      (scenarioLoaded ? `\n  scénario : ${scenario}` : '') +
      `\n  version ${bundle.version} · règles v${String(bundle.rulesVersion)} · hash ${bundle.hash.slice(0, 12)}`,
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
