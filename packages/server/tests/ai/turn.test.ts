/**
 * UN TOUR DU CONTEUR, de bout en bout.
 *
 * C'est ici que se mesure l'ordre des trames, la retenue du bloc, le
 * post-filtre, le repli moteur, et la preuve d'un tour annulé.
 */

import { readFileSync, readdirSync } from 'node:fs';

import { CONTEUR_SYSTEM_PROMPT, SCENE_CLOSE_TAG, SCENE_OPEN_TAG } from '@for/ai';
import { staticContent } from '@for/content';
import { NarratorError } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import { NarrationDispatcher } from '../../src/ai/broadcast.js';
import { NarratorBreaker } from '../../src/ai/calls.js';
import { applyRefusal } from '../../src/ai/refusal.js';
import { sceneBefore } from '../../src/ai/scene-state.js';
import { RESERVED_CHAMPION_LEAK, runNarrationTurn } from '../../src/ai/turn.js';
import { runIntent } from '../../src/game/intent-pipeline.js';
import { readCorrelationGroup, readJournalSince } from '../../src/game/journal.js';
import { loadReplay } from '../../src/game/snapshots.js';
import { buildTurnProof } from '../../src/game/turn-proof.js';
import {
  CAMPAIGN_ID,
  CHARACTER_ID,
  NPC_GONE_NAME,
  OTHER_PLAYER_ID,
  PLAYER_ID,
  anAiTable,
  capturingLogger,
  recordingSink,
  scriptedNarrator,
  uuidAt,
} from './support.test.js';

import type { NarrationBrief } from '@for/engine';
import type { EventDelivery, TurnDeps } from '../../src/ai/turn.js';
import type { Table } from '../game/support.test.js';
import type { CapturingLogger, ScriptedNarrator, SinkFrame } from './support.test.js';

const EPOCH = 1_700_000_000_000;
const CONTENT = staticContent();

/** Une horloge qui avance de `step` à chaque lecture. */
function tick(start: number, step: number): () => number {
  let value = start;
  return () => {
    value += step;
    return value;
  };
}

/** Trois phrases, en français, deuxième personne, sans chiffre : ça passe le filtre. */
const GOOD_PROSE =
  'Tu passes la corniche, et la neige cède sous ton pied gauche. ' +
  'Le vent te prend de flanc et te plaque contre la paroi. ' +
  'Quelque chose bouge en contrebas, dans la pente.';

interface Rig {
  readonly table: Table;
  readonly deps: TurnDeps;
  readonly narrator: ScriptedNarrator;
  readonly logger: CapturingLogger;
  /** Tout ce qui est sorti, dans l'ORDRE, narration et événements mêlés. */
  readonly wire: WireFrame[];
  readonly dispatcher: NarrationDispatcher;
}

type WireFrame = SinkFrame | { readonly t: 's2c.event'; readonly p: { readonly type: string } };

function aRig(table: Table, narrator: ScriptedNarrator, over: Partial<TurnDeps> = {}): Rig {
  const wire: WireFrame[] = [];
  const dispatcher = new NarrationDispatcher();
  dispatcher.attach(CAMPAIGN_ID, recordingSink(PLAYER_ID, wire as SinkFrame[]));
  const logger = capturingLogger();
  /**
   * UNE HORLOGE QUI AVANCE À CHAQUE LECTURE.
   *
   * La fenêtre de coalescence de 50 ms est une VRAIE fenêtre : avec un `now`
   * figé, `pump` ne rendrait jamais la main et tout un tour sortirait en un
   * seul fragment — ce qui rendrait la retenue de la balise intestable là où
   * elle compte, c'est-à-dire à cheval sur plusieurs messages. Vingt
   * millisecondes par lecture, donc une fenêtre tous les trois fragments.
   */
  const clock = { now: tick(EPOCH, 20) };

  /**
   * LE HUB DIFFUSE PAR SÉQUENCE, jamais par le résultat de l'intention.
   * C'est le contrat que M0-24 a laissé par écrit : les entrées écrites par
   * le filet de sécurité de la brûlure sont journalisées et absentes du
   * résultat, donc diffuser le résultat laisserait un trou de `seq`.
   */
  const delivery: EventDelivery = {
    deliverSince: (campaignId, sinceSeq) => {
      for (const event of readJournalSince(table.connection, campaignId, sinceSeq)) {
        wire.push({ t: 's2c.event', p: { type: event.type } });
      }
    },
  };

  const deps: TurnDeps = {
    connection: table.connection,
    content: CONTENT,
    narrator,
    ids: table.ids,
    clock,
    logger,
    dispatcher,
    breaker: new NarratorBreaker(),
    delivery,
    fallbacks: table.deps.fallbacks,
    fallbackRng: (state) => table.deps.rng.forCampaign(state.rng.seed, state.seq + 1, 'fallback'),
    campaignBlock: '# Campagne : La table',
    systemPrompt: CONTEUR_SYSTEM_PROMPT,
    jitter: () => 0.5,
    wait: () => Promise.resolve(),
    ...over,
  };

  return { table, deps, narrator, logger, wire, dispatcher };
}

/** Joue une intention et rend le brief que `decide()` a produit. */
async function aPlayedTurn(
  table: Table,
  intentId: string,
  description: string,
  dice: { action: readonly number[]; price?: readonly number[]; presage?: readonly number[] },
): Promise<{ brief: NarrationBrief; sinceSeq: number }> {
  table.rng.script('action', dice.action);
  if (dice.price !== undefined) table.rng.script('price', dice.price);
  if (dice.presage !== undefined) table.rng.script('presage', dice.presage);
  const outcome = await runIntent(table.deps, {
    campaignId: CAMPAIGN_ID,
    playerId: PLAYER_ID,
    intentId,
    intent: { type: 'move.face_danger', attribute: 'vif', description },
  });
  if (outcome.kind !== 'accepted' || outcome.brief === undefined) {
    throw new Error(`le tour n'a pas abouti : ${JSON.stringify(outcome)}`);
  }
  const head = (
    table.connection
      .prepare(`SELECT MAX(seq) AS s FROM events WHERE campaign_id = ?`)
      .get(CAMPAIGN_ID) as { s: number }
  ).s;
  return { brief: outcome.brief, sinceSeq: head };
}

const narrationTypes = (table: Table): string[] =>
  (
    table.connection
      .prepare(
        `SELECT type FROM events WHERE campaign_id = ? AND type LIKE 'narration.%' ORDER BY seq`,
      )
      .all(CAMPAIGN_ID) as { type: string }[]
  ).map((row) => row.type);

const lastMessage = (table: Table): { text: string; source: string } => {
  const row = table.connection
    .prepare(
      `SELECT payload_json FROM events WHERE campaign_id = ?
         AND type = 'narration.gm_message' ORDER BY seq DESC LIMIT 1`,
    )
    .get(CAMPAIGN_ID) as { payload_json: string };
  return JSON.parse(row.payload_json) as { text: string; source: string };
};

// ═══════════════════════════════════════════════════════════════════════════

describe('le bloc <scene_apres> ne sort jamais', () => {
  it('aucun fragment ne le porte, et le texte persisté s’arrête avant la balise', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [6, 1, 2],
      });
      const answer = `${GOOD_PROSE}\n${SCENE_OPEN_TAG}{"presents":[{"nom":"Keld","etat":"debout"}]}${SCENE_CLOSE_TAG}`;
      const narrator = scriptedNarrator({ answers: [{ text: answer }], chunkSize: 3 });
      const rig = aRig(table, narrator);

      const result = await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });

      // AUCUN `s2c.narration_delta` ne porte la chaîne — et il y en a, sinon
      // la sonde serait vide.
      const fragments = rig.wire
        .filter((frame) => frame.t === 's2c.narration_delta')
        .map((frame) => frame.p.text);
      expect(fragments.length).toBeGreaterThan(1);
      expect(fragments.filter((text) => text.includes('scene_apres'))).toEqual([]);
      // ET LE TEXTE PERSISTÉ s'arrête avant la balise.
      expect(lastMessage(table).text).toBe(GOOD_PROSE);
      expect(lastMessage(table).text).not.toContain(SCENE_OPEN_TAG);
      // Le bloc, lui, a bien été LU : il n'est pas perdu, il n'est pas diffusé.
      expect(result.sceneBlock?.presents).toEqual([{ nom: 'Keld', etat: 'debout' }]);
    } finally {
      table.close();
    }
  });
});

describe('l’ordre exact après un refus retenu', () => {
  it('narration_done, puis narration_error, puis l’événement system.reverted', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(
        table,
        uuidAt(1),
        `Frapper ${NPC_GONE_NAME} avant qu'elle ne bouge.`,
        { action: [6, 1, 2] },
      );
      const refusal = `{"presents":[],"partis":[],"refus":{"cause":"cible_absente","cible":"${NPC_GONE_NAME}"}}`;
      const narrator = scriptedNarrator({
        answers: [{ text: `${GOOD_PROSE}\n${SCENE_OPEN_TAG}${refusal}${SCENE_CLOSE_TAG}` }],
      });
      const rig = aRig(table, narrator);

      const result = await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });
      expect(result.refusal.kind).toBe('upheld');

      // L'ORDRE EXACT, sur les trois canaux mêlés en une seule liste.
      const order = rig.wire
        .filter(
          (frame) =>
            frame.t === 's2c.narration_done' ||
            frame.t === 's2c.narration_error' ||
            (frame.t === 's2c.event' && frame.p.type === 'system.reverted'),
        )
        .map((frame) =>
          frame.t === 's2c.narration_error'
            ? `${frame.t}:${frame.p.code}`
            : frame.t === 's2c.event'
              ? `${frame.t}:${frame.p.type}`
              : frame.t,
        );
      expect(order).toEqual([
        's2c.narration_done',
        's2c.narration_error:action_impossible',
        's2c.event:system.reverted',
      ]);

      // AUCUN MESSAGE DE SUPPRESSION : il n'en existe pas dans le protocole,
      // et aucun ne sort. Le tour reste à l'écran, barré.
      expect(rig.wire.some((frame) => /delete|remove|purge/u.test(JSON.stringify(frame)))).toBe(
        false,
      );
    } finally {
      table.close();
    }
  });

  it('et la preuve du tour annulé existe toujours, avec son jet, son prix et son présage', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      // UN ÉCHEC AVEC PRÉSAGE : deux dés de défi identiques, et un total qui
      // ne les bat pas. L'échec de `face-danger` tire le prix.
      const { brief } = await aPlayedTurn(
        table,
        uuidAt(1),
        `Frapper ${NPC_GONE_NAME} avant qu'elle ne bouge.`,
        { action: [1, 8, 8], price: [7, 1], presage: [5] },
      );
      expect(brief.outcome).toBe('echec');
      expect(brief.isPresage).toBe(true);
      expect(brief.imposedPrice).not.toBeNull();

      // LE REFUS EST APPLIQUÉ DIRECTEMENT. Le tour complet passerait par le
      // post-filtre, et `price_respected` refuserait une prose qui ne met pas
      // le prix en scène : ce test-ci mesure la PREUVE après annulation, pas
      // le post-filtre, qui a ses propres tests juste en dessous.
      const state = loadReplay(table.connection, CAMPAIGN_ID).state;
      const outcome = applyRefusal(
        { connection: table.connection, ids: table.ids, logger: capturingLogger() },
        {
          campaignId: CAMPAIGN_ID,
          correlationId: uuidAt(1),
          refusal: { cause: 'cible_absente', cible: NPC_GONE_NAME },
          declaredCount: 1,
          state,
          sceneAtDeclaration: sceneBefore(state),
          actorCharacterId: CHARACTER_ID,
          intention: `Frapper ${NPC_GONE_NAME} avant qu'elle ne bouge.`,
          moveId: 'face-danger',
          actorAssets: [],
          aiCallId: '00000000000000000000000AAA',
          now: EPOCH,
        },
      );
      expect(outcome.kind).toBe('upheld');

      // « POURQUOI ? » SUR UN TOUR ANNULÉ : la preuve existe encore, et elle
      // porte ce qui a été annulé.
      const group = readCorrelationGroup(table.connection, CAMPAIGN_ID, uuidAt(1));
      const proof = buildTurnProof(group, PLAYER_ID);
      expect(proof).not.toBeNull();
      expect(proof?.status).toBe('reverted');
      expect(proof?.roll).not.toBeNull();
      expect(proof?.price).not.toBeNull();
      expect(proof?.presage).not.toBeNull();
      expect(proof?.effects.length).toBeGreaterThan(0);
      expect(proof?.revertedBy?.reason).toBe('gm_refusal:cible_absente');
    } finally {
      table.close();
    }
  });
});

describe('le post-filtre et le repli moteur', () => {
  it('une narration citant un champion réservé est refusée, relancée une fois, puis remplacée', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [6, 1, 2],
      });
      // `Braum` est le champion de l'AUTRE joueur, verrouillé par
      // `character.created`. Le conteur le nomme deux fois de suite.
      const leaking = `Braum se dresse devant toi sur la corniche. ${GOOD_PROSE}`;
      const narrator = scriptedNarrator({ answers: [{ text: leaking }, { text: leaking }] });
      const rig = aRig(table, narrator);

      await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });

      // DEUX APPELS : refusé, relancé UNE fois, puis repli.
      expect(narrator.narrateRequests).toHaveLength(2);
      // La relance porte les `<corrections>`, et elle les AJOUTE au message
      // utilisateur — elle ne réécrit ni le prompt système ni le bloc campagne.
      const retry = narrator.narrateRequests[1];
      expect(JSON.stringify(retry?.messages)).toContain('<corrections>');
      expect(retry?.system).toEqual(narrator.narrateRequests[0]?.system);

      // LE JOURNAL : `gm_failed` avec le bon `errorKind`, puis le repli moteur.
      expect(narrationTypes(table).slice(-2)).toEqual([
        'narration.gm_failed',
        'narration.gm_message',
      ]);
      const failure = table.connection
        .prepare(
          `SELECT payload_json FROM events WHERE campaign_id = ?
             AND type = 'narration.gm_failed' ORDER BY seq DESC LIMIT 1`,
        )
        .get(CAMPAIGN_ID) as { payload_json: string };
      expect(JSON.parse(failure.payload_json)).toMatchObject({
        errorKind: 'rejected_by_postfilter',
      });
      expect(lastMessage(table).source).toBe('engine');
      expect(lastMessage(table).text).not.toContain('Braum');

      // LA LIGNE DE JOURNAL, par ses TROIS CHAMPS.
      expect(rig.logger.lines.map((line) => line.fields)).toContainEqual(
        expect.objectContaining({
          event: RESERVED_CHAMPION_LEAK,
          campaignId: CAMPAIGN_ID,
          assertion: 'no_reserved_champion',
        }),
      );
    } finally {
      table.close();
    }
  });

  it('une narration qui remplace le prix est refusée par `price_respected`, puis repliée', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [1, 8, 9],
        price: [7, 1],
      });
      expect(brief.imposedPrice).not.toBeNull();

      // Une prose qui parle d'autre chose que du prix tiré : aucun mot-clé de
      // l'entrée n'y figure.
      const elsewhere =
        'Tu passes sans encombre et la pente se calme devant toi. ' +
        'Le ciel se dégage sur la vallée. ' +
        'Une odeur de bois brûlé monte du fond.';
      const narrator = scriptedNarrator({ answers: [{ text: elsewhere }, { text: elsewhere }] });
      const rig = aRig(table, narrator);

      await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });

      expect(narrator.narrateRequests).toHaveLength(2);
      expect(narrationTypes(table)).toContain('narration.gm_failed');
      expect(lastMessage(table).source).toBe('engine');
    } finally {
      table.close();
    }
  });

  it('une prose propre passe du premier coup, sans relance ni repli', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [6, 1, 2],
      });
      const narrator = scriptedNarrator({ answers: [{ text: GOOD_PROSE }] });
      const rig = aRig(table, narrator);
      const result = await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });
      expect(narrator.narrateRequests).toHaveLength(1);
      expect(result.source).toBe('ai');
      expect(narrationTypes(table)).not.toContain('narration.gm_failed');
      expect(lastMessage(table).source).toBe('ai');
    } finally {
      table.close();
    }
  });
});

describe('le moteur tire, point final (P10)', () => {
  it('`roll.price_paid` est écrit AVANT tout appel au port, et le brief porte le texte tiré à l’octet près', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [1, 8, 9],
        price: [7, 1],
      });

      // (1) L'ENTRÉE EST DÉJÀ AU JOURNAL, et le port n'a pas encore été appelé.
      const price = readJournalSince(table.connection, CAMPAIGN_ID, 0).find(
        (event) => event.type === 'roll.price_paid',
      );
      expect(price).toBeDefined();
      const narrator = scriptedNarrator({ answers: [{ text: GOOD_PROSE }] });
      // AUCUN APPEL AU PORT n'a encore eu lieu, et l'entrée est DÉJÀ écrite :
      // c'est l'ordre du §6 de `ARCHITECTURE.md`, mesuré plutôt qu'affirmé.
      expect(narrator.narrateRequests).toHaveLength(0);

      // (2) LE TEXTE DE L'ENTRÉE TIRÉE, À L'OCTET PRÈS, dans ce qui part au
      // modèle. Deux origines : la table de contenu, et les octets de la
      // requête.
      const entry = CONTENT.bundle.priceTable.entries.find(
        (candidate) => candidate.id === brief.imposedPrice?.entryId,
      );
      expect(entry).toBeDefined();
      expect(brief.imposedPrice?.text).toBe(entry?.text);

      const rig = aRig(table, narrator);
      await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });
      // Le port a été appelé, et la PREMIÈRE requête porte le texte de
      // l'entrée tirée, à l'octet près. (Le nombre d'appels appartient au
      // post-filtre, qui a ses propres tests : ce qui se mesure ici est ce
      // qui PART, pas combien de fois.)
      expect(narrator.narrateRequests.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(narrator.narrateRequests[0]?.messages)).toContain(
        JSON.stringify(entry?.text).slice(1, -1),
      );
    } finally {
      table.close();
    }
  });

  it('aucun mécanisme de choix de prix n’existe — et le critère, littéralement, est faux', () => {
    // ── LE CRITÈRE EST FAUX PAR CONSTRUCTION, ET ON LE MESURE ──────────────
    // La fiche écrit : `grep -rnE "price_choice|playerChoices|propose_price"
    // packages/server/src packages/ai/src packages/contracts/src | wc -l`
    // affiche `0`. Il affiche NEUF. Les neuf sont légitimes, et c'est
    // exactement le piège que la fiche décrit elle-même pour `optionId` : une
    // liste de noms INTERDITS doit pouvoir écrire ce qu'elle interdit.
    //
    //   - `'propose_price'` est un membre de `FORBIDDEN_TOOL_NAMES` — la PR
    //     #36 l'y a mis exprès, pour qu'il cesse d'être un littéral caché
    //     dans la boucle d'un test ;
    //   - les sept autres sont des COMMENTAIRES qui disent que le mécanisme
    //     n'existe pas, et deux tests qui le vérifient.
    //
    // Ce que le critère VEUT dire se mesure : aucun de ces trois mots n'est un
    // identifiant, une clé d'objet ou une valeur de schéma dans du code de
    // production. Donc on retire les commentaires, on retire les tests, et on
    // épingle l'unique occurrence qui reste.
    const raw: string[] = [];
    const inCode: string[] = [];
    for (const root of ['packages/server/src', 'packages/ai/src', 'packages/contracts/src']) {
      for (const file of walk(new URL(`../../../../${root}/`, import.meta.url))) {
        const source = readFileSync(file, 'utf8');
        for (const [index, line] of source.split('\n').entries()) {
          if (!/price_choice|playerChoices|propose_price/u.test(line)) continue;
          raw.push(`${file.pathname}:${String(index + 1)}`);
          if (file.pathname.endsWith('.test.ts')) continue;
          if (stripComments(source).includes(line.trim())) inCode.push(line.trim());
        }
      }
    }

    // Le compte littéral du critère, écrit en toutes lettres pour que le jour
    // où il change, ce test le dise.
    expect(raw).toHaveLength(9);

    // ET LA SEULE OCCURRENCE DE CODE est la liste des noms interdits.
    expect(inCode).toEqual(["'propose_price',"]);
  });

  it('`optionId` n’apparaît en code QUE dans la vérité de campagne', () => {
    // La fiche prévient elle-même que `optionId` porte ce nom depuis
    // l'origine, et demande que le grep « n'affiche QUE des lignes du payload
    // `campaign.truth_set` ». Littéralement il en affiche SIX : deux de code,
    // deux commentaires qui disent que le prix n'en porte pas, et deux lignes
    // d'un test qui le prouve. Les deux lignes de code sont mesurées ici.
    const raw: string[] = [];
    const inCode: string[] = [];
    for (const root of ['packages/server/src', 'packages/ai/src', 'packages/contracts/src']) {
      for (const file of walk(new URL(`../../../../${root}/`, import.meta.url))) {
        const source = readFileSync(file, 'utf8');
        for (const line of source.split('\n')) {
          if (!line.includes('optionId')) continue;
          raw.push(line.trim());
          if (file.pathname.endsWith('.test.ts')) continue;
          if (stripComments(source).includes(line.trim())) inCode.push(line.trim());
        }
      }
    }
    expect(raw).toHaveLength(6);
    // DEUX LIGNES, et les deux sont la vérité de campagne choisie par un
    // JOUEUR à la création — sans rapport avec le prix.
    expect(inCode).toEqual(['optionId: zSlug,', 'optionId: zSlug,']);
  });
});

describe('le mode dégradé volontaire', () => {
  it('le port simulé fait tourner tout le pipeline sans aucune sortie réseau', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [6, 1, 2],
      });
      // Le port du `stub` livré par M0-24 : il rend un texte VIDE, ce qui
      // n'est pas une panne — c'est un port qui n'ouvre aucune socket.
      const rig = aRig(table, scriptedNarrator({ answers: [{ text: '' }] }));
      const result = await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });

      // La partie avance, la narration est celle des gabarits de repli, et
      // AUCUN `gm_failed` n'est écrit : un journal qui crie au loup à chaque
      // tour est un journal que personne ne lit.
      expect(result.source).toBe('engine');
      expect(lastMessage(table).source).toBe('engine');
      expect(lastMessage(table).text.length).toBeGreaterThan(0);
      expect(narrationTypes(table)).not.toContain('narration.gm_failed');
    } finally {
      table.close();
    }
  });

  it('`AI_ENABLED` n’existe nulle part dans le code : un test échoue si le nom réapparaît', () => {
    const inCode: string[] = [];
    const inComments: string[] = [];
    for (const root of ['packages/server/src', 'packages/ai/src', 'packages/contracts/src']) {
      for (const file of walk(new URL(`../../../../${root}/`, import.meta.url))) {
        const source = readFileSync(file, 'utf8');
        if (!source.includes('AI_ENABLED')) continue;
        if (stripComments(source).includes('AI_ENABLED')) inCode.push(file.pathname);
        else inComments.push(file.pathname);
      }
    }
    // AUCUNE OCCURRENCE DE CODE. Le nom ne survit que dans une phrase qui dit
    // qu'il n'existe plus, et une phrase ne branche rien.
    expect(inCode).toEqual([]);
    // ET LA SONDE N'EST PAS VIDE : le mot est bien présent quelque part, donc
    // le test cherche vraiment. Sans cette ligne, supprimer le parcours
    // laisserait le premier `expect` vert pour la mauvaise raison.
    expect(inComments).toHaveLength(1);
  });
});

describe('le coupe-circuit, vu du tour', () => {
  it('un `quota_exhausted` n’est pas relancé et arme le mode dégradé', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [6, 1, 2],
      });
      const narrator = scriptedNarrator({
        answers: [
          {
            throws: new NarratorError({ code: 'quota_exhausted', providerId: 'stub' }),
          },
        ],
      });
      const breaker = new NarratorBreaker();
      const rig = aRig(table, narrator, { breaker });
      const result = await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });

      // UN SEUL APPEL : aucune relance.
      expect(narrator.narrateRequests).toHaveLength(1);
      expect(result.source).toBe('engine');
      expect(breaker.isOpen(CAMPAIGN_ID, EPOCH)).toBe(true);
      expect(narrationTypes(table)).toContain('narration.gm_failed');
      // La ligne `ai_calls` porte le code DU PORT.
      const call = table.connection
        .prepare(`SELECT error_code, status FROM ai_calls ORDER BY rowid DESC LIMIT 1`)
        .get() as { error_code: string; status: string };
      expect(call).toEqual({ error_code: 'quota_exhausted', status: 'error' });
    } finally {
      table.close();
    }
  });

  it('un `rate_limited` est relancé une fois, en respectant `retryAfterMs`', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [6, 1, 2],
      });
      const narrator = scriptedNarrator({
        answers: [
          {
            throws: new NarratorError({
              code: 'rate_limited',
              providerId: 'stub',
              retryAfterMs: 1234,
            }),
          },
          { text: GOOD_PROSE },
        ],
      });
      const waited: number[] = [];
      const rig = aRig(table, narrator, {
        wait: (ms) => {
          waited.push(ms);
          return Promise.resolve();
        },
      });
      const result = await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });
      // LE CHIFFRE VIENT DU FOURNISSEUR : 1234 n'est aucune valeur que le
      // backoff puisse produire.
      expect(waited).toEqual([1234]);
      expect(narrator.narrateRequests).toHaveLength(2);
      expect(result.source).toBe('ai');
    } finally {
      table.close();
    }
  });

  it('un `bad_request` n’est jamais relancé', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [6, 1, 2],
      });
      const narrator = scriptedNarrator({
        answers: [{ throws: new NarratorError({ code: 'bad_request', providerId: 'stub' }) }],
      });
      const rig = aRig(table, narrator);
      await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });
      expect(narrator.narrateRequests).toHaveLength(1);
    } finally {
      table.close();
    }
  });
});

describe('la diffusion se fait par séquence', () => {
  it('DEUX INSTANTS : une entrée commise PENDANT la génération sort quand même', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [6, 1, 2],
      });

      // DEUX ACTEURS : pendant que le conteur écrit pour Ashe, Braum parle.
      const narrator = interleavingNarrator(GOOD_PROSE, async () => {
        await runIntent(table.deps, {
          campaignId: CAMPAIGN_ID,
          playerId: OTHER_PLAYER_ID,
          intentId: uuidAt(2),
          intent: { type: 'speech.say', channel: 'ic', text: 'Je tiens la corde.' },
        });
      });

      const rig = aRig(table, narrator);
      await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });

      const delivered = rig.wire
        .filter((frame) => frame.t === 's2c.event')
        .map((frame) => frame.p.type);
      // La parole de l'autre joueur est SORTIE : diffuser le résultat de
      // l'intention l'aurait laissée dans le journal sans jamais l'écrire, et
      // le `seq` du client aurait un trou.
      expect(delivered).toContain('narration.player_message');
      expect(delivered).toContain('narration.gm_message');
      // Et l'ordre reste celui du journal, sans trou.
      const written = readJournalSince(table.connection, CAMPAIGN_ID, sinceSeq).map(
        (event) => event.type,
      );
      expect(delivered).toEqual(written);
    } finally {
      table.close();
    }
  });

  it('tout ce que le tour a écrit sort, dans l’ordre du journal', async () => {
    const table = anAiTable({ momentum: 2 });
    try {
      const { brief, sinceSeq } = await aPlayedTurn(table, uuidAt(1), 'Traverser la corniche.', {
        action: [6, 1, 2],
      });
      const rig = aRig(table, scriptedNarrator({ answers: [{ text: GOOD_PROSE }] }));
      await runNarrationTurn(rig.deps, {
        campaignId: CAMPAIGN_ID,
        brief,
        state: loadReplay(table.connection, CAMPAIGN_ID).state,
        sinceSeq,
        now: EPOCH,
      });

      const delivered = rig.wire
        .filter((frame) => frame.t === 's2c.event')
        .map((frame) => frame.p.type);
      const written = readJournalSince(table.connection, CAMPAIGN_ID, sinceSeq).map(
        (event) => event.type,
      );
      // DEUX ORIGINES : ce qui est sorti, et ce que le JOURNAL a gagné.
      expect(delivered).toEqual(written);
      expect(delivered).toContain('narration.gm_message');
    } finally {
      table.close();
    }
  });
});

/** Le source privé de ses commentaires : ce qui reste branche quelque chose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[^]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

/**
 * Un port qui laisse quelqu'un d'autre écrire PENDANT qu'il parle.
 *
 * Section 5 bis : « deux instants au lieu d'un ». La tête du journal est lue
 * AVANT l'appel au port, et la diffusion a lieu APRÈS — une entrée commise
 * entre les deux est exactement le trou que M0-24 a nommé par écrit.
 */
function interleavingNarrator(text: string, during: () => Promise<void>): ScriptedNarrator {
  const base = scriptedNarrator({ answers: [{ text }] });
  return {
    ...base,
    narrer: (request) => {
      const inner = base.narrer(request)[Symbol.asyncIterator]();
      let done = false;
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            if (!done) {
              done = true;
              await during();
            }
            return inner.next();
          },
        }),
      };
    },
  };
}

/** Tous les `.ts` sous une racine, récursivement. */
function walk(root: URL): URL[] {
  const out: URL[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, root);
    if (entry.isDirectory()) out.push(...walk(child));
    else if (entry.name.endsWith('.ts')) out.push(child);
  }
  return out;
}
