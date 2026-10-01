/**
 * `buildCampaignBlock()` — `system[1]`, the campaign-specific half of the
 * storyteller's system prompt (02-mj-ia.md section 2.2).
 *
 * ── WHY IT IS A SECOND BLOCK AND NOT PART OF THE FIRST ──────────────────────
 * Cache (section 4.2). `system[0]` is shared by EVERY campaign, so it is the
 * widest-reused prefix in the system; this block changes when a player joins,
 * leaves, or when the reserved list moves — a few times a month. Merging them
 * would tie the reuse of the big one to the churn of the small one.
 *
 * ── WHY THE RENDERING IS DETERMINISTIC ──────────────────────────────────────
 * Same reason, one step further: at equal data the bytes must be equal, or the
 * prefix moves for nothing. Hence the stable sort by identifier on all three
 * lists, and hence aliases being joined in their given order rather than in
 * whatever order a `Set` hands them back.
 *
 * ── THE RESERVED LIST IS THE ONE THAT MATTERS ───────────────────────────────
 * It is the prompt side of the distribution lock: those champions are played
 * by somebody else at this table, and the storyteller must not summon them
 * under a name, a nickname, a title or a recognisable periphrasis. The aliases
 * are CONTENT, not AI data — the same list feeds the `no_reserved_champion`
 * assertion and the production post-filter (sections 2.2 and 8.4). An empty
 * `aliases` here is a hole in the lock, silently, which is why section 2.2
 * calls alias completeness a content project of its own.
 */

/** One player character at the table. */
export interface CampaignBlockCharacter {
  readonly id: string;
  readonly name: string;
  readonly championDisplayName: string;
  readonly pronouns: string;
  readonly oneLine: string;
}

/** One champion reserved by another player of THIS campaign (section 4.4, per-campaign scope). */
export interface CampaignBlockReservedChampion {
  readonly id: string;
  readonly displayName: string;
  /** Nicknames, titles, epithets, French and English. Content data. */
  readonly aliases: readonly string[];
}

export interface CampaignBlockNpc {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly oneLine: string;
}

export interface CampaignBlockInput {
  readonly name: string;
  readonly tone: string;
  /** Null renders as `aucune`, per the template's default. */
  readonly houseRules: string | null;
  readonly characters: readonly CampaignBlockCharacter[];
  readonly reservedChampions: readonly CampaignBlockReservedChampion[];
  readonly allowedNpcs: readonly CampaignBlockNpc[];
}

/**
 * An empty list still prints a line, for the reason section 4.5 gives about
 * the absent list: a missing line reads as missing information, an explicit
 * line reads as a fact. Nothing in section 2.2 says what an empty list looks
 * like, and leaving a bare heading would have been the ambiguous choice.
 */
const EMPTY_LIST = '- aucun';

const byId = <T extends { readonly id: string }>(items: readonly T[]): readonly T[] =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function list(items: readonly string[]): readonly string[] {
  return items.length === 0 ? [EMPTY_LIST] : items;
}

export function buildCampaignBlock(campaign: CampaignBlockInput): string {
  const characters = byId(campaign.characters).map(
    (character) =>
      `- ${character.name} (${character.championDisplayName}, ${character.pronouns}) — ${character.oneLine}`,
  );
  const reserved = byId(campaign.reservedChampions).map(
    (champion) => `- ${champion.displayName} (également : ${champion.aliases.join(', ')})`,
  );
  const npcs = byId(campaign.allowedNpcs).map(
    (npc) => `- ${npc.name} — ${npc.role}, ${npc.oneLine}`,
  );

  return [
    `# Campagne : ${campaign.name}`,
    '',
    `Ton de la table : ${campaign.tone}`,
    `Règles maison : ${campaign.houseRules ?? 'aucune'}`,
    '',
    '## Personnages joueurs présents à la table',
    '',
    ...list(characters),
    '',
    'Tu ne fais jamais parler ni agir ces personnages.',
    '',
    '## Champions interdits (réservés)',
    '',
    "Les champions suivants sont joués par d'autres joueurs de cette table. Ils n'existent pas comme personnages que tu pourrais faire apparaître. Tu ne les nommes jamais, ne les évoques jamais, ne les fais jamais apparaître, ni sous leur nom, ni sous aucun de leurs surnoms :",
    '',
    ...list(reserved),
    '',
    '## Personnages non joueurs autorisés',
    '',
    'Tu peux faire apparaître librement les personnages suivants, en plus de figurants anonymes de ton invention :',
    '',
    ...list(npcs),
    '',
    // ADR 0011, prose-only mode: there is no `propose_*` tool to send them
    // through any more, so the line that named one became an instruction to do
    // something impossible — the shape of prompt a small model answers with a
    // hallucinated tool call. The rule it carried is unchanged and now closed.
    'Aucun autre personnage nommé n’entre en scène : ceux qui ne figurent pas dans cette liste n’existent pas encore.',
  ].join('\n');
}
