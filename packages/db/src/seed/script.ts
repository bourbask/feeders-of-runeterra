/**
 * « Le Pacte de la Griffe-de-Givre » — the scripted campaign, beat by beat.
 *
 * THIS FILE IS MEANT TO BE READ IN A PULL REQUEST. That is the reason the
 * journal is not typed out entry by entry: a list of intents can be reviewed,
 * 248 hand-written entries cannot, and they would drift at the first payload
 * change (task sheet M0-26). What a beat says is WHAT THE TABLE DID; what
 * comes of it is whatever `decide()` decides with the dice `DEMO_SEED` gives.
 *
 * ── WHAT THE DICE ARE ALLOWED TO DECIDE, AND WHAT THEY ARE NOT ───────────
 * No outcome is chosen here. The script chooses the move, the attribute and
 * the moment; the engine chooses the result. Where the demo needs a REMARKABLE
 * roll — a clean hit, a partial, a miss, a presage, a burned momentum, a
 * negated die, a score capped at ten — it arranges the CONDITIONS (a bonus
 * large enough to reach the cap, a momentum worth burning, a forged sheet that
 * came back with a negative momentum) and then takes what comes.
 *
 * ── THE ONE VOW THAT IS ACCOMPLISHED, AND WHY IT IS NOT A CHEAT ──────────
 * 03-donnees.md section 7.1 asks for « 1 accompli (dangereux) », and the first
 * release of this seed had NOTHING succeed in the whole arc: five vows ending
 * failed, open, forsaken, abandoned, open. That left the `fulfilled` branch of
 * `track.resolved` — and the XP-by-rank that goes with it — unexercised by any
 * realistic data, in the fixture the golden corpora, the eval harness and the
 * end-to-end run all read from. It also made a demo campaign in which nobody
 * ever succeeds at anything.
 *
 * What is scripted is the SCORE and nothing else: Braum marks three milestones
 * on a `dangereux` vow, which is 24 ticks, which the engine reads as six
 * complete boxes. The two challenge dice are drawn by `createCampaignRng` on
 * the campaign seed, and `fulfill-your-vow` fulfils on a weak hit as well as on
 * a strong one. They came up 8 and 5, so the vow closes on a `partielle`: it is
 * done, and it costs. Had they come up higher it would have failed, and the
 * seed would say so.
 *
 * ── THE FORGED SHEET THAT CAME BACK WRONG, AND WHY IT IS IN THE DEMO ─────
 * Udyr is created with a NEGATIVE momentum. That is not a flourish: negative
 * momentum is the only state in which the rules can cancel an action die
 * (`isMomentumNegated`), and NO EFFECT IN `content/` EVER DRIVES MOMENTUM
 * BELOW ZERO — twenty-one `momentum` effects, all positive, and
 * `momentum_reset` lands on +2. So `character.momentum_negated` would be
 * unreachable, and the seed would have to fake it. It does not: the forge
 * produced a sheet with a negative starting momentum, the table played with it
 * for three moves, and the rules cancelled a die exactly as they are written
 * to. Every number in that entry was drawn, none was typed.
 *
 * ── THE FOUR THINGS THE SHIPPED CONTENT CANNOT REACH ─────────────────────
 * Measured against `content/`, not deduced: `clock.advanced`, `clock.filled`,
 * `character.condition_removed` and `character.xp_spent` have no path through
 * `decide()` today. The first two need a `clock_advance` effect and no move
 * carries one; the third needs `condition_remove`, which only an ASSET ability
 * carries and no intent triggers; the fourth needs a negative `xp` effect and
 * every `xp` in the bundle is positive. All four are written here the way the
 * server writes them — a validated storyteller proposal, or a player action —
 * and all four are reported with the task.
 *
 * `clock.advanced` is the one of the four that carries ARITHMETIC, so its three
 * numbers are not written here: `Director.clockAdvance` reads `from` off the
 * reduced state and derives `to`. This file says which clock and how hard.
 */

import { DEMO_CHARACTERS, DEMO_ENTITIES, DEMO_TRUTHS, FORGED_SHEETS } from './cast.js';
import type { AuthoredEvent, Director } from './director.js';
import { DemoScriptInconsistent, authored } from './director.js';
import type { DemoContent } from './engine-content.js';
import { previousPackHash, previousPackVersion } from './engine-content.js';

import type {
  AiCallId,
  CampaignId,
  CharacterId,
  ChronicleId,
  ClockId,
  EntityId,
  IdFactory,
  PlaySessionId,
  PlayerId,
  ProposalId,
  RollId,
  SceneId,
  TrackId,
} from '@for/engine';

/** Where `pnpm db:seed --minimal` stops: the first scene, closed. */
export const FIRST_SCENE_MARK = 'fin-de-la-premiere-scene';

/** Everything `ai_calls` needs for one call the journal names. */
export interface RegisteredAiCall {
  readonly id: AiCallId;
  readonly purpose: 'narration' | 'forge' | 'chronicle' | 'judge';
  readonly model: string;
  readonly promptVersion: string;
  readonly responseText: string | null;
  readonly finishReason: string | null;
  readonly errorCode: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly trimLevel: number;
  readonly status: 'ok' | 'refused' | 'invalid_output' | 'error' | 'timeout';
  readonly errorText: string | null;
  readonly resultingEventSeq: number | null;
  readonly createdAt: number;
}

export interface DemoIdentitiesView {
  readonly campaignId: CampaignId;
  readonly players: ReadonlyMap<string, PlayerId>;
  readonly characters: ReadonlyMap<string, CharacterId>;
  readonly entities: ReadonlyMap<string, EntityId>;
  readonly sessions: readonly PlaySessionId[];
  readonly chronicles: readonly ChronicleId[];
}

export interface DemoStage {
  readonly director: Director;
  readonly ids: IdFactory;
  readonly content: DemoContent;
  readonly identities: DemoIdentitiesView;
  registerAiCall(call: RegisteredAiCall): AiCallId;
}

const NARRATION_MODEL = 'stub';
const NARRATION_PROMPT = 'conteur/2.0.0';

/** The eight standard values an `ai_calls` row carries when nothing went wrong. */
function okCall(
  stage: DemoStage,
  purpose: RegisteredAiCall['purpose'],
  text: string,
  promptVersion: string,
): AiCallId {
  return stage.registerAiCall({
    id: stage.ids.next() as AiCallId,
    purpose,
    model: NARRATION_MODEL,
    promptVersion,
    responseText: text,
    finishReason: 'complete',
    errorCode: null,
    inputTokens: 2200 + text.length,
    outputTokens: Math.ceil(text.length / 4),
    latencyMs: 1200,
    trimLevel: 0,
    status: 'ok',
    errorText: null,
    resultingEventSeq: null,
    createdAt: stage.director.now,
  });
}

/**
 * One paragraph of storyteller prose, and the call that produced it.
 *
 * ── WHAT `to` IS FOR, AND WHY THE DEMO USES IT TWICE ─────────────────────
 * ADR 0008 puts a visibility scope on the ENVELOPE, and invariant 4 now reads
 * "replaying from one player's point of view must give back exactly what that
 * player saw". A journal made only of `table` entries lets a broken filter
 * pass, so the demo carries two addressed entries — one `private`, one
 * `subset`.
 *
 * THEY ARE BOTH `narration.*`, AND THAT IS A DELIBERATE BOUND rather than a
 * shortcut. ADR 0008 decision 1 keeps the split party for M1, and
 * `decide()` writes `DEFAULT_SCOPE = 'table'` on every entry it produces: no
 * GAME-STATE entry of this campaign is addressed, and none should be. What is
 * addressed is what one player HEARD — which has no effect on the reducer
 * (03-donnees.md section 0.5), so a per-player replay rebuilds exactly the
 * same projections while giving back a different thread. That is the property
 * worth having in a fixture, and it is a choice, not an omission.
 */
function gm(
  stage: DemoStage,
  text: string,
  cited: readonly number[],
  options: { readonly respondsTo?: number; readonly to?: readonly PlayerId[] } = {},
): AuthoredEvent {
  const aiCallId = okCall(stage, 'narration', text, NARRATION_PROMPT);
  const audience = options.to ?? null;
  return authored(
    'narration.gm_message',
    {
      text,
      aiCallId,
      model: NARRATION_MODEL,
      promptVersion: NARRATION_PROMPT,
      source: 'ai',
      ...(options.respondsTo === undefined ? {} : { respondsToSeq: options.respondsTo }),
      citedEventSeqs: [...cited],
    },
    audience === null
      ? { actorKind: 'gm_ai' }
      : {
          actorKind: 'gm_ai',
          scope: audience.length === 1 ? 'private' : 'subset',
          recipients: audience,
        },
  );
}

/** The last journal sequence of a group, for `respondsToSeq`. */
function lastSeq(events: readonly { readonly seq: number }[]): number {
  const last = events[events.length - 1];
  if (last === undefined) throw new Error('groupe vide : aucune séquence à citer');
  return last.seq;
}

/**
 * A lookup that NAMES what is missing.
 *
 * Every identifier the script reaches for was minted before the first entry,
 * so a miss is a typo in this file and not a runtime possibility — but a
 * non-null assertion would turn that typo into an `undefined` travelling into
 * a payload, which is the failure `@for/content`'s registry exists to stop.
 */
function demand<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new DemoScriptInconsistent(`${what} introuvable`);
  return value;
}

const characterOf = (stage: DemoStage, key: string): CharacterId =>
  demand(stage.identities.characters.get(key), `personnage « ${key} »`);
const playerOf = (stage: DemoStage, handle: string): PlayerId =>
  demand(stage.identities.players.get(handle), `joueur « ${handle} »`);
const entityOf = (stage: DemoStage, key: string): EntityId =>
  demand(stage.identities.entities.get(key), `entité « ${key} »`);
const vowIn = (vows: Record<string, TrackId>, key: string): TrackId =>
  demand(vows[key], `serment de « ${key} »`);

/** `character.created` plus the lock it sets (ARCHITECTURE.md section 4.4). */
function createCharacter(stage: DemoStage, key: string): readonly AuthoredEvent[] {
  const sheet = DEMO_CHARACTERS.find((candidate) => candidate.key === key);
  if (sheet === undefined) throw new Error(`personnage inconnu : ${key}`);
  const characterId = characterOf(stage, key);
  const playerId = playerOf(stage, sheet.player);
  const snapshot =
    sheet.sheetSource === 'handwritten'
      ? stage.content.championSheet(sheet.championId)
      : demand(FORGED_SHEETS[sheet.championId], `fiche forgée « ${sheet.championId} »`);
  return [
    authored(
      'character.created',
      {
        characterId,
        playerId,
        championId: sheet.championId,
        displayName: sheet.displayName,
        sheetSource: sheet.sheetSource,
        sheetRef:
          sheet.sheetSource === 'handwritten'
            ? `content/champions/${sheet.championId}.json`
            : `champion_sheets:${sheet.championId}`,
        sheetSnapshot: snapshot,
        attributes: sheet.attributes,
        gauges: sheet.gauges,
        momentum: sheet.momentum,
      },
      { actorKind: 'player', actorPlayerId: playerId, subjectCharacterId: characterId },
    ),
    authored(
      'party.champion_locked',
      {
        championId: sheet.championId,
        lockKind: 'reserved_pc',
        reason: `${sheet.displayName} est joué à cette table`,
      },
      { actorKind: 'system', subjectCharacterId: characterId },
    ),
  ];
}

/** The entity, introduced as the storyteller's validated proposal would. */
function introduce(stage: DemoStage, key: string): AuthoredEvent {
  const entity = DEMO_ENTITIES.find((candidate) => candidate.key === key);
  if (entity === undefined) throw new Error(`entité inconnue : ${key}`);
  return authored(
    'entity.introduced',
    {
      entityId: entityOf(stage, key),
      kind: entity.kind,
      slug: entity.slug,
      name: entity.name,
      summary: entity.summary,
      ...(entity.regionId === undefined ? {} : { regionId: entity.regionId }),
      ...(entity.championId === undefined ? {} : { championId: entity.championId }),
      ...(entity.disposition === undefined ? {} : { disposition: entity.disposition }),
      details: entity.details,
    },
    { actorKind: 'gm_ai' },
  );
}

/** The presence snapshot of a scene: complete and bounded, never a delta. */
function facts(
  stage: DemoStage,
  sceneId: SceneId,
  fields: {
    readonly placeId: string;
    readonly placeName: string;
    readonly timeOfDay: string;
    readonly present: readonly {
      readonly kind: 'character' | 'entity';
      readonly key: string;
      readonly name: string;
      readonly state: string;
    }[];
    readonly absent?: readonly {
      readonly kind: 'character' | 'entity';
      readonly key: string;
      readonly name: string;
      readonly cause: 'parti' | 'mort' | 'hors_de_portee';
    }[];
  },
): AuthoredEvent {
  const seq = stage.director.state.seq + 1;
  return authored(
    'scene.facts_updated',
    {
      sceneId,
      placeId: fields.placeId,
      placeName: fields.placeName,
      timeOfDay: fields.timeOfDay,
      present: fields.present.map((entry) => ({
        ref: {
          kind: entry.kind,
          id:
            entry.kind === 'character' ? characterOf(stage, entry.key) : entityOf(stage, entry.key),
        },
        name: entry.name,
        state: entry.state,
        sinceSeq: seq,
      })),
      absent: (fields.absent ?? []).map((entry) => ({
        ref: {
          kind: entry.kind,
          id:
            entry.kind === 'character' ? characterOf(stage, entry.key) : entityOf(stage, entry.key),
        },
        name: entry.name,
        cause: entry.cause,
        sinceSeq: seq,
      })),
      source: 'gm_ai',
    },
    { actorKind: 'gm_ai' },
  );
}

// ═════════════════════════════════════════════════════════════════════════
// The campaign
// ═════════════════════════════════════════════════════════════════════════

export function playDemoCampaign(stage: DemoStage): void {
  const { director } = stage;
  const sessionOne = demand(stage.identities.sessions[0], 'première séance');
  const sessionTwo = demand(stage.identities.sessions[1], 'deuxième séance');

  openTable(stage, sessionOne);
  sceneOne(stage);
  director.mark(FIRST_SCENE_MARK);
  const closed = restOfSessionOne(stage, sessionOne);
  sessionTwoPlay(stage, sessionTwo, closed.vows);
}

/** The table forms: the campaign, its truths, its four players, its locks. */
function openTable(stage: DemoStage, sessionOne: PlaySessionId): void {
  const { director, content } = stage;
  const owner = playerOf(stage, 'demo-mj');

  // The first entry of the journal already belongs to the first veillée: the
  // table opened the campaign at the table, not somewhere else (section 7.1
  // counts 180 + 68 = 248, so every entry has a session).
  director.openSession(sessionOne);

  director.write([
    authored(
      'campaign.created',
      {
        name: 'Le Pacte de la Griffe-de-Givre',
        slug: 'pacte-griffe-de-givre',
        pitch:
          "Trois clans, un col qui se referme, et un serment que personne n'a envie de jurer le premier.",
        ownerPlayerId: owner,
        contentPackVersion: content.version,
        contentPackHash: content.hash,
        rulesVersion: content.rulesVersion,
        rngSeed: director.state.rng.seed,
      },
      { actorKind: 'system', actorPlayerId: owner },
    ),
  ]);

  director.write(
    DEMO_TRUTHS.map((truth) =>
      authored(
        'campaign.truth_set',
        {
          truthId: truth.truthId,
          optionId: truth.optionId,
          ...('customText' in truth ? { customText: truth.customText } : {}),
        },
        { actorKind: 'player', actorPlayerId: owner },
      ),
    ),
  );

  director.write([
    authored(
      'campaign.settings_updated',
      {
        patch: { gmVerbosity: 'ample', allowForgedChampions: true },
        before: { gmVerbosity: 'standard', allowForgedChampions: false },
      },
      { actorKind: 'player', actorPlayerId: owner },
    ),
    authored(
      'campaign.status_changed',
      { from: 'draft', to: 'active', reason: 'première veillée' },
      { actorKind: 'player', actorPlayerId: owner },
    ),
  ]);

  director.write([
    authored(
      'session.opened',
      {
        playSessionId: sessionOne,
        ordinal: 1,
        title: 'Première veillée — la Porte Basse',
        presentPlayerIds: [
          owner,
          playerOf(stage, 'demo-braum'),
          playerOf(stage, 'demo-ashe'),
          playerOf(stage, 'demo-sejuani'),
        ],
      },
      { actorKind: 'system', actorPlayerId: owner },
    ),
  ]);

  for (const key of ['braum', 'ashe', 'sejuani', 'olaf']) {
    director.write(createCharacter(stage, key));
    director.play(
      characterOf(stage, key),
      { type: 'campaign.join', characterId: characterOf(stage, key) },
      `${key} rejoint la table`,
    );
  }

  director.write([
    authored(
      'party.member_role_changed',
      { playerId: owner, from: 'player', to: 'owner' },
      { actorKind: 'player', actorPlayerId: owner },
    ),
    ...['lissandra', 'volibear', 'trundle', 'gragas'].map((championId) =>
      authored(
        'party.champion_locked',
        { championId, lockKind: 'allowed_npc' as const, reason: 'le conteur peut s’en servir' },
        { actorKind: 'system' },
      ),
    ),
  ]);
}

/** Scene 1 — La Porte Basse. `--minimal` stops when it closes. */
function sceneOne(stage: DemoStage): SceneId {
  const { director } = stage;
  const sceneId = stage.ids.next() as SceneId;

  const opening = director.write([
    authored(
      'scene.started',
      {
        sceneId,
        title: 'La Porte Basse',
        regionId: 'rakelstake',
        entityIds: [entityOf(stage, 'porte-basse'), entityOf(stage, 'keld')],
        presentCharacterIds: [
          characterOf(stage, 'braum'),
          characterOf(stage, 'ashe'),
          characterOf(stage, 'sejuani'),
          characterOf(stage, 'olaf'),
        ],
      },
      { actorKind: 'gm_ai' },
    ),
    introduce(stage, 'porte-basse'),
    introduce(stage, 'keld'),
    introduce(stage, 'veilleurs'),
  ]);

  director.write([
    gm(
      stage,
      'Le col tient encore. On y passe un chariot à la fois, jamais deux, et Keld compte les ' +
        'attelages depuis sa porte sans se donner la peine de sortir. La neige, elle, ne compte rien.',
      [lastSeq(opening.events)],
    ),
  ]);

  director.play(
    characterOf(stage, 'braum'),
    { type: 'speech.say', channel: 'ic', text: "« Keld ! Ouvre, c'est moi. Et j'ai du monde. »" },
    'Braum hèle Keld',
  );

  const braumPasses = director.play(
    characterOf(stage, 'braum'),
    {
      type: 'move.face_danger',
      attribute: 'coeur',
      description: "Braum se met devant le chariot et tient la porte le temps qu'il passe.",
    },
    'Braum tient la porte',
  );

  director.write([
    gm(
      stage,
      "Braum cale l'épaule contre le montant. Le bois craque, la neige tombe du linteau en " +
        'paquets, et le chariot passe. Keld ne dit rien, mais il note.',
      braumPasses.events.map((event) => event.seq),
      { respondsTo: lastSeq(braumPasses.events) },
    ),
  ]);

  director.play(
    characterOf(stage, 'ashe'),
    {
      type: 'oracle.ask',
      question: 'Keld accepte-t-il de parler de la tombe devant la Griffe d’Hiver ?',
      likelihood: 'peu-probable',
    },
    "Ashe consulte l'oracle",
  );

  const ashePresses = director.play(
    characterOf(stage, 'ashe'),
    {
      type: 'move.gather_information',
      description: 'Ashe fait parler Keld sur ce qui est passé par le col cet hiver.',
    },
    'Ashe fait parler Keld',
  );

  director.write([
    gm(
      stage,
      'Keld finit ses phrases par un chiffre. Trois attelages du nord, deux qui ne sont pas ' +
        "redescendus, et une brouette d'outils qu'il n'a pas reconnue.",
      ashePresses.events.map((event) => event.seq),
      // Keld answered ASHE, not the table: this line reaches one player.
      { respondsTo: lastSeq(ashePresses.events), to: [playerOf(stage, 'demo-ashe')] },
    ),
  ]);

  director.write([
    facts(stage, sceneId, {
      placeId: 'la-porte-basse',
      placeName: 'La Porte Basse',
      timeOfDay: 'fin de journée, la lumière baisse',
      present: [
        { kind: 'character', key: 'braum', name: 'Braum', state: 'épaule contre le montant' },
        { kind: 'character', key: 'ashe', name: 'Ashe', state: 'assise près du feu de Keld' },
        { kind: 'character', key: 'sejuani', name: 'Sejuani', state: 'dehors, elle ne rentre pas' },
        { kind: 'character', key: 'olaf', name: 'Olaf', state: 'il regarde le col se refermer' },
        { kind: 'entity', key: 'keld', name: 'Keld le Tanneur', state: 'sur le pas de sa porte' },
      ],
    }),
  ]);

  director.play(
    characterOf(stage, 'sejuani'),
    {
      type: 'speech.say',
      channel: 'ic',
      text: "« Je ne rentre pas. Ce qu'on se dit dehors, on peut encore le reprendre. »",
    },
    'Sejuani reste dehors',
  );

  director.write([
    authored(
      'scene.ended',
      { sceneId, outcome: 'le chariot est passé, et personne n’a encore rien promis' },
      { actorKind: 'system' },
    ),
  ]);

  return sceneId;
}

/** The track a `swear-a-vow` just opened, read off the journal it wrote. */
function vowOf(result: {
  readonly events: readonly { readonly type: string; readonly payload: unknown }[];
}): TrackId {
  const created = result.events.find((event) => event.type === 'track.created');
  if (created === undefined) throw new Error('aucun serment ouvert par ce tour');
  return (created.payload as { trackId: string }).trackId as TrackId;
}

/** Scene 2 — the vows are sworn, and the first clock is opened. */
function sceneTwo(stage: DemoStage): {
  readonly sceneId: SceneId;
  readonly vows: Record<string, TrackId>;
  readonly publicClock: ClockId;
  readonly hiddenClock: ClockId;
} {
  const { director } = stage;
  const sceneId = stage.ids.next() as SceneId;

  director.write([
    authored(
      'scene.started',
      {
        sceneId,
        title: 'Le relais, la nuit',
        regionId: 'rakelstake',
        entityIds: [entityOf(stage, 'keld'), entityOf(stage, 'sigrid')],
        presentCharacterIds: [
          characterOf(stage, 'braum'),
          characterOf(stage, 'ashe'),
          characterOf(stage, 'sejuani'),
          characterOf(stage, 'olaf'),
        ],
      },
      { actorKind: 'gm_ai' },
    ),
    introduce(stage, 'sigrid'),
  ]);

  director.write([
    gm(
      stage,
      'Le feu de Keld tire mal. Sigrid la Passeuse entre sans frapper, secoue la neige de ses ' +
        "épaules et s'assied là où on voit la porte. Personne ne lui demande ce qu'elle fait là.",
      [director.state.seq],
    ),
  ]);

  const braumVow = director.play(
    characterOf(stage, 'braum'),
    {
      type: 'move.swear_a_vow',
      text: 'Faire passer le chariot du Gué Bas avant que le col se ferme.',
      rank: 'dangereux',
    },
    'Braum jure de faire passer le chariot',
  );

  const asheVow = director.play(
    characterOf(stage, 'ashe'),
    {
      type: 'move.swear_a_vow',
      text: 'Savoir qui a ouvert la Tombe Basse, et le dire devant les trois clans.',
      rank: 'redoutable',
    },
    'Ashe jure de trouver qui a creusé',
  );

  const sejuaniVow = director.play(
    characterOf(stage, 'sejuani'),
    {
      type: 'move.swear_a_vow',
      text: "Ne rien prendre au Gué Bas tant que la Porte Basse n'est pas rouverte.",
      rank: 'extreme',
    },
    'Sejuani jure de ne rien prendre',
  );

  const olafVow = director.play(
    characterOf(stage, 'olaf'),
    {
      type: 'move.swear_a_vow',
      text: 'Remonter voir combien ils sont, et redescendre le dire.',
      rank: 'genant',
    },
    'Olaf jure de remonter voir les Veilleurs',
  );

  const proposalId = stage.ids.next() as ProposalId;
  const clockId = stage.ids.next() as ClockId;
  const opened = director.write([
    authored(
      'narration.gm_proposal',
      {
        proposalId,
        kind: 'clock',
        payload: { title: 'La neige tient le col', segments: 6, visibility: 'public' },
      },
      { actorKind: 'gm_ai' },
    ),
    authored(
      'clock.created',
      {
        clockId,
        title: 'La neige tient le col',
        description: 'Chaque nuit sans dégel rapproche la fermeture de la Porte Basse.',
        segments: 6,
        visibility: 'public',
        consequence: 'La Porte Basse se ferme jusqu’au printemps.',
      },
      { actorKind: 'system' },
    ),
  ]);
  director.write([
    authored(
      'narration.proposal_accepted',
      { proposalId, resultingEventSeqs: [lastSeq(opened.events)] },
      { actorKind: 'system' },
    ),
  ]);

  const hiddenClock = stage.ids.next() as ClockId;
  director.write([
    authored(
      'clock.created',
      {
        clockId: hiddenClock,
        title: 'Ce qui remonte de la tombe',
        description: 'Ce que la bande ne voit pas encore, et qui avance quand même.',
        segments: 8,
        visibility: 'gm',
        consequence: 'Les Veilleurs arrivent avant eux à la Tombe Basse.',
      },
      { actorKind: 'system' },
    ),
  ]);

  director.play(
    characterOf(stage, 'olaf'),
    {
      type: 'speech.say',
      channel: 'ic',
      text: "« Vous jurez beaucoup pour des gens qui n'ont pas encore passé le col. »",
    },
    'Olaf commente les serments',
  );

  director.write([
    facts(stage, sceneId, {
      placeId: 'la-porte-basse',
      placeName: 'Le relais de Keld',
      timeOfDay: 'nuit, le feu tire mal',
      present: [
        { kind: 'character', key: 'braum', name: 'Braum', state: 'il a juré le premier' },
        { kind: 'character', key: 'ashe', name: 'Ashe', state: 'elle écrit sur une écorce' },
        { kind: 'character', key: 'sejuani', name: 'Sejuani', state: 'debout près de la porte' },
        { kind: 'character', key: 'olaf', name: 'Olaf', state: 'il rit sans qu’on sache de quoi' },
        { kind: 'entity', key: 'keld', name: 'Keld le Tanneur', state: 'il recompte ses peaux' },
        {
          kind: 'entity',
          key: 'sigrid',
          name: 'Sigrid la Passeuse',
          state: 'assise face à la porte',
        },
      ],
    }),
    authored(
      'scene.ended',
      { sceneId, outcome: 'trois serments jurés, aucun partagé' },
      { actorKind: 'system' },
    ),
  ]);

  return {
    sceneId,
    vows: {
      braum: vowOf(braumVow),
      ashe: vowOf(asheVow),
      sejuani: vowOf(sejuaniVow),
      olaf: vowOf(olafVow),
    },
    publicClock: clockId,
    hiddenClock,
  };
}

/** Scene 3 — the march, the cold, the burned momentum and the capped score. */
function sceneThree(stage: DemoStage, vows: Record<string, TrackId>, clockId: ClockId): SceneId {
  const { director } = stage;
  const sceneId = stage.ids.next() as SceneId;

  director.write([
    authored(
      'scene.started',
      {
        sceneId,
        title: 'La marche vers le Gué Bas',
        regionId: 'avarosa-reach',
        entityIds: [entityOf(stage, 'gue-bas')],
        presentCharacterIds: [
          characterOf(stage, 'braum'),
          characterOf(stage, 'ashe'),
          characterOf(stage, 'sejuani'),
          characterOf(stage, 'olaf'),
        ],
      },
      { actorKind: 'gm_ai' },
    ),
    introduce(stage, 'gue-bas'),
    introduce(stage, 'yrsa'),
  ]);

  for (const key of ['braum', 'ashe', 'sejuani']) {
    director.play(
      characterOf(stage, key),
      { type: 'move.endure_cold' },
      `${key} encaisse le froid de la marche`,
    );
  }

  // The clock the storyteller proposed, advanced by the server. No move in
  // `content/` carries a `clock_advance`, so this is the proposal circuit.
  // THE THREE NUMBERS ARE NOT WRITTEN HERE: `clockAdvance` reads `from` off the
  // reduced state and derives `to`. The script says which clock and how hard.
  director.write([director.clockAdvance(clockId, 3, 'gm:proposal')]);

  director.play(
    characterOf(stage, 'braum'),
    { type: 'move.reach_a_milestone', trackId: vowIn(vows, 'braum') },
    'Braum marque un jalon sur son serment',
  );

  director.play(
    characterOf(stage, 'ashe'),
    {
      type: 'move.secure_advantage',
      attribute: 'vif',
      description: "Ashe prend les devants et lit la glace avant que quelqu'un s'y engage.",
    },
    'Ashe prend les devants',
  );

  // A bonus large enough that the score reaches the cap. What the cap DOES is
  // the engine's business; the script only arranges for it to be reachable.
  director.play(
    characterOf(stage, 'sejuani'),
    {
      type: 'move.face_danger',
      attribute: 'fer',
      bonus: 6,
      description: 'Sejuani ouvre la trace au sanglier, droit dans le vent.',
    },
    'Sejuani ouvre la trace',
  );

  director.play(
    characterOf(stage, 'ashe'),
    { type: 'oracle.draw', oracleId: 'freljord-weather' },
    'la table consulte le temps qu’il fait',
  );

  director.write([
    authored(
      'narration.gm_failed',
      {
        errorKind: 'api_error',
        fallbackText:
          'Le vent tombe d’un coup. Personne ne parle, et la marche reprend dans le silence.',
      },
      { actorKind: 'system' },
    ),
  ]);

  director.write([
    facts(stage, sceneId, {
      placeId: 'le-gue-bas',
      placeName: 'Le Gué Bas',
      timeOfDay: 'aube grise',
      present: [
        { kind: 'character', key: 'braum', name: 'Braum', state: 'il ouvre la marche' },
        { kind: 'character', key: 'ashe', name: 'Ashe', state: 'elle a lu la glace la première' },
        { kind: 'character', key: 'sejuani', name: 'Sejuani', state: 'le sanglier devant' },
        { kind: 'character', key: 'olaf', name: 'Olaf', state: 'il ferme la marche' },
        { kind: 'entity', key: 'yrsa', name: 'Yrsa du Gué Bas', state: 'elle compte le grain' },
      ],
    }),
    authored(
      'scene.ended',
      { sceneId, outcome: 'le Gué Bas est atteint, le grenier est au tiers' },
      { actorKind: 'system' },
    ),
  ]);

  return sceneId;
}

/**
 * Scene 4 — Olaf falls, Udyr arrives and leaves, and one turn is cancelled.
 *
 * THE CANCELLED TURN IS THE POINT OF THIS SCENE, and it is P17 and P22 played
 * out on real data: Braum strikes an Olaf who is already dead, the dice are
 * rolled and written — the refusal comes AFTER the roll, never before — the
 * storyteller proves the target was dead, and the server reverts the whole
 * correlation group. Nothing is erased: the entries stay in the journal, the
 * client strikes them through, and the proof stays readable.
 */
function sceneFour(stage: DemoStage, vows: Record<string, TrackId>): SceneId {
  const { director } = stage;
  const sceneId = stage.ids.next() as SceneId;
  const owner = playerOf(stage, 'demo-mj');

  director.write([
    authored(
      'scene.started',
      {
        sceneId,
        title: 'Retour à la Porte Basse',
        regionId: 'rakelstake',
        entityIds: [entityOf(stage, 'porte-basse'), entityOf(stage, 'veilleurs')],
        presentCharacterIds: [
          characterOf(stage, 'braum'),
          characterOf(stage, 'ashe'),
          characterOf(stage, 'sejuani'),
          characterOf(stage, 'olaf'),
        ],
      },
      { actorKind: 'gm_ai' },
    ),
  ]);

  director.play(
    characterOf(stage, 'olaf'),
    {
      type: 'move.endure_harm',
      amount: 2,
    },
    'Olaf encaisse',
  );
  director.play(
    characterOf(stage, 'olaf'),
    {
      type: 'move.face_danger',
      attribute: 'fer',
      description: 'Olaf remonte seul vers les Veilleurs pour voir combien ils sont.',
    },
    'Olaf remonte seul',
  );

  // `character.died` has no `decide()` branch: nothing in the engine kills a
  // character today. Written the way the server writes it, with no arithmetic,
  // and reported with the task.
  director.write([
    authored(
      'character.died',
      {
        characterId: characterOf(stage, 'olaf'),
        cause: 'scene:porte-basse/embuscade',
        finalSceneId: sceneId,
      },
      { actorKind: 'engine', subjectCharacterId: characterOf(stage, 'olaf') },
    ),
    authored(
      'party.champion_unlocked',
      { championId: 'olaf', reason: 'le personnage est mort, le champion se libère' },
      { actorKind: 'system' },
    ),
    authored(
      'party.champion_locked',
      {
        championId: 'olaf',
        lockKind: 'allowed_npc',
        reason: 'ce qu’il en reste appartient au conteur',
      },
      { actorKind: 'system' },
    ),
    introduce(stage, 'olaf-npc'),
    authored(
      'track.abandoned',
      { trackId: vowIn(vows, 'olaf'), reason: 'son porteur est mort avant de redescendre' },
      { actorKind: 'system' },
    ),
  ]);

  director.write([
    gm(
      stage,
      "Olaf ne redescend pas. On retrouve sa hache plantée dans le montant, et rien d'autre. " +
        'Keld la décroche, la pose contre le mur, et ne dit pas un mot de la nuit.',
      [director.state.seq],
      // Braum and Ashe went back up; Sejuani had already left the fire.
      { to: [playerOf(stage, 'demo-braum'), playerOf(stage, 'demo-ashe')] },
    ),
    facts(stage, sceneId, {
      placeId: 'la-porte-basse',
      placeName: 'La Porte Basse',
      timeOfDay: 'seconde nuit',
      present: [
        { kind: 'character', key: 'braum', name: 'Braum', state: 'il tient la hache' },
        { kind: 'character', key: 'ashe', name: 'Ashe', state: 'elle compte ce qui manque' },
        {
          kind: 'character',
          key: 'sejuani',
          name: 'Sejuani',
          state: 'elle veut remonter tout de suite',
        },
        { kind: 'entity', key: 'olaf-npc', name: 'Olaf', state: 'on ne l’a pas ramené' },
      ],
      absent: [{ kind: 'character', key: 'olaf', name: 'Olaf', cause: 'mort' }],
    }),
  ]);

  // ── the turn that gets cancelled ────────────────────────────────────────
  director.write([
    authored(
      'entity.status_changed',
      {
        entityId: entityOf(stage, 'olaf-npc'),
        from: 'active',
        to: 'dead',
        cause: 'scene:porte-basse/embuscade',
      },
      { actorKind: 'gm_ai' },
    ),
  ]);

  const doomed = director.play(
    characterOf(stage, 'braum'),
    {
      type: 'move.strike',
      targetId: entityOf(stage, 'olaf-npc'),
      attribute: 'fer',
    },
    'Braum frappe dans le noir',
  );

  const refusal = stage.ids.next() as ProposalId;
  director.write([
    authored(
      'narration.gm_proposal',
      { proposalId: refusal, kind: 'refusal', payload: { cause: 'cible_morte', target: 'Olaf' } },
      { actorKind: 'gm_ai' },
    ),
  ]);
  const reverted = director.write([
    authored(
      'system.reverted',
      {
        targetSeqs: [...director.group(doomed.correlationId)],
        reason: 'gm_refusal:cible_morte',
        byPlayerId: null,
      },
      { actorKind: 'system' },
    ),
  ]);
  director.write([
    authored(
      'narration.proposal_accepted',
      { proposalId: refusal, resultingEventSeqs: [lastSeq(reverted.events)] },
      { actorKind: 'system' },
    ),
  ]);
  director.resync();

  // A proposal that does NOT pass: the rejection is an event of first rank.
  const rejected = stage.ids.next() as ProposalId;
  director.write([
    authored(
      'narration.gm_proposal',
      {
        proposalId: rejected,
        kind: 'refusal',
        payload: { cause: 'hors_de_portee', target: 'Keld' },
      },
      { actorKind: 'gm_ai' },
    ),
    authored(
      'narration.proposal_rejected',
      {
        proposalId: rejected,
        reasonCode: 'refusal_unproven',
        validationErrors: ['Keld est présent dans l’état de scène au moment du move.declared'],
      },
      { actorKind: 'system' },
    ),
  ]);

  // ── the owner's second character, and what a forged sheet costs ─────────
  director.write(createCharacter(stage, 'udyr'));
  director.play(
    characterOf(stage, 'udyr'),
    { type: 'campaign.join', characterId: characterOf(stage, 'udyr') },
    'Udyr rejoint la table',
  );
  director.write([
    authored(
      'character.renamed',
      { characterId: characterOf(stage, 'udyr'), from: 'Udyr', to: 'Udyr le Taciturne' },
      { actorKind: 'player', actorPlayerId: owner, subjectCharacterId: characterOf(stage, 'udyr') },
    ),
  ]);

  for (const description of [
    'Udyr remonte la pente en suivant la trace des Veilleurs.',
    'Udyr force le passage là où la glace est la plus mince.',
    'Udyr s’arrête net et écoute ce qui vient d’en haut.',
  ]) {
    director.play(
      characterOf(stage, 'udyr'),
      { type: 'move.face_danger', attribute: 'fer', description },
      'Udyr monte avec un souffle négatif',
    );
  }

  director.write([
    authored(
      'character.attributes_corrected',
      {
        characterId: characterOf(stage, 'olaf'),
        from: { vif: 2, coeur: 1, fer: 3, ombre: 1, esprit: 2 },
        to: { vif: 2, coeur: 2, fer: 3, ombre: 1, esprit: 1 },
        reason: 'la fiche forgée avait interverti cœur et esprit',
      },
      { actorKind: 'system', subjectCharacterId: characterOf(stage, 'olaf') },
    ),
    authored(
      'character.sheet_rebound',
      {
        characterId: characterOf(stage, 'udyr'),
        fromSheetRef: 'champion_sheets:udyr',
        toSheetRef: 'champion_sheets:udyr@repare',
        reason: 'fiche forgée réparée, souffle de départ remis à zéro',
      },
      { actorKind: 'system', subjectCharacterId: characterOf(stage, 'udyr') },
    ),
  ]);

  director.play(
    characterOf(stage, 'udyr'),
    { type: 'campaign.leave' },
    'le propriétaire quitte le jeu',
  );
  director.write([
    authored(
      'character.retired',
      {
        characterId: characterOf(stage, 'udyr'),
        reason: 'il reprend les Sentiers de l’Éveil, et il ne dit pas quand il revient',
      },
      { actorKind: 'player', actorPlayerId: owner, subjectCharacterId: characterOf(stage, 'udyr') },
    ),
    authored(
      'party.champion_unlocked',
      { championId: 'udyr', reason: 'le personnage est retiré du jeu' },
      { actorKind: 'system' },
    ),
    authored(
      'party.champion_locked',
      { championId: 'udyr', lockKind: 'allowed_npc', reason: 'le conteur peut s’en servir' },
      { actorKind: 'system' },
    ),
  ]);

  // ── the vows move, one way or another ──────────────────────────────────
  // Braum does not claim the end of his vow here: the cart is through the
  // Porte Basse, which is two milestones at `dangereux`, and the claim waits
  // for the second veillée. What the dice do with it is `sessionTwoPlay`'s.
  for (const step of ['le chariot franchit la Porte Basse', 'le chariot redescend sans verser']) {
    director.play(
      characterOf(stage, 'braum'),
      { type: 'move.reach_a_milestone', trackId: vowIn(vows, 'braum') },
      `Braum marque un jalon : ${step}`,
    );
  }
  director.play(
    characterOf(stage, 'sejuani'),
    {
      type: 'move.forsake_your_vow',
      trackId: vowIn(vows, 'sejuani'),
      reason: 'la horde a pris le grain du Gué Bas pendant qu’elle regardait ailleurs',
    },
    'Sejuani renie son serment',
  );

  director.write([
    authored(
      'scene.ended',
      { sceneId, outcome: 'un mort, un départ, et un serment renié' },
      { actorKind: 'system' },
    ),
  ]);

  return sceneId;
}

/** One chronicle version, written by hand, with the call that stands for it. */
function compactChronicle(stage: DemoStage, version: number): void {
  const { director } = stage;
  const chronicleId = demand(
    stage.identities.chronicles[version - 1],
    `chronique v${String(version)}`,
  );
  const aiCallId = okCall(
    stage,
    'chronicle',
    `chronique version ${String(version)}`,
    'chronique/1.0.0',
  );
  director.write([
    authored(
      'chronicle.compacted',
      {
        chronicleId,
        version,
        kind: version === 1 ? 'rebuild' : 'incremental',
        sourceEventSeq: director.state.seq,
        aiCallId,
        tokenCount: 310 * version,
      },
      { actorKind: 'system' },
    ),
  ]);
}

/** The rest of the first session. Returns the vows it leaves behind. */
function restOfSessionOne(
  stage: DemoStage,
  sessionOne: PlaySessionId,
): { readonly vows: Record<string, TrackId> } {
  const { director } = stage;
  const owner = playerOf(stage, 'demo-mj');

  compactChronicle(stage, 1);

  const second = sceneTwo(stage);
  sceneThree(stage, second.vows, second.publicClock);
  sceneFour(stage, second.vows);

  // The two clocks end the session: the public one is resolved, the hidden one
  // fills and is then cancelled when the thread it carried turns out elsewhere.
  director.write([director.clockAdvance(second.publicClock, 3, 'gm:proposal')]);
  // The hidden clock got close enough to matter before the thread it carried
  // turned out to lead elsewhere. It is cancelled at three of eight, not at
  // zero: an empty clock proves nothing about the projection. Three is also
  // the ceiling a single proposed advance may carry (ARCHITECTURE.md 4.4).
  director.write([director.clockAdvance(second.hiddenClock, 3, 'gm:proposal')]);

  director.write([
    authored(
      'clock.filled',
      { clockId: second.publicClock, consequence: 'La Porte Basse se ferme jusqu’au printemps.' },
      { actorKind: 'engine' },
    ),
    authored(
      'clock.resolved',
      { clockId: second.publicClock, resolution: 'le col s’est fermé, et le chariot était passé' },
      { actorKind: 'system' },
    ),
    authored(
      'clock.cancelled',
      {
        clockId: second.hiddenClock,
        reason: 'les Veilleurs n’allaient pas à la tombe, la piste tombe',
      },
      { actorKind: 'system' },
    ),
  ]);

  // The last two lines of the veillée. No dice left to draw: what follows is
  // bookkeeping, so these two beats can be read as what they are — the table
  // saying goodnight.
  director.play(
    characterOf(stage, 'sejuani'),
    {
      type: 'speech.say',
      channel: 'ooc',
      text: '« Je reprends Sejuani la semaine prochaine, mais je ne promets rien pour le grain. »',
    },
    'la joueuse de Sejuani annonce la suite',
  );

  director.write([
    authored(
      'system.note',
      {
        text: 'Fin de veillée : reprendre sur la Tombe Basse la prochaine fois.',
        byPlayerId: owner,
      },
      { actorKind: 'player', actorPlayerId: owner },
    ),
  ]);

  compactChronicle(stage, 2);

  const firstSeq = 1;
  director.write([
    authored(
      'session.closed',
      {
        playSessionId: sessionOne,
        firstSeq,
        lastSeq: director.state.seq + 1,
        recapChronicleId: demand(stage.identities.chronicles[1], 'chronique v2'),
      },
      { actorKind: 'system' },
    ),
  ]);
  return { vows: second.vows };
}

/**
 * The second session, still live when the seed stops.
 *
 * It opens on a content pack bump, which is what `campaign.content_pack_changed`,
 * `system.rules_version_migrated` and `system.payload_upcast` are for: the
 * three entries a week between two veillées really produces.
 */
function sessionTwoPlay(
  stage: DemoStage,
  sessionTwo: PlaySessionId,
  vows: Record<string, TrackId>,
): void {
  const { director, content } = stage;
  const owner = playerOf(stage, 'demo-mj');

  director.skip(7 * 24 * 60 * 60 * 1000);
  director.openSession(sessionTwo);

  director.write([
    authored(
      'session.opened',
      {
        playSessionId: sessionTwo,
        ordinal: 2,
        title: 'Deuxième veillée — la Tombe Basse',
        presentPlayerIds: [
          playerOf(stage, 'demo-braum'),
          playerOf(stage, 'demo-ashe'),
          playerOf(stage, 'demo-sejuani'),
        ],
      },
      { actorKind: 'system', actorPlayerId: owner },
    ),
  ]);

  director.write([
    authored(
      'campaign.content_pack_changed',
      {
        fromVersion: previousPackVersion(content.version),
        fromHash: previousPackHash(content.hash),
        toVersion: content.version,
        toHash: content.hash,
        note: 'trois fiches de champion et onze mouvements relus entre les deux veillées',
      },
      { actorKind: 'system' },
    ),
    authored(
      'system.rules_version_migrated',
      {
        from: 1,
        to: content.rulesVersion,
        note: 'aucune règle de jeu n’a bougé, seule la version',
      },
      { actorKind: 'system' },
    ),
    authored(
      'system.payload_upcast',
      { fromVersion: 1, toVersion: 1, affectedTypes: [] },
      { actorKind: 'system' },
    ),
  ]);

  betweenVeillees(stage);

  director.write([
    authored(
      'roll.raw',
      {
        rollId: stage.ids.next() as RollId,
        label: 'combien de nuits avant que la neige tienne',
        dice: director.rawRoll(6, 1).map((die) => ({ sides: die.sides, value: die.value })),
        reason: 'question de couleur posée par la table, sans conséquence de règle',
      },
      { actorKind: 'system' },
    ),
    authored(
      'narration.safety_flag',
      { kind: 'veil', note: 'on coupe avant la description des engelures' },
      { actorKind: 'player', actorPlayerId: playerOf(stage, 'demo-ashe') },
    ),
  ]);

  const sceneId = stage.ids.next() as SceneId;
  director.write([
    authored(
      'scene.started',
      {
        sceneId,
        title: 'La Tombe Basse',
        regionId: 'avarosa-reach',
        entityIds: [entityOf(stage, 'tombe-basse'), entityOf(stage, 'veilleurs')],
        presentCharacterIds: [
          characterOf(stage, 'braum'),
          characterOf(stage, 'ashe'),
          characterOf(stage, 'sejuani'),
        ],
      },
      { actorKind: 'gm_ai' },
    ),
    introduce(stage, 'tombe-basse'),
    introduce(stage, 'griffe-hiver'),
    introduce(stage, 'fil-pacte'),
    introduce(stage, 'fil-tombe'),
  ]);

  director.write([
    gm(
      stage,
      'Trois mètres de glace, et un trou dedans. Les outils sont encore là, posés en ordre, ' +
        "propres. Celui qui a creusé n'était pas pressé, et il comptait revenir.",
      [director.state.seq],
    ),
  ]);

  director.play(
    characterOf(stage, 'ashe'),
    {
      type: 'move.gather_information',
      description: 'Ashe relève les outils un par un et cherche la marque du forgeron.',
    },
    'Ashe relève les outils',
  );
  director.play(
    characterOf(stage, 'sejuani'),
    {
      type: 'move.probe_a_soul',
      target: { kind: 'entity', entityId: entityOf(stage, 'yrsa') },
      bonus: 1,
    },
    'Sejuani sonde Yrsa',
  );
  director.play(
    characterOf(stage, 'braum'),
    {
      type: 'move.secure_advantage',
      attribute: 'coeur',
      description: 'Braum s’assoit avec les Veilleurs et leur parle de leurs morts.',
    },
    'Braum parle aux Veilleurs',
  );

  director.write([
    authored(
      'entity.updated',
      {
        entityId: entityOf(stage, 'veilleurs'),
        patch: { summary: 'Ils attendaient quelqu’un, et ce quelqu’un est déjà passé.' },
        before: { summary: 'Ils attendent depuis si longtemps qu’ils ont oublié quoi.' },
      },
      { actorKind: 'gm_ai' },
    ),
    authored(
      'entity.mentioned',
      { entityId: entityOf(stage, 'fil-tombe') },
      { actorKind: 'gm_ai' },
    ),
  ]);

  director.play(
    characterOf(stage, 'braum'),
    {
      type: 'speech.say',
      channel: 'ic',
      text: '« Alors on le jure ici, devant la tombe. Une saison. Pas plus, pas moins. »',
    },
    'Braum propose le pacte',
  );
  const pact = director.play(
    characterOf(stage, 'sejuani'),
    {
      type: 'move.swear_a_vow',
      text: 'Tenir la Porte Basse avec le Gué Bas et Rakelstake, le temps d’un hiver.',
      rank: 'dangereux',
    },
    'Sejuani jure le pacte',
  );

  // THE TWO-STEP BURN (ARCHITECTURE.md section 4.4): the roll is written with
  // its window open, the player SEES the dice, and the burn is a second intent
  // that adds a revision — the first roll is never rewritten.
  //
  // The script arranges the conditions and checks that they held: a low move
  // against a high momentum. If the window did not open, the demo would
  // silently lose two of the seventy-one types, so it STOPS instead.
  director.playHoldingWindow(
    characterOf(stage, 'ashe'),
    {
      type: 'move.probe_a_soul',
      target: { kind: 'description', text: 'le plus vieux des Veilleurs, celui qui ne parle pas' },
      bonus: -3,
    },
    'Ashe sonde le plus vieux des Veilleurs',
  );
  const window = director.burnWindow;
  if (window === null) {
    throw new DemoScriptInconsistent(
      'aucune fenêtre de brûlure ouverte : la démonstration perdrait ' +
        'character.momentum_burned et roll.action_revised',
    );
  }
  director.play(
    characterOf(stage, 'ashe'),
    { type: 'momentum.burn', rollId: window.roll.rollId },
    'Ashe brûle son souffle sur le jet qu’elle vient de voir',
  );

  director.write([
    authored(
      'track.rank_changed',
      {
        trackId: vowOf(pact),
        from: 'dangereux',
        to: 'redoutable',
        reason: 'le pacte engage trois clans, pas un seul',
      },
      { actorKind: 'system' },
    ),
  ]);

  director.write([
    authored(
      'system.correction',
      {
        targetSeq: director.state.seq,
        field: `entities.${entityOf(stage, 'sigrid')}.name`,
        from: 'Sigrid la Passeuse',
        to: 'Sigrid la Passeuse du Gué',
        reason: 'le nom avait été noté à moitié le premier soir',
      },
      { actorKind: 'system', actorPlayerId: owner },
    ),
  ]);

  director.write([
    facts(stage, sceneId, {
      placeId: 'la-tombe-basse',
      placeName: 'La Tombe Basse',
      timeOfDay: 'plein jour, le vent est tombé',
      present: [
        { kind: 'character', key: 'braum', name: 'Braum', state: 'assis avec les Veilleurs' },
        { kind: 'character', key: 'ashe', name: 'Ashe', state: 'elle tient un ciseau à glace' },
        { kind: 'character', key: 'sejuani', name: 'Sejuani', state: 'elle vient de jurer' },
        {
          kind: 'entity',
          key: 'veilleurs',
          name: 'Les Veilleurs de la Tombe',
          state: 'ils ne bougent pas',
        },
        {
          kind: 'entity',
          key: 'tombe-basse',
          name: 'La Tombe Basse',
          state: 'ouverte, puis refermée',
        },
      ],
    }),
  ]);

  director.write([
    authored(
      'scene.ended',
      { sceneId, outcome: 'le pacte est juré, et la tombe garde encore sa question' },
      { actorKind: 'system' },
    ),
  ]);

  // Second scene of the veillée, still open when the seed stops: the base a
  // developer starts the application on is a table MID-SESSION, not a table
  // between two of them.
  const granary = stage.ids.next() as SceneId;
  director.write([
    authored(
      'scene.started',
      {
        sceneId: granary,
        title: 'Le grenier commun',
        regionId: 'avarosa-reach',
        entityIds: [entityOf(stage, 'gue-bas'), entityOf(stage, 'yrsa')],
        presentCharacterIds: [
          characterOf(stage, 'braum'),
          characterOf(stage, 'ashe'),
          characterOf(stage, 'sejuani'),
        ],
      },
      { actorKind: 'gm_ai' },
    ),
  ]);

  director.play(
    characterOf(stage, 'sejuani'),
    {
      type: 'move.secure_advantage',
      attribute: 'fer',
      description:
        'Sejuani fait porter le tribut de la horde dans le grenier, devant tout le monde.',
    },
    'Sejuani verse le tribut au grenier',
  );
  director.play(
    characterOf(stage, 'ashe'),
    {
      type: 'move.face_danger',
      attribute: 'esprit',
      description: 'Ashe reprend le compte du grain devant les trois clans, à voix haute.',
    },
    'Ashe recompte le grain devant tous',
  );

  director.write([
    facts(stage, granary, {
      placeId: 'le-gue-bas',
      placeName: 'Le grenier commun',
      timeOfDay: 'soir, la porte est restée ouverte',
      present: [
        { kind: 'character', key: 'braum', name: 'Braum', state: 'il dort contre la porte' },
        { kind: 'character', key: 'ashe', name: 'Ashe', state: 'elle compte à voix haute' },
        { kind: 'character', key: 'sejuani', name: 'Sejuani', state: 'elle a posé le tribut' },
        {
          kind: 'entity',
          key: 'yrsa',
          name: 'Yrsa du Gué Bas',
          state: 'elle recompte derrière Ashe',
        },
      ],
    }),
  ]);

  // ── the one vow that is CLAIMED, and the dice that answer ──────────────
  // §7.1 asks for « 1 accompli (dangereux) », and a demo campaign where nobody
  // ever succeeds at anything is a demo campaign nobody wants to play. What is
  // arranged here is the CONDITION — three milestones at `dangereux`, so six
  // complete boxes — and nothing else: the two challenge dice are drawn by the
  // engine on the campaign generator, and `fulfill-your-vow` fulfils on a weak
  // hit as well as on a strong one. Had they come up higher, the vow would
  // have failed and this comment would be wrong; the SCORE is scripted, the
  // OUTCOME is not.
  director.play(
    characterOf(stage, 'braum'),
    {
      type: 'speech.say',
      channel: 'ic',
      text: '« Le chariot est passé, le grain est au grenier. Je réclame la fin de mon serment. »',
    },
    'Braum réclame la fin devant la table',
  );

  director.play(
    characterOf(stage, 'braum'),
    { type: 'move.fulfill_your_vow', trackId: vowIn(vows, 'braum') },
    'Braum réclame la fin de son serment',
  );

  director.write([
    gm(
      stage,
      "Le pacte tient pour un hiver. Personne ne s'embrasse, personne ne trinque : on se " +
        'regarde, on hoche la tête, et on remonte chacun vers sa vallée avant la nuit.',
      [director.state.seq],
    ),
  ]);

  compactChronicle(stage, 3);
}

/**
 * Between the two veillées: what the players do off the table.
 *
 * Experience spent, an asset taken and another lost, a declaration withdrawn
 * before the dice, a vow whose rank the table raised. None of it is a roll,
 * and none of it is `decide()`'s to produce.
 */
function betweenVeillees(stage: DemoStage): void {
  const { director } = stage;
  director.write([
    authored(
      'character.asset_added',
      {
        characterId: characterOf(stage, 'braum'),
        assetId: 'poro-fidele',
        options: { nom: 'Grognon' },
      },
      {
        actorKind: 'player',
        actorPlayerId: playerOf(stage, 'demo-braum'),
        subjectCharacterId: characterOf(stage, 'braum'),
      },
    ),
    authored(
      'character.asset_upgraded',
      {
        characterId: characterOf(stage, 'braum'),
        assetId: 'bouclier-de-porte',
        abilityIndex: 1,
        xpCost: 1,
      },
      {
        actorKind: 'player',
        actorPlayerId: playerOf(stage, 'demo-braum'),
        subjectCharacterId: characterOf(stage, 'braum'),
      },
    ),
    authored(
      'character.xp_spent',
      { characterId: characterOf(stage, 'braum'), amount: 1, target: 'bouclier-de-porte#1' },
      {
        actorKind: 'player',
        actorPlayerId: playerOf(stage, 'demo-braum'),
        subjectCharacterId: characterOf(stage, 'braum'),
      },
    ),
  ]);

  director.write([
    authored(
      'character.condition_removed',
      {
        characterId: characterOf(stage, 'sejuani'),
        conditionId: 'parjure',
        cause: 'asset:rite-du-feu-partage',
      },
      { actorKind: 'engine', subjectCharacterId: characterOf(stage, 'sejuani') },
    ),
    authored(
      'character.asset_removed',
      {
        characterId: characterOf(stage, 'sejuani'),
        assetId: 'chant-de-la-horde',
        cause: 'la horde ne répond plus à son chant',
      },
      { actorKind: 'engine', subjectCharacterId: characterOf(stage, 'sejuani') },
    ),
  ]);

  director.write([
    authored(
      'move.aborted',
      {
        moveId: 'probe-a-soul',
        characterId: characterOf(stage, 'ashe'),
        reason: 'la joueuse reprend sa déclaration avant les dés',
      },
      {
        actorKind: 'player',
        actorPlayerId: playerOf(stage, 'demo-ashe'),
        subjectCharacterId: characterOf(stage, 'ashe'),
      },
    ),
  ]);
}
