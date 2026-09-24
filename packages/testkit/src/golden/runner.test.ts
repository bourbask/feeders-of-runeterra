/**
 * Tous les corpus de ce fichier vivent dans un dossier temporaire créé par
 * `mkdtempSync(os.tmpdir())` : rien n'est écrit dans l'arbre de travail.
 * Les fichiers sont créés par `expectGolden` lui-même sous `GOLDEN_UPDATE=1`,
 * jamais par un `writeFileSync` de test — c'est le chemin de production de
 * l'outil qui sert de banc d'essai.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GOLDEN_UPDATE_ENV,
  GoldenDirUnusable,
  GoldenMismatch,
  GoldenMissing,
  GoldenUpdateMisused,
  expectGolden,
  goldenUpdateRequested,
} from './runner.js';
import { GoldenSerialisationError } from './stable-stringify.js';

const RACINE = mkdtempSync(join(tmpdir(), 'for-testkit-golden-'));

afterAll(() => {
  rmSync(RACINE, { recursive: true, force: true });
});

/** Un dossier par test : aucun test ne dépend de ce qu'un autre a laissé. */
let dossier: string;

beforeEach(() => {
  dossier = mkdtempSync(join(RACINE, 'cas-'));
});

/** `Reflect.deleteProperty` plutôt que `delete` : le lint refuse la clé calculée. */
function retirerLaVariable(): void {
  Reflect.deleteProperty(process.env, GOLDEN_UPDATE_ENV);
}

function poserLaVariable(valeur: string): void {
  process.env[GOLDEN_UPDATE_ENV] = valeur;
}

afterEach(() => {
  retirerLaVariable();
});

/** Écrit le corpus par le seul chemin qui en écrit un : le runner, en mode mise à jour. */
function poserLeCorpus(nom: string, valeur: unknown): void {
  poserLaVariable('1');
  try {
    expectGolden(nom, valeur, { dir: dossier });
  } finally {
    retirerLaVariable();
  }
}

describe('expectGolden', () => {
  it('passe quand la valeur est celle du corpus', () => {
    poserLeCorpus('accord', { b: 1, a: 2 });

    expect(() => {
      expectGolden('accord', { a: 2, b: 1 }, { dir: dossier });
    }).not.toThrow();
  });

  // LE garde-fou numéro un : une dérive doit être visible.
  it('échoue quand la sortie diffère du corpus', () => {
    poserLeCorpus('derive', { ticks: 4 });

    expect(() => {
      expectGolden('derive', { ticks: 7 }, { dir: dossier });
    }).toThrow(GoldenMismatch);
  });

  it('dit où est la première différence', () => {
    poserLeCorpus('rapport', { a: 1, b: 2, c: 3 });

    let capturé: unknown;
    try {
      expectGolden('rapport', { a: 1, b: 99, c: 3 }, { dir: dossier });
    } catch (erreur: unknown) {
      capturé = erreur;
    }

    expect(capturé).toBeInstanceOf(GoldenMismatch);
    const message = (capturé as GoldenMismatch).message;
    expect(message).toMatch(/first difference at line 3/);
    expect(message).toMatch(/corpus: {3}"b": 2,/);
    expect(message).toMatch(/value : {3}"b": 99,/);
  });

  it('ne réécrit PAS le corpus quand il dérive', () => {
    poserLeCorpus('intact', { ticks: 4 });
    const fichier = join(dossier, 'intact.golden.json');
    const avant = readFileSync(fichier, 'utf8');

    expect(() => {
      expectGolden('intact', { ticks: 7 }, { dir: dossier });
    }).toThrow(GoldenMismatch);
    expect(readFileSync(fichier, 'utf8')).toBe(avant);
  });

  // LE garde-fou numéro deux : sans lui, un corpus supprimé par mégarde rend la
  // suite verte pour toujours.
  it('échoue quand le fichier de corpus est ABSENT', () => {
    let capturé: unknown;
    try {
      expectGolden('jamais-ecrit', { a: 1 }, { dir: dossier });
    } catch (erreur: unknown) {
      capturé = erreur;
    }

    expect(capturé).toBeInstanceOf(GoldenMissing);
    expect((capturé as GoldenMissing).message).toMatch(/does not exist/);
    expect(existsSync(join(dossier, 'jamais-ecrit.golden.json'))).toBe(false);
  });

  it('échoue aussi quand un corpus existant est supprimé', () => {
    poserLeCorpus('efface', { a: 1 });
    const fichier = join(dossier, 'efface.golden.json');
    expect(() => {
      expectGolden('efface', { a: 1 }, { dir: dossier });
    }).not.toThrow();

    rmSync(fichier);

    expect(() => {
      expectGolden('efface', { a: 1 }, { dir: dossier });
    }).toThrow(GoldenMissing);
  });

  it('échoue quand le dossier de corpus n’existe pas du tout', () => {
    expect(() => {
      expectGolden('quelconque', { a: 1 }, { dir: join(dossier, 'absent') });
    }).toThrow(GoldenMissing);
  });

  it('réécrit le fichier quand GOLDEN_UPDATE=1', () => {
    poserLeCorpus('mise-a-jour', { ticks: 4 });
    const fichier = join(dossier, 'mise-a-jour.golden.json');
    expect(readFileSync(fichier, 'utf8')).toBe('{\n  "ticks": 4\n}\n');

    poserLaVariable('1');
    expectGolden('mise-a-jour', { ticks: 7 }, { dir: dossier });
    retirerLaVariable();

    expect(readFileSync(fichier, 'utf8')).toBe('{\n  "ticks": 7\n}\n');
    expect(() => {
      expectGolden('mise-a-jour', { ticks: 7 }, { dir: dossier });
    }).not.toThrow();
  });

  it('crée les dossiers manquants quand il réécrit', () => {
    poserLaVariable('1');
    expectGolden('dice/challenge', { a: 1 }, { dir: dossier });
    retirerLaVariable();

    expect(existsSync(join(dossier, 'dice', 'challenge.golden.json'))).toBe(true);
  });

  it('accepte un nom déjà suffixé sans le suffixer deux fois', () => {
    poserLeCorpus('suffixe.golden.json', { a: 1 });

    expect(existsSync(join(dossier, 'suffixe.golden.json'))).toBe(true);
    expect(existsSync(join(dossier, 'suffixe.golden.json.golden.json'))).toBe(false);
  });

  it('refuse un nom qui sort du dossier des corpus', () => {
    expect(() => {
      expectGolden('../dehors', { a: 1 }, { dir: dossier });
    }).toThrow(RangeError);
    expect(() => {
      expectGolden('/etc/passwd', { a: 1 }, { dir: dossier });
    }).toThrow(RangeError);
    expect(() => {
      expectGolden('', { a: 1 }, { dir: dossier });
    }).toThrow(RangeError);
  });

  it('refuse une valeur non sérialisable avant de toucher au disque', () => {
    poserLaVariable('1');
    expect(() => {
      expectGolden('pas-serialisable', { a: Number.NaN }, { dir: dossier });
    }).toThrow(GoldenSerialisationError);
    retirerLaVariable();

    expect(existsSync(join(dossier, 'pas-serialisable.golden.json'))).toBe(false);
  });
});

describe('GOLDEN_UPDATE', () => {
  // LE garde-fou numéro trois : un corpus qui se réécrit tout seul ne prouve rien.
  it('n’est pas actif par défaut', () => {
    expect(process.env[GOLDEN_UPDATE_ENV]).toBeUndefined();
    expect(goldenUpdateRequested()).toBe(false);

    poserLeCorpus('defaut', { ticks: 4 });

    // Aucune variable posée : la dérive échoue au lieu d'écraser le corpus.
    expect(() => {
      expectGolden('defaut', { ticks: 7 }, { dir: dossier });
    }).toThrow(GoldenMismatch);
    expect(readFileSync(join(dossier, 'defaut.golden.json'), 'utf8')).toBe('{\n  "ticks": 4\n}\n');
  });

  it('reste inactif sur une variable vide', () => {
    poserLaVariable('');

    expect(goldenUpdateRequested()).toBe(false);
  });

  it('est actif sur la valeur 1, et sur elle seule', () => {
    expect(goldenUpdateRequested({ [GOLDEN_UPDATE_ENV]: '1' })).toBe(true);
  });

  // Une valeur non reconnue qu'on ignorerait en silence est pire qu'un refus :
  // on croirait son corpus régénéré alors qu'il est resté tel quel.
  it('refuse bruyamment toute autre valeur', () => {
    for (const valeur of ['true', 'yes', '0', 'oui', ' 1']) {
      expect(() => goldenUpdateRequested({ [GOLDEN_UPDATE_ENV]: valeur })).toThrow(
        GoldenUpdateMisused,
      );
    }

    poserLaVariable('true');
    expect(() => {
      expectGolden('peu-importe', { a: 1 }, { dir: dossier });
    }).toThrow(GoldenUpdateMisused);
  });

  it('lit l’environnement à chaque appel, sans instantané au chargement', () => {
    expect(goldenUpdateRequested()).toBe(false);
    poserLaVariable('1');
    expect(goldenUpdateRequested()).toBe(true);
    retirerLaVariable();
    expect(goldenUpdateRequested()).toBe(false);
  });
});

/**
 * Le dossier de corpus ne vient JAMAIS du répertoire courant.
 *
 * Mesuré avant correction : `expectGolden('x', v)` sans `dir` résolvait
 * `<paquet>/tests/golden/x.golden.json` sous `pnpm test` (turbo lance vitest
 * depuis le paquet) et `<dépôt>/tests/golden/x.golden.json` sous
 * `pnpm test:coverage` (travail 6 de ci.yml, bloquant, lancé depuis la racine).
 * Même appel, deux fichiers — et sous `GOLDEN_UPDATE=1` depuis la racine, le
 * mauvais dossier était CRÉÉ et rempli sans un mot.
 */
describe('le dossier de corpus', () => {
  it('est obligatoire : sans lui, un refus nommé, pas un repli sur le cwd', () => {
    const sansOptions = expectGolden as (nom: string, valeur: unknown) => void;

    expect(() => {
      sansOptions('sans-dossier', { a: 1 });
    }).toThrow(GoldenDirUnusable);
  });

  it('refuse un chemin RELATIF — c’est le cwd par la porte de derrière', () => {
    expect(() => {
      expectGolden('relatif', { a: 1 }, { dir: 'tests/golden' });
    }).toThrow(/is a RELATIVE path/);
  });

  it('refuse une chaîne vide et une valeur qui n’est pas un chemin', () => {
    const malTypé = expectGolden as (nom: string, valeur: unknown, options: unknown) => void;

    expect(() => {
      expectGolden('vide', { a: 1 }, { dir: '' });
    }).toThrow(GoldenDirUnusable);
    expect(() => {
      malTypé('nombre', { a: 1 }, { dir: 42 });
    }).toThrow(GoldenDirUnusable);
  });

  it('refuse une URL qui n’est pas file:', () => {
    expect(() => {
      expectGolden('distant', { a: 1 }, { dir: new URL('https://exemple.test/golden/') });
    }).toThrow(/is not a `file:` URL/);
  });

  it('n’écrit RIEN quand le dossier est refusé, même sous GOLDEN_UPDATE=1', () => {
    poserLaVariable('1');
    expect(() => {
      expectGolden('jamais-pose', { a: 1 }, { dir: 'tests/golden' });
    }).toThrow(GoldenDirUnusable);
    // Le FICHIER, pas le dossier : `tests/golden/` peut exister légitimement le
    // jour où ce paquet aura ses propres corpus, et l'assertion mentirait alors
    // en passant pour une autre raison que celle qu'elle prétend vérifier.
    expect(existsSync(join(process.cwd(), 'tests', 'golden', 'jamais-pose.golden.json'))).toBe(
      false,
    );
  });

  // LA propriété que le défaut sur `process.cwd()` cassait : le fichier résolu
  // ne dépend que de l'ancre passée, jamais du répertoire de lancement.
  it('résout le MÊME fichier quel que soit le répertoire courant', () => {
    const ancre = new URL('golden/', pathToFileURL(`${dossier}/`));

    poserLaVariable('1');
    expectGolden('meme-fichier', { ticks: 7 }, { dir: ancre });
    retirerLaVariable();

    const avant = process.cwd();
    try {
      process.chdir(tmpdir());
      expectGolden('meme-fichier', { ticks: 7 }, { dir: ancre });
      process.chdir(RACINE);
      expectGolden('meme-fichier', { ticks: 7 }, { dir: ancre });
    } finally {
      process.chdir(avant);
    }

    expect(existsSync(join(dossier, 'golden', 'meme-fichier.golden.json'))).toBe(true);
  });

  it('accepte une URL file:, une chaîne file: et un chemin absolu, pour le même fichier', () => {
    poserLaVariable('1');
    expectGolden('trois-formes', { a: 1 }, { dir: dossier });
    retirerLaVariable();

    const url = pathToFileURL(`${dossier}/`);
    expectGolden('trois-formes', { a: 1 }, { dir: url });
    expectGolden('trois-formes', { a: 1 }, { dir: url.href });
    expectGolden('trois-formes', { a: 1 }, { dir: dossier });
    expect(existsSync(join(dossier, 'trois-formes.golden.json'))).toBe(true);
  });
});
