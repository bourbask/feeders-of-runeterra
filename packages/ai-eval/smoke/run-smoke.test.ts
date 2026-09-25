/**
 * The criteria of M0-32 are exit codes, so the ones that speak of an exit code
 * are measured by RUNNING THE COMMAND in a child process. A function returning
 * `1` is not an exit code.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import {
  CONTEUR_PROMPT_VERSION,
  CONTEUR_SYSTEM_PROMPT,
  SCENE_BLOCK_ABSENT_HEADER,
  SCENE_BLOCK_NONE,
} from '@for/ai';
import {
  NarratorError,
  type NarrateEvent,
  type NarrateRequest,
  type NarratorCapabilities,
  type NarratorPort,
  type StructureRequest,
  type StructureResult,
} from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { SMOKE_ASSERTIONS } from './assertions.js';
import { loadCases } from './cases.js';
import {
  assertCountWithinBounds,
  buildConfig,
  buildNarrateRequest,
  buildSceneBlock,
  buildUserMessage,
  fingerprint,
  main,
  runSmoke,
  SAMPLES_PER_CASE,
  SMOKE_REQUIRED_ENV,
  SmokeRunError,
} from './run-smoke.js';

const RACINE = join(import.meta.dirname, '..', '..', '..');
const SCRIPT = join(import.meta.dirname, 'run-smoke.ts');

const CAPACITES: NarratorCapabilities = Object.freeze({
  streaming: true,
  tools: false,
  structuredOutput: false,
  promptCache: false,
  contextWindowTokens: 8192,
  maxCacheBreakpoints: 0,
});

/**
 * A double of the WHOLE port, not of a convenient half of it. It records every
 * request it is handed, which is how the tests below prove that `system[0]`
 * reaches the provider rather than merely leaving the builder.
 */
class PortEnregistreur implements NarratorPort {
  readonly providerId = 'ollama' as const;
  readonly capabilities = CAPACITES;
  readonly recues: NarrateRequest[] = [];

  constructor(
    private readonly texte: string,
    private readonly inputTokens = 0,
  ) {}

  narrer(req: NarrateRequest): AsyncIterable<NarrateEvent> {
    this.recues.push(req);
    const texte = this.texte;
    const inputTokens = this.inputTokens;
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<NarrateEvent> {
        await Promise.resolve();
        yield { type: 'delta', text: texte };
        yield {
          type: 'end',
          result: {
            text: texte,
            finish: 'complete',
            toolCalls: [],
            usage: { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            providerModel: 'faux-modele-v1',
            latencyMs: 0,
          },
        };
      },
    };
  }

  structurer<T>(req: StructureRequest<T>): Promise<StructureResult<T>> {
    return Promise.reject(
      new NarratorError({ code: 'unsupported', providerId: 'ollama', message: req.schemaName }),
    );
  }
}

/** A port that cannot be reached, the way an adapter says it (`unavailable`). */
class PortInjoignable implements NarratorPort {
  readonly providerId = 'ollama' as const;
  readonly capabilities = CAPACITES;

  narrer(req: NarrateRequest): AsyncIterable<NarrateEvent> {
    const erreur = new NarratorError({
      code: 'unavailable',
      providerId: 'ollama',
      message: `injoignable pour ${req.requestId}`,
    });
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<NarrateEvent> => ({
        next: () => Promise.reject(erreur),
      }),
    };
  }

  structurer<T>(req: StructureRequest<T>): Promise<StructureResult<T>> {
    return Promise.reject(
      new NarratorError({ code: 'unavailable', providerId: 'ollama', message: req.schemaName }),
    );
  }
}

const BLOC =
  '<scene_apres>{"lieu":"col_des_hurleurs","presents":[{"nom":"Sejuani","etat":"debout"}],"partis":[{"nom":"Keld","cause":"mort"}],"refus":null}</scene_apres>';
const CONFORME = `Tu passes. La corniche cède sous ton pied gauche et la glace t’ouvre la paume. Ulrun ne bouge pas. En contrebas, la neige s’affaisse d’un coup et s’arrête.\n${BLOC}`;

const io = (): {
  out: string[];
  err: string[];
  io: { out: (l: string) => void; err: (l: string) => void };
} => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l) => out.push(l), err: (l) => err.push(l) } };
};

interface Execution {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const lancer = (args: readonly string[], env: Readonly<Record<string, string>> = {}): Execution => {
  // Aucune variable NARRATOR_* de la machine ne doit atteindre l'enfant : le
  // critère « sans clé » se mesure sur un environnement dont on sait qu'il n'en
  // a pas, pas sur celui qui se trouve là.
  const propre: Record<string, string> = {};
  for (const [nom, valeur] of Object.entries(process.env)) {
    if (nom.startsWith('NARRATOR_') || valeur === undefined) continue;
    propre[nom] = valeur;
  }
  const r = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
    cwd: RACINE,
    env: { ...propre, ...env },
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

// ------------------------------------------------ la requête est la vraie

describe('la requête construite', () => {
  it('porte le prompt de production en system[0], à l’octet près', () => {
    const [premier] = loadCases();
    const req = buildNarrateRequest(premier!, 0);
    expect(req.system).toHaveLength(1);
    expect(req.system[0]?.text).toBe(CONTEUR_SYSTEM_PROMPT);
  });

  it('arrive telle quelle jusqu’au port, pas seulement jusqu’au constructeur', async () => {
    const port = new PortEnregistreur(CONFORME);
    await runSmoke({ port, cases: loadCases().slice(0, 1), samplesPerCase: 1 });
    expect(port.recues).toHaveLength(1);
    expect(port.recues[0]?.system[0]?.text).toBe(CONTEUR_SYSTEM_PROMPT);
  });

  it('est en PROSE SEULE : aucun outil, aucune latitude d’appel (ADR 0011)', () => {
    const req = buildNarrateRequest(loadCases()[0]!, 0);
    expect(req.tools).toEqual([]);
    expect(req.toolPolicy).toBe('none');
  });

  it('donne un identifiant de requête déterministe, échantillon par échantillon', () => {
    const cas = loadCases()[0]!;
    expect([buildNarrateRequest(cas, 0).requestId, buildNarrateRequest(cas, 1).requestId]).toEqual([
      'smoke-issue-franche-1',
      'smoke-issue-franche-2',
    ]);
  });

  it('fait voyager la liste verrouillée, surnoms compris, dans les consignes', () => {
    const cas = loadCases()[0]!;
    const message = buildUserMessage(cas);
    for (const champion of cas.lockedChampions) {
      for (const terme of [champion.name, ...champion.aliases]) expect(message).toContain(terme);
    }
  });

  it('porte les quatre blocs du tour et aucun autre', () => {
    const message = buildUserMessage(loadCases()[0]!);
    for (const balise of ['<scene>', '<fait>', '<intention>', '<consignes_du_tour>']) {
      expect(message).toContain(balise);
    }
    for (const absente of ['<etat>', '<lore>', '<chronique>']) {
      expect(message).not.toContain(absente);
    }
  });

  it('rend la liste des partis comme un fait, jamais comme une absence de ligne', () => {
    const message = buildUserMessage(loadCases()[0]!);
    expect(message).toContain('Keld');
    expect(message).toContain('Signy');
  });

  it('écrit « aucun » plutôt que rien quand une liste de scène est vide', () => {
    // § 4.5 point 4 : une absence de ligne se lit comme une absence
    // d'information, une ligne explicite se lit comme un fait.
    const cas = loadCases()[0]!;
    const vide = buildSceneBlock({ ...cas, sceneIn: { ...cas.sceneIn, absent: [] } });
    expect(vide).toContain(`${SCENE_BLOCK_ABSENT_HEADER}\n${SCENE_BLOCK_NONE}`);
  });
});

describe('l’empreinte du prompt', () => {
  it('change dès qu’un caractère du prompt change', () => {
    expect(fingerprint(CONTEUR_SYSTEM_PROMPT)).not.toBe(fingerprint(`${CONTEUR_SYSTEM_PROMPT}x`));
  });

  it('est celle du prompt réellement envoyé, et le rapport porte la version', async () => {
    const port = new PortEnregistreur(CONFORME);
    const sommaire = await runSmoke({ port, cases: loadCases().slice(0, 1), samplesPerCase: 1 });
    expect(sommaire.promptFingerprint).toBe(fingerprint(port.recues[0]?.system[0]?.text ?? ''));
    expect(sommaire.promptVersion).toBe(CONTEUR_PROMPT_VERSION);
  });
});

// ------------------------------------------------------------- la notation

describe('runSmoke', () => {
  it('appelle deux fois chaque cas, par défaut', async () => {
    const port = new PortEnregistreur(CONFORME);
    const sommaire = await runSmoke({ port, cases: loadCases() });
    expect(SAMPLES_PER_CASE).toBe(2);
    expect(sommaire.callCount).toBe(6);
    expect(port.recues.map((r) => r.requestId)).toHaveLength(6);
  });

  it('ne compte une règle passée que si elle passe sur TOUS les échantillons', async () => {
    const port = new PortEnregistreur('Tu passes. Que fais-tu ?');
    const sommaire = await runSmoke({ port, cases: loadCases().slice(0, 1), samplesPerCase: 2 });
    const tombees = sommaire.fallen.map((f) => f.id);
    expect(tombees).toContain('no_final_question');
    expect(tombees).toContain('scene_block_present');
    expect(sommaire.fallen.every((f) => f.failedSamples === 2)).toBe(true);
  });

  it('remonte le total réellement chargé, pas une constante', async () => {
    const port = new PortEnregistreur(CONFORME);
    const sommaire = await runSmoke({ port, cases: loadCases().slice(0, 1), samplesPerCase: 1 });
    expect(sommaire.checkTotal).toBe(SMOKE_ASSERTIONS.length);
  });

  it('remonte le compte d’entrée du fournisseur quand il en donne un', async () => {
    const avec = await runSmoke({
      port: new PortEnregistreur(CONFORME, 3011),
      cases: loadCases().slice(0, 1),
      samplesPerCase: 1,
    });
    const sans = await runSmoke({
      port: new PortEnregistreur(CONFORME, 0),
      cases: loadCases().slice(0, 1),
      samplesPerCase: 1,
    });
    expect([avec.measuredInputTokens, sans.measuredInputTokens]).toEqual([3011, null]);
    expect(avec.estimatedInputTokens).toBeGreaterThan(0);
  });

  it('refuse de tourner sur zéro cas', async () => {
    await expect(
      runSmoke({ port: new PortEnregistreur(CONFORME), cases: [] }),
    ).rejects.toBeInstanceOf(SmokeRunError);
  });
});

// ---------------------------------------------------- la borne et l’environnement

describe('la borne du compte d’assertions', () => {
  it('rejette cinq et neuf, accepte six, sept et huit', () => {
    expect(assertCountWithinBounds(5)).toContain('6–8');
    expect(assertCountWithinBounds(9)).toContain('6–8');
    expect([
      assertCountWithinBounds(6),
      assertCountWithinBounds(7),
      assertCountWithinBounds(8),
    ]).toEqual([null, null, null]);
  });

  it('la table livrée est dans la borne', () => {
    expect(assertCountWithinBounds(SMOKE_ASSERTIONS.length)).toBeNull();
  });
});

describe('buildConfig', () => {
  it('nomme TOUTES les variables manquantes du fournisseur demandé', () => {
    expect(() => buildConfig('openai-compatible', {})).toThrow(
      /NARRATOR_BASE_URL, NARRATOR_API_KEY, NARRATOR_MODEL/u,
    );
  });

  it('ne réclame pas de clé à un serveur local', () => {
    expect(SMOKE_REQUIRED_ENV.ollama).toEqual(['NARRATOR_BASE_URL', 'NARRATOR_MODEL']);
    expect(() =>
      buildConfig('ollama', { NARRATOR_BASE_URL: 'http://x', NARRATOR_MODEL: 'm' }),
    ).not.toThrow();
  });

  it('ne réclame rien au stub', () => {
    expect(SMOKE_REQUIRED_ENV.stub).toEqual([]);
    expect(buildConfig('stub', {}).provider).toBe('stub');
  });

  it('refuse un délai d’attente absurde et retombe sur le défaut', () => {
    expect(buildConfig('stub', { NARRATOR_TIMEOUT_MS: 'zero' }).timeoutMs).toBe(60_000);
    expect(buildConfig('stub', { NARRATOR_TIMEOUT_MS: '900000' }).timeoutMs).toBe(900_000);
  });
});

// ------------------------------------------------------------------- la CLI

describe('main', () => {
  it('rend 1 et une ligne quand le fournisseur est injoignable, sans rapport commencé', async () => {
    const t = io();
    const code = await main(
      ['--provider=ollama'],
      { NARRATOR_BASE_URL: 'http://x', NARRATOR_MODEL: 'm' },
      t.io,
      {
        selectPort: () => new PortInjoignable(),
      },
    );
    expect(code).toBe(1);
    expect(t.err).toHaveLength(1);
    expect(t.err[0]).toContain('unavailable');
    expect(t.out).toEqual([`assertions: ${String(SMOKE_ASSERTIONS.length)}`]);
    expect(t.err.join('\n')).not.toContain('    at ');
  });

  it('rend 0 quand des règles tombent : un verdict informe, il ne ferme pas', async () => {
    const t = io();
    const code = await main(
      ['--provider=ollama'],
      { NARRATOR_BASE_URL: 'http://x', NARRATOR_MODEL: 'm' },
      t.io,
      {
        selectPort: () => new PortEnregistreur('Rien.'),
      },
    );
    expect(code).toBe(0);
    expect(t.out.join('\n')).toContain('tombées :');
  });

  it('rend 1 sur un fournisseur inconnu', async () => {
    const t = io();
    expect(await main(['--provider=mistralaisupercloud'], {}, t.io)).toBe(1);
    expect(t.err[0]).toContain('--provider=');
  });

  it('écrit le compte d’assertions en première ligne', async () => {
    const t = io();
    await main(
      ['--provider=ollama'],
      { NARRATOR_BASE_URL: 'http://x', NARRATOR_MODEL: 'm' },
      t.io,
      {
        selectPort: () => new PortEnregistreur(CONFORME),
      },
    );
    expect(t.out[0]).toBe('assertions: 7');
  });
});

// ------------------------------------------- les codes de sortie, pour de vrai

describe('la commande, en vrai', () => {
  it('sort en 0 sur le stub, sans clé ni URL', () => {
    const r = lancer(['--provider=stub']);
    expect(r.code).toBe(0);
    expect(r.stdout.split('\n')[0]).toBe('assertions: 7');
    expect(r.stdout).toContain('fournisseur : stub');
  }, 120_000);

  it('donne deux fois le même verdict, au caractère près', () => {
    const a = lancer(['--provider=stub']);
    const b = lancer(['--provider=stub']);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout.length).toBeGreaterThan(0);
  }, 180_000);

  it('sort en 1 en nommant la variable manquante, sans trace de pile', () => {
    const r = lancer(['--provider=openai-compatible']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('NARRATOR_BASE_URL');
    expect(r.stderr).toContain('NARRATOR_API_KEY');
    expect(r.stderr).not.toContain('    at ');
    expect(r.stdout).not.toContain('fournisseur :');
  }, 120_000);
});

// ------------------------------------------------------ elle ne ferme rien

describe('la sonde ne bloque pas la CI', () => {
  it('n’est appelée par aucun job du flux de travail', () => {
    const ci = readFileSync(join(RACINE, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci.includes('eval:smoke')).toBe(false);
  });
});
