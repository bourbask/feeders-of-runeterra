/**
 * The generated module is the one the server actually reads.
 *
 * `pnpm content:index && git diff --exit-code` is the CI form of this check
 * (job 9). This file is the form that runs on every `pnpm test`, and it adds
 * the thing a `git diff` cannot say: that the embedded bundle still VALIDATES,
 * and that the interface labels still cover the engine's closed lists member
 * by member — in both directions, as ADR 0007 requires.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zAttributeId, zGaugeId, zMoveId, zOutcome } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { LABELS } from '../src/generated/labels.js';
import { GENERATED_FILES, GENERATED_FROM, GENERATED_HASH, staticContent } from '../src/index.js';
import { readContentFiles } from '../src/load.js';
import { canonicalJson, contentHash, contentVersion } from '../src/manifest.js';
import { attributeLabels, gaugeLabels, outcomeLabels, uiLabel, uiLabels } from '../src/ui.js';
import type { LabelFileName } from '../src/validate.js';
import { LABELLED_ENUMS, validateLabels } from '../src/validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const LABEL_DIR = join(HERE, '..', 'data', 'labels');

const onDisk = (): ReadonlyMap<string, string> => readContentFiles(join(REPO, GENERATED_FROM));

describe('l’index généré est à jour', () => {
  it('porte exactement les fichiers de sa racine, document par document', () => {
    const disk = onDisk();
    expect(Object.keys(GENERATED_FILES).sort()).toStrictEqual([...disk.keys()].sort());
    for (const [file, raw] of disk) {
      expect(GENERATED_FILES[file]).toBe(canonicalJson(JSON.parse(raw)));
    }
  });

  it('porte le hash de sa racine — un contenu modifié rend le fichier périmé', () => {
    expect(GENERATED_HASH).toBe(
      contentHash(onDisk(), (input) => createHash('sha256').update(input, 'utf8').digest('hex')),
    );
  });

  it('se valide lui-même en cinq passes, sans toucher au disque', () => {
    const registry = staticContent();
    expect(registry.bundle.hash).toBe(GENERATED_HASH);
    // M0-16 replaced the generated root: `content-fixtures` (three moves) gave
    // way to `content/`, the real bundle. The list is compared to the ENGINE's
    // closed `MOVE_IDS` rather than to a literal recopied here — ADR 0007's
    // operating rule: a number or a list that comes from the engine is compared
    // to the engine, never to itself. Shrink `content/moves/` and this reddens.
    expect(registry.listMoves().map((move) => move.id)).toStrictEqual([...zMoveId.options].sort());
    expect(contentVersion(registry.bundle.version, registry.bundle.hash)).toBe(
      `0.1.0+${GENERATED_HASH.slice(0, 12)}`,
    );
  });

  it('est memoisé : deux appels rendent le même registre', () => {
    expect(staticContent()).toBe(staticContent());
  });
});

describe('les libellés d’interface sont un miroir, prouvé dans les deux sens', () => {
  it('couvrent exactement les listes closes du moteur', () => {
    expect(Object.keys(attributeLabels).sort()).toStrictEqual([...zAttributeId.options].sort());
    expect(Object.keys(gaugeLabels).sort()).toStrictEqual([...zGaugeId.options].sort());
    expect(Object.keys(outcomeLabels).sort()).toStrictEqual([...zOutcome.options].sort());
    for (const name of Object.keys(LABELLED_ENUMS) as (keyof typeof LABELLED_ENUMS)[]) {
      expect(validateLabels(name, LABELS[name])).toStrictEqual([]);
    }
  });

  it('rougissent sur un libellé MANQUANT', () => {
    const without = Object.fromEntries(
      Object.entries(LABELS.gauges).filter(([key]) => key !== 'vivres'),
    );
    const problems = validateLabels('gauges', without);
    expect(problems.map((problem) => problem.message)).toStrictEqual([
      'libellé manquant : « vivres » existe dans le moteur',
    ]);
  });

  it('rougissent sur un libellé EN TROP — ce que `satisfies` ne verrait pas', () => {
    const problems = validateLabels('gauges', { ...LABELS.gauges, courage: 'Courage' });
    expect(problems.map((problem) => problem.message)).toStrictEqual([
      'libellé en trop : « courage » n’existe pas dans le moteur',
    ]);
  });

  it('rougissent sur un libellé vide, et sur un fichier vide', () => {
    expect(validateLabels('ui', { 'table.titre': '   ' })).toHaveLength(1);
    expect(validateLabels('ui', {})).toHaveLength(1);
  });

  it('sont ceux de data/labels/, fichier par fichier', () => {
    for (const name of ['attributes', 'gauges', 'outcomes', 'ui'] as LabelFileName[]) {
      const disk = JSON.parse(readFileSync(join(LABEL_DIR, `${name}.json`), 'utf8')) as unknown;
      expect(LABELS[name]).toStrictEqual(disk);
    }
  });

  it('ne rendent jamais « undefined » à l’écran', () => {
    expect(uiLabel('table.pourquoi')).toBe('Pourquoi ?');
    expect(() => uiLabel('table.inexistant')).toThrow('absent de ui.json');
    expect(Object.keys(uiLabels).length).toBeGreaterThan(0);
  });
});
