/**
 * THE `ai/` BARREL, EXERCISED — because its own header documents a hazard
 * that nothing was measuring.
 *
 * `export *` does not warn. When two starred modules export the same name,
 * TypeScript and the ES module semantics DROP it from the barrel in silence:
 * the name simply stops being importable from `@for/contracts`, every
 * consumer that used it fails to compile, and the file that caused it looks
 * innocent. The barrel's header says exactly that, and says which two names
 * (`zSceneState`, `ChampionSchema`) this folder deliberately does not declare
 * in order to avoid it — and then no test looked at the barrel at all (0 %
 * coverage, reported by the tester).
 *
 * So this file checks the two directions that a collision breaks:
 *
 *   1. EVERY runtime export of the six modules reaches the barrel, AND is the
 *      same binding (identity, not merely a name that exists). A dropped
 *      name fails here even though the file that caused the drop still
 *      compiles.
 *   2. NO name is exported by two of the six modules — the collision itself,
 *      caught at its source, with the offending name in the message rather
 *      than an "undefined is not a function" three packages away.
 *
 * Type-only exports are invisible at runtime and are therefore out of reach
 * here; they are covered by `typecheck:tests`, which imports the package
 * surface. What is measured is the surface that actually ships.
 */
import { describe, expect, it } from 'vitest';

import * as chronicle from '../../src/ai/chronicle.js';
import * as forge from '../../src/ai/forge.js';
import * as barrel from '../../src/ai/index.js';
import * as narration from '../../src/ai/narration.js';
import * as narratorPort from '../../src/ai/narrator-port.js';
import * as scene from '../../src/ai/scene.js';
import * as tools from '../../src/ai/tools.js';

/** The six modules the barrel stars, by the name it stars them under. */
const MODULES = [
  ['chronicle.js', chronicle],
  ['forge.js', forge],
  ['narration.js', narration],
  ['narrator-port.js', narratorPort],
  ['scene.js', scene],
  ['tools.js', tools],
] as const satisfies readonly (readonly [string, Record<string, unknown>])[];

describe('le tonneau ai/ — ce que `export *` laisse tomber en silence', () => {
  it('réexporte CHAQUE nom des six modules, et le MÊME objet', () => {
    const missing: string[] = [];
    const rebound: string[] = [];
    for (const [file, module] of MODULES) {
      for (const name of Object.keys(module)) {
        if (!(name in barrel)) {
          missing.push(`${file}#${name}`);
          continue;
        }
        const expected = (module as Record<string, unknown>)[name];
        if ((barrel as Record<string, unknown>)[name] !== expected) rebound.push(`${file}#${name}`);
      }
    }
    expect(missing, 'noms absents du tonneau — collision d’export étoilé ?').toStrictEqual([]);
    expect(rebound, 'noms réexportés par un AUTRE module que le leur').toStrictEqual([]);
  });

  it('aucun nom n’est exporté par deux des six modules', () => {
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const [file, module] of MODULES) {
      for (const name of Object.keys(module)) {
        const first = owner.get(name);
        if (first === undefined) owner.set(name, file);
        else collisions.push(`${name} : ${first} et ${file}`);
      }
    }
    expect(collisions).toStrictEqual([]);
  });

  it('n’invente aucun nom que les six modules n’exportent pas', () => {
    const declared = new Set(MODULES.flatMap(([, module]) => Object.keys(module)));
    expect(Object.keys(barrel).filter((name) => !declared.has(name))).toStrictEqual([]);
  });

  it('ne redéclare NI zSceneState NI ChampionSchema : ils viennent de core/ et content/', () => {
    // Les deux noms que l'en-tête du tonneau nomme. `src/index.ts` étoile
    // `core/`, `content/` et `ai/` côte à côte : si ce dossier redéclarait
    // l'un des deux, le nom disparaîtrait de la surface publique du paquet
    // sans qu'aucun fichier ne cesse de compiler.
    expect(Object.keys(barrel)).not.toContain('zSceneState');
    expect(Object.keys(barrel)).not.toContain('ChampionSchema');
  });

  it('porte la somme EXACTE des exports des six modules : aucun perdu, aucun en trop', () => {
    // Un `export *` oublié ne casse rien tant que personne n'importe le nom
    // manquant depuis le paquet ; il casse tout le jour où quelqu'un le fait.
    // Une collision, elle, en retire DEUX d'un coup. Les deux se voient ici.
    const counts = MODULES.map(([file, module]) => [file, Object.keys(module).length] as const);
    for (const [file, count] of counts) {
      expect(count, `${file} n’exporte plus rien à l’exécution`).toBeGreaterThan(0);
    }
    const total = counts.reduce((sum, [, count]) => sum + count, 0);
    expect(Object.keys(barrel)).toHaveLength(total);
  });
});
