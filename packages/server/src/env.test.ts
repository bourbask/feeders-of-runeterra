/**
 * `zEnv`, and the grep that keeps this file the only door to the environment.
 *
 * NOT IN THE FICHE'S FILE LIST, AND REPORTED AS SUCH. M0-20 has two acceptance
 * criteria that begin "un test vérifie que `zEnv`…" and "un test vérifie qu'un
 * journal…", and its « Fichiers touchés » grants exactly one test file,
 * `tests/http/health.test.ts`. Rule 6 of the découpage says a criterion of
 * that shape only counts when the test file is in the list. Rather than
 * cram environment and logger assertions into the health test, the two go
 * where 01-architecture.md section 3.5 puts unit tests — beside the code —
 * and the gap in the fiche is raised in the PR.
 *
 * THE FOUR PROVIDERS ARE WRITTEN OUT ONE BY ONE. Looping over
 * `PROVIDERS_REQUIRING_BASE_URL` would make emptying that list a way to turn
 * this file green, which is the sixth inert guard-rail this repository has
 * already paid for. Instead the cases are literal, and one assertion compares
 * the set of cases to `NARRATOR_PROVIDER_IDS`: a fifth provider added in
 * `@for/contracts` turns this file red until somebody writes its case.
 */

import { NARRATOR_PROVIDER_IDS } from '@for/contracts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EnvError, narratorConfig, readEnv } from './env.js';

import type { NarratorProviderId } from '@for/contracts';

/** Everything a server needs that has nothing to do with the storyteller. */
function baseVars(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    PUBLIC_URL: 'http://localhost:5173',
    SESSION_SECRET: 'a'.repeat(32),
    DISCORD_CLIENT_ID: 'client-id',
    DISCORD_CLIENT_SECRET: 'client-secret',
    DISCORD_REDIRECT_URI: 'http://localhost:8787/api/auth/discord/callback',
    ...overrides,
  };
}

function failureVariables(vars: Record<string, string>): readonly string[] {
  try {
    readEnv(vars);
  } catch (error) {
    if (error instanceof EnvError) return error.variables;
    throw error;
  }
  throw new Error('la configuration a été acceptée alors qu’elle devait être refusée');
}

describe('les variables de base', () => {
  it('refuse une configuration sans SESSION_SECRET en nommant la variable', () => {
    const vars = baseVars();
    delete vars['SESSION_SECRET'];

    expect(failureVariables(vars)).toContain('SESSION_SECRET');
  });

  it('refuse un SESSION_SECRET de 31 caractères et accepte celui de 32', () => {
    // Both directions, and the two numbers are written here rather than read
    // from the module: a bound compared to the constant it guards always holds.
    expect(failureVariables(baseVars({ SESSION_SECRET: 'a'.repeat(31) }))).toContain(
      'SESSION_SECRET',
    );
    expect(
      readEnv(baseVars({ SESSION_SECRET: 'a'.repeat(32), NARRATOR_PROVIDER: 'stub' }))
        .SESSION_SECRET,
    ).toHaveLength(32);
  });

  it('traite une variable vide comme absente, pas comme une valeur', () => {
    expect(failureVariables(baseVars({ SESSION_SECRET: '' }))).toContain('SESSION_SECRET');
  });
});

describe('la validation conditionnelle du conteur (02-mj-ia.md §0.6)', () => {
  const URL_OK = 'http://localhost:11434/v1';

  it('refuse une configuration sans NARRATOR_PROVIDER en nommant la variable', () => {
    // Section 0.6 marks the row "obligatoire : oui", and the sentence above the
    // table says a missing variable STOPS THE PROCESS by name. `stub` is the
    // single degraded-mode switch of the product: a default here would let a
    // real table boot on the fallback storyteller without a word. Both
    // directions, so putting `.default('stub')` back makes this red.
    expect(failureVariables(baseVars())).toContain('NARRATOR_PROVIDER');
    expect(readEnv(baseVars({ NARRATOR_PROVIDER: 'stub' })).NARRATOR_PROVIDER).toBe('stub');
  });

  it('stub passe sans aucune autre variable NARRATOR_*', () => {
    const env = readEnv(baseVars({ NARRATOR_PROVIDER: 'stub' }));

    expect(env.NARRATOR_PROVIDER).toBe('stub');
    expect(env.NARRATOR_BASE_URL).toBeUndefined();
    expect(env.NARRATOR_API_KEY).toBeUndefined();
  });

  it('anthropic exige une clé et se passe d’une URL', () => {
    expect(failureVariables(baseVars({ NARRATOR_PROVIDER: 'anthropic' }))).toContain(
      'NARRATOR_API_KEY',
    );
    expect(
      readEnv(baseVars({ NARRATOR_PROVIDER: 'anthropic', NARRATOR_API_KEY: 'k' }))
        .NARRATOR_BASE_URL,
    ).toBeUndefined();
  });

  it('openai-compatible sans NARRATOR_BASE_URL échoue en nommant la variable', () => {
    expect(
      failureVariables(baseVars({ NARRATOR_PROVIDER: 'openai-compatible', NARRATOR_API_KEY: 'k' })),
    ).toContain('NARRATOR_BASE_URL');

    expect(
      readEnv(
        baseVars({
          NARRATOR_PROVIDER: 'openai-compatible',
          NARRATOR_API_KEY: 'k',
          NARRATOR_BASE_URL: URL_OK,
        }),
      ).NARRATOR_BASE_URL,
    ).toBe(URL_OK);
  });

  it('ollama passe avec NARRATOR_API_KEY VIDE, et échoue sans NARRATOR_BASE_URL', () => {
    const env = readEnv(
      baseVars({ NARRATOR_PROVIDER: 'ollama', NARRATOR_BASE_URL: URL_OK, NARRATOR_API_KEY: '' }),
    );
    expect(env.NARRATOR_API_KEY).toBeUndefined();
    expect(narratorConfig(env).apiKey).toBeNull();

    expect(failureVariables(baseVars({ NARRATOR_PROVIDER: 'ollama' }))).toContain(
      'NARRATOR_BASE_URL',
    );
  });

  it('les quatre cas ci-dessus couvrent tous les fournisseurs déclarés', () => {
    // The anti-inertia clause. These four names are typed out above, one test
    // each; if `@for/contracts` gains a fifth provider this comparison fails
    // and somebody has to decide what that provider requires.
    const covered: readonly NarratorProviderId[] = [
      'stub',
      'anthropic',
      'openai-compatible',
      'ollama',
    ];
    expect([...covered].sort()).toEqual([...NARRATOR_PROVIDER_IDS].sort());
  });
});

describe('les trois variables d’appoint (P19)', () => {
  it('reçoivent leurs valeurs par défaut, jamais undefined', () => {
    const env = readEnv(baseVars({ NARRATOR_PROVIDER: 'stub' }));

    expect(env.NARRATOR_TOOLS).toBe('probe');
    expect(env.NARRATOR_TIMEOUT_MS).toBe(60_000);
    expect(env.NARRATOR_CONTEXT_WINDOW).toBeNull();
  });

  it('arrivent telles quelles dans le NarratorConfig que lit buildNarrator', () => {
    // `buildNarrator` reads all three unconditionally (01-architecture.md
    // §2.8). An `undefined` reaching it would be a silent configuration bug,
    // so the assertion is on the built config, not on the parsed environment.
    const config = narratorConfig(readEnv(baseVars({ NARRATOR_PROVIDER: 'stub' })));

    expect(config.tools).toBe('probe');
    expect(config.timeoutMs).toBe(60_000);
    expect(config.contextWindowTokens).toBeNull();
    expect(Object.values(config).some((value) => value === undefined)).toBe(false);
  });

  it('sont surchargeables', () => {
    const env = readEnv(
      baseVars({
        NARRATOR_PROVIDER: 'stub',
        NARRATOR_TOOLS: 'off',
        NARRATOR_TIMEOUT_MS: '900000',
        NARRATOR_CONTEXT_WINDOW: '8192',
      }),
    );

    expect(narratorConfig(env)).toMatchObject({
      tools: 'off',
      timeoutMs: 900_000,
      contextWindowTokens: 8192,
    });
  });
});

describe('une seule porte vers l’environnement', () => {
  /** Built by concatenation so this file is not itself a hit for the grep. */
  const NEEDLE = ['process', 'env'].join('.');

  function sourceFiles(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });
  }

  it("n'apparaît que dans src/env.ts", () => {
    // The same measurement as the fiche's grep over `packages/server/src`,
    // minus `src/env.ts`, except that this one runs on every `pnpm test`
    // instead of once, the day somebody remembers to type it.
    const root = fileURLToPath(new URL('.', import.meta.url));
    const guilty = sourceFiles(root)
      .filter((path) => readFileSync(path, 'utf8').includes(NEEDLE))
      .map((path) => path.slice(root.length));

    expect(guilty).toEqual(['env.ts']);
  });
});
