/**
 * `pnpm sim run | list | record | replay | fuzz`.
 *
 * ── WHAT EACH MODE IS FOR ───────────────────────────────────────────────
 * | mode     | question it answers                                         |
 * |----------|-------------------------------------------------------------|
 * | `run`    | est-ce que ma modification a cassé une partie ?              |
 * | `list`   | quels scénarios existent, et de quelle taille                |
 * | `record` | régénérer un corpus doré, DÉLIBÉRÉMENT                       |
 * | `replay` | rejouer le journal d'une VRAIE base (outil de production)     |
 * | `fuzz`   | une intention valide mais absurde casse-t-elle le serveur ?   |
 *
 * ── `fuzz` IS NOT ON THE PR GATE IN M0, AND THAT IS DELIBERATE ──────────
 * The task sheet says why and it is right: `packages/contracts/tests/
 * envelope-fuzz.test.ts` already covers the dangerous case — the malformed
 * frame — and fuzzing intents against an engine with no game feature buys
 * little for a real instability risk on a gate budgeted at eight minutes. Job
 * 11 of the CI runs `pnpm sim run` and nothing else. The mode exists, runs on
 * demand, and becomes blocking in M1 when there is surface to fuzz.
 *
 * ── `record` REFUSES TO RUN WITHOUT MEANING IT ──────────────────────────
 * It sets `GOLDEN_UPDATE=1` for its own process, because the golden runner
 * refuses any other value and refuses a silent no-op. It then RE-READS the
 * corpora it wrote and runs the comparison again: a corpus that was rewritten
 * and is still wrong is the one failure a rewriting mode can hide.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { GOLDEN_UPDATE_ENV } from '@for/testkit';

import { renderJson, renderList, renderPretty } from './report.js';
import { runAll } from './run.js';
import { loadScenarios } from './scenario.js';

import { fuzz, replayDatabase } from './modes.js';

/** Past this, the suite is refused even if it is green (§7.4). */
export const SIM_SLOW_LIMIT_MS = 60_000;

const USAGE = `pnpm sim <mode> [options]

  run     [--scenario=03] [--seed=…] [--format=pretty|json] [--out=sim-report.json]
          [--bail-on-slow]
  list
  record  [--scenario=03]
  replay  --db=<fichier> [--campaign=<id>]
  fuzz    [--iterations=200] [--seed=m0]
`;

export interface CliFlags {
  readonly mode: string;
  readonly values: ReadonlyMap<string, string>;
  readonly switches: ReadonlySet<string>;
}

/** `--key=value` and `--flag`. No short forms: a script reads better than it types. */
export function parseArgs(argv: readonly string[]): CliFlags {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  let mode = '';
  for (const argument of argv) {
    if (!argument.startsWith('--')) {
      if (mode === '') mode = argument;
      continue;
    }
    const body = argument.slice(2);
    const at = body.indexOf('=');
    if (at === -1) switches.add(body);
    else values.set(body.slice(0, at), body.slice(at + 1));
  }
  return { mode, values, switches };
}

function write(text: string): void {
  process.stdout.write(text);
}

export async function main(argv: readonly string[]): Promise<number> {
  const flags = parseArgs(argv);

  switch (flags.mode) {
    case '':
    case 'help':
    case '--help':
      write(USAGE);
      return flags.mode === '' ? 1 : 0;

    case 'list': {
      write(renderList(loadScenarios()));
      return 0;
    }

    case 'run': {
      const report = await runAll({
        selector: flags.values.get('scenario') ?? null,
        ...(flags.values.has('seed') ? { seed: flags.values.get('seed') ?? '' } : {}),
      });
      write(flags.values.get('format') === 'json' ? renderJson(report) : renderPretty(report));
      // §7.4 step 7 asks for `sim-report.json` BESIDE the readable table. It
      // is a flag rather than a fixed path: a tool that writes a file into
      // whatever directory it was launched from is the ambient-working-
      // directory bug the golden runner refuses, one layer up.
      const out = flags.values.get('out');
      if (out !== undefined) writeFileSync(resolve(out), renderJson(report), 'utf8');
      if (flags.switches.has('bail-on-slow') && report.durationMs > SIM_SLOW_LIMIT_MS) {
        write(
          `la suite a pris ${String(report.durationMs)} ms, au-delà de la garde de ${String(SIM_SLOW_LIMIT_MS)} ms\n`,
        );
        return 1;
      }
      return report.ok ? 0 : 1;
    }

    case 'record': {
      // Set and CLEARED on the process this call owns. `delete` on a computed
      // key is refused by the lint, and the empty string is what
      // `goldenUpdateRequested` reads as "absent" — the one value besides
      // `undefined` it treats that way, which is why it is safe here.
      process.env[GOLDEN_UPDATE_ENV] = '1';
      const rewritten = await runAll({
        selector: flags.values.get('scenario') ?? null,
        record: true,
      });
      process.env[GOLDEN_UPDATE_ENV] = '';
      // THE SECOND PASS IS THE POINT. A rewriting mode that never compares
      // cannot tell "corpus refreshed" from "corpus refreshed and still
      // wrong", and the second is what a reviewer would have to catch by eye.
      const verified = await runAll({ selector: flags.values.get('scenario') ?? null });
      write(renderPretty(verified));
      return rewritten.scenarios.length > 0 && verified.ok ? 0 : 1;
    }

    case 'replay': {
      const file = flags.values.get('db');
      if (file === undefined) {
        write('replay : il manque --db=<fichier>\n');
        return 1;
      }
      const outcome = replayDatabase(file, flags.values.get('campaign') ?? null);
      write(outcome.text);
      return outcome.ok ? 0 : 1;
    }

    case 'fuzz': {
      const iterations = Number(flags.values.get('iterations') ?? '200');
      const seed = flags.values.get('seed') ?? 'm0';
      const outcome = await fuzz({ iterations, seed });
      write(outcome.text);
      return outcome.ok ? 0 : 1;
    }

    default:
      write(`mode inconnu : ${flags.mode}\n${USAGE}`);
      return 1;
  }
}

// THIS FILE IS BOTH AN ENTRY POINT AND A MODULE. `tests/cli.test.ts` imports
// `main` and `parseArgs`; a top-level run there would launch the whole suite
// a second time, inside itself. The comparison is on the resolved path, not
// on a suffix: `endsWith` would match any file whose name ends in `cli.ts`.
const invoked = process.argv[1];
if (invoked !== undefined && fileURLToPath(import.meta.url) === resolve(invoked)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`${detail}\n`);
      process.exitCode = 1;
    });
}
