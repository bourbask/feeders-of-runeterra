/**
 * The turn's context, assembled from the base (02-mj-ia.md section 4.1).
 *
 * `buildNarrateRequest` is `@for/ai`'s, pure, and it does the hard part: the
 * order of the blocks, the four cache hints, the truncation ladder and the
 * budget. What it cannot do is READ — it has no database and no content
 * registry, by design (ARCHITECTURE.md section 4.3). This file is the reading
 * half: chronicle, rolling window, state, vocabulary.
 *
 * ── INVARIANT 2 IS WHAT THIS FILE IS FOR ─────────────────────────────────
 * Nothing about a campaign lives in this process between two turns. Every
 * block below is read back from SQLite at the top of every call, which is why
 * the sixth month costs the same as the second week.
 *
 * ── WHAT IS NOT ASSEMBLED HERE, AND WHY IT IS SAID ───────────────────────
 * `<lore>` is empty. Section 4.1 fills it with up to three content extracts
 * chosen by relevance to the scene, and « relevance » has no implementation
 * anywhere in this repository — `get_lore` was its producer, and ADR 0011
 * removed the tool table. An empty `<lore>` is honest: the ladder's T1 and T6
 * rungs cut a list that is already empty, and the prompt carries no extract
 * nobody chose. Filling it is a retrieval design, not a wiring task, and it
 * is reported rather than faked with « the first three entities ».
 */

import { renderChronicleParts } from '@for/ai';
import { latestChronicle } from '@for/db';

import { sceneBefore } from './scene-state.js';

import type { ChronicleParts, EtatParts, FactVocabulary, TrimmableContext } from '@for/ai';
import type { ContentRegistry } from '@for/content';
import type { ChronicleDoc, NarrationBriefDto, SceneStateDto } from '@for/contracts';
import type { SqliteConnection } from '@for/db';
import type { CampaignState, Outcome } from '@for/engine';

/** Section 4.1: twelve turns, oldest first. Invariant 2's own bound. */
export const ROLLING_WINDOW_TURNS = 12;

const EMPTY_CHRONICLE: ChronicleParts = {
  premise: '',
  openArcs: '',
  otherArcs: '',
  characters: '',
  sceneNpcs: '',
  otherNpcs: '',
  places: '',
  sceneFacts: '',
  otherFacts: '',
  openThreads: '',
  recentDigest: '',
};

/** The chronicle in service, split along the ladder's seams. */
export function chronicleParts(
  connection: SqliteConnection,
  campaignId: string,
  scene: SceneStateDto | null,
): ChronicleParts {
  const row = latestChronicle(connection, campaignId);
  if (row === undefined) return EMPTY_CHRONICLE;
  return renderChronicleParts(JSON.parse(row.doc_json) as ChronicleDoc, scene);
}

/**
 * The rolling window: the frozen rendering of a past turn, then the narration
 * it produced, alternating, oldest first.
 *
 * `ai_turn_renders` is read and NEVER recomputed — 03-donnees.md section 1.5
 * says so in capitals, and the reason is the cache: a date format or a key
 * order that changed would move the prefix of the whole window.
 */
export function rollingWindow(
  connection: SqliteConnection,
  campaignId: string,
  turns: number = ROLLING_WINDOW_TURNS,
): readonly string[] {
  const rendered = connection
    .prepare(
      `SELECT event_seq, rendered_fact FROM ai_turn_renders
        WHERE campaign_id = ? ORDER BY event_seq DESC LIMIT ?`,
    )
    .all(campaignId, turns) as { event_seq: number; rendered_fact: string }[];

  const messages = connection
    .prepare(
      `SELECT seq, json_extract(payload_json, '$.text') AS text FROM events
        WHERE campaign_id = ? AND type = 'narration.gm_message'
        ORDER BY seq DESC LIMIT ?`,
    )
    .all(campaignId, turns) as { seq: number; text: string | null }[];

  const pairs: string[] = [];
  const facts = [...rendered].reverse();
  const said = [...messages].reverse();
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index];
    const answer = said[index];
    if (fact !== undefined) pairs.push(fact.rendered_fact);
    if (answer?.text != null) pairs.push(answer.text);
  }
  return pairs;
}

/**
 * `<etat>`, split along the seam T2 cuts it at.
 *
 * NUMBERS LIVE HERE, and only here: the scene block carries none (section
 * 4.7.2), so this is the one place a gauge is written out for the model. They
 * are written in figures on purpose — the prompt forbids the model to write a
 * figure, not to read one.
 */
export function etatParts(state: CampaignState, content: ContentRegistry): EtatParts {
  const characters = Object.values(state.characters)
    .filter((character) => character.status === 'active')
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(
      (character) =>
        `- ${character.displayName} : vigueur ${String(character.gauges.vigueur)}, ` +
        `âme ${String(character.gauges.ame)}, vivres ${String(character.gauges.vivres)}, ` +
        `souffle ${String(character.momentum)}`,
    );

  const clocks = Object.values(state.clocks)
    .filter((clock) => clock.status === 'ticking')
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((clock) => `- ${clock.title} : ${String(clock.filled)}/${String(clock.segments)}`);

  const vows = Object.values(state.tracks)
    .filter((track) => track.status === 'open')
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((track) => `- ${track.title} (${track.rank})`);

  const assets = Object.values(state.characters)
    .filter((character) => character.status === 'active')
    .flatMap((character) =>
      character.assets.map(
        (asset) => `- ${character.displayName} : ${assetLabel(content, asset.assetId)}`,
      ),
    );

  return {
    core: [
      characters.length === 0 ? '' : `Personnages :\n${characters.join('\n')}`,
      clocks.length === 0 ? '' : `Horloges :\n${clocks.join('\n')}`,
      vows.length === 0 ? '' : `Serments :\n${vows.join('\n')}`,
    ]
      .filter((part) => part.length > 0)
      .join('\n'),
    inventoryAndIdleClocks: assets.length === 0 ? '' : `Atouts :\n${assets.join('\n')}`,
  };
}

/** An asset's French name, or its identifier when the bundle does not know it. */
export function assetLabel(content: ContentRegistry, assetId: string): string {
  const asset = content.listAssets().find((entry) => entry.id === assetId);
  return asset?.name ?? assetId;
}

/** Every asset name of one character. What `objet_inexistant` is proven against. */
export function assetNames(
  state: CampaignState,
  content: ContentRegistry,
  characterId: string | null,
): readonly string[] {
  if (characterId === null) return [];
  const character = Object.values(state.characters).find((entry) => entry.id === characterId);
  return (character?.assets ?? []).map((asset) => assetLabel(content, asset.assetId));
}

/** Everything the ladder may cut, read back from the base. */
export function trimmableContext(
  connection: SqliteConnection,
  content: ContentRegistry,
  state: CampaignState,
  campaignId: string,
): TrimmableContext {
  return {
    // Reported above: no retrieval, so no extract. Never a plausible filler.
    lore: [],
    etat: etatParts(state, content),
    turns: rollingWindow(connection, campaignId),
    chronicle: chronicleParts(
      connection,
      campaignId,
      state.scene === null ? null : sceneBefore(state),
    ),
  };
}

// -------------------------------------------------------------- the words

/** Section 2.1 spells the outcomes in capitals; `<fait>` copies that spelling. */
const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  franche: 'RÉUSSITE FRANCHE',
  partielle: 'RÉUSSITE PARTIELLE',
  echec: 'ÉCHEC',
};

/**
 * The French words of one turn, taken from the content bundle.
 *
 * `effectSentences` are what ALREADY HAPPENED, past tense. They are built from
 * the brief's applied effects — entries the journal already holds — so the
 * model is told a fact, never a thing to decide.
 */
export function factVocabulary(brief: NarrationBriefDto, content: ContentRegistry): FactVocabulary {
  const move = brief.moveId === null ? undefined : content.findMove(brief.moveId);
  return {
    moveLabel: move?.name ?? null,
    attributeLabel: brief.roll?.attribute ?? null,
    outcomeLabel: brief.outcome === null ? null : OUTCOME_LABELS[brief.outcome],
    effectSentences: brief.appliedEffects.map((applied) => effectSentence(applied.effect)),
  };
}

/**
 * One applied consequence, in one French sentence.
 *
 * It says WHAT HAPPENED and not what it costs to say it: the engine already
 * applied the effect and wrote the entry, and this sentence is the reading of
 * that entry. A branch that computed anything would be the invariant-1 back
 * door of `brief.ts`'s own header.
 */
function effectSentence(effect: NarrationBriefDto['appliedEffects'][number]['effect']): string {
  switch (effect.op) {
    case 'gauge':
      return `${effect.gauge} ${signed(effect.delta)}.`;
    case 'momentum':
      return `souffle ${signed(effect.delta)}.`;
    case 'momentum_reset':
      return 'souffle remis à son plancher.';
    case 'condition_add':
      return `condition « ${effect.conditionId} » posée.`;
    case 'condition_remove':
      return `condition « ${effect.conditionId} » levée.`;
    case 'track_tick':
      return `progression marquée sur une piste ${effect.trackKind}.`;
    case 'track_create':
      return `piste ${effect.trackKind} ouverte.`;
    case 'clock_advance':
      return `horloge avancée de ${String(effect.segments)}.`;
    case 'xp':
      return `${String(effect.amount)} d'expérience gagnée.`;
    case 'pay_price':
      return 'le prix a été payé.';
    case 'oracle':
      return "l'oracle a répondu.";
    case 'narrative':
      return effect.prompt;
    case 'choice':
      return `${effect.label}.`;
  }
}

const signed = (delta: number): string => `${delta >= 0 ? '+' : ''}${String(delta)}`;
