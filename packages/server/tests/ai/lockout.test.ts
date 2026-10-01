/**
 * LE VERROUILLAGE DE DISTRIBUTION, relu au retour de la prose — et le serveur
 * qui ne connaît aucun SDK de fournisseur.
 */

import { readFileSync, readdirSync } from 'node:fs';

import { staticContent } from '@for/content';
import { describe, expect, it } from 'vitest';

import { championLocks, championOfCharacter, reservedChampions } from '../../src/ai/lockout.js';
import { CAMPAIGN_ID, CHARACTER_ID, OTHER_CHARACTER_ID, anAiTable } from './support.test.js';

const CONTENT = staticContent();

describe('qui est réservé, relu depuis la projection', () => {
  it('rend les champions des AUTRES joueurs, avec tous leurs alias', () => {
    const table = anAiTable();
    try {
      const own = championOfCharacter(table.connection, CAMPAIGN_ID, CHARACTER_ID);
      expect(own).toBe('ashe');

      const reserved = reservedChampions(table.connection, CONTENT, CAMPAIGN_ID, [own ?? '']);
      // LE CHAMPION DE L'ACTEUR EST EXCLU : le conteur écrit sur lui, et un
      // filtre qui refuserait son nom refuserait chaque tour.
      expect(reserved.map((champion) => champion.displayName)).not.toContain('Ashe');
      const braum = reserved.find((champion) => champion.displayName === 'Braum');
      expect(braum).toBeDefined();
      // LES ALIAS VIENNENT DU CONTENU, pas du journal : un surnom manquant est
      // un trou dans le verrou (risque 5 du §9).
      expect(braum?.aliases.length).toBeGreaterThan(0);
      expect(braum?.aliases).toEqual(
        CONTENT.listChampionIndex().find((entry) => entry.id === 'braum')?.aliases,
      );
    } finally {
      table.close();
    }
  });

  it('sans exclusion, les DEUX champions de la table sont réservés', () => {
    const table = anAiTable();
    try {
      const reserved = reservedChampions(table.connection, CONTENT, CAMPAIGN_ID);
      expect(reserved.map((champion) => champion.displayName).sort()).toEqual(['Ashe', 'Braum']);
      expect(championOfCharacter(table.connection, CAMPAIGN_ID, OTHER_CHARACTER_ID)).toBe('braum');
    } finally {
      table.close();
    }
  });

  it('un champion absent de l’index garde son identifiant pour seul nom', () => {
    const table = anAiTable();
    try {
      // Un verrou sur un identifiant que `champions-index.json` ne connaît pas.
      table.connection
        .prepare(
          `INSERT INTO campaign_champion_locks
             (campaign_id, champion_id, lock_kind, reason, set_seq)
           VALUES (?, 'champion-inconnu', 'reserved_pc', '', 1)`,
        )
        .run(CAMPAIGN_ID);
      const reserved = reservedChampions(table.connection, CONTENT, CAMPAIGN_ID);
      const unknown = reserved.find((champion) => champion.displayName === 'champion-inconnu');
      // BRUYANT PLUTÔT QUE SILENCIEUX : il figure dans la liste, sans alias,
      // au lieu de disparaître du filtre.
      expect(unknown).toEqual({ displayName: 'champion-inconnu', aliases: [] });
    } finally {
      table.close();
    }
  });

  it('les verrous qui ne sont pas des réservations de joueur ne réservent rien', () => {
    const table = anAiTable();
    try {
      table.connection
        .prepare(
          `INSERT INTO campaign_champion_locks
             (campaign_id, champion_id, lock_kind, reason, set_seq)
           VALUES (?, 'lissandra', 'allowed_npc', '', 1)`,
        )
        .run(CAMPAIGN_ID);
      expect(championLocks(table.connection, CAMPAIGN_ID).map((lock) => lock.lockKind)).toContain(
        'allowed_npc',
      );
      // ET LA LISTE DU POST-FILTRE NE LE PREND PAS : un PNJ autorisé est
      // exactement ce que le conteur a le droit de nommer.
      expect(
        reservedChampions(table.connection, CONTENT, CAMPAIGN_ID).map(
          (champion) => champion.displayName,
        ),
      ).not.toContain('Lissandra');
    } finally {
      table.close();
    }
  });

  it('la portée est la CAMPAGNE : le roster d’une autre table ne fuite pas', () => {
    const table = anAiTable();
    try {
      // Une ligne d'une autre campagne ne doit pas remonter. Elle ne peut pas
      // être insérée (clé étrangère), donc la garantie se lit sur la requête :
      // elle est cadrée par `campaign_id`, et un identifiant inconnu rend vide.
      expect(championLocks(table.connection, 'une-autre-campagne')).toEqual([]);
      expect(reservedChampions(table.connection, CONTENT, 'une-autre-campagne')).toEqual([]);
    } finally {
      table.close();
    }
  });
});

describe('le serveur ne connaît aucun SDK de fournisseur', () => {
  const serverSrc = new URL('../../src/', import.meta.url);

  it('aucun `@anthropic-ai/sdk` dans `packages/server/src`', () => {
    // LE GREP DU CRITÈRE, rejoué à chaque exécution.
    const hits: string[] = [];
    for (const file of walk(serverSrc)) {
      if (readFileSync(file, 'utf8').includes('@anthropic-ai/sdk')) hits.push(file.pathname);
    }
    expect(hits).toEqual([]);
  });

  it('et il n’importe aucun paquet de fournisseur, sous aucun nom', () => {
    // La sonde est plus large que le critère, et elle nomme ce qu'elle
    // cherche : un `import` dont la source contient un nom de fournisseur.
    const vendors = ['anthropic', 'openai', 'ollama', 'groq', 'together', 'openrouter'];
    const hits: string[] = [];
    for (const file of walk(serverSrc)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/^\s*import\s[^\n]*from\s+'([^']+)'/gmu)) {
        const from = match[1] ?? '';
        if (vendors.some((vendor) => from.toLowerCase().includes(vendor))) {
          hits.push(`${file.pathname} → ${from}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('la sonde n’est pas vide : elle voit les imports qui existent', () => {
    // SANS CETTE LIGNE, un parcours cassé rendrait les deux tests ci-dessus
    // verts pour la mauvaise raison.
    const files = walk(serverSrc);
    expect(files.length).toBeGreaterThan(20);
    const imports = files.flatMap((file) => [
      ...readFileSync(file, 'utf8').matchAll(/^\s*import\s[^\n]*from\s+'([^']+)'/gmu),
    ]);
    expect(imports.length).toBeGreaterThan(50);
    expect(imports.map((match) => match[1])).toContain('@for/contracts');
  });
});

function walk(root: URL): URL[] {
  const out: URL[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, root);
    if (entry.isDirectory()) out.push(...walk(child));
    else if (entry.name.endsWith('.ts')) out.push(child);
  }
  return out;
}
