/**
 * 10 000 HOSTILE FRAMES THROUGH `zC2SEnvelope.safeParse` — M0-08.
 *
 * WHAT IS ACTUALLY BEING TESTED, and it is not "does Zod work". Every incoming
 * frame passes through `safeParse` BEFORE ANYTHING ELSE (01-architecture.md
 * section 2.4). If one malformed frame can make that call THROW instead of
 * returning `{ success: false }`, the handler's error path runs on a socket
 * that has not been authenticated yet — and a single crafted frame becomes a
 * denial of service against the whole process. `safeParse` returning false is
 * the normal, boring, required outcome.
 *
 * THE GENERATOR IS SEEDED AND LOCAL. No `Math.random()`: a fuzz test that
 * fails once a week and never again teaches nothing. No `@for/testkit` either
 * — `@for/contracts` depends on `zod` and on type-only imports of the engine,
 * and a dev dependency here would be a runtime edge in the graph
 * `contracts -> testkit` that `pnpm depcruise` would be right to refuse. The
 * generator below is twelve lines of sfc32-flavoured arithmetic, and it is
 * reproducible for exactly that reason.
 *
 * DEPTH 50 IS THE ONE THAT MATTERS. A recursive schema and a deep payload is
 * how a validator is made to blow the stack. `zC2SEnvelope` is a discriminated
 * union, so it decides on `t` before it ever looks at `p` — which is precisely
 * the property this file measures rather than assumes.
 */
import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '../src/version.js';
import { zC2SEnvelope } from '../src/ws/c2s.js';

const TIRAGES = 10_000;
const PROFONDEUR = 50;
/** Fixed seed. Same 10 000 frames on every machine, on every day. */
const GRAINE = 0xf7e1_0a5d;

/** Deterministic 32-bit generator. Same seed, same 10 000 frames, always. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e37_79b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0_aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a_2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 0x1_0000_0000;
  };
}

const CARACTERES =
  '{}[]",:\\/\u0000\u001b�0123456789abcdefABCDEF.-+eE \n\t\'`~!@#$%^&*()=<>?|;éœ😀';

function chaine(next: () => number, longueur: number): string {
  let out = '';
  for (let i = 0; i < longueur; i += 1) {
    out += CARACTERES.charAt(Math.floor(next() * CARACTERES.length));
  }
  return out;
}

/** An object nested `PROFONDEUR` levels deep, the classic stack-eater. */
function profond(feuille: unknown): unknown {
  let node: unknown = feuille;
  for (let i = 0; i < PROFONDEUR; i += 1) node = { p: node, n: i };
  return node;
}

function scalaireAleatoire(next: () => number): unknown {
  switch (Math.floor(next() * 8)) {
    case 0:
      return chaine(next, Math.floor(next() * 40));
    case 1:
      return Math.floor(next() * 1e9) - 5e8;
    case 2:
      return next() * 1e9;
    case 3:
      return next() < 0.5;
    case 4:
      return null;
    case 5:
      return undefined;
    case 6:
      return Number.NaN;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

const TYPES_CONNUS = [
  'c2s.hello',
  'c2s.intent',
  'c2s.speak',
  'c2s.typing',
  'c2s.resume',
  'c2s.pong',
  'c2s.resume_narration',
  'c2s.why',
];

/** Twelve families, from plain garbage to a frame that is almost right. */
function entree(next: () => number, i: number): unknown {
  switch (i % 12) {
    // Bare strings, including things that look like JSON but are not.
    case 0:
      return chaine(next, Math.floor(next() * 200));
    case 1:
      return `{"v":1,"t":"c2s.intent","p":${chaine(next, 20)}`;
    // Binary, which is what a client sends when it sends the wrong frame type.
    case 2:
      return new Uint8Array(Array.from({ length: 32 }, () => Math.floor(next() * 256)));
    case 3:
      return Buffer.from(chaine(next, 24), 'utf8');
    // Scalars where an object is expected.
    case 4:
      return scalaireAleatoire(next);
    // Deeply nested payloads.
    case 5:
      return profond(scalaireAleatoire(next));
    case 6:
      return {
        v: PROTOCOL_VERSION,
        t: TYPES_CONNUS[Math.floor(next() * TYPES_CONNUS.length)],
        id: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b',
        p: profond(scalaireAleatoire(next)),
      };
    // Arrays, empty objects, and objects whose keys are numbers.
    case 7:
      return Array.from({ length: Math.floor(next() * 12) }, () => scalaireAleatoire(next));
    case 8:
      return { [Math.floor(next() * 100)]: scalaireAleatoire(next) };
    // Frames that are nearly valid: right shape, one field poisoned. These are
    // the interesting ones — a validator that short-circuits too early on the
    // discriminant would never reach them.
    case 9:
      return {
        v: scalaireAleatoire(next),
        t: TYPES_CONNUS[Math.floor(next() * TYPES_CONNUS.length)],
        id: chaine(next, 36),
        p: {},
      };
    case 10:
      return {
        v: PROTOCOL_VERSION,
        t: chaine(next, 12),
        id: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b',
        p: { intent: { type: chaine(next, 10) } },
      };
    default:
      return {
        v: PROTOCOL_VERSION,
        t: 'c2s.speak',
        id: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b',
        p: { channel: chaine(next, 4), text: chaine(next, Math.floor(next() * 4000)) },
      };
  }
}

describe('zC2SEnvelope face à 10 000 entrées hostiles', () => {
  it('aucune ne lève : toutes reviennent en { success: false }', () => {
    const next = rng(GRAINE);
    const leves: string[] = [];
    let acceptees = 0;

    for (let i = 0; i < TIRAGES; i += 1) {
      const brut = entree(next, i);
      try {
        const resultat = zC2SEnvelope.safeParse(brut);
        if (resultat.success) acceptees += 1;
      } catch (error) {
        leves.push(`#${String(i)} : ${String(error)}`);
      }
    }

    expect(leves).toStrictEqual([]);
    // Le corpus est du bruit : rien ne doit passer. Si cette ligne rougit, ce
    // n'est pas le fuzz qui est faux, c'est le schéma qui s'est élargi.
    expect(acceptees).toBe(0);
  });

  it('le corpus est reproductible : deux passes, deux fois les mêmes entrées', () => {
    // Sans ça, « 10 000 entrées » ne voudrait rien dire d'un jour à l'autre.
    const a = rng(GRAINE);
    const b = rng(GRAINE);
    for (let i = 0; i < 200; i += 1) {
      expect(JSON.stringify(entree(a, i) ?? null)).toBe(JSON.stringify(entree(b, i) ?? null));
    }
  });

  it('et une trame VALIDE passe : le refus systématique ne vient pas d’un schéma mort', () => {
    // L'autre sens. Un `safeParse` qui refuserait tout serait « vert » sur le
    // corpus hostile pour la pire des raisons.
    const valides = [
      { t: 'c2s.pong', p: {} },
      { t: 'c2s.typing', p: { typing: true } },
      { t: 'c2s.resume', p: { sinceDeliverySeq: 0 } },
      { t: 'c2s.hello', p: { clientVersion: '0.1.0', lastDeliverySeq: null } },
      { t: 'c2s.speak', p: { channel: 'ic', text: 'Katla ne se lève pas.' } },
      { t: 'c2s.why', p: { correlationId: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6c' } },
      { t: 'c2s.resume_narration', p: { narrationId: 'n-412', lastChunk: 7 } },
      { t: 'c2s.intent', p: { intent: { type: 'campaign.leave' } } },
    ];
    for (const { t, p } of valides) {
      const resultat = zC2SEnvelope.safeParse({
        v: PROTOCOL_VERSION,
        t,
        id: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b',
        p,
      });
      expect(resultat.success, `${t} devrait passer`).toBe(true);
    }
  });

  it('une charge utile de profondeur 50 est refusée sans faire sauter la pile', () => {
    const resultat = zC2SEnvelope.safeParse({
      v: PROTOCOL_VERSION,
      t: 'c2s.why',
      id: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b',
      p: profond('x'),
    });
    expect(resultat.success).toBe(false);
  });
});
