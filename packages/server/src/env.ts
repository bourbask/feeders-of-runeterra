/**
 * THE ONLY FILE IN THE SYSTEM THAT READS THE ENVIRONMENT
 * (01-architecture.md section 9.4, 02-mj-ia.md section 0.6).
 *
 * Two consequences, both load-bearing:
 *
 *   - `@for/ai` stays runnable outside a server, which is what makes the eval
 *     harness possible at all. It receives a `NarratorConfig` built here and
 *     never looks at the process;
 *   - every missing or invalid variable stops the process AT START-UP, naming
 *     the variable. A server that boots with half a configuration fails later,
 *     in front of a player, with a message nobody can act on.
 *
 * `readEnv()` takes its source as an ARGUMENT, defaulted to `process.env`.
 * That is the reason this file is the only occurrence of `process.env` in
 * `packages/server/src`: the tests pass a plain record instead of mutating a
 * global, and `env.test.ts` re-runs that grep so the rule keeps biting after
 * this task is closed.
 *
 * THE EMPTY STRING IS NOT A VALUE. `.env.example` ships `NARRATOR_BASE_URL=`
 * and `NARRATOR_API_KEY=` with nothing after the sign, and a shell hands those
 * over as `''`. Treating them as present would let `NARRATOR_PROVIDER=ollama`
 * boot with an empty base URL and fail on the first call instead of at
 * start-up. Every blank is folded to "absent" before validation.
 */

import process from 'node:process';

import { NARRATOR_PROVIDER_IDS, NARRATOR_TOOLS_MODES } from '@for/contracts';
import { z } from 'zod';

import type { NarratorConfig, NarratorProviderId } from '@for/contracts';

/** `openssl rand -base64 32`. Below this a session cookie is guessable. */
export const SESSION_SECRET_MIN_LENGTH = 32;

/** 01-architecture.md section 3.4. `pino` levels, from loudest to quietest. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

export const NODE_ENVS = ['development', 'test', 'production'] as const;

/**
 * 02-mj-ia.md section 0.6, the two conditional rows of the table, written as
 * data so the message can name the provider that triggered the refusal.
 *
 * These lists are NOT what `env.test.ts` loops over. A list that is its own
 * test fixture proves nothing: emptying it would silence the test instead of
 * breaking it. The test enumerates the four providers literally and checks
 * that its own enumeration still equals `NARRATOR_PROVIDER_IDS`, so a fifth
 * provider turns it red until somebody writes that provider's case.
 */
export const PROVIDERS_REQUIRING_BASE_URL: readonly NarratorProviderId[] = [
  'openai-compatible',
  'ollama',
];

export const PROVIDERS_REQUIRING_API_KEY: readonly NarratorProviderId[] = [
  'anthropic',
  'openai-compatible',
];

/** `''` and `'   '` mean "not set", everywhere. See the header. */
function blankToUndefined(source: Record<string, string | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === undefined || value.trim() === '' ? undefined : value;
  }
  return out;
}

const zEnvFields = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  PUBLIC_URL: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  DATABASE_PATH: z.string().min(1).default('./data/app.db'),

  SESSION_SECRET: z.string().min(SESSION_SECRET_MIN_LENGTH),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_REDIRECT_URI: z.url(),

  // The five base variables of 02-mj-ia.md section 0.6.
  NARRATOR_PROVIDER: z.enum(NARRATOR_PROVIDER_IDS).default('stub'),
  NARRATOR_BASE_URL: z.url().optional(),
  NARRATOR_API_KEY: z.string().min(1).optional(),
  NARRATOR_MODEL: z.string().min(1).optional(),
  NARRATOR_MODEL_STRUCTURED: z.string().min(1).optional(),

  // The three auxiliary variables (P19). THEY CARRY A DEFAULT RATHER THAN
  // BEING OPTIONAL: `buildNarrator` reads all three unconditionally, so an
  // `undefined` reaching it would be a silent configuration bug — which is
  // exactly what the fiche asks this file to make impossible.
  NARRATOR_TOOLS: z.enum(NARRATOR_TOOLS_MODES).default('probe'),
  NARRATOR_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  NARRATOR_CONTEXT_WINDOW: z.coerce.number().int().positive().nullable().default(null),
});

/**
 * The schema the whole server is configured by.
 *
 * The conditional part lives in a `superRefine` rather than in a union of four
 * shapes, so the issue can carry the PATH of the missing variable: a crash
 * that says `NARRATOR_BASE_URL` is actionable, one that says "invalid
 * configuration" is not.
 */
export const zEnv = zEnvFields.superRefine((env, ctx) => {
  if (PROVIDERS_REQUIRING_BASE_URL.includes(env.NARRATOR_PROVIDER)) {
    if (env.NARRATOR_BASE_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['NARRATOR_BASE_URL'],
        message: `NARRATOR_BASE_URL est obligatoire quand NARRATOR_PROVIDER vaut « ${env.NARRATOR_PROVIDER} »`,
      });
    }
  }
  if (PROVIDERS_REQUIRING_API_KEY.includes(env.NARRATOR_PROVIDER)) {
    if (env.NARRATOR_API_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['NARRATOR_API_KEY'],
        message: `NARRATOR_API_KEY est obligatoire quand NARRATOR_PROVIDER vaut « ${env.NARRATOR_PROVIDER} »`,
      });
    }
  }
});

export type Env = z.output<typeof zEnv>;

/**
 * What a failed start-up prints. One line per variable, the variable name
 * first, because that is the only part an operator needs to act.
 */
export class EnvError extends Error {
  constructor(readonly issues: readonly z.core.$ZodIssue[]) {
    super(`Configuration invalide :\n${EnvError.format(issues)}`);
    this.name = 'EnvError';
  }

  static format(issues: readonly z.core.$ZodIssue[]): string {
    return issues
      .map((issue) => {
        const name = issue.path.length > 0 ? issue.path.map(String).join('.') : '(racine)';
        return `  ${name} : ${issue.message}`;
      })
      .join('\n');
  }

  /** The variable names this error is about, for a test that wants to assert. */
  get variables(): readonly string[] {
    return this.issues.map((issue) => issue.path.map(String).join('.'));
  }
}

/**
 * Validates an environment. Throws `EnvError` — `main.ts` turns that into a
 * message on stderr and an exit code of 1.
 */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = zEnv.safeParse(blankToUndefined(source));
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues);
  }
  return parsed.data;
}

/**
 * The port's configuration, built here and nowhere else (section 0.6).
 *
 * `null` rather than `undefined` on every optional field: `NarratorConfig`
 * declares them nullable, and an adapter that had to tell the two apart would
 * be reading the environment by proxy.
 */
export function narratorConfig(env: Env): NarratorConfig {
  return {
    provider: env.NARRATOR_PROVIDER,
    baseUrl: env.NARRATOR_BASE_URL ?? null,
    apiKey: env.NARRATOR_API_KEY ?? null,
    model: env.NARRATOR_MODEL ?? null,
    modelStructured: env.NARRATOR_MODEL_STRUCTURED ?? null,
    tools: env.NARRATOR_TOOLS,
    timeoutMs: env.NARRATOR_TIMEOUT_MS,
    contextWindowTokens: env.NARRATOR_CONTEXT_WINDOW,
  };
}
