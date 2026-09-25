/**
 * THE PROTOCOL, FROZEN — invariant 3 (ARCHITECTURE.md section 1), ADR 0008,
 * ADR 0010 decision 1.
 *
 * WHAT THIS FILE IS FOR. `ARCHITECTURE.md` names it as the test that breaks
 * the build when a client message starts carrying a result. It does that by
 * WALKING the whole `c2s` schema graph — through `zIntent`, not stopping at
 * it — and comparing what it finds against a frozen enumeration.
 *
 * WHY AN ENUMERATION AND NOT A DENY-LIST. ADR 0007's operating rule, applied
 * to a different mirror: « les importantes » is not a criterion. A list of the
 * result-carrying fields we happened to think of would miss `gaugeDelta`,
 * `outcomeHint`, `rollTotal`. The frozen key set catches ANY new name, whatever
 * it is called. The deny-list further down is kept anyway, because it states
 * the intent in words a reviewer can read — but it is the second net, never
 * the first.
 *
 * WHY THE WALKER THROWS ON AN UNKNOWN NODE KIND. A walker that silently
 * skipped a combinator it did not recognise would go green on a schema it
 * never looked at. That is the shape of a lie, and it is exactly the failure
 * mode ADR 0007 documents for `satisfies`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE BARREL OF @for/engine, ENUMERATED — the operating rule of ADR 0007.
 *
 * 53 runtime exports (47 constants, 6 functions). THIS TASK COPIES NONE OF
 * THEM, and that is the justification, export by export rather than in bulk:
 *
 *   - The 47 constants are already compared, in both directions, by
 *     `exhaustive-union.test.ts` (or justified there as not copied). Nothing in
 *     `src/ws/` or `src/http/` retypes one. Where the protocol needs an
 *     engine-derived list it REUSES THE EXISTING NODE instead of copying it:
 *       zRuleViolationCode  -> `zRejectionCode` (ws/codes.ts)
 *       zIntent             -> `c2s.intent`
 *       zGameEvent          -> `s2c.event`, `s2c.events_batch`, the HTTP log
 *       zSpeechSayIntent    -> `c2s.speak`'s `channel` and `text`, BY REFERENCE
 *       zNarrationGmMessagePayload -> `s2c.narration_done`'s text/model/source
 *       zCampaignStatus, zCharacterStatus, zSheetSource -> the HTTP DTOs
 *       zTurnProof, zTableState -> `s2c.turn_proof`, `s2c.snapshot`
 *     A reused node cannot drift from its mirror, so it needs no second guard.
 *     The reuse itself IS guarded, at runtime, by `les noeuds partages` below.
 *   - `ok`, `err`, `isOk`, `isErr`, `createSeededRng`, `createCampaignRng` are
 *     functions of the engine's internals. The wire never carries a `Result`
 *     and never carries a seed — `zTableState` strips `rng` precisely so a
 *     browser cannot compute a roll before declaring it. Nothing to mirror.
 *
 *   The values this task DOES declare from scratch have no engine counterpart
 *   at all: they are protocol vocabulary, fixed by 01-architecture.md sections
 *   5, 5.4, 5.5 and 5.6, by 02-mj-ia.md section 6.3, and — for `src/http/**` —
 *   by section 6. Each is compared below, VALUE BY VALUE, against the section
 *   that fixes it, which is the closest thing to a mirror it has:
 *
 *     WS_CLOSE_CODES                    -> §5.5, les huit numéros
 *     WS_RATE_LIMITS                    -> §5.6, les cinq seaux
 *     WS_MAX_INCOMING/OUTGOING_FRAME_BYTES, WS_HEARTBEAT_INTERVAL_MS,
 *     WS_HEARTBEAT_TIMEOUT_MS           -> §5
 *     WS_RATE_LIMIT_STRIKES_BEFORE_CLOSE -> §5.6
 *     WS_SOCKET_QUEUE_MAX_MESSAGES      -> 02-mj-ia §6.3
 *     zNarrationErrorCode               -> §5.4
 *     zNarrationStatus                  -> 02-mj-ia §6.3
 *     zEnvelopeHead, zWsErrorCode       -> §5.1 et §3.3
 *     la surface HTTP et ses constantes -> §6 et 03-donnees §6.7
 *
 *   CETTE LISTE A ÉTÉ FAUSSE. La version précédente affirmait « each is
 *   compared below » alors que `zNarrationStatus`, `zNarrationErrorCode` et
 *   trois seaux sur cinq n'étaient comparés nulle part : mesuré en recette,
 *   `zNarrationErrorCode` réduit à `z.enum(['nimporte_quoi'])` sortait 290/290
 *   vert. Un garde-fou AFFIRMÉ qui ne garde rien est le cas que ce dépôt tient
 *   pour pire qu'une règle absente (ADR 0002, ADR 0007). La phrase n'a pas été
 *   adoucie : les assertions manquantes ont été écrites.
 */
import {
  ATTRIBUTES,
  GAME_EVENT_TYPES,
  GAUGES,
  INTENT_TYPES,
  MOVE_IDS,
  OUTCOMES,
  RNG_STREAMS,
} from '@for/engine';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  zCampaignStatus,
  zCharacterStatus,
  zRuleViolationCode,
  zSheetSource,
} from '../src/core/enums.js';
import { zTableState } from '../src/dto/table-state.js';
import {
  TURN_PROOF_LABEL_MAX,
  TURN_PROOF_MAX_BYTES,
  TURN_PROOF_MAX_EFFECTS,
  TURN_PROOF_TEXT_MAX,
  zTurnProof,
} from '../src/dto/turn-proof.js';
import { APP_ERROR_CODES, zAppErrorCode } from '../src/errors.js';
import { eventEnvelopeShape, zEventEnvelope } from '../src/events/envelope.js';
import { zGameEvent } from '../src/events/index.js';
import { zNarrationGmMessagePayload } from '../src/events/narrative.js';
import {
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  DEV_ALLOWED_ORIGIN,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  zAuthCallbackErrorQuery,
  zAuthCallbackQuery,
  zAuthStartQuery,
  zCsrfHeaders,
  zLogoutResponse,
} from '../src/http/auth.js';
import { zCharacterSummary, zMeResponse, zPlayerProfile } from '../src/http/characters.js';
import {
  CONTENT_CACHE_CONTROL,
  zContentDocParams,
  zContentDocResponse,
  zContentManifestResponse,
} from '../src/http/content.js';
import {
  ADMIN_HEALTH_BACKUP_MAX_AGE_MS,
  ADMIN_HEALTH_MIN_FREE_DISK_RATIO,
  ADMIN_HEALTH_WAL_MAX_BYTES,
  zAdminHealthResponse,
  zHealthzResponse,
  zReadyzResponse,
} from '../src/http/health.js';
import {
  CAMPAIGN_LOG_PAGE_MAX,
  zCampaignDetailResponse,
  zCampaignListResponse,
  zCampaignLogEntry,
  zCampaignLogQuery,
  zCampaignLogResponse,
  zCampaignParams,
  zCampaignSummary,
  zCreateCampaignBody,
} from '../src/http/tables.js';
import { zIntent, zSpeechSayIntent } from '../src/intents/index.js';
import { PROTOCOL_VERSION } from '../src/version.js';
import {
  WS_RATE_LIMITS,
  c2sMessageTypesOfSchema,
  zC2SEnvelope,
  zC2SMessage,
  zC2SResume,
  zC2SWhy,
} from '../src/ws/c2s.js';
import {
  WS_CLOSE_CODES,
  WS_CLOSE_REASONS,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
  WS_MAX_INCOMING_FRAME_BYTES,
  WS_MAX_OUTGOING_FRAME_BYTES,
  WS_RATE_LIMIT_STRIKES_BEFORE_CLOSE,
  WS_SOCKET_QUEUE_MAX_MESSAGES,
  zRejectionCode,
  zWsErrorCode,
} from '../src/ws/codes.js';
import { zEnvelopeHead } from '../src/ws/envelope.js';
import {
  fitsOutgoingFrame,
  s2cMessageTypesOfSchema,
  zNarrationErrorCode,
  zNarrationSource,
  zNarrationStatus,
  zS2CEnvelope,
  zS2CEvent,
  zS2CMessage,
} from '../src/ws/s2c.js';

// ───────────────────────────────────────────────────── le marcheur de schéma

type AnySchema = z.ZodType;
interface ZodInternals {
  readonly _zod: { readonly def: Record<string, unknown> };
}

interface WalkResult {
  /** Every object key name reachable from the root, deduplicated. */
  readonly keys: ReadonlySet<string>;
  /** Every schema node visited, by reference. */
  readonly nodes: ReadonlySet<unknown>;
}

function defOf(node: AnySchema): Record<string, unknown> {
  return (node as unknown as ZodInternals)._zod.def;
}

/**
 * Walks a Zod graph exhaustively. THROWS on a node kind it does not know:
 * a schema this walker cannot read must stop the test, not be skipped.
 */
function walk(root: AnySchema): WalkResult {
  const keys = new Set<string>();
  const nodes = new Set<unknown>();

  const visit = (node: AnySchema): void => {
    if (nodes.has(node)) return;
    nodes.add(node);
    const def = defOf(node);
    const kind = def['type'] as string;
    switch (kind) {
      case 'object': {
        for (const [key, child] of Object.entries(def['shape'] as Record<string, AnySchema>)) {
          keys.add(key);
          visit(child);
        }
        return;
      }
      case 'union': {
        for (const option of def['options'] as AnySchema[]) visit(option);
        return;
      }
      case 'array':
        visit(def['element'] as AnySchema);
        return;
      case 'optional':
      case 'nullable':
      case 'default':
      case 'prefault':
      case 'nonoptional':
      case 'readonly':
        visit(def['innerType'] as AnySchema);
        return;
      case 'tuple': {
        for (const item of def['items'] as AnySchema[]) visit(item);
        if (def['rest']) visit(def['rest'] as AnySchema);
        return;
      }
      case 'record':
        visit(def['keyType'] as AnySchema);
        visit(def['valueType'] as AnySchema);
        return;
      case 'pipe':
        visit(def['in'] as AnySchema);
        visit(def['out'] as AnySchema);
        return;
      case 'intersection':
        visit(def['left'] as AnySchema);
        visit(def['right'] as AnySchema);
        return;
      case 'lazy':
        visit((def['getter'] as () => AnySchema)());
        return;
      // Leaves: they carry no child schema and no key name.
      case 'any':
      case 'bigint':
      case 'boolean':
      case 'custom':
      case 'date':
      case 'enum':
      case 'literal':
      case 'nan':
      case 'never':
      case 'null':
      case 'number':
      case 'string':
      case 'symbol':
      case 'undefined':
      case 'unknown':
      case 'void':
        return;
      default:
        throw new Error(
          `marcheur : type de noeud Zod non gere « ${kind} ». ` +
            `Un noeud non parcouru est un vert qui ment : ajoute le cas.`,
        );
    }
  };

  visit(root);
  return { keys, nodes };
}

const c2s = walk(zC2SMessage);
const s2c = walk(zS2CMessage);

/** Payload keys of one message, top level only. */
function payloadKeys(option: { shape: Record<string, AnySchema> }): readonly string[] {
  const payload = option.shape['p']!;
  return Object.keys(defOf(payload)['shape'] as Record<string, AnySchema>).sort();
}

/**
 * UN NOM DE CHAMP NE DIT PAS S'IL EST OBLIGATOIRE, et c'est une classe entière
 * de relâchements qu'une assertion de noms laisse passer. Mesuré : rendre
 * `state` facultatif dans `zAuthCallbackQuery`, ou `correlationId` facultatif
 * dans `c2s.why`, ne changeait AUCUN nom de clé — donc aucune ligne ne
 * rougissait, alors que `state` est le jeton anti-rejeu d'OAuth et que
 * « `c2s.why` ne porte QUE `correlationId` » est un critère de la fiche.
 *
 * `shapeSpec` marque ce que `Object.keys` efface :
 *   `nom`   obligatoire · `nom?` facultatif · `nom=` a une valeur par défaut
 */
function optionalityMark(child: AnySchema): string {
  const kind = defOf(child)['type'] as string;
  if (kind === 'optional') return '?';
  if (kind === 'default' || kind === 'prefault') return '=';
  return '';
}

function shapeSpec(schema: AnySchema): readonly string[] {
  const shape = defOf(schema)['shape'] as Record<string, AnySchema>;
  return Object.entries(shape)
    .map(([key, child]) => `${key}${optionalityMark(child)}`)
    .toSorted();
}

function optionByType(union: typeof zC2SMessage | typeof zS2CMessage, type: string) {
  const found = union.options.find((option) => option.shape.t.value === type);
  if (!found) throw new Error(`message inconnu : ${type}`);
  return found as unknown as { shape: Record<string, AnySchema> };
}

// ─────────────────────────────────────────── 1. les deux unions, membre à membre

describe('les deux unions du protocole', () => {
  const C2S_TYPES = [
    'c2s.hello',
    'c2s.intent',
    'c2s.speak',
    'c2s.typing',
    'c2s.resume',
    'c2s.pong',
    'c2s.resume_narration',
    'c2s.why',
  ] as const;

  const S2C_TYPES = [
    's2c.welcome',
    's2c.snapshot',
    's2c.event',
    's2c.events_batch',
    's2c.narration_started',
    's2c.narration_delta',
    's2c.narration_snapshot',
    's2c.narration_done',
    's2c.narration_error',
    's2c.turn_proof',
    's2c.rejected',
    's2c.error',
    's2c.presence',
    's2c.ping',
    's2c.resync_required',
  ] as const;

  it('zC2SMessage porte exactement les 8 messages de la section 5.2', () => {
    expect(c2sMessageTypesOfSchema()).toStrictEqual([...C2S_TYPES]);
    expect(zC2SMessage.options).toHaveLength(8);
  });

  it('zS2CMessage porte exactement les 15 messages de la section 5.4', () => {
    expect(s2cMessageTypesOfSchema()).toStrictEqual([...S2C_TYPES]);
    expect(zS2CMessage.options).toHaveLength(15);
  });

  it('aucun doublon dans l’une ni dans l’autre', () => {
    const client = c2sMessageTypesOfSchema();
    const server = s2cMessageTypesOfSchema();
    expect(new Set(client).size).toBe(client.length);
    expect(new Set(server).size).toBe(server.length);
  });

  it('les deux vocabulaires sont disjoints : aucun « t » des deux côtés', () => {
    const client = new Set(c2sMessageTypesOfSchema());
    for (const type of s2cMessageTypesOfSchema()) expect(client.has(type)).toBe(false);
  });

  it('zC2SEnvelope et zS2CEnvelope sont ces mêmes schémas, pas un second chemin de parsing', () => {
    // Deux noms pour une chose : la section 2.4 dit « enveloppe », la 5.2 dit
    // « message ». Deux SCHÉMAS distincts seraient deux endroits où une trame
    // peut être acceptée, et il n'en existe qu'un.
    expect(zC2SEnvelope).toBe(zC2SMessage);
    expect(zS2CEnvelope).toBe(zS2CMessage);
  });
});

// ──────────────── 2. invariant 3 : aucun message client ne transporte un résultat

describe('invariant 3 — aucun message client ne transporte un résultat', () => {
  /**
   * LA SURFACE CLIENT, GELÉE. Tout nom de champ atteignable depuis les huit
   * messages, `zIntent` compris. Un `gauge`, un `outcome`, un `seq` ajouté
   * n'importe où sous n'importe lequel des huit fait rougir cette ligne — quel
   * que soit son nom, ce qu'une liste noire ne peut pas promettre.
   */
  const SURFACE_CLIENT_GELEE = [
    'amount',
    'attribute',
    'background',
    'bonus',
    'championSlug',
    'channel',
    'characterId',
    'clientVersion',
    'coeur',
    'correlationId',
    'description',
    'entityId',
    'esprit',
    'fer',
    'id',
    'intent',
    'kind',
    'lastChunk',
    'lastDeliverySeq',
    'likelihood',
    'narrationId',
    'ombre',
    'oracleId',
    'p',
    'question',
    'rank',
    'reason',
    'rollId',
    'sinceDeliverySeq',
    'spread',
    't',
    'target',
    'targetId',
    'text',
    'trackId',
    'type',
    'typing',
    'v',
    'vif',
  ] as const;

  it('la surface client est exactement celle qui est gelée', () => {
    expect([...c2s.keys].sort()).toStrictEqual([...SURFACE_CLIENT_GELEE]);
  });

  it.each([
    ['c2s.hello', ['clientVersion', 'lastDeliverySeq']],
    ['c2s.intent', ['intent']],
    ['c2s.speak', ['channel', 'text']],
    ['c2s.typing', ['typing']],
    ['c2s.resume', ['sinceDeliverySeq']],
    ['c2s.pong', []],
    ['c2s.resume_narration', ['lastChunk', 'narrationId']],
    ['c2s.why', ['correlationId']],
  ])('%s porte exactement %j au premier niveau de sa charge utile', (type, keys) => {
    expect(payloadKeys(optionByType(zC2SMessage, type))).toStrictEqual(keys);
  });

  /**
   * LE SECOND FILET, et il se lit. Les mots par lesquels un résultat entrerait
   * s'il entrait un jour : jauges, issues, dés, état, journal. Le premier filet
   * est l'énumération ci-dessus ; celui-ci dit pourquoi elle est ce qu'elle est.
   */
  const MOTS_DE_RESULTAT = [
    ...GAUGES,
    ...OUTCOMES,
    'challenge',
    'damage',
    'deliverySeq',
    'die',
    'dice',
    'effect',
    'effects',
    'event',
    'events',
    'gauge',
    'gauges',
    'harm',
    'lastSeq',
    'momentum',
    'outcome',
    'proof',
    'result',
    'roll',
    'seq',
    'sinceSeq',
    'state',
    'total',
    'truncated',
  ];

  it.each(MOTS_DE_RESULTAT)('« %s » n’est le nom d’aucun champ de la surface client', (word) => {
    expect(c2s.keys.has(word)).toBe(false);
  });

  it.each([
    ['zGameEvent', zGameEvent],
    ['zTableState', zTableState],
    ['zTurnProof', zTurnProof],
  ])('%s n’est atteignable depuis aucun message client', (_name, schema) => {
    // Par identité de référence : un champ `event: zGameEvent` ajouté à un
    // `c2s.*` fait rougir cette ligne AVANT même que ses clés ne comptent.
    expect(c2s.nodes.has(schema)).toBe(false);
    // Et côté serveur, les trois sont bien présents : sans ça, cette ligne
    // prouverait seulement que le marcheur ne trouve rien.
    expect(s2c.nodes.has(schema)).toBe(true);
  });

  it('l’enveloppe de JOURNAL ne traverse jamais un message client', () => {
    // `zEventEnvelope` n'est PAS comparé par référence : les 71 variantes
    // étalent `eventEnvelopeShape` au lieu d'`.extend()` le schéma, donc le
    // nœud `zEventEnvelope` n'est atteignable de nulle part — une assertion
    // d'identité dessus serait verte sans rien prouver. Mesuré, puis remplacé
    // par ses CHAMPS, qui eux voyagent bel et bien.
    expect(c2s.nodes.has(zEventEnvelope)).toBe(false);
    expect(s2c.nodes.has(zEventEnvelope)).toBe(false);
    // Deux noms sont exclus, et les deux pour la raison que ce fichier répète :
    // les deux enveloppes ne se mélangent pas mais partagent des MOTS.
    //   `id`            — l'enveloppe WS a le sien, clé d'idempotence, sans
    //                     rapport avec l'`EventId` du journal.
    //   `correlationId` — `c2s.why` le nomme, et c'est précisément son objet :
    //                     désigner un tour sans rien affirmer dessus.
    const motsPartages = new Set(['id', 'correlationId']);
    for (const champ of Object.keys(eventEnvelopeShape)) {
      if (motsPartages.has(champ)) continue;
      expect(c2s.keys.has(champ), `${champ} ne doit pas entrer côté client`).toBe(false);
      expect(s2c.keys.has(champ), `${champ} doit voyager côté serveur`).toBe(true);
    }
  });

  it('zIntent EST atteignable, et c’est le seul chemin mutant', () => {
    expect(c2s.nodes.has(zIntent)).toBe(true);
    expect(payloadKeys(optionByType(zC2SMessage, 'c2s.intent'))).toStrictEqual(['intent']);
    // Les 21 intentions sont bien parcourues : sans ça, le gel de la surface
    // ne couvrirait pas la charge utile la plus dangereuse.
    expect(INTENT_TYPES.length).toBe(zIntent.options.length);
  });

  it('c2s.why ne porte QUE correlationId', () => {
    expect(payloadKeys(zC2SWhy as unknown as { shape: Record<string, AnySchema> })).toStrictEqual([
      'correlationId',
    ]);
    const frame = {
      v: PROTOCOL_VERSION,
      t: 'c2s.why',
      id: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b',
      p: { correlationId: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6c' },
    };
    expect(zC2SWhy.safeParse(frame).success).toBe(true);
    // Un champ en trop est REFUSÉ, pas ignoré : `strictObject` partout.
    for (const extra of [{ seq: 1 }, { outcome: 'fort' }, { event: {} }]) {
      const polluted = { ...frame, p: { ...frame.p, ...extra } };
      expect(zC2SWhy.safeParse(polluted).success).toBe(false);
    }
  });

  /**
   * AUCUN CHAMP DE CHARGE UTILE N'EST FACULTATIF, sur aucun des 23 messages.
   * Un protocole gelé dont un champ devient facultatif est un protocole
   * élargi en silence : le champ disparaît des trames sans qu'aucun nom ne
   * change, donc sans qu'aucune assertion de noms ne rougisse. Mesuré :
   * `correlationId` rendu facultatif sur `c2s.why` — le critère même de la
   * fiche — laissait la suite verte avant cette ligne.
   *
   * `nullable` reste permis, et ce n'est pas la même chose : « la valeur est
   * null » voyage sur le fil, « la clé est absente » non.
   *
   * UNE SEULE EXCEPTION, ET LA SPEC L'ÉCRIT AVEC SON POINT D'INTERROGATION :
   * §5.4 donne `s2c.error { code, message, requestId, intentId? }` — une erreur
   * peut répondre à une intention précise ou à aucune. L'énumérer plutôt que de
   * l'exclure fait mordre la ligne DANS LES DEUX SENS : un champ qui devient
   * facultatif rougit, et `intentId` qui deviendrait obligatoire aussi.
   */
  it('le seul champ de charge utile facultatif est celui que §5.4 écrit « intentId? »', () => {
    const facultatifs: string[] = [];
    for (const type of [...c2sMessageTypesOfSchema(), ...s2cMessageTypesOfSchema()]) {
      const union = type.startsWith('c2s.') ? zC2SMessage : zS2CMessage;
      const payload = optionByType(union, type).shape['p']!;
      const shape = defOf(payload)['shape'] as Record<string, AnySchema>;
      for (const [key, child] of Object.entries(shape)) {
        if (optionalityMark(child) !== '') facultatifs.push(`${type}.${key}`);
      }
    }
    expect(facultatifs.toSorted()).toStrictEqual(['s2c.error.intentId']);
  });

  it('les enveloppes non plus : v, t, id, ts, seq, deliverySeq sont tous obligatoires', () => {
    const facultatifs: string[] = [];
    for (const type of [...c2sMessageTypesOfSchema(), ...s2cMessageTypesOfSchema()]) {
      const union = type.startsWith('c2s.') ? zC2SMessage : zS2CMessage;
      for (const [key, child] of Object.entries(optionByType(union, type).shape)) {
        if (key !== 'p' && optionalityMark(child) !== '') facultatifs.push(`${type}.${key}`);
      }
    }
    expect(facultatifs).toStrictEqual([]);
  });

  it('une clé inconnue au premier niveau de l’enveloppe est refusée', () => {
    const frame = {
      v: PROTOCOL_VERSION,
      t: 'c2s.pong',
      id: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b',
      p: {},
    };
    expect(zC2SMessage.safeParse(frame).success).toBe(true);
    expect(zC2SMessage.safeParse({ ...frame, seq: 12 }).success).toBe(false);
    expect(zC2SMessage.safeParse({ ...frame, ts: 1 }).success).toBe(false);
  });

  it('une version de protocole différente est refusée par le schéma, pas tolérée', () => {
    const frame = {
      v: PROTOCOL_VERSION + 1,
      t: 'c2s.pong',
      id: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b',
      p: {},
    };
    expect(zC2SMessage.safeParse(frame).success).toBe(false);
  });
});

// ──────────────────────────── 3. les trois compteurs, et lequel détecte une perte

describe('seq, deliverySeq, chunk — trois compteurs, trois origines', () => {
  function envelopeKeys(type: string, union: typeof zC2SMessage | typeof zS2CMessage) {
    return Object.keys(optionByType(union, type).shape).sort();
  }

  it('seq et deliverySeq ne sont portés QUE par l’enveloppe de s2c.event', () => {
    const obtenu = Object.fromEntries(
      s2cMessageTypesOfSchema().map((type) => [type, envelopeKeys(type, zS2CMessage)]),
    );
    const attendu = Object.fromEntries(
      s2cMessageTypesOfSchema().map((type) => [
        type,
        type === 's2c.event'
          ? ['deliverySeq', 'id', 'p', 'seq', 't', 'ts', 'v']
          : ['id', 'p', 't', 'ts', 'v'],
      ]),
    );
    expect(obtenu).toStrictEqual(attendu);
  });

  it('aucune enveloppe client ne porte seq ni deliverySeq', () => {
    for (const type of c2sMessageTypesOfSchema()) {
      expect(envelopeKeys(type, zC2SMessage)).toStrictEqual(['id', 'p', 't', 'v']);
    }
  });

  /**
   * AVEC LE MARCHEUR, PAS AVEC `payloadKeys`. Mesuré en recette : la version
   * qui ne lisait que le PREMIER niveau de `p` restait verte avec un
   * `chunk: zChunk` glissé dans `s2c.presence.members[]`, un cran plus bas.
   * Un garde-fou qui ne regarde qu'un niveau annonce une profondeur qu'il n'a
   * pas — le cas que ce dépôt tient pour pire qu'une règle absente (ADR 0002).
   *
   * Le marcheur descend message par message, à travers `zGameEvent`,
   * `zTableState`, `zTurnProof` et `zIntent`. Un `chunk` n'importe où sous
   * n'importe lequel des 23 messages rougit cette ligne.
   */
  it('chunk n’apparaît que dans des charges utiles de narration, à TOUTE profondeur', () => {
    const NOMS_DE_FRAGMENT = new Set(['chunk', 'lastChunk']);
    const porteurs: string[] = [];
    for (const type of [...c2sMessageTypesOfSchema(), ...s2cMessageTypesOfSchema()]) {
      const union = type.startsWith('c2s.') ? zC2SMessage : zS2CMessage;
      const atteignables = walk(optionByType(union, type) as unknown as AnySchema).keys;
      if ([...NOMS_DE_FRAGMENT].some((nom) => atteignables.has(nom))) porteurs.push(type);
    }
    expect(porteurs.toSorted()).toStrictEqual([
      'c2s.resume_narration',
      's2c.narration_delta',
      's2c.narration_snapshot',
      's2c.narration_started',
    ]);
    for (const type of porteurs) expect(type).toContain('narration');
    // Et les quatre le portent bien au PREMIER niveau : sans cette ligne, un
    // `chunk` qui descendrait d'un cran dans `s2c.narration_delta` passerait.
    for (const type of porteurs) {
      const union = type.startsWith('c2s.') ? zC2SMessage : zS2CMessage;
      const dessus = payloadKeys(optionByType(union, type));
      expect(dessus.some((key) => NOMS_DE_FRAGMENT.has(key))).toBe(true);
    }
  });

  /**
   * ADR 0010 DÉCISION 1 — LE TEST QUI ROUGIT SI UN CLIENT PEUT CONFONDRE
   * « PAS POUR MOI » ET « PERDU ».
   *
   * La table écrit cinq faits (seq 1..5). Deux sont adressés ailleurs (ADR
   * 0008) : ce joueur reçoit 1, 3, 4. Sa numérotation de LIVRAISON est donc
   * 1, 2, 3 — dense. Le détecteur de trou est le même dans les deux cas ; seul
   * le compteur qu'on lui donne change.
   */
  describe('détection de perte (ADR 0010)', () => {
    /** Premier trou après `cursor`, ou `null` s’il n’y en a pas. */
    function premierTrou(cursor: number, recus: readonly number[]): number | null {
      let attendu = cursor + 1;
      for (const n of recus) {
        if (n !== attendu) return attendu;
        attendu += 1;
      }
      return null;
    }

    const seqRecus = [1, 3, 4];
    const deliveryRecus = [1, 2, 3];

    it('le seq global a des trous LÉGITIMES : il ne peut pas servir de détecteur', () => {
      expect(premierTrou(0, seqRecus)).toBe(2);
      // Or rien n'a été perdu. Un client branché sur `seq` demanderait un
      // rattrapage pour un événement qui ne lui était pas destiné — et, pire,
      // conclurait à une perte là où il n'y en a pas.
    });

    it('le deliverySeq est dense : aucun trou quand rien n’est perdu', () => {
      expect(premierTrou(0, deliveryRecus)).toBeNull();
    });

    it('le deliverySeq rougit quand une trame est RÉELLEMENT perdue', () => {
      // L'autre sens, sans lequel le test ci-dessus ne prouverait rien : un
      // détecteur qui ne signale jamais rien est vert pour de mauvaises raisons.
      expect(premierTrou(0, [1, 3])).toBe(2);
      expect(premierTrou(5, [6, 8])).toBe(7);
    });

    it('s2c.event porte les deux, et le client reprend sur le dense', () => {
      const shape = optionByType(zS2CMessage, 's2c.event').shape;
      expect(Object.keys(shape)).toContain('seq');
      expect(Object.keys(shape)).toContain('deliverySeq');
      // Et le curseur de reprise est le dense, pas le global : `c2s.resume` ne
      // propose même pas l'autre.
      expect(
        payloadKeys(zC2SResume as unknown as { shape: Record<string, AnySchema> }),
      ).toStrictEqual(['sinceDeliverySeq']);
      expect(c2s.keys.has('sinceSeq')).toBe(false);
      expect(c2s.keys.has('lastSeq')).toBe(false);
    });

    it('un deliverySeq commence à 1 : 0 n’est pas une livraison', () => {
      const base = {
        v: PROTOCOL_VERSION,
        t: 's2c.event',
        id: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b',
        ts: 1_758_000_000_000,
        seq: 412,
        p: { event: {} },
      };
      // La charge utile est volontairement invalide ici : c'est le champ
      // `deliverySeq` qu'on mesure, et un 0 doit échouer avant tout le reste.
      expect(zS2CEvent.safeParse({ ...base, deliverySeq: 0 }).success).toBe(false);
    });
  });
});

// ───────────────────────────────── 4. la preuve « Pourquoi ? » et sa borne de taille

/**
 * UN CRITÈRE D'ACCEPTATION À MOITIÉ FAUX PAR CONSTRUCTION, signalé plutôt que
 * contourné.
 *
 * La fiche demande : « une preuve construite AU MAXIMUM DE SES BORNES (32
 * effets, libellés de 120 caractères) sérialise à moins de 8 Kio, et le schéma
 * refuse au-delà ».
 *
 * Ce qui est vérifiable, et l'est ci-dessous : les bornes que `zTurnProof`
 * porte vraiment (32 effets, 120 caractères de libellé, 400 de texte) sont
 * refusées au 33e et au 121e, dans les deux sens ; et une preuve remplie aux
 * MAXIMA DE DOMAINE — le plus long type du catalogue des 71, le plus long
 * `moveId`, le plus long flux RNG, le plus long dénouement, un ULID de 26
 * caractères — tient sous 8 Kio, trame comprise.
 *
 * Ce qui ne l'est pas : `type`, `moveId`, `rngStream`, `outcome` et `entryId`
 * sont des `z.string()` SANS BORNE dans `zTurnProof` (M0-05). Au maximum réel
 * du schéma, une preuve est donc de taille non bornée, et « moins de 8 Kio »
 * ne peut pas être une propriété du schéma. MESURÉ : quatre identifiants de 64
 * caractères suffisent à faire passer la trame à 8 358 octets, tout en restant
 * parfaitement valide. Le dernier test de ce bloc le prouve.
 *
 * CE N'EST PAS UN DÉFAUT À CORRIGER ICI. La section 5.4 fait de `truncated` un
 * calcul du serveur, pas une propriété de forme — et cette mesure dit pourquoi
 * ce choix est le bon. Conséquence pour M0-24 et M0-25 : `truncated` se décide
 * en MESURANT la trame sérialisée contre `TURN_PROOF_MAX_BYTES`, jamais en
 * comptant les effets. La marge est de quelques centaines d'octets, pas d'un
 * facteur deux.
 */
describe('s2c.turn_proof — la borne de taille (P22)', () => {
  const uuid = '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6c';
  const label = 'x'.repeat(TURN_PROOF_LABEL_MAX);
  const text = 'y'.repeat(TURN_PROOF_TEXT_MAX);

  /** Le plus long membre d'un catalogue du moteur : la borne de domaine réelle. */
  function leplusLong(valeurs: readonly string[]): string {
    return [...valeurs].toSorted((a, b) => b.length - a.length)[0]!;
  }

  /** Un ULID : 26 caractères. C'est ce que `entryId` porte en vrai. */
  const ulid = '01J9ZC4M8N7P6Q5R4S3T2V1W0X';

  function preuveAuMaximum(id: string) {
    return {
      correlationId: uuid,
      firstSeq: 999_999,
      lastSeq: 999_999,
      status: 'reverted' as const,
      revertedBy: { seq: 999_999, reason: label },
      move: {
        eventSeq: 999_999,
        moveId: leplusLong(MOVE_IDS),
        attribute: leplusLong(ATTRIBUTES),
        bonus: -9,
        label,
      },
      roll: {
        eventSeq: 999_999,
        rngStream: leplusLong(RNG_STREAMS),
        rngDrawIndex: 999_999,
        action: 99,
        challenge: [10, 10] as [number, number],
        total: 99,
        outcome: leplusLong(OUTCOMES),
      },
      revision: { eventSeq: 999_999, label },
      effects: Array.from({ length: TURN_PROOF_MAX_EFFECTS }, () => ({
        eventSeq: 999_999,
        type: leplusLong(GAME_EVENT_TYPES),
        label,
      })),
      price: { eventSeq: 999_999, entryId: id, text, value: -99, effectIndex: 99 },
      presage: { eventSeq: 999_999, entryId: id, text },
      narration: { eventSeq: 999_999, source: 'ai' as const },
    };
  }

  function trame(proof: ReturnType<typeof preuveAuMaximum>) {
    return {
      v: PROTOCOL_VERSION,
      t: 's2c.turn_proof',
      id: '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b',
      ts: 1_758_000_000_000,
      p: { correlationId: uuid, proof, truncated: false },
    };
  }

  it('aux maxima de domaine, la trame entière tient sous 8 Kio', () => {
    const proof = preuveAuMaximum(ulid);
    expect(zTurnProof.safeParse(proof).success).toBe(true);
    const frame = trame(proof);
    expect(zS2CMessage.safeParse(frame).success).toBe(true);

    const octets = Buffer.byteLength(JSON.stringify(frame), 'utf8');
    expect(octets).toBeLessThan(TURN_PROOF_MAX_BYTES);
    expect(fitsOutgoingFrame(octets)).toBe(true);
    // Trente fois sous la trame sortante de 256 Kio : une preuve ne peut pas
    // saturer une socket (01-architecture.md section 5).
    expect(octets * 30).toBeLessThan(WS_MAX_OUTGOING_FRAME_BYTES);
    // Et la marge est ÉTROITE, pas confortable. Si cette ligne casse un jour
    // parce que la marge a grandi, tant mieux — mais qu'on le sache.
    expect(TURN_PROOF_MAX_BYTES - octets).toBeLessThan(1024);
  });

  it('le schéma refuse au-delà des bornes qu’il porte, dans les trois directions', () => {
    const proof = preuveAuMaximum(ulid);
    expect(
      zTurnProof.safeParse({
        ...proof,
        effects: [...proof.effects, { eventSeq: 1, type: 'system.note', label: 'a' }],
      }).success,
    ).toBe(false);
    expect(
      zTurnProof.safeParse({
        ...proof,
        move: { ...proof.move, label: 'x'.repeat(TURN_PROOF_LABEL_MAX + 1) },
      }).success,
    ).toBe(false);
    expect(
      zTurnProof.safeParse({
        ...proof,
        price: { ...proof.price, text: 'y'.repeat(TURN_PROOF_TEXT_MAX + 1) },
      }).success,
    ).toBe(false);
  });

  it('mais le schéma NE garde PAS les 8 Kio : une preuve valide peut les dépasser', () => {
    // L'autre sens, et c'est lui qui a de la valeur. `entryId` est un
    // `z.string()` sans borne : 64 caractères au lieu de 26, et la trame passe
    // au-dessus du plafond tout en restant valide. `truncated` est donc une
    // MESURE du serveur, jamais une propriété de forme.
    const proof = preuveAuMaximum('z'.repeat(64));
    expect(zTurnProof.safeParse(proof).success).toBe(true);
    const octets = Buffer.byteLength(JSON.stringify(trame(proof)), 'utf8');
    expect(octets).toBeGreaterThan(TURN_PROOF_MAX_BYTES);
  });

  it('et le français seul suffit à le dépasser : `.max(120)` compte des CARACTÈRES', () => {
    // LA MESURE QUI TRANCHE. `z.string().max(120)` borne des unités UTF-16, pas
    // des octets. Or les libellés de ce produit sont en français : « é » pèse
    // deux octets, « œ » aussi, une apostrophe typographique trois. Un libellé
    // de 120 caractères accentués fait donc 240 octets, et 32 d'entre eux plus
    // deux textes de 400 caractères ajoutent ~5 Kio à la trame.
    //
    // Conséquence : la preuve au maximum de ses bornes dépasse les 8 Kio DANS
    // LA LANGUE DU PRODUIT, sans qu'aucun champ ne sorte de sa borne. Le
    // critère « ça tient sous 8 Kio » n'est vrai qu'en ASCII.
    const proof = preuveAuMaximum(ulid);
    const enFrancais = {
      ...proof,
      revertedBy: { ...proof.revertedBy, reason: 'é'.repeat(TURN_PROOF_LABEL_MAX) },
      move: { ...proof.move, label: 'é'.repeat(TURN_PROOF_LABEL_MAX) },
      revision: { ...proof.revision, label: 'é'.repeat(TURN_PROOF_LABEL_MAX) },
      effects: proof.effects.map((effet) => ({
        ...effet,
        label: 'é'.repeat(TURN_PROOF_LABEL_MAX),
      })),
      price: { ...proof.price, text: 'é'.repeat(TURN_PROOF_TEXT_MAX) },
      presage: { ...proof.presage, text: 'é'.repeat(TURN_PROOF_TEXT_MAX) },
    };
    expect(zTurnProof.safeParse(enFrancais).success).toBe(true);
    const octets = Buffer.byteLength(JSON.stringify(trame(enFrancais)), 'utf8');
    expect(octets).toBeGreaterThan(TURN_PROOF_MAX_BYTES);
    // Et largement : ce n'est pas un cas limite, c'est le cas nominal.
    expect(octets).toBeGreaterThan(TURN_PROOF_MAX_BYTES * 1.5);
  });

  it('un tour ANNULÉ reste une preuve : rien n’est effacé (P22)', () => {
    const proof = preuveAuMaximum(ulid);
    expect(proof.status).toBe('reverted');
    expect(zTurnProof.safeParse(proof).success).toBe(true);
  });
});

// ─────────────────────────── 5. les codes de fermeture et la limitation de débit

describe('codes de fermeture et limitation de débit (sections 5.5 et 5.6)', () => {
  it('les huit codes sont ceux de la section 5.5, valeur par valeur', () => {
    expect(WS_CLOSE_CODES).toStrictEqual({
      protocol_version: 4001,
      unauthenticated: 4002,
      forbidden_campaign: 4003,
      campaign_not_found: 4004,
      rate_limited: 4008,
      payload_too_large: 4009,
      server_shutdown: 4010,
      campaign_rebuilding: 4011,
    });
  });

  it('aucun numéro n’est réutilisé, et tous sont dans la plage applicative', () => {
    const codes = Object.values(WS_CLOSE_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
    }
  });

  it('le nom de chaque fermeture est aussi un AppErrorCode : un vocabulaire, deux transports', () => {
    for (const reason of WS_CLOSE_REASONS) {
      expect(APP_ERROR_CODES).toContain(reason);
      expect(zAppErrorCode.safeParse(reason).success).toBe(true);
    }
  });

  it('les seaux de débit nomment des messages qui existent', () => {
    const connus = new Set(c2sMessageTypesOfSchema());
    for (const [type, limite] of Object.entries(WS_RATE_LIMITS)) {
      expect(connus.has(type)).toBe(true);
      expect(limite.count).toBeGreaterThan(0);
      expect(limite.windowMs).toBeGreaterThan(0);
    }
  });

  /**
   * LA TABLE ENTIÈRE, SEAU PAR SEAU. Mesuré en recette : la version qui
   * n'assertait que `c2s.why` et `c2s.intent` laissait passer
   * `'c2s.speak': { count: 9999, windowMs: 1 }` — trois seaux sur cinq
   * n'étaient gardés par rien. `toStrictEqual` sur l'objet entier ferme aussi
   * l'autre sens : un sixième seau, ou un seau retiré, rougit ici.
   */
  it('les cinq seaux sont EXACTEMENT ceux de la section 5.6, valeur par valeur', () => {
    expect(WS_RATE_LIMITS).toStrictEqual({
      'c2s.intent': { count: 5, windowMs: 10_000, burst: 10 },
      'c2s.speak': { count: 20, windowMs: 60_000 },
      'c2s.resume': { count: 2, windowMs: 10_000 },
      'c2s.why': { count: 10, windowMs: 10_000 },
      'c2s.typing': { count: 1, windowMs: 1_000 },
    });
  });

  /**
   * LES QUATRE NOMBRES DE LA SECTION 5, ET LES DEUX DE 5.6 / 02-mj-ia §6.3.
   * Mesuré en recette : `WS_HEARTBEAT_INTERVAL_MS = 1` et
   * `WS_MAX_INCOMING_FRAME_BYTES = 7` passaient 290/290. Une constante que
   * personne ne lit n'est pas gelée, elle est seulement écrite.
   */
  it('les bornes de transport sont celles de la section 5', () => {
    expect(WS_MAX_INCOMING_FRAME_BYTES).toBe(64 * 1024);
    expect(WS_MAX_OUTGOING_FRAME_BYTES).toBe(256 * 1024);
    // L'entrant est le plus petit des deux : un client ne peut pas saturer la
    // mémoire du serveur avec ce que le serveur s'autorise à émettre.
    expect(WS_MAX_INCOMING_FRAME_BYTES).toBeLessThan(WS_MAX_OUTGOING_FRAME_BYTES);
  });

  it('le battement de cœur est celui de la section 5 : 25 s, fermeture à 60 s', () => {
    expect(WS_HEARTBEAT_INTERVAL_MS).toBe(25_000);
    expect(WS_HEARTBEAT_TIMEOUT_MS).toBe(60_000);
    // Le délai laisse passer au moins deux `ping` manqués : une fermeture au
    // premier raté couperait une socket pour une hoquet de réseau.
    expect(WS_HEARTBEAT_TIMEOUT_MS).toBeGreaterThanOrEqual(2 * WS_HEARTBEAT_INTERVAL_MS);
  });

  it('le troisième dépassement ferme, et la file de socket plafonne à 64', () => {
    expect(WS_RATE_LIMIT_STRIKES_BEFORE_CLOSE).toBe(3);
    expect(WS_SOCKET_QUEUE_MAX_MESSAGES).toBe(64);
  });

  it('zWsErrorCode EST zAppErrorCode : un vocabulaire d’erreur, deux transports', () => {
    // Par identité : une recopie serait un second endroit où la liste dérive.
    expect(zWsErrorCode).toBe(zAppErrorCode);
  });

  /**
   * `zEnvelopeHead` est le pré-parse de la section 5.1 : il regarde `v` et `t`
   * pour répondre 4001 avant d'ouvrir l'union. Il est DÉLIBÉRÉMENT non strict,
   * et les deux sens le disent — il accepte une trame qu'il ne comprend pas,
   * et il refuse celle dont `v` n'est pas un entier.
   */
  it('zEnvelopeHead lit v et t, et rien d’autre', () => {
    expect(Object.keys(defOf(zEnvelopeHead)['shape'] as Record<string, AnySchema>).sort()).toEqual([
      't',
      'v',
    ]);
    const inconnue = { v: PROTOCOL_VERSION + 99, t: 'c2s.dun_futur', id: 'x', p: { a: 1 } };
    expect(zEnvelopeHead.safeParse(inconnue).success).toBe(true);
    // L'autre sens : non strict ne veut pas dire permissif sur ce qu'il lit.
    expect(zEnvelopeHead.safeParse({ v: 'un', t: 'c2s.pong' }).success).toBe(false);
    expect(zEnvelopeHead.safeParse({ v: PROTOCOL_VERSION, t: '' }).success).toBe(false);
    // Et l'union complète refuse ce que le pré-parse accepte : c'est bien un
    // aiguillage, pas une seconde porte d'entrée.
    expect(zC2SMessage.safeParse(inconnue).success).toBe(false);
  });

  it('s2c.rejected sépare la règle qui refuse de la requête qui échoue', () => {
    expect(zRejectionCode.safeParse('gauge_out_of_range').success).toBe(
      zRuleViolationCode.safeParse('gauge_out_of_range').success,
    );
    expect(zRejectionCode.safeParse('rate_limited').success).toBe(true);
    expect(zRejectionCode.safeParse('pas_un_code').success).toBe(false);
  });
});

// ──────────────────────────── 5 bis. les deux énumérations propres à la narration

/**
 * LES DEUX ENUMS QUE CETTE TÂCHE DÉCLARE DE ZÉRO. Elles n'ont pas de
 * contrepartie dans le moteur — donc pas de miroir à comparer au sens d'ADR
 * 0007 —, et c'est précisément pour ça qu'elles ont failli n'être gardées par
 * rien. Mesuré en recette : `zNarrationErrorCode` réduit à
 * `z.enum(['nimporte_quoi'])` sortait 290/290 vert. Une liste sans mesure est
 * une liste sans garde ; la section qui la fixe est son seul oracle.
 */
describe('les deux énumérations de narration (§5.4, 02-mj-ia §6.3)', () => {
  it('zNarrationErrorCode porte les cinq codes de la section 5.4, dans l’ordre', () => {
    expect(zNarrationErrorCode.options).toStrictEqual([
      'rate_limited',
      'refused',
      'engine_fallback',
      'aborted',
      'action_impossible',
    ]);
    // L'autre sens : un code inventé est refusé, et le droit de refus du
    // conteur (P22, 02-mj-ia §4.8) est bien dans la liste.
    expect(zNarrationErrorCode.safeParse('action_impossible').success).toBe(true);
    expect(zNarrationErrorCode.safeParse('nimporte_quoi').success).toBe(false);
  });

  /**
   * ÉCART DÉCLARÉ, MESURÉ, NON CORRIGÉ ICI. `02-mj-ia.md` §6.1 donne à
   * `NarrationBroadcast.status` CINQ valeurs — `streaming`, `finalizing`,
   * `done`, `aborted`, `failed` — alors que §6.3, qui décrit ce que le serveur
   * fait à l'abonnement, n'en branche que QUATRE : `finalizing` n'a aucune
   * branche et donc aucune traduction sur le fil.
   *
   * `zNarrationStatus` suit §6.3, parce que c'est la section qui fixe le
   * CONTENU DE LA TRAME. Élargir l'enum à cinq valeurs serait trancher une
   * contradiction de spec depuis un test, ce que cette tâche n'a pas à faire.
   * Signalé au lead ; la ligne ci-dessous est l'endroit où ça rougira le jour
   * où un ADR tranchera dans l'autre sens.
   */
  it('zNarrationStatus porte les quatre statuts que §6.3 branche', () => {
    expect(zNarrationStatus.options).toStrictEqual(['streaming', 'done', 'failed', 'aborted']);
    expect(zNarrationStatus.safeParse('au_hasard').success).toBe(false);
    // L'écart, énoncé en assertion plutôt qu'en commentaire : tant que
    // `finalizing` n'est pas tranché, il n'est PAS sur le fil.
    expect(zNarrationStatus.safeParse('finalizing').success).toBe(false);
  });

  it('s2c.narration_started ouvre le flux au littéral 0, comme §5.4 le fixe', () => {
    // `chunk: 0` est une VALEUR fixée par la spec, pas un `zChunk` quelconque :
    // le premier fragment d'un flux est toujours le zéro, et un client peut s'y
    // fier pour distinguer une ouverture d'une reprise.
    const p = optionByType(zS2CMessage, 's2c.narration_started').shape['p']!;
    const chunk = (defOf(p)['shape'] as Record<string, AnySchema>)['chunk']!;
    expect(defOf(chunk)['type']).toBe('literal');
    expect(chunk.safeParse(0).success).toBe(true);
    expect(chunk.safeParse(1).success).toBe(false);
  });

  it('les deux listes ne se mélangent pas : un statut n’est pas un code d’erreur', () => {
    // `aborted` est dans les deux, et c'est le seul. Deux vocabulaires qui
    // partagent un mot restent deux vocabulaires.
    const communs = zNarrationStatus.options.filter((v) =>
      (zNarrationErrorCode.options as readonly string[]).includes(v),
    );
    expect(communs).toStrictEqual(['aborted']);
  });
});

// ────────────────────── 6. les nœuds partagés : ce que le protocole NE recopie pas

describe('les nœuds partagés — aucune recopie, donc aucun miroir à garder', () => {
  it('c2s.speak porte les nœuds mêmes de speech.say', () => {
    const shape = (optionByType(zC2SMessage, 'c2s.speak').shape['p'] as unknown as ZodInternals)
      ._zod.def['shape'] as Record<string, AnySchema>;
    // PAR IDENTITÉ. Le jour où le canal change côté moteur, il change ici sans
    // que personne n'ait à y penser — et surtout sans pouvoir diverger.
    expect(shape['channel']).toBe(zSpeechSayIntent.shape.channel);
    expect(shape['text']).toBe(zSpeechSayIntent.shape.text);
  });

  it('le canal de parole est bien celui du moteur : « ic », pas « rp »', () => {
    // 01-architecture.md section 5.2 écrit `'rp' | 'ooc'`. Le moteur, canonique
    // par la règle de miroir, écrit `'ic' | 'ooc'`, et `c2s.speak` DEVIENT un
    // `speech.say`. Signalé, pas corrigé dans la spec.
    expect(zSpeechSayIntent.shape.channel.options).toStrictEqual(['ic', 'ooc']);
  });

  it('s2c.narration_done porte les nœuds mêmes de narration.gm_message', () => {
    const shape = (
      optionByType(zS2CMessage, 's2c.narration_done').shape['p'] as unknown as ZodInternals
    )._zod.def['shape'] as Record<string, AnySchema>;
    expect(shape['text']).toBe(zNarrationGmMessagePayload.shape.text);
    expect(shape['model']).toBe(zNarrationGmMessagePayload.shape.model);
    expect(shape['source']).toBe(zNarrationGmMessagePayload.shape.source);
    expect(zNarrationSource).toBe(zNarrationGmMessagePayload.shape.source);
  });

  it('les listes du moteur voyagent par référence, jamais recopiées', () => {
    // Si l'une de ces lignes cassait, c'est qu'une recopie serait apparue — et
    // une recopie non comparée est inerte (ADR 0007).
    expect(s2c.nodes.has(zGameEvent)).toBe(true);
    expect(c2s.nodes.has(zIntent)).toBe(true);
    expect(ATTRIBUTES.length).toBeGreaterThan(0);
    expect(zCampaignStatus.options.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────── 7. la surface HTTP de la section 6

/**
 * LA SURFACE HTTP, GELÉE — et elle est ici plutôt que dans un troisième
 * fichier pour deux raisons : la fiche M0-08 fixe la liste des fichiers
 * touchés, et son critère d'acceptation ne lance QUE
 * `tests/ws-protocol.test.ts` et `tests/envelope-fuzz.test.ts`. Un test d'HTTP
 * dans un fichier que ce critère n'exécute pas serait un garde-fou qu'on ne
 * mesure jamais.
 *
 * POURQUOI CE BLOC EXISTE. `src/http/**` est un livrable nommé de la fiche et
 * n'avait AUCUNE assertion : mesuré en recette, `zHealthzResponse` remplacé par
 * `{ statut: z.literal('KO'), uptimeSeconds: z.number() }` sortait 290/290
 * vert. La « couverture à 100 % » citée alors en preuve était de la couverture
 * d'EXÉCUTION DE MODULE : un `export const z… = z.strictObject({…})` s'exécute
 * à l'import et compte 100 % sans qu'aucune assertion ne le regarde. Ce chiffre
 * est retiré de la preuve ; ce bloc le remplace.
 *
 * CE QU'IL MESURE : que chaque route de §6 déclare ses schémas, que les NOMS DE
 * CHAMPS sont ceux de §6, et que les constantes de §6 valent ce que §6 écrit.
 * Les deux sens à chaque fois : une charge utile conforme passe, une charge
 * utile déviante est refusée.
 */
describe('la surface HTTP (section 6)', () => {
  const ulid = '01J9ZC4M8N7P6Q5R4S3T2V1W0X';
  const uuid = '018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6c';

  // ── 7.1 les treize routes de §6, et le schéma que chacune déclare

  /**
   * LA TABLE DE §6, LIGNE PAR LIGNE. `params`, `querystring`, `body` et
   * `response` viennent d'ici (§2.4) : une route dont une case manque sans
   * justification est un TROU NON DÉCLARÉ, et c'est ce que cette table refuse.
   * `/api/content/:kind/:id` porte `zContentDocResponse` — un `z.unknown()`
   * assumé, parce que les schémas par genre appartiennent à M0-09.
   */
  const ROUTES = [
    ['GET /healthz', { response: zHealthzResponse }],
    ['GET /readyz', { response: zReadyzResponse }],
    ['GET /api/auth/discord/start', { querystring: zAuthStartQuery }],
    ['GET /api/auth/discord/callback', { querystring: zAuthCallbackQuery }],
    ['POST /api/auth/logout', { headers: zCsrfHeaders, response: zLogoutResponse }],
    ['GET /api/me', { response: zMeResponse }],
    ['GET /api/campaigns', { response: zCampaignListResponse }],
    ['POST /api/campaigns', { body: zCreateCampaignBody, headers: zCsrfHeaders }],
    ['GET /api/campaigns/:id', { params: zCampaignParams, response: zCampaignDetailResponse }],
    [
      'GET /api/campaigns/:id/log',
      { params: zCampaignParams, querystring: zCampaignLogQuery, response: zCampaignLogResponse },
    ],
    ['GET /api/content/manifest', { response: zContentManifestResponse }],
    ['GET /api/content/:kind/:id', { params: zContentDocParams, response: zContentDocResponse }],
    ['GET /api/admin/health', { response: zAdminHealthResponse }],
  ] as const satisfies readonly (readonly [string, Record<string, AnySchema>])[];

  it('les treize routes de la section 6 sont couvertes, sans doublon', () => {
    const routes = ROUTES.map(([route]) => route);
    expect(routes).toHaveLength(13);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it.each(ROUTES)('%s déclare des schémas Zod, jamais un trou non déclaré', (_route, schemas) => {
    const cases = Object.entries(schemas);
    expect(cases.length).toBeGreaterThan(0);
    for (const [role, schema] of cases) {
      expect(
        typeof (schema as { safeParse?: unknown }).safeParse,
        `${role} doit être un schéma Zod, pas un trou`,
      ).toBe('function');
    }
  });

  // ── 7.2 les noms de champs que §6 écrit

  it.each([
    ['zHealthzResponse', zHealthzResponse, ['status', 'uptimeMs', 'version']],
    ['zReadyzResponse', zReadyzResponse, ['database', 'migrations', 'status']],
    ['zMeResponse', zMeResponse, ['campaigns', 'characters', 'player']],
    ['zContentManifestResponse', zContentManifestResponse, ['contentVersion', 'counts', 'etag']],
    ['zContentDocParams', zContentDocParams, ['id', 'kind']],
    ['zCampaignLogResponse', zCampaignLogResponse, ['entries', 'lastSeq', 'nextSinceSeq']],
    ['zCampaignLogQuery', zCampaignLogQuery, ['limit=', 'sinceSeq=']],
    ['zCampaignLogEntry', zCampaignLogEntry, ['event', 'seq']],
    ['zCampaignListResponse', zCampaignListResponse, ['campaigns']],
    ['zAuthCallbackQuery', zAuthCallbackQuery, ['code', 'state']],
    ['zAuthCallbackErrorQuery', zAuthCallbackErrorQuery, ['error', 'error_description?', 'state?']],
    ['zLogoutResponse', zLogoutResponse, ['ok']],
    ['zCreateCampaignBody', zCreateCampaignBody, ['name', 'pitch=', 'slug?']],
    ['zCampaignParams', zCampaignParams, ['id']],
    ['zPlayerProfile', zPlayerProfile, ['avatarUrl', 'displayName', 'id', 'isAdmin', 'locale']],
    [
      'zCharacterSummary',
      zCharacterSummary,
      ['campaignId', 'championId', 'displayName', 'id', 'sheetSource', 'status'],
    ],
    [
      'zAdminHealthResponse',
      zAdminHealthResponse,
      [
        'contentHash',
        'contentHashExpected',
        'freeDiskRatio',
        'healthy',
        'lastBackupAgeMs',
        'quickCheck',
        'walBytes',
      ],
    ],
    [
      'zCampaignSummary',
      zCampaignSummary,
      ['contentPackVersion', 'id', 'name', 'ownerPlayerId', 'pitch', 'seq', 'slug', 'status'],
    ],
  ])(
    '%s porte exactement les champs de la section 6, obligatoires compris',
    (_nom, schema, cles) => {
      // `shapeSpec`, pas `Object.keys` : « ? » et « = » sont la moitié du contrat.
      expect(shapeSpec(schema)).toStrictEqual(cles);
    },
  );

  /**
   * LES NOMS DE CHAMPS NE SUFFISENT PAS, et c'est une leçon payée deux fois.
   * `shapeKeys` ne voit pas un `.optional()` : mesuré ici même, rendre `state`
   * facultatif dans `zAuthCallbackQuery` laissait la suite VERTE, alors que
   * `state` EST le jeton anti-rejeu du aller-retour OAuth (§6). Une assertion
   * de forme se double donc d'une assertion de parsing partout où un champ
   * absent changerait le sens de la route.
   */
  it('le retour Discord exige code ET state : ni l’un ni l’autre n’est facultatif', () => {
    expect(zAuthCallbackQuery.safeParse({ code: 'abc', state: 'xyz' }).success).toBe(true);
    expect(zAuthCallbackQuery.safeParse({ code: 'abc' }).success).toBe(false);
    expect(zAuthCallbackQuery.safeParse({ state: 'xyz' }).success).toBe(false);
    // Vide n'est pas fourni : un `state` vide ne prouve rien.
    expect(zAuthCallbackQuery.safeParse({ code: 'abc', state: '' }).success).toBe(false);
    expect(zAuthCallbackQuery.safeParse({ code: '', state: 'xyz' }).success).toBe(false);
    // Et rien d'autre ne passe par là.
    expect(zAuthCallbackQuery.safeParse({ code: 'a', state: 'b', token: 'c' }).success).toBe(false);
  });

  it('le refus Discord est un AUTRE schéma : « non » et « voici ton code » ne se confondent pas', () => {
    // `error` seul suffit ; `error_description` et `state` sont facultatifs et
    // le restent — c'est l'asymétrie qui distingue les deux réponses.
    expect(zAuthCallbackErrorQuery.safeParse({ error: 'access_denied' }).success).toBe(true);
    expect(zAuthCallbackErrorQuery.safeParse({}).success).toBe(false);
    // Un refus ne porte pas de `code` : sinon les deux schémas se recouvriraient.
    expect(zAuthCallbackErrorQuery.safeParse({ error: 'x', code: 'abc' }).success).toBe(false);
    expect(zAuthCallbackQuery.safeParse({ error: 'access_denied' }).success).toBe(false);
  });

  it('zAuthStartQuery ne prend AUCUN paramètre : state et PKCE sont en cookie', () => {
    // Le vide est une affirmation, pas un oubli : §6 met `state` et le
    // vérificateur PKCE en cookie `HttpOnly`, et §5 interdit un jeton en URL.
    expect(shapeSpec(zAuthStartQuery)).toStrictEqual([]);
    expect(zAuthStartQuery.safeParse({}).success).toBe(true);
    expect(zAuthStartQuery.safeParse({ state: 'x' }).success).toBe(false);
  });

  it('zCampaignDetailResponse est le résumé PLUS lastSeq (section 6)', () => {
    expect(shapeSpec(zCampaignDetailResponse)).toStrictEqual(
      [...shapeSpec(zCampaignSummary), 'contentPackHash', 'lastSeq', 'rulesVersion'].toSorted(),
    );
  });

  // ── 7.3 les deux sens : une charge conforme passe, une charge déviante est refusée

  it('/healthz rend { status: "ok", version, uptimeMs } et rien d’autre', () => {
    expect(
      zHealthzResponse.safeParse({ status: 'ok', version: '0.1.0', uptimeMs: 12 }).success,
    ).toBe(true);
    // Le littéral est un littéral : `/healthz` ne répond pas 200 avec « KO ».
    expect(
      zHealthzResponse.safeParse({ status: 'KO', version: '0.1.0', uptimeMs: 12 }).success,
    ).toBe(false);
    // Les secondes ne sont pas des millisecondes, et un champ en trop est refusé.
    expect(
      zHealthzResponse.safeParse({ status: 'ok', version: '0.1.0', uptimeSeconds: 12 }).success,
    ).toBe(false);
    expect(
      zHealthzResponse.safeParse({ status: 'ok', version: '0.1.0', uptimeMs: 12, db: true })
        .success,
    ).toBe(false);
  });

  it('/readyz sépare prêt et pas prêt, et dit sur quoi', () => {
    const pret = { status: 'ready', database: true, migrations: true };
    expect(zReadyzResponse.safeParse(pret).success).toBe(true);
    expect(zReadyzResponse.safeParse({ ...pret, status: 'not_ready' }).success).toBe(true);
    expect(zReadyzResponse.safeParse({ ...pret, status: 'ok' }).success).toBe(false);
  });

  it('/api/me rend le triplet de la section 6, projeté et non miroir', () => {
    const reponse = {
      player: { id: ulid, displayName: 'Katla', avatarUrl: null, locale: 'fr-FR', isAdmin: false },
      characters: [],
      campaigns: [],
    };
    expect(zMeResponse.safeParse(reponse).success).toBe(true);
    // CE QUI N'EST PAS LÀ EST LA CONCEPTION : la ligne `players` porte le
    // flocon Discord, l'e-mail, `last_seen_at` ; aucun n'atteint un navigateur.
    for (const fuite of ['email', 'discordId', 'lastSeenAt', 'avatarHash']) {
      const pollue = { ...reponse, player: { ...reponse.player, [fuite]: 'x' } };
      expect(
        zMeResponse.safeParse(pollue).success,
        `${fuite} ne doit pas atteindre un navigateur`,
      ).toBe(false);
    }
  });

  it('/api/admin/health porte les cinq lignes de 03-donnees §6.7 plus le verdict', () => {
    const sain = {
      quickCheck: 'ok',
      walBytes: 1024,
      lastBackupAgeMs: null,
      freeDiskRatio: 0.5,
      contentHash: 'abc',
      contentHashExpected: 'abc',
      healthy: true,
    };
    expect(zAdminHealthResponse.safeParse(sain).success).toBe(true);
    // `null` est une valeur, pas un oubli : « aucune sauvegarde n'a jamais
    // tourné » n'est pas « la dernière est fraîche ».
    expect(zAdminHealthResponse.safeParse({ ...sain, lastBackupAgeMs: 0 }).success).toBe(true);
    expect(zAdminHealthResponse.safeParse({ ...sain, freeDiskRatio: 1.5 }).success).toBe(false);
    expect(zAdminHealthResponse.safeParse({ ...sain, quickCheck: '' }).success).toBe(false);
  });

  it('le journal se parcourt par seq, et la page est bornée', () => {
    expect(zCampaignLogQuery.parse({})).toStrictEqual({
      sinceSeq: 0,
      limit: CAMPAIGN_LOG_PAGE_MAX,
    });
    expect(zCampaignLogQuery.safeParse({ limit: CAMPAIGN_LOG_PAGE_MAX + 1 }).success).toBe(false);
    // `sinceDeliverySeq` n'a pas cours ici : cette route lit le JOURNAL, qui
    // est numéroté par `seq`. Deux curseurs, deux domiciles (ADR 0010).
    expect(zCampaignLogQuery.safeParse({ sinceDeliverySeq: 3 }).success).toBe(false);
  });

  it('nextSinceSeq vaut null en fin de journal : « plus rien à demander » se dit', () => {
    // `null` n'est pas une commodité : c'est la SEULE façon pour le serveur de
    // dire « la page a atteint la tête ». Sans lui, un client ne peut pas
    // distinguer la fin du journal d'un curseur à zéro, et pagine en boucle.
    const page = { entries: [], nextSinceSeq: null, lastSeq: 412 };
    expect(zCampaignLogResponse.safeParse(page).success).toBe(true);
    expect(zCampaignLogResponse.safeParse({ ...page, nextSinceSeq: 200 }).success).toBe(true);
    // L'autre sens : la clé reste obligatoire, elle n'est pas facultative.
    expect(zCampaignLogResponse.safeParse({ entries: [], lastSeq: 412 }).success).toBe(false);
  });

  it('/api/content/:kind/:id déclare son schéma de réponse, trou assumé compris', () => {
    // `z.unknown()` accepte tout — c'est un trou DÉCLARÉ, ce que « pas de
    // schéma du tout » n'est pas. M0-09 valide le document au chargeur, là où
    // une erreur de contenu est diagnosticable.
    expect(zContentDocResponse.safeParse({ id: 'braum' }).success).toBe(true);
    expect(zContentDocResponse.safeParse(null).success).toBe(true);
    // Les paramètres, eux, sont bornés : un genre ou un id hors slug est refusé.
    expect(zContentDocParams.safeParse({ kind: 'champions', id: 'braum' }).success).toBe(true);
    expect(zContentDocParams.safeParse({ kind: 'Champions', id: 'braum' }).success).toBe(false);
    expect(zContentDocParams.safeParse({ kind: 'champions', id: '../../etc' }).success).toBe(false);
  });

  it('la création de campagne ne laisse pas le client fixer ce qu’il n’a pas à fixer', () => {
    expect(zCreateCampaignBody.parse({ name: 'Le Freljord' })).toStrictEqual({
      name: 'Le Freljord',
      pitch: '',
    });
    // Le serveur possède l'unicité, le statut et le compteur : un client qui
    // les proposerait est refusé, pas silencieusement ignoré.
    for (const trop of [{ status: 'active' }, { seq: 12 }, { id: ulid }]) {
      expect(zCreateCampaignBody.safeParse({ name: 'X', ...trop }).success).toBe(false);
    }
  });

  // ── 7.4 les constantes que §6 écrit noir sur blanc

  it('le cookie de session est celui de la section 6 : fr_session, 30 jours', () => {
    expect(SESSION_COOKIE_NAME).toBe('fr_session');
    expect(SESSION_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(SESSION_MAX_AGE_MS).toBe(2_592_000_000);
  });

  it('le CSRF est l’en-tête de la section 6, en minuscules', () => {
    expect(CSRF_HEADER_NAME).toBe('x-requested-with');
    expect(CSRF_HEADER_VALUE).toBe('for-app');
    // §6 écrit `X-Requested-With: for-app` ; un serveur lit les en-têtes en
    // minuscules. Même en-tête, une seule orthographe côté code.
    expect(CSRF_HEADER_NAME).toBe(CSRF_HEADER_NAME.toLowerCase());
    expect(zCsrfHeaders.safeParse({ [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE }).success).toBe(true);
    expect(zCsrfHeaders.safeParse({ [CSRF_HEADER_NAME]: 'autre-chose' }).success).toBe(false);
    expect(zCsrfHeaders.safeParse({}).success).toBe(false);
  });

  it('l’origine de développement est celle de la section 6', () => {
    expect(DEV_ALLOWED_ORIGIN).toBe('http://localhost:5173');
  });

  it('les seuils de 03-donnees §6.7 valent ce que la section écrit', () => {
    expect(ADMIN_HEALTH_WAL_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(ADMIN_HEALTH_BACKUP_MAX_AGE_MS).toBe(8 * 60 * 60 * 1000);
    expect(ADMIN_HEALTH_MIN_FREE_DISK_RATIO).toBe(0.2);
  });

  it('la page de journal est bornée à 200, et le cache de contenu est immuable', () => {
    expect(CAMPAIGN_LOG_PAGE_MAX).toBe(200);
    expect(CONTENT_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
  });

  // ── 7.5 ce que la surface HTTP NE recopie pas

  it('les DTO HTTP réutilisent les nœuds du moteur, jamais une recopie', () => {
    const http = walk(zMeResponse);
    expect(http.nodes.has(zCharacterStatus)).toBe(true);
    expect(http.nodes.has(zSheetSource)).toBe(true);
    expect(http.nodes.has(zCampaignStatus)).toBe(true);
    // Et le journal HTTP porte le MÊME `zGameEvent` que `s2c.event`.
    expect(walk(zCampaignLogResponse).nodes.has(zGameEvent)).toBe(true);
  });

  it('aucun secret ne traverse une query string (section 6)', () => {
    // `code` et `state` de Discord y sont, et c'est Discord qui les met ; rien
    // de ce que NOUS fabriquons n'y passe.
    const entrees = [
      zAuthStartQuery,
      zAuthCallbackQuery,
      zAuthCallbackErrorQuery,
      zCampaignLogQuery,
    ];
    const interdits = ['token', 'accessToken', 'sessionId', 'fr_session', 'apiKey', 'password'];
    for (const schema of entrees) {
      const cles = new Set(walk(schema).keys);
      for (const mot of interdits) {
        expect(cles.has(mot), `${mot} ne doit pas voyager en query string`).toBe(false);
      }
    }
    // Et la preuve que la ligne ci-dessus regarde bien quelque chose :
    expect([...walk(zAuthCallbackQuery).keys]).toContain('code');
  });

  it('uuid et ulid ne se confondent pas : chaque identifiant a sa forme', () => {
    // `correlationId` est un UUID (enveloppe de journal), les identifiants
    // d'entités sont des ULID. Une route qui accepterait l'un pour l'autre
    // laisserait entrer un identifiant fabriqué.
    expect(zCampaignParams.safeParse({ id: ulid }).success).toBe(true);
    expect(zCampaignParams.safeParse({ id: uuid }).success).toBe(false);
  });
});
