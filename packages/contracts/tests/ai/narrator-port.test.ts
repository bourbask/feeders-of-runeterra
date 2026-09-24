/**
 * THE PORT, MEASURED — not asserted in a comment.
 *
 * Four things this file proves, and each one exists because the compiler
 * cannot see it (ADR 0007):
 *
 *   1. `NARRATOR_PROVIDER_IDS` and the SQL `CHECK` on `ai_calls.provider` are
 *      the same four strings in the same order. Two lists in two languages:
 *      nothing but a runtime comparison catches a fifth provider added on one
 *      side. Same for the purposes and the finish reasons.
 *
 *      BOTH SIDES ARE PINNED TO THE LITERAL VALUES, never to each other. The
 *      acceptance criterion NAMES the four providers, so they are written out
 *      in full here (ADR 0007). Comparing the tuple to the `CHECK` alone
 *      tested their COINCIDENCE and never their value: renaming `ollama` into
 *      `llama-cpp` on both sides left 98/98 green, measured.
 *   2. NEUTRALITY. The two `grep` commands of the M0-12 sheet, run as tests so
 *      the CI carries them and not only a reviewer's shell history.
 *   3. `NarratorError.retryable` cannot lie: it is computed from the code, and
 *      there is no constructor parameter that could make `quota_exhausted`
 *      retryable.
 *   4. The three closed lists of invariant 1 hold real event types, and not
 *      one `character.*` or `roll.*` is reachable from a proposal.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GAME_EVENT_TYPES } from '@for/engine';
import { describe, expect, it } from 'vitest';

import {
  isRetryableNarratorErrorCode,
  NARRATE_FINISHES,
  NARRATOR_ERROR_CODES,
  NARRATOR_PROVIDER_IDS,
  NARRATOR_PURPOSES,
  NARRATOR_RETRYABLE_ERROR_CODES,
  NarratorError,
  ORACLE_JOURNAL_ONLY_EVENT_TYPES,
  PROPOSAL_REACHABLE_EVENT_TYPES,
  REFUSAL_REACHABLE_EVENT_TYPES,
} from '../../src/ai/narrator-port.js';

const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));
const EXPECTED_SQL = fileURLToPath(new URL('../../../db/schema.expected.sql', import.meta.url));

/** Every `.ts` under `packages/contracts/src`, as the two greps see it. */
function sourceFiles(dir: string = SRC_DIR): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** The `IN (...)` list of one named SQL CHECK constraint, in written order. */
function checkValues(constraint: string): readonly string[] {
  const sql = readFileSync(EXPECTED_SQL, 'utf8');
  const clause = new RegExp(`CONSTRAINT ${constraint} CHECK\\(.*?IN \\(([^)]*)\\)`).exec(sql);
  expect(clause, `contrainte ${constraint} introuvable dans schema.expected.sql`).not.toBeNull();
  return (clause?.[1] ?? '').split(',').map((value) => value.trim().replaceAll("'", ''));
}

// ─── LES VALEURS DU CRITÈRE, EN TOUTES LETTRES ────────────────────────────
// Aucune de ces trois listes n'est relue depuis le code qu'elle vérifie. Un
// chiffre — ou un nom — qui vient d'un critère d'acceptation s'écrit en
// toutes lettres dans le test ; comparer une liste à celle dont elle dérive
// ne garde que l'ordre (ADR 0007).
const PROVIDERS_PER_SPEC: readonly string[] = ['stub', 'anthropic', 'openai-compatible', 'ollama'];
const PURPOSES_PER_SPEC: readonly string[] = ['narration', 'forge', 'chronicle', 'judge'];
const FINISHES_PER_SPEC: readonly string[] = [
  'complete',
  'truncated',
  'tool_call',
  'refused',
  'aborted',
];
/** Les trois codes que la §7.1 autorise à relancer À L'IDENTIQUE. */
const RETRYABLE_PER_SPEC: readonly string[] = ['rate_limited', 'unavailable', 'timeout'];

describe('le port du conteur — les listes qui doivent coïncider', () => {
  it('NarratorProviderId vaut EXACTEMENT les quatre du critère, et le CHECK aussi', () => {
    expect([...NARRATOR_PROVIDER_IDS]).toStrictEqual(PROVIDERS_PER_SPEC);
    expect(checkValues('ai_calls_provider_enum')).toStrictEqual(PROVIDERS_PER_SPEC);
  });

  it('les quatre usages du port valent le CHECK de ai_calls.purpose', () => {
    expect([...NARRATOR_PURPOSES]).toStrictEqual(PURPOSES_PER_SPEC);
    expect(checkValues('ai_calls_purpose_enum')).toStrictEqual(PURPOSES_PER_SPEC);
  });

  it('NarrateFinish vaut le CHECK de ai_calls.finish_reason', () => {
    expect([...NARRATE_FINISHES]).toStrictEqual(FINISHES_PER_SPEC);
    expect(checkValues('ai_calls_finish_reason_enum')).toStrictEqual(FINISHES_PER_SPEC);
  });
});

describe('neutralité du port (P18)', () => {
  // N1 — les FAITS D'API. Aucune exemption : aucun fichier de `src/` n'a le
  // droit d'en écrire un, pas même le port.
  it('aucun fait d’API dans packages/contracts/src', () => {
    const forbidden = /claude-|gpt-|stop_reason|cache_control|output_config|@anthropic-ai/;
    const offenders = sourceFiles().filter((file) => forbidden.test(readFileSync(file, 'utf8')));
    expect(offenders).toStrictEqual([]);
  });

  // N2 — les NOMS DE FOURNISSEUR, bornés au seul endroit qui a le droit de les
  // écrire : l'union `NarratorProviderId`. Un critère qui les interdirait
  // partout serait faux par construction — le port doit bien nommer ses
  // propres adaptateurs quelque part.
  it('les noms de fournisseur ne vivent que dans narrator-port.ts', () => {
    const vendors = /anthropic|openai|ollama/i;
    const offenders = sourceFiles()
      .filter((file) => vendors.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC_DIR.length));
    expect(offenders).toStrictEqual(['ai/narrator-port.ts']);
  });
});

describe('NarratorError', () => {
  it('retryable est CALCULÉ, pas fourni : les trois codes de la §7.1 et eux seuls', () => {
    // ÉPINGLÉS EN TOUTES LETTRES. La version précédente comparait
    // `NARRATOR_ERROR_CODES.filter(isRetryable)` à la liste DONT `isRetryable`
    // dérive : elle ne mordait que sur l'ORDRE, et ajouter `internal` à
    // `NARRATOR_RETRYABLE_ERROR_CODES` laissait 98/98 verts — mesuré.
    expect([...NARRATOR_RETRYABLE_ERROR_CODES]).toStrictEqual(RETRYABLE_PER_SPEC);
    expect(NARRATOR_ERROR_CODES.filter((code) => isRetryableNarratorErrorCode(code))).toStrictEqual(
      RETRYABLE_PER_SPEC,
    );
    // Et les ONZE autres ne le sont pas, un par un : un code retiré de la
    // liste des quatorze ne doit pas pouvoir éteindre la vérification.
    for (const code of NARRATOR_ERROR_CODES) {
      if (RETRYABLE_PER_SPEC.includes(code)) continue;
      expect(isRetryableNarratorErrorCode(code), `${code} ne doit pas être relançable`).toBe(false);
    }
    expect(NARRATOR_ERROR_CODES).toHaveLength(14);
  });

  it('quota_exhausted n’est jamais relançable, même si l’adaptateur le voulait', () => {
    const error = new NarratorError({ code: 'quota_exhausted', providerId: 'stub' });
    expect(error.retryable).toBe(false);
    // Et il n'existe pas de paramètre qui permettrait de le dire relançable :
    // `NarratorErrorInit` ne porte pas `retryable`. Si quelqu'un l'ajoute, la
    // ligne ci-dessus reste vraie tant que la valeur reste dérivée du code.
    expect(Object.keys(error)).not.toContain('retryableOverride');
  });

  it('rate_limited est relançable et porte son délai', () => {
    const error = new NarratorError({
      code: 'rate_limited',
      providerId: 'stub',
      retryAfterMs: 1200,
    });
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(1200);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NarratorError');
  });

  it('les deux champs facultatifs valent null, jamais undefined', () => {
    const error = new NarratorError({ code: 'internal', providerId: 'stub' });
    expect(error.retryAfterMs).toBeNull();
    expect(error.providerDetail).toBeNull();
    expect(error.message).toBe('internal');
  });

  it('porte un message et une cause quand l’adaptateur en a une', () => {
    const cause = new Error('socket closed');
    const error = new NarratorError({
      code: 'unavailable',
      providerId: 'stub',
      message: 'le conteur ne répond pas',
      providerDetail: 'upstream 0 bytes',
      cause,
    });
    expect(error.message).toBe('le conteur ne répond pas');
    expect(error.cause).toBe(cause);
    expect(error.providerDetail).toBe('upstream 0 bytes');
    expect(error.retryable).toBe(true);
  });

  it('context_too_large n’est pas relançable : la §7.1 réémet une requête DIFFÉRENTE', () => {
    expect(isRetryableNarratorErrorCode('context_too_large')).toBe(false);
  });
});

describe('les trois listes closes de l’invariant 1 (03-donnees.md §0.5)', () => {
  const known = new Set<string>(GAME_EVENT_TYPES);

  it.each([
    ['proposition', PROPOSAL_REACHABLE_EVENT_TYPES],
    ['roll_oracle', ORACLE_JOURNAL_ONLY_EVENT_TYPES],
    ['droit de refus', REFUSAL_REACHABLE_EVENT_TYPES],
  ])('le circuit « %s » ne nomme que des types d’événement réels', (_name, list) => {
    for (const type of list) expect(known.has(type), `${type} n’existe pas`).toBe(true);
  });

  it('aucune proposition du modèle n’atteint character.* ni roll.*', () => {
    // C'est la règle de fermeture de l'invariant 1. P11 est l'avertissement :
    // `time_shift` rendait `character.gauge_changed` atteignable, et la
    // tentation du jour aurait été d'élargir cette liste pour faire passer le
    // test. Une liste close élargie une fois n'est plus close.
    for (const type of PROPOSAL_REACHABLE_EVENT_TYPES) {
      expect(type.startsWith('character.'), `${type} mute un personnage`).toBe(false);
      expect(type.startsWith('roll.'), `${type} tranche un jet`).toBe(false);
    }
  });

  it('les trois circuits sont disjoints', () => {
    const all = [
      ...PROPOSAL_REACHABLE_EVENT_TYPES,
      ...ORACLE_JOURNAL_ONLY_EVENT_TYPES,
      ...REFUSAL_REACHABLE_EVENT_TYPES,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('les tailles sont celles du tableau : 8, 2 et 1', () => {
    expect(PROPOSAL_REACHABLE_EVENT_TYPES).toHaveLength(8);
    expect(ORACLE_JOURNAL_ONLY_EVENT_TYPES).toHaveLength(2);
    expect(REFUSAL_REACHABLE_EVENT_TYPES).toHaveLength(1);
  });
});
