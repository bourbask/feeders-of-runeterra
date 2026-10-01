import { CONTEUR_SYSTEM_PROMPT, HARD_ASSERTIONS } from '@for/ai';
import { NarratorError } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { loadProbeCases } from './cases.js';
import { PREMISES } from './grading.js';
import {
  PROBE_CASES_MIN,
  SAMPLES_PER_CASE,
  buildConfig,
  buildTurn,
  main,
  measureProvider,
  requestText,
  unknownRuleIds,
} from './run-probe.js';

import type { Assertion, selectNarrator } from '@for/ai';
import type {
  NarrateEvent,
  NarrateRequest,
  NarratorCapabilities,
  NarratorConfig,
  NarratorPort,
} from '@for/contracts';
import type { ProbeCliIo } from './run-probe.js';

const cases = loadProbeCases();

const capabilities = (over: Partial<NarratorCapabilities> = {}): NarratorCapabilities => ({
  streaming: true,
  tools: false,
  structuredOutput: true,
  promptCache: false,
  contextWindowTokens: 8192,
  maxCacheBreakpoints: 0,
  ...over,
});

interface FakeOptions {
  /** One text per call, consumed in order; the last one repeats. */
  readonly texts?: readonly string[];
  readonly failAt?: number;
  readonly finish?: 'complete' | 'truncated';
  readonly seen?: NarrateRequest[];
  readonly capabilities?: NarratorCapabilities;
}

/** A port whose `narrer` takes the single parameter the real one takes. */
function fakePort(options: FakeOptions = {}): NarratorPort {
  let call = 0;
  return {
    providerId: 'ollama',
    capabilities: options.capabilities ?? capabilities(),
    narrer(req: NarrateRequest): AsyncIterable<NarrateEvent> {
      const index = call;
      call += 1;
      options.seen?.push(req);
      return (async function* stream(): AsyncGenerator<NarrateEvent> {
        await Promise.resolve();
        if (options.failAt === index) {
          throw new NarratorError({ code: 'timeout', providerId: 'ollama', message: 'trop lent' });
        }
        const texts = options.texts ?? ['Tu passes. La corde tient. Ulrun se lève.'];
        yield {
          type: 'end',
          result: {
            text: texts[Math.min(index, texts.length - 1)] ?? '',
            finish: options.finish ?? 'complete',
            toolCalls: [],
            usage: {
              inputTokens: 4200,
              outputTokens: 80,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            providerModel: 'modele-x',
            latencyMs: 1200,
          },
        };
      })();
    },
    structurer: () => Promise.reject(new Error('pas utilisé ici')),
  };
}

/** Collects the lines, and keeps the arrays reachable. */
function recordingIo(): {
  readonly io: ProbeCliIo;
  readonly out: string[];
  readonly err: string[];
  readonly written: Map<string, string>;
} {
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  return {
    io: {
      out: (line) => {
        out.push(line);
      },
      err: (line) => {
        err.push(line);
      },
      write: (path, body) => {
        written.set(path, body);
      },
    },
    out,
    err,
    written,
  };
}

describe('la requête que la sonde envoie', () => {
  it('est celle de la production : le prompt système à l’octet près, en system[0]', () => {
    const built = buildTurn(cases[0]!, 0, 8192);
    expect(built.request.system[0]?.text).toBe(CONTEUR_SYSTEM_PROMPT);
    expect(built.request.system[0]?.cacheHint).toBe('stable');
    // ADR 0011, prose-only: not a tool, and not a tool NAME anywhere.
    expect(built.request.tools).toEqual([]);
    expect(built.request.toolPolicy).toBe('none');
    expect(requestText(built.request)).not.toContain('check_name_allowed');
  });

  it('porte le bloc de campagne, le fait, l’intention et la scène', () => {
    const bytes = requestText(buildTurn(cases[0]!, 0, 8192).request);
    for (const marker of [
      '# Campagne :',
      '<fait>',
      '<intention>',
      '<scene>',
      '<consignes_du_tour>',
    ]) {
      expect(bytes).toContain(marker);
    }
  });

  it('passe l’échelle de troncature réelle : une fenêtre étroite coupe, une large ne coupe pas', () => {
    const wide = buildTurn(cases[0]!, 0, 32_000);
    const narrow = buildTurn(cases[0]!, 0, 4096);
    expect(wide.trim.trimLevel).toBe(0);
    expect(narrow.trim.trimLevel).toBeGreaterThan(0);
  });
});

describe('la mesure d’un fournisseur', () => {
  it('le taux se calcule sur les échantillons applicables, pas sur tous', async () => {
    const measured = await measureProvider({
      port: fakePort(),
      cases,
      label: 'faux',
      toolProbe: { ran: false, toolCallSeen: false, detail: 'test' },
      samplesPerCase: 1,
    });
    const block = measured.rates.find((rate) => rate.id === 'scene_block_consistent');
    // No `<scene_apres>` in the answer: never applicable, and therefore no rate.
    expect(block?.applicable).toBe(0);
    expect(block?.rate).toBeNull();
    expect(block?.notApplicable).toBe(cases.length);
    const price = measured.rates.find((rate) => rate.id === 'price_respected');
    // Exactly one case of the corpus carries an imposed price.
    expect(price?.applicable).toBe(1);
  });

  it('un appel en échec est compté, nommé, et jamais noté', async () => {
    const measured = await measureProvider({
      port: fakePort({ failAt: 0 }),
      cases,
      label: 'faux',
      toolProbe: { ran: false, toolCallSeen: false, detail: 'test' },
      samplesPerCase: 1,
    });
    expect(measured.calls).toBe(cases.length);
    expect(measured.answered).toBe(cases.length - 1);
    expect(measured.failures).toHaveLength(1);
    expect(measured.failures[0]?.code).toBe('timeout');
    const digits = measured.rates.find((rate) => rate.id === 'no_digits');
    // The failed call is NOT a free pass: five answers, five judgements.
    expect(digits?.applicable).toBe(cases.length - 1);
  });

  it('une règle qui tombe sur un échantillon et passe sur l’autre donne un taux intermédiaire', async () => {
    const good = 'Tu passes. La corde tient. Ulrun se lève.';
    const bad = 'Tu passes. 3 pas, et la corde tient. Ulrun se lève.';
    const measured = await measureProvider({
      port: fakePort({ texts: [good, bad] }),
      cases,
      label: 'faux',
      toolProbe: { ran: false, toolCallSeen: false, detail: 'test' },
      samplesPerCase: 2,
    });
    const digits = measured.rates.find((rate) => rate.id === 'no_digits');
    expect(digits?.applicable).toBe(cases.length * 2);
    expect(digits?.passed).toBe(1);
    expect(digits?.failed).toBe(cases.length * 2 - 1);
    expect(digits?.firstFailure).not.toBe('');
  });

  it('compare l’estimateur local au compteur du fournisseur', async () => {
    const measured = await measureProvider({
      port: fakePort(),
      cases,
      label: 'faux',
      toolProbe: { ran: false, toolCallSeen: false, detail: 'test' },
      samplesPerCase: 1,
    });
    expect(measured.tokens.measuredInput).toBe(4200);
    expect(measured.tokens.estimatedInput).toBeGreaterThan(0);
    expect(measured.tokens.driftPct).toBeCloseTo(
      ((measured.tokens.estimatedInput - 4200) / 4200) * 100,
      6,
    );
    expect(measured.tokens.charsPerToken).toBeGreaterThan(0);
  });
});

describe('la commande', () => {
  const stubArgs = ['--provider=stub', '--out=rapport.json'];

  it('sort en 0 sur le stub, sans clé, sans réseau, et écrit le rapport', async () => {
    const { io: sink, out, written } = recordingIo();
    const code = await main(stubArgs, {}, sink);
    expect(code).toBe(0);
    expect(written.has('rapport.json')).toBe(true);
    expect(out.join('\n')).toContain('taux par (fournisseur, assertion)');
  });

  it('sort en 1 et nomme la variable manquante, sans trace de pile', async () => {
    const { io: sink, err } = recordingIo();
    const code = await main(['--provider=openai-compatible'], {}, sink);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('NARRATOR_API_KEY');
    expect(err.join('\n')).toContain('NARRATOR_BASE_URL');
    expect(err.join('\n')).not.toContain('    at ');
  });

  it('un identifiant absent de @for/ai fait sortir en 1', async () => {
    const invented: Assertion = {
      id: 'ma_propre_regle',
      hard: true,
      run: () => ({ id: 'ma_propre_regle', passed: true, detail: '' }),
    };
    const { io: sink, err } = recordingIo();
    const code = await main(stubArgs, {}, sink, { rules: [...HARD_ASSERTIONS, invented] });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('ma_propre_regle');
    expect(unknownRuleIds(HARD_ASSERTIONS)).toEqual([]);
  });

  it('une prémisse manquante fait sortir en 1', async () => {
    const known = HARD_ASSERTIONS.find((rule) => rule.id === 'no_digits')!;
    const renamed: Assertion = { ...known, id: 'mentions_any' };
    const { io: sink, err } = recordingIo();
    // `mentions_any` IS in `ASSERTIONS` but is not a hard rule, so no premise
    // was declared for it: the probe stops rather than scoring blind.
    const code = await main(stubArgs, {}, sink, { rules: [renamed] });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('mentions_any');
    expect('mentions_any' in PREMISES).toBe(false);
  });

  it('un corpus plus court que le plancher de la fiche fait sortir en 1', async () => {
    const { io: sink, err } = recordingIo();
    const code = await main(stubArgs, {}, sink, { cases: cases.slice(0, PROBE_CASES_MIN - 1) });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('corpus trop court');
  });

  it('le double du sélecteur reçoit tout ce que le vrai reçoit', async () => {
    const seen: { config: NarratorConfig; deps: unknown }[] = [];
    /**
     * TYPED `typeof selectNarrator` AND NOT REWRITTEN: a `(config) =>
     * NarratorPort` would compile and the second argument would stop existing
     * for the whole suite (mode 8 of `docs/RECETTE.md`).
     */
    const selectPort: typeof selectNarrator = (config, deps = {}) => {
      seen.push({ config, deps });
      return fakePort();
    };
    const { io: sink } = recordingIo();
    const code = await main(
      ['--provider=ollama', '--model=m', '--base-url=http://x', '--out=r.json'],
      {},
      sink,
      {
        selectPort,
        toolProbe: () => Promise.resolve({ ran: false, toolCallSeen: false, detail: 'coupée' }),
      },
    );
    expect(code).toBe(0);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.config.model).toBe('m');
    expect(seen[0]?.config.baseUrl).toBe('http://x');
  });

  it('sonde les outils sur un port forcé à tools: on, jamais sur le port de mesure', async () => {
    const modes: string[] = [];
    const selectPort: typeof selectNarrator = (config, deps = {}) => {
      modes.push(`${config.tools}${Object.keys(deps).length === 0 ? '' : '+deps'}`);
      return fakePort();
    };
    const { io: sink } = recordingIo();
    const code = await main(
      ['--provider=ollama', '--model=m', '--base-url=http://x', '--out=r.json'],
      {},
      sink,
      {
        selectPort,
        toolProbe: () => Promise.resolve({ ran: true, toolCallSeen: false, detail: 'mesuré' }),
      },
    );
    expect(code).toBe(0);
    // Two ports: the measuring one in production's mode, the probing one forced.
    expect(modes).toEqual(['off', 'on']);
  });

  it('--no-tool-probe n’ouvre pas de seconde socket', async () => {
    const modes: string[] = [];
    const selectPort: typeof selectNarrator = (config, deps = {}) => {
      modes.push(`${config.tools}${Object.keys(deps).length === 0 ? '' : '+deps'}`);
      return fakePort();
    };
    const { io: sink } = recordingIo();
    const code = await main(
      ['--provider=ollama', '--model=m', '--base-url=http://x', '--out=r.json', '--no-tool-probe'],
      {},
      sink,
      { selectPort, toolProbe: () => Promise.reject(new Error('ne doit pas être appelée')) },
    );
    expect(code).toBe(0);
    expect(modes).toEqual(['off']);
  });

  it('refuse de fusionner un rapport mesuré sur un autre corpus', async () => {
    const { io: first, written } = recordingIo();
    expect(await main(stubArgs, {}, first)).toBe(0);
    const body = JSON.parse(written.get('rapport.json')!) as {
      caseIds: string[];
      [key: string]: unknown;
    };

    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'for-m031-merge-'));
    const same = path.join(dir, 'same.json');
    const other = path.join(dir, 'other.json');
    fs.writeFileSync(same, JSON.stringify(body), 'utf8');
    fs.writeFileSync(other, JSON.stringify({ ...body, caseIds: ['autre'] }), 'utf8');

    const { io: ok } = recordingIo();
    expect(await main([...stubArgs, `--merge=${same}`], {}, ok)).toBe(0);

    const { io: ko, err } = recordingIo();
    expect(await main([...stubArgs, `--merge=${other}`], {}, ko)).toBe(1);
    expect(err.join('\n')).toContain('autre corpus');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('la configuration lit NARRATOR_TIMEOUT_MS et retombe sur le défaut si elle est illisible', () => {
    expect(buildConfig('stub', { NARRATOR_TIMEOUT_MS: '1234' }).timeoutMs).toBe(1234);
    expect(buildConfig('stub', { NARRATOR_TIMEOUT_MS: 'zéro' }).timeoutMs).toBe(900_000);
  });

  it('n’accepte aucune clé sur la ligne de commande : le dépôt est public', async () => {
    const { io: sink, err } = recordingIo();
    const code = await main(
      [
        '--provider=openai-compatible',
        '--api-key=ceci-serait-une-cle',
        '--model=m',
        '--base-url=http://x',
      ],
      {},
      sink,
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('NARRATOR_API_KEY');
  });

  it('sans --provider, sort en 1 et dit ce qui est attendu', async () => {
    const { io: sink, err } = recordingIo();
    expect(await main([], {}, sink)).toBe(1);
    expect(err.join('\n')).toContain('--provider=');
  });

  it('un fournisseur inconnu est nommé, et la liste des quatre est donnée', async () => {
    const { io: sink, err } = recordingIo();
    expect(await main(['--provider=groq'], {}, sink)).toBe(1);
    expect(err.join('\n')).toContain('fournisseur inconnu « groq »');
    expect(err.join('\n')).toContain('openai-compatible');
  });

  it('un rapport à fusionner illisible est nommé, pas une pile', async () => {
    const { io: sink, err } = recordingIo();
    expect(await main([...stubArgs, '--merge=/nulle/part/rapport.json'], {}, sink)).toBe(1);
    expect(err.join('\n')).toContain('illisible');
    expect(err.join('\n')).not.toContain('    at ');
  });

  it('une NarratorError qui remonte du sélecteur sort en 1 en nommant le fournisseur', async () => {
    const selectPort: typeof selectNarrator = (config, deps = {}) => {
      if (Object.keys(deps).length >= 0)
        throw new NarratorError({
          code: 'bad_request',
          providerId: config.provider,
          message: 'NARRATOR_BASE_URL is required by this provider',
        });
      return fakePort();
    };
    const { io: sink, err } = recordingIo();
    const code = await main(['--provider=ollama', '--model=m', '--base-url=http://x'], {}, sink, {
      selectPort,
    });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('échec fournisseur (ollama)');
    expect(err.join('\n')).toContain('bad_request');
  });

  it('une panne inattendue sort en 1 sans prétendre que c’est un verdict', async () => {
    const selectPort: typeof selectNarrator = (config, deps = {}) => {
      if (config.provider !== 'stub' || Object.keys(deps).length >= 0) {
        throw new TypeError('quelque chose a cassé');
      }
      return fakePort();
    };
    const { io: sink, err } = recordingIo();
    const code = await main(['--provider=ollama', '--model=m', '--base-url=http://x'], {}, sink, {
      selectPort,
    });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('échec inattendu');
  });

  it('une fenêtre trop étroite pour les blocs intouchables est signalée comme un débordement', async () => {
    const measured = await measureProvider({
      port: fakePort({ capabilities: capabilities({ contextWindowTokens: 2048 }) }),
      cases,
      label: 'faux',
      toolProbe: { ran: false, toolCallSeen: false, detail: 'test' },
      samplesPerCase: 1,
    });
    expect(measured.tokens.worstTrimLevel).toBe(8);
    expect(measured.tokens.overflowCases).toEqual(cases.map((probeCase) => probeCase.id));
  });

  it('compte les réponses que le fournisseur a coupées', async () => {
    const measured = await measureProvider({
      port: fakePort({ finish: 'truncated' }),
      cases,
      label: 'faux',
      toolProbe: { ran: false, toolCallSeen: false, detail: 'test' },
      samplesPerCase: 1,
    });
    expect(measured.readingFacts.finishTruncated).toBe(cases.length);
    expect(measured.readingFacts.proseTruncated).toBe(0);
  });

  it('n = 2 échantillons par cas, comme la fiche l’écrit', () => {
    expect(SAMPLES_PER_CASE).toBe(2);
    expect(PROBE_CASES_MIN).toBe(6);
  });
});
