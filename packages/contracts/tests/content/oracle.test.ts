/**
 * `coversDie` — la garantie la plus utile du chargeur (§4.6).
 *
 * Critère d'acceptation : une table d12 à laquelle il manque l'entrée 9 est
 * refusée avec « trou dans la table : 9..9 non couvert », et un chevauchement
 * est refusé DISTINCTEMENT. Les deux sens sont mesurés : la même table, une
 * fois complète, passe.
 */
import { describe, expect, it } from 'vitest';

import {
  DieSizeSchema,
  OracleEntrySchema,
  OracleTableSchema,
  YESNO_THRESHOLDS,
  YesNoOracleSchema,
} from '../../src/content/oracle.js';
import { PresageTableSchema } from '../../src/content/presage-table.js';

const validOracleTable = (): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'freljord-weather',
  name: 'Temps du Freljord',
  kind: 'table',
  die: 6,
  usage: 'Quand le ciel doit trancher.',
  entries: [
    { id: 'clair', min: 1, max: 3, text: 'Un ciel dur et clair.' },
    { id: 'blizzard', min: 4, max: 6, text: 'Le blizzard se lève.' },
  ],
  tags: [],
});

/** Une d12, une entrée par face, moins les faces retirées. */
const d12Table = (
  entries: { id: string; min: number; max: number }[],
): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'complication',
  name: 'Complications',
  kind: 'table',
  die: 12,
  usage: 'Quand la scène doit se compliquer.',
  entries: entries.map((entry) => ({ ...entry, text: 'Une complication.' })),
  tags: [],
});

const faces = (from: number, to: number): { id: string; min: number; max: number }[] =>
  Array.from({ length: to - from + 1 }, (_unused, index) => ({
    id: `f-${String(from + index)}`,
    min: from + index,
    max: from + index,
  }));

const messages = (value: Record<string, unknown>): string[] =>
  OracleTableSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];

describe('coversDie — la couverture exacte d’un dé', () => {
  it('accepte une d12 complète', () => {
    expect(OracleTableSchema.safeParse(d12Table(faces(1, 12))).success).toBe(true);
  });

  it('refuse la même d12 privée de son entrée 9, avec le message exact', () => {
    const withoutNine = faces(1, 12).filter((face) => face.min !== 9);
    expect(messages(d12Table(withoutNine))).toContain('trou dans la table : 9..9 non couvert');
  });

  it('refuse un trou de plusieurs faces en le nommant en entier', () => {
    const withoutMiddle = faces(1, 12).filter((face) => face.min < 5 || face.min > 7);
    expect(messages(d12Table(withoutMiddle))).toContain('trou dans la table : 5..7 non couvert');
  });

  it('refuse un chevauchement DISTINCTEMENT, et ne parle pas de trou', () => {
    const overlapping = [...faces(1, 8), { id: 'large', min: 8, max: 12 }];
    const issues = messages(d12Table(overlapping));
    expect(issues).toContain("chevauchement à 8 (déjà couvert jusqu'à 8)");
    expect(issues.some((message) => message.startsWith('trou dans la table'))).toBe(false);
  });

  it('refuse une table qui s’arrête avant la dernière face', () => {
    expect(messages(d12Table(faces(1, 10)))).toContain('table incomplète : 11..12 non couvert');
  });

  it('refuse une table qui ne commence pas à 1', () => {
    expect(messages(d12Table(faces(2, 12)))).toContain('trou dans la table : 1..1 non couvert');
  });

  it('ne dépend pas de l’ordre des entrées dans le fichier', () => {
    const shuffled = [...faces(1, 12)].reverse();
    expect(OracleTableSchema.safeParse(d12Table(shuffled)).success).toBe(true);
  });
});

describe('OracleEntrySchema', () => {
  it('refuse max < min et accepte max = min', () => {
    const entry = { id: 'x', min: 4, max: 2, text: 'Un texte.' };
    expect(OracleEntrySchema.safeParse(entry).success).toBe(false);
    expect(OracleEntrySchema.safeParse({ ...entry, max: 4 }).success).toBe(true);
  });

  it('plafonne la chaîne à trois tables', () => {
    const entry = { id: 'x', min: 1, max: 1, text: 'Un texte.' };
    expect(OracleEntrySchema.safeParse({ ...entry, chain: ['a', 'b', 'c'] }).success).toBe(true);
    expect(OracleEntrySchema.safeParse({ ...entry, chain: ['a', 'b', 'c', 'd'] }).success).toBe(
      false,
    );
  });
});

describe('DieSizeSchema', () => {
  it.each([4, 6, 8, 10, 12, 20, 100])('accepte le d%i', (die) => {
    expect(DieSizeSchema.safeParse(die).success).toBe(true);
  });

  it.each([3, 7, 13, 0, -6, 6.5])('refuse %i', (die) => {
    expect(DieSizeSchema.safeParse(die).success).toBe(false);
  });
});

describe('OracleTableSchema', () => {
  it('accepte la table de référence', () => {
    expect(OracleTableSchema.safeParse(validOracleTable()).success).toBe(true);
  });

  it('exige au moins deux entrées, même sur une table par ailleurs couverte', () => {
    const single = {
      ...validOracleTable(),
      entries: [{ id: 'tout', min: 1, max: 6, text: 'Un seul cas.' }],
    };
    expect(OracleTableSchema.safeParse(single).success).toBe(false);
  });
});

describe('YesNoOracleSchema', () => {
  const yesNo = {
    schemaVersion: 1,
    id: 'yes-no',
    kind: 'yes-no',
    die: 100,
    likelihoods: YESNO_THRESHOLDS,
    extremeRule: 'Un double impose un retournement.',
    extremeTableId: 'complication',
  };

  it('accepte les seuils du moteur', () => {
    expect(YesNoOracleSchema.safeParse(yesNo).success).toBe(true);
  });

  it('refuse un seuil retouché dans le contenu', () => {
    const tampered = { ...yesNo, likelihoods: { ...YESNO_THRESHOLDS, incertain: 55 } };
    expect(YesNoOracleSchema.safeParse(tampered).success).toBe(false);
  });

  it('refuse un identifiant autre que `yes-no`', () => {
    expect(YesNoOracleSchema.safeParse({ ...yesNo, id: 'oui-non' }).success).toBe(false);
  });
});

describe('PresageTableSchema', () => {
  it('impose l’identifiant `presages` et garde `coversDie`', () => {
    const presages = { ...validOracleTable(), id: 'presages' };
    expect(PresageTableSchema.safeParse(presages).success).toBe(true);
    expect(PresageTableSchema.safeParse(validOracleTable()).success).toBe(false);

    const holed = {
      ...presages,
      entries: [{ id: 'clair', min: 1, max: 3, text: 'Un ciel dur et clair.' }],
    };
    expect(PresageTableSchema.safeParse(holed).success).toBe(false);
  });
});
