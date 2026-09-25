/**
 * Les six familles de pièces de scénario (S-01, ADR 0012).
 *
 * Chaque garde-fou est mesuré DANS LES DEUX SENS sur le même document : vert
 * sans la violation, rouge avec. Montrer qu'un test existe ne vaut rien.
 *
 * ── CE QUI EST VÉRIFIÉ AILLEURS, ET POURQUOI ─────────────────────────────
 * Les réutilisations du moteur — bornes de segments, rangs de serment,
 * dispositions — ne se comparent PAS ici : elles se comparent au moteur, dans
 * `tests/exhaustive-union.test.ts`, qui est le seul fichier autorisé à
 * importer une VALEUR de `@for/engine`. Une comparaison faite ici opposerait
 * deux recopies des contrats et ne prouverait rien (ADR 0007).
 * Les marqueurs `ref:` se vérifient dans `@for/content`, en faisant tourner le
 * vrai marcheur de la passe 3 : `packages/content/tests/scenario-vocabulary.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DispositionSchema, RankSchema, SegmentCountSchema } from '../../src/content/common.js';
import { ENCOUNTER_KINDS, EncounterSchema } from '../../src/content/encounter.js';
import { FigureSchema } from '../../src/content/figure.js';
import { FrontSchema } from '../../src/content/front.js';
import { HookSchema } from '../../src/content/hook.js';
import { NodeSchema, SCENARIO_NODE_KINDS } from '../../src/content/node.js';
import { PeriodSchema } from '../../src/content/period.js';
import { RegionKindSchema, RegionSchema } from '../../src/content/region.js';
import { zClockSegmentCount, zEntityDisposition, zProgressRank } from '../../src/core/enums.js';

type Doc = Record<string, unknown>;

const period = (): Doc => ({
  schemaVersion: 1,
  id: 'freljord-moderne',
  name: 'Le Freljord moderne',
  summary: 'Trois prétendantes, un seul hiver, et du grain qui manque partout.',
  after: 300,
  before: null,
  factionIds: ['avarosans', 'griffe-d-hiver'],
  absentFactionIds: ['les-trois-soeurs'],
});

const front = (): Doc => ({
  schemaVersion: 1,
  id: 'la-famine-remonte-le-fleuve',
  name: 'La famine remonte le fleuve',
  stake: 'Les greniers de la Portée, et les clans qui en dépendent.',
  segments: 4,
  portents: [
    'Un convoi de grain n’arrive pas, et personne ne va voir pourquoi.',
    'Le conseil rationne, et deux clans refusent la mesure.',
    'Un hameau de l’est mange ses bêtes de trait.',
    'La Portée ouvre ses portes aux armes plutôt qu’aux affamés.',
  ],
  periodId: 'freljord-moderne',
  regionIds: ['avarosa-reach'],
});

const node = (): Doc => ({
  schemaVersion: 1,
  id: 'le-grenier-vide',
  name: 'Le grenier vide',
  kind: 'lieu',
  situation: 'Les sacs sont là, alignés, et ils sont pleins de neige.',
  stakeQuestion: 'Qui a vidé le grenier, et à qui l’a-t-il donné ?',
  figureIds: ['la-gardienne-du-grain'],
  regionId: 'avarosa-reach',
  periodId: 'freljord-moderne',
  entryPoint: true,
  leads: [
    { toNodeId: 'le-convoi-retourne', trigger: 'On suit les traces qui partent vers le nord.' },
    { toNodeId: 'le-conseil-des-clans', trigger: 'On va le dire à ceux qui décident.' },
    { toNodeId: 'la-taverne-du-pont', trigger: 'On demande qui a vu passer des sacs.' },
  ],
});

const figure = (): Doc => ({
  schemaVersion: 1,
  id: 'la-gardienne-du-grain',
  name: 'La gardienne du grain',
  wants: 'Que le grenier tienne jusqu’au dégel, quel qu’en soit le prix.',
  refuses: 'Servir un clan avant un autre, même celui qui la nourrit.',
  knows: 'Le compte exact des sacs, et le jour où il a cessé d’être juste.',
  disposition: 'neutre',
  factionId: 'avarosans',
  periodId: 'freljord-moderne',
});

const hook = (): Doc => ({
  schemaVersion: 1,
  id: 'on-vous-doit-un-hiver',
  name: 'On vous doit un hiver',
  appliesTo: { kind: 'champion', championId: 'braum' },
  pitch: 'Le hameau qui vous a nourris l’an dernier n’a rien reçu cette année.',
  vowRank: 'dangereux',
  suggestedBondIds: ['la-gardienne-du-grain'],
  periodId: 'freljord-moderne',
});

const encounter = (): Doc => ({
  schemaVersion: 1,
  id: 'le-colporteur-de-sel',
  name: 'Le colporteur de sel',
  kind: 'marchand',
  summary: 'Il vend du sel au prix du fer, et il a de bonnes raisons.',
  periodId: 'freljord-moderne',
  regionKinds: ['etablissement', 'site'],
  oracleRef: 'complication',
});

/** Les six, avec leur document de référence. Une liste PARCOURUE : la vider fait tomber les `it.each`. */
const FAMILIES = [
  ['période', PeriodSchema, period],
  ['front', FrontSchema, front],
  ['nœud', NodeSchema, node],
  ['figure', FigureSchema, figure],
  ['ressort', HookSchema, hook],
  ['rencontre', EncounterSchema, encounter],
] as const;

describe('les six documents de référence', () => {
  it.each(FAMILIES)('%s : le document de référence passe', (_name, schema, make) => {
    const parsed = schema.safeParse(make());
    expect(parsed.error?.issues ?? []).toStrictEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('les six familles sont bien six', () => {
    // Le chiffre vient de l'ADR 0012 décision 2 (« six familles neuves ») :
    // il s'écrit en toutes lettres, il ne se lit pas depuis FAMILIES.
    expect(FAMILIES).toHaveLength(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LA STRICTNESS, ET LE PIÈGE DÉJÀ PAYÉ
describe('un champ en trop est refusé', () => {
  it.each(FAMILIES)('%s : refuse « champInvente »', (_name, schema, make) => {
    const document = make();
    expect(schema.safeParse(document).success).toBe(true);
    document['champInvente'] = 'ce que personne ne valide';
    expect(schema.safeParse(document).success).toBe(false);
  });

  it('le JSON Schema ne prouve rien en mode par défaut — le test d’exécution, si', () => {
    // ADR 0007 / CLAUDE.md : `z.toJSONSchema` écrit `additionalProperties:
    // false` MÊME sur un objet non strict, en mode par défaut. Mesuré ici sur
    // les deux schémas du dépôt qui diffèrent vraiment : RegionSchema est
    // LÂCHE, FigureSchema est STRICT.
    const looseByDefault = z.toJSONSchema(RegionSchema) as Record<string, unknown>;
    const strictByDefault = z.toJSONSchema(FigureSchema) as Record<string, unknown>;
    expect(looseByDefault['additionalProperties']).toBe(false);
    expect(strictByDefault['additionalProperties']).toBe(false);

    // Le même couple, en `io: 'input'` : là seulement les deux se distinguent.
    const looseInput = z.toJSONSchema(RegionSchema, { io: 'input' }) as Record<string, unknown>;
    const strictInput = z.toJSONSchema(FigureSchema, { io: 'input' }) as Record<string, unknown>;
    expect(looseInput['additionalProperties']).toBeUndefined();
    expect(strictInput['additionalProperties']).toBe(false);

    // Et la seule preuve qui compte, celle qui tient les `it.each` ci-dessus :
    // le refus à l'exécution. RegionSchema, lui, ACCEPTE le champ en trop et
    // le jette en silence — dit ici plutôt que laissé à découvrir.
    const region = {
      schemaVersion: 1,
      id: 'avarosa-reach',
      name: 'La Portée d’Avarosa',
      parentId: null,
      kind: 'territoire',
      summary: 'Des plaines de glace.',
      description: 'Le vent y travaille la neige comme une lime.',
      dangerRank: 'dangereux',
      climate: 'Glacial.',
      hooks: ['Une caravane n’est jamais arrivée.'],
      champInvente: 'toléré',
    };
    const accepted = RegionSchema.safeParse(region);
    expect(accepted.success).toBe(true);
    expect(accepted.data).not.toHaveProperty('champInvente');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FRONT — autant de présages que de segments, dans LES DEUX SENS
describe('front : les présages comptent exactement les segments', () => {
  it('en retirer un fait échouer, et le message nomme le front', () => {
    const document = front();
    const portents = document['portents'] as string[];
    document['portents'] = portents.slice(0, -1);
    const refused = FrontSchema.safeParse(document);
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain('la-famine-remonte-le-fleuve');
    expect(refused.error?.issues[0]?.path).toStrictEqual(['portents']);
  });

  it('en ajouter un fait échouer aussi', () => {
    const document = front();
    const portents = document['portents'] as string[];
    document['portents'] = [...portents, 'Un présage de trop, qu’aucun segment ne portera.'];
    expect(FrontSchema.safeParse(document).success).toBe(false);
  });

  it.each([4, 6, 8, 10])('%i segments demandent %i présages, et les acceptent', (segments) => {
    const document = front();
    document['segments'] = segments;
    document['portents'] = Array.from(
      { length: segments },
      (_unused, index) => `Étape ${String(index + 1)} : ce que la menace franchit ici.`,
    );
    expect(FrontSchema.safeParse(document).success).toBe(true);
  });

  it('un nombre de segments hors de l’horloge est refusé', () => {
    const document = front();
    document['segments'] = 5;
    document['portents'] = ['a', 'b', 'c', 'd', 'e'];
    expect(FrontSchema.safeParse(document).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// NŒUD — trois pistes, et trois pistes qui MÈNENT AILLEURS
describe('nœud : au moins trois pistes sortantes', () => {
  it('trois passe, deux échoue, et le message nomme le nœud', () => {
    // Le 3 vient du critère d'acceptation (règle des trois indices inversée,
    // §3 de 04-scenarios.md) : il s'écrit en toutes lettres et ne se lit pas
    // depuis le schéma qu'il vérifie.
    const document = node();
    expect((document['leads'] as unknown[]).length).toBe(3);
    expect(NodeSchema.safeParse(document).success).toBe(true);

    document['leads'] = (document['leads'] as unknown[]).slice(0, 2);
    const refused = NodeSchema.safeParse(document);
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain('le-grenier-vide');
  });

  it('trois pistes vers le même nœud ne font pas trois sorties', () => {
    const document = node();
    document['leads'] = [
      { toNodeId: 'le-convoi-retourne', trigger: 'On suit les traces.' },
      { toNodeId: 'le-convoi-retourne', trigger: 'On interroge le charretier.' },
      { toNodeId: 'le-convoi-retourne', trigger: 'On remonte le fleuve.' },
    ];
    const refused = NodeSchema.safeParse(document);
    expect(refused.success).toBe(false);
    // Le message doit dire CE QU'IL FAUT AJOUTER, pas seulement « invalide » :
    // trois lignes présentes et une seule sortie est le cas où un auteur se
    // croit conforme.
    expect(JSON.stringify(refused.error?.issues)).toContain('est écrite deux fois');
    expect(JSON.stringify(refused.error?.issues)).toContain('sortie(s) distincte(s)');
  });

  it('une piste qui revient au même nœud n’est pas une sortie', () => {
    const document = node();
    document['leads'] = [
      { toNodeId: 'le-grenier-vide', trigger: 'On fait le tour et on revient.' },
      { toNodeId: 'le-conseil-des-clans', trigger: 'On va le dire à ceux qui décident.' },
      { toNodeId: 'la-taverne-du-pont', trigger: 'On demande qui a vu passer des sacs.' },
    ];
    expect(NodeSchema.safeParse(document).success).toBe(false);
  });

  it('entryPoint vaut faux par défaut : un nœud d’entrée se déclare', () => {
    // S-02 règle 2 refuse un nœud atteignable depuis nulle part, SAUF s'il se
    // déclare entrée. Un défaut à `true` rendrait la règle inerte.
    const document = node();
    delete document['entryPoint'];
    const parsed = NodeSchema.parse(document);
    expect(parsed.entryPoint).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FIGURE — une figure ne porte aucun nombre de jeu
describe('figure : aucun chiffre de jeu', () => {
  it('aucun champ n’est un nombre, hors schemaVersion', () => {
    // La forme compte : on PARCOURT la shape au lieu d'épingler une liste.
    // Ajouter `strength: z.number()` à FigureSchema fait tomber ce test sans
    // que personne n'ait à l'éditer.
    const numeric: string[] = [];
    for (const [key, field] of Object.entries(FigureSchema.shape)) {
      let current: unknown = field;
      // eslint-disable-next-line no-constant-condition
      for (;;) {
        const def = (current as { def?: { type?: string; innerType?: unknown } }).def;
        if (def === undefined) break;
        if (def.innerType === undefined) {
          if (def.type === 'number') numeric.push(key);
          break;
        }
        current = def.innerType;
      }
    }
    // `schemaVersion` est un `z.literal(1)`, pas une statistique : son
    // `def.type` est `literal`, donc il ne devrait même pas être compté.
    expect(numeric).toStrictEqual([]);
  });

  it('un attribut de fiche glissé dans une figure est refusé', () => {
    const document = figure();
    document['attributes'] = { vif: 3, coeur: 2, fer: 2, ombre: 1, esprit: 1 };
    expect(FigureSchema.safeParse(document).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PÉRIODE — ce qui n'est pas encore vrai
describe('période : les deux bornes et les deux listes de factions', () => {
  it('une faction présente ET absente est refusée', () => {
    const document = period();
    document['absentFactionIds'] = ['avarosans'];
    const refused = PeriodSchema.safeParse(document);
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain('avarosans');
  });

  it('une borne haute sous la borne basse est refusée, l’inverse passe', () => {
    const document = period();
    document['after'] = 300;
    document['before'] = 200;
    expect(PeriodSchema.safeParse(document).success).toBe(false);
    document['before'] = 400;
    expect(PeriodSchema.safeParse(document).success).toBe(true);
  });

  it('les deux bornes acceptent null : une époque peut n’avoir ni début ni fin connus', () => {
    const document = period();
    document['after'] = null;
    document['before'] = null;
    expect(PeriodSchema.safeParse(document).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// RENCONTRE
describe('rencontre : genres de région', () => {
  it('reprend le tuple de region.ts, membre pour membre', () => {
    const element = EncounterSchema.shape.regionKinds.def.element as {
      options?: readonly string[];
    };
    expect(element.options).toStrictEqual(RegionKindSchema.options);
  });

  it('un genre écrit deux fois est refusé', () => {
    const document = encounter();
    document['regionKinds'] = ['site', 'site'];
    expect(EncounterSchema.safeParse(document).success).toBe(false);
  });

  it('une liste vide est refusée', () => {
    const document = encounter();
    document['regionKinds'] = [];
    expect(EncounterSchema.safeParse(document).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LES DEUX TUPLES QUI NE MIROITENT RIEN — épinglés en toutes lettres
//
// Le moteur n'a ni nœud ni rencontre : rien dans le dépôt ne peut les
// contredire, donc rien ne peut les garder non plus. C'est la forme retenue
// par `ai/tools.ts` pour ses propres tuples sans source, et la seule honnête.
describe('les tuples sans miroir, épinglés', () => {
  it('REGION_KINDS — les cinq genres de région, consommés par deux fichiers', () => {
    // `region.ts` les déclare, `encounter.ts` les réutilise. Le moteur n'a
    // aucune notion de région : rien ne peut les contredire, donc rien ne peut
    // les garder — sauf cette ligne.
    expect([...RegionKindSchema.options]).toStrictEqual([
      'royaume',
      'territoire',
      'etablissement',
      'site',
      'etendue',
    ]);
  });

  it('SCENARIO_NODE_KINDS', () => {
    expect([...SCENARIO_NODE_KINDS]).toStrictEqual([
      'lieu',
      'confrontation',
      'rencontre',
      'revelation',
    ]);
  });

  it('ENCOUNTER_KINDS — les cinq genres de la fiche S-03', () => {
    expect([...ENCOUNTER_KINDS]).toStrictEqual([
      'marchand',
      'allie',
      'bete',
      'trouvaille',
      'obstacle',
    ]);
  });

  it('un genre inventé est refusé de part et d’autre', () => {
    const badNode = node();
    badNode['kind'] = 'peripetie';
    expect(NodeSchema.safeParse(badNode).success).toBe(false);
    const badEncounter = encounter();
    badEncounter['kind'] = 'mystere';
    expect(EncounterSchema.safeParse(badEncounter).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// RESSORT — les quatre façons d'accrocher une bande
describe('ressort : appliesTo', () => {
  it.each([
    ['trait', { kind: 'trait', tag: 'commandement' }],
    ['faction', { kind: 'faction', factionId: 'avarosans' }],
    ['region', { kind: 'region', regionId: 'avarosa-reach' }],
    ['champion', { kind: 'champion', championId: 'braum' }],
  ])('accepte la forme « %s »', (_name, appliesTo) => {
    const document = hook();
    document['appliesTo'] = appliesTo;
    expect(HookSchema.safeParse(document).success).toBe(true);
  });

  it('refuse une cinquième forme, et un champ en trop dans une forme connue', () => {
    const invented = hook();
    invented['appliesTo'] = { kind: 'meteo', tag: 'blizzard' };
    expect(HookSchema.safeParse(invented).success).toBe(false);

    const extra = hook();
    extra['appliesTo'] = { kind: 'faction', factionId: 'avarosans', stance: 'hostile' };
    expect(HookSchema.safeParse(extra).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LES TROIS LISTES QUI APPARTIENNENT AU MOTEUR — réutilisées, pas recopiées
//
// L'égalité de VALEUR avec le moteur se prouve dans `exhaustive-union.test.ts`,
// seul fichier autorisé à importer une valeur de `@for/engine`. Ici on prouve
// l'autre moitié, celle qu'une comparaison de valeurs ne verrait pas : que ces
// trois champs sont LE MÊME OBJET que le miroir, donc qu'aucune seconde liste
// n'existe. Une recopie qui vaut la même chose passerait la première épreuve
// et tombe sur celle-ci.
describe('aucune seconde source de vérité', () => {
  it.each([
    ['segments du front', FrontSchema.shape.segments, zClockSegmentCount, SegmentCountSchema],
    ['rang du ressort', HookSchema.shape.vowRank, zProgressRank, RankSchema],
    [
      'disposition de la figure',
      FigureSchema.shape.disposition,
      zEntityDisposition,
      DispositionSchema,
    ],
  ])('%s est le miroir lui-même, pas une copie', (_name, field, mirror, alias) => {
    expect(field).toBe(mirror);
    expect(alias).toBe(mirror);
  });
});
