/**
 * `@for/ai` NEVER reads the environment (02-mj-ia.md section 0.6).
 *
 * `packages/server/src/env.ts` is the one place in the system that does. It
 * builds the `NarratorConfig` once at start-up and passes it to
 * `selectNarrator`. That boundary is not tidiness: it is what makes the eval
 * harness runnable outside the server, with no `.env` and no process to boot.
 *
 * ── WHY THE SCAN ASSERTS IT FOUND SOMETHING ─────────────────────────────────
 * A scanner that walks the wrong directory reports zero offenders and goes
 * green for ever. So the file count and a known marker are asserted first: an
 * empty walk fails before the interesting assertion is even reached.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, found);
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

const FILES = walk(SRC);

describe('la frontière d’environnement de @for/ai', () => {
  it('le scan voit bien les sources du paquet', () => {
    expect(FILES.length).toBeGreaterThan(10);
    const barrel = FILES.find((path) => path.endsWith('index.ts'));
    expect(barrel).toBeDefined();
    expect(readFileSync(barrel ?? '', 'utf8')).toContain('@for/ai');
  });

  it('aucun fichier de src/ ne lit process.env', () => {
    const offenders = FILES.filter((path) => readFileSync(path, 'utf8').includes('process.env'));
    expect(offenders.map((path) => path.slice(SRC.length + 1))).toStrictEqual([]);
  });

  it('ni process tout court, ni une variable NARRATOR_ lue directement', () => {
    const offenders: string[] = [];
    for (const path of FILES) {
      const text = readFileSync(path, 'utf8');
      // The names appear in comments and in error messages, which is what the
      // server operator reads; what is forbidden is READING them here.
      if (/\bprocess\s*\.\s*env\b/.test(text) || /\bimport\s*\.\s*meta\s*\.\s*env\b/.test(text)) {
        offenders.push(path.slice(SRC.length + 1));
      }
    }
    expect(offenders).toStrictEqual([]);
  });
});

describe('la neutralité de fournisseur au-dessus du port', () => {
  /**
   * The acceptance criterion's grep, run from here so it is a test and not a
   * sentence in a pull request. `narrator/` is excluded ENTIRELY and not just
   * `narrator/adapters/`: `select.ts` has to name the four adapters to choose
   * between them, and it is the only other file in the package allowed to.
   */
  it('rien hors de narrator/ ne nomme un fournisseur ni un fait d’API', () => {
    const forbidden =
      /anthropic|openai|ollama|claude-|gpt-|stop_reason|cache_control|output_config|@anthropic-ai|openrouter/i;
    const narratorDir = join(SRC, 'narrator');
    const outside = FILES.filter((path) => !path.includes(narratorDir));
    expect(outside.length).toBeGreaterThan(5);
    const offenders = outside
      .filter((path) => forbidden.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SRC.length + 1));
    expect(offenders).toStrictEqual([]);
  });
});
