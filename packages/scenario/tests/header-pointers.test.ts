/**
 * Le pointeur d'en-tête est une COMMANDE, pas une promesse.
 *
 * Trois tests, et le troisième est celui qui compte : il casse le
 * vérificateur exprès. Sans lui, le jour où `src/` ne porterait plus un seul
 * pointeur, les deux premiers resteraient verts à vide.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkPackageHeaders, checkSource, commentBlocks, normalise } from './header-pointers.js';

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');

const report = checkPackageHeaders(REPO_ROOT, PACKAGE_DIR);

describe('chaque pointeur d’en-tête de src/ résout', () => {
  it('aucun fichier manquant, aucun titre introuvable', () => {
    expect(report.issues).toEqual([]);
  });

  it('et la vérification n’a pas tourné à vide', () => {
    // Sans ces trois bornes, un `src/` sans pointeur — ou un parseur de
    // commentaires cassé — rendrait le test précédent vert en ne regardant
    // rien. Les bornes sont basses EXPRÈS : elles disent « quelque chose a
    // été lu », pas « voilà combien », qui se périmerait au premier en-tête
    // réécrit.
    expect(report.blocks).toBeGreaterThan(0);
    expect(report.fileRefs).toBeGreaterThan(0);
    expect(report.titles).toBeGreaterThan(0);
  });
});

describe('le vérificateur rougit sur un pointeur faux', () => {
  const read = (ref: string): string | undefined =>
    ref === 'tests/vrai.test.ts' ? "it('le titre qui existe vraiment', () => {});" : undefined;

  it('un fichier cité qui n’existe pas est signalé', () => {
    const issues = checkSource(
      'sonde.ts',
      '/**\n * tenu par `tests/absent.test.ts` « le titre qui existe vraiment ».\n */',
      read,
    ).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('fichier introuvable');
    expect(issues[0]).toContain('tests/absent.test.ts');
  });

  it('un titre que le fichier cité ne porte pas est signalé', () => {
    const issues = checkSource(
      'sonde.ts',
      '/**\n * tenu par `tests/vrai.test.ts` « un titre que personne n’a écrit ».\n */',
      read,
    ).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('titre introuvable');
    expect(issues[0]).toContain("un titre que personne n'a écrit");
  });

  it('le même pointeur, juste, ne dit rien', () => {
    const bon = checkSource(
      'sonde.ts',
      '/**\n * tenu par `tests/vrai.test.ts` « le titre qui existe\n * vraiment ».\n */',
      read,
    );
    expect(bon.issues).toEqual([]);
    expect(bon.titles).toBe(1);
  });

  it('un bloc sans fichier cité n’est pas vérifié : « horloge à 6 segments » n’est pas un titre', () => {
    const muet = checkSource(
      'sonde.ts',
      '/** « horloge à 6 segments », qui n’est le nom d’aucun test. */',
      read,
    );
    expect(muet.blocks).toBe(0);
    expect(muet.titles).toBe(0);
    expect(muet.issues).toEqual([]);
  });

  it('deux blocs voisins ne se prêtent pas leurs pointeurs', () => {
    // Le titre est dans le SECOND bloc, le fichier dans le premier : si le
    // découpage en blocs tombait, le titre serait cherché dans
    // `tests/vrai.test.ts` et trouvé, et le test ci-dessus deviendrait faux.
    const source =
      '/** tenu par `tests/vrai.test.ts` « le titre qui existe vraiment ». */\n' +
      'export const x = 1;\n' +
      '/** « le titre qui existe vraiment » dit ailleurs, sans fichier. */';
    expect(commentBlocks(source)).toHaveLength(2);
    expect(checkSource('sonde.ts', source, read).titles).toBe(1);
  });

  it('les apostrophes et les retours à la ligne ne comptent pas', () => {
    expect(normalise('«  le\n   titre de l’étape  »')).toBe("le titre de l'étape");
  });
});
