/**
 * LA FORGE DE FICHES, persistée.
 *
 * La validation V1→V12 est celle de `@for/ai`, pure, et elle a ses propres
 * tests là-bas. Ce qui se mesure ici est ce que le SERVEUR en fait : la ligne,
 * son `status`, et la décision arbitrée du §1.5 — jouable tout de suite dans
 * SA campagne, partageable seulement après relecture humaine.
 */

import { staticContent } from '@for/content';
import { FORGE_OMITTED_FIELDS } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { forgeChampionSheet, sheetHash } from '../../src/ai/forge-worker.js';
import { CAMPAIGN_ID, PLAYER_ID, anAiTable, scriptedNarrator } from './support.test.js';

const CONTENT = staticContent();
const EPOCH = 1_700_000_000_000;

/**
 * Une sortie de modèle VALIDE, dérivée d'une fiche écrite à la main.
 *
 * Plutôt qu'un objet inventé à la main qui dériverait du schéma au premier
 * champ ajouté : on prend une fiche du contenu, on lui retire les six champs
 * que le SERVEUR possède (`FORGE_OMITTED_FIELDS`), et c'est exactement ce que
 * le modèle est censé rendre.
 */
function aModelSheet(championId: string): Record<string, unknown> {
  const sheet = CONTENT.getChampion(championId) as unknown as Record<string, unknown>;
  const omitted = new Set<string>(FORGE_OMITTED_FIELDS);
  const out = Object.fromEntries(Object.entries(sheet).filter(([key]) => !omitted.has(key)));
  // DEUX ÉCARTS ENTRE UNE FICHE ÉCRITE À LA MAIN ET CE QUE LA FORGE EXIGE,
  // mesurés plutôt que devinés (`validateForge` les rend en V6 et V9) :
  //   - V6 veut TROIS atouts de départ distincts ; Braum en a deux ;
  //   - V9 veut un serment falsifiable — un verbe d'action et un objet nommé.
  // La forge est donc plus stricte que la main, et c'est ce que le test
  // corrige ici, pas un contournement : la sortie du modèle est censée les
  // respecter, la fiche manuscrite n'y était pas tenue.
  out['startingAssets'] = CONTENT.listAssets()
    .slice(0, 3)
    .map((asset) => asset.id);
  out['startingVow'] = {
    ...(out['startingVow'] as Record<string, unknown>),
    description: 'Ramener la porte de grange au village de Rakelstake avant la fonte.',
  };
  return out;
}

/**
 * La fiche demandée est CELLE dont la sortie du modèle est dérivée.
 *
 * V1 impose l'identifiant, V2 la région canonique et V7 refuse qu'un AUTRE
 * champion soit cité : demander « lissandra » en rendant la fiche de Braum les
 * viole toutes les trois, et la forge finit en `draft`. C'est le bon
 * comportement, et ce n'est pas ce que ce test-ci mesure.
 */
const input = (over: Record<string, unknown> = {}) => ({
  campaignId: CAMPAIGN_ID,
  requestedId: 'braum',
  canonicalRegionId: 'rakelstake',
  brief: 'Braum, le Cœur du Freljord.',
  allowedAssetIds: CONTENT.listAssets().map((asset) => asset.id),
  defaultAssetIds: CONTENT.listAssets()
    .slice(0, 1)
    .map((asset) => asset.id),
  championNames: CONTENT.listChampionIndex().map((entry) => entry.displayName),
  handwrittenSheetExists: false,
  forgedByPlayerId: PLAYER_ID,
  now: EPOCH,
  ...over,
});

const sheetRow = (connection: ReturnType<typeof anAiTable>['connection'], id: string) =>
  connection.prepare(`SELECT * FROM champion_sheets WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;

describe('une fiche forgée', () => {
  it('est jouable dans SA campagne, et n’est pas dans le cache global', async () => {
    const table = anAiTable();
    try {
      const narrator = scriptedNarrator({ answers: [], structured: [aModelSheet('braum')] });
      const outcome = await forgeChampionSheet(
        { connection: table.connection, narrator, ids: table.ids },
        input(),
      );
      expect(outcome.kind).toBe('forged');
      if (outcome.kind !== 'forged') return;
      expect(outcome.status).toBe('active');

      const row = sheetRow(table.connection, outcome.sheetId);
      // JOUABLE TOUT DE SUITE : `active`, dans la campagne qui a demandé.
      expect(row['status']).toBe('active');
      expect(row['campaign_id']).toBe(CAMPAIGN_ID);
      // ET PAS DANS LE CACHE GLOBAL : celui-ci est `campaign_id IS NULL`, et
      // seule une relecture humaine (`approved`) y met une fiche.
      expect(row['campaign_id']).not.toBeNull();
      expect(row['champion_id']).toBe('braum');
      expect(row['forged_by_player_id']).toBe(PLAYER_ID);
      expect(row['ai_call_id']).toBeTruthy();

      // LA LIGNE D'AUDIT : un appel, un `ai_calls`.
      expect(
        table.connection
          .prepare(`SELECT purpose, status FROM ai_calls WHERE id = ?`)
          .get(row['ai_call_id']),
      ).toEqual({ purpose: 'forge', status: 'ok' });
    } finally {
      table.close();
    }
  });

  it('garde la sortie brute et les constats, pour qu’on puisse mesurer la forge', async () => {
    const table = anAiTable();
    try {
      const raw = aModelSheet('braum');
      const narrator = scriptedNarrator({ answers: [], structured: [raw] });
      const outcome = await forgeChampionSheet(
        { connection: table.connection, narrator, ids: table.ids },
        input(),
      );
      if (outcome.kind !== 'forged') throw new Error('forge échouée');
      const row = sheetRow(table.connection, outcome.sheetId);
      expect(JSON.parse(row['raw_output_json'] as string)).toEqual(raw);
      expect((JSON.parse(row['repairs_json'] as string) as unknown[]).length).toBeGreaterThan(0);
      // LA FICHE STOCKÉE EST LA COMPLÉTÉE, pas la brute : elle porte les six
      // champs du serveur.
      const stored = JSON.parse(row['sheet_json'] as string) as Record<string, unknown>;
      // CINQ DES SIX champs retirés au modèle sont réécrits par le serveur.
      // Le sixième, `portraitUrl`, est OPTIONNEL et reste absent : le serveur
      // n'a pas de portrait à poser, et écrire `null` serait inventer une
      // valeur. Les cinq sont nommés un par un, parce qu'une boucle sur
      // `FORGE_OMITTED_FIELDS` exigerait aussi le sixième et serait fausse.
      for (const field of ['schemaVersion', 'id', 'source', 'relations', 'aliases']) {
        expect(stored).toHaveProperty(field);
      }
      expect(FORGE_OMITTED_FIELDS).toHaveLength(6);
      expect(stored).not.toHaveProperty('portraitUrl');
      expect(stored['id']).toBe('braum');
      expect(stored['source']).toBe('forged');
    } finally {
      table.close();
    }
  });

  it('une sortie que rien ne peut réparer finit en `draft`, conservée pour analyse', async () => {
    const table = anAiTable();
    try {
      // Trois sorties hors schéma : deux relances, puis le `draft` du §9.5.
      const narrator = scriptedNarrator({
        answers: [],
        structured: [{ pas: 'une fiche' }, { pas: 'une fiche' }, { pas: 'une fiche' }],
      });
      const outcome = await forgeChampionSheet(
        { connection: table.connection, narrator, ids: table.ids },
        input(),
      );
      expect(outcome.kind).toBe('forged');
      if (outcome.kind !== 'forged') return;
      expect(outcome.status).toBe('draft');
      expect(outcome.attempts).toBe(3);
      // TROIS APPELS : l'original et les deux relances de `FORGE_RETRIES_MAX`.
      expect(narrator.structureRequests).toHaveLength(3);
      // Les relances portent les `<corrections>`, et pas la première.
      expect(JSON.stringify(narrator.structureRequests[0]?.messages)).not.toContain(
        '<corrections>',
      );
      expect(JSON.stringify(narrator.structureRequests[1]?.messages)).toContain('<corrections>');

      const row = sheetRow(table.connection, outcome.sheetId);
      expect(row['status']).toBe('draft');
      expect(row['raw_output_json']).toBe('{"pas":"une fiche"}');
    } finally {
      table.close();
    }
  });

  it('une panne du port n’écrit aucune fiche, et journalise le code du port', async () => {
    const table = anAiTable();
    try {
      const narrator = scriptedNarrator({
        answers: [],
        structured: [{ throws: Object.assign(new Error('coupé'), { code: 'unsupported' }) }],
      });
      const outcome = await forgeChampionSheet(
        { connection: table.connection, narrator, ids: table.ids },
        input(),
      );
      expect(outcome.kind).toBe('failed');
      expect(table.connection.prepare(`SELECT COUNT(*) AS n FROM champion_sheets`).get()).toEqual({
        n: 0,
      });
      expect(
        table.connection
          .prepare(`SELECT status, error_code FROM ai_calls ORDER BY rowid DESC LIMIT 1`)
          .get(),
      ).toEqual({ status: 'error', error_code: 'unsupported' });
    } finally {
      table.close();
    }
  });
});

describe('le hash de contenu', () => {
  it('ne dépend pas de l’ordre des clés', () => {
    expect(sheetHash({ a: 1, b: [2, { c: 3 }] })).toBe(sheetHash({ b: [2, { c: 3 }], a: 1 }));
  });

  it('et change quand le contenu change', () => {
    // LA MOITIÉ QU'ON OUBLIE : un hash stable qui serait stable pour TOUT ne
    // garderait rien.
    expect(sheetHash({ a: 1 })).not.toBe(sheetHash({ a: 2 }));
    expect(sheetHash({ a: [1, 2] })).not.toBe(sheetHash({ a: [2, 1] }));
  });
});
