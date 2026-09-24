/**
 * `BEGIN IMMEDIATE`, LES DEUX MOITIÉS DE LA PREUVE.
 *
 * La fiche imprime `BEGIN IMMEDIATE` en toutes lettres comme livrable, et rien
 * ne le mesurait : remplacer `.immediate()` par `.deferred()` dans les deux
 * dépôts laissait toute la suite verte. Par la règle du projet, un garde-fou
 * non prouvé est considéré comme absent — donc celui-ci l'était.
 *
 * Le prouver demande deux mesures, parce que deux choses différentes peuvent
 * être fausses :
 *
 *   1. QUE LE MODE FASSE QUELQUE CHOSE. Mesuré en violant : un autre écrivain
 *      tient le verrou, la transaction IMMÉDIATE est refusée au `BEGIN`, la
 *      DIFFÉRÉE passe. Rouge avec le mode, vert sans : c'est le mode lui-même
 *      qui mord, pas le hasard du moteur.
 *   2. QUE LES DEUX CHEMINS D'ÉCRITURE PASSENT PAR LÀ. Mesuré en observant la
 *      connexion que `appendEvents` et `settleIntentOnce` reçoivent : le
 *      variant appelé est enregistré. Écrire `.deferred()` ou laisser le mode
 *      par défaut rend ce test rouge à l'instant.
 *
 * La mesure 1 seule ne dirait rien du dépôt ; la mesure 2 seule ne dirait rien
 * du moteur. Ensemble elles disent la phrase entière.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { SqliteConnection } from '../src/client.js';
import { openSqlite } from '../src/client.js';
import type { AppendableEvent } from '../src/repositories/events.js';
import { appendEvents } from '../src/repositories/events.js';
import { settleIntentOnce } from '../src/repositories/intents.js';
import type { TempDb } from '../src/testing.js';
import { migratedTempDb, seedCampaign } from '../src/testing.js';

const NOW = 1_700_000_000_000;

let open: TempDb | undefined;
let second: SqliteConnection | undefined;
afterEach(() => {
  second?.close();
  second = undefined;
  open?.close();
  open = undefined;
});

function seeded(): TempDb {
  const db = migratedTempDb();
  open = db;
  seedCampaign(db.connection, { playerId: 'p1', campaignId: 'c1' });
  return db;
}

function tableEvent(id: string): AppendableEvent {
  return {
    id,
    type: 'narration.gm_message',
    payload: { n: id },
    actorKind: 'engine',
    scope: 'table',
    createdAt: NOW,
  };
}

// ─────────────── 1. le mode fait quelque chose, mesuré ───────────────

describe('le verrou d’écriture est pris dès le BEGIN', () => {
  it('verrou tenu ailleurs : la transaction immédiate est refusée, la différée passe', () => {
    const db = seeded();
    // Sans cela, la tentative attendrait les 5 s de `busy_timeout` avant de
    // rendre la main : c'est le même refus, mais la suite durerait 5 s.
    db.connection.pragma('busy_timeout = 0');

    second = openSqlite(db.path);
    second.exec('BEGIN IMMEDIATE');

    const lecture = (): unknown => db.connection.prepare(`SELECT count(*) AS n FROM events`).get();

    // ROUGE AVEC le mode immédiat : le verrou est demandé au BEGIN, avant la
    // moindre lecture, et il n'est pas libre.
    let refus: unknown;
    expect(() => {
      try {
        db.connection.transaction(lecture).immediate();
      } catch (erreur) {
        refus = erreur;
        throw erreur;
      }
    }).toThrow(/database is locked/u);
    expect((refus as { code?: string }).code).toBe('SQLITE_BUSY');

    // VERT SANS : exactement la même transaction, en différé, entre sans
    // rien demander — c'est ce que le dépôt refuse de faire.
    expect(db.connection.transaction(lecture).deferred()).toEqual({ n: 0 });

    second.exec('ROLLBACK');
  });
});

// ─────────── 2. les deux chemins d'écriture passent par là ───────────

type Variadic = (...args: readonly unknown[]) => unknown;

interface ModeSpy {
  /** Les variants de transaction réellement appelés, dans l'ordre. */
  readonly modes: string[];
  readonly connection: SqliteConnection;
}

/**
 * La même connexion, qui note par quel variant de transaction on est passé.
 *
 * Rien n'est simulé : chaque appel est transmis au vrai objet de
 * better-sqlite3, si bien que le test mesure le comportement complet du dépôt
 * et pas une maquette.
 */
function watchTransactionModes(real: SqliteConnection): ModeSpy {
  const modes: string[] = [];
  const connection = new Proxy(real, {
    get(target, property): unknown {
      if (property === 'transaction') {
        return (fn: Variadic): unknown => {
          const made = target.transaction(fn as never) as unknown as Record<string, Variadic> &
            Variadic;
          const record =
            (mode: string, variant: Variadic): Variadic =>
            (...args) => {
              modes.push(mode);
              return variant(...args);
            };
          return Object.assign(
            record('default', (...args) => made(...args)),
            {
              default: record('default', (...args) => made['default']!(...args)),
              deferred: record('deferred', (...args) => made['deferred']!(...args)),
              immediate: record('immediate', (...args) => made['immediate']!(...args)),
              exclusive: record('exclusive', (...args) => made['exclusive']!(...args)),
            },
          );
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as Variadic).bind(target) : value;
    },
  });
  return { modes, connection };
}

describe('les deux chemins d’écriture ouvrent en IMMEDIATE', () => {
  it('appendEvents n’ouvre que des transactions immédiates', () => {
    const db = seeded();
    const spy = watchTransactionModes(db.connection);

    const written = appendEvents(spy.connection, {
      campaignId: 'c1',
      events: [tableEvent('e1'), tableEvent('e2')],
      now: NOW,
    });

    expect(written.events).toHaveLength(2);
    expect(spy.modes).toEqual(['immediate']);
  });

  it('settleIntentOnce n’ouvre que des transactions immédiates', () => {
    const db = seeded();
    const spy = watchTransactionModes(db.connection);

    const outcome = settleIntentOnce(
      spy.connection,
      {
        id: 'ci-0001',
        campaignId: 'c1',
        playerId: 'p1',
        type: 'move.strike',
        payload: {},
        receivedAt: NOW,
      },
      () => ({ kind: 'apply', events: [tableEvent('e1')] }),
    );

    expect(outcome.status).toBe('applied');
    // Deux transactions : celle de l'intention et celle du lot, imbriquées.
    expect(spy.modes).toEqual(['immediate', 'immediate']);
  });

  it('un lot vide ne sort pas indemne par une transaction différée', () => {
    const db = seeded();
    const spy = watchTransactionModes(db.connection);
    appendEvents(spy.connection, { campaignId: 'c1', events: [], now: NOW });
    // Rien à écrire, rien à verrouiller : aucune transaction du tout.
    expect(spy.modes).toEqual([]);
  });
});
